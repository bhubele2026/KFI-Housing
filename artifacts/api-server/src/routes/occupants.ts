import { Router, type IRouter } from "express";
import { eq, and, ne } from "drizzle-orm";
import { db, occupantsTable, bedsTable } from "@workspace/db";
import {
  ListOccupantsResponse,
  CreateOccupantBody,
  UpdateOccupantParams,
  UpdateOccupantBody,
  UpdateOccupantResponse,
  DeleteOccupantParams,
} from "@workspace/api-zod";
import { normalizeOccupantRow } from "../lib/db-row-normalizers";
import {
  getOccupantDeductionsBatch,
  deductionFromOccupant,
} from "../lib/occupant-deduction";

const router: IRouter = Router();

function serializeOccupant<R extends { createdAt: Date | string | null }>(row: R) {
  // `zenopleCheckedAt` is a timestamptz (Date) on the row; coerce it to ISO
  // like createdAt so it round-trips as a date-time string once codegen
  // surfaces it. Read cast-safe so this is a no-op on rows without the
  // column (e.g. before the migration runs).
  const checkedAt = (row as { zenopleCheckedAt?: Date | string | null })
    .zenopleCheckedAt;
  return {
    ...row,
    createdAt:
      row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : row.createdAt ?? null,
    ...(checkedAt !== undefined
      ? {
          zenopleCheckedAt:
            checkedAt instanceof Date
              ? checkedAt.toISOString()
              : checkedAt ?? null,
        }
      : {}),
  };
}

router.get("/occupants", async (_req, res): Promise<void> => {
  const rows = await db.select().from(occupantsTable).orderBy(occupantsTable.id);
  // Run each row through the boundary normalizer before the response
  // schema parse (Task #416) so a legacy off-list value already in the
  // DB (e.g. an unknown billingFrequency or shift) gets coerced into the
  // canonical shape instead of 500ing the whole list endpoint. The
  // normaliser also backfills the task #500 fields (responsibilities /
  // isLead / keysIssued) on legacy rows.
  //
  // Attach the read-only computed `deduction` (Stage 3a) so the
  // DeductionBadge can render on every surface a person appears. ONE
  // batched query (no N+1 at ~500 occupants); fall back to the occupant's
  // cached chargePerBed when there's no payroll snapshot. (The field is
  // stripped by the response parse until codegen surfaces it on Replit.)
  // Resilient: a payroll-deductions query hiccup must NOT 500 the whole
  // occupants list — fall back to each row's cached chargePerBed below.
  const deductions = await getOccupantDeductionsBatch(rows.map((r) => r.id)).catch(
    () => new Map<string, ReturnType<typeof deductionFromOccupant>>(),
  );
  const serialized = rows.map((r) => {
    const normalized = normalizeOccupantRow(r);
    const deduction = deductions.get(r.id) ?? deductionFromOccupant(r);
    return serializeOccupant({ ...normalized, deduction });
  });
  res.json(ListOccupantsResponse.parse(serialized));
});

// Strict YYYY-MM-DD pattern. The shared `OptionalLeaseDate` schema
// also accepts "" so legacy import payloads keep round-tripping, but
// fresh occupants created via this endpoint must carry a real
// move-in date (Task #259 — "New occupants going forward require a
// move-in date at creation time").
const STRICT_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Resolve the `roomId` for the bed an occupant is currently sitting on.
 * Returns null when the occupant is unplaced or the bed has been
 * deleted out from under them. Used by the lead-tenant guard so a
 * `isLead: true` patch can demote any prior lead in the same room.
 */
async function roomIdForBed(bedId: string | null | undefined): Promise<string | null> {
  if (!bedId) return null;
  const [bed] = await db
    .select({ roomId: bedsTable.roomId })
    .from(bedsTable)
    .where(eq(bedsTable.id, bedId));
  return bed?.roomId ?? null;
}

/**
 * Strict guard for the `keysIssued` field (task #500). The OpenAPI
 * contract types it as `integer`, but the generated zod schema only
 * checks `number`, so we belt-and-braces it here: bad values get a
 * 400 instead of being silently floored/clamped by the row normaliser.
 */
function rejectInvalidKeysIssued(
  body: { keysIssued?: unknown },
  res: import("express").Response,
): boolean {
  if (!Object.prototype.hasOwnProperty.call(body, "keysIssued")) return false;
  const v = body.keysIssued;
  if (v === undefined || v === null) return false;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
    res.status(400).json({
      error: "keysIssued must be a non-negative integer.",
    });
    return true;
  }
  return false;
}

