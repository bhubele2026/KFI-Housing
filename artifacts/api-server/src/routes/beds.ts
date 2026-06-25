import { Router, type IRouter } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, bedsTable } from "@workspace/db";
import {
  ListBedsResponse,
  CreateBedBody,
  UpdateBedParams,
  UpdateBedBody,
  UpdateBedResponse,
  DeleteBedParams,
} from "@workspace/api-zod";
import { normalizeBedRow } from "../lib/db-row-normalizers";

const router: IRouter = Router();

// Optional server-side filter (perf pass). When `propertyId` is omitted the
// list is identical to before; when present it pushes an indexed WHERE down to
// Postgres instead of shipping every bed to the client. `.passthrough()` so
// unrelated query params (e.g. a cache-buster) don't 400.
const ListBedsQuery = z
  .object({ propertyId: z.string().min(1).optional() })
  .passthrough();

router.get("/beds", async (req, res): Promise<void> => {
  const q = ListBedsQuery.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  const { propertyId } = q.data;
  const base = db.select().from(bedsTable);
  // No-filter branch is byte-for-byte the prior query so existing callers /
  // tests are unaffected; the filter branch adds the indexed WHERE.
  const rows = propertyId
    ? await base.where(eq(bedsTable.propertyId, propertyId)).orderBy(bedsTable.id)
    : await base.orderBy(bedsTable.id);
  // Boundary normalize on the way out (Task #416) so a legacy bed
  // row whose `status` is off-list (e.g. "Pending") doesn't 500 the
  // entire list endpoint via the response schema's enum check. The
  // normaliser also backfills `cleaningStatus` (task #500) so legacy
  // rows missing that column still satisfy the response schema.
  const normalized = rows.map((r) => normalizeBedRow(r));
  res.json(ListBedsResponse.parse(normalized));
});

router.post("/beds", async (req, res): Promise<void> => {
  const body = CreateBedBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [row] = await db.insert(bedsTable).values(normalizeBedRow(body.data)).returning();
  res.status(201).json(UpdateBedResponse.parse(normalizeBedRow(row)));
});

router.patch("/beds/:id", async (req, res): Promise<void> => {
  const params = UpdateBedParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = UpdateBedBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  // Cleaning workflow guard (task #500). Two cases the route enforces
  // beyond the normaliser:
  //   1. Reject any patch that tries to flip the bed to Occupied (or
  //      attach a new occupantId) while the bed is not yet "ready" —
  //      operators must finish the cleaning workflow first.
  //   2. When a patch moves the occupant off the bed (status→Vacant
  //      and/or occupantId→null), default the cleaningStatus to
  //      "needs_cleaning" so the turnover task lands in the operator's
  //      queue automatically. The caller can override by sending a
  //      cleaningStatus explicitly.
  const updates = { ...body.data } as Record<string, unknown>;
  const wantsOccupy =
    updates.status === "Occupied" ||
    (typeof updates.occupantId === "string" && updates.occupantId.length > 0);
  if (wantsOccupy) {
    const [existing] = await db
      .select({
        cleaningStatus: bedsTable.cleaningStatus,
        status: bedsTable.status,
        occupantId: bedsTable.occupantId,
      })
      .from(bedsTable)
      .where(eq(bedsTable.id, params.data.id));
    if (!existing) {
      res.status(404).json({ error: "Bed not found" });
      return;
    }
    // A "new placement" means we're attaching an occupant the bed
    // doesn't already hold. A no-op self-PATCH (same occupantId, already
    // Occupied) doesn't count and is allowed regardless of cleaning
    // status — useful for housekeeping flows that re-PATCH a bed for
    // unrelated reasons. (task #500)
    const incomingOccupant =
      typeof updates.occupantId === "string" && updates.occupantId.length > 0
        ? updates.occupantId
        : null;
    const isNoOp =
      existing.status === "Occupied" &&
      incomingOccupant !== null &&
      existing.occupantId === incomingOccupant;
    if (!isNoOp) {
      // Reject placing an occupant on top of someone else.
      if (
        existing.status === "Occupied" &&
        incomingOccupant !== null &&
        existing.occupantId !== incomingOccupant
      ) {
        res.status(409).json({
          error:
            "Bed is currently occupied by another occupant — vacate it first.",
        });
        return;
      }
      // Reject if the bed is not in the ready state (covers
      // needs_cleaning / in_progress / occupied-but-empty edge cases).
      if (existing.cleaningStatus !== "ready") {
        res.status(409).json({
          error:
            "Bed is not ready for a new occupant — finish the cleaning workflow first.",
          cleaningStatus: existing.cleaningStatus,
        });
        return;
      }
    }
  }
  const wantsVacate =
    updates.status === "Vacant" ||
    (Object.prototype.hasOwnProperty.call(updates, "occupantId") &&
      updates.occupantId === null);
  if (wantsVacate && !Object.prototype.hasOwnProperty.call(updates, "cleaningStatus")) {
    updates.cleaningStatus = "needs_cleaning";
  }
  const [row] = await db
    .update(bedsTable)
    .set(normalizeBedRow(updates))
    .where(eq(bedsTable.id, params.data.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Bed not found" });
    return;
  }
  res.json(UpdateBedResponse.parse(normalizeBedRow(row)));
});

router.delete("/beds/:id", async (req, res): Promise<void> => {
  const params = DeleteBedParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await db.delete(bedsTable).where(eq(bedsTable.id, params.data.id));
  res.sendStatus(204);
});

export default router;
