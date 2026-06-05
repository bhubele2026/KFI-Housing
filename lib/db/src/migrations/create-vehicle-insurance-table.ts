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
 * Idempotent migration that provisions `vehicle_insurance` BEFORE drizzle's
 * pushSchema runs. Mirrors the create-*-table convention.
 */
export async function createVehicleInsuranceTableIfNeeded(
  pool: Pool | undefined,
  log: (message: string, extra?: Record<string, unknown>) => void = () => {},
): Promise<{ migrated: boolean }> {
  if (!pool || typeof (pool as { query?: unknown }).query !== "function") {
    return { migrated: false };
  }
  const runner = pool as unknown as QueryRunner;
  if (await tableExists(runner, "vehicle_insurance")) {
    return { migrated: false };
  }

  log("Creating vehicle_insurance table…");
  await runner.query(`
    CREATE TABLE IF NOT EXISTS vehicle_insurance (
      id text PRIMARY KEY,
      vehicle_id text NOT NULL,
      carrier text NOT NULL DEFAULT '',
      policy_number text NOT NULL DEFAULT '',
      coverage text NOT NULL DEFAULT '',
      premium double precision NOT NULL DEFAULT 0,
      effective_date text NOT NULL DEFAULT '',
      expiry_date text NOT NULL DEFAULT '',
      document_url text NOT NULL DEFAULT '',
      note text NOT NULL DEFAULT '',
      created_at timestamptz DEFAULT now()
    )
  `);
  await runner.query(`
    CREATE INDEX IF NOT EXISTS vehicle_insurance_vehicle_idx
      ON vehicle_insurance (vehicle_id)
  `);

  return { migrated: true };
}
