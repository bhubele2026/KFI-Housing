import { Router, type IRouter } from "express";
import { gte, desc, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { activityLogTable } from "@workspace/db/schema";

const router: IRouter = Router();

function parseDays(raw: unknown): number {
  const n = typeof raw === "string" ? parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n) || n <= 0) return 21;
  return Math.min(n, 365);
}

function sinceDate(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

// Recent activity entries (most recent first), limited to the last N days.
router.get("/activity", async (req, res) => {
  const days = parseDays(req.query.days);
  const rawLimit =
    typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : NaN;
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), 500)
    : 200;

  const rows = await db
    .select()
    .from(activityLogTable)
    .where(gte(activityLogTable.createdAt, sinceDate(days)))
    .orderBy(desc(activityLogTable.createdAt))
    .limit(limit);

  res.json(
    rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      userEmail: r.userEmail,
      userName: r.userName,
      method: r.method,
      path: r.path,
      action: r.action,
      createdAt: r.createdAt,
    })),
  );
});

// Per-user rollup over the last N days: how many actions each person took and
// when they were last active. Answers "who has used the app recently?".
router.get("/activity/summary", async (req, res) => {
  const days = parseDays(req.query.days);

  const rows = (await db
    .select({
      userId: activityLogTable.userId,
      userEmail: activityLogTable.userEmail,
      userName: activityLogTable.userName,
      actionCount: sql<number>`count(*)::int`,
      lastActiveAt: sql<string>`max(${activityLogTable.createdAt})`,
    })
    .from(activityLogTable)
    .where(gte(activityLogTable.createdAt, sinceDate(days)))
    .groupBy(
      activityLogTable.userId,
      activityLogTable.userEmail,
      activityLogTable.userName,
    )
    .orderBy(desc(sql`max(${activityLogTable.createdAt})`))) as Array<{
    userId: string;
    userEmail: string;
    userName: string;
    actionCount: number;
    lastActiveAt: string;
  }>;

  res.json({
    days,
    activeUsers: rows.length,
    users: rows,
  });
});

export default router;
