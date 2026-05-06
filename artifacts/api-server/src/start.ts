import type { PushSchemaOptions, PushSchemaResult } from "@workspace/db";
import type { Logger } from "pino";
import { isSchemaDriftError } from "./lib/notify-schema-drift";

export interface StartDeps {
  pushSchemaIfNeeded: (
    options: PushSchemaOptions,
  ) => Promise<PushSchemaResult>;
  seedIfEmpty: () => Promise<void>;
  backfillOccupantMoveInDates: () => Promise<void>;
  // Idempotent Adient customer/property/lease seed; runs after
  // seedIfEmpty so it applies on already-populated DBs. Non-fatal.
  seedAdientIfMissing: () => Promise<void>;
  seedPatriotBarabooIfMissing: () => Promise<void>;
  backfillOccupantPayrollIds: () => Promise<void>;
  seedHickoryHavenIfMissing: () => Promise<void>;
  seedHousingDeductions: () => Promise<void>;
  // Idempotent seed for the active leases extracted from attached PDFs
  // (Task #287). Runs after seedAdientIfMissing. Non-fatal.
  seedAttachedLeasesIfMissing: () => Promise<void>;
  listen: (port: number) => Promise<void>;
  notifySchemaDrift: (params: {
    webhookUrl: string;
    message: string;
  }) => Promise<void>;
  logger: Pick<Logger, "info" | "error" | "warn">;
  env: NodeJS.ProcessEnv;
  exit: (code: number) => never;
}

export function isProductionEnv(env: NodeJS.ProcessEnv): boolean {
  return env["NODE_ENV"] === "production";
}

export function buildPushSchemaOptions(
  env: NodeJS.ProcessEnv,
  logger: Pick<Logger, "info">,
): PushSchemaOptions {
  return {
    checkOnly: isProductionEnv(env),
    log: (message, extra) => {
      if (extra) {
        logger.info(extra, message);
      } else {
        logger.info(message);
      }
    },
  };
}

export function resolvePort(env: NodeJS.ProcessEnv): number {
  const rawPort = env["PORT"];

  if (!rawPort) {
    throw new Error(
      "PORT environment variable is required but was not provided.",
    );
  }

  const port = Number(rawPort);

  if (Number.isNaN(port) || port <= 0) {
    throw new Error(`Invalid PORT value: "${rawPort}"`);
  }

  return port;
}

async function notifySchemaDriftIfConfigured(
  err: unknown,
  deps: Pick<StartDeps, "env" | "logger" | "notifySchemaDrift">,
): Promise<void> {
  if (!isSchemaDriftError(err)) {
    return;
  }

  const webhookUrl = deps.env["SCHEMA_DRIFT_WEBHOOK_URL"];
  if (!webhookUrl) {
    deps.logger.warn(
      "SCHEMA_DRIFT_WEBHOOK_URL is not set — skipping schema drift chat notification",
    );
    return;
  }

  // Cap webhook latency so a hung outbound request can never block the
  // production startup sequence. The schema-drift path now continues to
  // serve, so we must not let a slow notification webhook hold the
  // server from calling listen() and answering health checks.
  const NOTIFY_TIMEOUT_MS = 3_000;
  try {
    await Promise.race([
      deps.notifySchemaDrift({
        webhookUrl,
        message: err instanceof Error ? err.message : String(err),
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `Schema drift webhook timed out after ${NOTIFY_TIMEOUT_MS}ms`,
              ),
            ),
          NOTIFY_TIMEOUT_MS,
        ).unref(),
      ),
    ]);
    deps.logger.info("Sent schema drift notification to chat webhook");
  } catch (notifyErr) {
    deps.logger.error(
      { err: notifyErr },
      "Failed to send schema drift chat notification",
    );
  }
}

