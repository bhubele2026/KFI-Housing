import { eq } from "drizzle-orm";
import { db, occupantsTable } from "@workspace/db";
import { logger as defaultLogger } from "./logger";
import type { Logger } from "pino";
import {
  HOUSING_DEDUCTION_ROWS,
  type HousingDeductionRow,
} from "./seed-housing-deductions";

export interface BackfillOccupantPayrollIdsResult {
  scannedRows: number;
  matchedOccupants: number;
  matchedExact: number;
  matchedSubset: number;
  employeeIdFilled: number;
  companyFilled: number;
  alreadyComplete: number;
  ambiguousNames: Array<{ name: string; personId: string; customer: string }>;
  unmatchedRows: Array<{ name: string; personId: string; customer: string }>;
}

export interface BackfillOccupantPayrollIdsDeps {
  db: typeof db;
  logger: Pick<Logger, "info" | "warn">;
  rows: HousingDeductionRow[];
}

// Tokens we ignore when comparing two name strings: pure suffix words
// and single-letter middle initials. Without dropping these, payroll
// "WILLIE A MEDINA JR" wouldn't subset-match DB "Willie A. Medina Jr"
// because of suffix/casing/period noise.
const SUFFIX_TOKENS = new Set(["JR", "SR", "II", "III", "IV"]);

function nameTokens(raw: string): string[] {
  return raw
    .toUpperCase()
    .replace(/[^A-Z\s]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .filter((t) => !SUFFIX_TOKENS.has(t))
    .filter((t) => t.length > 1); // drops single-letter initials
}

function tokenKey(tokens: string[]): string {
  return [...tokens].sort().join(" ");
}

// True when `a` is a (non-empty) subset of `b`. Used to allow payroll
// "ALFONZO D TUCKER" → DB "Alfonzo Deray Tucker": their significant
// token sets ({ALFONZO,TUCKER} vs {ALFONZO,DERAY,TUCKER}) have a
// subset relationship in one direction. We require the smaller side
// to have ≥ 2 tokens so a bare first-name alone can never collapse
// onto someone with the same first name.
function isSubsetOf(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || a.size > b.size) return false;
  for (const t of a) if (!b.has(t)) return false;
  return true;
}

// `company` values that aren't real companies — historic seed data
// stuffed shift descriptions in this column. We treat them like an
// empty value so the backfill replaces them with the payroll company.
function isCompanyOverwriteable(current: string): boolean {
  const v = current.trim();
  if (v === "") return true;
  return v.toUpperCase().startsWith("SHIFT:");
}

/**
 * Backfill `employeeId` and `company` on existing occupants by matching
 * the payroll export (the same `HOUSING_DEDUCTION_ROWS` that
 * `seedHousingDeductions` consumes) against occupant `name`.
 *
 * The matcher is two-pass and deliberately conservative:
 *   1. Exact match on the normalized significant-token set
 *      (uppercase, punctuation-stripped, single-letter initials and
 *      JR/SR/II/III/IV suffixes dropped).
 *   2. Subset match: the smaller side's tokens are entirely contained
 *      in the larger side's. Requires both sides to have ≥ 2 tokens
 *      and the candidate to be unique within the active occupants.
 *      This rescues "ALFONZO D TUCKER" ↔ "Alfonzo Deray Tucker",
 *      "VICTOR ALFONSO VALENZUELA ESPINOZA" ↔ "Victor A. Valenzuela",
 *      etc. without ever guessing on ambiguous names.
 *
 * Why this exists: the initial occupant seed and several lease imports
 * landed rows with empty `employeeId`/`company` (or "Shift: …" stuffed
 * into the `company` column), so the strict matchers in
 * `seedHousingDeductions` (employeeId == personId, then name+company)
 * couldn't find them and only the fragile name-only fallback was
 * rescuing them. Filling these two fields once makes subsequent
 * payroll syncs match by employeeId — the only collision-proof key —
 * and lets the unmatched-warn list shrink to actually-new hires.
 *
 * Idempotent: only writes when a value would actually change. Empty
 * `employeeId` fills with `personId`; empty or `Shift:`-prefixed
 * `company` fills with the payroll customer. A second pass on a
 * settled DB is a no-op.
 */
