import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, propertiesTable } from "@workspace/db";
import {
  ListPropertiesResponse,
  CreatePropertyBody,
  UpdatePropertyParams,
  UpdatePropertyBody,
  UpdatePropertyResponse,
  DeletePropertyParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/properties", async (_req, res): Promise<void> => {
  const rows = await db.select().from(propertiesTable).orderBy(propertiesTable.id);
  res.json(ListPropertiesResponse.parse(rows));
});

router.post("/properties", async (req, res): Promise<void> => {
  const body = CreatePropertyBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [row] = await db.insert(propertiesTable).values(body.data).returning();
  res.status(201).json(UpdatePropertyResponse.parse(row));
});

router.patch("/properties/:id", async (req, res): Promise<void> => {
  const params = UpdatePropertyParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = UpdatePropertyBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [row] = await db
    .update(propertiesTable)
    .set(body.data)
    .where(eq(propertiesTable.id, params.data.id))
    .returning();

  if (!row) {
    res.status(404).json({ error: "Property not found" });
    return;
  }

  res.json(UpdatePropertyResponse.parse(row));
});

router.delete("/properties/:id", async (req, res): Promise<void> => {
  const params = DeletePropertyParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await db.delete(propertiesTable).where(eq(propertiesTable.id, params.data.id));
  res.sendStatus(204);
});

export default router;
