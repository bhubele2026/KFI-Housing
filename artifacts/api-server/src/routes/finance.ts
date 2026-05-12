import { Router, type IRouter } from "express";
import { and, gte, lte, eq } from "drizzle-orm";
import {
  customersTable,
  db,
  leasesTable,
  occupantsTable,
  otherCostsTable,
  payrollDeductionsTable,
  propertiesTable,
  utilitiesTable,
} from "@workspace/db";
import {
  ListFinanceWeeklyResponse,
  ListFinanceMonthlyResponse,
  ListFinanceByCustomerResponse,
} from "@workspace/api-zod";
import {
  mostRecentSaturday,
  monthBucketForPayWeek,
  trailingPayWeeks,
  trailingMonthBuckets,
  WEEKS_PER_MONTH,
} from "../lib/pay-week";

// Server-side finance rollups (Task #597). Three sibling endpoints
// share consistent exclusion rules so the Weekly / Monthly /
// By-Customer tabs all agree on the underlying numbers:
//
//   - `customerResponsibleForRent` leases are excluded from rent
//     totals (the customer pays the landlord directly).
//   - Hotel-rate (`rateType !== "monthly"`) leases are excluded too
//     — those bill per room-night and are accounted for separately
//     on the room-night logs page.
//   - Calendar-month rent counts the FULL `monthlyRent` if the lease
//     is active any day in the month. Open-ended leases (blank
//     `endDate`) are treated as ongoing through the month end.
//   - Utilities for properties whose active lease(s) flag
//     `utilitiesIncludedInRent` are dropped from the utilities sum
//     to avoid double-counting (the rent already covers them).
//
// All three endpoints accept optional `customerId` and `propertyId`
// query params so the Finance UI's filter chips and the per-property
// mini-chart all consume the SAME endpoint family — guaranteeing the
// numbers across views reconcile.

const router: IRouter = Router();

const round2 = (n: number) => Math.round(n * 100) / 100;

type LeaseRow = {
  id: string;
  propertyId: string;
  customerId: string | null;
  rateType: string;
  monthlyRent: number;
  customerResponsibleForRent: boolean;
  utilitiesIncludedInRent: boolean | null;
  startDate: string;
  endDate: string;
};

function isMonthlyRentLease(l: LeaseRow): boolean {
  return (l.rateType ?? "monthly") === "monthly";
}

function isLeaseActiveInMonth(l: LeaseRow, ym: string): boolean {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const lastDay = new Date(y, mo, 0).getDate();
  const monthStart = `${ym}-01`;
  const monthEnd = `${ym}-${String(lastDay).padStart(2, "0")}`;
  if (!l.startDate) return false;
  const effectiveEnd =
    l.endDate && l.endDate.length > 0 ? l.endDate : "9999-12-31";
  return l.startDate <= monthEnd && effectiveEnd >= monthStart;
}

function leaseCustomerId(
  l: LeaseRow,
  propertyCustomerById: Map<string, string>,
): string {
  if (l.customerId && l.customerId.length > 0) return l.customerId;
  return propertyCustomerById.get(l.propertyId) ?? "";
}

type SnapRow = {
  payWeekEndDate: string;
  customerId: string;
  propertyId: string;
  weeklyAmount: number;
};

async function loadSnapshots(since?: string, until?: string): Promise<SnapRow[]> {
  const conds = [
    since ? gte(payrollDeductionsTable.payWeekEndDate, since) : null,
    until ? lte(payrollDeductionsTable.payWeekEndDate, until) : null,
  ].filter((c): c is NonNullable<typeof c> => c !== null);
  return db
    .select({
      payWeekEndDate: payrollDeductionsTable.payWeekEndDate,
      customerId: payrollDeductionsTable.customerId,
      propertyId: payrollDeductionsTable.propertyId,
      weeklyAmount: payrollDeductionsTable.weeklyAmount,
    })
    .from(payrollDeductionsTable)
    .where(conds.length ? and(...conds) : undefined);
}