export async function backfillOccupantPayrollIds(
  deps: Partial<BackfillOccupantPayrollIdsDeps> = {},
): Promise<BackfillOccupantPayrollIdsResult> {
  const database = deps.db ?? db;
  const log = deps.logger ?? defaultLogger;
  const rows = deps.rows ?? HOUSING_DEDUCTION_ROWS;

  const allOccupants = await database
    .select({
      id: occupantsTable.id,
      name: occupantsTable.name,
      employeeId: occupantsTable.employeeId,
      company: occupantsTable.company,
      status: occupantsTable.status,
    })
    .from(occupantsTable);

  // Restrict matching to active occupants. Inactive rows
  // (moved-out/legacy) are excluded so a stale "Andrew Castaneda" who
  // moved out years ago can't shadow a currently-housed namesake.
  const candidates = allOccupants
    .filter((o) => o.status === "Active")
    .map((o) => {
      const tokens = nameTokens(o.name);
      return {
        ...o,
        tokens,
        tokenSet: new Set(tokens),
        key: tokenKey(tokens),
      };
    });

  // Exact-key index: any occupants sharing the same normalized token
  // set are flagged ambiguous (value=null) so we never silently pick
  // one of two namesakes.
  const byExactKey = new Map<string, (typeof candidates)[number] | null>();
  for (const o of candidates) {
    if (o.key === "") continue;
    if (byExactKey.has(o.key)) {
      byExactKey.set(o.key, null);
    } else {
      byExactKey.set(o.key, o);
    }
  }

  let matchedOccupants = 0;
  let matchedExact = 0;
  let matchedSubset = 0;
  let employeeIdFilled = 0;
  let companyFilled = 0;
  let alreadyComplete = 0;
  const ambiguousNames: BackfillOccupantPayrollIdsResult["ambiguousNames"] = [];
  const unmatchedRows: BackfillOccupantPayrollIdsResult["unmatchedRows"] = [];
  const writtenIds = new Set<string>();

  for (const row of rows) {
    const payrollTokens = nameTokens(row.name);
    if (payrollTokens.length < 2) {
      unmatchedRows.push({
        name: row.name,
        personId: row.personId,
        customer: row.customer,
      });
      continue;
    }
    const payrollKey = tokenKey(payrollTokens);
    const payrollSet = new Set(payrollTokens);

    let target: (typeof candidates)[number] | null = null;
    let path: "exact" | "subset" | null = null;

    const exact = byExactKey.get(payrollKey);
    if (exact === null) {
      // Ambiguous exact match — refuse to write.
      ambiguousNames.push({
        name: row.name,
        personId: row.personId,
        customer: row.customer,
      });
      continue;
    }
    if (exact) {
      target = exact;
      path = "exact";
    } else {
      // Subset fallback. Two acceptable directions:
      //   - DB tokens ⊂ payroll tokens (DB has fewer parts)
      //   - payroll tokens ⊂ DB tokens (payroll has fewer parts)
      // Either side must have ≥ 2 tokens (filtered above for
      // payroll; candidates with <2 tokens are simply ineligible).
      const matches = candidates.filter((o) => {
        if (o.tokens.length < 2) return false;
        if (writtenIds.has(o.id)) return false;
        return (
          isSubsetOf(o.tokenSet, payrollSet) ||
          isSubsetOf(payrollSet, o.tokenSet)
        );
      });
      if (matches.length === 1) {
        target = matches[0]!;
        path = "subset";
      } else if (matches.length > 1) {
        ambiguousNames.push({
          name: row.name,
          personId: row.personId,
          customer: row.customer,
        });
        continue;
      }
    }

    if (!target) {
      unmatchedRows.push({
        name: row.name,
        personId: row.personId,
        customer: row.customer,
      });
      continue;
    }

    matchedOccupants++;
    if (path === "exact") matchedExact++;
    else if (path === "subset") matchedSubset++;

    const currentEmployeeId = (target.employeeId ?? "").trim();
    const currentCompany = target.company ?? "";
    const newEmployeeId = row.personId.trim();
    const newCompany = row.customer.trim();

    const willSetEmployeeId =
      currentEmployeeId === "" && newEmployeeId !== "";
    const willSetCompany =
      isCompanyOverwriteable(currentCompany) &&
      newCompany !== "" &&
      currentCompany.trim() !== newCompany;

    if (!willSetEmployeeId && !willSetCompany) {
      alreadyComplete++;
      continue;
    }

    const patch: { employeeId?: string; company?: string } = {};
    if (willSetEmployeeId) patch.employeeId = newEmployeeId;
    if (willSetCompany) patch.company = newCompany;

    await database
      .update(occupantsTable)
      .set(patch)
      .where(eq(occupantsTable.id, target.id));
    writtenIds.add(target.id);

    if (willSetEmployeeId) employeeIdFilled++;
    if (willSetCompany) companyFilled++;
  }

  const result: BackfillOccupantPayrollIdsResult = {
    scannedRows: rows.length,
    matchedOccupants,
    matchedExact,
    matchedSubset,
    employeeIdFilled,
    companyFilled,
    alreadyComplete,
    ambiguousNames,
    unmatchedRows,
  };

  log.info(
    {
      scannedRows: result.scannedRows,
      matchedOccupants: result.matchedOccupants,
      matchedExact: result.matchedExact,
      matchedSubset: result.matchedSubset,
      employeeIdFilled: result.employeeIdFilled,
      companyFilled: result.companyFilled,
      alreadyComplete: result.alreadyComplete,
      ambiguous: result.ambiguousNames.length,
      unmatched: result.unmatchedRows.length,
    },
    "Backfilled occupant employeeId/company from payroll export",
  );
  if (result.ambiguousNames.length > 0) {
    log.warn(
      { ambiguous: result.ambiguousNames },
      "Skipped backfill for occupants whose name matches more than one record — resolve manually",
    );
  }

  return result;
}
