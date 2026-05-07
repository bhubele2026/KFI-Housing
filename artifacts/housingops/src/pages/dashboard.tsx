import { useMemo, useState } from "react";
import { MainLayout } from "@/components/layout/main-layout";
import { PageHeader } from "@/components/layout/page-header";
import { useData } from "@/context/data-store";
import { ALL_CUSTOMERS, useCustomerScope } from "@/context/customer-scope";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Building2, BedDouble, Zap, DollarSign, TrendingUp, Users, Briefcase, Trophy, AlertTriangle, Receipt, Wand2, CalendarClock, UserCheck, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListUnplacedPayroll,
  getListUnplacedPayrollQueryKey,
  useListRoomNightLogs,
  type UnplacedPayrollRow,
  type LowConfidencePayrollMatch,
} from "@workspace/api-client-react";
import { getHotelRateMonthRisk, currentMonthKey } from "@/lib/hotel-rate-status";
import { AssignOccupantDialog } from "@/components/assign-occupant-dialog";
import { EmptyState, EmptyStateRow } from "@/components/empty-state";
import { computeOverallRating, computeRentPerBed, computeElectricPerBed, computeRentPlusElectricPerBed, RATING_CATEGORIES, sumActiveRentEstimated, estimateLeaseMonthlyRent, daysUntil, type RatingCategoryKey, type Lease } from "@/data/mockData";
import { formatYMDPretty } from "@/lib/lease-dates";
import { StarRating } from "@/components/star-rating";
import { Link } from "wouter";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Progress } from "@/components/ui/progress";
import { motion } from "framer-motion";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PropertyNameCell } from "@/components/property-name-cell";
import { formatPropertyName } from "@/lib/property-name";
import { isPendingPlacementProperty } from "@/lib/pending-placement";

type TopPropertiesSortKey = "overall" | RatingCategoryKey;

