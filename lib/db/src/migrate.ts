import type { PgDatabase } from "drizzle-orm/pg-core";
import { db } from "./client";
import * as schema from "./schema";

export interface PushSchemaResult {
  applied: boolean;
  statements: string[];
  warnings: string[];
  hasDataLoss: boolean;
}

export interface PushSchemaOptions {
  allowDataLoss?: boolean;
  checkOnly?: boolean;
  log?: (message: string, extra?: Record<string, unknown>) => void;
}

export async function pushSchemaIfNeeded(
  options: PushSchemaOptions = {},
): Promise<PushSchemaResult> {
  const log =
    options.log ??
    ((message, extra) => {
      if (extra) {
        console.log(`[db:migrate] ${message}`, extra);
      } else {
        console.log(`[db:migrate] ${message}`);
      }
    });

  const { pushSchema } = await import("drizzle-kit/api");

  const { hasDataLoss, warnings, statementsToExecute, apply } =
    await pushSchema(
      schema as Record<string, unknown>,
      db as unknown as PgDatabase<never>,
    );

  if (statementsToExecute.length === 0) {
    log("Schema is up to date.");
    return {
      applied: false,
      statements: [],
      warnings,
      hasDataLoss: false,
    };
  }

  if (options.checkOnly) {
    const message =
      `Schema is out of date: ${statementsToExecute.length} pending ` +
      "statement(s) detected. Refusing to auto-apply in this mode. " +
      "Run `pnpm --filter @workspace/db run push` from a single place " +
      "(e.g. the post-merge hook) to bring the database in sync.";
    log(message, {
      warnings,
      statements: statementsToExecute,
      hasDataLoss,
    });
    throw new Error(message);
  }

  if (hasDataLoss && !options.allowDataLoss) {
    const message =
      "Schema drift detected, but applying it would cause data loss. " +
      "Run `pnpm --filter @workspace/db run push-force` after reviewing the changes.";
    log(message, {
      warnings,
      statements: statementsToExecute,
    });
    throw new Error(message);
  }

  log(`Applying ${statementsToExecute.length} schema change(s)…`, {
    warnings,
    statements: statementsToExecute,
  });
  await apply();
  log("Schema changes applied.");

  return {
    applied: true,
    statements: statementsToExecute,
    warnings,
    hasDataLoss,
  };
}
