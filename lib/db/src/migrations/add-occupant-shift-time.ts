import type { Pool } from "pg";

interface QueryRunner {
  query: (
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: Record<string, unknown>[] }>;
}

async function tableExists(c: QueryRunner, table: string): Promise<boolean> {
  const r = await c.query(`SELECT to_regclass($1) IS NOT NULL AS exists`, [
    `public.${table}`,
  ]);
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
 * Idempotent migration (Stage 5) that adds `occupants.shift_time`.
 *
 * Distinct from the existing nullable `occupants.shift` column (which holds
 * the crew/shift *label* — "Days" / "Nights" / a custom client title): this
 * carries the human-readable *time window* the manager types on their tab
 * (e.g. "6:00 AM – 2:30 PM"). NOT NULL with an empty-string sentinel so
 * existing rows get a blank window the moment the column lands, matching the
 * other free-text occupant columns. Runs BEFORE drizzle's pushSchema so a
 * deployed DB catches it up at boot. Re-runs are no-ops once the column
 * exists.
 */
export async function addOccupantShiftTimeIfNeeded(
  pool: Pool | undefined,
  log: (message: string, extra?: Record<string, unknown>) => void = () => {},
): Promise<{ migrated: boolean }> {
  if (!pool || typeof (pool as { query?: unknown }).query !== "function") {
    return { migrated: false };
  }

  const runner = pool as unknown as QueryRunner;

  if (!(await tableExists(runner, "occupants"))) {
    return { migrated: false };
  }

  if (await columnExists(runner, "occupants", "shift_time")) {
    return { migrated: false };
  }

  log("Adding occupants.shift_time column…");
  await runner.query(
    `ALTER TABLE occupants ADD COLUMN IF NOT EXISTS shift_time text NOT NULL DEFAULT ''`,
  );
  log("occupants.shift_time column added.");

  return { migrated: true };
}
