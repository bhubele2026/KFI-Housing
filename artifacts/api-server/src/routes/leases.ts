import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, leasesTable, type LeaseRow } from "@workspace/db";
import {
  ListLeasesResponse,
  CreateLeaseBody,
  UpdateLeaseParams,
  UpdateLeaseBody,
  UpdateLeaseResponse,
  DeleteLeaseParams,
} from "@workspace/api-zod";
import { deriveLeaseStatus } from "../lib/lease-status";
import { normalizeLeaseRow } from "../lib/db-row-normalizers";

const router: IRouter = Router();

// Lease status (Active / Expired / Upcoming) is derived from term dates
// against today's date on read, so a lease seeded as "Active"
// automatically transitions to "Expired" the day after its end date —
// without any re-import or background job. The stored `status` column is
// only used as a fallback for rows whose term dates are still blank
// (e.g. master-import rows awaiting review).
function withDerivedStatus(row: LeaseRow): LeaseRow {
  return { ...row, status: deriveLeaseStatus(row) };
}

router.get("/leases", async (_req, res): Promise<void> => {
  const rows = await db.select().from(leasesTable).orderBy(leasesTable.id);
  // Normalize each row at the DB ↔ API boundary (Task #365) so legacy
  // values — datetime-style date strings, unknown enum members — are
  // coerced to the canonical shape before `ListLeasesResponse.parse`
  // sees them. One bad row used to 500 the whole list because zod
  // validates the entire array atomically.
  res.json(
    ListLeasesResponse.parse(
      rows.map((r) => withDerivedStatus(normalizeLeaseRow(r) as LeaseRow)),
    ),
  );
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
