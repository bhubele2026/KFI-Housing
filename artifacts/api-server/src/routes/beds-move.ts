import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  bedsTable,
  occupantsTable,
  propertiesTable,
} from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Overhaul §7 — bed moves (drag-and-drop / click-to-move) + open-bed suggestions.
// Direct-fetch (not in openapi), matching the zenople/finance-period precedent.
// ---------------------------------------------------------------------------

interface MoveInput {
  occupantId: string;
  fromBedId?: string;
  toBedId: string;
}

/** Core transactional move. Throws on a bad/occupied/not-ready target. */
async function applyMove(
  tx: typeof db,
  m: MoveInput,
): Promise<void> {
  const occId = (m.occupantId ?? "").trim();
  const toBedId = (m.toBedId ?? "").trim();
  if (!occId || !toBedId) throw new Error("occupantId and toBedId are required");

  const [toBed] = await tx
    .select({
      id: bedsTable.id,
      propertyId: bedsTable.propertyId,
      status: bedsTable.status,
      cleaningStatus: bedsTable.cleaningStatus,
      occupantId: bedsTable.occupantId,
    })
    .from(bedsTable)
    .where(eq(bedsTable.id, toBedId));
  if (!toBed) throw new Error(`target bed ${toBedId} does not exist`);
  if (toBed.id !== (m.fromBedId ?? "").trim()) {
    if (toBed.status === "Occupied" && toBed.occupantId) {
      throw new Error("target bed is already occupied — vacate it first");
    }
    if (toBed.cleaningStatus !== "ready") {
      throw new Error("target bed is not ready (finish cleaning first)");
    }
  }

  // Seat the occupant in the target bed.
  await tx
    .update(bedsTable)
    .set({ occupantId: occId, status: "Occupied", cleaningStatus: "occupied" })
    .where(eq(bedsTable.id, toBedId));

  // Free the source bed (if a different one) → vacant + needs cleaning.
  const fromBedId = (m.fromBedId ?? "").trim();
  if (fromBedId && fromBedId !== toBedId) {
    await tx
      .update(bedsTable)
      .set({ occupantId: "", status: "Vacant", cleaningStatus: "needs_cleaning" })
      .where(eq(bedsTable.id, fromBedId));
  }

  // Point the occupant at the new bed (+ property, in case it's cross-property).
  await tx
    .update(occupantsTable)
    .set({ bedId: toBedId, propertyId: toBed.propertyId })
    .where(eq(occupantsTable.id, occId));
}

// A move failure is a 400 (bad/missing input, unknown bed) vs a genuine 409
// conflict (target bed already occupied or not yet cleaned). Reserving 409 for
// real conflicts makes "bad payload" distinguishable from "race lost".
function moveErrorStatus(message: string): 400 | 409 {
  return /required|does not exist/i.test(message) ? 400 : 409;
}

// POST /api/beds/move { occupantId, fromBedId?, toBedId, chargeMode? }
router.post("/beds/move", async (req, res): Promise<void> => {
  try {
    const body = (req.body ?? {}) as MoveInput;
    await db.transaction(async (tx) => {
      await applyMove(tx as unknown as typeof db, body);
    });
    res.json({ ok: true, occupantId: body.occupantId, toBedId: body.toBedId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(moveErrorStatus(message)).json({ error: message });
  }
});

// POST /api/beds/move-batch { moves: [...] } — all-or-nothing.
router.post("/beds/move-batch", async (req, res): Promise<void> => {
  try {
    const moves = ((req.body ?? {}) as { moves?: MoveInput[] }).moves ?? [];
    if (!Array.isArray(moves) || moves.length === 0) {
      res.status(400).json({ error: "moves array is required" });
      return;
    }
    await db.transaction(async (tx) => {
      for (const m of moves) await applyMove(tx as unknown as typeof db, m);
    });
    res.json({ ok: true, moved: moves.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(moveErrorStatus(message)).json({ error: message });
  }
});

// GET /api/beds/open?occupantId= — open+ready beds ranked by fit, with a "why".
router.get("/beds/open", async (req, res): Promise<void> => {
  try {
    const occupantId = typeof req.query.occupantId === "string" ? req.query.occupantId : "";
    const [occ] = occupantId
      ? await db
          .select({
            company: occupantsTable.company,
            propertyId: occupantsTable.propertyId,
            shift: occupantsTable.shift,
          })
          .from(occupantsTable)
          .where(eq(occupantsTable.id, occupantId))
      : [undefined];

    const beds = await db
      .select({
        id: bedsTable.id,
        propertyId: bedsTable.propertyId,
        roomId: bedsTable.roomId,
        bedNumber: bedsTable.bedNumber,
      })
      .from(bedsTable)
      .where(eq(bedsTable.status, "Vacant"));
    const props = await db
      .select({ id: propertiesTable.id, name: propertiesTable.name, customerId: propertiesTable.customerId })
      .from(propertiesTable);
    const propById = new Map(props.map((p) => [p.id, p]));
    const occProp = occ?.propertyId ? propById.get(occ.propertyId) : undefined;

    const ranked = beds
      .map((b) => {
        const p = propById.get(b.propertyId);
        let score = 0;
        const why: string[] = [];
        if (occ?.propertyId && b.propertyId === occ.propertyId) {
          score += 100;
          why.push("same property");
        } else if (occProp && p && occProp.customerId && p.customerId === occProp.customerId) {
          score += 50;
          why.push("same client");
        }
        return {
          bedId: b.id,
          propertyId: b.propertyId,
          propertyName: p?.name ?? "",
          roomId: b.roomId,
          bedNumber: b.bedNumber,
          score,
          why: why.join(" · ") || "open bed",
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 50);

    res.json({ count: ranked.length, beds: ranked });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ err: message }, "beds/open failed");
    res.status(500).json({ error: message });
  }
});

export default router;
