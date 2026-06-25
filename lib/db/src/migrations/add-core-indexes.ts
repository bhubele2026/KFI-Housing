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
 * The b-tree indexes on the foreign-key + status columns the big list
 * endpoints filter by most. Names MUST match the `index(...)` definitions
 * in `schema/*.ts` so that after this migration runs, drizzle's pushSchema
 * sees no diff (the index already exists under the same name).
 */
const CORE_INDEXES: ReadonlyArray<{
  index: string;
  table: string;
  column: string;
}> = [
  { index: "beds_property_id_idx", table: "beds", column: "property_id" },
  { index: "beds_room_id_idx", table: "beds", column: "room_id" },
  { index: "occupants_status_idx", table: "occupants", column: "status" },
  { index: "occupants_property_id_idx", table: "occupants", column: "property_id" },
  { index: "occupants_bed_id_idx", table: "occupants", column: "bed_id" },
  { index: "leases_property_id_idx", table: "leases", column: "property_id" },
  { index: "leases_customer_id_idx", table: "leases", column: "customer_id" },
  { index: "leases_building_id_idx", table: "leases", column: "building_id" },
  { index: "rooms_property_id_idx", table: "rooms", column: "property_id" },
  { index: "rooms_building_id_idx", table: "rooms", column: "building_id" },
  { index: "properties_customer_id_idx", table: "properties", column: "customer_id" },
];

/**
 * Idempotent migration that creates the core foreign-key / status indexes
 * (perf pass) BEFORE drizzle's pushSchema, so a deployed DB picks them up
 * at boot instead of waiting for a separate push. Purely additive — adds
 * indexes only, never touches columns or data.
 *
 * Each index is created with `CREATE INDEX IF NOT EXISTS` (idempotent in
 * Postgres) and is additionally guarded so it is skipped when the table or
 * column doesn't exist yet (fresh DB — pushSchema will create the table
 * with its indexes on the first run).
 */
export async function addCoreIndexesIfNeeded(
  pool: Pool | undefined,
  log: (message: string, extra?: Record<string, unknown>) => void = () => {},
): Promise<{ migrated: boolean; createdIndexes: string[] }> {
  if (!pool || typeof (pool as { query?: unknown }).query !== "function") {
    return { migrated: false, createdIndexes: [] };
  }
  const runner = pool as unknown as QueryRunner;

  const createdIndexes: string[] = [];
  for (const { index, table, column } of CORE_INDEXES) {
    if (!(await tableExists(runner, table))) continue;
    if (!(await columnExists(runner, table, column))) continue;
    await runner.query(
      `CREATE INDEX IF NOT EXISTS ${index} ON ${table} (${column})`,
    );
    createdIndexes.push(index);
  }

  if (createdIndexes.length > 0) {
    log("Ensured core foreign-key / status indexes.", { createdIndexes });
  }
  return { migrated: createdIndexes.length > 0, createdIndexes };
}