router.post("/occupants", async (req, res): Promise<void> => {
  const body = CreateOccupantBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  if (rejectInvalidKeysIssued(req.body, res)) return;
  const normalized = normalizeOccupantRow({
    chargeSource: "",
    chargeSourceCustomer: "",
    chargeSourcePersonId: "",
    ...body.data,
  });
  // moveInDate: optional at creation. The master files only record a move-in
  // date for recent (2026) arrivals, so established residents legitimately have
  // none — and the Occupants page already supports a blank date via its inline
  // date-picker. So we ACCEPT empty (operators fill it later) but still reject a
  // malformed non-empty value. Never fabricate a date for a real person.
  const miv = (normalized.moveInDate as string | undefined) ?? "";
  if (miv !== "" && !STRICT_DATE_RE.test(miv)) {
    res.status(400).json({
      error: "moveInDate must be in YYYY-MM-DD format (or left blank).",
    });
    return;
  }
  // Cleaning workflow guard (task #500). When a fresh occupant is
  // created already attached to a bed, the bed must be "ready" — same
  // contract the bed PATCH route enforces for re-assignment.
  if (typeof normalized.bedId === "string" && normalized.bedId) {
    const [bed] = await db
      .select({
        cleaningStatus: bedsTable.cleaningStatus,
        status: bedsTable.status,
        occupantId: bedsTable.occupantId,
      })
      .from(bedsTable)
      .where(eq(bedsTable.id, normalized.bedId));
    if (!bed) {
      res.status(400).json({ error: "Target bed does not exist." });
      return;
    }
    if (bed.status === "Occupied" && bed.occupantId) {
      res.status(409).json({
        error:
          "Bed is currently occupied by another occupant — vacate it first.",
      });
      return;
    }
    if (bed.cleaningStatus !== "ready") {
      res.status(409).json({
        error:
          "Bed is not ready for a new occupant — finish the cleaning workflow first.",
        cleaningStatus: bed.cleaningStatus,
      });
      return;
    }
  }
  const [row] = await db
    .insert(occupantsTable)
    .values(normalized)
    .returning();
  // Lead-tenant guard: when a fresh occupant is flagged as the lead
  // for a room, demote any other lead currently sitting in the same
  // room so the "exactly one lead per room" invariant holds.
  if (row.isLead) {
    const roomId = await roomIdForBed(row.bedId);
    if (roomId) await demoteOtherLeads(row.id, roomId);
  }
  res.status(201).json(UpdateOccupantResponse.parse(serializeOccupant(normalizeOccupantRow(row))));
});

/**
 * Set `isLead = false` on every occupant currently sitting in a bed
 * inside `roomId`, except for the one we just promoted (`keepId`).
 * Implemented as one SQL update per other-occupant rather than a
 * sub-select so it works against the route-test fake `db` shim too.
 */
async function demoteOtherLeads(keepId: string, roomId: string): Promise<void> {
  const bedsInRoom = await db
    .select({ id: bedsTable.id })
    .from(bedsTable)
    .where(eq(bedsTable.roomId, roomId));
  for (const b of bedsInRoom) {
    await db
      .update(occupantsTable)
      .set({ isLead: false })
      .where(
        and(
          eq(occupantsTable.bedId, b.id),
          ne(occupantsTable.id, keepId),
        ),
      );
  }
}

