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
    `SELECT 1 AS exists FROM information_schema.columns
       WHERE table_schema='public' AND table_name=$1 AND column_name=$2`,
    [table, column],
  );
  return r.rows.length > 0;
}

/**
 * Idempotent migration that provisions the four QBO tables (Task #689)
 * BEFORE drizzle's pushSchema runs. Mirrors the pattern used by the
 * other create-*-table migrations: safe to re-run, no-op once the
 * tables exist.
 *
 * Also adds the nullable `customers.qbo_customer_id` column used by
 * the mapping pipeline to short-circuit the qboCustomerId → customer
 * lookup.
 */
export async function createQboTablesIfNeeded(
  pool: Pool | undefined,
  log: (message: string, extra?: Record<string, unknown>) => void = () => {},
): Promise<{ migrated: boolean }> {
  if (!pool || typeof (pool as { query?: unknown }).query !== "function") {
    return { migrated: false };
  }
  const runner = pool as unknown as QueryRunner;

  let migrated = false;

  if (
    (await tableExists(runner, "customers")) &&
    !(await columnExists(runner, "customers", "qbo_customer_id"))
  ) {
    log("Adding customers.qbo_customer_id column…");
    await runner.query(
      `ALTER TABLE customers ADD COLUMN IF NOT EXISTS qbo_customer_id text`,
    );
    await runner.query(
      `CREATE INDEX IF NOT EXISTS customers_qbo_customer_id_idx
         ON customers (qbo_customer_id)`,
    );
    migrated = true;
  }

  if (!(await tableExists(runner, "qbo_connections"))) {
    log("Creating qbo_connections table…");
    await runner.query(`
      CREATE TABLE IF NOT EXISTS qbo_connections (
        id text PRIMARY KEY,
        realm_id text NOT NULL,
        company_name text NOT NULL DEFAULT '',
        environment text NOT NULL DEFAULT 'production',
        access_token text NOT NULL DEFAULT '',
        access_token_expires_at timestamptz,
        refresh_token text NOT NULL DEFAULT '',
        refresh_token_expires_at timestamptz,
        connected_by_user_id text NOT NULL DEFAULT '',
        connected_at timestamptz DEFAULT now(),
        last_sync_at timestamptz,
        last_sync_started_at timestamptz,
        last_sync_error text NOT NULL DEFAULT '',
        last_sync_cursor text NOT NULL DEFAULT '',
        historical_pull_progress text NOT NULL DEFAULT ''
      )
    `);
    await runner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS qbo_connections_realm_unique
        ON qbo_connections (realm_id)
    `);
    migrated = true;
  }

  if (!(await tableExists(runner, "qbo_transactions"))) {
    log("Creating qbo_transactions table…");
    await runner.query(`
      CREATE TABLE IF NOT EXISTS qbo_transactions (
        id text PRIMARY KEY,
        qbo_id text NOT NULL,
        realm_id text NOT NULL,
        type text NOT NULL,
        txn_date text NOT NULL DEFAULT '',
        qbo_customer_id text NOT NULL DEFAULT '',
        qbo_vendor_id text NOT NULL DEFAULT '',
        customer_id text,
        property_id text,
        lease_id text,
        utility_id text,
        classification text NOT NULL DEFAULT 'other',
        amount double precision NOT NULL DEFAULT 0,
        balance double precision NOT NULL DEFAULT 0,
        currency text NOT NULL DEFAULT 'USD',
        memo text NOT NULL DEFAULT '',
        location_name text NOT NULL DEFAULT '',
        account_name text NOT NULL DEFAULT '',
        account_id text NOT NULL DEFAULT '',
        raw_json jsonb NOT NULL DEFAULT '{}'::jsonb,
        mapped_confidence double precision NOT NULL DEFAULT 0,
        manual_override boolean NOT NULL DEFAULT false,
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now()
      )
    `);
    await runner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS qbo_transactions_qbo_id_unique
        ON qbo_transactions (realm_id, qbo_id, type)
    `);
    await runner.query(`
      CREATE INDEX IF NOT EXISTS qbo_transactions_property_date_idx
        ON qbo_transactions (property_id, txn_date)
    `);
    await runner.query(`
      CREATE INDEX IF NOT EXISTS qbo_transactions_customer_date_idx
        ON qbo_transactions (customer_id, txn_date)
    `);
    await runner.query(`
      CREATE INDEX IF NOT EXISTS qbo_transactions_classification_idx
        ON qbo_transactions (property_id, classification, txn_date)
    `);
    await runner.query(`
      CREATE INDEX IF NOT EXISTS qbo_transactions_unmapped_idx
        ON qbo_transactions (property_id) WHERE property_id IS NULL
    `);
    migrated = true;
  }

  if (!(await tableExists(runner, "qbo_account_classifications"))) {
    log("Creating qbo_account_classifications table…");
    await runner.query(`
      CREATE TABLE IF NOT EXISTS qbo_account_classifications (
        id text PRIMARY KEY,
        realm_id text NOT NULL,
        qbo_account_id text NOT NULL DEFAULT '',
        account_name text NOT NULL DEFAULT '',
        classification text NOT NULL DEFAULT 'other',
        edited_by_user_id text,
        edited_at timestamptz
      )
    `);
    await runner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS qbo_account_classifications_unique
        ON qbo_account_classifications (realm_id, qbo_account_id, account_name)
    `);
    migrated = true;
  }

  if (!(await tableExists(runner, "qbo_mapping_overrides"))) {
    log("Creating qbo_mapping_overrides table…");
    await runner.query(`
      CREATE TABLE IF NOT EXISTS qbo_mapping_overrides (
        id text PRIMARY KEY,
        realm_id text NOT NULL,
        qbo_customer_id text NOT NULL DEFAULT '',
        qbo_vendor_id text NOT NULL DEFAULT '',
        memo_token text NOT NULL DEFAULT '',
        property_id text NOT NULL,
        lease_id text,
        utility_id text,
        created_by_user_id text NOT NULL DEFAULT '',
        created_at timestamptz DEFAULT now()
      )
    `);
    await runner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS qbo_mapping_overrides_unique
        ON qbo_mapping_overrides (realm_id, qbo_customer_id, qbo_vendor_id, memo_token)
    `);
    migrated = true;
  } else if (!(await columnExists(runner, "qbo_mapping_overrides", "qbo_vendor_id"))) {
    // Forward-migrate older deployments: add the vendor dimension and
    // recreate the unique index to include it. Without this, bill-side
    // overrides keyed on an empty customer id collide across vendors.
    log("Adding qbo_mapping_overrides.qbo_vendor_id column…");
    await runner.query(
      `ALTER TABLE qbo_mapping_overrides
         ADD COLUMN IF NOT EXISTS qbo_vendor_id text NOT NULL DEFAULT ''`,
    );
    await runner.query(`DROP INDEX IF EXISTS qbo_mapping_overrides_unique`);
    await runner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS qbo_mapping_overrides_unique
        ON qbo_mapping_overrides (realm_id, qbo_customer_id, qbo_vendor_id, memo_token)
    `);
    migrated = true;
  }

  return { migrated };
}
