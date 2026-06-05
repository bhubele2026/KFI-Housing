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

/**
 * Idempotent migration that provisions `vehicle_leases` BEFORE drizzle's
 * pushSchema runs. Mirrors the create-*-table convention.
 */
export async function createVehicleLeasesTableIfNeeded(
  pool: Pool | undefined,
  log: (message: string, extra?: Record<string, unknown>) => void = () => {},
): Promise<{ migrated: boolean }> {
  if (!pool || typeof (pool as { query?: unknown }).query !== "function") {
    return { migrated: false };
  }
  const runner = pool as unknown as QueryRunner;
  if (await tableExists(runner, "vehicle_leases")) {
    return { migrated: false };
  }

  log("Creating vehicle_leases table…");
  await runner.query(`
    CREATE TABLE IF NOT EXISTS vehicle_leases (
      id text PRIMARY KEY,
      vehicle_id text NOT NULL DEFAULT '',
      lessor text NOT NULL DEFAULT '',
      start_date text NOT NULL DEFAULT '',
      end_date text NOT NULL DEFAULT '',
      monthly_cost double precision NOT NULL DEFAULT 0,
      deposit double precision NOT NULL DEFAULT 0,
      buyout_cost double precision NOT NULL DEFAULT 0,
      deductions text NOT NULL DEFAULT '',
      status text NOT NULL DEFAULT 'Active',
      note text NOT NULL DEFAULT '',
      created_at timestamptz DEFAULT now()
    )
  `);
  await runner.query(`
    CREATE INDEX IF NOT EXISTS vehicle_leases_vehicle_idx
      ON vehicle_leases (vehicle_id)
  `);

  return { migrated: true };
}
