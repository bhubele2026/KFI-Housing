import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import {
  db,
  vehicleRidersTable,
  vehicleRideOverridesTable,
} from "@workspace/db";
import {
  ListVehicleRidersResponse,
  CreateVehicleRiderBody,
  DeleteVehicleRiderParams,
  ListVehicleRideOverridesResponse,
  CreateVehicleRideOverrideBody,
  DeleteVehicleRideOverrideParams,
} from "@workspace/api-zod";
import { randomUUID } from "node:crypto";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Static rider roster
// ---------------------------------------------------------------------------

router.get("/vehicle-riders", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(vehicleRidersTable)
    .orderBy(vehicleRidersTable.id);
  res.json(ListVehicleRidersResponse.parse(rows));
});

router.post("/vehicle-riders", async (req, res): Promise<void> => {
  const body = CreateVehicleRiderBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const { vehicleId, occupantId } = body.data;
  if (!vehicleId || !occupantId) {
    res.status(400).json({ error: "vehicleId and occupantId are required" });
    return;
  }
  // Idempotent add: a rider is either on the roster or not. Re-adding an
  // existing (vehicle, occupant) pair returns the existing row rather than
  // erroring, so the UI's multi-select can POST freely.
  const existing = await db
    .select()
    .from(vehicleRidersTable)
    .where(
      and(
        eq(vehicleRidersTable.vehicleId, vehicleId),
        eq(vehicleRidersTable.occupantId, occupantId),
      ),
    )
    .limit(1);
  if (existing.length > 0) {
    res.status(200).json(existing[0]);
    return;
  }
  const [row] = await db
    .insert(vehicleRidersTable)
    .values({ id: randomUUID(), vehicleId, occupantId })
    .returning();
  res.status(201).json(row);
});

router.delete("/vehicle-riders/:id", async (req, res): Promise<void> => {
  const params = DeleteVehicleRiderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await db
    .delete(vehicleRidersTable)
    .where(eq(vehicleRidersTable.id, params.data.id));
  res.sendStatus(204);
});

// ---------------------------------------------------------------------------
// Daily ride overrides (exceptions to the static roster)
// ---------------------------------------------------------------------------

router.get("/vehicle-ride-overrides", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(vehicleRideOverridesTable)
    .orderBy(vehicleRideOverridesTable.id);
  res.json(ListVehicleRideOverridesResponse.parse(rows));
});

router.post("/vehicle-ride-overrides", async (req, res): Promise<void> => {
  const body = CreateVehicleRideOverrideBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const { vehicleId, occupantId, date, action } = body.data;
  const note = body.data.note ?? "";
  if (!vehicleId || !occupantId || !date) {
    res
      .status(400)
      .json({ error: "vehicleId, occupantId and date are required" });
    return;
  }
  // Upsert on the unique (vehicle, occupant, date) key so flipping an
  // exception (add <-> remove) for the same day updates in place instead
  // of stacking duplicate rows.
  const existing = await db
    .select()
    .from(vehicleRideOverridesTable)
    .where(
      and(
        eq(vehicleRideOverridesTable.vehicleId, vehicleId),
        eq(vehicleRideOverridesTable.occupantId, occupantId),
        eq(vehicleRideOverridesTable.date, date),
      ),
    )
    .limit(1);
  if (existing.length > 0) {
    const [row] = await db
      .update(vehicleRideOverridesTable)
      .set({ action, note })
      .where(eq(vehicleRideOverridesTable.id, existing[0].id))
      .returning();
    res.status(200).json(row);
    return;
  }
  const [row] = await db
    .insert(vehicleRideOverridesTable)
    .values({ id: randomUUID(), vehicleId, occupantId, date, action, note })
    .returning();
  res.status(201).json(row);
});

router.delete(
  "/vehicle-ride-overrides/:id",
  async (req, res): Promise<void> => {
    const params = DeleteVehicleRideOverrideParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    await db
      .delete(vehicleRideOverridesTable)
      .where(eq(vehicleRideOverridesTable.id, params.data.id));
    res.sendStatus(204);
  },
);

export default router;
