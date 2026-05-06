import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, occupantsTable, bedsTable } from "@workspace/db";
import {
  ListOccupantsResponse,
  CreateOccupantBody,
  UpdateOccupantParams,
  UpdateOccupantBody,
  UpdateOccupantResponse,
  DeleteOccupantParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/occupants", async (_req, res): Promise<void> => {
  const rows = await db.select().from(occupantsTable).orderBy(occupantsTable.id);
  res.json(ListOccupantsResponse.parse(rows));
});

// Strict YYYY-MM-DD pattern. The shared `OptionalLeaseDate` schema
// also accepts "" so legacy import payloads keep round-tripping, but
// fresh occupants created via this endpoint must carry a real
// move-in date (Task #259 — "New occupants going forward require a
// move-in date at creation time").
const STRICT_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

router.post("/occupants", async (req, res): Promise<void> => {
  const body = CreateOccupantBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  if (!STRICT_DATE_RE.test(body.data.moveInDate)) {
    res.status(400).json({
      error:
        "moveInDate is required when creating an occupant and must be in YYYY-MM-DD format.",
    });
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

router.delete("/occupants/:id", async (req, res): Promise<void> => {
  const params = DeleteOccupantParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  // Mirror the inverse cleanup the bed delete pathway implies: any bed
  // pointing at this occupant gets its occupantId cleared so we don't
  // leave dangling references behind.
  await db
    .update(bedsTable)
    .set({ occupantId: null })
    .where(eq(bedsTable.occupantId, params.data.id));
  await db.delete(occupantsTable).where(eq(occupantsTable.id, params.data.id));
  res.sendStatus(204);
});

export default router;
