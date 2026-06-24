import { db as defaultDb, occupantsTable, payrollDeductionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/**
 * Stage 3c — derive each occupant's Zenople link status from the payroll
 * deductions we've synced, and persist it to the occupant's zenople_* columns.
 *
 * This runs AFTER the deduction sync (it reads the payroll_deductions table the
 * sync just wrote), so it never touches the match ladder itself — purely
 * additive. It is RE-RUNNABLE by construction: every call recomputes from
 * scratch, so an occupant who was `not_in_zenople` last week auto-promotes to
 * `linked` the moment a deduction row appears for them.
 *
 *   linked         -> a payroll deduction exists for them (weeklyAmount > 0);
 *                     zenoplePersonId stamped from the deduction's personId.
 *   needs_review   -> matched only via the fragile name-only fallback this run
 *                     (passed in needsReviewOccupantIds) and not otherwise linked.
 *   not_in_zenople -> housed but no deduction matched -> unrecovered rent.
 */
export interface RecomputeZenopleDeps {
  db?: typeof defaultDb;
  logger?: {
    info: (obj: unknown, msg?: string) => void;
    warn: (obj: unknown, msg?: string) => void;
  };
  /** Occupant ids the sync matched only via the low-confidence name-only path. */
  needsReviewOccupantIds?: string[];
}

export interface RecomputeZenopleResult {
  linked: number;
  needsReview: number;
  notInZenople: number;
  updated: number;
}

export async function recomputeZenopleLinkStatus(
  deps: RecomputeZenopleDeps = {},
): Promise<RecomputeZenopleResult> {
  const database = deps.db ?? defaultDb;
  const needsReview = new Set(deps.needsReviewOccupantIds ?? []);

  const occupants = await database
    .select({
      id: occupantsTable.id,
      zenopleStatus: occupantsTable.zenopleStatus,
      zenoplePersonId: occupantsTable.zenoplePersonId,
    })
    .from(occupantsTable);

  const deductions = await database
    .select({
      occupantId: payrollDeductionsTable.occupantId,
      personId: payrollDeductionsTable.personId,
      weeklyAmount: payrollDeductionsTable.weeklyAmount,
      payWeekEndDate: payrollDeductionsTable.payWeekEndDate,
    })
    .from(payrollDeductionsTable);

  // Latest deduction per occupant (YYYY-MM-DD compares chronologically).
  const latest = new Map<
    string,
    { personId: string; weeklyAmount: number; payWeekEndDate: string }
  >();
  for (const d of deductions) {
    const cur = latest.get(d.occupantId);
    if (!cur || d.payWeekEndDate > cur.payWeekEndDate) {
      latest.set(d.occupantId, {
        personId: d.personId ?? "",
        weeklyAmount: d.weeklyAmount ?? 0,
        payWeekEndDate: d.payWeekEndDate,
      });
    }
  }

  const now = new Date();
  let linked = 0;
  let needsReviewCount = 0;
  let notInZenople = 0;
  let updated = 0;

  for (const o of occupants) {
    const d = latest.get(o.id);
    let status: string;
    let personId = o.zenoplePersonId ?? "";

    if (d && d.weeklyAmount > 0) {
      status = "linked";
      if (d.personId) personId = d.personId;
      linked++;
    } else if (needsReview.has(o.id)) {
      status = "needs_review";
      needsReviewCount++;
    } else {
      status = "not_in_zenople";
      notInZenople++;
    }

    const changed =
      (o.zenopleStatus ?? "") !== status ||
      (o.zenoplePersonId ?? "") !== personId;
    // Only write when something actually changed (keeps the sync idempotent
    // and cheap; zenopleCheckedAt advances on the rows that moved).
    if (changed) {
      await database
        .update(occupantsTable)
        .set({
          zenopleStatus: status,
          zenoplePersonId: personId,
          zenopleCheckedAt: now,
        })
        .where(eq(occupantsTable.id, o.id));
      updated++;
    }
  }

  deps.logger?.info(
    { linked, needsReview: needsReviewCount, notInZenople, updated },
    "Recomputed Zenople link status for occupants",
  );

  return { linked, needsReview: needsReviewCount, notInZenople, updated };
}
