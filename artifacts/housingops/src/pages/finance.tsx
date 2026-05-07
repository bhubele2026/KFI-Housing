import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { MainLayout } from "@/components/layout/main-layout";
import { PageHeader } from "@/components/layout/page-header";
import { PropertyNameCell } from "@/components/property-name-cell";
import { formatPropertyName } from "@/lib/property-name";
import { useData } from "@/context/data-store";
import { ALL_CUSTOMERS, useCustomerScope } from "@/context/customer-scope";
import { sumActiveRentBreakdown, toMonthlyCharge, formatUsd, type Lease, type RoomNightLog } from "@/data/mockData";
import { useListRoomNightLogs } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { motion } from "framer-motion";
import { Briefcase, X, DollarSign, Building2, Download, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { toCsv, toCsvRows, downloadCsv, timestampedCsvName } from "@/lib/csv";
import { useToast } from "@/hooks/use-toast";

// Donut palette for the utility breakdown chart. Picked to mirror the
// stacked bar chart's accent hues (destructive red, orange, amber)
// while staying distinct enough that operators can read each utility
// type at a glance from the legend.
const UTILITY_COLORS = [
  "hsl(25 95% 53%)",
  "hsl(217 91% 60%)",
  "hsl(142 76% 36%)",
  "hsl(280 70% 55%)",
  "hsl(0 72% 51%)",
  "hsl(45 93% 47%)",
  "hsl(190 80% 45%)",
  "hsl(330 70% 55%)",
];

// Build the trailing-12-month axis ending at the current month, in
// chronological YYYY-MM order. Returned regardless of whether any
// room-night logs exist so the chart x-axis is always anchored to
// real calendar months.
function trailingMonths(count: number, anchor: Date): string[] {
  const out: string[] = [];
  const y = anchor.getFullYear();
  const m = anchor.getMonth();
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(y, m - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

function formatMonthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
}

// Hotel-rate cost for a specific calendar month: sum of nightlyRate ×
// roomNights for every active hotel-rate lease that has a log in that
// month. Months with no log contribute 0 — same "don't invent revenue"
// posture as `estimateLeaseMonthlyRent`.
function hotelRateCostForMonth(
  leases: readonly Lease[],
  logs: readonly RoomNightLog[],
  ym: string,
): number {
  let total = 0;
  for (const log of logs) {
    if (log.month !== ym) continue;
    const lease = leases.find((l) => l.id === log.leaseId);
    if (!lease || lease.status !== "Active") continue;
    if ((lease.rateType ?? "monthly") !== "room-night") continue;
    total += (lease.nightlyRate || 0) * (log.roomNights || 0);
  }
  return Math.round(total * 100) / 100;
}

type RentRollSortKey =
  | "property"
  | "customer"
  | "rateType"
  | "rentOrMin"
  | "bedsCovered"
  | "securityDeposit";
type SortDirection = "asc" | "desc";

export default function Finance() {
  const { t } = useTranslation();
  const { properties, beds, leases, utilities, otherCosts, occupants, customers } = useData();
  const { customerId: customerFilter, setCustomerId: updateCustomerFilter } =
    useCustomerScope();
  // Room-night logs power the hotel-rate revenue estimate so corporate
  // agreements (Ridge Motor Inn, Comfort Suites Madison, etc.) show up
  // in Lease Cost / Net Profit / Total Costs instead of being silently
  // treated as $0. Mirrors property-detail / dashboard behaviour.
  const { data: roomNightLogsData } = useListRoomNightLogs();
  const roomNightLogs = useMemo(() => roomNightLogsData ?? [], [roomNightLogsData]);

  const customerById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of customers) map.set(c.id, c.name);
    return map;
  }, [customers]);

  const visibleProperties = useMemo(() => {
    if (customerFilter === ALL_CUSTOMERS) return properties;
    return properties.filter((p) => p.customerId === customerFilter);
  }, [properties, customerFilter]);

  const financialData = visibleProperties.map(p => {
    const propOccupants = occupants.filter(o => o.propertyId === p.id && o.status === "Active");
    const revenue = propOccupants.reduce((s, o) => s + toMonthlyCharge(o.chargePerBed, o.billingFrequency ?? "Monthly"), 0);
    const { contractCost, hotelRateCost, hasHotelRateLease } = sumActiveRentBreakdown(leases, roomNightLogs, p.id);
    const leaseCost = contractCost + hotelRateCost;
    const propUtils = utilities.filter(u => u.propertyId === p.id);
    const rawUtilCost = propUtils.reduce((s, u) => s + u.monthlyCost, 0);
    // Utilities-included-in-rent exclusion (task #518). Pro-rate the
    // tracked utility expense by the share of this property's active
    // leases whose rent already bundles utilities — those dollars are
    // already netted in the lease cost above, so subtracting them from
    // utilities too would double-count. When every active lease is
    // flagged, utilities drop out entirely; when none are flagged the
    // existing total is unchanged.
    const propActiveLeases = leases.filter(
      (l) => l.propertyId === p.id && l.status === "Active",
    );
    const utilitiesIncludedShare = propActiveLeases.length > 0
      ? propActiveLeases.filter((l) => l.utilitiesIncludedInRent).length /
        propActiveLeases.length
      : 0;
    const utilCost = rawUtilCost * (1 - utilitiesIncludedShare);
    // Per-property recurring non-rent line items (task #497). Surfaced as
    // a distinct rollup so they aren't silently merged into rent — the
    // Finance table can label them "Other Costs" alongside Lease Cost.
    const propOtherCosts = otherCosts.filter(c => c.propertyId === p.id);
    const otherCost = propOtherCosts.reduce((s, c) => s + (c.monthlyCost || 0), 0);
    // Per-bed "electric" specifically excludes water/internet/etc, matching
    // the Dashboard and Property Detail Electric / Bed cards. Total Utility
    // Cost above keeps summing every utility type.
    const electricCost = propUtils.reduce(
      (s, u) => (u.type === "Electric" ? s + (u.monthlyCost || 0) : s),
      0,
    );
    const totalCost = leaseCost + utilCost + otherCost;
    const occupiedBeds = beds.filter(b => b.propertyId === p.id && b.status === "Occupied").length;
    const totalBeds = beds.filter(b => b.propertyId === p.id).length;
    const customerName = p.customerId ? customerById.get(p.customerId) : undefined;
    // Per-bed unit economics. `null` on zero beds so the cell renders an
    // em-dash instead of a misleading $0 — same contract as the helpers
    // in mockData.ts (computeRentPerBed et al).
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const rentPerBed = totalBeds ? round2(leaseCost / totalBeds) : null;
    const electricPerBed = totalBeds ? round2(electricCost / totalBeds) : null;
    const rentPlusElectricPerBed = totalBeds
      ? round2((leaseCost + electricCost) / totalBeds)
      : null;

    return {
      id: p.id,
      name: p.name,
      shortName: formatPropertyName(p.name).primary,
      customerId: p.customerId,
      customerName,
      revenue,
      leaseCost,
      contractCost,
      hotelRateCost,
      hasHotelRateLease,
      utilCost,
      otherCost,
      electricCost,
      totalCost,
      profit: revenue - totalCost,
      occupiedBeds,
      totalBeds,
      rentPerBed,
      electricPerBed,
      rentPlusElectricPerBed,
    };
  });

  const totals = financialData.reduce(
    (acc, d) => ({
      revenue: acc.revenue + d.revenue,
      leaseCost: acc.leaseCost + d.leaseCost,
      contractCost: acc.contractCost + d.contractCost,
      hotelRateCost: acc.hotelRateCost + d.hotelRateCost,
      hasAnyHotelRateLease: acc.hasAnyHotelRateLease || d.hasHotelRateLease,
      utilCost: acc.utilCost + d.utilCost,
      otherCost: acc.otherCost + d.otherCost,
      electricCost: acc.electricCost + d.electricCost,
      totalCost: acc.totalCost + d.totalCost,
      profit: acc.profit + d.profit,
      totalBeds: acc.totalBeds + d.totalBeds,
    }),
    { revenue: 0, leaseCost: 0, contractCost: 0, hotelRateCost: 0, hasAnyHotelRateLease: false, utilCost: 0, otherCost: 0, electricCost: 0, totalCost: 0, profit: 0, totalBeds: 0 }
  );
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const totalsRentPerBed = totals.totalBeds ? round2(totals.leaseCost / totals.totalBeds) : null;
  const totalsElectricPerBed = totals.totalBeds ? round2(totals.electricCost / totals.totalBeds) : null;
  const totalsRentPlusElectricPerBed = totals.totalBeds
    ? round2((totals.leaseCost + totals.electricCost) / totals.totalBeds)
    : null;
  const fmtPerBed = (v: number | null) =>
    v === null ? "—" : `${formatUsd(v)}`;

  // ── Extended KPIs ──────────────────────────────────────────────────
  // Portfolio-wide rollups derived from the same per-property numbers
  // already computed above so the KPI strip never disagrees with the
  // table beneath it.
  const totalOccupiedBeds = financialData.reduce((s, d) => s + d.occupiedBeds, 0);
  const occupancyRatePct = totals.totalBeds
    ? Math.round((totalOccupiedBeds / totals.totalBeds) * 1000) / 10
    : null;
  const avgChargePerOccupiedBed = totalOccupiedBeds
    ? Math.round((totals.revenue / totalOccupiedBeds) * 100) / 100
    : null;
  const grossMarginPct = totals.revenue > 0
    ? Math.round(((totals.revenue - totals.totalCost) / totals.revenue) * 1000) / 10
    : null;

  // ── Trend data (trailing 12 months) ───────────────────────────────
  // Static parts (occupant revenue, monthly-rate lease cost, utilities)
  // are constant per month; the hotel-rate cost varies based on actual
  // logged room-nights for that month. Months with no logs for a given
  // hotel-rate lease contribute 0 — matching the rest of the page.
  const visiblePropertyIds = useMemo(
    () => new Set(visibleProperties.map((p) => p.id)),
    [visibleProperties],
  );
  const visibleLeases = useMemo(
    () => leases.filter((l) => visiblePropertyIds.has(l.propertyId)),
    [leases, visiblePropertyIds],
  );
  const visibleRoomNightLogs = useMemo(() => {
    const visibleLeaseIds = new Set(visibleLeases.map((l) => l.id));
    return roomNightLogs.filter((log) => visibleLeaseIds.has(log.leaseId));
  }, [roomNightLogs, visibleLeases]);

  const staticMonthlyRevenue = totals.revenue;
  const staticMonthlyCostBase = totals.contractCost + totals.utilCost;

  const trendData = useMemo(() => {
    const months = trailingMonths(12, new Date());
    return months.map((ym) => {
      const hotel = hotelRateCostForMonth(visibleLeases, visibleRoomNightLogs, ym);
      const totalCost = staticMonthlyCostBase + hotel;
      return {
        month: ym,
        label: formatMonthLabel(ym),
        revenue: staticMonthlyRevenue,
        totalCost,
        netProfit: Math.round((staticMonthlyRevenue - totalCost) * 100) / 100,
      };
    });
  }, [visibleLeases, visibleRoomNightLogs, staticMonthlyRevenue, staticMonthlyCostBase]);

  // Months that actually have at least one room-night log — used to
  // render a "showing N months" note when history is sparse.
  const monthsWithData = useMemo(() => {
    const set = new Set<string>();
    for (const log of visibleRoomNightLogs) set.add(log.month);
    return set.size;
  }, [visibleRoomNightLogs]);

  // ── Utility breakdown (donut) ─────────────────────────────────────
  const utilityBreakdown = useMemo(() => {
    const byType = new Map<string, number>();
    for (const u of utilities) {
      if (!visiblePropertyIds.has(u.propertyId)) continue;
      byType.set(u.type, (byType.get(u.type) ?? 0) + (u.monthlyCost || 0));
    }
    return Array.from(byType.entries())
      .map(([type, cost]) => ({ type, cost: Math.round(cost * 100) / 100 }))
      .filter((d) => d.cost > 0)
      .sort((a, b) => b.cost - a.cost);
  }, [utilities, visiblePropertyIds]);
  const utilityBreakdownTotal = utilityBreakdown.reduce((s, d) => s + d.cost, 0);

  // ── Profitability ranking ─────────────────────────────────────────
  // Properties with revenue > 0 are ranked by net margin desc; those
  // with zero revenue are listed separately at the bottom so an empty
  // property never sits on top of an actually-loss-making one.
  const ranked = useMemo(() => {
    const withRevenue: Array<typeof financialData[number] & { margin: number }> = [];
    const noRevenue: typeof financialData = [];
    for (const d of financialData) {
      if (d.revenue > 0) {
        withRevenue.push({ ...d, margin: (d.revenue - d.totalCost) / d.revenue });
      } else {
        noRevenue.push(d);
      }
    }
    withRevenue.sort((a, b) => b.margin - a.margin);
    return { withRevenue, noRevenue };
  }, [financialData]);
  // Max absolute margin used to scale the visual bar so the largest
  // (positive or negative) margin fills the row width.
  const rankingMaxAbsMargin = ranked.withRevenue.reduce(
    (m, d) => Math.max(m, Math.abs(d.margin)),
    0.0001,
  );

  // ── Rent roll ─────────────────────────────────────────────────────
  const propertyById = useMemo(() => {
    const map = new Map<string, (typeof properties)[number]>();
    for (const p of properties) map.set(p.id, p);
    return map;
  }, [properties]);
  const bedsCountByProperty = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of beds) map.set(b.propertyId, (map.get(b.propertyId) ?? 0) + 1);
    return map;
  }, [beds]);

  type RentRollRow = {
    leaseId: string;
    propertyId: string;
    propertyName: string;
    customerName: string;
    rateType: "monthly" | "room-night";
    monthlyRent: number;
    monthlyRoomNightMin: number;
    rentOrMin: number;
    bedsCovered: number;
    securityDeposit: number;
  };

  const rentRollRows: RentRollRow[] = useMemo(() => {
    return visibleLeases
      .filter((l) => l.status === "Active")
      .map((l) => {
        const property = propertyById.get(l.propertyId);
        const propertyName = property?.name ?? "—";
        const customerId = l.customerId || property?.customerId;
        const customerName = customerId ? customerById.get(customerId) ?? "—" : "—";
        const rateType: "monthly" | "room-night" = (l.rateType ?? "monthly") as "monthly" | "room-night";
        const monthlyRent = l.monthlyRent || 0;
        const monthlyRoomNightMin = l.monthlyRoomNightMin || 0;
        const rentOrMin = rateType === "room-night" ? monthlyRoomNightMin : monthlyRent;
        const bedsCovered = bedsCountByProperty.get(l.propertyId) ?? 0;
        return {
          leaseId: l.id,
          propertyId: l.propertyId,
          propertyName,
          customerName,
          rateType,
          monthlyRent,
          monthlyRoomNightMin,
          rentOrMin,
          bedsCovered,
          securityDeposit: l.securityDeposit || 0,
        };
      });
  }, [visibleLeases, propertyById, customerById, bedsCountByProperty]);

  const [rentRollSort, setRentRollSort] = useState<{ key: RentRollSortKey; dir: SortDirection }>({
    key: "property",
    dir: "asc",
  });
  const sortedRentRoll = useMemo(() => {
    const rows = [...rentRollRows];
    const { key, dir } = rentRollSort;
    const mult = dir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      let av: string | number;
      let bv: string | number;
      switch (key) {
        case "property": av = a.propertyName; bv = b.propertyName; break;
        case "customer": av = a.customerName; bv = b.customerName; break;
        case "rateType": av = a.rateType; bv = b.rateType; break;
        case "rentOrMin": av = a.rentOrMin; bv = b.rentOrMin; break;
        case "bedsCovered": av = a.bedsCovered; bv = b.bedsCovered; break;
        case "securityDeposit": av = a.securityDeposit; bv = b.securityDeposit; break;
      }
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * mult;
      return String(av).localeCompare(String(bv)) * mult;
    });
    return rows;
  }, [rentRollRows, rentRollSort]);
  const toggleRentRollSort = (key: RentRollSortKey) => {
    setRentRollSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" },
    );
  };

  const activeCustomerName =
    customerFilter === ALL_CUSTOMERS ? null : customerById.get(customerFilter) ?? null;

  // Hide the Customer column when a customer filter is active, since every
  // row already belongs to that customer.
  const showCustomerColumn = customerFilter === ALL_CUSTOMERS;
  const tableColCount = showCustomerColumn ? 11 : 10;

  const { toast } = useToast();

  const handleDownloadCsv = () => {
    const tt = (k: string) => t(`pages.finance.table.${k}`);
    const columns = [
      { header: tt("property"), value: (d: typeof financialData[number]) => d.name },
      ...(showCustomerColumn
        ? [{ header: tt("customer"), value: (d: typeof financialData[number]) => d.customerName ?? "" }]
        : []),
      { header: tt("occupiedBeds"), value: (d: typeof financialData[number]) => d.occupiedBeds },
      { header: tt("totalBeds"), value: (d: typeof financialData[number]) => d.totalBeds },
      { header: tt("revenue"), value: (d: typeof financialData[number]) => d.revenue },
      { header: tt("leaseCost"), value: (d: typeof financialData[number]) => d.leaseCost },
      { header: tt("contractRent"), value: (d: typeof financialData[number]) => d.contractCost },
      { header: tt("hotelRateEst"), value: (d: typeof financialData[number]) => d.hotelRateCost },
      { header: tt("utilityCost"), value: (d: typeof financialData[number]) => d.utilCost },
      { header: tt("otherCost"), value: (d: typeof financialData[number]) => d.otherCost },
      { header: tt("totalCost"), value: (d: typeof financialData[number]) => d.totalCost },
      { header: tt("netProfit"), value: (d: typeof financialData[number]) => d.profit },
      { header: tt("rentPerBed"), value: (d: typeof financialData[number]) => d.rentPerBed ?? "" },
      { header: tt("electricPerBed"), value: (d: typeof financialData[number]) => d.electricPerBed ?? "" },
      { header: tt("rentPlusElectricPerBed"), value: (d: typeof financialData[number]) => d.rentPlusElectricPerBed ?? "" },
    ];
    const totalLabel = activeCustomerName
      ? t("pages.finance.table.customerTotal", { customer: activeCustomerName })
      : t("pages.finance.table.portfolioTotal");
    const totalsRow: typeof financialData[number] = {
      id: "__totals__",
      name: totalLabel,
      shortName: totalLabel,
      customerId: "",
      customerName: "",
      revenue: totals.revenue,
      leaseCost: totals.leaseCost,
      contractCost: totals.contractCost,
      hotelRateCost: totals.hotelRateCost,
      hasHotelRateLease: totals.hasAnyHotelRateLease,
      utilCost: totals.utilCost,
      otherCost: totals.otherCost,
      electricCost: totals.electricCost,
      totalCost: totals.totalCost,
      profit: totals.profit,
      occupiedBeds: 0,
      totalBeds: 0,
      rentPerBed: totalsRentPerBed,
      electricPerBed: totalsElectricPerBed,
      rentPlusElectricPerBed: totalsRentPlusElectricPerBed,
    };
    // Blank out the non-numeric columns (Customer, Occupied/Total Beds) so the
    // totals row only carries summed values alongside its label.
    const numericHeaders = new Set([
      tt("revenue"), tt("leaseCost"), tt("contractRent"), tt("hotelRateEst"), tt("utilityCost"), tt("otherCost"), tt("totalCost"), tt("netProfit"),
      tt("rentPerBed"), tt("electricPerBed"), tt("rentPlusElectricPerBed"),
    ]);
    const propertyHeader = tt("property");
    const totalsColumns = columns.map((col) =>
      col.header === propertyHeader || numericHeaders.has(col.header)
        ? col
        : { ...col, value: () => "" },
    );
    const bodyCsv = toCsv(financialData, columns);
    const [totalsCsv = ""] = toCsvRows([totalsRow], totalsColumns);
    const csv = `${bodyCsv}\r\n${totalsCsv}`;
    downloadCsv(timestampedCsvName("housingops-finance"), csv);
    toast({
      title: t("pages.finance.exportedTitle"),
      description: t("pages.finance.exportedDescription", { count: financialData.length }),
    });
  };

  return (
    <MainLayout>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="p-8 max-w-7xl mx-auto space-y-8"
      >
        <PageHeader
          title={t("pages.finance.title")}
          description={t("pages.finance.description")}
          meta={
            activeCustomerName ? (
              <p
                className="text-xs text-muted-foreground flex items-center gap-1"
                data-testid="text-finance-active-customer"
              >
                <Briefcase className="h-3 w-3" />
                {t("pages.finance.showingOnly")} <span className="font-semibold">{activeCustomerName}</span>
              </p>
            ) : null
          }
          actions={<>
            <Select value={customerFilter} onValueChange={updateCustomerFilter}>
              <SelectTrigger className="w-full sm:w-56" data-testid="select-finance-customer-filter">
                <SelectValue placeholder={t("pages.finance.customerPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_CUSTOMERS}>{t("pages.finance.allCustomers")}</SelectItem>
                {customers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              onClick={handleDownloadCsv}
              disabled={financialData.length === 0}
              data-testid="button-download-finance-csv"
            >
              <Download className="mr-2 h-4 w-4" />
              {t("pages.finance.downloadCsv")}
            </Button>
            <div className="flex gap-6 text-right">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">{t("pages.finance.totalRevenue")}</p>
                <p className="text-xl font-bold text-green-600">{formatUsd(totals.revenue)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">{t("pages.finance.totalCosts")}</p>
                <p className="text-xl font-bold text-destructive">{formatUsd(totals.totalCost)}</p>
                {totals.hotelRateCost > 0 && (
                  <p
                    className="text-xs font-normal text-muted-foreground"
                    data-testid="text-finance-header-hotel-rate-share"
                  >
                    {t("pages.finance.table.hotelRateLabel")} {formatUsd(totals.hotelRateCost)} {t("pages.finance.table.hotelRateSuffix")}
                  </p>
                )}
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">{t("pages.finance.netProfit")}</p>
                <p className={`text-xl font-bold ${totals.profit >= 0 ? "text-green-600" : "text-destructive"}`}>
                  {totals.profit >= 0 ? "+" : ""}{formatUsd(totals.profit)}
                </p>
              </div>
            </div>
          </>}
        />

        {activeCustomerName && (
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="gap-1.5 px-2 py-1" data-testid="badge-customer-filter">
              <Briefcase className="h-3 w-3" />
              {t("pages.finance.filteredByCustomer")} <span className="font-semibold">{activeCustomerName}</span>
              <button
                type="button"
                onClick={() => updateCustomerFilter(ALL_CUSTOMERS)}
                className="ml-1 rounded-sm p-0.5 hover:bg-background/40"
                aria-label={t("pages.finance.clearCustomerFilter")}
                data-testid="button-clear-customer-filter"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
            <span className="text-xs text-muted-foreground">
              {t("pages.finance.propertiesCount", { shown: financialData.length, total: properties.length, count: properties.length })}
            </span>
          </div>
        )}

        {/* Extended portfolio KPI cards. Positioned right under the
            page header so operators get the headline metrics at a
            glance before scrolling into per-property detail. */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4" data-testid="finance-kpi-cards">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">{t("pages.finance.kpi.occupancyRate")}</p>
              <p className="text-2xl font-bold mt-1" data-testid="kpi-occupancy-rate">
                {occupancyRatePct === null ? "—" : `${occupancyRatePct}%`}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {totalOccupiedBeds}/{totals.totalBeds}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">{t("pages.finance.kpi.avgChargePerBed")}</p>
              <p className="text-2xl font-bold mt-1" data-testid="kpi-avg-charge-per-bed">
                {avgChargePerOccupiedBed === null ? "—" : formatUsd(avgChargePerOccupiedBed)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">{t("pages.finance.kpi.grossMargin")}</p>
              <p
                className={`text-2xl font-bold mt-1 ${grossMarginPct === null ? "" : grossMarginPct >= 0 ? "text-green-600" : "text-destructive"}`}
                data-testid="kpi-gross-margin"
              >
                {grossMarginPct === null ? "—" : `${grossMarginPct}%`}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">{t("pages.finance.kpi.totalBeds")}</p>
              <p className="text-2xl font-bold mt-1" data-testid="kpi-total-beds">{totals.totalBeds}</p>
            </CardContent>
          </Card>
        </div>

        {/* Trailing-12-month trend. Static parts (occupant revenue,
            monthly leases, utilities) are flat lines; the cost line
            varies with logged hotel-rate room-nights. */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("pages.finance.trend.title")}</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            {monthsWithData === 0 && totals.totalBeds === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground" data-testid="empty-finance-trend">
                {t("pages.finance.trend.empty")}
              </div>
            ) : (
              <>
                {monthsWithData > 0 && monthsWithData < 12 && (
                  <p className="text-xs text-muted-foreground mb-2" data-testid="text-finance-trend-sparse">
                    {t("pages.finance.trend.sparseNote", { count: monthsWithData })}
                  </p>
                )}
                <ResponsiveContainer width="100%" height={monthsWithData > 0 && monthsWithData < 12 ? "90%" : "100%"}>
                  <LineChart data={trendData} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="label" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip
                      formatter={(value: number, name: string) => [`${formatUsd(value)}`, name]}
                      contentStyle={{ borderRadius: "8px", border: "1px solid hsl(var(--border))", fontSize: "12px" }}
                    />
                    <Legend wrapperStyle={{ fontSize: "12px" }} />
                    <Line type="monotone" dataKey="revenue" name={t("pages.finance.trend.revenue")} stroke="hsl(142 76% 36%)" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="totalCost" name={t("pages.finance.trend.totalCost")} stroke="hsl(var(--destructive))" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="netProfit" name={t("pages.finance.trend.netProfit")} stroke="hsl(217 91% 60%)" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </>
            )}
          </CardContent>
        </Card>

        {/* Two-column row: utility breakdown donut + property
            profitability ranking. Stacks on small screens. */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("pages.finance.utilityBreakdown.title")}</CardTitle>
            </CardHeader>
            <CardContent className="h-80">
              {utilityBreakdown.length === 0 ? (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground" data-testid="empty-finance-utility-breakdown">
                  {t("pages.finance.utilityBreakdown.empty")}
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={utilityBreakdown}
                      dataKey="cost"
                      nameKey="type"
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={90}
                      paddingAngle={2}
                    >
                      {utilityBreakdown.map((entry, idx) => (
                        <Cell key={entry.type} fill={UTILITY_COLORS[idx % UTILITY_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value: number, name: string) => {
                        const pct = utilityBreakdownTotal > 0
                          ? ` (${Math.round((value / utilityBreakdownTotal) * 1000) / 10}%)`
                          : "";
                        return [`${formatUsd(value)}${pct}`, name];
                      }}
                      contentStyle={{ borderRadius: "8px", border: "1px solid hsl(var(--border))", fontSize: "12px" }}
                    />
                    <Legend
                      verticalAlign="bottom"
                      wrapperStyle={{ fontSize: "12px" }}
                      formatter={(value: string, entry) => {
                        const datum = (entry?.payload ?? {}) as { cost?: number };
                        const cost = datum.cost ?? 0;
                        return `${value} — ${formatUsd(cost)}`;
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("pages.finance.ranking.title")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 max-h-80 overflow-y-auto">
              {ranked.withRevenue.length === 0 && ranked.noRevenue.length === 0 ? (
                <div className="flex h-32 items-center justify-center text-sm text-muted-foreground" data-testid="empty-finance-ranking">
                  {t("pages.finance.ranking.empty")}
                </div>
              ) : (
                <>
                  {ranked.withRevenue.map((d) => {
                    const pct = Math.round(d.margin * 1000) / 10;
                    const widthPct = Math.min(100, (Math.abs(d.margin) / rankingMaxAbsMargin) * 100);
                    const positive = d.margin >= 0;
                    return (
                      <div key={d.id} className="space-y-1" data-testid={`row-finance-ranking-${d.id}`}>
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-medium truncate pr-2">{d.shortName}</span>
                          <Badge
                            variant={positive ? "default" : "destructive"}
                            className={positive ? "bg-emerald-500 hover:bg-emerald-600 text-white" : ""}
                          >
                            {pct >= 0 ? "+" : ""}{pct}%
                          </Badge>
                        </div>
                        <div className="h-2 rounded-full bg-muted overflow-hidden">
                          <div
                            className={positive ? "h-full bg-emerald-500" : "h-full bg-destructive"}
                            style={{ width: `${widthPct}%` }}
                          />
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {formatUsd(d.revenue)} · {t("pages.finance.ranking.marginLabel")} {formatUsd(d.profit)}
                        </p>
                      </div>
                    );
                  })}
                  {ranked.noRevenue.length > 0 && (
                    <div className="pt-2 mt-2 border-t border-border space-y-1">
                      <p className="text-xs text-muted-foreground uppercase tracking-wider">
                        {t("pages.finance.ranking.noRevenue")}
                      </p>
                      {ranked.noRevenue.map((d) => (
                        <div
                          key={d.id}
                          className="flex items-center justify-between text-sm text-muted-foreground"
                          data-testid={`row-finance-ranking-no-revenue-${d.id}`}
                        >
                          <span className="truncate pr-2">{d.shortName}</span>
                          <span className="text-xs">{formatUsd(d.totalCost)} {t("pages.finance.ranking.costSuffix")}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Rent roll. Lists every active lease in scope with
            sortable columns. Beds Covered counts beds at the lease's
            property — operators rely on this to spot leases where bed
            count drifted from the lease term. */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("pages.finance.rentRoll.title")}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {sortedRentRoll.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground" data-testid="empty-finance-rent-roll">
                {t("pages.finance.rentRoll.empty")}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    {([
                      ["property", "pages.finance.rentRoll.property", "left"],
                      ["customer", "pages.finance.rentRoll.customer", "left"],
                      ["rateType", "pages.finance.rentRoll.rateType", "left"],
                      ["rentOrMin", "pages.finance.rentRoll.rentOrMin", "right"],
                      ["bedsCovered", "pages.finance.rentRoll.bedsCovered", "right"],
                      ["securityDeposit", "pages.finance.rentRoll.securityDeposit", "right"],
                    ] as Array<[RentRollSortKey, string, "left" | "right"]>).map(([key, labelKey, align]) => {
                      const isActive = rentRollSort.key === key;
                      const Icon = isActive ? (rentRollSort.dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
                      return (
                        <TableHead key={key} className={align === "right" ? "text-right" : ""}>
                          <button
                            type="button"
                            onClick={() => toggleRentRollSort(key)}
                            className={`inline-flex items-center gap-1 hover:text-foreground transition-colors ${align === "right" ? "ml-auto" : ""}`}
                            data-testid={`button-rent-roll-sort-${key}`}
                          >
                            {t(labelKey)}
                            <Icon className="h-3 w-3" />
                          </button>
                        </TableHead>
                      );
                    })}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedRentRoll.map((row) => (
                    <tr
                      key={row.leaseId}
                      className="border-b transition-colors hover:bg-muted/30"
                      data-testid={`row-finance-rent-roll-${row.leaseId}`}
                    >
                      <td className="p-4"><PropertyNameCell name={row.propertyName} /></td>
                      <td className="p-4 text-sm text-muted-foreground">{row.customerName}</td>
                      <td className="p-4 text-sm">
                        <Badge variant={row.rateType === "room-night" ? "secondary" : "outline"}>
                          {row.rateType === "room-night"
                            ? t("pages.finance.rentRoll.hotelRate")
                            : t("pages.finance.rentRoll.monthly")}
                        </Badge>
                      </td>
                      <td className="p-4 text-right text-sm tabular-nums">
                        {formatUsd(row.rentOrMin)}
                        {row.rateType === "room-night" && (
                          <span className="text-xs text-muted-foreground ml-1">
                            {t("pages.finance.rentRoll.guaranteedMinSuffix")}
                          </span>
                        )}
                      </td>
                      <td className="p-4 text-right text-sm tabular-nums">{row.bedsCovered}</td>
                      <td className="p-4 text-right text-sm tabular-nums">{formatUsd(row.securityDeposit)}</td>
                    </tr>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("pages.finance.chartTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={financialData} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="id"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => {
                    const row = financialData.find((d) => d.id === value);
                    return row?.shortName ?? String(value);
                  }}
                />
                <YAxis fontSize={12} tickLine={false} axisLine={false} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip
                  formatter={(value: number, name: string) => [`${formatUsd(value)}`, name]}
                  labelFormatter={(label) => {
                    const row = financialData.find((d) => d.id === label);
                    return row?.name ?? String(label);
                  }}
                  contentStyle={{ borderRadius: "8px", border: "1px solid hsl(var(--border))", fontSize: "12px" }}
                  cursor={{ fill: "hsl(var(--muted))", opacity: 0.5 }}
                />
                <Legend wrapperStyle={{ fontSize: "12px" }} />
                <Bar dataKey="revenue" name={t("pages.finance.table.revenue")} fill="hsl(142 76% 36%)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="contractCost" name={t("pages.finance.table.contractRent")} fill="hsl(var(--destructive))" stackId="cost" />
                <Bar dataKey="hotelRateCost" name={t("pages.finance.table.hotelRateEst")} fill="hsl(0 72% 70%)" stackId="cost" />
                <Bar dataKey="utilCost" name={t("pages.finance.table.utilityCost")} fill="hsl(25 95% 53%)" radius={[4, 4, 0, 0]} stackId="cost" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("pages.finance.table.property")}</TableHead>
                  {showCustomerColumn && <TableHead>{t("pages.finance.table.customer")}</TableHead>}
                  <TableHead className="text-center">{t("pages.finance.table.occupancy")}</TableHead>
                  <TableHead className="text-right">{t("pages.finance.table.revenue")}</TableHead>
                  <TableHead className="text-right">{t("pages.finance.table.leaseCost")}</TableHead>
                  <TableHead className="text-right">{t("pages.finance.table.utilityCost")}</TableHead>
                  <TableHead className="text-right">{t("pages.finance.table.otherCost")}</TableHead>
                  <TableHead className="text-right">{t("pages.finance.table.totalCost")}</TableHead>
                  <TableHead className="text-right">{t("pages.finance.table.netProfit")}</TableHead>
                  <TableHead className="text-right">{t("pages.finance.table.rentPerBed")}</TableHead>
                  <TableHead className="text-right">{t("pages.finance.table.electricPerBed")}</TableHead>
                  <TableHead className="text-right">{t("pages.finance.table.rentPlusElectricPerBed")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {financialData.length === 0 ? (
                  <tr>
                    <td colSpan={tableColCount} className="p-0">
                      <EmptyState
                        icon={properties.length === 0 ? Building2 : DollarSign}
                        title={
                          properties.length === 0
                            ? t("pages.finance.empty.noPropertiesTitle")
                            : t("pages.finance.empty.noMatchTitle")
                        }
                        description={
                          properties.length === 0
                            ? t("pages.finance.empty.noPropertiesDescription")
                            : t("pages.finance.empty.noMatchDescription")
                        }
                        action={
                          properties.length === 0 ? (
                            <Button asChild data-testid="button-empty-finance-cta">
                              <Link href="/properties">{t("pages.finance.empty.addProperty")}</Link>
                            </Button>
                          ) : undefined
                        }
                        testId="empty-finance-table"
                      />
                    </td>
                  </tr>
                ) : (
                  <>
                    {financialData.map((d, i) => (
                      <motion.tr
                        key={d.id}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.04 }}
                        className={`border-b transition-colors ${d.profit < 0 ? "bg-destructive/5" : ""}`}
                        data-testid={`row-finance-${d.id}`}
                      >
                        <td className="p-4"><PropertyNameCell name={d.name} /></td>
                        {showCustomerColumn && (
                          <td className="p-4 text-sm text-muted-foreground" data-testid={`text-finance-customer-${d.id}`}>
                            {d.customerId && d.customerName ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  updateCustomerFilter(d.customerId);
                                }}
                                className="rounded-sm hover:underline hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                data-testid={`button-filter-customer-${d.id}`}
                                aria-label={t("pages.finance.filterByCustomerAria", { customer: d.customerName })}
                              >
                                {d.customerName}
                              </button>
                            ) : (
                              "—"
                            )}
                          </td>
                        )}
                        <td className="p-4 text-center text-sm text-muted-foreground">
                          {d.occupiedBeds}/{d.totalBeds}
                        </td>
                        <td className="p-4 text-right font-medium text-green-600">{formatUsd(d.revenue)}</td>
                        <td className="p-4 text-right text-sm text-muted-foreground">
                          <span>{formatUsd(d.leaseCost)}</span>
                          {d.hasHotelRateLease && (
                            <>
                              <span className="block text-xs text-muted-foreground/70" data-testid={`text-finance-contract-rent-${d.id}`}>
                                {t("pages.finance.table.contractLabel")} {formatUsd(d.contractCost)}
                              </span>
                              <span className="block text-xs text-muted-foreground/70" data-testid={`text-finance-hotel-rate-${d.id}`}>
                                {t("pages.finance.table.hotelRateLabel")} {formatUsd(d.hotelRateCost)} {t("pages.finance.table.hotelRateSuffix")}
                              </span>
                            </>
                          )}
                        </td>
                        <td className="p-4 text-right text-sm text-muted-foreground">{formatUsd(d.utilCost)}</td>
                        <td
                          className="p-4 text-right text-sm text-muted-foreground"
                          data-testid={`text-finance-other-cost-${d.id}`}
                        >
                          {formatUsd(d.otherCost)}
                        </td>
                        <td className="p-4 text-right text-sm font-medium">{formatUsd(d.totalCost)}</td>
                        <td className="p-4 text-right">
                          <Badge
                            variant={d.profit >= 0 ? "default" : "destructive"}
                            className={d.profit >= 0 ? "bg-emerald-500 hover:bg-emerald-600 text-white" : ""}
                          >
                            {d.profit >= 0 ? "+" : "-"}{formatUsd(Math.abs(d.profit))}
                          </Badge>
                        </td>
                        <td
                          className="p-4 text-right text-sm tabular-nums"
                          data-testid={`text-finance-rent-per-bed-${d.id}`}
                        >
                          {fmtPerBed(d.rentPerBed)}
                        </td>
                        <td
                          className="p-4 text-right text-sm tabular-nums"
                          data-testid={`text-finance-electric-per-bed-${d.id}`}
                        >
                          {fmtPerBed(d.electricPerBed)}
                        </td>
                        <td
                          className="p-4 text-right text-sm font-medium tabular-nums"
                          data-testid={`text-finance-rent-plus-electric-per-bed-${d.id}`}
                        >
                          {fmtPerBed(d.rentPlusElectricPerBed)}
                        </td>
                      </motion.tr>
                    ))}
                    <tr className="bg-muted/50 border-t-2 border-border">
                      <td className="p-4 font-bold">{activeCustomerName ? t("pages.finance.table.customerTotal", { customer: activeCustomerName }) : t("pages.finance.table.portfolioTotal")}</td>
                      {showCustomerColumn && <td />}
                      <td />
                      <td className="p-4 text-right font-bold text-green-600">{formatUsd(totals.revenue)}</td>
                      <td className="p-4 text-right font-bold">
                        <span>{formatUsd(totals.leaseCost)}</span>
                        {totals.hasAnyHotelRateLease && (
                          <>
                            <span className="block text-xs font-normal text-muted-foreground" data-testid="text-finance-contract-rent-total">
                              {t("pages.finance.table.contractLabel")} {formatUsd(totals.contractCost)}
                            </span>
                            <span className="block text-xs font-normal text-muted-foreground" data-testid="text-finance-hotel-rate-total">
                              {t("pages.finance.table.hotelRateLabel")} {formatUsd(totals.hotelRateCost)} {t("pages.finance.table.hotelRateSuffix")}
                            </span>
                          </>
                        )}
                      </td>
                      <td className="p-4 text-right font-bold">{formatUsd(totals.utilCost)}</td>
                      <td
                        className="p-4 text-right font-bold"
                        data-testid="text-finance-other-cost-total"
                      >
                        {formatUsd(totals.otherCost)}
                      </td>
                      <td className="p-4 text-right font-bold">{formatUsd(totals.totalCost)}</td>
                      <td className="p-4 text-right">
                        <Badge
                          variant={totals.profit >= 0 ? "default" : "destructive"}
                          className={totals.profit >= 0 ? "bg-emerald-500 hover:bg-emerald-600 text-white" : ""}
                        >
                          {totals.profit >= 0 ? "+" : "-"}{formatUsd(Math.abs(totals.profit))}
                        </Badge>
                      </td>
                      <td className="p-4 text-right font-bold tabular-nums">{fmtPerBed(totalsRentPerBed)}</td>
                      <td className="p-4 text-right font-bold tabular-nums">{fmtPerBed(totalsElectricPerBed)}</td>
                      <td className="p-4 text-right font-bold tabular-nums">{fmtPerBed(totalsRentPlusElectricPerBed)}</td>
                    </tr>
                  </>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </motion.div>
    </MainLayout>
  );
}