export default function Dashboard() {
  const { properties, beds, leases, utilities, customers, occupants, addOccupant, updateBed, updateOccupant } = useData();
  const queryClient = useQueryClient();
  const { data: unplacedPayrollResult } = useListUnplacedPayroll();
  const unplacedPayroll = unplacedPayrollResult?.unmatched;
  const lowConfidencePayroll = unplacedPayrollResult?.lowConfidenceMatches;
  // Room-night logs power the hotel-rate "at risk this month" tile —
  // mirrors the leases page (task #319). Hook returns undefined while
  // loading; treat as empty so the tile just shows 0 / no tile.
  const { data: roomNightLogsData } = useListRoomNightLogs();
  const roomNightLogs = useMemo(() => roomNightLogsData ?? [], [roomNightLogsData]);
  const { customerId: customerFilter, setCustomerId: updateCustomerFilter } =
    useCustomerScope();
  const [topRatingSort, setTopRatingSort] = useState<TopPropertiesSortKey>("overall");

  const scopedProperties = useMemo(() => {
    if (customerFilter === ALL_CUSTOMERS) return properties;
    // Shared-housing properties (task #295/#311) surface under every
    // customer in `sharedWithCustomerIds`, in addition to the primary
    // `customerId`, so a scoped dashboard for a shared tenant still
    // sees those properties (and the beds/leases/utilities/occupants
    // derived from them).
    return properties.filter(
      (p) =>
        p.customerId === customerFilter ||
        (p.sharedWithCustomerIds ?? []).includes(customerFilter),
    );
  }, [properties, customerFilter]);

  const scopedPropertyIds = useMemo(
    () => new Set(scopedProperties.map((p) => p.id)),
    [scopedProperties],
  );

  const scopedBeds = useMemo(
    () => beds.filter((b) => scopedPropertyIds.has(b.propertyId)),
    [beds, scopedPropertyIds],
  );

  const scopedLeases = useMemo(
    () => leases.filter((l) => scopedPropertyIds.has(l.propertyId)),
    [leases, scopedPropertyIds],
  );

  const scopedUtilities = useMemo(
    () => utilities.filter((u) => scopedPropertyIds.has(u.propertyId)),
    [utilities, scopedPropertyIds],
  );

  const scopedOccupants = useMemo(
    () =>
      occupants.filter(
        (o) => o.propertyId !== null && scopedPropertyIds.has(o.propertyId),
      ),
    [occupants, scopedPropertyIds],
  );

  // Payroll-reconciliation counters (Task #304). Only consider Active
  // occupants — Former occupants don't show up in the property page so
  // counting them in the dashboard total would mislead the operator.
  // "Auto-reconciled" = `chargeSource === "payroll"`; everything else
  // (including occupants the seeder couldn't match) is "manually set".
  const activeOccupants = useMemo(
    () => scopedOccupants.filter((o) => o.status === "Active"),
    [scopedOccupants],
  );
  const autoReconciledOccupantCount = useMemo(
    () => activeOccupants.filter((o) => o.chargeSource === "payroll").length,
    [activeOccupants],
  );
  const manualOccupantCount = activeOccupants.length - autoReconciledOccupantCount;

  // Per-customer reconciliation breakdown (Task #331). Operators want to
  // see *which* customer still has manual rows so they can chase the
  // right payroll cycle. Group active in-scope occupants by their
  // property's customerId, then rank by manual count desc (tie-break by
  // name) so the worst offender sits at the top. When a single customer
  // is filtered the list collapses to one row, which is still useful as
  // a same-card confirmation of the totals above.
  const reconciliationByCustomer = useMemo(() => {
    const propertyCustomerById = new Map(
      scopedProperties.map((p) => [p.id, p.customerId] as const),
    );
    const customerNameById = new Map(customers.map((c) => [c.id, c.name] as const));
    const map = new Map<
      string,
      { customerId: string; customerName: string; manual: number; auto: number }
    >();
    for (const o of activeOccupants) {
      if (o.propertyId === null) continue;
      const customerId = propertyCustomerById.get(o.propertyId);
      if (!customerId) continue;
      const existing =
        map.get(customerId) ?? {
          customerId,
          customerName: customerNameById.get(customerId) ?? "Unknown customer",
          manual: 0,
          auto: 0,
        };
      if (o.chargeSource === "payroll") existing.auto += 1;
      else existing.manual += 1;
      map.set(customerId, existing);
    }
    return Array.from(map.values()).sort(
      (a, b) => b.manual - a.manual || a.customerName.localeCompare(b.customerName),
    );
  }, [activeOccupants, scopedProperties, customers]);

  // "Needs review" mirrors the per-page filters that the dashboard tiles
  // deep-link into. Each predicate matches what the corresponding page
  // shows when `?needsReview=1` is set — keeping the counts in sync with
  // what the operator sees after clicking through.
  // - Occupants: falsy moveInDate (mirrors the inline badge in occupants.tsx)
  // - Leases:    importer-flagged needsReview (ambiguous source cell)
  // - Properties: monthlyRent of 0 / unset (property missing rent)
  // Pending-placement buckets (Task #348). Synthetic
  // "Roster — Pending Placement (<Customer>)" properties hold payroll-only
  // people who haven't been placed in a real bed yet. Surface them on
  // the dashboard so the operator doesn't have to scroll the Properties
  // list to find each bucket. Counts use Active occupants pinned to the
  // bucket — mirrors what the per-property board shows.
  const pendingPlacementBuckets = useMemo(() => {
    return scopedProperties
      .filter((p) => isPendingPlacementProperty(p.name))
      .map((p) => ({
        property: p,
        count: scopedOccupants.filter(
          (o) => o.propertyId === p.id && o.status === "Active",
        ).length,
      }))
      .sort((a, b) => b.count - a.count || a.property.name.localeCompare(b.property.name));
  }, [scopedProperties, scopedOccupants]);

  const needsReviewOccupantCount = useMemo(
    () => scopedOccupants.filter((o) => !o.moveInDate).length,
    [scopedOccupants],
  );
  const needsReviewLeaseCount = useMemo(
    () => scopedLeases.filter((l) => l.needsReview).length,
    [scopedLeases],
  );
  const needsReviewPropertyCount = useMemo(
    () => scopedProperties.filter((p) => !(p.monthlyRent && p.monthlyRent > 0)).length,
    [scopedProperties],
  );
  // Hotel-rate "at risk this month" — every Active/Upcoming hotel-rate
  // lease in scope whose current calendar month either has no log yet
  // or logged fewer nights than the agreement's minimum. Mirrors the
  // tile on /leases (task #319) so operators can spot the warning
  // straight from the dashboard.
  // Computed per render (cheap) so the tile label flips correctly if
  // the dashboard stays open across a month boundary, instead of
  // freezing to the month at mount.
  const currentMonth = currentMonthKey();
  const hotelRateAtRiskCount = useMemo(
    () =>
      scopedLeases
        .filter((l) => l.status === "Active" || l.status === "Upcoming")
        .filter((l) => getHotelRateMonthRisk(l, roomNightLogs, currentMonth) !== null)
        .length,
    [scopedLeases, roomNightLogs, currentMonth],
  );
  // Suffix the deep-link with the active customer scope so the linked
  // page lands on the same scope the operator is already looking at.
  const customerQuerySuffix =
    customerFilter === ALL_CUSTOMERS
      ? ""
      : `&customer=${encodeURIComponent(customerFilter)}`;
  const needsReviewItems = [
    {
      key: "occupants" as const,
      count: needsReviewOccupantCount,
      label: "Occupants missing a move-in date",
      cta: "Review occupants",
      href: `/occupants?needsReview=1${customerQuerySuffix}`,
      testId: "needs-review-occupants",
    },
    {
      key: "leases" as const,
      count: needsReviewLeaseCount,
      label: "Leases flagged for review",
      cta: "Review leases",
      href: `/leases?needsReview=1${customerQuerySuffix}`,
      testId: "needs-review-leases",
    },
    {
      key: "properties" as const,
      count: needsReviewPropertyCount,
      label: "Properties missing monthly rent",
      cta: "Review properties",
      href: `/properties?needsReview=1${customerQuerySuffix}`,
      testId: "needs-review-properties",
    },
    {
      key: "hotel-rate-at-risk" as const,
      count: hotelRateAtRiskCount,
      label: `Hotel-rate leases at risk this month (${currentMonth})`,
      cta: "Review hotel-rate leases",
      // `?atRisk=1` (task #358) narrows the leases table itself to just
      // the at-risk rows so the dashboard count and the filtered table
      // line up. Customer scope is preserved so the two counts match.
      href: `/leases?atRisk=1${customerQuerySuffix}`,
      testId: "needs-review-hotel-rate-at-risk",
    },
  ].filter((item) => item.count > 0);

  // ── Expiring-soon lease alerts (Task #326) ────────────────────────
  // Surface leases whose end date is approaching (within 90 days) or
  // recently passed (within the last 30 days) so operators can renew /
  // backfill paperwork before the term silently flips to "Expired".
  // Buckets mirror the colour scale used by `getRenewalInfo` on the
  // Leases page so the dashboard reads consistently with the table.
  // - critical: ≤ 30 days left (red)
  // - warning : 31–60 days left (amber)
  // - soon    : 61–90 days left (yellow)
  // - expired : 1–30 days past end (slate, visually distinct)
  // Leases with blank term dates and Upcoming leases are skipped — the
  // first have no calendar to compare against, the second aren't an
  // expiry risk yet.
  type ExpiryBucket = "critical" | "warning" | "soon" | "expired";
  interface ExpiringLease {
    lease: Lease;
    propertyName: string;
    days: number;
    bucket: ExpiryBucket;
  }
  const expiringLeases = useMemo<ExpiringLease[]>(() => {
    const out: ExpiringLease[] = [];
    for (const l of scopedLeases) {
      if (!l.endDate) continue;
      if (l.status === "Upcoming") continue;
      // Intentionally NOT wrapped in try/catch: per `lib/lease-dates.ts`,
      // `daysUntil` throws loudly on a malformed date so we never silently
      // drop a lease that should be visible. The API boundary already
      // rejects anything other than `^\d{4}-\d{2}-\d{2}$`, so reaching
      // this throw means a real data bug worth surfacing.
      const days = daysUntil(l.endDate);
      let bucket: ExpiryBucket;
      if (days < 0) {
        if (days < -30) continue;
        bucket = "expired";
      } else if (days <= 30) {
        bucket = "critical";
      } else if (days <= 60) {
        bucket = "warning";
      } else if (days <= 90) {
        bucket = "soon";
      } else {
        continue;
      }
      const propertyName =
        scopedProperties.find((p) => p.id === l.propertyId)?.name ?? "—";
      out.push({ lease: l, propertyName, days, bucket });
    }
    // Sort by urgency: most-overdue first (most negative), then
    // soonest-expiring upcoming dates.
    out.sort((a, b) => a.days - b.days);
    return out;
  }, [scopedLeases, scopedProperties]);

  const expiringCounts = useMemo(() => {
    const counts = { critical: 0, warning: 0, soon: 0, expired: 0 };
    for (const e of expiringLeases) counts[e.bucket] += 1;
    return counts;
  }, [expiringLeases]);

  const expiryBucketStyle: Record<
    ExpiryBucket,
    { badge: string; row: string; label: string }
  > = {
    expired: {
      badge: "bg-slate-200 text-slate-800 border-slate-300",
      row: "border-l-4 border-l-slate-400 bg-slate-50/40 dark:bg-slate-950/20",
      label: "Expired",
    },
    critical: {
      badge: "bg-red-100 text-red-800 border-red-200",
      row: "border-l-4 border-l-red-500",
      label: "≤ 30 days",
    },
    warning: {
      badge: "bg-amber-100 text-amber-800 border-amber-200",
      row: "border-l-4 border-l-amber-500",
      label: "31–60 days",
    },
    soon: {
      badge: "bg-yellow-100 text-yellow-800 border-yellow-200",
      row: "border-l-4 border-l-yellow-500",
      label: "61–90 days",
    },
  };

  function expiryRowLabel(days: number): string {
    if (days < 0) {
      const abs = Math.abs(days);
      return `Expired ${abs} day${abs === 1 ? "" : "s"} ago`;
    }
    if (days === 0) return "Expires today";
    return `${days} day${days === 1 ? "" : "s"} left`;
  }

  const totalProperties = scopedProperties.length;
  const totalBeds = scopedBeds.length;
  const occupiedBeds = scopedBeds.filter((b) => b.status === "Occupied").length;
  const vacantBeds = scopedBeds.filter((b) => b.status === "Vacant").length;
  const occupancyRate = totalBeds > 0 ? (occupiedBeds / totalBeds) * 100 : 0;

  const totalMonthlyRevenue = scopedProperties.reduce((acc, p) => {
    const occupied = scopedBeds.filter((b) => b.propertyId === p.id && b.status === "Occupied");
    return acc + occupied.length * p.monthlyRent;
  }, 0);

  // Use the hotel-rate–aware estimator so corporate-rate agreements
  // (nightly × room-nights from the latest logged month) contribute to
  // the dashboard's Monthly Costs / Net Profit tiles instead of being
  // silently treated as $0. Monthly leases are unchanged because
  // `estimateLeaseMonthlyRent` returns their stored `monthlyRent` as-is.
  const totalMonthlyLeaseCosts = scopedLeases
    .filter((l) => l.status === "Active")
    .reduce((acc, l) => acc + estimateLeaseMonthlyRent(l, roomNightLogs), 0);
  const currentMonthUtilities = scopedUtilities.reduce((acc, u) => acc + u.monthlyCost, 0);
  const totalMonthlyCosts = totalMonthlyLeaseCosts + currentMonthUtilities;
  const netProfit = totalMonthlyRevenue - totalMonthlyCosts;

  // Portfolio-wide per-bed unit economics. Sums first, then divides —
  // not an average of per-property ratios — so a 100-bed property
  // weighs 100x a 1-bed property and the number matches what an
  // operator would compute with a calculator across the whole book.
  const portfolioMonthlyRent = scopedProperties.reduce((s, p) => s + (p.monthlyRent || 0), 0);
  const portfolioMonthlyElectric = scopedUtilities.reduce(
    (s, u) => (u.type === "Electric" ? s + (u.monthlyCost || 0) : s),
    0,
  );
  const portfolioRentPerBed = computeRentPerBed(portfolioMonthlyRent, totalBeds);
  const portfolioElectricPerBed = computeElectricPerBed(portfolioMonthlyElectric, totalBeds);
  const portfolioRentPlusElectricPerBed = computeRentPlusElectricPerBed(
    portfolioMonthlyRent,
    portfolioMonthlyElectric,
    totalBeds,
  );

  const topRatedProperties = useMemo(() => {
    const scored = scopedProperties.map((p) => {
      const overall = computeOverallRating(p.ratings);
      const score =
        topRatingSort === "overall" ? overall : (p.ratings?.[topRatingSort] ?? 0) || null;
      return { property: p, overall, score };
    });
    return scored
      .filter((row) => row.score !== null && row.score > 0)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, 5);
  }, [scopedProperties, topRatingSort]);

  const sortLabel =
    topRatingSort === "overall"
      ? "Overall"
      : RATING_CATEGORIES.find((c) => c.key === topRatingSort)?.label ?? "Overall";

  // Carry the property id through chartData so downstream lookups (customer
  // name, occupancy %, row keys) don't depend on `name` — two properties can
  // share a name in the demo data, which would otherwise mis-map rows. The
  // `name` field is kept purely for display via the chart tickFormatter.
  // Lease cost sums every Active lease for the property — picking just the
  // first match silently under-reports rent (matches finance.tsx behavior).
  const chartData = useMemo(
    () =>
      scopedProperties.map((p) => {
        const revenue = scopedBeds.filter((b) => b.propertyId === p.id && b.status === "Occupied").length * p.monthlyRent;
        const leaseCost = sumActiveRentEstimated(scopedLeases, roomNightLogs, p.id);
        const utilCost = scopedUtilities.filter((u) => u.propertyId === p.id).reduce((acc, u) => acc + u.monthlyCost, 0);
        return {
          id: p.id,
          name: p.name,
          Revenue: revenue,
          Cost: leaseCost + utilCost,
          Profit: revenue - (leaseCost + utilCost),
        };
      }),
    [scopedProperties, scopedBeds, scopedLeases, scopedUtilities, roomNightLogs],
  );

  const cards = [
    { title: "Properties", value: totalProperties, icon: Building2, trend: "+2 this year" },
    { title: "Total Beds", value: totalBeds, icon: BedDouble, trend: `${occupiedBeds} occupied` },
    { title: "Occupancy", value: `${occupancyRate.toFixed(1)}%`, icon: Users, trend: `${vacantBeds} vacant` },
    { title: "Monthly Revenue", value: `$${totalMonthlyRevenue.toLocaleString()}`, icon: TrendingUp, trend: "Target: $45k" },
    { title: "Monthly Costs", value: `$${totalMonthlyCosts.toLocaleString()}`, icon: DollarSign, trend: "Leases + Utilities" },
    { title: "Net Profit", value: `$${netProfit.toLocaleString()}`, icon: Zap, trend: netProfit >= 0 ? "+12% vs last month" : "Needs attention" },
    {
      title: "Rent / Bed",
      value:
        portfolioRentPerBed === null
          ? "—"
          : `$${portfolioRentPerBed.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
      icon: BedDouble,
      trend: `$${portfolioMonthlyRent.toLocaleString()} ÷ ${totalBeds} bed${totalBeds === 1 ? "" : "s"}`,
    },
    {
      title: "Electric / Bed",
      value:
        portfolioElectricPerBed === null
          ? "—"
          : `$${portfolioElectricPerBed.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
      icon: Zap,
      trend: `$${portfolioMonthlyElectric.toLocaleString()} electric ÷ ${totalBeds} bed${totalBeds === 1 ? "" : "s"}`,
    },
    {
      title: "Rent + Electric / Bed",
      value:
        portfolioRentPlusElectricPerBed === null
          ? "—"
          : `$${portfolioRentPlusElectricPerBed.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
      icon: DollarSign,
      trend: `(Rent + $${portfolioMonthlyElectric.toLocaleString()} electric) ÷ ${totalBeds} bed${totalBeds === 1 ? "" : "s"}`,
    },
  ];

  // Unplaced payroll = deduction rows the seeder couldn't match to an
  // active occupant. Group by customer so the operator can attack one
  // company at a time. Respect the dashboard's customer filter.
  const scopedUnplacedPayroll = useMemo<UnplacedPayrollRow[]>(() => {
    const rows = unplacedPayroll ?? [];
    if (customerFilter === ALL_CUSTOMERS) return rows;
    const customerName = customers.find((c) => c.id === customerFilter)?.name;
    if (!customerName) return [];
    return rows.filter((r) => r.customer === customerName);
  }, [unplacedPayroll, customerFilter, customers]);

  const unplacedByCustomer = useMemo(() => {
    const map = new Map<string, { customer: string; rows: UnplacedPayrollRow[]; weeklyTotal: number }>();
    for (const r of scopedUnplacedPayroll) {
      const existing = map.get(r.customer) ?? { customer: r.customer, rows: [], weeklyTotal: 0 };
      existing.rows.push(r);
      existing.weeklyTotal += r.weekly;
      map.set(r.customer, existing);
    }
    return Array.from(map.values()).sort((a, b) => b.weeklyTotal - a.weeklyTotal);
  }, [scopedUnplacedPayroll]);

  // Low-confidence matches = payroll rows the seeder applied via the
  // name-only fallback. The rate is already on someone, but at an
  // employer with two namesakes it may be the wrong someone — surface
  // them so the operator can confirm or redirect. Same scoping rules
  // as the unplaced list above.
  const scopedLowConfidencePayroll = useMemo<LowConfidencePayrollMatch[]>(() => {
    const rows = lowConfidencePayroll ?? [];
    if (customerFilter === ALL_CUSTOMERS) return rows;
    const customerName = customers.find((c) => c.id === customerFilter)?.name;
    if (!customerName) return [];
    return rows.filter((r) => r.customer === customerName);
  }, [lowConfidencePayroll, customerFilter, customers]);

  const lowConfidenceByCustomer = useMemo(() => {
    const map = new Map<string, { customer: string; rows: LowConfidencePayrollMatch[] }>();
    for (const r of scopedLowConfidencePayroll) {
      const existing = map.get(r.customer) ?? { customer: r.customer, rows: [] };
      existing.rows.push(r);
      map.set(r.customer, existing);
    }
    return Array.from(map.values()).sort((a, b) => a.customer.localeCompare(b.customer));
  }, [scopedLowConfidencePayroll]);

  const activeCustomerName =
    customerFilter === ALL_CUSTOMERS
      ? null
      : customers.find((c) => c.id === customerFilter)?.name ?? null;

  return (
    <MainLayout>
      <div className="p-8 max-w-7xl mx-auto space-y-8">
        <PageHeader
          title="Dashboard"
          description="Overview of your housing operations and financials."
          meta={
            activeCustomerName ? (
              <p
                className="text-xs text-muted-foreground flex items-center gap-1"
                data-testid="text-dashboard-active-customer"
              >
                <Briefcase className="h-3 w-3" />
                Showing only <span className="font-semibold">{activeCustomerName}</span>
              </p>
            ) : null
          }
          actions={
            <Select value={customerFilter} onValueChange={updateCustomerFilter}>
              <SelectTrigger className="w-full sm:w-56" data-testid="select-dashboard-customer-filter">
                <SelectValue placeholder="Customer" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_CUSTOMERS}>All Customers</SelectItem>
                {customers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          {cards.map((card, i) => (
            <motion.div key={card.title} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }}>
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between space-y-0 pb-2">
                    <p className="text-sm font-medium text-muted-foreground">{card.title}</p>
                    <card.icon className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-2xl font-bold">{card.value}</span>
                    <span className="text-xs text-muted-foreground mt-1">{card.trend}</span>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>

        {pendingPlacementBuckets.length > 0 && (
          <Card
            className="border-amber-300 dark:border-amber-700 bg-amber-50/60 dark:bg-amber-950/20"
            data-testid="card-pending-placement"
          >
            <CardHeader>
              <div className="flex items-center gap-2">
                <UserCheck className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                <CardTitle>Pending placement</CardTitle>
                <span
                  className="text-xs text-muted-foreground ml-auto tabular-nums"
                  data-testid="text-pending-placement-total-count"
                >
                  {pendingPlacementBuckets.reduce((s, b) => s + b.count, 0)} pending ·{" "}
                  {pendingPlacementBuckets.length} bucket
                  {pendingPlacementBuckets.length === 1 ? "" : "s"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                People on the weekly housing-deduction roster who haven't been
                placed in a real bed yet. Open a bucket to move each person to
                a property + bed. Empty buckets are listed too so they can be
                cleared away.
              </p>
            </CardHeader>
            <CardContent className="space-y-2">
              {pendingPlacementBuckets.map(({ property, count }) => (
                <Link
                  key={property.id}
                  href={`/properties/${property.id}`}
                  className="flex items-center justify-between rounded-md border bg-card/60 px-4 py-3 hover:bg-accent/40 transition-colors"
                  data-testid={`row-pending-placement-${property.id}`}
                >
                  <div className="min-w-0 flex-1 mr-4">
                    <p
                      className="text-sm font-medium truncate"
                      data-testid={`text-pending-placement-${property.id}-name`}
                    >
                      {property.name}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span
                      className="text-sm font-semibold tabular-nums"
                      data-testid={`text-pending-placement-${property.id}-count`}
                    >
                      {count} {count === 1 ? "person" : "people"} pending
                    </span>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </Link>
              ))}
            </CardContent>
          </Card>
        )}

        {needsReviewItems.length > 0 && (
          <Card
            className="border-amber-300 dark:border-amber-700 bg-amber-50/60 dark:bg-amber-950/20"
            data-testid="card-needs-review"
          >
            <CardContent className="p-6 space-y-4">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                <p className="text-sm font-semibold">Needs review</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {needsReviewItems.map((item) => (
                  <div
                    key={item.key}
                    className="flex items-start gap-3 rounded-md border border-amber-200/60 dark:border-amber-800/40 bg-card/60 p-4"
                    data-testid={`tile-${item.testId}`}
                  >
                    <div className="flex flex-col flex-1 min-w-0">
                      <p
                        className="text-2xl font-bold tabular-nums"
                        data-testid={`text-${item.testId}-count`}
                      >
                        {item.count}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">{item.label}.</p>
                      <Button
                        asChild
                        variant="outline"
                        size="sm"
                        className="mt-3 self-start"
                        data-testid={`button-${item.testId}-cta`}
                      >
                        <Link href={item.href}>{item.cta}</Link>
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {expiringLeases.length > 0 && (
          <Card data-testid="card-expiring-leases">
            <CardHeader>
              <div className="flex items-center gap-2">
                <CalendarClock className="h-4 w-4 text-muted-foreground" />
                <CardTitle>Lease expiry alerts</CardTitle>
                <span
                  className="text-xs text-muted-foreground ml-auto tabular-nums"
                  data-testid="text-expiring-leases-total-count"
                >
                  {expiringLeases.length} lease
                  {expiringLeases.length === 1 ? "" : "s"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Leases ending in the next 30 / 60 / 90 days, plus any that
                quietly expired in the last 30 days.
              </p>
              <div
                className="mt-2 flex flex-wrap gap-2 text-xs"
                data-testid="bucket-counts-expiring-leases"
              >
                {expiringCounts.expired > 0 && (
                  <span
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${expiryBucketStyle.expired.badge}`}
                    data-testid="bucket-count-expiring-leases-expired"
                  >
                    {expiringCounts.expired} expired
                  </span>
                )}
                {expiringCounts.critical > 0 && (
                  <span
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${expiryBucketStyle.critical.badge}`}
                    data-testid="bucket-count-expiring-leases-critical"
                  >
                    {expiringCounts.critical} ≤ 30 days
                  </span>
                )}
                {expiringCounts.warning > 0 && (
                  <span
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${expiryBucketStyle.warning.badge}`}
                    data-testid="bucket-count-expiring-leases-warning"
                  >
                    {expiringCounts.warning} 31–60 days
                  </span>
                )}
                {expiringCounts.soon > 0 && (
                  <span
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${expiryBucketStyle.soon.badge}`}
                    data-testid="bucket-count-expiring-leases-soon"
                  >
                    {expiringCounts.soon} 61–90 days
                  </span>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Property</TableHead>
                    <TableHead>Ends</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {expiringLeases.map(({ lease, propertyName, days, bucket }) => {
                    const style = expiryBucketStyle[bucket];
                    return (
                      <TableRow
                        key={lease.id}
                        className={style.row}
                        data-testid={`row-expiring-lease-${lease.id}`}
                        data-bucket={bucket}
                      >
                        <TableCell className="font-medium">
                          <Link
                            href={`/leases/${lease.id}`}
                            className="hover:underline text-primary"
                            data-testid={`link-expiring-lease-${lease.id}`}
                          >
                            <PropertyNameCell
                              name={propertyName}
                              primaryClassName="text-primary"
                            />
                          </Link>
                        </TableCell>
                        <TableCell className="text-sm tabular-nums text-muted-foreground">
                          {formatYMDPretty(lease.endDate)}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={style.badge}
                            data-testid={`badge-expiring-lease-${lease.id}`}
                          >
                            {style.label}
                          </Badge>
                        </TableCell>
                        <TableCell
                          className="text-right text-sm tabular-nums"
                          data-testid={`text-expiring-lease-${lease.id}-when`}
                        >
                          {expiryRowLabel(days)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {activeOccupants.length > 0 && (
          <Card data-testid="card-payroll-reconciliation">
            <CardContent className="p-6">
              <div className="flex items-center gap-2 mb-3">
                <Receipt className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm font-semibold">Payroll reconciliation</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <p
                    className="text-2xl font-bold tabular-nums text-emerald-700 dark:text-emerald-400"
                    data-testid="text-payroll-auto-reconciled-count"
                  >
                    {autoReconciledOccupantCount}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Occupant{autoReconciledOccupantCount === 1 ? "" : "s"} with charge auto-set from payroll.
                  </p>
                </div>
                <div>
                  <p
                    className="text-2xl font-bold tabular-nums"
                    data-testid="text-payroll-manual-count"
                  >
                    {manualOccupantCount}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Occupant{manualOccupantCount === 1 ? "" : "s"} with manually-entered charge.
                  </p>
                </div>
                <div>
                  <p
                    className="text-2xl font-bold tabular-nums text-muted-foreground"
                    data-testid="text-payroll-total-count"
                  >
                    {activeOccupants.length}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Total active occupants in scope.
                  </p>
                </div>
              </div>
              {reconciliationByCustomer.length > 0 && (
                <div className="mt-6">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                    By customer · ranked by manual rows
                  </p>
                  <Table data-testid="table-payroll-reconciliation-by-customer">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Customer</TableHead>
                        <TableHead className="text-right">Manual</TableHead>
                        <TableHead className="text-right">Auto</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {reconciliationByCustomer.map((row) => {
                        const total = row.manual + row.auto;
                        return (
                          <TableRow
                            key={row.customerId}
                            data-testid={`row-payroll-reconciliation-${row.customerId}`}
                          >
                            <TableCell className="font-medium">{row.customerName}</TableCell>
                            <TableCell
                              className={
                                "text-right tabular-nums " +
                                (row.manual > 0 ? "font-semibold" : "text-muted-foreground")
                              }
                              data-testid={`text-payroll-reconciliation-${row.customerId}-manual`}
                            >
                              {row.manual}
                            </TableCell>
                            <TableCell
                              className="text-right tabular-nums text-emerald-700 dark:text-emerald-400"
                              data-testid={`text-payroll-reconciliation-${row.customerId}-auto`}
                            >
                              {row.auto}
                            </TableCell>
                            <TableCell
                              className="text-right tabular-nums text-muted-foreground"
                              data-testid={`text-payroll-reconciliation-${row.customerId}-total`}
                            >
                              {total}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {unplacedByCustomer.length > 0 && (
          <Card data-testid="card-unplaced-payroll">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Receipt className="h-4 w-4 text-muted-foreground" />
                <CardTitle>Unplaced payroll</CardTitle>
                <span
                  className="text-xs text-muted-foreground ml-auto tabular-nums"
                  data-testid="text-unplaced-payroll-total-count"
                >
                  {scopedUnplacedPayroll.length} row{scopedUnplacedPayroll.length === 1 ? "" : "s"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Payroll deductions that don't yet match an active occupant. Assign each
                person to a bed and the row will drop off after the next sync.
              </p>
            </CardHeader>
            <CardContent className="space-y-6">
              {unplacedByCustomer.map((group) => (
                <div
                  key={group.customer}
                  data-testid={`group-unplaced-${group.customer}`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-semibold">{group.customer}</p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {group.rows.length} row{group.rows.length === 1 ? "" : "s"} · $
                      {group.weeklyTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })}/wk
                    </p>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead className="text-right">Weekly</TableHead>
                        <TableHead className="w-32" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {group.rows.map((row) => (
                        <TableRow
                          key={`${row.customer}::${row.personId}`}
                          data-testid={`row-unplaced-${row.personId}`}
                        >
                          <TableCell className="font-medium">
                            <div>{row.name}</div>
                            {row.suggestions.length > 0 && (
                              <div
                                className="mt-1 flex flex-wrap items-center gap-1"
                                data-testid={`suggestions-unplaced-${row.personId}`}
                              >
                                <span
                                  className={
                                    "text-xs inline-flex items-center gap-1 " +
                                    (row.suggestions[0]!.crossEmployer
                                      ? "text-amber-700 dark:text-amber-400"
                                      : "text-muted-foreground")
                                  }
                                >
                                  <Wand2 className="h-3 w-3" />
                                  {row.suggestions[0]!.crossEmployer
                                    ? "Did you mean (different employer):"
                                    : "Did you mean:"}
                                </span>
                                {row.suggestions.map((s) => (
                                  <Button
                                    key={s.occupantId}
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    className={
                                      "h-6 px-2 text-xs " +
                                      (s.crossEmployer
                                        ? "text-amber-700 dark:text-amber-400"
                                        : "")
                                    }
                                    onClick={() => {
                                      // Apply payroll's recurring rate to the
                                      // existing occupant. The seeder will then
                                      // match this row by name+company on the
                                      // next refetch and drop it from the list.
                                      // For a cross-employer suggestion, also
                                      // overwrite the occupant's company so the
                                      // record now sits under the correct
                                      // customer (the operator implicitly
                                      // confirmed the employer change by
                                      // clicking the warning-labeled button).
                                      updateOccupant(s.occupantId, {
                                        chargePerBed: row.weekly,
                                        billingFrequency: "Weekly",
                                        ...(row.personId
                                          ? { employeeId: row.personId }
                                          : {}),
                                        ...(s.crossEmployer
                                          ? { company: row.customer }
                                          : {}),
                                      });
                                      queryClient.invalidateQueries({
                                        queryKey: getListUnplacedPayrollQueryKey(),
                                      });
                                    }}
                                    data-testid={`button-apply-suggestion-${row.personId}-${s.occupantId}`}
                                  >
                                    {s.name}
                                    {s.propertyName ? ` @ ${s.propertyName}` : " (unassigned)"}
                                    {s.crossEmployer ? ` — ${s.company}` : ""}
                                  </Button>
                                ))}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            ${row.weekly.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                          </TableCell>
                          <TableCell className="text-right">
                            <AssignOccupantDialog
                              testIdSuffix={row.personId}
                              initial={{
                                name: row.name,
                                company: row.customer,
                                employeeId: row.personId,
                                chargePerBed: row.weekly,
                                billingFrequency: "Weekly",
                              }}
                              trigger={
                                <Button
                                  size="sm"
                                  variant="outline"
                                  data-testid={`button-assign-unplaced-${row.personId}`}
                                >
                                  Assign to bed
                                </Button>
                              }
                              onAssign={(occ, bed) => {
                                addOccupant(occ);
                                updateBed(bed.id, {
                                  status: "Occupied",
                                  occupantId: occ.id,
                                });
                                // Re-run the seeder server-side and refetch
                                // the unplaced list so this row drops off.
                                queryClient.invalidateQueries({
                                  queryKey: getListUnplacedPayrollQueryKey(),
                                });
                              }}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {lowConfidenceByCustomer.length > 0 && (
          <Card data-testid="card-low-confidence-payroll">
            <CardHeader>
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                <CardTitle>Confirm match</CardTitle>
                <span
                  className="text-xs text-muted-foreground ml-auto tabular-nums"
                  data-testid="text-low-confidence-payroll-total-count"
                >
                  {scopedLowConfidencePayroll.length} row
                  {scopedLowConfidencePayroll.length === 1 ? "" : "s"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Payroll rows that matched an existing occupant only by
                name. At employers with two namesakes the wrong person may
                have received the rate — confirm the right one (or pick a
                different occupant) so the next sync locks the match in by
                Person Id.
              </p>
            </CardHeader>
            <CardContent className="space-y-6">
              {lowConfidenceByCustomer.map((group) => (
                <div
                  key={group.customer}
                  data-testid={`group-low-confidence-${group.customer}`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-semibold">{group.customer}</p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {group.rows.length} row{group.rows.length === 1 ? "" : "s"}
                    </p>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Payroll name · Person Id</TableHead>
                        <TableHead>Currently applied to</TableHead>
                        <TableHead className="text-right">Weekly</TableHead>
                        <TableHead className="w-32" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {group.rows.map((row) => (
                        <TableRow
                          key={`${row.customer}::${row.personId}`}
                          data-testid={`row-low-confidence-${row.personId}`}
                        >
                          <TableCell className="font-medium">
                            <div>{row.name}</div>
                            <div className="text-xs text-muted-foreground tabular-nums">
                              {row.personId}
                            </div>
                          </TableCell>
                          <TableCell className="text-sm">
                            <div data-testid={`low-confidence-matched-${row.personId}`}>
                              {row.matched.name}
                              {row.matched.propertyName
                                ? ` @ ${row.matched.propertyName}`
                                : " (unassigned)"}
                            </div>
                            {row.suggestions.length > 0 && (
                              <div
                                className="mt-1 flex flex-wrap items-center gap-1"
                                data-testid={`low-confidence-alternatives-${row.personId}`}
                              >
                                <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                                  <Wand2 className="h-3 w-3" />
                                  Did you mean:
                                </span>
                                {row.suggestions.map((s) => (
                                  <Button
                                    key={s.occupantId}
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    className="h-6 px-2 text-xs"
                                    onClick={() => {
                                      // Redirect the rate to the
                                      // alternative occupant and stamp
                                      // the payroll Person Id so the
                                      // next sync matches strongly via
                                      // employeeId. The seeder will
                                      // then drop this row from the
                                      // low-confidence list.
                                      updateOccupant(s.occupantId, {
                                        chargePerBed: row.weekly,
                                        billingFrequency: "Weekly",
                                        employeeId: row.personId,
                                      });
                                      queryClient.invalidateQueries({
                                        queryKey: getListUnplacedPayrollQueryKey(),
                                      });
                                    }}
                                    data-testid={`button-redirect-low-confidence-${row.personId}-${s.occupantId}`}
                                  >
                                    {s.name}
                                    {s.propertyName ? ` @ ${s.propertyName}` : " (unassigned)"}
                                  </Button>
                                ))}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            ${row.weekly.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                // "Confirm" stamps employeeId on the
                                // already-matched occupant. The seeder
                                // then matches via the strong
                                // employeeId path and the row drops
                                // off the low-confidence list.
                                updateOccupant(row.matched.occupantId, {
                                  employeeId: row.personId,
                                });
                                queryClient.invalidateQueries({
                                  queryKey: getListUnplacedPayrollQueryKey(),
                                });
                              }}
                              data-testid={`button-confirm-low-confidence-${row.personId}`}
                            >
                              Confirm
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Occupancy Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>{occupiedBeds} Occupied</span>
                <span>{vacantBeds} Vacant</span>
              </div>
              <Progress value={occupancyRate} className="h-4" />
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-top-properties">
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <Trophy className="h-4 w-4 text-amber-500" />
              <CardTitle>Top Properties by Rating</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Sort by</span>
              <Select
                value={topRatingSort}
                onValueChange={(v) => setTopRatingSort(v as TopPropertiesSortKey)}
              >
                <SelectTrigger className="w-44 h-8" data-testid="select-top-rating-sort">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="overall">Overall</SelectItem>
                  {RATING_CATEGORIES.map((c) => (
                    <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            {topRatedProperties.length === 0 ? (
              <EmptyState
                icon={properties.length === 0 ? Building2 : Trophy}
                title={
                  properties.length === 0
                    ? "No properties yet"
                    : `No ${sortLabel.toLowerCase()} ratings yet`
                }
                description={
                  properties.length === 0
                    ? "Add your first property to start ranking your top performers here."
                    : "Rate your properties to see your top performers ranked here."
                }
                action={
                  <Button asChild data-testid="button-empty-top-rated-cta">
                    <Link href="/properties">
                      {properties.length === 0 ? "Add Property" : "Rate Properties"}
                    </Link>
                  </Button>
                }
                testId="empty-top-rated-properties"
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>Property</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>{sortLabel}</TableHead>
                    <TableHead className="text-right">Score</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topRatedProperties.map((row, i) => {
                    const customer = customers.find((c) => c.id === row.property.customerId);
                    const score = row.score ?? 0;
                    return (
                      <TableRow key={row.property.id} data-testid={`row-top-rated-${row.property.id}`}>
                        <TableCell className="text-sm font-semibold tabular-nums text-muted-foreground">
                          {i + 1}
                        </TableCell>
                        <TableCell className="font-medium">
                          <Link
                            href={`/properties/${row.property.id}`}
                            className="hover:underline text-primary"
                          >
                            <PropertyNameCell
                              name={row.property.name}
                              primaryClassName="text-primary"
                            />
                          </Link>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {customer?.name ?? <span className="italic">—</span>}
                        </TableCell>
                        <TableCell>
                          <StarRating value={score} readOnly size="sm" ariaLabel={`${sortLabel} rating`} />
                        </TableCell>
                        <TableCell className="text-right text-sm font-semibold tabular-nums">
                          {score.toFixed(1)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <Card>
            <CardHeader>
              <CardTitle>Financial Overview</CardTitle>
            </CardHeader>
            <CardContent className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="id"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) => {
                      const row = chartData.find((d) => d.id === value);
                      return row ? formatPropertyName(row.name).primary : value;
                    }}
                  />
                  <YAxis fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `$${value}`} />
                  <Tooltip
                    formatter={(value) => `$${value}`}
                    labelFormatter={(label) => {
                      const row = chartData.find((d) => d.id === label);
                      return row?.name ?? String(label);
                    }}
                    cursor={{fill: 'transparent'}}
                  />
                  <Legend />
                  <Bar dataKey="Revenue" fill="hsl(217 71% 21%)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Cost" fill="hsl(217 25% 65%)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Property Performance</CardTitle>
            </CardHeader>
            <CardContent>
              <Table containerClassName="max-h-[300px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky top-0 z-10 bg-card">Property</TableHead>
                    <TableHead className="sticky top-0 z-10 bg-card">Customer</TableHead>
                    <TableHead className="sticky top-0 z-10 bg-card">Occupancy</TableHead>
                    <TableHead className="sticky top-0 z-10 bg-card text-right">Profit/Loss</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {chartData.length === 0 ? (
                    <EmptyStateRow
                      colSpan={4}
                      icon={Building2}
                      title={
                        properties.length === 0
                          ? "No properties yet"
                          : "No properties match this customer"
                      }
                      description={
                        properties.length === 0
                          ? "Add your first property to start tracking performance here."
                          : "Pick a different customer above, or add properties to this one to see performance."
                      }
                      action={
                        <Button asChild data-testid="button-empty-perf-cta">
                          <Link href="/properties">Add Property</Link>
                        </Button>
                      }
                      testId="empty-property-performance"
                    />
                  ) : (
                    chartData.map((data) => {
                      const property = scopedProperties.find(p => p.id === data.id);
                      const customer = property ? customers.find(c => c.id === property.customerId) : undefined;
                      // Derive occupancy from the actual bed rows for this
                      // property — the static `totalBeds` field on the
                      // property record can drift from reality (or be 0),
                      // which previously inflated occupancy past 100%.
                      const propBeds = scopedBeds.filter(b => b.propertyId === data.id);
                      const propOccupied = propBeds.filter(b => b.status === "Occupied").length;
                      const occupancyPct = propBeds.length > 0
                        ? Math.round((propOccupied / propBeds.length) * 100)
                        : 0;
                      return (
                        <TableRow key={data.id} data-testid={`row-perf-${data.id}`}>
                          <TableCell><PropertyNameCell name={data.name} /></TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {customer?.name ?? <span className="italic">—</span>}
                          </TableCell>
                          <TableCell>{occupancyPct}%</TableCell>
                          <TableCell className="text-right">
                            <Badge variant={data.Profit >= 0 ? "default" : "destructive"} className={data.Profit >= 0 ? "bg-emerald-500 hover:bg-emerald-600" : ""}>
                              ${Math.abs(data.Profit).toLocaleString()} {data.Profit >= 0 ? 'Profit' : 'Loss'}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </div>
    </MainLayout>
  );
}
