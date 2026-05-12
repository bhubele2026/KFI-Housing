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
  isSaturdayDate,
  mostRecentSaturday,
  monthBucketForPayWeek,
  trailingPayWeeks,
  trailingMonthBuckets,
  WEEKS_PER_MONTH,
} from "../lib/pay-week";

// Server-side finance rollups (Task #597). Three sibling endpoints
// share a single DB read pass per request and apply consistent
// exclusion rules so the Weekly / Monthly / By-Customer tabs all
// agree on the underlying numbers:
//
//   - `customerResponsibleForRent` leases are excluded from rent
//     totals (the customer pays the landlord directly).
//   - Hotel-rate (`rateType !== "monthly"`) leases are excluded too
//     — those bill per room-night and are accounted for separately
//     on the room-night logs page.
//   - Calendar-month rent counts the FULL `monthlyRent` if the lease
//     is active any day in the month. Open-ended leases (blank
//     `endDate`) are treated as ongoing through the month end.

const router: IRouter = Router();

const round2 = (n: number) => Math.round(n * 100) / 100;

function isMonthlyRentLease(l: {
  rateType: string;
  customerId: string | null;
  monthlyRent: number;
}): boolean {
  if ((l.rateType ?? "monthly") !== "monthly") return false;
  return true;
}

function isLeaseActiveInMonth(
  l: { startDate: string; endDate: string },
  ym: string,
): boolean {
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

// Trailing N pay-weeks. Anchors on the latest snapshot week if any,
// otherwise on the most recent Saturday before today, so an empty DB
// still returns a sensible rolling window of zeros.
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

router.get("/finance/weekly", async (req, res): Promise<void> => {
  const weeksRaw = Number(req.query.weeks ?? 13);
  const weeks =
    Number.isFinite(weeksRaw) && weeksRaw > 0 && weeksRaw <= 104
      ? Math.floor(weeksRaw)
      : 13;
  const anchor = await resolveAnchorWeek();
  const buckets = trailingPayWeeks(weeks, anchor);
  const since = buckets[0];
  const until = buckets[buckets.length - 1];
  const [snaps, leases, utilities] = await Promise.all([
    loadSnapshots(since, until),
    db.select().from(leasesTable),
    db.select().from(utilitiesTable),
  ]);

  // Per-week recovered (sum of snapshot weeklyAmount).
  const recoveredByWeek = new Map<string, number>();
  for (const s of snaps) {
    recoveredByWeek.set(
      s.payWeekEndDate,
      (recoveredByWeek.get(s.payWeekEndDate) ?? 0) + s.weeklyAmount,
    );
  }

  // Per-week rent: convert calendar-month rent → weekly equivalent
  // using WEEKS_PER_MONTH. A lease that's active in the Saturday's
  // calendar month contributes its full monthlyRent / WEEKS_PER_MONTH
  // for that week.
  const weeklyRentByMonth = new Map<string, number>();
  const weeklyUtilByMonth = new Map<string, number>();
  const utilTotal =
    utilities.reduce((s, u) => s + (u.monthlyCost || 0), 0) / WEEKS_PER_MONTH;

  const monthsTouched = new Set<string>();
  for (const w of buckets) monthsTouched.add(monthBucketForPayWeek(w));

  for (const ym of monthsTouched) {
    let rent = 0;
    for (const l of leases) {
      if (l.customerResponsibleForRent) continue;
      if (!isMonthlyRentLease(l)) continue;
      if (!isLeaseActiveInMonth(l, ym)) continue;
      rent += l.monthlyRent || 0;
    }
    weeklyRentByMonth.set(ym, rent / WEEKS_PER_MONTH);
    weeklyUtilByMonth.set(ym, utilTotal);
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
  const anchor = await resolveAnchorWeek();
  const anchorMonth = monthBucketForPayWeek(anchor);
  const buckets = trailingMonthBuckets(months, anchorMonth);

  const [snaps, leases, utilities, otherCosts] = await Promise.all([
    loadSnapshots(),
    db.select().from(leasesTable),
    db.select().from(utilitiesTable),
    db.select().from(otherCostsTable),
  ]);

  const recoveredByMonth = new Map<string, number>();
  for (const s of snaps) {
    const ym = monthBucketForPayWeek(s.payWeekEndDate);
    if (!ym) continue;
    recoveredByMonth.set(ym, (recoveredByMonth.get(ym) ?? 0) + s.weeklyAmount);
  }

  const utilTotal = utilities.reduce((s, u) => s + (u.monthlyCost || 0), 0);
  const otherTotal = otherCosts.reduce((s, o) => s + (o.monthlyCost || 0), 0);

  const result = buckets.map((ym) => {
    let rent = 0;
    for (const l of leases) {
      if (l.customerResponsibleForRent) continue;
      if (!isMonthlyRentLease(l)) continue;
      if (!isLeaseActiveInMonth(l, ym)) continue;
      rent += l.monthlyRent || 0;
    }
    const recovered = round2(recoveredByMonth.get(ym) ?? 0);
    const rentPaid = round2(rent);
    const util = round2(utilTotal);
    const other = round2(otherTotal);
    const net = round2(recovered - rentPaid - util - other);
    return {
      month: ym,
      recovered,
      rentPaid,
      utilities: util,
      otherCosts: other,
      net,
    };
  });

  res.json(ListFinanceMonthlyResponse.parse(result));
});

router.get("/finance/by-customer", async (_req, res): Promise<void> => {
  const [customers, occupants, properties, leases, snaps] = await Promise.all([
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
  for (const p of properties) {
    propertyCustomerById.set(p.id, p.customerId ?? "");
  }

  // Most recent complete week = max payWeekEndDate present in snapshots.
  let mostRecentWeek = "";
  for (const s of snaps) {
    if (s.payWeekEndDate > mostRecentWeek) mostRecentWeek = s.payWeekEndDate;
  }

  // Current calendar month for MTD aggregation.
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  // Per-customer rollups.
  const activeOccByCustomer = new Map<string, number>();
  for (const o of occupants) {
    if (!o.propertyId) continue;
    const cid = propertyCustomerById.get(o.propertyId) ?? "";
    if (!cid) continue;
    activeOccByCustomer.set(cid, (activeOccByCustomer.get(cid) ?? 0) + 1);
  }

  const monthlyRentByCustomer = new Map<string, number>();
  for (const l of leases) {
    if (l.customerResponsibleForRent) continue;
    if (!isMonthlyRentLease(l)) continue;
    if (!isLeaseActiveInMonth(l, currentMonth)) continue;
    const cid =
      l.customerId && l.customerId.length > 0
        ? l.customerId
        : propertyCustomerById.get(l.propertyId) ?? "";
    if (!cid) continue;
    monthlyRentByCustomer.set(
      cid,
      (monthlyRentByCustomer.get(cid) ?? 0) + (l.monthlyRent || 0),
    );
  }

  const recentWeekByCustomer = new Map<string, number>();
  const mtdByCustomer = new Map<string, number>();
  for (const s of snaps) {
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

  // Union of all customers we have any data for.
  const seen = new Set<string>();
  for (const c of customers) seen.add(c.id);
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
