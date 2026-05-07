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

async function columnIsNotNull(
  c: QueryRunner,
  table: string,
  column: string,
): Promise<boolean> {
  const r = await c.query(
    `SELECT is_nullable
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
        AND column_name = $2`,
    [table, column],
  );
  if (r.rows.length === 0) return false;
  return r.rows[0]["is_nullable"] === "NO";
}

/**
 * Idempotent migration that relaxes `leases.customer_id` from
 * `NOT NULL DEFAULT ''` to a plain nullable text column, and
 * backfills any existing empty-string rows to `NULL` (Task #439).
 *
 * Why: the lease-level customer override is supposed to be either
 * "set" or "fall back to the property's customerId". The legacy
 * empty-string sentinel collided with `??` fallbacks elsewhere
 * (e.g. `getCustomerResponsibleLeases`), so the canonical sentinel
 * is now `NULL` end-to-end. The API endpoints + seeders coerce
 * blank → NULL on write; this migration cleans up rows that already
 * landed in the DB before the coercion was in place.
 *
 * Runs BEFORE drizzle's pushSchema so the schema diff afterwards is
 * empty — pushSchema would otherwise see the constraint change but
 * not know to backfill the existing values.
 *
 * Skips silently when:
 *  - the database isn't yet provisioned (pool.query unavailable in tests),
 *  - the `leases` table doesn't exist (fresh database — drizzle will
 *    create the new nullable shape from scratch), or
 *  - the migration has already run (column is already nullable).
 */
export async function migrateLeasesCustomerIdNullableIfNeeded(
  pool: Pool | undefined,
  log: (message: string, extra?: Record<string, unknown>) => void = () => {},
): Promise<{ migrated: boolean; rowsBackfilled: number }> {
  if (!pool || typeof (pool as { query?: unknown }).query !== "function") {
    return { migrated: false, rowsBackfilled: 0 };
  }

  const runner = pool as unknown as QueryRunner;

  const hasLeases = await tableExists(runner, "leases");
  if (!hasLeases) {
    return { migrated: false, rowsBackfilled: 0 };
  }

  const stillNotNull = await columnIsNotNull(runner, "leases", "customer_id");

  // Belt-and-braces: even if a previous partial run already relaxed
  // the column to nullable but crashed before the UPDATE landed, we
  // still want to mop up any stray `''` rows on the next pass. So
  // check for both conditions independently and only short-circuit
  // when neither has work to do.
  const blanksProbe = await runner.query(
    `SELECT count(*)::int AS c FROM leases WHERE customer_id = ''`,
  );
  const blanksRemaining = Number(blanksProbe.rows[0]?.["c"] ?? 0);

  if (!stillNotNull && blanksRemaining === 0) {
    return { migrated: false, rowsBackfilled: 0 };
  }

  log("Relaxing leases.customer_id to nullable and backfilling '' → NULL…", {
    stillNotNull,
    blanksRemaining,
  });
  if (stillNotNull) {
    // Wrap the schema change + backfill in a single transaction so a
    // mid-statement crash can't leave the column nullable while
    // legacy `''` rows are still in place (or vice versa).
    await runner.query(`BEGIN`);
    try {
      await runner.query(
        `ALTER TABLE leases ALTER COLUMN customer_id DROP DEFAULT`,
      );
      await runner.query(
        `ALTER TABLE leases ALTER COLUMN customer_id DROP NOT NULL`,
      );
      await runner.query(`COMMIT`);
    } catch (err) {
      await runner.query(`ROLLBACK`);
      throw err;
    }
  }

  const upd = await runner.query(
    `UPDATE leases SET customer_id = NULL WHERE customer_id = ''`,
  );
  // node-postgres exposes rowCount on UpdateResult but the QueryRunner
  // shim only types `rows` — read it defensively.
  const rowsBackfilled = Number(
    (upd as unknown as { rowCount?: number }).rowCount ?? 0,
  );
  log("leases.customer_id is now nullable.", { rowsBackfilled });

  return { migrated: true, rowsBackfilled };
}
