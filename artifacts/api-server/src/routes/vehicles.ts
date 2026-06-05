import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, vehiclesTable } from "@workspace/db";
import {
  ListVehiclesResponse,
  CreateVehicleBody,
  UpdateVehicleParams,
  UpdateVehicleBody,
  UpdateVehicleResponse,
  DeleteVehicleParams,
} from "@workspace/api-zod";
import { normalizeVehicleRow } from "../lib/db-row-normalizers";

const router: IRouter = Router();

router.get("/vehicles", async (_req, res): Promise<void> => {
  const rows = await db.select().from(vehiclesTable).orderBy(vehiclesTable.id);
  // Normalize each row at the DB ↔ API boundary so a legacy / off-list
  // ownership or status value never 500s the whole list endpoint.
  res.json(ListVehiclesResponse.parse(rows.map((r) => normalizeVehicleRow(r))));
});

router.post("/vehicles", async (req, res): Promise<void> => {
  const body = CreateVehicleBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const normalized = normalizeVehicleRow(body.data);
  const [row] = await db.insert(vehiclesTable).values(normalized).returning();
  res.status(201).json(UpdateVehicleResponse.parse(row));
});

router.patch("/vehicles/:id", async (req, res): Promise<void> => {
  const params = UpdateVehicleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = UpdateVehicleBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  // Bump updatedAt on every edit, matching the properties/beds convention
  // (the column also has a DB default for inserts).
  const normalized = normalizeVehicleRow({ ...body.data, updatedAt: new Date() });
  const [row] = await db
    .update(vehiclesTable)
    .set(normalized)
    .where(eq(vehiclesTable.id, params.data.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Vehicle not found" });
    return;
  }
  res.json(UpdateVehicleResponse.parse(row));
});

router.delete("/vehicles/:id", async (req, res): Promise<void> => {
  const params = DeleteVehicleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await db.delete(vehiclesTable).where(eq(vehiclesTable.id, params.data.id));
  res.sendStatus(204);
});

export default router;