async function resolveAnchorWeek(): Promise<string> {
  const rows = await db
    .select({ payWeekEndDate: payrollDeductionsTable.payWeekEndDate })
    .from(payrollDeductionsTable);
  let latest = "";
  for (const r of rows) {
    if (r.payWeekEndDate > latest) latest = r.payWeekEndDate;
  }
  return latest || mostRecentSaturday();
}

function readScopeFilters(req: {
  query: Record<string, unknown>;
}): { customerId: string | null; propertyId: string | null } {
  const c = typeof req.query.customerId === "string" ? req.query.customerId : "";
  const p = typeof req.query.propertyId === "string" ? req.query.propertyId : "";
  return {
    customerId: c.length > 0 ? c : null,
    propertyId: p.length > 0 ? p : null,
  };
}

// Properties whose active monthly lease(s) flag
// `utilitiesIncludedInRent`. When summing utilities we drop any
// utility row whose property is in this set — the rent already covers
// the utility cost so counting both would inflate "expenses" twice.
function propertiesWithUtilitiesInRent(
  leases: LeaseRow[],
  ym: string,
): Set<string> {
  const out = new Set<string>();
  for (const l of leases) {
    if (!l.utilitiesIncludedInRent) continue;
    if (!isMonthlyRentLease(l)) continue;
    if (!isLeaseActiveInMonth(l, ym)) continue;
    out.add(l.propertyId);
  }
  return out;
}

// Properties whose active lease flags `customerResponsibleForRent`
// for ANY month touched by the rollup window. Snapshots tied to these
// properties are excluded from the recovered totals — the customer
// pays the landlord directly so the housing deduction (if any
// somehow shows up in payroll) is not part of KFI's recovery.
// Without this skip-set the recovered side counts the deduction but
// the rent side excludes the obligation, producing artificially
// positive net values.
function customerResponsiblePropertyIds(
  leases: LeaseRow[],
  monthsTouched: Iterable<string>,
): Set<string> {
  const out = new Set<string>();
  for (const ym of monthsTouched) {
    for (const l of leases) {
      if (!l.customerResponsibleForRent) continue;
      if (!isLeaseActiveInMonth(l, ym)) continue;
      out.add(l.propertyId);
    }
  }
  return out;
}

function applyScopeToLeases(
  leases: LeaseRow[],
  scope: { customerId: string | null; propertyId: string | null },
  propertyCustomerById: Map<string, string>,
): LeaseRow[] {
  return leases.filter((l) => {
    if (scope.propertyId && l.propertyId !== scope.propertyId) return false;
    if (scope.customerId) {
      const cid = leaseCustomerId(l, propertyCustomerById);
      if (cid !== scope.customerId) return false;
    }
    return true;
  });
}

function applyScopeToUtilities(
  utilities: { propertyId: string; monthlyCost: number }[],
  scope: { customerId: string | null; propertyId: string | null },
  propertyCustomerById: Map<string, string>,
): { propertyId: string; monthlyCost: number }[] {
  return utilities.filter((u) => {
    if (scope.propertyId && u.propertyId !== scope.propertyId) return false;
    if (scope.customerId) {
      const cid = propertyCustomerById.get(u.propertyId) ?? "";
      if (cid !== scope.customerId) return false;
    }
    return true;
  });
}

function applyScopeToSnaps(
  snaps: SnapRow[],
  scope: { customerId: string | null; propertyId: string | null },
): SnapRow[] {
  return snaps.filter((s) => {
    if (scope.propertyId && s.propertyId !== scope.propertyId) return false;
    if (scope.customerId && s.customerId !== scope.customerId) return false;
    return true;
  });
}

