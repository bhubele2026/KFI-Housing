import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, occupantsTable, bedsTable } from "@workspace/db";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Overhaul §7 — one-tap / drag move-out. Sets the occupant Former + move-out
// date + reason (stops the charge, keeps history — NEVER hard-delete) and frees
// the bed (Vacant + cleaningStatus from bedReady). Direct-fetch.
// ---------------------------------------------------------------------------
router.post("/occupants/:id/move-out", async (req, res): Promise<void> => {
  try {
    const id = (req.params.id ?? "").trim();
    const body = (req.body ?? {}) as { reason?: string; bedReady?: boolean };
    const reason = (body.reason ?? "").trim();
    const today = new Date().toISOString().slice(0, 10);

    const [occ] = await db
      .select({ id: occupantsTable.id, bedId: occupantsTable.bedId })
      .from(occupantsTable)
      .where(eq(occupantsTable.id, id));
    if (!occ) {
      res.status(404).json({ error: `occupant ${id} not found` });
      return;
    }

    await db.transaction(async (tx) => {
      await tx
        .update(occupantsTable)
        .set({
          status: "Former",
          moveOutDate: today,
          moveOutReason: reason,
          bedId: null,
        })
        .where(eq(occupantsTable.id, id));
      if (occ.bedId) {
        await tx
          .update(bedsTable)
          .set({
            occupantId: "",
            status: "Vacant",
            cleaningStatus: body.bedReady ? "ready" : "needs_cleaning",
          })
          .where(eq(bedsTable.id, occ.bedId));
      }
    });

    res.json({ ok: true, occupantId: id, status: "Former", moveOutDate: today, freedBedId: occ.bedId ?? null });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

export default router;
