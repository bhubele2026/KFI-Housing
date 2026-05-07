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

/**
 * Returns true when the supplied free-form text mentions that utilities
 * are included in the rent. Used by both this back-fill migration and
 * the master-lease importer (Task #518) so the two paths agree on what
 * "utilities included" means in a lease's notes / clauses cell.
 *
 * Matches common operator shorthand:
 *  - "utilities included"
 *  - "utilities included in lease except internet"
 *  - "util included" / "utils incl" / "util incl"
 *  - "utilities in rent"
 * Case-insensitive. Returns false on empty / null input.
 */
export function detectsUtilitiesIncludedInRent(
  ...texts: Array<string | null | undefined>
): boolean {
  for (const raw of texts) {
    if (!raw) continue;
    const text = String(raw).toLowerCase();
    if (/\butilit(y|ies)\s+(are\s+|is\s+)?included\b/.test(text)) return true;
    if (/\butilit(y|ies)\s+(are\s+|is\s+)?in\s+(the\s+)?(rent|lease)\b/.test(text)) {
      return true;
    }
    if (/\butil(s|ities)?\.?\s+incl(\.|uded)?\b/.test(text)) return true;
  }
  return false;
}

/**
 * Idempotent back-fill (Task #518) that flips
 * `leases.utilities_included_in_rent` to `true` for any existing lease
 * whose `notes` or `clauses` cell mentions that utilities are bundled
 * in the rent. Runs AFTER drizzle's pushSchema (the column has to exist
 * before we can update it), and is safe to re-run — rows that already
 * carry the flag, and rows whose text doesn't match, are left alone.
 *
 * Skips silently when:
 *  - the database isn't yet provisioned (pool.query unavailable in tests),
 *  - the `leases` table doesn't exist (fresh database — nothing to back-fill),
 *  - the new `utilities_included_in_rent` column hasn't been pushed yet.
 */
export async function backfillUtilitiesIncludedInRent(
  pool: Pool | undefined,
  log: (message: string, extra?: Record<string, unknown>) => void = () => {},
): Promise<{ migrated: boolean; updated: number }> {
  if (!pool || typeof (pool as { query?: unknown }).query !== "function") {
    return { migrated: false, updated: 0 };
  }

  const runner = pool as unknown as QueryRunner;
  if (!(await tableExists(runner, "leases"))) {
    return { migrated: false, updated: 0 };
  }
  if (!(await columnExists(runner, "leases", "utilities_included_in_rent"))) {
    return { migrated: false, updated: 0 };
  }

  const candidates = await runner.query(
    `SELECT id, notes, clauses
       FROM leases
      WHERE utilities_included_in_rent = false
        AND (notes <> '' OR clauses <> '')`,
  );

  const idsToFlip: string[] = [];
  for (const row of candidates.rows) {
    const notes = (row["notes"] as string | null) ?? "";
    const clauses = (row["clauses"] as string | null) ?? "";
    if (detectsUtilitiesIncludedInRent(notes, clauses)) {
      idsToFlip.push(row["id"] as string);
    }
  }

  if (idsToFlip.length === 0) {
    return { migrated: false, updated: 0 };
  }

  log(
    `Back-filling utilities_included_in_rent for ${idsToFlip.length} lease(s)…`,
  );
  await runner.query(
    `UPDATE leases SET utilities_included_in_rent = true WHERE id = ANY($1::text[])`,
    [idsToFlip],
  );
  log(`utilities_included_in_rent back-fill complete.`);

  return { migrated: true, updated: idsToFlip.length };
}
