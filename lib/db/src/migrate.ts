import type { PgDatabase } from "drizzle-orm/pg-core";
import { db, pool } from "./client";
import * as schema from "./schema";
import { backfillRoomsIfNeeded } from "./migrations/backfill-rooms";
import { dropLeaseIncludedItemsIfNeeded } from "./migrations/drop-lease-included-items";
import { migrateLeasesCustomerIdNullableIfNeeded } from "./migrations/leases-customer-id-nullable";
import { backfillUtilitiesIncludedInRent } from "./migrations/backfill-utilities-included-in-rent";
import { addOccupantProfileFieldsIfNeeded } from "./migrations/add-occupant-profile-fields";
import { backfillBuildingsIfNeeded } from "./migrations/backfill-buildings";
import { createPayrollDeductionsTableIfNeeded } from "./migrations/create-payroll-deductions-table";
import { createBedWeeklyRatesTableIfNeeded } from "./migrations/create-bed-weekly-rates-table";
import { createAppUsersTablesIfNeeded } from "./migrations/create-app-users-tables";
import { createMonthlySnapshotsTableIfNeeded } from "./migrations/create-monthly-snapshots-table";
import { createAssistantUploadsTableIfNeeded } from "./migrations/create-assistant-uploads-table";
import { createAssistantNudgesTablesIfNeeded } from "./migrations/create-assistant-nudges-table";
import { addBedNeedsCleaningSinceIfNeeded } from "./migrations/add-bed-needs-cleaning-since";

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

  // Create the buildings table, add building_id columns to rooms /
  // leases, and back-fill one default building per existing property
  // (Task #570) BEFORE drizzle's pushSchema so the diff afterwards is
  // empty. Idempotent — re-runs are no-ops once every property has at
  // least one building and every room.building_id is populated.
  await backfillBuildingsIfNeeded(pool, log);

  // Provision the `payroll_deductions` table (Task #597) BEFORE
  // drizzle's pushSchema, so deployed environments that haven't yet
  // run pushSchema still have the table available the first time a
  // payroll re-import writes a snapshot. Idempotent — no-op once the
  // table exists.
  await createPayrollDeductionsTableIfNeeded(pool, log);

  // Provision `bed_weekly_rates` (Task #598) the same way — ahead
  // of pushSchema so the table is available to the new bed-rate
  // routes on first request even when pushSchema is skipped.
  await createBedWeeklyRatesTableIfNeeded(pool, log);

  // Provision `app_users` + `app_invites` (team auth) BEFORE drizzle's
  // pushSchema so the auth allowlist tables exist on the very first
  // request after the rollout. Idempotent — no-op once both exist.
  await createAppUsersTablesIfNeeded(pool, log);

  // Provision `monthly_snapshots` so the dashboard's admin "Close
  // month" action has a destination on the very first request after a
  // rollout. Idempotent — no-op once the table exists.
  await createMonthlySnapshotsTableIfNeeded(pool, log);

  // Provision `assistant_uploads` (Task #647) BEFORE drizzle's
  // pushSchema so the assistant's file-upload proposal flow has a
  // destination on the very first request after a rollout. Idempotent
  // — no-op once the table exists.
  await createAssistantUploadsTableIfNeeded(pool, log);

  // Provision `assistant_nudges` + `assistant_scanner_runs` (Task #671)
  // BEFORE drizzle's pushSchema so the assistant's nudge endpoints and
  // background scanner have their destinations on the very first
  // request after the rollout. Idempotent — no-op once both exist.
  await createAssistantNudgesTablesIfNeeded(pool, log);

  // Add the nullable `beds.needs_cleaning_since` column (Task #675)
  // BEFORE drizzle's pushSchema so deployed environments pick it up at
  // boot without waiting for a separate push. Back-fills existing
  // needs_cleaning rows from `updated_at` so the scanner and the bed
  // list have a sensible starting age. Idempotent — no-op once the
  // column exists.
  await addBedNeedsCleaningSinceIfNeeded(pool, log);

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
