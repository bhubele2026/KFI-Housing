import { Router, type IRouter } from "express";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import {
  db,
  leasesTable,
  propertiesTable,
  roomsTable,
  bedsTable,
  type LeaseRow,
  type InsertRoomRow,
  type InsertBedRow,
} from "@workspace/db";
import {
  ListLeasesResponse,
  ListLeasesResponseItem,
  CreateLeaseBody,
  UpdateLeaseParams,
  UpdateLeaseBody,
  UpdateLeaseResponse,
  DeleteLeaseParams,
} from "@workspace/api-zod";
import { deriveLeaseStatus } from "../lib/lease-status";
import { normalizeLeaseRow } from "../lib/db-row-normalizers";
import { planBedsToCreate } from "../lib/seed-bed-inventory";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/**
 * Ensure a freshly-leased property has placeable bed rows so it can
 * immediately receive a placement from the Roster. Reuses the
 * seed-bed-inventory planner (deterministic auto ids → idempotent, never
 * duplicates), filling up to the property's `totalBeds` — or at least one
 * bed when capacity isn't set yet, so a brand-new lease never lands on a
 * property with zero assignable beds. Additive only (never touches
 * existing/occupied beds) and non-fatal: a hiccup here must not fail the
 * lease create.
 */
async function ensureBedsForProperty(propertyId: string): Promise<void> {
  if (!propertyId) return;
  try {
    const [prop] = await db
      .select({ totalBeds: propertiesTable.totalBeds })
      .from(propertiesTable)
      .where(eq(propertiesTable.id, propertyId));
    if (!prop) return; // unknown property — nothing to materialize against

    const existing = await db
      .select({ id: bedsTable.id })
      .from(bedsTable)
      .where(eq(bedsTable.propertyId, propertyId));

    const target = prop.totalBeds && prop.totalBeds > 0 ? prop.totalBeds : 1;
    const plan = planBedsToCreate(
      propertyId,
      existing.map((b) => b.id),
      target,
    );
    if (plan.beds.length === 0) return;

    // Auto room (idempotent — created once, reused thereafter).
    const room = await db
      .select({ id: roomsTable.id })
      .from(roomsTable)
      .where(eq(roomsTable.id, plan.roomId));
    if (room.length === 0) {
      const roomRow: InsertRoomRow = {
        id: plan.roomId,
        propertyId,
        buildingId: "",
        name: "Unassigned (auto)",
        sqft: 0,
        bathrooms: 0,
        monthlyRent: 0,
      };
      await db.insert(roomsTable).values(roomRow);
    }

    const bedRows: InsertBedRow[] = plan.beds.map((b) => ({
      id: b.id,
      propertyId,
      bedNumber: b.bedNumber,
      roomId: plan.roomId,
      status: "Vacant",
      occupantId: null,
    }));
    await db.insert(bedsTable).values(bedRows);
    logger.info(
      { propertyId, created: bedRows.length },
      "leases: auto-materialized beds on lease create",
    );
  } catch (err) {
    logger.warn(
      { err, propertyId },
      "leases: bed auto-materialize failed (non-fatal)",
    );
  }
}

// Lease status (Active / Expired / Upcoming) is derived from term dates
// against today's date on read, so a lease seeded as "Active"
// automatically transitions to "Expired" the day after its end date —
// without any re-import or background job. The stored `status` column is
// only used as a fallback for rows whose term dates are still blank
// (e.g. master-import rows awaiting review).
function withDerivedStatus(row: LeaseRow): LeaseRow {
  return { ...row, status: deriveLeaseStatus(row) };
}

// Optional server-side filters (perf pass): scope leases to a property and/or
// the lease's own customerId column (both indexed). Omitting both is identical
// to the prior full-list behavior.
const ListLeasesQuery = z
  .object({
    propertyId: z.string().min(1).optional(),
    customerId: z.string().min(1).optional(),
  })
  .passthrough();

router.get("/leases", async (req, res): Promise<void> => {
  const q = ListLeasesQuery.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  const { propertyId, customerId } = q.data;
  const conds = [
    propertyId ? eq(leasesTable.propertyId, propertyId) : undefined,
    customerId ? eq(leasesTable.customerId, customerId) : undefined,
  ].filter((c): c is NonNullable<typeof c> => c !== undefined);
  const base = db.select().from(leasesTable);
  // No-filter branch is byte-for-byte the prior query; the filter branch adds
  // the indexed WHERE (AND of whichever params were supplied).
  const rows = conds.length
    ? await base.where(and(...conds)).orderBy(leasesTable.id)
    : await base.orderBy(leasesTable.id);
  const normalized = rows.map((r) =>
    withDerivedStatus(normalizeLeaseRow(r) as LeaseRow),
  );
  const out: unknown[] = [];
  for (const row of normalized) {
    const result = ListLeasesResponseItem.safeParse(row);
    if (result.success) {
      out.push(result.data);
    } else {
      console.warn(
        `[leases] Passing through malformed row ${(row as Record<string, unknown>).id ?? "??"} for client-side handling:`,
        result.error.issues,
      );
      out.push(row);
    }
  }
  res.json(out);
});

// Note on date validation: the lease `startDate` / `endDate` fields are
// constrained to a strict `^\d{4}-\d{2}-\d{2}$` regex by the shared zod
// schemas (see `lib/api-spec/openapi.yaml` -> `LeaseDate`), so a
// datetime-style value normally 400s here before it can reach the DB.
// We still pipe the body through `normalizeLeaseRow` below as a
// defence-in-depth boundary (Task #373) so a hand-crafted request
// can't ever bypass that into a stale-shape DB write — same
// normalizer the GET routes and importers already use.
router.post("/leases", async (req, res): Promise<void> => {
  const body = CreateLeaseBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  // Defence-in-depth (Task #373): the zod request schema is the
  // primary gate, but we also run the same boundary normalizer used
  // by GET / importers so a payload that ever slips an off-list enum
  // or datetime-style date through (loosened LeaseDate regex,
  // hand-crafted curl) is coerced rather than persisted as-is.
  const normalized = normalizeLeaseRow(body.data);
  const [row] = await db.insert(leasesTable).values(normalized).returning();
  // A new lease means the property is now in use — make sure it has
  // placeable beds so an operator can assign someone right away.
  await ensureBedsForProperty(row.propertyId);
  res.status(201).json(UpdateLeaseResponse.parse(withDerivedStatus(row)));
});

router.patch("/leases/:id", async (req, res): Promise<void> => {
  const params = UpdateLeaseParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = UpdateLeaseBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  // Defence-in-depth (Task #373): coerce any off-list enum / datetime-
  // style date in the body before it lands in the DB.
  const normalized = normalizeLeaseRow(body.data);
  const [row] = await db
    .update(leasesTable)
    .set(normalized)
    .where(eq(leasesTable.id, params.data.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Lease not found" });
    return;
  }
  res.json(UpdateLeaseResponse.parse(withDerivedStatus(row)));
});

router.delete("/leases/:id", async (req, res): Promise<void> => {
  const params = DeleteLeaseParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await db.delete(leasesTable).where(eq(leasesTable.id, params.data.id));
  res.sendStatus(204);
});

export default router;
