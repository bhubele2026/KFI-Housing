import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, vehicleMaintenanceTable } from "@workspace/db";
import {
  ListVehicleMaintenanceResponse,
  CreateVehicleMaintenanceBody,
  UpdateVehicleMaintenanceParams,
  UpdateVehicleMaintenanceBody,
  UpdateVehicleMaintenanceResponse,
  DeleteVehicleMaintenanceParams,
} from "@workspace/api-zod";
import { randomUUID } from "node:crypto";

const router: IRouter = Router();

router.get("/vehicle-maintenance", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(vehicleMaintenanceTable)
    .orderBy(vehicleMaintenanceTable.date);
  res.json(ListVehicleMaintenanceResponse.parse(rows));
});

router.post("/vehicle-maintenance", async (req, res): Promise<void> => {
  const body = CreateVehicleMaintenanceBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  if (!body.data.vehicleId) {
    res.status(400).json({ error: "vehicleId is required" });
    return;
  }
  const [row] = await db
    .insert(vehicleMaintenanceTable)
    .values({
      id: randomUUID(),
      vehicleId: body.data.vehicleId,
      date: body.data.date ?? "",
      type: body.data.type ?? "Repair",
      description: body.data.description ?? "",
      cost: body.data.cost ?? 0,
      status: body.data.status ?? "Needed",
      shopName: body.data.shopName ?? "",
      completedDate: body.data.completedDate ?? "",
      note: body.data.note ?? "",
    })
    .returning();
  res.status(201).json(row);
});

router.patch("/vehicle-maintenance/:id", async (req, res): Promise<void> => {
  const params = UpdateVehicleMaintenanceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = UpdateVehicleMaintenanceBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [row] = await db
    .update(vehicleMaintenanceTable)
    .set(body.data)
    .where(eq(vehicleMaintenanceTable.id, params.data.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Maintenance record not found" });
    return;
  }
  res.json(UpdateVehicleMaintenanceResponse.parse(row));
});

router.delete("/vehicle-maintenance/:id", async (req, res): Promise<void> => {
  const params = DeleteVehicleMaintenanceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await db
    .delete(vehicleMaintenanceTable)
    .where(eq(vehicleMaintenanceTable.id, params.data.id));
  res.sendStatus(204);
});

export default router;
