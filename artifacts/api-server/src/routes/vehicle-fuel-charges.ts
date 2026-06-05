import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, vehicleFuelChargesTable } from "@workspace/db";
import {
  ListVehicleFuelChargesResponse,
  CreateVehicleFuelChargeBody,
  DeleteVehicleFuelChargeParams,
} from "@workspace/api-zod";
import { randomUUID } from "node:crypto";

const router: IRouter = Router();

router.get("/vehicle-fuel-charges", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(vehicleFuelChargesTable)
    .orderBy(vehicleFuelChargesTable.date);
  res.json(ListVehicleFuelChargesResponse.parse(rows));
});

router.post("/vehicle-fuel-charges", async (req, res): Promise<void> => {
  const body = CreateVehicleFuelChargeBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  if (!body.data.vehicleId) {
    res.status(400).json({ error: "vehicleId is required" });
    return;
  }
  const [row] = await db
    .insert(vehicleFuelChargesTable)
    .values({
      id: randomUUID(),
      vehicleId: body.data.vehicleId,
      date: body.data.date ?? "",
      amount: body.data.amount ?? 0,
      gallons: body.data.gallons ?? 0,
      merchant: body.data.merchant ?? "",
      cardLast4: body.data.cardLast4 ?? "",
      note: body.data.note ?? "",
    })
    .returning();
  res.status(201).json(row);
});

router.delete("/vehicle-fuel-charges/:id", async (req, res): Promise<void> => {
  const params = DeleteVehicleFuelChargeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await db
    .delete(vehicleFuelChargesTable)
    .where(eq(vehicleFuelChargesTable.id, params.data.id));
  res.sendStatus(204);
});

export default router;
