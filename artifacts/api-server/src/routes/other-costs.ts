import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, otherCostsTable } from "@workspace/db";
import {
  ListOtherCostsResponse,
  CreateOtherCostBody,
  UpdateOtherCostParams,
  UpdateOtherCostBody,
  UpdateOtherCostResponse,
  DeleteOtherCostParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/other-costs", async (_req, res): Promise<void> => {
  const rows = await db.select().from(otherCostsTable).orderBy(otherCostsTable.id);
  res.json(ListOtherCostsResponse.parse(rows));
});

router.post("/other-costs", async (req, res): Promise<void> => {
  const body = CreateOtherCostBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [row] = await db.insert(otherCostsTable).values(body.data).returning();
  res.status(201).json(UpdateOtherCostResponse.parse(row));
});

router.patch("/other-costs/:id", async (req, res): Promise<void> => {
  const params = UpdateOtherCostParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = UpdateOtherCostBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [row] = await db
    .update(otherCostsTable)
    .set(body.data)
    .where(eq(otherCostsTable.id, params.data.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Other cost not found" });
    return;
  }
  res.json(UpdateOtherCostResponse.parse(row));
});

router.delete("/other-costs/:id", async (req, res): Promise<void> => {
  const params = DeleteOtherCostParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await db.delete(otherCostsTable).where(eq(otherCostsTable.id, params.data.id));
  res.sendStatus(204);
});

export default router;
