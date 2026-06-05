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
 * Idempotent migration that provisions `vehicle_maintenance` BEFORE
 * drizzle's pushSchema runs. Mirrors the create-*-table convention.
 */
export async function createVehicleMaintenanceTableIfNeeded(
  pool: Pool | undefined,
  log: (message: string, extra?: Record<string, unknown>) => void = () => {},
): Promise<{ migrated: boolean }> {
  if (!pool || typeof (pool as { query?: unknown }).query !== "function") {
    return { migrated: false };
  }
  const runner = pool as unknown as QueryRunner;
  if (await tableExists(runner, "vehicle_maintenance")) {
    return { migrated: false };
  }

  log("Creating vehicle_maintenance table…");
  await runner.query(`
    CREATE TABLE IF NOT EXISTS vehicle_maintenance (
      id text PRIMARY KEY,
      vehicle_id text NOT NULL,
      date text NOT NULL DEFAULT '',
      type text NOT NULL DEFAULT 'Repair',
      description text NOT NULL DEFAULT '',
      cost double precision NOT NULL DEFAULT 0,
      status text NOT NULL DEFAULT 'Needed',
      shop_name text NOT NULL DEFAULT '',
      completed_date text NOT NULL DEFAULT '',
      note text NOT NULL DEFAULT '',
      created_at timestamptz DEFAULT now()
    )
  `);
  await runner.query(`
    CREATE INDEX IF NOT EXISTS vehicle_maintenance_vehicle_idx
      ON vehicle_maintenance (vehicle_id, status)
  `);

  return { migrated: true };
}
