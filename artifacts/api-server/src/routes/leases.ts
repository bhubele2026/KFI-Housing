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
  res.json(ListLeasesResponse.parse(rows.map(withDerivedStatus)));
});

// Note on date validation: the lease `startDate` / `endDate` fields are
// constrained to a strict `^\d{4}-\d{2}-\d{2}$` regex by the shared zod
// schemas (see `lib/api-spec/openapi.yaml` -> `LeaseDate`). Anything like
// `"2026-05-31 00:00:00"` or `"2026-05-31T00:00:00.000Z"` is rejected here
// with a 400 before it can reach the database, so the route does not need
// its own normalization step.
router.post("/leases", async (req, res): Promise<void> => {
  const body = CreateLeaseBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [row] = await db.insert(leasesTable).values(body.data).returning();
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
  const [row] = await db
    .update(leasesTable)
    .set(body.data)
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
