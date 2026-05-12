import { Router, type IRouter } from "express";
import { and, eq, ne } from "drizzle-orm";
import { db, buildingsTable, roomsTable } from "@workspace/db";
import {
  ListBuildingsResponse,
  CreateBuildingBody,
  UpdateBuildingParams,
  UpdateBuildingBody,
  UpdateBuildingResponse,
  DeleteBuildingParams,
} from "@workspace/api-zod";
import { normalizeBuildingRow } from "../lib/db-row-normalizers";

const router: IRouter = Router();

router.get("/buildings", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(buildingsTable)
    .orderBy(buildingsTable.id);
  res.json(ListBuildingsResponse.parse(rows.map((r) => normalizeBuildingRow(r))));
});

router.post("/buildings", async (req, res): Promise<void> => {
  const body = CreateBuildingBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [row] = await db
    .insert(buildingsTable)
    .values(normalizeBuildingRow(body.data))
    .returning();
  res.status(201).json(UpdateBuildingResponse.parse(normalizeBuildingRow(row)));
});

router.patch("/buildings/:id", async (req, res): Promise<void> => {
  const params = UpdateBuildingParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = UpdateBuildingBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [row] = await db
    .update(buildingsTable)
    .set(normalizeBuildingRow(body.data))
    .where(eq(buildingsTable.id, params.data.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Building not found" });
    return;
  }
  res.json(UpdateBuildingResponse.parse(normalizeBuildingRow(row)));
});

router.delete("/buildings/:id", async (req, res): Promise<void> => {
  const params = DeleteBuildingParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  // Look up the target so we know which property it belongs to (for
  // the last-building-on-property guard) and so we can return 404
  // when an unknown id is deleted.
  const [target] = await db
    .select()
    .from(buildingsTable)
    .where(eq(buildingsTable.id, params.data.id));
  if (!target) {
    res.sendStatus(204);
    return;
  }
  // Reject deletes that would leave dangling rooms.
  const linked = await db
    .select({ id: roomsTable.id })
    .from(roomsTable)
    .where(eq(roomsTable.buildingId, params.data.id))
    .limit(1);
  if (linked.length > 0) {
    res
      .status(409)
      .json({ error: "Cannot delete a building that still has rooms." });
    return;
  }
  // Reject deletes that would leave the parent property with zero
  // buildings — every property must keep at least one so existing
  // address-mirror semantics hold.
  const siblings = await db
    .select({ id: buildingsTable.id })
    .from(buildingsTable)
    .where(
      and(
        eq(buildingsTable.propertyId, target.propertyId),
        ne(buildingsTable.id, target.id),
      ),
    )
    .limit(1);
  if (siblings.length === 0) {
    res
      .status(409)
      .json({
        error:
          "Cannot delete the only remaining building on a property.",
      });
    return;
  }
  await db.delete(buildingsTable).where(eq(buildingsTable.id, params.data.id));
  res.sendStatus(204);
});

export default router;
