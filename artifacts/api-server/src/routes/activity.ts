import { Router, type IRouter } from "express";
import { gte, desc, sql, and, ne } from "drizzle-orm";
import { db } from "@workspace/db";
import { activityLogTable, appUsersTable } from "@workspace/db/schema";

const router: IRouter = Router();

function parseDays(raw: unknown): number {
  const n = typeof raw === "string" ? parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n) || n <= 0) return 21;
  return Math.min(n, 365);
}

function sinceDate(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

// Latest of a Date (app_users.last_seen_at) and a timestamp string
// (max audit createdAt), returned as an ISO string or null when neither exists.
function latestIso(
  a: Date | null,
  b: string | null | undefined,
): string | null {
  const ta = a ? a.getTime() : Number.NEGATIVE_INFINITY;
  const tb = b ? new Date(b).getTime() : Number.NEGATIVE_INFINITY;
  if (ta === Number.NEGATIVE_INFINITY && tb === Number.NEGATIVE_INFINITY) {
    return null;
  }
  return new Date(Math.max(ta, tb)).toISOString();
}

// Recent CHANGE entries (most recent first), limited to the last N days.
// Read/"Viewed" requests (GET) are excluded — operators only want to see
// what actually changed, not every page they opened.
router.get("/activity", async (req, res) => {
  const days = parseDays(req.query.days);
  const rawLimit =
    typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : NaN;
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), 2000)
    : 1000;

  const rows = await db
    .select()
    .from(activityLogTable)
    .where(
      and(
        gte(activityLogTable.createdAt, sinceDate(days)),
        ne(activityLogTable.method, "GET"),
      ),
    )
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

// Per-user rollup answering "who has used the app, and when were they last
// active?". We start from every known account (app_users) so the list covers
// people who used the app BEFORE the audit log existed — their last_seen_at is
// tracked on every request and predates this feature. We then layer on the
// audit log's per-user action counts + most recent action within the window.
router.get("/activity/summary", async (req, res) => {
  const days = parseDays(req.query.days);
  const since = sinceDate(days);

  const users = await db
    .select({
      id: appUsersTable.id,
      email: appUsersTable.email,
      name: appUsersTable.name,
      role: appUsersTable.role,
      lastSeenAt: appUsersTable.lastSeenAt,
      createdAt: appUsersTable.createdAt,
    })
    .from(appUsersTable);

  const counts = (await db
    .select({
      userId: activityLogTable.userId,
      actionCount: sql<number>`count(*)::int`,
      lastActionAt: sql<string>`max(${activityLogTable.createdAt})`,
    })
    .from(activityLogTable)
    .where(gte(activityLogTable.createdAt, since))
    .groupBy(activityLogTable.userId)) as Array<{
    userId: string;
    actionCount: number;
    lastActionAt: string;
  }>;

  const byUser = new Map(counts.map((c) => [c.userId, c]));
  const sinceMs = since.getTime();

  const merged = users.map((u) => {
    const c = byUser.get(u.id);
    const lastActiveAt = latestIso(u.lastSeenAt, c?.lastActionAt);
    return {
      userId: u.id,
      userEmail: u.email,
      userName: u.name,
      role: u.role,
      actionCount: c?.actionCount ?? 0,
      lastActiveAt,
      activeInWindow:
        lastActiveAt !== null && new Date(lastActiveAt).getTime() >= sinceMs,
      joinedAt: u.createdAt,
    };
  });

  merged.sort((a, b) => {
    const ta = a.lastActiveAt ? new Date(a.lastActiveAt).getTime() : 0;
    const tb = b.lastActiveAt ? new Date(b.lastActiveAt).getTime() : 0;
    return tb - ta;
  });

  res.json({
    days,
    activeUsers: merged.filter((m) => m.activeInWindow).length,
    totalUsers: merged.length,
    users: merged,
  });
});

export default router;
