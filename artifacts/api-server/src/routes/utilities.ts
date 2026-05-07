import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, utilitiesTable } from "@workspace/db";
import {
  ListUtilitiesResponse,
  CreateUtilityBody,
  UpdateUtilityParams,
  UpdateUtilityBody,
  UpdateUtilityResponse,
  DeleteUtilityParams,
} from "@workspace/api-zod";
import { normalizeUtilityRow } from "../lib/db-row-normalizers";

const router: IRouter = Router();

router.get("/utilities", async (_req, res): Promise<void> => {
  const rows = await db.select().from(utilitiesTable).orderBy(utilitiesTable.id);
  res.json(ListUtilitiesResponse.parse(rows));
});

router.post("/utilities", async (req, res): Promise<void> => {
  const body = CreateUtilityBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [row] = await db.insert(utilitiesTable).values(normalizeUtilityRow(body.data)).returning();
  res.status(201).json(UpdateUtilityResponse.parse(row));
});

router.patch("/utilities/:id", async (req, res): Promise<void> => {
  const params = UpdateUtilityParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = UpdateUtilityBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [row] = await db
    .update(utilitiesTable)
    .set(normalizeUtilityRow(body.data))
    .where(eq(utilitiesTable.id, params.data.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Utility not found" });
    return;
  }
  res.json(UpdateUtilityResponse.parse(row));
});

router.delete("/utilities/:id", async (req, res): Promise<void> => {
  const params = DeleteUtilityParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await db.delete(utilitiesTable).where(eq(utilitiesTable.id, params.data.id));
  res.sendStatus(204);
});

export default router;
