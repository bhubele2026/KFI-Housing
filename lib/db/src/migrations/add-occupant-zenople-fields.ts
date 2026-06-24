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

interface ZenopleColumn {
  column: string;
  // Full DDL type clause (including NOT NULL / DEFAULT) appended after the
  // column name in `ALTER TABLE … ADD COLUMN IF NOT EXISTS <col> <ddl>`.
  ddl: string;
}

const OCCUPANT_ZENOPLE_COLUMNS: ZenopleColumn[] = [
  // The Zenople person id this occupant is linked to. Empty string = not
  // yet linked. Matches the empty-string-sentinel convention used by the
  // other occupant identity columns (employee_id, company).
  { column: "zenople_person_id", ddl: "text NOT NULL DEFAULT ''" },
  // Link status against the Zenople payroll roster. One of:
  //   "pending"          — never checked / awaiting first sync.
  //   "linked"           — matched to a Zenople person (human-confirmed or
  //                        a deterministic exact match).
  //   "not_in_zenople"   — synced and no candidate found (housed but not on
  //                        payroll — the highest-value money leak).
  //   "needs_review"     — 2+ or weak candidates; routed to the AI-assisted
  //                        match review queue.
  // Plain text (not an enum) so a new status can be added without a
  // destructive migration; normalised at the API boundary.
  { column: "zenople_status", ddl: "text NOT NULL DEFAULT 'pending'" },
  // When the matcher last evaluated this occupant against the roster.
  // Null until the first sync touches the row.
  { column: "zenople_checked_at", ddl: "timestamptz" },
];

/**
 * Idempotent migration (Stage 3b) that adds the three Zenople link-status
 * columns to `occupants`: `zenople_person_id`, `zenople_status`,
 * `zenople_checked_at`.
 *
 * The two text columns are NOT NULL with sentinels ('' / 'pending') so
 * existing occupant rows get a sensible "not yet linked" baseline the
 * moment the column lands; `zenople_checked_at` is nullable (no sync has
 * touched a pre-existing row yet). Runs BEFORE drizzle's pushSchema so a
 * deployed DB still on the old shape catches the columns up at boot rather
 * than waiting for a separate push.
 *
 * Skips silently when the pool is unavailable (tests) or the `occupants`
 * table doesn't exist yet (fresh DB — pushSchema creates the new shape).
 * Re-runs are no-ops once all three columns exist.
 */
export async function addOccupantZenopleFieldsIfNeeded(
  pool: Pool | undefined,
  log: (message: string, extra?: Record<string, unknown>) => void = () => {},
): Promise<{ migrated: boolean; addedColumns: string[] }> {
  if (!pool || typeof (pool as { query?: unknown }).query !== "function") {
    return { migrated: false, addedColumns: [] };
  }

  const runner = pool as unknown as QueryRunner;

  if (!(await tableExists(runner, "occupants"))) {
    return { migrated: false, addedColumns: [] };
  }

  const missing: ZenopleColumn[] = [];
  for (const col of OCCUPANT_ZENOPLE_COLUMNS) {
    const present = await columnExists(runner, "occupants", col.column);
    if (!present) missing.push(col);
  }

  if (missing.length === 0) {
    return { migrated: false, addedColumns: [] };
  }

  log("Adding occupant Zenople link-status columns…", {
    missing: missing.map((m) => m.column),
  });

  for (const col of missing) {
    await runner.query(
      `ALTER TABLE occupants ADD COLUMN IF NOT EXISTS ${col.column} ${col.ddl}`,
    );
  }

  log("Occupant Zenople columns added.", {
    addedColumns: missing.map((m) => m.column),
  });

  return { migrated: true, addedColumns: missing.map((m) => m.column) };
}
