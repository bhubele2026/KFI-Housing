import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, qboConnectionsTable, qboAccountClassificationsTable } from "@workspace/db";
import {
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  generatePkcePair,
  readQboConfig,
  revokeRefreshToken,
} from "../lib/qbo-client";
import { runSyncForConnection } from "../lib/qbo-sync";
import { logger } from "../lib/logger";
import type { AuthedRequest } from "../middlewares/requireAuth";

const router: IRouter = Router();

// In-process state-cookie store. State is short-lived (5 min) so a
// simple in-memory Map is sufficient for a single-process app.
const STATES = new Map<
  string,
  { codeVerifier: string; userId: string; expiresAt: number }
>();
function rememberState(state: string, codeVerifier: string, userId: string) {
  const now = Date.now();
  for (const [k, v] of STATES) if (v.expiresAt < now) STATES.delete(k);
  STATES.set(state, { codeVerifier, userId, expiresAt: now + 5 * 60_000 });
}
function consumeState(state: string) {
  const v = STATES.get(state);
  if (!v) return null;
  STATES.delete(state);
  if (v.expiresAt < Date.now()) return null;
  return v;
}

router.get("/qbo/status", async (_req, res) => {
  const [c] = await db.select().from(qboConnectionsTable).limit(1);
  if (!c) {
    res.json({ connected: false });
    return;
  }
  res.json({
    connected: true,
    realmId: c.realmId,
    companyName: c.companyName,
    environment: c.environment,
    connectedAt: c.connectedAt,
    lastSyncAt: c.lastSyncAt,
    lastSyncError: c.lastSyncError || null,
    historicalPullProgress: c.historicalPullProgress || null,
  });
});

router.get("/qbo/connect/start", (req: AuthedRequest, res) => {
  const cfg = readQboConfig(process.env);
  if (!cfg) {
    res
      .status(500)
      .json({
        error:
          "QuickBooks integration not configured. Set QBO_CLIENT_ID, QBO_CLIENT_SECRET, QBO_REDIRECT_URI.",
      });
    return;
  }
  const { state, codeVerifier, codeChallenge } = generatePkcePair();
  rememberState(state, codeVerifier, req.appUser?.id ?? "");
  const url = buildAuthorizeUrl(cfg, { state, codeChallenge });
  res.redirect(url);
});

router.get("/qbo/connect/callback", async (req, res) => {
  const cfg = readQboConfig(process.env);
  if (!cfg) {
    res.status(500).send("QuickBooks not configured");
    return;
  }
  const code = String(req.query["code"] ?? "");
  const realmId = String(req.query["realmId"] ?? "");
  const state = String(req.query["state"] ?? "");
  const stored = consumeState(state);
  if (!code || !realmId || !stored) {
    res.status(400).send("Invalid OAuth callback");
    return;
  }
  try {
    const tokens = await exchangeCodeForTokens(
      cfg,
      { code, realmId, codeVerifier: stored.codeVerifier },
    );
    const existing = await db
      .select()
      .from(qboConnectionsTable)
      .where(eq(qboConnectionsTable.realmId, realmId));
    if (existing.length > 0) {
      await db
        .update(qboConnectionsTable)
        .set({
          accessToken: tokens.accessToken,
          accessTokenExpiresAt: tokens.accessTokenExpiresAt,
          refreshToken: tokens.refreshToken,
          refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
          environment: cfg.environment,
          lastSyncError: "",
        })
        .where(eq(qboConnectionsTable.realmId, realmId));
    } else {
      await db.insert(qboConnectionsTable).values({
        id: `qcon-${randomUUID().slice(0, 8)}`,
        realmId,
        environment: cfg.environment,
        accessToken: tokens.accessToken,
        accessTokenExpiresAt: tokens.accessTokenExpiresAt,
        refreshToken: tokens.refreshToken,
        refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
        connectedByUserId: stored.userId,
      });
    }
    // Fire-and-forget bulk historical pull (non-blocking).
    setImmediate(() => {
      void (async () => {
        try {
          const [conn] = await db
            .select()
            .from(qboConnectionsTable)
            .where(eq(qboConnectionsTable.realmId, realmId));
          if (conn) await runSyncForConnection(conn, { config: cfg });
        } catch (err) {
          logger.error({ err }, "qbo.initial_sync_failed");
        }
      })();
    });
    res.redirect("/settings?qbo=connected");
  } catch (err) {
    logger.error({ err }, "qbo.callback_failed");
    res.status(500).send(`QuickBooks connect failed: ${(err as Error).message}`);
  }
});

router.post("/qbo/disconnect", async (_req, res) => {
  const cfg = readQboConfig(process.env);
  const conns = await db.select().from(qboConnectionsTable);
  for (const c of conns) {
    if (cfg && c.refreshToken) {
      await revokeRefreshToken(cfg, c.refreshToken);
    }
    await db.delete(qboConnectionsTable).where(eq(qboConnectionsTable.id, c.id));
  }
  res.json({ ok: true });
});

let SYNC_IN_FLIGHT = false;
router.post("/qbo/sync", async (_req, res) => {
  const cfg = readQboConfig(process.env);
  if (!cfg) {
    res.status(500).json({ error: "QBO not configured" });
    return;
  }
  if (SYNC_IN_FLIGHT) {
    res.status(409).json({ error: "Sync already in flight" });
    return;
  }
  SYNC_IN_FLIGHT = true;
  try {
    const [conn] = await db.select().from(qboConnectionsTable).limit(1);
    if (!conn) {
      res.status(404).json({ error: "Not connected" });
      return;
    }
    const result = await runSyncForConnection(conn, { config: cfg });
    res.json(result);
  } catch (err) {
    logger.error({ err }, "qbo.manual_sync_failed");
    res.status(500).json({ error: (err as Error).message });
  } finally {
    SYNC_IN_FLIGHT = false;
  }
});

router.get("/qbo/account-classifications", async (_req, res) => {
  const rows = await db.select().from(qboAccountClassificationsTable);
  res.json(rows);
});

router.put(
  "/qbo/account-classifications/:id",
  async (req: AuthedRequest, res) => {
    const id = req.params["id"] as string;
    const classification = String(req.body?.classification ?? "");
    if (!["rent", "utility", "other"].includes(classification)) {
      res.status(400).json({ error: "classification must be rent|utility|other" });
      return;
    }
    const [row] = await db
      .update(qboAccountClassificationsTable)
      .set({
        classification,
        editedByUserId: req.appUser?.id ?? null,
        editedAt: new Date(),
      })
      .where(eq(qboAccountClassificationsTable.id, id))
      .returning();
    res.json(row);
  },
);

export default router;
