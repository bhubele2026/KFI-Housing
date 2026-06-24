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
        WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
     ) AS exists`,
    [table, column],
  );
  return Boolean(r.rows[0]?.["exists"]);
}

/**
 * Overhaul refinement #12 — record WHY a person moved out (left job /
 * transferred / terminated / other) on the one-tap move-out. Additive text
 * column with an empty-string sentinel; runs before pushSchema, no-op once present.
 */
export async function addOccupantMoveOutReasonIfNeeded(
  pool: Pool | undefined,
  log: (message: string, extra?: Record<string, unknown>) => void = () => {},
): Promise<{ migrated: boolean }> {
  if (!pool || typeof (pool as { query?: unknown }).query !== "function") {
    return { migrated: false };
  }
  const runner = pool as unknown as QueryRunner;
  if (!(await tableExists(runner, "occupants"))) return { migrated: false };
  if (await columnExists(runner, "occupants", "move_out_reason")) {
    return { migrated: false };
  }
  log("Adding occupants.move_out_reason column…");
  await runner.query(
    `ALTER TABLE occupants ADD COLUMN IF NOT EXISTS move_out_reason text NOT NULL DEFAULT ''`,
  );
  return { migrated: true };
}
