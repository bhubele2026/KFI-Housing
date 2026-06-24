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
 * Idempotent migration (Stage 5) that adds `vehicles.color` — the only
 * vehicle field on the managers' transport sheet not already modelled.
 * NOT NULL with an empty-string sentinel matching the other vehicle text
 * columns. Runs BEFORE drizzle's pushSchema so a deployed DB catches it up
 * at boot; the migration is a no-op once the column (or the table itself,
 * on a fresh DB) is absent/already present.
 */
export async function addVehicleColorIfNeeded(
  pool: Pool | undefined,
  log: (message: string, extra?: Record<string, unknown>) => void = () => {},
): Promise<{ migrated: boolean }> {
  if (!pool || typeof (pool as { query?: unknown }).query !== "function") {
    return { migrated: false };
  }

  const runner = pool as unknown as QueryRunner;

  if (!(await tableExists(runner, "vehicles"))) {
    return { migrated: false };
  }

  if (await columnExists(runner, "vehicles", "color")) {
    return { migrated: false };
  }

  log("Adding vehicles.color column…");
  await runner.query(
    `ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS color text NOT NULL DEFAULT ''`,
  );
  log("vehicles.color column added.");

  return { migrated: true };
}
