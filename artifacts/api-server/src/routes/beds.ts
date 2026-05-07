import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, bedsTable } from "@workspace/db";
import {
  ListBedsResponse,
  CreateBedBody,
  UpdateBedParams,
  UpdateBedBody,
  UpdateBedResponse,
  DeleteBedParams,
} from "@workspace/api-zod";
import { normalizeBedRow } from "../lib/db-row-normalizers";

const router: IRouter = Router();

router.get("/beds", async (_req, res): Promise<void> => {
  const rows = await db.select().from(bedsTable).orderBy(bedsTable.id);
  // Boundary normalize on the way out (Task #416) so a legacy bed
  // row whose `status` is off-list (e.g. "Pending") doesn't 500 the
  // entire list endpoint via the response schema's enum check.
  const normalized = rows.map((r) => normalizeBedRow(r));
  res.json(ListBedsResponse.parse(normalized));
});

router.post("/beds", async (req, res): Promise<void> => {
  const body = CreateBedBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [row] = await db.insert(bedsTable).values(normalizeBedRow(body.data)).returning();
  res.status(201).json(UpdateBedResponse.parse(row));
});

router.patch("/beds/:id", async (req, res): Promise<void> => {
  const params = UpdateBedParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = UpdateBedBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [row] = await db
    .update(bedsTable)
    .set(normalizeBedRow(body.data))
    .where(eq(bedsTable.id, params.data.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Bed not found" });
    return;
  }
  res.json(UpdateBedResponse.parse(row));
});

router.delete("/beds/:id", async (req, res): Promise<void> => {
  const params = DeleteBedParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await db.delete(bedsTable).where(eq(bedsTable.id, params.data.id));
  res.sendStatus(204);
});

export default router;
