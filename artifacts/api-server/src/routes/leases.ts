import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, leasesTable } from "@workspace/db";
import {
  ListLeasesResponse,
  CreateLeaseBody,
  UpdateLeaseParams,
  UpdateLeaseBody,
  UpdateLeaseResponse,
  DeleteLeaseParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/leases", async (_req, res): Promise<void> => {
  const rows = await db.select().from(leasesTable).orderBy(leasesTable.id);
  res.json(ListLeasesResponse.parse(rows));
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
  res.status(201).json(UpdateLeaseResponse.parse(row));
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
  res.json(UpdateLeaseResponse.parse(row));
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
