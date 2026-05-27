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
 * Idempotent migration that provisions the `assistant_nudges` +
 * `assistant_scanner_runs` tables BEFORE drizzle's pushSchema runs
 * (Task #671). Same pattern as create-assistant-uploads-table.ts — every
 * statement is `IF NOT EXISTS`, so re-runs are no-ops.
 */
export async function createAssistantNudgesTablesIfNeeded(
  pool: Pool | undefined,
  log: (message: string, extra?: Record<string, unknown>) => void = () => {},
): Promise<{ migrated: boolean }> {
  if (!pool || typeof (pool as { query?: unknown }).query !== "function") {
    return { migrated: false };
  }
  const runner = pool as unknown as QueryRunner;
  const nudgesExists = await tableExists(runner, "assistant_nudges");
  const runsExists = await tableExists(runner, "assistant_scanner_runs");
  if (nudgesExists && runsExists) return { migrated: false };

  if (!nudgesExists) {
    log("Creating assistant_nudges table…");
    await runner.query(`
      CREATE TABLE IF NOT EXISTS assistant_nudges (
        id text PRIMARY KEY,
        user_id text NOT NULL,
        customer_id text,
        rule_key text NOT NULL,
        source text NOT NULL,
        severity text NOT NULL DEFAULT 'info',
        title text NOT NULL,
        body text NOT NULL DEFAULT '',
        cta_label text,
        cta_prompt text,
        page_pattern text,
        anchor_type text,
        anchor_id text,
        related_proposal_id text,
        created_at timestamptz NOT NULL DEFAULT now(),
        dismissed_at timestamptz,
        snoozed_until timestamptz
      )
    `);
    await runner.query(`
      CREATE INDEX IF NOT EXISTS assistant_nudges_active_idx
        ON assistant_nudges (user_id, dismissed_at, snoozed_until)
    `);
    await runner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS assistant_nudges_user_rule_unique
        ON assistant_nudges (user_id, rule_key)
    `);
    await runner.query(`
      CREATE INDEX IF NOT EXISTS assistant_nudges_anchor_idx
        ON assistant_nudges (anchor_type, anchor_id)
    `);
  }

  if (!runsExists) {
    log("Creating assistant_scanner_runs table…");
    await runner.query(`
      CREATE TABLE IF NOT EXISTS assistant_scanner_runs (
        check_name text PRIMARY KEY,
        last_run_at timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  return { migrated: true };
}
