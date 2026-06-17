// Apply harvested lease rent/date fixes — FILL BLANKS ONLY.
//
// The lease audit (imports/lease-fixes-from-sources.json) sourced the
// real monthly rent + start/end dates for leases that imported with $0
// rent and/or no dates, by reading the signed leases on SharePoint. This
// seeder applies ONLY the HIGH-confidence records, and only ever fills a
// blank field — it never overwrites a rent or date an operator (or a
// later import) has already set. Month-to-month leases keep their blank
// end date. Additive, idempotent (re-running fills nothing once set),
// non-fatal. Gated under FORCE_HARVEST_SEED so it can run in prod.

import { eq } from "drizzle-orm";
import { db, leasesTable } from "@workspace/db";
import { logger as defaultLogger } from "./logger";
import type { Logger } from "pino";

export interface LeaseFix {
  propertyId: string;
  unit: string;
  monthlyRent: number;
  startDate: string;
  endDate: string;
}

// HIGH-confidence fixes only (Foote Hills + Sunset Place signed leases).
// Deliberately EXCLUDED: Independent Stave 743 (expired 2022-23 term,
// "Remove all" — confirm renew/inactive first), and the month-to-month /
// motel rows (Burnett-Menomonie, Palace Motel) which have no monthly
// rent to fill and dates already present.
export const LEASE_FIXES: readonly LeaseFix[] = [
  { propertyId: "prop-foote-hills-grand-rapids", unit: "103",  monthlyRent: 2200, startDate: "2024-12-02", endDate: "2025-11-30" },
  { propertyId: "prop-foote-hills-grand-rapids", unit: "A02",  monthlyRent: 1625, startDate: "2024-10-08", endDate: "2025-11-30" },
  { propertyId: "prop-foote-hills-grand-rapids", unit: "A10P", monthlyRent: 1550, startDate: "2025-01-31", endDate: "2026-02-28" },
  { propertyId: "prop-foote-hills-grand-rapids", unit: "B03P", monthlyRent: 1625, startDate: "2024-10-07", endDate: "2025-10-31" },
  { propertyId: "prop-foote-hills-grand-rapids", unit: "B05D", monthlyRent: 1525, startDate: "2024-12-16", endDate: "2025-12-31" },
  { propertyId: "prop-foote-hills-grand-rapids", unit: "D06",  monthlyRent: 1525, startDate: "2024-11-20", endDate: "2025-11-30" },
  { propertyId: "prop-foote-hills-grand-rapids", unit: "E02",  monthlyRent: 1625, startDate: "2024-10-08", endDate: "2025-10-31" },
  { propertyId: "prop-sunset-place-neillsville", unit: "132",     monthlyRent: 1259, startDate: "2026-06-12", endDate: "2026-11-30" },
  { propertyId: "prop-sunset-place-neillsville", unit: "134 ADA", monthlyRent: 1299, startDate: "2026-06-12", endDate: "2027-03-31" },
];

export interface ExistingLease {
  id: string;
  propertyId: string;
  unit: string;
  monthlyRent: number;
  startDate: string;
  endDate: string;
}
export interface LeaseFillPlan {
  id: string;
  patch: { monthlyRent?: number; startDate?: string; endDate?: string };
}

const isBlank = (s: string | null | undefined): boolean => !s || !String(s).trim();

/**
 * Pure planner: for each fix, find the matching lease (propertyId + unit)
 * and produce a patch containing ONLY the blank fields the fix can fill.
 * Returns one plan per lease that actually needs a change. Deterministic,
 * side-effect free — this is the unit-tested core.
 */
export function planLeaseFills(
  existing: ExistingLease[],
  fixes: readonly LeaseFix[],
): LeaseFillPlan[] {
  const out: LeaseFillPlan[] = [];
  for (const fix of fixes) {
    const lease = existing.find(
      (l) =>
        l.propertyId === fix.propertyId &&
        (l.unit ?? "").trim().toLowerCase() === fix.unit.trim().toLowerCase(),
    );
    if (!lease) continue;
    const patch: LeaseFillPlan["patch"] = {};
    if ((!lease.monthlyRent || lease.monthlyRent <= 0) && fix.monthlyRent > 0) {
      patch.monthlyRent = fix.monthlyRent;
    }
    if (isBlank(lease.startDate) && !isBlank(fix.startDate)) patch.startDate = fix.startDate;
    if (isBlank(lease.endDate) && !isBlank(fix.endDate)) patch.endDate = fix.endDate;
    if (Object.keys(patch).length > 0) out.push({ id: lease.id, patch });
  }
  return out;
}

/**
 * Apply the blank-fill lease fixes. Additive + idempotent + non-fatal.
 */
export async function seedLeaseFixesIfMissing(
  log: Logger = defaultLogger,
): Promise<{ leasesFilled: number }> {
  const rows = await db
    .select({
      id: leasesTable.id,
      propertyId: leasesTable.propertyId,
      unit: leasesTable.unit,
      monthlyRent: leasesTable.monthlyRent,
      startDate: leasesTable.startDate,
      endDate: leasesTable.endDate,
    })
    .from(leasesTable);

  const plans = planLeaseFills(rows as ExistingLease[], LEASE_FIXES);
  for (const plan of plans) {
    await db.update(leasesTable).set(plan.patch).where(eq(leasesTable.id, plan.id));
    log.info({ leaseId: plan.id, patch: plan.patch }, "seed-lease-fixes: filled blank lease fields");
  }
  if (plans.length > 0) {
    log.info({ leasesFilled: plans.length }, "seed-lease-fixes: done");
  }
  return { leasesFilled: plans.length };
}
