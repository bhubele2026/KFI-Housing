import { randomBytes, createHash } from "node:crypto";
import { logger } from "./logger";

/**
 * Thin Intuit QuickBooks Online client (Task #689).
 *
 * No `node-quickbooks` SDK — we talk directly to the REST API. Just
 * the bits we need: OAuth start/callback URL helpers, token exchange,
 * transparent access-token refresh, and a typed CDC (`Metadata.LastUpdatedTime >= ?`)
 * iterator for the six entity types the sync job pulls.
 */

export interface QboConfig {
  clientId: string;
  clientSecret: string;
  /** "sandbox" | "production" */
  environment: "sandbox" | "production";
  redirectUri: string;
}

export interface QboTokens {
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
  realmId: string;
}

export interface QboPersistedConnection {
  realmId: string;
  accessToken: string;
  accessTokenExpiresAt: Date | null;
  refreshToken: string;
}

/** Caller persists the refreshed tokens back to `qbo_connections`. */
export type PersistTokens = (tokens: QboTokens) => Promise<void>;

const SCOPES = ["com.intuit.quickbooks.accounting"];

const DISCOVERY = {
  sandbox: {
    authorize: "https://appcenter.intuit.com/connect/oauth2",
    token: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
    revoke: "https://developer.api.intuit.com/v2/oauth2/tokens/revoke",
    api: "https://sandbox-quickbooks.api.intuit.com",
  },
  production: {
    authorize: "https://appcenter.intuit.com/connect/oauth2",
    token: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
    revoke: "https://developer.api.intuit.com/v2/oauth2/tokens/revoke",
    api: "https://quickbooks.api.intuit.com",
  },
} as const;

export function readQboConfig(env: NodeJS.ProcessEnv): QboConfig | null {
  const clientId = (env["QBO_CLIENT_ID"] ?? "").trim();
  const clientSecret = (env["QBO_CLIENT_SECRET"] ?? "").trim();
  const redirectUri = (env["QBO_REDIRECT_URI"] ?? "").trim();
  const environment =
    ((env["QBO_ENV"] ?? "production").trim().toLowerCase() === "sandbox"
      ? "sandbox"
      : "production") as "sandbox" | "production";
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, environment, redirectUri };
}

/**
 * Generate a fresh `{ state, codeVerifier, codeChallenge }` triple
 * for an OAuth start request. The caller should sign and persist the
 * `state` value (e.g. in a short-lived signed cookie) so the callback
 * can validate it against CSRF.
 */
export function generatePkcePair(): {
  state: string;
  codeVerifier: string;
  codeChallenge: string;
} {
  const state = randomBytes(16).toString("hex");
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");
  return { state, codeVerifier, codeChallenge };
}

export function buildAuthorizeUrl(
  config: QboConfig,
  params: { state: string; codeChallenge: string },
): string {
  const url = new URL(DISCOVERY[config.environment].authorize);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES.join(" "));
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("state", params.state);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export type FetchImpl = typeof fetch;

interface RawTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  x_refresh_token_expires_in: number;
  token_type: string;
}

function tokensFromResponse(
  realmId: string,
  raw: RawTokenResponse,
  now: Date = new Date(),
): QboTokens {
  return {
    accessToken: raw.access_token,
    accessTokenExpiresAt: new Date(now.getTime() + raw.expires_in * 1000),
    refreshToken: raw.refresh_token,
    refreshTokenExpiresAt: new Date(
      now.getTime() + raw.x_refresh_token_expires_in * 1000,
    ),
    realmId,
  };
}

/**
 * Exchange the OAuth `code` returned by Intuit for an access +
 * refresh token. `realmId` arrives as a query-string param on the
 * callback URL.
 */
export async function exchangeCodeForTokens(
  config: QboConfig,
  params: { code: string; realmId: string; codeVerifier?: string },
  fetchImpl: FetchImpl = fetch,
): Promise<QboTokens> {
  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("code", params.code);
  body.set("redirect_uri", config.redirectUri);
  if (params.codeVerifier) body.set("code_verifier", params.codeVerifier);

  const r = await fetchImpl(DISCOVERY[config.environment].token, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(
        `${config.clientId}:${config.clientSecret}`,
      ).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`QBO token exchange failed (${r.status}): ${text}`);
  }
  const json = (await r.json()) as RawTokenResponse;
  return tokensFromResponse(params.realmId, json);
}

/**
 * Refresh the access token using the persisted refresh token.
 * Intuit rotates the refresh token every ~100 days; if it expires the
 * server returns 400 and the operator must reconnect.
 */
