import { Router, type IRouter, type Request } from "express";
import { and, desc, eq, gt } from "drizzle-orm";
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
 * Task #683 — list the current operator's non-expired exports so the
 * assistant panel can show a "Recent exports" tray. If an operator
 * scrolls away or refreshes mid-generation, the inline chip is hard to
 * find again — but the file still lives on the server for 24h. This
 * route gives the panel a stable way to re-surface those downloads
 * without re-running the export tool.
 *
 * Expired rows are filtered out server-side so the client never has to
 * second-guess the 24h TTL; the existing hourly cleanup scheduler
 * permanently removes them shortly after they expire.
 */
router.get("/assistant/exports", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  const now = new Date();
  const rows = await db
    .select({
      id: assistantExportsTable.id,
      filename: assistantExportsTable.filename,
      format: assistantExportsTable.format,
      rowCount: assistantExportsTable.rowCount,
      sizeBytes: assistantExportsTable.sizeBytes,
      createdAt: assistantExportsTable.createdAt,
      expiresAt: assistantExportsTable.expiresAt,
    })
    .from(assistantExportsTable)
    .where(
      and(
        eq(assistantExportsTable.userId, userId),
        gt(assistantExportsTable.expiresAt, now),
      ),
    )
    .orderBy(desc(assistantExportsTable.createdAt));
  res.json({
    exports: rows.map((r) => ({
      id: r.id,
      filename: r.filename,
      format: r.format,
      rowCount: r.rowCount,
      sizeBytes: r.sizeBytes,
      createdAt: r.createdAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
      downloadUrl: `/api/assistant/exports/${r.id}/download`,
    })),
  });
});

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
