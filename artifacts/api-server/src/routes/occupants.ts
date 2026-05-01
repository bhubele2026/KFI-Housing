import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, occupantsTable } from "@workspace/db";
import {
  ListOccupantsResponse,
  CreateOccupantBody,
  UpdateOccupantParams,
  UpdateOccupantBody,
  UpdateOccupantResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/occupants", async (_req, res): Promise<void> => {
  const rows = await db.select().from(occupantsTable).orderBy(occupantsTable.id);
  res.json(ListOccupantsResponse.parse(rows));
});

router.post("/occupants", async (req, res): Promise<void> => {
  const body = CreateOccupantBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [row] = await db.insert(occupantsTable).values(body.data).returning();
  res.status(201).json(UpdateOccupantResponse.parse(row));
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
  const [row] = await db
    .update(occupantsTable)
    .set(body.data)
    .where(eq(occupantsTable.id, params.data.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Occupant not found" });
    return;
  }
  res.json(UpdateOccupantResponse.parse(row));
});

export default router;
