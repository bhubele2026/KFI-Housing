import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, vehicleInsuranceTable } from "@workspace/db";
import {
  ListVehicleInsuranceResponse,
  CreateVehicleInsuranceBody,
  DeleteVehicleInsuranceParams,
} from "@workspace/api-zod";
import { randomUUID } from "node:crypto";

const router: IRouter = Router();

router.get("/vehicle-insurance", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(vehicleInsuranceTable)
    .orderBy(vehicleInsuranceTable.id);
  res.json(ListVehicleInsuranceResponse.parse(rows));
});

router.post("/vehicle-insurance", async (req, res): Promise<void> => {
  const body = CreateVehicleInsuranceBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  if (!body.data.vehicleId) {
    res.status(400).json({ error: "vehicleId is required" });
    return;
  }
  const [row] = await db
    .insert(vehicleInsuranceTable)
    .values({
      id: randomUUID(),
      vehicleId: body.data.vehicleId,
      carrier: body.data.carrier ?? "",
      policyNumber: body.data.policyNumber ?? "",
      coverage: body.data.coverage ?? "",
      premium: body.data.premium ?? 0,
      effectiveDate: body.data.effectiveDate ?? "",
      expiryDate: body.data.expiryDate ?? "",
      documentUrl: body.data.documentUrl ?? "",
      note: body.data.note ?? "",
    })
    .returning();
  res.status(201).json(row);
});

router.delete("/vehicle-insurance/:id", async (req, res): Promise<void> => {
  const params = DeleteVehicleInsuranceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await db
    .delete(vehicleInsuranceTable)
    .where(eq(vehicleInsuranceTable.id, params.data.id));
  res.sendStatus(204);
});

export default router;
