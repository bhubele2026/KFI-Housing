import type { PushSchemaOptions, PushSchemaResult } from "@workspace/db";
import type { Logger } from "pino";

export interface StartDeps {
  pushSchemaIfNeeded: (
    options: PushSchemaOptions,
  ) => Promise<PushSchemaResult>;
  seedIfEmpty: () => Promise<void>;
  listen: (port: number) => Promise<void>;
  logger: Pick<Logger, "info" | "error">;
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
    await deps.listen(port);
    deps.logger.info({ port }, "Server listening");
  } catch (err) {
    deps.logger.error({ err }, "Error listening on port");
    deps.exit(1);
  }
}