export async function start(deps: StartDeps): Promise<void> {
  const isProduction = isProductionEnv(deps.env);

  const port = resolvePort(deps.env);

  // In production, refuse to start if neither GOOGLE_MAPS_API_KEY nor
  // the legacy VITE_GOOGLE_MAPS_API_KEY is set. With the autoscale
  // health check at /api/healthz, an exit(1) here means the new
  // revision never responds, so Replit's deployment system will not
  // promote the bad build over the previous good one — the missing
  // secret is caught in CI before it actually reaches production
  // users (Task #191). In dev, we keep the existing post-listen WARN
  // (Task #187) so local workflows still start and surface the
  // problem in a non-fatal way — see `warnIfGoogleMapsKeyMissing`
  // below.
  if (isProduction && !hasGoogleMapsKeyConfigured(deps.env)) {
    deps.logger.error(googleMapsMissingMessage());
    deps.exit(1);
    return;
  }

  try {
    await deps.pushSchemaIfNeeded(
      buildPushSchemaOptions(deps.env, deps.logger),
    );
  } catch (err) {
    // In production, schema drift used to be fatal (`exit(1)`), which
    // blocks publishes whenever the source-of-truth Drizzle schema and the
    // production DB disagree on anything — including purely cosmetic diffs
    // like `SET DEFAULT` changes. Those defaults are also expressed in the
    // schema via Drizzle's `.default(...)`, so insert behaviour is
    // identical regardless of what the DB-side default is, and refusing to
    // start strands the deploy with no in-app way to apply the diff (the
    // supported path is the publish-time schema flow on Replit).
    //
    // We now treat schema drift as a loud warning in production: log,
    // fire the chat webhook if configured, and continue serving so the
    // deploy can promote. Non-drift errors (DB connection failures,
    // unexpected throws) still exit(1) and block the bad revision.
    if (isProduction && isSchemaDriftError(err)) {
      deps.logger.warn(
        { err },
        "Database schema drift detected in production — continuing to serve. Apply pending changes via the Publish flow's schema sync, or contact Replit support to apply them to the production database.",
      );
      await notifySchemaDriftIfConfigured(err, deps);
    } else {
      if (isProduction) {
        deps.logger.error(
          { err },
          "Failed to validate database schema in production — refusing to start",
        );
      } else {
        deps.logger.error({ err }, "Failed to apply database schema changes");
      }
      deps.exit(1);
      return;
    }
  }

  try {
    await deps.seedIfEmpty();
  } catch (err) {
    deps.logger.error({ err }, "Failed to seed database");
    deps.exit(1);
    return;
  }

  // One-shot backfill for legacy occupants whose move-in date was never
  // captured (Task #259). Failures are logged but non-fatal — the API
  // already tolerates empty move-in dates and the UI surfaces a "needs
  // review" badge for any rows the backfill couldn't resolve.
  try {
    await deps.backfillOccupantMoveInDates();
  } catch (err) {
    deps.logger.warn(
      { err },
      "Failed to backfill occupant move-in dates — continuing to serve",
    );
  }

  // Idempotent Adient seed; non-fatal so a transient DB blip can't
  // keep the server from serving traffic.
  try {
    await deps.seedAdientIfMissing();
  } catch (err) {
    deps.logger.warn(
      { err },
      "Failed to apply Adient seed — continuing to serve",
    );
  }

  // Idempotent KFI Staffing / Patriot Properties Baraboo seed (Task #292);
  // non-fatal for the same reason.
  try {
    await deps.seedPatriotBarabooIfMissing();
  } catch (err) {
    deps.logger.warn(
      { err },
      "Failed to apply Patriot Baraboo seed — continuing to serve",
    );
  }

  // Backfill `employeeId` and `company` on occupants from the payroll
  // export *before* the deduction seeder runs (Task #285), so the
  // strict `employeeId == personId` matcher resolves the bulk of rows
  // and the fragile name-only fallback is only a last-resort safety
  // net. Idempotent and non-fatal.
  try {
    await deps.backfillOccupantPayrollIds();
  } catch (err) {
    deps.logger.warn(
      { err },
      "Failed to backfill occupant payroll IDs — continuing to serve",
    );
  }

  // Idempotent Hickory Haven (Gilman, WI) seed (Task #294); non-fatal.
  try {
    await deps.seedHickoryHavenIfMissing();
  } catch (err) {
    deps.logger.warn(
      { err },
      "Failed to apply Hickory Haven seed — continuing to serve",
    );
  }

  // One-shot seeder for weekly housing deductions sourced from the
  // payroll export (Task #282). Idempotent: only writes when a matched
  // occupant's chargePerBed/billingFrequency would change. Failures are
  // logged but non-fatal — the rest of the app keeps the previous
  // values, and unmatched rows are surfaced for manual reconciliation.
  try {
    await deps.seedHousingDeductions();
  } catch (err) {
    deps.logger.warn(
      { err },
      "Failed to apply payroll-derived weekly housing deductions — continuing to serve",
    );
  }

  // Idempotent seed for active leases extracted from attached PDFs
  // (Task #287). Non-fatal for the same reason as the Adient seed.
  try {
    await deps.seedAttachedLeasesIfMissing();
  } catch (err) {
    deps.logger.warn(
      { err },
      "Failed to apply attached-lease PDF seed — continuing to serve",
    );
  }

  try {
    await deps.listen(port);
    deps.logger.info({ port }, "Server listening");
    warnIfGoogleMapsKeyMissing(deps);
  } catch (err) {
    deps.logger.error({ err }, "Error listening on port");
    deps.exit(1);
  }
}

