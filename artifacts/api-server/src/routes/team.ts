import { Router, type IRouter } from "express";
import { eq, and, ne, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { appUsersTable, appInvitesTable } from "@workspace/db/schema";
import {
  requireAdmin,
  TEAM_AUTH_LOCK_KEY,
  type AuthedRequest,
} from "../middlewares/requireAuth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_ROLES = new Set(["admin", "member"]);

function makeId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

router.get("/team/me", async (req: AuthedRequest, res) => {
  if (!req.appUser) {
    res.status(401).json({ error: "Not signed in" });
    return;
  }
  res.json(req.appUser);
});

router.get("/team/members", async (_req, res) => {
  const rows = await db
    .select()
    .from(appUsersTable)
    .orderBy(appUsersTable.createdAt);
  res.json(
    rows.map((r) => ({
      id: r.id,
      email: r.email,
      name: r.name,
      role: r.role,
      createdAt: r.createdAt,
      lastSeenAt: r.lastSeenAt,
    })),
  );
});

router.get("/team/invites", async (_req, res) => {
  const rows = await db
    .select()
    .from(appInvitesTable)
    .orderBy(appInvitesTable.createdAt);
  res.json(rows);
});

router.post("/team/invites", requireAdmin, async (req: AuthedRequest, res) => {
  const rawEmail =
    typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const role =
    typeof req.body?.role === "string" && ALLOWED_ROLES.has(req.body.role)
      ? req.body.role
      : "member";
  if (!EMAIL_RE.test(rawEmail)) {
    res.status(400).json({ error: "A valid email is required." });
    return;
  }
  // Already a member?
  const existing = await db
    .select()
    .from(appUsersTable)
    .where(eq(appUsersTable.email, rawEmail))
    .limit(1);
  if (existing.length > 0) {
    res
      .status(409)
      .json({ error: `${rawEmail} is already on your team.` });
    return;
  }
  // Already invited?
  const dup = await db
    .select()
    .from(appInvitesTable)
    .where(eq(appInvitesTable.email, rawEmail))
    .limit(1);
  if (dup.length > 0) {
    res.status(409).json({ error: `${rawEmail} is already invited.` });
    return;
  }
  const id = makeId("inv");
  await db.insert(appInvitesTable).values({
    id,
    email: rawEmail,
    role,
    invitedByUserId: req.appUser?.id ?? "",
  });
  logger.info(
    { invitedBy: req.appUser?.id, email: rawEmail, role },
    "Team invite created",
  );
  res.status(201).json({ id, email: rawEmail, role });
});

router.delete(
  "/team/invites/:id",
  requireAdmin,
  async (req: AuthedRequest, res) => {
    await db.delete(appInvitesTable).where(eq(appInvitesTable.id, req.params.id));
    res.json({ status: "ok" });
  },
);

router.delete(
  "/team/members/:id",
  requireAdmin,
  async (req: AuthedRequest, res) => {
    if (req.params.id === req.appUser?.id) {
      res.status(400).json({ error: "You can't remove your own account." });
      return;
    }
    // Wrap the read-then-delete sequence (exists? + last-admin?) in a
    // transaction guarded by the same advisory lock requireAuth uses,
    // so two concurrent admin-deletions can't both pass the
    // "more-than-one-admin" check and leave the workspace with zero
    // admins.
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${TEAM_AUTH_LOCK_KEY})`);
      const target = await tx
        .select()
        .from(appUsersTable)
        .where(eq(appUsersTable.id, req.params.id))
        .limit(1);
      if (target.length === 0) {
        return { status: 404 as const, body: { error: "Member not found." } };
      }
      if (target[0].role === "admin") {
        const [{ n }] = (await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(appUsersTable)
          .where(
            and(
              eq(appUsersTable.role, "admin"),
              ne(appUsersTable.id, req.params.id),
            ),
          )) as Array<{ n: number }>;
        if (n === 0) {
          return {
            status: 400 as const,
            body: { error: "Can't remove the last admin." },
          };
        }
      }
      await tx.delete(appUsersTable).where(eq(appUsersTable.id, req.params.id));
      return { status: 200 as const, body: { status: "ok" } };
    });
    res.status(result.status).json(result.body);
  },
);

export default router;
