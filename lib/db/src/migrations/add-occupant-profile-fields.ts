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

interface OccupantProfileColumn {
  column: string;
  type: string;
}

const OCCUPANT_PROFILE_COLUMNS: OccupantProfileColumn[] = [
  { column: "language", type: "text" },
  { column: "gender", type: "text" },
  { column: "title", type: "text" },
  { column: "kfis_authorized_to_drive", type: "boolean" },
];

/**
 * Idempotent migration that adds the four new occupant profile fields
 * (Task #502): `language`, `gender`, `title`, `kfis_authorized_to_drive`.
 *
 * All four columns are nullable — operators may not have any of these
 * data points on file when an associate is first onboarded. Runs
 * BEFORE drizzle's pushSchema so older deployed databases pick the
 * columns up at boot (drizzle would otherwise produce the same
 * statements on the first push, but having the migration explicit
 * means a missing/blocked pushSchema run still leaves the API able
 * to read/write the new fields).
 *
 * Skips silently when:
 *  - the database isn't yet provisioned (pool.query unavailable in tests),
 *  - the `occupants` table doesn't exist (fresh database — drizzle will
 *    create the new shape from the schema on the next pushSchema), or
 *  - all four columns already exist.
 */
export async function addOccupantProfileFieldsIfNeeded(
  pool: Pool | undefined,
  log: (message: string, extra?: Record<string, unknown>) => void = () => {},
): Promise<{ migrated: boolean; addedColumns: string[] }> {
  if (!pool || typeof (pool as { query?: unknown }).query !== "function") {
    return { migrated: false, addedColumns: [] };
  }

  const runner = pool as unknown as QueryRunner;

  const hasOccupants = await tableExists(runner, "occupants");
  if (!hasOccupants) {
    return { migrated: false, addedColumns: [] };
  }

  const missing: OccupantProfileColumn[] = [];
  for (const col of OCCUPANT_PROFILE_COLUMNS) {
    const present = await columnExists(runner, "occupants", col.column);
    if (!present) missing.push(col);
  }

  if (missing.length === 0) {
    return { migrated: false, addedColumns: [] };
  }

  log("Adding new occupant profile columns…", {
    missing: missing.map((m) => m.column),
  });

  for (const col of missing) {
    await runner.query(
      `ALTER TABLE occupants ADD COLUMN IF NOT EXISTS ${col.column} ${col.type}`,
    );
  }

  log("Occupant profile columns added.", {
    addedColumns: missing.map((m) => m.column),
  });

  return { migrated: true, addedColumns: missing.map((m) => m.column) };
}
