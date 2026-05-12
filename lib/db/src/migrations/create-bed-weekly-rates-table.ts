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
 * Idempotent migration that provisions the `bed_weekly_rates`
 * table BEFORE drizzle's pushSchema runs (mirrors the
 * `payroll_deductions` migration). Re-runs are safe because every
 * statement is `IF NOT EXISTS`.
 */
export async function createBedWeeklyRatesTableIfNeeded(
  pool: Pool | undefined,
  log: (message: string, extra?: Record<string, unknown>) => void = () => {},
): Promise<{ migrated: boolean }> {
  if (!pool || typeof (pool as { query?: unknown }).query !== "function") {
    return { migrated: false };
  }
  const runner = pool as unknown as QueryRunner;
  if (await tableExists(runner, "bed_weekly_rates")) {
    return { migrated: false };
  }
  log("Creating bed_weekly_rates table…");
  await runner.query(`
    CREATE TABLE IF NOT EXISTS bed_weekly_rates (
      id text PRIMARY KEY,
      bed_id text NOT NULL,
      effective_pay_week_end_date text NOT NULL,
      weekly_rate double precision NOT NULL DEFAULT 0,
      source text NOT NULL DEFAULT 'manual',
      note text NOT NULL DEFAULT '',
      created_at timestamptz DEFAULT now()
    )
  `);
  await runner.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS bed_weekly_rates_bed_week_unique
      ON bed_weekly_rates (bed_id, effective_pay_week_end_date)
  `);
  await runner.query(`
    CREATE INDEX IF NOT EXISTS bed_weekly_rates_bed_idx
      ON bed_weekly_rates (bed_id)
  `);
  log("bed_weekly_rates table created.");
  return { migrated: true };
}
