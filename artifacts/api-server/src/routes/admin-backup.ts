import { Router, type IRouter, type Request, type Response } from "express";
import { listBackups, restoreBackupSnapshot } from "../lib/backup";
import { isProductionResetBlocked } from "./reset";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function headerString(req: Request, name: string): string | undefined {
  const v = req.header(name);
  return typeof v === "string" ? v : undefined;
}

/**
 * Admin backup endpoints (Task #640). Both endpoints reuse the same
 * `x-reset-confirm` / `RESET_CONFIRM_TOKEN` gate as the reset routes,
 * so a single rotating secret controls every destructive admin path.
 *
 * - GET  /api/admin/backup/list     → list recent snapshots (size + timestamp)
 * - POST /api/admin/backup/restore  → restore a snapshot id; with
 *                                     `{ dryRun: true }` only reports
 *                                     bytes/rows and never mutates the DB.
 *
 * Dev callers can hit these unrestricted, just like `/api/reset`.
 */
function guard(req: Request, res: Response): boolean {
  const decision = isProductionResetBlocked(
    process.env,
    headerString(req, "x-reset-confirm"),
  );
  if (!decision.allowed) {
    res.status(403).json({ error: decision.reason });
    return false;
  }
  return true;
}

router.get("/admin/backup/list", async (req, res): Promise<void> => {
  if (!guard(req, res)) return;
  try {
    const snapshots = await listBackups();
    res.json({ snapshots });
  } catch (err) {
    logger.error({ err }, "Failed to list backup snapshots");
    res
      .status(500)
      .json({ error: "Failed to list backup snapshots — see server logs." });
  }
});

router.post("/admin/backup/restore", async (req, res): Promise<void> => {
  if (!guard(req, res)) return;
  const body = (req.body ?? {}) as { id?: unknown; dryRun?: unknown };
  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (id === "") {
    res.status(400).json({ error: "Missing 'id' (snapshot object name)." });
    return;
  }
  const dryRun = body.dryRun === true;
  try {
    const report = await restoreBackupSnapshot({ id, dryRun });
    res.json(report);
  } catch (err) {
    logger.error({ err, id, dryRun }, "Backup restore failed");
    res.status(500).json({
      error:
        err instanceof Error
          ? `Restore failed: ${err.message}`
          : "Restore failed: unknown error",
    });
  }
});

export default router;
