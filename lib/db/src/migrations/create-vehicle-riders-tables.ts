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
 * Idempotent migration that provisions the two rider-roster tables
 * (`vehicle_riders`, `vehicle_ride_overrides`) BEFORE drizzle's
 * pushSchema runs. Mirrors the create-*-table convention: safe to
 * re-run, no-op once the tables exist. Column defaults mirror
 * `lib/db/src/schema/vehicle-riders.ts`.
 */
export async function createVehicleRidersTablesIfNeeded(
  pool: Pool | undefined,
  log: (message: string, extra?: Record<string, unknown>) => void = () => {},
): Promise<{ migrated: boolean }> {
  if (!pool || typeof (pool as { query?: unknown }).query !== "function") {
    return { migrated: false };
  }
  const runner = pool as unknown as QueryRunner;
  let migrated = false;

  if (!(await tableExists(runner, "vehicle_riders"))) {
    log("Creating vehicle_riders table…");
    await runner.query(`
      CREATE TABLE IF NOT EXISTS vehicle_riders (
        id text PRIMARY KEY,
        vehicle_id text NOT NULL,
        occupant_id text NOT NULL,
        created_at timestamptz DEFAULT now()
      )
    `);
    await runner.query(`
      CREATE INDEX IF NOT EXISTS vehicle_riders_vehicle_id_idx
        ON vehicle_riders (vehicle_id)
    `);
    await runner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS vehicle_riders_vehicle_occupant_unique
        ON vehicle_riders (vehicle_id, occupant_id)
    `);
    migrated = true;
  }

  if (!(await tableExists(runner, "vehicle_ride_overrides"))) {
    log("Creating vehicle_ride_overrides table…");
    await runner.query(`
      CREATE TABLE IF NOT EXISTS vehicle_ride_overrides (
        id text PRIMARY KEY,
        vehicle_id text NOT NULL,
        occupant_id text NOT NULL,
        date text NOT NULL DEFAULT '',
        action text NOT NULL DEFAULT 'add',
        note text NOT NULL DEFAULT '',
        created_at timestamptz DEFAULT now()
      )
    `);
    await runner.query(`
      CREATE INDEX IF NOT EXISTS vehicle_ride_overrides_vehicle_date_idx
        ON vehicle_ride_overrides (vehicle_id, date)
    `);
    await runner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS vehicle_ride_overrides_unique
        ON vehicle_ride_overrides (vehicle_id, occupant_id, date)
    `);
    migrated = true;
  }

  return { migrated };
}
