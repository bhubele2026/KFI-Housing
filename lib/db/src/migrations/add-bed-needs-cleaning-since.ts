import type { Pool } from "pg";

interface QueryRunner {
  query: (
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: Record<string, unknown>[] }>;
}

async function tableExists(c: QueryRunner, table: string): Promise<boolean> {
  const r = await c.query(
    `SELECT to_regclass($1) IS NOT NULL AS exists`,
    [`public.${table}`],
  );
  return Boolean(r.rows[0]?.["exists"]);
}

async function columnExists(
  c: QueryRunner,
  table: string,
  column: string,
): Promise<boolean> {
  const r = await c.query(
    `SELECT EXISTS(
       SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = $1
          AND column_name = $2
     ) AS exists`,
    [table, column],
  );
  return Boolean(r.rows[0]?.["exists"]);
}

/**
 * Idempotent migration that adds the nullable `needs_cleaning_since`
 * column to the `beds` table (Task #675) BEFORE drizzle's pushSchema.
 *
 * The column tracks when a bed entered the `needs_cleaning` cleaning
 * state. Null whenever the bed is not currently waiting for cleaning.
 *
 * On first add the migration also back-fills any existing
 * `needs_cleaning` rows from their `updated_at` timestamp so the
 * assistant scanner's age-based check and the bed-list UI's "waiting
 * Nd" label have a reasonable starting point instead of NULL — the
 * approximation is exactly what the scanner used previously.
 *
 * Skips silently when:
 *  - the database isn't yet provisioned (pool.query unavailable),
 *  - the `beds` table doesn't exist (fresh DB — drizzle will create
 *    the column on the next pushSchema), or
 *  - the column already exists.
 */
export async function addBedNeedsCleaningSinceIfNeeded(
  pool: Pool | undefined,
  log: (message: string, extra?: Record<string, unknown>) => void = () => {},
): Promise<{ migrated: boolean; backfilled: number }> {
  if (!pool || typeof (pool as { query?: unknown }).query !== "function") {
    return { migrated: false, backfilled: 0 };
  }
  const runner = pool as unknown as QueryRunner;

  if (!(await tableExists(runner, "beds"))) {
    return { migrated: false, backfilled: 0 };
  }

  if (await columnExists(runner, "beds", "needs_cleaning_since")) {
    return { migrated: false, backfilled: 0 };
  }

  log("Adding beds.needs_cleaning_since column…");
  await runner.query(
    `ALTER TABLE beds ADD COLUMN IF NOT EXISTS needs_cleaning_since timestamptz`,
  );

  const backfill = await runner.query(
    `UPDATE beds
        SET needs_cleaning_since = updated_at
      WHERE cleaning_status = 'needs_cleaning'
        AND needs_cleaning_since IS NULL`,
  );
  const backfilled =
    typeof (backfill as { rowCount?: unknown }).rowCount === "number"
      ? ((backfill as { rowCount?: number }).rowCount ?? 0)
      : 0;
  log("beds.needs_cleaning_since column added.", { backfilled });

  return { migrated: true, backfilled };
}
