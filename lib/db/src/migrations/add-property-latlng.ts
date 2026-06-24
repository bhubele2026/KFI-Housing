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
 * Overhaul refinement #17 — map toggle on Properties. Adds nullable lat/lng
 * (double precision) so properties can be pinned; null until geocoded. Additive,
 * runs before pushSchema, no-op once present.
 */
export async function addPropertyLatLngIfNeeded(
  pool: Pool | undefined,
  log: (message: string, extra?: Record<string, unknown>) => void = () => {},
): Promise<{ migrated: boolean }> {
  if (!pool || typeof (pool as { query?: unknown }).query !== "function") {
    return { migrated: false };
  }
  const runner = pool as unknown as QueryRunner;
  if (!(await tableExists(runner, "properties"))) return { migrated: false };
  log("Adding properties.lat/lng columns…");
  await runner.query(
    `ALTER TABLE properties ADD COLUMN IF NOT EXISTS lat double precision`,
  );
  await runner.query(
    `ALTER TABLE properties ADD COLUMN IF NOT EXISTS lng double precision`,
  );
  return { migrated: true };
}
