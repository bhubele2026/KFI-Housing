import type { Pool } from "pg";

interface QueryRunner {
  query: (
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: Record<string, unknown>[] }>;
}

async function columnExists(
  c: QueryRunner,
  table: string,
  column: string,
): Promise<boolean> {
  const r = await c.query(
    `SELECT 1
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
        AND column_name = $2`,
    [table, column],
  );
  return r.rows.length > 0;
}

async function tableExists(c: QueryRunner, table: string): Promise<boolean> {
  const r = await c.query(
    `SELECT to_regclass($1) IS NOT NULL AS exists`,
    [`public.${table}`],
  );
  return Boolean(r.rows[0]?.["exists"]);
}

/**
 * Child tables whose writes count as activity on their parent
 * property. Each table carries a `property_id` text column referencing
 * `properties.id`; an AFTER INSERT/UPDATE/DELETE trigger on each one
 * bumps the parent's `updated_at` so the assistant scanner's
 * "dormant property" check (Task #671) can read `updated_at` directly
 * instead of inferring activity from related rows.
 */
const CHILD_TABLES = [
  "leases",
  "occupants",
  "beds",
  "rooms",
  "buildings",
  "utilities",
  "other_costs",
  "insurance_certificates",
  "property_violations",
  "projected_move_ins",
  "payroll_deductions",
] as const;

/**
 * Idempotent migration (Task #676) that:
 *   1. Adds `properties.updated_at timestamptz NOT NULL DEFAULT now()`
 *      and backfills existing rows to `now()` so every property has a
 *      sensible baseline activity timestamp.
 *   2. Installs `properties_set_updated_at` BEFORE UPDATE on
 *      `properties` so any direct mutation refreshes the timestamp.
 *   3. Installs `properties_touch_from_<child>` AFTER INSERT/UPDATE/
 *      DELETE on every child table that carries a `property_id`, so
 *      writes to leases, occupants, beds, rooms, buildings,
 *      utilities, other costs, insurance certificates, property
 *      violations, projected move-ins and payroll deductions all
 *      count as activity on the parent property.
 *
 * Runs BEFORE drizzle's pushSchema so the diff afterwards is empty.
 * Safe to re-run — every step is `IF NOT EXISTS` / `CREATE OR REPLACE`,
 * and the trigger drops are guarded by a child-table existence check
 * so an early-boot DB (where the child tables haven't been created
 * yet) is a no-op for those triggers; the next boot, after pushSchema
 * provisions the missing child tables, picks up the triggers.
 */
export async function addPropertyUpdatedAtIfNeeded(
  pool: Pool | undefined,
  log: (message: string, extra?: Record<string, unknown>) => void = () => {},
): Promise<{ migrated: boolean }> {
  if (!pool || typeof (pool as { query?: unknown }).query !== "function") {
    return { migrated: false };
  }
  const runner = pool as unknown as QueryRunner;

  if (!(await tableExists(runner, "properties"))) {
    return { migrated: false };
  }

  let migrated = false;

  if (!(await columnExists(runner, "properties", "updated_at"))) {
    log("Adding properties.updated_at column…");
    await runner.query(
      `ALTER TABLE properties
         ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now()`,
    );
    migrated = true;
  }

  // Trigger function: refresh updated_at on direct UPDATEs to properties.
  await runner.query(`
    CREATE OR REPLACE FUNCTION properties_set_updated_at()
    RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      NEW.updated_at := now();
      RETURN NEW;
    END;
    $$
  `);
  // (Re-)create the BEFORE UPDATE trigger idempotently.
  await runner.query(`DROP TRIGGER IF EXISTS properties_set_updated_at ON properties`);
  await runner.query(`
    CREATE TRIGGER properties_set_updated_at
      BEFORE UPDATE ON properties
      FOR EACH ROW
      EXECUTE FUNCTION properties_set_updated_at()
  `);

  // Trigger function: bump parent property's updated_at from a child
  // row write. Uses NEW.property_id on INSERT/UPDATE and OLD.property_id
  // on DELETE; tolerates a NULL property_id (occupants.property_id is
  // nullable) by skipping the bump.
  await runner.query(`
    CREATE OR REPLACE FUNCTION touch_property_from_child()
    RETURNS trigger
    LANGUAGE plpgsql AS $$
    DECLARE
      pid text;
    BEGIN
      IF TG_OP = 'DELETE' THEN
        pid := OLD.property_id;
      ELSE
        pid := NEW.property_id;
      END IF;
      IF pid IS NOT NULL AND pid <> '' THEN
        UPDATE properties SET updated_at = now() WHERE id = pid;
      END IF;
      IF TG_OP = 'UPDATE' AND NEW.property_id IS DISTINCT FROM OLD.property_id THEN
        IF OLD.property_id IS NOT NULL AND OLD.property_id <> '' THEN
          UPDATE properties SET updated_at = now() WHERE id = OLD.property_id;
        END IF;
      END IF;
      RETURN NULL;
    END;
    $$
  `);

  for (const child of CHILD_TABLES) {
    if (!(await tableExists(runner, child))) continue;
    const triggerName = `touch_property_from_${child}`;
    await runner.query(`DROP TRIGGER IF EXISTS ${triggerName} ON ${child}`);
    await runner.query(`
      CREATE TRIGGER ${triggerName}
        AFTER INSERT OR UPDATE OR DELETE ON ${child}
        FOR EACH ROW
        EXECUTE FUNCTION touch_property_from_child()
    `);
  }

  if (migrated) {
    log("properties.updated_at column + activity triggers installed.");
  }
  return { migrated };
}
