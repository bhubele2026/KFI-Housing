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
 * Idempotent migration that provisions the `app_users` + `app_invites`
 * tables (team auth) BEFORE drizzle's pushSchema diffs the schema. Same
 * pattern as create-payroll-deductions-table.ts — every statement is
 * `IF NOT EXISTS`, so re-runs are no-ops.
 */
export async function createAppUsersTablesIfNeeded(
  pool: Pool | undefined,
  log: (message: string, extra?: Record<string, unknown>) => void = () => {},
): Promise<{ migrated: boolean }> {
  if (!pool || typeof (pool as { query?: unknown }).query !== "function") {
    return { migrated: false };
  }
  const runner = pool as unknown as QueryRunner;
  const usersExists = await tableExists(runner, "app_users");
  const invitesExists = await tableExists(runner, "app_invites");
  if (usersExists && invitesExists) return { migrated: false };

  if (!usersExists) {
    log("Creating app_users table…");
    await runner.query(`
      CREATE TABLE IF NOT EXISTS app_users (
        id text PRIMARY KEY,
        clerk_user_id text NOT NULL,
        email text NOT NULL,
        name text NOT NULL DEFAULT '',
        role text NOT NULL DEFAULT 'member',
        created_at timestamptz NOT NULL DEFAULT now(),
        last_seen_at timestamptz
      )
    `);
    await runner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS app_users_clerk_user_id_unique
        ON app_users (clerk_user_id)
    `);
    await runner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS app_users_email_unique
        ON app_users (email)
    `);
  }

  if (!invitesExists) {
    log("Creating app_invites table…");
    await runner.query(`
      CREATE TABLE IF NOT EXISTS app_invites (
        id text PRIMARY KEY,
        email text NOT NULL,
        role text NOT NULL DEFAULT 'member',
        invited_by_user_id text NOT NULL DEFAULT '',
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await runner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS app_invites_email_unique
        ON app_invites (email)
    `);
  }

  return { migrated: true };
}