router.get("/finance/weekly", async (req, res): Promise<void> => {
  const weeksRaw = Number(req.query.weeks ?? 13);
  const weeks =
    Number.isFinite(weeksRaw) && weeksRaw > 0 && weeksRaw <= 104
      ? Math.floor(weeksRaw)
      : 13;
  const scope = readScopeFilters(req);
  const anchor = await resolveAnchorWeek();
  const buckets = trailingPayWeeks(weeks, anchor);
  const since = buckets[0];
  const until = buckets[buckets.length - 1];
  const [snaps, leasesAll, utilitiesAll, properties] = await Promise.all([
    loadSnapshots(since, until),
    db.select().from(leasesTable),
    db.select().from(utilitiesTable),
    db
      .select({ id: propertiesTable.id, customerId: propertiesTable.customerId })
      .from(propertiesTable),
  ]);

  const propertyCustomerById = new Map<string, string>();
  for (const p of properties) propertyCustomerById.set(p.id, p.customerId ?? "");

  const leases = applyScopeToLeases(
    leasesAll as LeaseRow[],
    scope,
    propertyCustomerById,
  );
  const utilities = applyScopeToUtilities(
    utilitiesAll,
    scope,
    propertyCustomerById,
  );
  const scopedSnaps = applyScopeToSnaps(snaps, scope);

  const monthsTouched = new Set<string>();
  for (const w of buckets) monthsTouched.add(monthBucketForPayWeek(w));

  const skipRecoveryProps = customerResponsiblePropertyIds(
    leasesAll as LeaseRow[],
    monthsTouched,
  );
  const recoveredByWeek = new Map<string, number>();
  for (const s of scopedSnaps) {
    if (skipRecoveryProps.has(s.propertyId)) continue;
    recoveredByWeek.set(
      s.payWeekEndDate,
      (recoveredByWeek.get(s.payWeekEndDate) ?? 0) + s.weeklyAmount,
    );
  }

  const weeklyRentByMonth = new Map<string, number>();
  const weeklyUtilByMonth = new Map<string, number>();
  for (const ym of monthsTouched) {
    let rent = 0;
    for (const l of leases) {
      if (l.customerResponsibleForRent) continue;
      if (!isMonthlyRentLease(l)) continue;
      if (!isLeaseActiveInMonth(l, ym)) continue;
      rent += l.monthlyRent || 0;
    }
    const skipUtilProps = propertiesWithUtilitiesInRent(leases, ym);
    let util = 0;
    for (const u of utilities) {
      if (skipUtilProps.has(u.propertyId)) continue;
      util += u.monthlyCost || 0;
    }
    weeklyRentByMonth.set(ym, rent / WEEKS_PER_MONTH);
    weeklyUtilByMonth.set(ym, util / WEEKS_PER_MONTH);
  }

  const result = buckets.map((week) => {
    const ym = monthBucketForPayWeek(week);
    const recovered = round2(recoveredByWeek.get(week) ?? 0);
    const rentPaid = round2(weeklyRentByMonth.get(ym) ?? 0);
    const utilitiesAmt = round2(weeklyUtilByMonth.get(ym) ?? 0);
    const net = round2(recovered - rentPaid - utilitiesAmt);
    return {
      payWeekEndDate: week,
      recovered,
      rentPaid,
      utilities: utilitiesAmt,
      net,
    };
  });

  res.json(ListFinanceWeeklyResponse.parse(result));
});

