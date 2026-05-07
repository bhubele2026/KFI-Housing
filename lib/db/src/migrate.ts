import type { PgDatabase } from "drizzle-orm/pg-core";
import { db, pool } from "./client";
import * as schema from "./schema";
import { backfillRoomsIfNeeded } from "./migrations/backfill-rooms";
import { dropLeaseIncludedItemsIfNeeded } from "./migrations/drop-lease-included-items";
import { migrateLeasesCustomerIdNullableIfNeeded } from "./migrations/leases-customer-id-nullable";
import { backfillUtilitiesIncludedInRent } from "./migrations/backfill-utilities-included-in-rent";
import { addOccupantProfileFieldsIfNeeded } from "./migrations/add-occupant-profile-fields";

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

  // Bring legacy databases (with `bed.room` text column) up to the new
  // Property → Rooms → Beds shape BEFORE drizzle diffs the schema, so the
  // diff afterwards is empty (and free of any data-loss warnings).
  await backfillRoomsIfNeeded(pool, log);

  // Drop the legacy `leases.included_items` column BEFORE drizzle diffs the
  // schema. Otherwise pushSchema would see the missing column as a drop and
  // refuse to apply (hasDataLoss). Idempotent — no-op once the column is gone.
  await dropLeaseIncludedItemsIfNeeded(pool, log);

  // Backfill legacy `leases.customer_id = ''` rows to NULL and relax
  // the column to nullable BEFORE drizzle diffs the schema (Task #439),
  // so the empty-string sentinel that used to defeat `??` fallbacks is
  // gone end-to-end and the diff afterwards is empty.
  await migrateLeasesCustomerIdNullableIfNeeded(pool, log);

  // Add the four nullable occupant profile columns (Task #502:
  // language / gender / title / kfis_authorized_to_drive) BEFORE
  // drizzle diffs the schema, so a deployed DB that's still on the
  // old shape catches up at boot rather than waiting for a separate
  // pushSchema run. Idempotent — no-op once all four columns exist.
  await addOccupantProfileFieldsIfNeeded(pool, log);

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

  // Back-fill `leases.utilities_included_in_rent` from existing
  // notes/clauses text now that the column exists (Task #518). Safe to
  // re-run; only flips rows whose free-form text mentions utilities are
  // bundled into rent.
  await backfillUtilitiesIncludedInRent(pool, log);

  return {
    applied: true,
    statements: statementsToExecute,
    warnings,
    hasDataLoss,
  };
}
