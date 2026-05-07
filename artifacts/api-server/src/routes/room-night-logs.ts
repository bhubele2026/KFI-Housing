import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, roomNightLogsTable } from "@workspace/db";
import {
  ListRoomNightLogsResponse,
  CreateRoomNightLogBody,
  UpdateRoomNightLogParams,
  UpdateRoomNightLogBody,
  UpdateRoomNightLogResponse,
  DeleteRoomNightLogParams,
} from "@workspace/api-zod";
import { normalizeRoomNightLogRow } from "../lib/db-row-normalizers";

const router: IRouter = Router();

router.get("/room-night-logs", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(roomNightLogsTable)
    .orderBy(roomNightLogsTable.id);
  res.json(ListRoomNightLogsResponse.parse(rows));
});

router.post("/room-night-logs", async (req, res): Promise<void> => {
  const body = CreateRoomNightLogBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [row] = await db
    .insert(roomNightLogsTable)
    .values(normalizeRoomNightLogRow(body.data))
    .returning();
  res.status(201).json(UpdateRoomNightLogResponse.parse(row));
});

router.patch("/room-night-logs/:id", async (req, res): Promise<void> => {
  const params = UpdateRoomNightLogParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = UpdateRoomNightLogBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [row] = await db
    .update(roomNightLogsTable)
    .set(normalizeRoomNightLogRow(body.data))
    .where(eq(roomNightLogsTable.id, params.data.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Room-night log not found" });
    return;
  }
  res.json(UpdateRoomNightLogResponse.parse(row));
});

router.delete("/room-night-logs/:id", async (req, res): Promise<void> => {
  const params = DeleteRoomNightLogParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await db
    .delete(roomNightLogsTable)
    .where(eq(roomNightLogsTable.id, params.data.id));
  res.sendStatus(204);
});

export default router;