router.get("/finance/monthly", async (req, res): Promise<void> => {
  const monthsRaw = Number(req.query.months ?? 12);
  const months =
    Number.isFinite(monthsRaw) && monthsRaw > 0 && monthsRaw <= 36
      ? Math.floor(monthsRaw)
      : 12;
  const scope = readScopeFilters(req);
  const anchor = await resolveAnchorWeek();
  const anchorMonth = monthBucketForPayWeek(anchor);
  const buckets = trailingMonthBuckets(months, anchorMonth);

  const [snaps, leasesAll, utilitiesAll, otherCostsAll, properties] =
    await Promise.all([
      loadSnapshots(),
      db.select().from(leasesTable),
      db.select().from(utilitiesTable),
      db.select().from(otherCostsTable),
      db
        .select({
          id: propertiesTable.id,
          customerId: propertiesTable.customerId,
        })
        .from(propertiesTable),
    ]);

  const propertyCustomerById = new Map<string, string>();
  for (const p of properties) propertyCustomerById.set(p.id, p.customerId ?? "");

  const leases = applyScopeToLeases(
    leasesAll as LeaseRow[],
    scope,
    propertyCustomerById,
  );
  const utilities = applyScopeToUtilities(
    utilitiesAll,
    scope,
    propertyCustomerById,
  );
  const otherCosts = applyScopeToUtilities(
    otherCostsAll as { propertyId: string; monthlyCost: number }[],
    scope,
    propertyCustomerById,
  );
  const scopedSnaps = applyScopeToSnaps(snaps, scope);

  const skipRecoveryProps = customerResponsiblePropertyIds(
    leasesAll as LeaseRow[],
    buckets,
  );
  const recoveredByMonth = new Map<string, number>();
  for (const s of scopedSnaps) {
    if (skipRecoveryProps.has(s.propertyId)) continue;
    const ym = monthBucketForPayWeek(s.payWeekEndDate);
    if (!ym) continue;
    recoveredByMonth.set(ym, (recoveredByMonth.get(ym) ?? 0) + s.weeklyAmount);
  }

  const result = buckets.map((ym) => {
    let rent = 0;
    for (const l of leases) {
      if (l.customerResponsibleForRent) continue;
      if (!isMonthlyRentLease(l)) continue;
      if (!isLeaseActiveInMonth(l, ym)) continue;
      rent += l.monthlyRent || 0;
    }
    const skipUtilProps = propertiesWithUtilitiesInRent(leases, ym);
    let util = 0;
    for (const u of utilities) {
      if (skipUtilProps.has(u.propertyId)) continue;
      util += u.monthlyCost || 0;
    }
    const other = otherCosts.reduce((s, o) => s + (o.monthlyCost || 0), 0);
    const recovered = round2(recoveredByMonth.get(ym) ?? 0);
    const rentPaid = round2(rent);
    const utilitiesAmt = round2(util);
    const otherAmt = round2(other);
    const net = round2(recovered - rentPaid - utilitiesAmt - otherAmt);
    return {
      month: ym,
      recovered,
      rentPaid,
      utilities: utilitiesAmt,
      otherCosts: otherAmt,
      net,
    };
  });

  res.json(ListFinanceMonthlyResponse.parse(result));
});

