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
 * Idempotent migration that provisions the `vehicles` table (Transportation
 * section) BEFORE drizzle's pushSchema runs. Mirrors the create-*-table
 * pattern used elsewhere: safe to re-run, no-op once the table exists.
 *
 * Column defaults mirror `lib/db/src/schema/vehicles.ts` so a fresh row
 * created either by drizzle or by this migration is identical.
 */
export async function createVehiclesTableIfNeeded(
  pool: Pool | undefined,
  log: (message: string, extra?: Record<string, unknown>) => void = () => {},
): Promise<{ migrated: boolean }> {
  if (!pool || typeof (pool as { query?: unknown }).query !== "function") {
    return { migrated: false };
  }
  const runner = pool as unknown as QueryRunner;

  if (await tableExists(runner, "vehicles")) {
    return { migrated: false };
  }

  log("Creating vehicles table…");
  await runner.query(`
    CREATE TABLE IF NOT EXISTS vehicles (
      id text PRIMARY KEY,
      vin text NOT NULL DEFAULT '',
      plate text NOT NULL DEFAULT '',
      plate_state text NOT NULL DEFAULT '',
      year integer,
      make text NOT NULL DEFAULT '',
      model text NOT NULL DEFAULT '',
      seats integer NOT NULL DEFAULT 0,
      merchant_unit text NOT NULL DEFAULT '',
      book_value double precision NOT NULL DEFAULT 0,
      ownership text NOT NULL DEFAULT 'owned',
      monthly_cost double precision NOT NULL DEFAULT 0,
      customer_id text NOT NULL DEFAULT '',
      property_id text,
      driver_occupant_id text,
      status text NOT NULL DEFAULT 'Available',
      in_shop boolean NOT NULL DEFAULT false,
      repairs_needed text NOT NULL DEFAULT '',
      home_base_state text NOT NULL DEFAULT 'WI',
      current_location_note text NOT NULL DEFAULT '',
      associates_transported integer NOT NULL DEFAULT 0,
      registration_expires text NOT NULL DEFAULT '',
      odometer integer,
      notes text NOT NULL DEFAULT '',
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await runner.query(`
    CREATE INDEX IF NOT EXISTS vehicles_customer_id_idx
      ON vehicles (customer_id)
  `);
  await runner.query(`
    CREATE INDEX IF NOT EXISTS vehicles_property_id_idx
      ON vehicles (property_id)
  `);
  await runner.query(`
    CREATE INDEX IF NOT EXISTS vehicles_driver_occupant_id_idx
      ON vehicles (driver_occupant_id)
  `);

  return { migrated: true };
}
