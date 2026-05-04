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
 * Idempotent migration that drops the legacy `leases.included_items` column.
 * Runs BEFORE drizzle's pushSchema so the schema diff afterwards is empty
 * (and free of any data-loss warnings — pushSchema would otherwise refuse to
 * apply the drop because it removes a column).
 *
 * Skips silently when:
 *  - the database isn't yet provisioned (pool.query unavailable in tests),
 *  - the `leases` table doesn't exist (fresh database — drizzle will create
 *    everything from the new schema), or
 *  - the migration has already run (no `included_items` column to drop).
 */
export async function dropLeaseIncludedItemsIfNeeded(
  pool: Pool | undefined,
  log: (message: string, extra?: Record<string, unknown>) => void = () => {},
): Promise<{ migrated: boolean }> {
  if (!pool || typeof (pool as { query?: unknown }).query !== "function") {
    return { migrated: false };
  }

  const hasLeases = await tableExists(
    pool as unknown as QueryRunner,
    "leases",
  );
  if (!hasLeases) {
    return { migrated: false };
  }

  const hasIncludedItems = await columnExists(
    pool as unknown as QueryRunner,
    "leases",
    "included_items",
  );
  if (!hasIncludedItems) {
    return { migrated: false };
  }

  log("Dropping legacy leases.included_items column…");
  await (pool as unknown as QueryRunner).query(
    `ALTER TABLE leases DROP COLUMN IF EXISTS included_items`,
  );
  log("leases.included_items dropped.");

  return { migrated: true };
}
