import type { Request, Response, NextFunction } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { eq, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { appUsersTable, appInvitesTable } from "@workspace/db/schema";
import { logger } from "../lib/logger";

/**
 * Postgres advisory-lock key shared by every team-mutating path
 * (first-login bootstrap, invite redemption, last-admin removal).
 * Serializes those rare flows so the read-then-write sequences below
 * cannot race two callers into both becoming bootstrap admins or both
 * deleting the last admin. Cheap because team mutations are rare.
 */
export const TEAM_AUTH_LOCK_KEY = 7424123001;

export interface AuthedRequest extends Request {
  appUser?: {
    id: string;
    clerkUserId: string;
    email: string;
    name: string;
    role: string;
  };
}

function makeUserId(): string {
  return `usr-${Math.random().toString(36).slice(2, 10)}`;
}

const PUBLIC_PREFIXES = ["/healthz", "/__clerk", "/config"];

function isPublicPath(path: string): boolean {
  return PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

/**
 * Express middleware that:
 *   1. Reads the Clerk session.
 *   2. Looks up (or just-in-time provisions) the matching `app_users` row.
 *   3. Auto-promotes the very first signed-in user to admin (bootstrap).
 *   4. Auto-redeems a matching invite if one exists for the email.
 *   5. Rejects everyone else with 403 + a friendly "ask an admin" body.
 *
 * Mounts under `/api`, so `req.path` here is the part after `/api`.
 */
export async function requireAuth(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (isPublicPath(req.path)) {
    next();
    return;
  }

  const auth = getAuth(req);
  const clerkUserId = auth?.userId;
  if (!clerkUserId) {
    res.status(401).json({ error: "Sign in required" });
    return;
  }

  try {
    // Existing member? Update last-seen and continue.
    const existing = await db
      .select()
      .from(appUsersTable)
      .where(eq(appUsersTable.clerkUserId, clerkUserId))
      .limit(1);

    if (existing.length > 0) {
      const u = existing[0];
      void db
        .update(appUsersTable)
        .set({ lastSeenAt: new Date() })
        .where(eq(appUsersTable.id, u.id))
        .catch((err) => logger.warn({ err }, "lastSeenAt update failed"));
      req.appUser = {
        id: u.id,
        clerkUserId: u.clerkUserId,
        email: u.email,
        name: u.name,
        role: u.role,
      };
      next();
      return;
    }

    // New Clerk user — pull their email + name from Clerk and decide
    // whether to admit them.
    const clerkUser = await clerkClient.users.getUser(clerkUserId);
    const email = (
      clerkUser.primaryEmailAddress?.emailAddress ??
      clerkUser.emailAddresses?.[0]?.emailAddress ??
      ""
    )
      .trim()
      .toLowerCase();
    if (!email) {
      res.status(403).json({ error: "Your Clerk account has no email address." });
      return;
    }
    const name =
      [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") ||
      clerkUser.username ||
      email;

    // Bootstrap / invite redemption / insert is wrapped in a single
    // transaction guarded by a Postgres advisory lock so that two
    // concurrent first-time requests cannot both become bootstrap
    // admins or both consume the same invite. The transaction also
    // tolerates the case where another request raced us between the
    // initial existence check above and the lock acquisition (it
    // re-checks for the row inside the lock and short-circuits).
    const provisioned = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${TEAM_AUTH_LOCK_KEY})`);

      const recheck = await tx
        .select()
        .from(appUsersTable)
        .where(eq(appUsersTable.clerkUserId, clerkUserId))
        .limit(1);
      if (recheck.length > 0) {
        const u = recheck[0];
        return {
          kind: "existing" as const,
          user: {
            id: u.id,
            clerkUserId: u.clerkUserId,
            email: u.email,
            name: u.name,
            role: u.role,
          },
        };
      }

      const [{ n }] = (await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(appUsersTable)) as Array<{ n: number }>;

      const bootstrapEmail = (process.env.ADMIN_BOOTSTRAP_EMAIL ?? "")
        .trim()
        .toLowerCase();
      let role = "member";
      let admittedViaInvite = false;
      let bootstrapAdmin = false;
      if (bootstrapEmail && email === bootstrapEmail) {
        // The configured owner email is always admitted as admin,
        // regardless of who signed in first.
        role = "admin";
        bootstrapAdmin = true;
      } else if (n === 0 && !bootstrapEmail) {
        // Legacy fallback: if no bootstrap email is configured, the
        // first-ever signer becomes admin.
        role = "admin";
        bootstrapAdmin = true;
      } else {
        const invite = await tx
          .select()
          .from(appInvitesTable)
          .where(eq(appInvitesTable.email, email))
          .limit(1);
        if (invite.length === 0) {
          return { kind: "denied" as const };
        }
        role = invite[0].role || "member";
        admittedViaInvite = true;
      }

      const id = makeUserId();
      await tx.insert(appUsersTable).values({
        id,
        clerkUserId,
        email,
        name,
        role,
        lastSeenAt: new Date(),
      });
      if (admittedViaInvite) {
        await tx
          .delete(appInvitesTable)
          .where(eq(appInvitesTable.email, email));
      }
      return {
        kind: "provisioned" as const,
        viaInvite: admittedViaInvite,
        bootstrap: bootstrapAdmin,
        user: { id, clerkUserId, email, name, role },
      };
    });

    if (provisioned.kind === "denied") {
      res.status(403).json({
        error:
          "This account hasn't been invited yet. Ask an admin on your team to invite " +
          email +
          ".",
      });
      return;
    }
    if (provisioned.kind === "provisioned") {
      logger.info(
        {
          userId: provisioned.user.id,
          email,
          role: provisioned.user.role,
          viaInvite: provisioned.viaInvite,
          bootstrap: provisioned.bootstrap,
        },
        "Provisioned new app user",
      );
    }
    req.appUser = provisioned.user;
    next();
  } catch (err) {
    logger.error({ err }, "requireAuth failed");
    res.status(500).json({ error: "Auth check failed" });
  }
}

export function requireAdmin(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
): void {
  if (req.appUser?.role !== "admin") {
    res.status(403).json({ error: "Admin only" });
    return;
  }
  next();
}
