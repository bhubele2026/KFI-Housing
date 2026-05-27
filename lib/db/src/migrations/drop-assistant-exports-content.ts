import type { Pool } from "pg";

interface QueryRunner {
  query: (
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number }>;
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
 * Task #684: move generated assistant exports out of Postgres and into
 * object storage. Drops the legacy `assistant_exports.content` bytea
 * column and adds `assistant_exports.storage_key` (NOT NULL) BEFORE
 * drizzle's pushSchema runs so the diff afterwards is empty and free
 * of any data-loss warnings (pushSchema would otherwise refuse to drop
 * a column).
 *
 * Existing rows are deleted up-front: assistant exports are transient
 * by design (24h TTL, scheduled prune) and the legacy bytes have no
 * corresponding object in storage to back-fill from, so they are
 * unreachable post-migration anyway. The hourly cleanup scheduler
 * would have removed them within an hour regardless.
 *
 * Skips silently when:
 *  - the database isn't yet provisioned (pool.query unavailable),
 *  - the `assistant_exports` table doesn't exist (fresh database —
 *    drizzle will create it with the new shape on first pushSchema), or
 *  - the migration has already run (no `content` column to drop AND
 *    `storage_key` already in place).
 */
export async function dropAssistantExportsContentIfNeeded(
  pool: Pool | undefined,
  log: (message: string, extra?: Record<string, unknown>) => void = () => {},
): Promise<{ migrated: boolean }> {
  if (!pool || typeof (pool as { query?: unknown }).query !== "function") {
    return { migrated: false };
  }
  const runner = pool as unknown as QueryRunner;

  if (!(await tableExists(runner, "assistant_exports"))) {
    return { migrated: false };
  }

  const hasContent = await columnExists(runner, "assistant_exports", "content");
  const hasStorageKey = await columnExists(
    runner,
    "assistant_exports",
    "storage_key",
  );
  if (!hasContent && hasStorageKey) {
    return { migrated: false };
  }

  log(
    "Migrating assistant_exports off bytea content column to storage_key…",
  );

  // Transient rows (24h TTL) with no corresponding object in storage
  // — drop them so we can add a NOT NULL column without a default.
  await runner.query(`DELETE FROM assistant_exports`);

  if (!hasStorageKey) {
    await runner.query(
      `ALTER TABLE assistant_exports
         ADD COLUMN storage_key text NOT NULL DEFAULT ''`,
    );
    await runner.query(
      `ALTER TABLE assistant_exports ALTER COLUMN storage_key DROP DEFAULT`,
    );
  }

  if (hasContent) {
    await runner.query(
      `ALTER TABLE assistant_exports DROP COLUMN IF EXISTS content`,
    );
  }

  log("assistant_exports.content dropped; storage_key in place.");
  return { migrated: true };
}