router.patch("/occupants/:id", async (req, res): Promise<void> => {
  const params = UpdateOccupantParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = UpdateOccupantBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  if (rejectInvalidKeysIssued(req.body, res)) return;
  // A manual edit to chargePerBed or billingFrequency means the value
  // no longer matches what payroll said — but we don't want to lose the
  // breadcrumb to the original payroll row (Task #330). Behaviour:
  //   * If the row was previously "payroll", flip chargeSource to
  //     "manual_override" but KEEP chargeSourceCustomer and
  //     chargeSourcePersonId so the property page can render
  //     "manually overridden — was payroll for cust/person".
  //   * If the row was already "manual_override", leave the stamps
  //     alone — a second manual edit doesn't change the original link.
  //   * If the row had no payroll history ("" + empty stamps), nothing
  //     to preserve, so leave it as a plain manual entry.
  // The seeder is the only writer that should ever set chargeSource
  // back to "payroll", so when the caller explicitly sets any of the
  // chargeSource* fields we trust them and don't intervene.
  const updates = normalizeOccupantRow({ ...body.data });
  const touchesCharge =
    Object.prototype.hasOwnProperty.call(updates, "chargePerBed") ||
    Object.prototype.hasOwnProperty.call(updates, "billingFrequency");
  const setsSource =
    Object.prototype.hasOwnProperty.call(updates, "chargeSource") ||
    Object.prototype.hasOwnProperty.call(updates, "chargeSourceCustomer") ||
    Object.prototype.hasOwnProperty.call(updates, "chargeSourcePersonId");
  let existingRow:
    | { chargeSource: string; bedId: string | null; isLead: boolean }
    | undefined;
  if (touchesCharge && !setsSource) {
    const [existing] = await db
      .select({
        chargeSource: occupantsTable.chargeSource,
        bedId: occupantsTable.bedId,
        isLead: occupantsTable.isLead,
      })
      .from(occupantsTable)
      .where(eq(occupantsTable.id, params.data.id));
    if (!existing) {
      res.status(404).json({ error: "Occupant not found" });
      return;
    }
    existingRow = existing;
    if (existing.chargeSource === "payroll") {
      updates.chargeSource = "manual_override";
      // Intentionally do NOT touch chargeSourceCustomer /
      // chargeSourcePersonId — those carry the original payroll link.
    }
  }

  // Move-out / transfer / status→Former side effect (task #500). The
  // bed an occupant is leaving needs a cleaning turnover regardless of
  // whether the patch:
  //   * detaches the bed entirely (bedId→null),
  //   * marks the occupant Former (which implicitly detaches), or
  //   * transfers them onto a *different* bed (bedId→someOtherBed).
  // We always look up the prior bedId, then if the post-patch bedId
  // differs from it (or the occupant goes Former), we flip the prior
  // bed to Vacant + needs_cleaning. The destination bed, if any, is
  // independently validated as "ready" further down — same contract as
  // the bed PATCH route enforces.
  const patchTouchesBed = Object.prototype.hasOwnProperty.call(
    updates,
    "bedId",
  );
  const goingFormer = updates.status === "Former";
  if (goingFormer && !patchTouchesBed) {
    updates.bedId = null;
  }
  let priorBedId: string | null = null;
  if (patchTouchesBed || goingFormer) {
    if (!existingRow) {
      const [existing] = await db
        .select({
          chargeSource: occupantsTable.chargeSource,
          bedId: occupantsTable.bedId,
          isLead: occupantsTable.isLead,
        })
        .from(occupantsTable)
        .where(eq(occupantsTable.id, params.data.id));
      existingRow = existing;
    }
    priorBedId = existingRow?.bedId ?? null;
  }
  // If the patch points the occupant at a brand-new bed, the
  // destination bed must be "ready" — same gate the bed PATCH route
  // enforces. We allow targeting the *same* bed an occupant is already
  // on (no-op transfer), and we skip the check when the occupant is
  // being detached entirely (bedId→null) or marked Former.
  const destBedId =
    patchTouchesBed && typeof updates.bedId === "string" && updates.bedId
      ? updates.bedId
      : null;
  if (destBedId && destBedId !== priorBedId) {
    const [destBed] = await db
      .select({
        cleaningStatus: bedsTable.cleaningStatus,
        status: bedsTable.status,
        occupantId: bedsTable.occupantId,
      })
      .from(bedsTable)
      .where(eq(bedsTable.id, destBedId));
    if (!destBed) {
      res.status(400).json({ error: "Target bed does not exist." });
      return;
    }
    if (destBed.status === "Occupied" && destBed.occupantId) {
      res.status(409).json({
        error:
          "Bed is currently occupied by another occupant — vacate it first.",
      });
      return;
    }
    if (destBed.cleaningStatus !== "ready") {
      res.status(409).json({
        error:
          "Bed is not ready for a new occupant — finish the cleaning workflow first.",
        cleaningStatus: destBed.cleaningStatus,
      });
      return;
    }
  }
  // Only fire the freed-bed cleaning side effect when the prior bed is
  // actually being vacated — i.e. the post-patch bedId differs from
  // the prior one (or the occupant went Former, in which case we set
  // bedId to null above).
  const freesPriorBed =
    priorBedId !== null &&
    (goingFormer ||
      (patchTouchesBed &&
        (updates.bedId === null || updates.bedId !== priorBedId)));

  const [row] = await db
    .update(occupantsTable)
    .set(updates)
    .where(eq(occupantsTable.id, params.data.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Occupant not found" });
    return;
  }

  if (freesPriorBed && priorBedId) {
    await db
      .update(bedsTable)
      .set({ occupantId: null, status: "Vacant", cleaningStatus: "needs_cleaning" })
      .where(eq(bedsTable.id, priorBedId));
  }

  // Lead-tenant guard (task #500). When the patch promotes this
  // occupant to lead, demote any other lead currently sitting in the
  // same room. We re-resolve the roomId from the post-update bedId so
  // a patch that simultaneously moves the occupant and promotes them
  // still demotes peers in the *new* room (the room the lead claim
  // applies to).
  if (row.isLead) {
    const roomId = await roomIdForBed(row.bedId);
    if (roomId) await demoteOtherLeads(row.id, roomId);
  }

  // Normalize the returned row before the response-schema parse — same
  // boundary coercion the GET list applies (task #416). The patched row
  // is the *existing* occupant with the update merged in, so it can still
  // carry a legacy off-list value (shift / billingFrequency / language /
  // null task-500 fields) that the input validation never touched.
  // Without this, vacating/editing such an occupant 500s on the response
  // parse and the client reverts with "Save failed". (#bug: vacate)
  res.json(UpdateOccupantResponse.parse(serializeOccupant(normalizeOccupantRow(row))));
});

router.delete("/occupants/:id", async (req, res): Promise<void> => {
  const params = DeleteOccupantParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  // Mirror the inverse cleanup the bed delete pathway implies: any bed
  // pointing at this occupant gets its occupantId cleared so we don't
  // leave dangling references behind, AND its cleaning workflow flips
  // to "needs_cleaning" so the turnover task lands in the operator's
  // queue (task #500).
  await db
    .update(bedsTable)
    .set({ occupantId: null, status: "Vacant", cleaningStatus: "needs_cleaning" })
    .where(eq(bedsTable.occupantId, params.data.id));
  await db.delete(occupantsTable).where(eq(occupantsTable.id, params.data.id));
  res.sendStatus(204);
});

export default router;
