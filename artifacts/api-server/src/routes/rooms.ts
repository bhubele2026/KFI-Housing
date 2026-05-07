import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, roomsTable, bedsTable } from "@workspace/db";
import {
  ListRoomsResponse,
  ListRoomsResponseItem,
  CreateRoomBody,
  UpdateRoomParams,
  UpdateRoomBody,
  UpdateRoomResponse,
  DeleteRoomParams,
} from "@workspace/api-zod";
import { normalizeRoomRow } from "../lib/db-row-normalizers";

const router: IRouter = Router();

router.get("/rooms", async (_req, res): Promise<void> => {
  const rows = await db.select().from(roomsTable).orderBy(roomsTable.id);
  // Same boundary defence as the other GET routes (Task #416): pipe
  // each row through the room normalizer before the per-row safeParse
  // so any future enum / date columns added to the room shape get the
  // legacy-row coercion automatically.
  const out: unknown[] = [];
  for (const raw of rows) {
    const row = normalizeRoomRow(raw);
    const result = ListRoomsResponseItem.safeParse(row);
    if (result.success) {
      out.push(result.data);
    } else {
      console.warn(
        `[rooms] Passing through malformed row ${(row as Record<string, unknown>).id ?? "??"} for client-side handling:`,
        result.error.issues,
      );
      out.push(row);
    }
  }
  res.json(out);
});

router.post("/rooms", async (req, res): Promise<void> => {
  const body = CreateRoomBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [row] = await db.insert(roomsTable).values(normalizeRoomRow(body.data)).returning();
  res.status(201).json(UpdateRoomResponse.parse(row));
});

router.patch("/rooms/:id", async (req, res): Promise<void> => {
  const params = UpdateRoomParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = UpdateRoomBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [row] = await db
    .update(roomsTable)
    .set(normalizeRoomRow(body.data))
    .where(eq(roomsTable.id, params.data.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  res.json(UpdateRoomResponse.parse(row));
});

router.delete("/rooms/:id", async (req, res): Promise<void> => {
  const params = DeleteRoomParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const linked = await db
    .select({ id: bedsTable.id })
    .from(bedsTable)
    .where(eq(bedsTable.roomId, params.data.id))
    .limit(1);
  if (linked.length > 0) {
    res
      .status(409)
      .json({ error: "Cannot delete a room that still has beds." });
    return;
  }
  await db.delete(roomsTable).where(eq(roomsTable.id, params.data.id));
  res.sendStatus(204);
});

export default router;
