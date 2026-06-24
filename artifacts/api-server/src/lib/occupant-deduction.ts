import { inArray } from "drizzle-orm";
import { db, payrollDeductionsTable } from "@workspace/db";

/**
 * The one canonical "what is this person paying us weekly" fact (Stage 3a).
 * Read-only, computed: the latest `payroll_deductions` snapshot for the
 * occupant, falling back to the cached `chargePerBed` on the occupant row.
 * Surfaced on the Occupant API as `deduction` so the DeductionBadge renders
 * identically on every surface (bed cells, roster, ledger, customer roll-up).
 */
export interface OccupantDeduction {
  weeklyAmount: number;
  /** "payroll" (real per-week snapshot), "manual" (from chargePerBed), or "" (none). */
  source: string;
  /** Saturday end-date of the pay-week the figure came from; "" when from chargePerBed. */
  payWeekEndDate: string;
  frequency: string;
}

export const EMPTY_DEDUCTION: OccupantDeduction = {
  weeklyAmount: 0,
  source: "",
  payWeekEndDate: "",
  frequency: "Weekly",
};

/** Minimal occupant shape needed for the chargePerBed fallback. */
type OccupantFallbackInput = {
  chargePerBed?: number | null;
  billingFrequency?: string | null;
};

/** Build a deduction from the occupant's cached charge when no payroll row exists. */
export function deductionFromOccupant(o: OccupantFallbackInput): OccupantDeduction {
  const amt = typeof o.chargePerBed === "number" && o.chargePerBed > 0 ? o.chargePerBed : 0;
  return {
    weeklyAmount: amt,
    source: amt > 0 ? "manual" : "",
    payWeekEndDate: "",
    frequency: o.billingFrequency || "Weekly",
  };
}

/**
 * Latest payroll deduction per occupant in ONE query (no N+1 at ~500 people).
 * Returns only occupants that HAVE a payroll snapshot — callers fall back to
 * `deductionFromOccupant` for the rest.
 */
export async function getOccupantDeductionsBatch(
  occupantIds: string[],
): Promise<Map<string, OccupantDeduction>> {
  const out = new Map<string, OccupantDeduction>();
  if (occupantIds.length === 0) return out;

  const rows = await db
    .select({
      occupantId: payrollDeductionsTable.occupantId,
      payWeekEndDate: payrollDeductionsTable.payWeekEndDate,
      weeklyAmount: payrollDeductionsTable.weeklyAmount,
    })
    .from(payrollDeductionsTable)
    .where(inArray(payrollDeductionsTable.occupantId, occupantIds));

  // Reduce to the latest pay-week per occupant. payWeekEndDate is a
  // zero-padded YYYY-MM-DD string, so lexical compare == chronological.
  for (const r of rows) {
    const cur = out.get(r.occupantId);
    if (!cur || r.payWeekEndDate > cur.payWeekEndDate) {
      out.set(r.occupantId, {
        weeklyAmount: r.weeklyAmount,
        source: "payroll",
        payWeekEndDate: r.payWeekEndDate,
        frequency: "Weekly",
      });
    }
  }
  return out;
}

/**
 * Single-occupant convenience. Prefer the batch helper in list endpoints.
 * `occupant` supplies the chargePerBed fallback when there's no payroll row.
 */
export async function getOccupantDeduction(
  occupantId: string,
  occupant?: OccupantFallbackInput,
): Promise<OccupantDeduction> {
  const map = await getOccupantDeductionsBatch([occupantId]);
  return map.get(occupantId) ?? (occupant ? deductionFromOccupant(occupant) : EMPTY_DEDUCTION);
}