// Mirrors `artifacts/api-server/src/routes/config.ts` exactly:
// trimmed canonical OR trimmed legacy must be a non-empty string. By
// keeping this in lockstep with the route, a startup that decides
// "the key is configured" can never disagree with what `/api/config`
// returns at runtime.
function hasGoogleMapsKeyConfigured(env: NodeJS.ProcessEnv): boolean {
  const primary = (env["GOOGLE_MAPS_API_KEY"] ?? "").trim();
  if (primary !== "") return true;
  const legacy = (env["VITE_GOOGLE_MAPS_API_KEY"] ?? "").trim();
  return legacy !== "";
}

// Single source of truth for the operator-facing message. Both the
// dev WARN and the production fatal error reuse this so the two
// paths stay in sync, and the message always names BOTH env var
// names (Task #191) so whoever sees the log knows exactly which
// secrets to check.
function googleMapsMissingMessage(): string {
  return (
    "Neither GOOGLE_MAPS_API_KEY nor VITE_GOOGLE_MAPS_API_KEY is " +
    "set — the property-detail Location card and the portfolio " +
    "map will render their 'API key isn't configured' fallback. " +
    "Set GOOGLE_MAPS_API_KEY (preferred) on the api-server and " +
    "restart it to enable the embedded Google Map. The legacy " +
    "VITE_GOOGLE_MAPS_API_KEY name is also accepted as a fallback."
  );
}

// Surfaces a single, clearly-worded warning at startup when neither
// the canonical `GOOGLE_MAPS_API_KEY` nor the legacy
// `VITE_GOOGLE_MAPS_API_KEY` is set. Without this, a missing key
// produces an entirely silent failure mode — `/api/config` returns
// `{"googleMapsApiKey": null, ...}` and the frontend renders its
// "API key isn't configured" fallback box, but nothing in the
// workflow logs points at the real cause. The user has now hit this
// silent failure three times in a row (Task #187), so we make the
// next regression loud here at boot.
//
// In production, the same condition is checked *before* `listen()`
// and exits 1 (see `start` above) so the new revision fails its
// startup health check and never gets promoted — this dev-only WARN
// path is the looser, non-fatal counterpart for local workflows.
//
// We deliberately log only the *presence* of either env var, never
// their values — these end up in plaintext workflow logs.
function warnIfGoogleMapsKeyMissing(
  deps: Pick<StartDeps, "env" | "logger">,
): void {
  if (!hasGoogleMapsKeyConfigured(deps.env)) {
    deps.logger.warn(googleMapsMissingMessage());
  }
}
