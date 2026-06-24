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
 * Idempotent migration that provisions `weekly_reviews` BEFORE drizzle's
 * pushSchema runs (Completion Runbook section B — Money review). Mirrors the
 * create-*-table convention; re-runs are no-ops once the table exists.
 */
export async function createWeeklyReviewsTableIfNeeded(
  pool: Pool | undefined,
  log: (message: string, extra?: Record<string, unknown>) => void = () => {},
): Promise<{ migrated: boolean }> {
  if (!pool || typeof (pool as { query?: unknown }).query !== "function") {
    return { migrated: false };
  }
  const runner = pool as unknown as QueryRunner;
  if (await tableExists(runner, "weekly_reviews")) {
    return { migrated: false };
  }

  log("Creating weekly_reviews table…");
  await runner.query(`
    CREATE TABLE IF NOT EXISTS weekly_reviews (
      id text PRIMARY KEY,
      period_key text NOT NULL,
      reviewed_at timestamptz NOT NULL DEFAULT now(),
      reviewed_by text NOT NULL DEFAULT '',
      note text NOT NULL DEFAULT '',
      created_at timestamptz DEFAULT now()
    )
  `);
  await runner.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS weekly_reviews_period_key_unique
      ON weekly_reviews (period_key)
  `);

  return { migrated: true };
}
