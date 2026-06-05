import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, vehicleLeasesTable } from "@workspace/db";
import {
  ListVehicleLeasesResponse,
  CreateVehicleLeaseBody,
  UpdateVehicleLeaseParams,
  UpdateVehicleLeaseBody,
  UpdateVehicleLeaseResponse,
  DeleteVehicleLeaseParams,
} from "@workspace/api-zod";
import { randomUUID } from "node:crypto";

const router: IRouter = Router();

router.get("/vehicle-leases", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(vehicleLeasesTable)
    .orderBy(vehicleLeasesTable.id);
  res.json(ListVehicleLeasesResponse.parse(rows));
});

router.post("/vehicle-leases", async (req, res): Promise<void> => {
  const body = CreateVehicleLeaseBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [row] = await db
    .insert(vehicleLeasesTable)
    .values({
      id: randomUUID(),
      vehicleId: body.data.vehicleId ?? "",
      lessor: body.data.lessor ?? "",
      startDate: body.data.startDate ?? "",
      endDate: body.data.endDate ?? "",
      monthlyCost: body.data.monthlyCost ?? 0,
      deposit: body.data.deposit ?? 0,
      buyoutCost: body.data.buyoutCost ?? 0,
      deductions: body.data.deductions ?? "",
      status: body.data.status ?? "Active",
      note: body.data.note ?? "",
    })
    .returning();
  res.status(201).json(row);
});

router.patch("/vehicle-leases/:id", async (req, res): Promise<void> => {
  const params = UpdateVehicleLeaseParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = UpdateVehicleLeaseBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [row] = await db
    .update(vehicleLeasesTable)
    .set(body.data)
    .where(eq(vehicleLeasesTable.id, params.data.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Vehicle lease not found" });
    return;
  }
  res.json(UpdateVehicleLeaseResponse.parse(row));
});

router.delete("/vehicle-leases/:id", async (req, res): Promise<void> => {
  const params = DeleteVehicleLeaseParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await db
    .delete(vehicleLeasesTable)
    .where(eq(vehicleLeasesTable.id, params.data.id));
  res.sendStatus(204);
});

export default router;
