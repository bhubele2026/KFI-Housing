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
 * Idempotent migration that provisions `vehicle_fuel_charges` BEFORE
 * drizzle's pushSchema runs. Mirrors the create-*-table convention.
 */
export async function createVehicleFuelChargesTableIfNeeded(
  pool: Pool | undefined,
  log: (message: string, extra?: Record<string, unknown>) => void = () => {},
): Promise<{ migrated: boolean }> {
  if (!pool || typeof (pool as { query?: unknown }).query !== "function") {
    return { migrated: false };
  }
  const runner = pool as unknown as QueryRunner;
  if (await tableExists(runner, "vehicle_fuel_charges")) {
    return { migrated: false };
  }

  log("Creating vehicle_fuel_charges table…");
  await runner.query(`
    CREATE TABLE IF NOT EXISTS vehicle_fuel_charges (
      id text PRIMARY KEY,
      vehicle_id text NOT NULL,
      date text NOT NULL DEFAULT '',
      amount double precision NOT NULL DEFAULT 0,
      gallons double precision NOT NULL DEFAULT 0,
      merchant text NOT NULL DEFAULT '',
      card_last4 text NOT NULL DEFAULT '',
      note text NOT NULL DEFAULT '',
      created_at timestamptz DEFAULT now()
    )
  `);
  await runner.query(`
    CREATE INDEX IF NOT EXISTS vehicle_fuel_charges_vehicle_date_idx
      ON vehicle_fuel_charges (vehicle_id, date)
  `);

  return { migrated: true };
}
