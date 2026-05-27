import { Router, type IRouter, type Request } from "express";
import { and, eq } from "drizzle-orm";
import { db, assistantExportsTable } from "@workspace/db";

/**
 * Local copy of the assistant route's `getUserId` helper. We mirror
 * the same anon fallback so a request that somehow bypassed
 * `requireAuth` (e.g. a test) still resolves to a stable string the
 * ownership check can compare against — never a crash.
 */
function getUserId(req: Request): string {
  const auth = (req as any).auth;
  return auth?.userId ?? "anon";
}

const router: IRouter = Router();

/**
 * Stream an assistant-generated export file back to the operator who
 * created it. 404 for a missing row OR a row owned by a different
 * user (avoids leaking the existence of someone else's exportId).
 * 410 once `expiresAt` is past — the hourly cleanup scheduler will
 * delete the row shortly after, but this gives the caller a friendly
 * error in the window before deletion runs.
 */
router.get(
  "/assistant/exports/:id/download",
  async (req, res): Promise<void> => {
    const userId = getUserId(req);
    const [row] = await db
      .select()
      .from(assistantExportsTable)
      .where(
        and(
          eq(assistantExportsTable.id, req.params.id),
          eq(assistantExportsTable.userId, userId),
        ),
      );
    if (!row) {
      res.status(404).json({ error: "Export not found" });
      return;
    }
    if (row.expiresAt.getTime() <= Date.now()) {
      res.status(410).json({ error: "Export expired — please regenerate." });
      return;
    }
    const content = Buffer.isBuffer(row.content)
      ? row.content
      : Buffer.from(row.content as unknown as Uint8Array);
    res.setHeader("Content-Type", row.mime || "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${row.filename.replace(/"/g, "")}"`,
    );
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Length", String(content.length));
    res.end(content);
  },
);

export default router;
