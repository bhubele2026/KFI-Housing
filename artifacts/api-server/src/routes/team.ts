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

/**
 * Build the plain sign-up URL we email to invitees. Pre-filling
 * `?email=` lets the SignUp component lock the email field so the
 * invitee only chooses a password — and our `requireAuth` JIT
 * invite-redemption (in `app_invites`) admits them with the right
 * role on their first authenticated request.
 *
 * Critically, this URL is NOT a single-use token — corporate email
 * scanners (Defender Safe Links, Mimecast, Proofpoint, etc.) and
 * mobile-mail link previewers can hit it as many times as they want
 * without burning the invite, which Clerk's own ticket-based invite
 * link cannot survive.
 */
function buildInviteUrl(origin: string, email: string): string {
  return `${origin.replace(/\/$/, "")}/sign-up?email=${encodeURIComponent(email)}`;
}

function originFromRequest(req: AuthedRequest): string | null {
  if (typeof req.headers.origin === "string" && req.headers.origin) {
    return req.headers.origin;
  }
  if (typeof req.headers.referer === "string" && req.headers.referer) {
    try {
      return new URL(req.headers.referer).origin;
    } catch {
      return null;
    }
  }
  return null;
}

interface InviteEmailPayload {
  to: string[];
  subject: string;
  text: string;
  html: string;
}

async function sendInviteEmail(payload: InviteEmailPayload): Promise<boolean> {
  const webhookUrl =
    process.env.TEAM_INVITE_WEBHOOK_URL ?? process.env.LEASE_DIGEST_WEBHOOK_URL;
  if (!webhookUrl) {
    logger.warn(
      { to: payload.to },
      "No TEAM_INVITE_WEBHOOK_URL or LEASE_DIGEST_WEBHOOK_URL configured — invite email not sent. Admin can still copy the invite link from team settings.",
    );
    return false;
  }
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      logger.error(
        { status: response.status, to: payload.to },
        "Invite webhook returned non-2xx — admin can still copy the invite link",
      );
      return false;
    }
    return true;
  } catch (err) {
    logger.error(
      { err, to: payload.to },
      "Invite webhook fetch failed — admin can still copy the invite link",
    );
    return false;
  }
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

router.get("/team/invites", async (req: AuthedRequest, res) => {
  const rows = await db
    .select()
    .from(appInvitesTable)
    .orderBy(appInvitesTable.createdAt);
  const origin = originFromRequest(req);
  res.json(
    rows.map((r) => ({
      ...r,
      inviteUrl: origin ? buildInviteUrl(origin, r.email) : null,
    })),
  );
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
  // We deliberately do NOT use Clerk's `createInvitation` ticket
  // emails here. Clerk tickets are single-use, and on the modern
  // internet a long list of services (Microsoft Defender Safe Links,
  // Mimecast, Proofpoint, Gmail's URL scanner, iOS Mail link
  // previews, AV scanners, etc.) silently click email links before
  // the human does — burning the ticket and leaving the recipient
  // stuck on Clerk's "Just a moment…" interstitial forever. Instead
  // we own the invite record (`app_invites`) and email a plain
  // `/sign-up?email=…` link that any number of scanners can hit
  // safely. On first sign-in `requireAuth` redeems the invite row
  // and promotes them to the chosen role.
  const origin = originFromRequest(req);
  const inviteUrl = origin ? buildInviteUrl(origin, rawEmail) : null;

  const id = makeId("inv");
  await db.insert(appInvitesTable).values({
    id,
    email: rawEmail,
    role,
    invitedByUserId: req.appUser?.id ?? "",
  });

  let emailSent = false;
  if (inviteUrl) {
    const inviterName = req.appUser?.name || req.appUser?.email || "A teammate";
    const subject = `${inviterName} invited you to join KFIS Housing`;
    const text = [
      `${inviterName} invited you to join their team in KFIS Housing as a ${role}.`,
      ``,
      `Accept the invite by signing up here:`,
      inviteUrl,
      ``,
      `If you weren't expecting this, you can ignore this email.`,
    ].join("\n");
    const html = `
      <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111">
        <h2 style="margin:0 0 16px">You've been invited to KFIS Housing</h2>
        <p style="margin:0 0 16px;line-height:1.5">
          <strong>${inviterName}</strong> invited you to join their team as a <strong>${role}</strong>.
        </p>
        <p style="margin:0 0 24px">
          <a href="${inviteUrl}"
             style="display:inline-block;background:#0f766e;color:#fff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:600">
            Accept invite &amp; sign up
          </a>
        </p>
        <p style="margin:0 0 8px;color:#555;font-size:13px">Or paste this link into your browser:</p>
        <p style="margin:0 0 24px;word-break:break-all;font-size:13px"><a href="${inviteUrl}">${inviteUrl}</a></p>
        <p style="margin:0;color:#888;font-size:12px">If you weren't expecting this email, you can ignore it.</p>
      </div>`.trim();
    emailSent = await sendInviteEmail({
      to: [rawEmail],
      subject,
      text,
      html,
    });
  }

  logger.info(
    { invitedBy: req.appUser?.id, email: rawEmail, role, emailSent },
    "Team invite created",
  );
  res.status(201).json({ id, email: rawEmail, role, inviteUrl, emailSent });
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
