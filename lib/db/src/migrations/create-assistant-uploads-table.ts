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

/**
 * Idempotent migration that provisions the `assistant_uploads` table
 * (Task #647) BEFORE drizzle's pushSchema runs. The assistant's
 * file-upload proposals (import master leases / payroll deductions /
 * lease PDFs) reference an upload by id, so the table must exist on
 * the very first request after rollout even when pushSchema is
 * configured to skip on boot.
 */
export async function createAssistantUploadsTableIfNeeded(
  pool: Pool | undefined,
  log: (message: string, extra?: Record<string, unknown>) => void = () => {},
): Promise<{ migrated: boolean }> {
  if (!pool || typeof (pool as { query?: unknown }).query !== "function") {
    return { migrated: false };
  }

  const runner = pool as unknown as QueryRunner;
  if (await tableExists(runner, "assistant_uploads")) {
    return { migrated: false };
  }

  log("Creating assistant_uploads table…");
  await runner.query(`
    CREATE TABLE IF NOT EXISTS assistant_uploads (
      id text PRIMARY KEY,
      conversation_id text,
      user_id text NOT NULL DEFAULT '',
      filename text NOT NULL DEFAULT '',
      mime text NOT NULL DEFAULT '',
      size_bytes integer NOT NULL DEFAULT 0,
      content bytea NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await runner.query(`
    CREATE INDEX IF NOT EXISTS assistant_uploads_conversation_idx
      ON assistant_uploads (conversation_id)
  `);
  log("assistant_uploads table created.");
  return { migrated: true };
}
