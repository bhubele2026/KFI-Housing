import { Router, type IRouter } from "express";
import { resetToSampleData, wipeAllOnly } from "../lib/seed";

const router: IRouter = Router();

router.post("/reset", async (_req, res): Promise<void> => {
  await resetToSampleData();
  res.json({ status: "ok" });
});

// Wipe-only entry point (Task #486). Clears every business table
// without reseeding, and persists a marker so the boot-time
// auto-seeders skip on subsequent restarts. Mounted alongside the
// existing `/reset` (which wipes AND reseeds) so tests that rely on
// the old behavior keep working unchanged.
router.post("/reset/wipe", async (_req, res): Promise<void> => {
  await wipeAllOnly();
  res.json({ status: "ok" });
});

export default router;
