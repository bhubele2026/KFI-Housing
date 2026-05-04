import type { PushSchemaOptions, PushSchemaResult } from "@workspace/db";
import type { Logger } from "pino";
import { isSchemaDriftError } from "./lib/notify-schema-drift";

export interface StartDeps {
  pushSchemaIfNeeded: (
    options: PushSchemaOptions,
  ) => Promise<PushSchemaResult>;
  seedIfEmpty: () => Promise<void>;
  cleanupLeaseDates: () => Promise<number>;
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

  try {
    await deps.notifySchemaDrift({
      webhookUrl,
      message: err instanceof Error ? err.message : String(err),
    });
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

  try {
    await deps.pushSchemaIfNeeded(
      buildPushSchemaOptions(deps.env, deps.logger),
    );
  } catch (err) {
    if (isProduction) {
      deps.logger.error(
        { err },
        "Database schema is out of date in production — run `pnpm --filter @workspace/db run push` to apply pending changes",
      );
      await notifySchemaDriftIfConfigured(err, deps);
    } else {
      deps.logger.error({ err }, "Failed to apply database schema changes");
    }
    deps.exit(1);
    return;
  }

  try {
    await deps.seedIfEmpty();
  } catch (err) {
    deps.logger.error({ err }, "Failed to seed database");
    deps.exit(1);
    return;
  }

  try {
    await deps.cleanupLeaseDates();
  } catch (err) {
    // Cleanup is a defensive convenience — the renewal calculator is also
    // defensive — so we log and keep serving rather than refusing to start.
    deps.logger.error({ err }, "Failed to normalize lease dates at startup");
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
// We deliberately log only the *presence* of either env var, never
// their values — these end up in plaintext workflow logs.
function warnIfGoogleMapsKeyMissing(
  deps: Pick<StartDeps, "env" | "logger">,
): void {
  const primary = (deps.env["GOOGLE_MAPS_API_KEY"] ?? "").trim();
  const legacy = (deps.env["VITE_GOOGLE_MAPS_API_KEY"] ?? "").trim();
  if (primary === "" && legacy === "") {
    deps.logger.warn(
      "Neither GOOGLE_MAPS_API_KEY nor VITE_GOOGLE_MAPS_API_KEY is " +
        "set — the property-detail Location card and the portfolio " +
        "map will render their 'API key isn't configured' fallback. " +
        "Set GOOGLE_MAPS_API_KEY (preferred) on the api-server and " +
        "restart it to enable the embedded Google Map. The legacy " +
        "VITE_GOOGLE_MAPS_API_KEY name is also accepted as a fallback.",
    );
  }
}
