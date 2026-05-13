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

/**
 * Idempotent migration that provisions the `monthly_snapshots` table
 * BEFORE drizzle's pushSchema runs, so the dashboard's
 * "Close month" admin action has somewhere to write on the very first
 * request after a rollout — even if pushSchema is configured to skip
 * on boot.
 */
export async function createMonthlySnapshotsTableIfNeeded(
  pool: Pool | undefined,
  log: (message: string, extra?: Record<string, unknown>) => void = () => {},
): Promise<{ migrated: boolean }> {
  if (!pool || typeof (pool as { query?: unknown }).query !== "function") {
    return { migrated: false };
  }

  const runner = pool as unknown as QueryRunner;
  if (await tableExists(runner, "monthly_snapshots")) {
    return { migrated: false };
  }

  log("Creating monthly_snapshots table…");
  await runner.query(`
    CREATE TABLE IF NOT EXISTS monthly_snapshots (
      yyyymm text PRIMARY KEY,
      recovered double precision NOT NULL DEFAULT 0,
      rent_paid double precision NOT NULL DEFAULT 0,
      utilities double precision NOT NULL DEFAULT 0,
      other_costs double precision NOT NULL DEFAULT 0,
      net double precision NOT NULL DEFAULT 0,
      occupancy_avg double precision NOT NULL DEFAULT 0,
      total_beds integer NOT NULL DEFAULT 0,
      closed_at timestamptz NOT NULL DEFAULT now(),
      closed_by_user_id text NOT NULL DEFAULT '',
      closed_by_email text NOT NULL DEFAULT ''
    )
  `);
  log("monthly_snapshots table created.");
  return { migrated: true };
}
