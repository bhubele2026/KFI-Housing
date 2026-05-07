import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
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

const router: IRouter = Router();

router.get("/occupants", async (_req, res): Promise<void> => {
  const rows = await db.select().from(occupantsTable).orderBy(occupantsTable.id);
  // Run each row through the boundary normalizer before the response
  // schema parse (Task #416) so a legacy off-list value already in the
  // DB (e.g. an unknown billingFrequency or shift) gets coerced into the
  // canonical shape instead of 500ing the whole list endpoint.
  const serialized = rows.map((r) => {
    const normalized = normalizeOccupantRow(r);
    return {
      ...normalized,
      createdAt:
        r.createdAt instanceof Date
          ? r.createdAt.toISOString()
          : r.createdAt ?? null,
    };
  });
  res.json(ListOccupantsResponse.parse(serialized));
});

// Strict YYYY-MM-DD pattern. The shared `OptionalLeaseDate` schema
// also accepts "" so legacy import payloads keep round-tripping, but
// fresh occupants created via this endpoint must carry a real
// move-in date (Task #259 — "New occupants going forward require a
// move-in date at creation time").
const STRICT_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

router.post("/occupants", async (req, res): Promise<void> => {
  const body = CreateOccupantBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const normalized = normalizeOccupantRow({
    chargeSource: "",
    chargeSourceCustomer: "",
    chargeSourcePersonId: "",
    ...body.data,
  });
  if (!STRICT_DATE_RE.test(normalized.moveInDate as string)) {
    res.status(400).json({
      error:
        "moveInDate is required when creating an occupant and must be in YYYY-MM-DD format.",
    });
    return;
  }
  const [row] = await db
    .insert(occupantsTable)
    .values(normalized)
    .returning();
  const serializedRow = {
    ...row,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt ?? null,
  };
  res.status(201).json(UpdateOccupantResponse.parse(serializedRow));
});

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
  if (touchesCharge && !setsSource) {
    const [existing] = await db
      .select({ chargeSource: occupantsTable.chargeSource })
      .from(occupantsTable)
      .where(eq(occupantsTable.id, params.data.id));
    if (!existing) {
      res.status(404).json({ error: "Occupant not found" });
      return;
    }
    if (existing.chargeSource === "payroll") {
      updates.chargeSource = "manual_override";
      // Intentionally do NOT touch chargeSourceCustomer /
      // chargeSourcePersonId — those carry the original payroll link.
    }
    // "" or "manual_override": leave provenance fields untouched.
  }
  const [row] = await db
    .update(occupantsTable)
    .set(updates)
    .where(eq(occupantsTable.id, params.data.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Occupant not found" });
    return;
  }
  const serializedPatch = {
    ...row,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt ?? null,
  };
  res.json(UpdateOccupantResponse.parse(serializedPatch));
});

router.delete("/occupants/:id", async (req, res): Promise<void> => {
  const params = DeleteOccupantParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  // Mirror the inverse cleanup the bed delete pathway implies: any bed
  // pointing at this occupant gets its occupantId cleared so we don't
  // leave dangling references behind.
  await db
    .update(bedsTable)
    .set({ occupantId: null })
    .where(eq(bedsTable.occupantId, params.data.id));
  await db.delete(occupantsTable).where(eq(occupantsTable.id, params.data.id));
  res.sendStatus(204);
});

export default router;