router.get("/finance/by-customer", async (req, res): Promise<void> => {
  const scope = readScopeFilters(req);
  const [customers, occupants, properties, leasesAll, snaps] = await Promise.all([
    db.select().from(customersTable),
    db
      .select({
        id: occupantsTable.id,
        propertyId: occupantsTable.propertyId,
        status: occupantsTable.status,
      })
      .from(occupantsTable)
      .where(eq(occupantsTable.status, "Active")),
    db
      .select({ id: propertiesTable.id, customerId: propertiesTable.customerId })
      .from(propertiesTable),
    db.select().from(leasesTable),
    loadSnapshots(),
  ]);

  const propertyCustomerById = new Map<string, string>();
  for (const p of properties) propertyCustomerById.set(p.id, p.customerId ?? "");

  const leases = applyScopeToLeases(
    leasesAll as LeaseRow[],
    scope,
    propertyCustomerById,
  );
  const scopedSnaps = applyScopeToSnaps(snaps, scope);

  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  // Snapshots tied to customerResponsibleForRent properties never
  // count toward "recovered" — see comment on
  // customerResponsiblePropertyIds() above. The skip-set must cover
  // EVERY month this endpoint will ever attribute a recovery to, not
  // just the current calendar month, otherwise a customer-responsible
  // property whose `mostRecentWeek` falls in a prior month would still
  // contribute to the recovered total. We compute the candidate
  // `mostRecentWeek` from the unfiltered scopedSnaps first so we can
  // include its month bucket in the skip-set BEFORE filtering.
  let mostRecentCandidate = "";
  for (const s of scopedSnaps) {
    if (s.payWeekEndDate > mostRecentCandidate) {
      mostRecentCandidate = s.payWeekEndDate;
    }
  }
  const monthsTouched = new Set<string>([currentMonth]);
  if (mostRecentCandidate) {
    monthsTouched.add(monthBucketForPayWeek(mostRecentCandidate));
  }
  const skipRecoveryProps = customerResponsiblePropertyIds(
    leasesAll as LeaseRow[],
    monthsTouched,
  );
  const filteredSnaps = scopedSnaps.filter(
    (s) => !skipRecoveryProps.has(s.propertyId),
  );

  let mostRecentWeek = "";
  for (const s of filteredSnaps) {
    if (s.payWeekEndDate > mostRecentWeek) mostRecentWeek = s.payWeekEndDate;
  }

  const scopedOccupants = occupants.filter((o) => {
    if (!o.propertyId) return false;
    if (scope.propertyId && o.propertyId !== scope.propertyId) return false;
    if (scope.customerId) {
      const cid = propertyCustomerById.get(o.propertyId) ?? "";
      if (cid !== scope.customerId) return false;
    }
    return true;
  });

  const activeOccByCustomer = new Map<string, number>();
  for (const o of scopedOccupants) {
    const cid = propertyCustomerById.get(o.propertyId!) ?? "";
    if (!cid) continue;
    activeOccByCustomer.set(cid, (activeOccByCustomer.get(cid) ?? 0) + 1);
  }

  const monthlyRentByCustomer = new Map<string, number>();
  for (const l of leases) {
    if (l.customerResponsibleForRent) continue;
    if (!isMonthlyRentLease(l)) continue;
    if (!isLeaseActiveInMonth(l, currentMonth)) continue;
    const cid = leaseCustomerId(l, propertyCustomerById);
    if (!cid) continue;
    monthlyRentByCustomer.set(
      cid,
      (monthlyRentByCustomer.get(cid) ?? 0) + (l.monthlyRent || 0),
    );
  }

  const recentWeekByCustomer = new Map<string, number>();
  const mtdByCustomer = new Map<string, number>();
  for (const s of filteredSnaps) {
    if (!s.customerId) continue;
    if (s.payWeekEndDate === mostRecentWeek) {
      recentWeekByCustomer.set(
        s.customerId,
        (recentWeekByCustomer.get(s.customerId) ?? 0) + s.weeklyAmount,
      );
    }
    if (monthBucketForPayWeek(s.payWeekEndDate) === currentMonth) {
      mtdByCustomer.set(
        s.customerId,
        (mtdByCustomer.get(s.customerId) ?? 0) + s.weeklyAmount,
      );
    }
  }

  const seen = new Set<string>();
  for (const c of customers) {
    if (scope.customerId && c.id !== scope.customerId) continue;
    seen.add(c.id);
  }
  for (const k of activeOccByCustomer.keys()) seen.add(k);
  for (const k of monthlyRentByCustomer.keys()) seen.add(k);
  for (const k of recentWeekByCustomer.keys()) seen.add(k);
  for (const k of mtdByCustomer.keys()) seen.add(k);

  const customerNameById = new Map<string, string>();
  for (const c of customers) customerNameById.set(c.id, c.name);

  const rows = Array.from(seen)
    .map((id) => {
      const monthlyRentKfiPays = round2(monthlyRentByCustomer.get(id) ?? 0);
      const mtdRecovered = round2(mtdByCustomer.get(id) ?? 0);
      return {
        customerId: id,
        customerName: customerNameById.get(id) ?? id,
        activeOccupants: activeOccByCustomer.get(id) ?? 0,
        monthlyRentKfiPays,
        mostRecentWeekRecovered: round2(recentWeekByCustomer.get(id) ?? 0),
        monthToDateRecovered: mtdRecovered,
        net: round2(mtdRecovered - monthlyRentKfiPays),
      };
    })
    .filter(
      (r) =>
        r.activeOccupants > 0 ||
        r.monthlyRentKfiPays > 0 ||
        r.mostRecentWeekRecovered > 0 ||
        r.monthToDateRecovered > 0,
    )
    .sort((a, b) => a.customerName.localeCompare(b.customerName));

  res.json(
    ListFinanceByCustomerResponse.parse({
      mostRecentWeekEndDate: mostRecentWeek || null,
      currentMonth,
      rows,
    }),
  );
});

export default router;
