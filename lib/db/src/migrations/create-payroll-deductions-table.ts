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
 * Idempotent migration that provisions the `payroll_deductions` table
 * (Task #597) BEFORE drizzle's pushSchema runs.
 *
 * Why a hand-rolled migration in addition to the drizzle-managed
 * schema?
 *  - Deployed environments that already started writing payroll
 *    snapshots need the table to exist on the very first request that
 *    hits `/api/payroll/unplaced?...payWeekEndDate=...` after the
 *    rollout — pushSchema runs at boot, so this migration tightens the
 *    invariant for setups where pushSchema is configured to skip on
 *    boot (CI / read-replica use-cases).
 *  - Re-runs are safe: every statement is `IF NOT EXISTS`, so once
 *    pushSchema or this migration has created the table it is a no-op.
 *
 * Skips silently when:
 *  - the database isn't yet provisioned (pool.query unavailable in
 *    tests),
 *  - the table already exists (no-op).
 */
export async function createPayrollDeductionsTableIfNeeded(
  pool: Pool | undefined,
  log: (message: string, extra?: Record<string, unknown>) => void = () => {},
): Promise<{ migrated: boolean }> {
  if (!pool || typeof (pool as { query?: unknown }).query !== "function") {
    return { migrated: false };
  }

  const runner = pool as unknown as QueryRunner;
  if (await tableExists(runner, "payroll_deductions")) {
    return { migrated: false };
  }

  log("Creating payroll_deductions table…");
  await runner.query(`
    CREATE TABLE IF NOT EXISTS payroll_deductions (
      id text PRIMARY KEY,
      occupant_id text NOT NULL,
      customer_id text NOT NULL DEFAULT '',
      property_id text NOT NULL DEFAULT '',
      pay_week_end_date text NOT NULL,
      weekly_amount double precision NOT NULL DEFAULT 0,
      person_id text NOT NULL DEFAULT '',
      name_snapshot text NOT NULL DEFAULT '',
      customer_snapshot text NOT NULL DEFAULT '',
      source text NOT NULL DEFAULT 'payroll_import',
      imported_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz DEFAULT now()
    )
  `);
  await runner.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS payroll_deductions_occupant_week_unique
      ON payroll_deductions (occupant_id, pay_week_end_date)
  `);
  await runner.query(`
    CREATE INDEX IF NOT EXISTS payroll_deductions_week_idx
      ON payroll_deductions (pay_week_end_date)
  `);
  await runner.query(`
    CREATE INDEX IF NOT EXISTS payroll_deductions_customer_week_idx
      ON payroll_deductions (customer_id, pay_week_end_date)
  `);
  log("payroll_deductions table created.");
  return { migrated: true };
}