export async function refreshAccessToken(
  config: QboConfig,
  refreshToken: string,
  realmId: string,
  fetchImpl: FetchImpl = fetch,
): Promise<QboTokens> {
  const body = new URLSearchParams();
  body.set("grant_type", "refresh_token");
  body.set("refresh_token", refreshToken);

  const r = await fetchImpl(DISCOVERY[config.environment].token, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(
        `${config.clientId}:${config.clientSecret}`,
      ).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    logger.warn(
      { realmId, status: r.status },
      "qbo.refresh_failed",
    );
    throw new Error(`QBO token refresh failed (${r.status}): ${text}`);
  }
  const json = (await r.json()) as RawTokenResponse;
  logger.info({ realmId }, "qbo.refresh");
  return tokensFromResponse(realmId, json);
}

export async function revokeRefreshToken(
  config: QboConfig,
  refreshToken: string,
  fetchImpl: FetchImpl = fetch,
): Promise<void> {
  await fetchImpl(DISCOVERY[config.environment].revoke, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(
        `${config.clientId}:${config.clientSecret}`,
      ).toString("base64")}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ token: refreshToken }),
  }).catch(() => {
    /* best-effort */
  });
}

const FIVE_MINUTES_MS = 5 * 60 * 1000;

export interface QboClient {
  realmId: string;
  /** Run a QBO REST query (the SQL-ish `query` endpoint) and return the response. */
  query<T = unknown>(sql: string): Promise<T>;
  /** Iterate every entity row matching `sql`, paginating in batches of 1000. */
  iterateQuery<T = unknown>(sql: string): AsyncGenerator<T, void, void>;
  /** Current tokens (after any in-process refresh). */
  getTokens(): { accessToken: string; expiresAt: Date | null };
}

/**
 * Create a per-realm REST client. Caches the access token in-process
 * and transparently refreshes when < 5 minutes from expiry, calling
 * `persistTokens` so the new pair lands in `qbo_connections`.
 */
export function createQboClient(opts: {
  config: QboConfig;
  connection: QboPersistedConnection;
  persistTokens: PersistTokens;
  fetchImpl?: FetchImpl;
}): QboClient {
  const fetchImpl = opts.fetchImpl ?? fetch;
  let accessToken = opts.connection.accessToken;
  let expiresAt = opts.connection.accessTokenExpiresAt;
  let refreshToken = opts.connection.refreshToken;
  const realmId = opts.connection.realmId;

  async function ensureFreshToken(): Promise<void> {
    const now = Date.now();
    if (
      accessToken &&
      expiresAt &&
      expiresAt.getTime() - now > FIVE_MINUTES_MS
    ) {
      return;
    }
    const fresh = await refreshAccessToken(
      opts.config,
      refreshToken,
      realmId,
      fetchImpl,
    );
    accessToken = fresh.accessToken;
    expiresAt = fresh.accessTokenExpiresAt;
    refreshToken = fresh.refreshToken;
    await opts.persistTokens(fresh);
  }

  async function query<T = unknown>(sql: string): Promise<T> {
    await ensureFreshToken();
    const base = DISCOVERY[opts.config.environment].api;
    const url = `${base}/v3/company/${realmId}/query?minorversion=70&query=${encodeURIComponent(sql)}`;
    logger.info({ realmId, sql: sql.slice(0, 120) }, "qbo.request");
    const r = await fetchImpl(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      throw new Error(`QBO query failed (${r.status}): ${text}`);
    }
    return (await r.json()) as T;
  }

  async function* iterateQuery<T = unknown>(
    sql: string,
  ): AsyncGenerator<T, void, void> {
    let start = 1;
    const pageSize = 1000;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const paged = `${sql} STARTPOSITION ${start} MAXRESULTS ${pageSize}`;
      const res = (await query<{
        QueryResponse?: Record<string, T[] | number | undefined>;
      }>(paged)) as { QueryResponse?: Record<string, unknown> };
      const qr = res.QueryResponse ?? {};
      const arr = (Object.values(qr).find(Array.isArray) ?? []) as T[];
      for (const row of arr) yield row;
      if (arr.length < pageSize) return;
      start += pageSize;
    }
  }

  return {
    realmId,
    query,
    iterateQuery,
    getTokens: () => ({ accessToken, expiresAt }),
  };
}

/**
 * Build a CDC-ish QBO `query` string filtered by `Metadata.LastUpdatedTime`.
 * QBO's full CDC endpoint is per-entity-list and slightly different
 * from the regular query endpoint; this helper hits the regular
 * `query` endpoint with a `MetaData.LastUpdatedTime >= '…'` predicate,
 * which is the documented incremental pattern and works the same way
 * across all entity types.
 */
export function buildCdcQuery(
  entity: string,
  sinceIso: string | null,
): string {
  if (!sinceIso) return `SELECT * FROM ${entity}`;
  return `SELECT * FROM ${entity} WHERE MetaData.LastUpdatedTime >= '${sinceIso}'`;
}
