// Finance Weekly / Monthly / By-Customer tab content (Task #597).
//
// All three tabs are thin presentation layers over server-side rollup
// endpoints (`/api/finance/weekly|monthly|by-customer`). Aggregation
// lives on the server so the three views can never disagree about
// what "rent paid" or "recovered" means and so the wire payload stays
// small (one row per pay-week / month / customer).
//
// Each tab supports CSV export of the displayed rows (via the shared
// `toCsv` / `downloadCsv` helpers in `@/lib/csv` so we get the same
// BOM / quoting / formula-injection guarantees as every other CSV
// export in the app), surfaces a small recovered-vs-rent line chart
// on top, and offers click-to-sort headers backed by a single
// `sortRows()` helper. The optional `customerId` / `propertyId`
// props are passed through to the endpoints so the Finance page
// filter chips control every tab consistently. The By-Customer table
// is also click-through: clicking a row promotes that customer into
// the page-level `customerFilter` so the operator can drill into a
// single tenant without reaching for the chip.

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { MoneyTile, StatusDot, DeductionBadge, EmptyState, type MoneyStat } from "@/components/kit";
import {
  useListFinanceWeekly,
  useListFinanceMonthly,
  useListFinanceByCustomer,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ArrowDown, ArrowUp, ArrowUpDown, Download } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from "recharts";
import { formatUsd, sumActiveRent } from "@/data/mockData";
import { useData } from "@/context/data-store";
import { ALL_CUSTOMERS } from "@/context/customer-scope";
import {
  formatMonthBucketLabel,
  formatPayWeekRange,
} from "@/lib/finance-pay-weeks";
import { downloadCsv, timestampedCsvName, toCsv } from "@/lib/csv";

type SharedProps = {
  customerFilter: string;
  propertyFilter?: string;
  /**
   * Optional click-through callback used by the By-Customer tab to
   * promote a row into the page-level customer chip. Wired by the
   * Finance page; left undefined elsewhere (the row stays inert).
   */
  onSelectCustomer?: (customerId: string) => void;
};

type WeeklyRow = {
  payWeekEndDate: string;
  recovered: number;
  // Sum of bed-level "current weekly rate" rows effective for
  // this pay-week (Task #598). Optional on the wire so older
  // clients don't break if the field is missing — render falls
  // back to 0 in that case.
  expectedRecovered?: number;
  rentPaid: number;
  utilities: number;
  net: number;
};
type MonthlyRow = {
  month: string;
  recovered: number;
  rentPaid: number;
  utilities: number;
  otherCosts: number;
  net: number;
};
type ByCustomerResult = {
  mostRecentWeekEndDate: string | null;
  currentMonth: string;
  rows: ByCustomerRow[];
};
type ByCustomerRow = {
  customerId: string;
  customerName: string;
  activeOccupants: number;
  monthlyRentKfiPays: number;
  mostRecentWeekRecovered: number;
  monthToDateRecovered: number;
  net: number;
};

type SortDir = "asc" | "desc";
type SortState<K extends string> = { key: K; dir: SortDir };

function sortRows<Row, K extends string>(
  rows: readonly Row[],
  state: SortState<K>,
  pickers: Record<K, (r: Row) => string | number>,
): Row[] {
  const pick = pickers[state.key];
  const factor = state.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = pick(a);
    const vb = pick(b);
    if (typeof va === "number" && typeof vb === "number") {
      return (va - vb) * factor;
    }
    return String(va).localeCompare(String(vb)) * factor;
  });
}

function deltaCellClass(n: number): string {
  return n >= 0 ? "text-green-600" : "text-destructive";
}

function scopeParams(p: SharedProps): {
  customerId?: string;
  propertyId?: string;
} {
  const out: { customerId?: string; propertyId?: string } = {};
  if (p.customerFilter && p.customerFilter !== ALL_CUSTOMERS) {
    out.customerId = p.customerFilter;
  }
  if (p.propertyFilter && p.propertyFilter !== ALL_CUSTOMERS) {
    out.propertyId = p.propertyFilter;
  }
  return out;
}

function SortHeader<K extends string>({
  label,
  sortKey,
  state,
  setState,
  align = "left",
  testId,
}: {
  label: string;
  sortKey: K;
  state: SortState<K>;
  setState: (s: SortState<K>) => void;
  align?: "left" | "right";
  testId?: string;
}) {
  const active = state.key === sortKey;
  const Icon = active ? (state.dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={() =>
        setState({
          key: sortKey,
          dir: active && state.dir === "asc" ? "desc" : "asc",
        })
      }
      className={`inline-flex items-center gap-1 hover:text-foreground transition-colors ${
        align === "right" ? "ml-auto flex-row-reverse" : ""
      } ${active ? "text-foreground" : ""}`}
    >
      <Icon className="h-3 w-3 opacity-60" />
      <span>{label}</span>
    </button>
  );
}

// ── Weekly tab ─────────────────────────────────────────────────────
type WeeklyKey = "payWeekEndDate" | "recovered" | "rentPaid" | "utilities" | "net";

const WEEKLY_WINDOW_OPTIONS = [4, 13, 26, 52] as const;

export function FinancePayrollWeeklyTab(props: SharedProps) {
  const { t } = useTranslation();
  // Window selector — defaults to the 13-week trailing trend the
  // dashboard mini-chart uses, but operators can widen the table
  // (Task #597 v5 validator: "default, filterable" window).
  const [weeks, setWeeks] = useState<number>(13);
  const { data } = useListFinanceWeekly({ weeks, ...scopeParams(props) });
  const rows: WeeklyRow[] = useMemo(
    () => (data as WeeklyRow[] | undefined) ?? [],
    [data],
  );
  const [sort, setSort] = useState<SortState<WeeklyKey>>({
    key: "payWeekEndDate",
    dir: "desc",
  });
  const display = useMemo(
    () =>
      sortRows(rows, sort, {
        payWeekEndDate: (r) => r.payWeekEndDate,
        recovered: (r) => r.recovered,
        rentPaid: (r) => r.rentPaid,
        utilities: (r) => r.utilities,
        net: (r) => r.net,
      }),
    [rows, sort],
  );
  // Chart always reads chronological order so the line moves left→right.
  const chartData = useMemo(
    () =>
      [...rows]
        .sort((a, b) => a.payWeekEndDate.localeCompare(b.payWeekEndDate))
        .map((r) => ({
          label: formatPayWeekRange(r.payWeekEndDate),
          recovered: r.recovered,
          expectedRecovered: r.expectedRecovered ?? 0,
          rentPaid: r.rentPaid,
        })),
    [rows],
  );

  const totals = display.reduce(
    (acc, r) => ({
      recovered: acc.recovered + r.recovered,
      rentPaid: acc.rentPaid + r.rentPaid,
      utilities: acc.utilities + r.utilities,
      net: acc.net + r.net,
    }),
    { recovered: 0, rentPaid: 0, utilities: 0, net: 0 },
  );

  const handleExport = () => {
    const csv = toCsv(display, [
      { header: "pay_week_end_date", value: (r) => r.payWeekEndDate },
      { header: "recovered", value: (r) => r.recovered },
      { header: "rent_paid", value: (r) => r.rentPaid },
      { header: "utilities", value: (r) => r.utilities },
      { header: "net", value: (r) => r.net },
    ]);
    downloadCsv(timestampedCsvName("finance-weekly"), csv);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base">
            {t("pages.finance.payroll.weeklyTitle")}
          </CardTitle>
          <div className="flex items-center gap-2">
            <select
              value={weeks}
              onChange={(e) => setWeeks(Number(e.target.value))}
              data-testid="select-finance-weekly-window"
              className="h-8 rounded-md border border-input bg-background px-2 text-sm"
            >
              {WEEKLY_WINDOW_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {t("pages.finance.payroll.lastNWeeks", { count: n })}
                </option>
              ))}
            </select>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={display.length === 0}
            data-testid="button-finance-weekly-export"
          >
            <Download className="h-3 w-3 mr-1" />
            {t("pages.finance.payroll.exportCsv")}
          </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {chartData.length > 0 && (
          <div className="h-44 w-full" data-testid="chart-finance-weekly">
            <ResponsiveContainer>
              <LineChart
                data={chartData}
                margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} />
                <YAxis
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v: number) => `$${Math.round(v)}`}
                  width={56}
                />
                <Tooltip formatter={(v: number) => formatUsd(Number(v))} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line
                  type="monotone"
                  dataKey="recovered"
                  name={t("pages.finance.payroll.recovered")}
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="expectedRecovered"
                  name={t("pages.finance.payroll.expectedRecovered")}
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="rentPaid"
                  name={t("pages.finance.payroll.rentPaid")}
                  stroke="hsl(var(--destructive))"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        {display.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("pages.finance.payroll.noSnapshotsDescription")}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <SortHeader
                    label={t("pages.finance.payroll.payWeek")}
                    sortKey="payWeekEndDate"
                    state={sort}
                    setState={setSort}
                    testId="sort-finance-weekly-payweek"
                  />
                </TableHead>
                <TableHead className="text-right">
                  <SortHeader
                    label={t("pages.finance.payroll.recovered")}
                    sortKey="recovered"
                    state={sort}
                    setState={setSort}
                    align="right"
                  />
                </TableHead>
                <TableHead className="text-right">
                  <SortHeader
                    label={t("pages.finance.payroll.rentPaid")}
                    sortKey="rentPaid"
                    state={sort}
                    setState={setSort}
                    align="right"
                  />
                </TableHead>
                <TableHead className="text-right">
                  <SortHeader
                    label={t("pages.finance.payroll.utilities")}
                    sortKey="utilities"
                    state={sort}
                    setState={setSort}
                    align="right"
                  />
                </TableHead>
                <TableHead className="text-right">
                  <SortHeader
                    label={t("pages.finance.payroll.net")}
                    sortKey="net"
                    state={sort}
                    setState={setSort}
                    align="right"
                  />
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {display.map((r) => (
                <TableRow
                  key={r.payWeekEndDate}
                  data-testid={`row-finance-weekly-${r.payWeekEndDate}`}
                >
                  <TableCell>{formatPayWeekRange(r.payWeekEndDate)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatUsd(r.recovered)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {formatUsd(r.rentPaid)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {formatUsd(r.utilities)}
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${deltaCellClass(r.net)}`}
                  >
                    {formatUsd(r.net)}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="font-semibold border-t-2">
                <TableCell>{t("pages.finance.payroll.totals")}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatUsd(totals.recovered)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatUsd(totals.rentPaid)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatUsd(totals.utilities)}
                </TableCell>
                <TableCell
                  className={`text-right tabular-nums ${deltaCellClass(totals.net)}`}
                >
                  {formatUsd(totals.net)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ── Monthly tab ────────────────────────────────────────────────────
type MonthlyKey =
  | "month"
  | "recovered"
  | "rentPaid"
  | "utilities"
  | "otherCosts"
  | "net";

const MONTHLY_WINDOW_OPTIONS = [3, 6, 12, 24] as const;

export function FinancePayrollMonthlyTab(props: SharedProps) {
  const { t } = useTranslation();
  const [months, setMonths] = useState<number>(12);
  const { data } = useListFinanceMonthly({ months, ...scopeParams(props) });
  const rows: MonthlyRow[] = useMemo(
    () => (data as MonthlyRow[] | undefined) ?? [],
    [data],
  );
  const [sort, setSort] = useState<SortState<MonthlyKey>>({
    key: "month",
    dir: "desc",
  });
  const display = useMemo(
    () =>
      sortRows(rows, sort, {
        month: (r) => r.month,
        recovered: (r) => r.recovered,
        rentPaid: (r) => r.rentPaid,
        utilities: (r) => r.utilities,
        otherCosts: (r) => r.otherCosts,
        net: (r) => r.net,
      }),
    [rows, sort],
  );
  const chartData = useMemo(
    () =>
      [...rows]
        .sort((a, b) => a.month.localeCompare(b.month))
        .map((r) => ({
          label: formatMonthBucketLabel(r.month),
          recovered: r.recovered,
          rentPaid: r.rentPaid,
        })),
    [rows],
  );

  const totals = display.reduce(
    (acc, r) => ({
      recovered: acc.recovered + r.recovered,
      rentPaid: acc.rentPaid + r.rentPaid,
      utilities: acc.utilities + r.utilities,
      otherCosts: acc.otherCosts + r.otherCosts,
      net: acc.net + r.net,
    }),
    { recovered: 0, rentPaid: 0, utilities: 0, otherCosts: 0, net: 0 },
  );

  const handleExport = () => {
    const csv = toCsv(display, [
      { header: "month", value: (r) => r.month },
      { header: "recovered", value: (r) => r.recovered },
      { header: "rent_paid", value: (r) => r.rentPaid },
      { header: "utilities", value: (r) => r.utilities },
      { header: "other_costs", value: (r) => r.otherCosts },
      { header: "net", value: (r) => r.net },
    ]);
    downloadCsv(timestampedCsvName("finance-monthly"), csv);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base">
            {t("pages.finance.payroll.monthlyTitle")}
          </CardTitle>
          <div className="flex items-center gap-2">
            <select
              value={months}
              onChange={(e) => setMonths(Number(e.target.value))}
              data-testid="select-finance-monthly-window"
              className="h-8 rounded-md border border-input bg-background px-2 text-sm"
            >
              {MONTHLY_WINDOW_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {t("pages.finance.payroll.lastNMonths", { count: n })}
                </option>
              ))}
            </select>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={display.length === 0}
            data-testid="button-finance-monthly-export"
          >
            <Download className="h-3 w-3 mr-1" />
            {t("pages.finance.payroll.exportCsv")}
          </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {chartData.length > 0 && (
          <div className="h-44 w-full" data-testid="chart-finance-monthly">
            <ResponsiveContainer>
              <LineChart
                data={chartData}
                margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} />
                <YAxis
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v: number) => `$${Math.round(v)}`}
                  width={56}
                />
                <Tooltip formatter={(v: number) => formatUsd(Number(v))} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line
                  type="monotone"
                  dataKey="recovered"
                  name={t("pages.finance.payroll.recovered")}
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="rentPaid"
                  name={t("pages.finance.payroll.rentPaid")}
                  stroke="hsl(var(--destructive))"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        {display.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("pages.finance.payroll.noSnapshotsDescription")}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <SortHeader
                    label={t("pages.finance.payroll.month")}
                    sortKey="month"
                    state={sort}
                    setState={setSort}
                    testId="sort-finance-monthly-month"
                  />
                </TableHead>
                <TableHead className="text-right">
                  <SortHeader
                    label={t("pages.finance.payroll.recovered")}
                    sortKey="recovered"
                    state={sort}
                    setState={setSort}
                    align="right"
                  />
                </TableHead>
                <TableHead className="text-right">
                  <SortHeader
                    label={t("pages.finance.payroll.rentPaid")}
                    sortKey="rentPaid"
                    state={sort}
                    setState={setSort}
                    align="right"
                  />
                </TableHead>
                <TableHead className="text-right">
                  <SortHeader
                    label={t("pages.finance.payroll.utilities")}
                    sortKey="utilities"
                    state={sort}
                    setState={setSort}
                    align="right"
                  />
                </TableHead>
                <TableHead className="text-right">
                  <SortHeader
                    label={t("pages.finance.payroll.otherCosts")}
                    sortKey="otherCosts"
                    state={sort}
                    setState={setSort}
                    align="right"
                  />
                </TableHead>
                <TableHead className="text-right">
                  <SortHeader
                    label={t("pages.finance.payroll.net")}
                    sortKey="net"
                    state={sort}
                    setState={setSort}
                    align="right"
                  />
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {display.map((r) => (
                <TableRow
                  key={r.month}
                  data-testid={`row-finance-monthly-${r.month}`}
                >
                  <TableCell>{formatMonthBucketLabel(r.month)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatUsd(r.recovered)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {formatUsd(r.rentPaid)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {formatUsd(r.utilities)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {formatUsd(r.otherCosts)}
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${deltaCellClass(r.net)}`}
                  >
                    {formatUsd(r.net)}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="font-semibold border-t-2">
                <TableCell>{t("pages.finance.payroll.totals")}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatUsd(totals.recovered)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatUsd(totals.rentPaid)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatUsd(totals.utilities)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatUsd(totals.otherCosts)}
                </TableCell>
                <TableCell
                  className={`text-right tabular-nums ${deltaCellClass(totals.net)}`}
                >
                  {formatUsd(totals.net)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ── By Customer tab ────────────────────────────────────────────────
type ByCustomerKey =
  | "customerName"
  | "activeOccupants"
  | "allocatedCost"
  | "monthToDateRecovered"
  | "recoveryGap"
  | "recoveryRate"
  | "occupancyPct";

export function FinancePayrollByCustomerTab(props: SharedProps) {
  const { t } = useTranslation();
  const { data } = useListFinanceByCustomer(scopeParams(props));
  const result: ByCustomerResult | null = useMemo(
    () => (data as ByCustomerResult | undefined) ?? null,
    [data],
  );
  const { properties, beds, leases } = useData();

  // Allocation mode (spec §3): "total" charges a customer for the empty
  // beds in their footprint (vacancy loss stays visible); "occupied"
  // scales each property's lease cost by its occupancy so the customer
  // only carries beds actually in use.
  const [allocMode, setAllocMode] = useState<"total" | "occupied">("total");

  // Per (primary) customer: total lease cost, occupancy-weighted cost,
  // and bed counts — from live properties/beds/leases. This app assigns a
  // whole property to its primary customer, so allocation is by property.
  const costByCustomer = useMemo(() => {
    const m = new Map<
      string,
      { costTotal: number; costOcc: number; beds: number; occ: number }
    >();
    for (const p of properties) {
      const cid = p.customerId;
      if (!cid) continue;
      const pBeds = beds.filter((b) => b.propertyId === p.id);
      const total = pBeds.length || p.totalBeds || 0;
      const occ = pBeds.filter((b) => b.status === "Occupied").length;
      const activeRent = sumActiveRent(leases, p.id);
      const leaseCost = activeRent > 0 ? activeRent : p.monthlyRent || 0;
      const costOcc = total > 0 ? leaseCost * (occ / total) : leaseCost;
      const e = m.get(cid) ?? { costTotal: 0, costOcc: 0, beds: 0, occ: 0 };
      e.costTotal += leaseCost;
      e.costOcc += costOcc;
      e.beds += total;
      e.occ += occ;
      m.set(cid, e);
    }
    return m;
  }, [properties, beds, leases]);

  const rawRows = useMemo(() => result?.rows ?? [], [result]);

  // Enrich each customer row with allocated_cost / recovery_gap /
  // recovery_rate / occupancy (recovered = ACTUAL deductions = the
  // endpoint's monthToDateRecovered).
  const enriched = useMemo(
    () =>
      rawRows.map((r) => {
        const cd = costByCustomer.get(r.customerId);
        const allocatedCost =
          allocMode === "occupied"
            ? cd?.costOcc ?? r.monthlyRentKfiPays
            : cd?.costTotal ?? r.monthlyRentKfiPays;
        const recovered = r.monthToDateRecovered;
        const recoveryGap = allocatedCost - recovered;
        const recoveryRate =
          allocatedCost > 0 ? (recovered / allocatedCost) * 100 : null;
        const occupancyPct =
          cd && cd.beds > 0 ? (cd.occ / cd.beds) * 100 : null;
        return { ...r, allocatedCost, recovered, recoveryGap, recoveryRate, occupancyPct };
      }),
    [rawRows, costByCustomer, allocMode],
  );

  const [sort, setSort] = useState<SortState<ByCustomerKey>>({
    key: "recoveryGap",
    dir: "desc",
  });
  const rows = useMemo(
    () =>
      sortRows(enriched, sort, {
        customerName: (r) => r.customerName,
        activeOccupants: (r) => r.activeOccupants,
        allocatedCost: (r) => r.allocatedCost,
        monthToDateRecovered: (r) => r.monthToDateRecovered,
        recoveryGap: (r) => r.recoveryGap,
        recoveryRate: (r) => r.recoveryRate ?? -1,
        occupancyPct: (r) => r.occupancyPct ?? -1,
      }),
    [enriched, sort],
  );

  const totals = rows.reduce(
    (acc, r) => ({
      activeOccupants: acc.activeOccupants + r.activeOccupants,
      allocatedCost: acc.allocatedCost + r.allocatedCost,
      monthToDateRecovered: acc.monthToDateRecovered + r.monthToDateRecovered,
      recoveryGap: acc.recoveryGap + r.recoveryGap,
    }),
    {
      activeOccupants: 0,
      allocatedCost: 0,
      monthToDateRecovered: 0,
      recoveryGap: 0,
    },
  );

  const handleExport = () => {
    const csv = toCsv(rows, [
      { header: "customer_id", value: (r) => r.customerId },
      { header: "customer_name", value: (r) => r.customerName },
      { header: "active_occupants", value: (r) => r.activeOccupants },
      { header: "monthly_rent_kfi_pays", value: (r) => r.monthlyRentKfiPays },
      {
        header: "most_recent_week_recovered",
        value: (r) => r.mostRecentWeekRecovered,
      },
      {
        header: "month_to_date_recovered",
        value: (r) => r.monthToDateRecovered,
      },
      { header: "net", value: (r) => r.net },
    ]);
    downloadCsv(timestampedCsvName("finance-by-customer"), csv);
  };

  const subtitle = result
    ? t("pages.finance.payroll.byCustomerSubtitle", {
        week: result.mostRecentWeekEndDate ?? "—",
        month: formatMonthBucketLabel(result.currentMonth),
      })
    : "";

  const onSelect = props.onSelectCustomer;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">
              {t("pages.finance.payroll.byCustomerTitle")}
            </CardTitle>
            {subtitle && (
              <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div
              className="inline-flex items-center rounded-md border p-0.5 text-xs"
              data-testid="toggle-alloc-mode"
              title="How a property's lease cost is allocated to its customer"
            >
              <button
                type="button"
                onClick={() => setAllocMode("total")}
                className={
                  "rounded px-2 py-1 " +
                  (allocMode === "total" ? "bg-primary text-primary-foreground" : "text-muted-foreground")
                }
              >
                By total beds
              </button>
              <button
                type="button"
                onClick={() => setAllocMode("occupied")}
                className={
                  "rounded px-2 py-1 " +
                  (allocMode === "occupied" ? "bg-primary text-primary-foreground" : "text-muted-foreground")
                }
              >
                By occupied beds
              </button>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleExport}
              disabled={rows.length === 0}
              data-testid="button-finance-by-customer-export"
            >
              <Download className="h-3 w-3 mr-1" />
              {t("pages.finance.payroll.exportCsv")}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("pages.finance.payroll.noSnapshotsDescription")}
          </p>
        ) : (
          <>
            <div
              className="h-44 mb-4"
              data-testid="chart-finance-by-customer"
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rows} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="customerName"
                    tick={{ fontSize: 11 }}
                    interval={0}
                    angle={-20}
                    textAnchor="end"
                    height={60}
                  />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip
                    formatter={(value: number) => formatUsd(value)}
                  />
                  <Legend />
                  <Bar
                    dataKey="monthToDateRecovered"
                    name={t("pages.finance.payroll.monthToDate")}
                    fill="#2563eb"
                  />
                  <Bar
                    dataKey="monthlyRentKfiPays"
                    name={t("pages.finance.payroll.monthlyRentKfiPays")}
                    fill="#94a3b8"
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <SortHeader
                    label={t("pages.finance.payroll.customer")}
                    sortKey="customerName"
                    state={sort}
                    setState={setSort}
                  />
                </TableHead>
                <TableHead className="text-right">
                  <SortHeader
                    label={t("pages.finance.payroll.activeOccupants")}
                    sortKey="activeOccupants"
                    state={sort}
                    setState={setSort}
                    align="right"
                  />
                </TableHead>
                <TableHead className="text-right">
                  <SortHeader label="Allocated cost" sortKey="allocatedCost" state={sort} setState={setSort} align="right" />
                </TableHead>
                <TableHead className="text-right">
                  <SortHeader label="Recovered" sortKey="monthToDateRecovered" state={sort} setState={setSort} align="right" />
                </TableHead>
                <TableHead className="text-right">
                  <SortHeader label="Recovery gap" sortKey="recoveryGap" state={sort} setState={setSort} align="right" />
                </TableHead>
                <TableHead className="text-right">
                  <SortHeader label="Rate %" sortKey="recoveryRate" state={sort} setState={setSort} align="right" />
                </TableHead>
                <TableHead className="text-right">
                  <SortHeader label="Occ %" sortKey="occupancyPct" state={sort} setState={setSort} align="right" />
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow
                  key={r.customerId}
                  data-testid={`row-finance-by-customer-${r.customerId}`}
                  onClick={onSelect ? () => onSelect(r.customerId) : undefined}
                  className={onSelect ? "cursor-pointer hover:bg-muted/50" : ""}
                  role={onSelect ? "button" : undefined}
                  tabIndex={onSelect ? 0 : undefined}
                  onKeyDown={
                    onSelect
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onSelect(r.customerId);
                          }
                        }
                      : undefined
                  }
                >
                  <TableCell>{r.customerName}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.activeOccupants}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {formatUsd(r.allocatedCost)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatUsd(r.recovered)}
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums font-medium ${r.recoveryGap > 0 ? "text-red-600" : "text-emerald-600"}`}
                  >
                    {formatUsd(r.recoveryGap)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {r.recoveryRate == null ? "—" : `${r.recoveryRate.toFixed(0)}%`}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {r.occupancyPct == null ? "—" : `${r.occupancyPct.toFixed(0)}%`}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="font-semibold border-t-2">
                <TableCell>{t("pages.finance.payroll.totals")}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {totals.activeOccupants}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatUsd(totals.allocatedCost)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatUsd(totals.monthToDateRecovered)}
                </TableCell>
                <TableCell
                  className={`text-right tabular-nums font-medium ${totals.recoveryGap > 0 ? "text-red-600" : "text-emerald-600"}`}
                >
                  {formatUsd(totals.recoveryGap)}
                </TableCell>
                <TableCell className="text-right tabular-nums" />
                <TableCell className="text-right tabular-nums" />
              </TableRow>
            </TableBody>
          </Table>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── Money review (week-by-week) ────────────────────────────────────
// Period-scoped recovery review with vs-prior deltas, a new/stopped/
// amount-changed week-diff, and a "mark reviewed" action. Backed by the
// direct-fetch endpoints /api/finance/period | week-diff | week-review
// (NOT in the generated client — same pattern as the roster/zenople
// routes). All reads are tolerant of partial/missing data so the tab
// never crashes while the (live-Zenople-backed) endpoints warm up.

const PERIOD_KINDS = [
  { kind: "this-week", label: "This week" },
  { kind: "last-week", label: "Last week" },
  { kind: "this-month", label: "This month" },
  { kind: "last-month", label: "Last month" },
  { kind: "this-quarter", label: "This quarter" },
] as const;
type PeriodKind = (typeof PERIOD_KINDS)[number]["kind"];

const apiBase = (): string => import.meta.env.BASE_URL ?? "/";

type PeriodResp = {
  period?: string;
  collected?: number;
  rentWePay?: number;
  propertyCount?: number;
  net?: number;
  prior?: { collected?: number; rentWePay?: number; net?: number };
  deltas?: { collected?: number; rentWePay?: number; net?: number };
};
type DiffPerson = { name?: string; personId?: string; weekly?: number };
type DiffChanged = { name?: string; from?: number; to?: number };
type WeekDiffResp = {
  week?: string;
  added?: DiffPerson[];
  stopped?: DiffPerson[];
  changed?: DiffChanged[];
};

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** This week's (or last week's) Saturday end-date as YYYY-MM-DD. */
function weekSaturday(kind: PeriodKind): string {
  const d = new Date();
  const day = d.getDay(); // 0 Sun … 6 Sat
  const toSat = (6 - day + 7) % 7;
  d.setDate(d.getDate() + toSat);
  if (kind === "last-week") d.setDate(d.getDate() - 7);
  return d.toISOString().slice(0, 10);
}

function Delta({ value }: { value: number }) {
  if (!value) return <span className="text-muted-foreground tabular-nums text-[11px]">no change</span>;
  const up = value > 0;
  return (
    <span className={`tabular-nums text-[11px] ${up ? "text-ok" : "text-risk"}`}>
      {up ? "▲" : "▼"} {formatUsd(Math.abs(value))}
    </span>
  );
}

export function FinanceMoneyReviewTab() {
  const [kind, setKind] = useState<PeriodKind>("this-week");
  const [period, setPeriod] = useState<PeriodResp | null>(null);
  const [diff, setDiff] = useState<WeekDiffResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [marking, setMarking] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr(false);
    setReviewed(false);
    const wk = weekSaturday(kind === "last-week" ? "last-week" : "this-week");
    Promise.allSettled([
      fetch(`${apiBase()}api/finance/period?kind=${encodeURIComponent(kind)}`).then((r) =>
        r.ok ? r.json() : Promise.reject(new Error(String(r.status))),
      ),
      fetch(`${apiBase()}api/finance/week-diff?week=${encodeURIComponent(wk)}`).then((r) =>
        r.ok ? r.json() : Promise.reject(new Error(String(r.status))),
      ),
    ]).then((res) => {
      if (!alive) return;
      const [p, d] = res;
      if (p.status === "fulfilled") setPeriod(p.value as PeriodResp);
      else setPeriod(null);
      if (d.status === "fulfilled") setDiff(d.value as WeekDiffResp);
      else setDiff(null);
      if (p.status === "rejected" && d.status === "rejected") setErr(true);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [kind]);

  const markReviewed = async () => {
    setMarking(true);
    try {
      const res = await fetch(`${apiBase()}api/finance/week-review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodKey: period?.period ?? kind }),
      });
      if (res.ok) setReviewed(true);
    } catch {
      /* non-fatal */
    } finally {
      setMarking(false);
    }
  };

  const collected = num(period?.collected);
  const rent = num(period?.rentWePay);
  const net = period ? num(period.net) : collected - rent;
  const stats: MoneyStat[] = [
    { label: "Collected", amount: collected, tone: "ok" },
    { label: "Rent we pay", amount: rent, tone: "neutral" },
    { label: "Properties", amount: num(period?.propertyCount), tone: "neutral" },
    { label: "Net spread", amount: net, tone: "auto", emphasize: true },
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">Money review</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Are we recovering the rent we pay? Pick a period and review what changed.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as PeriodKind)}
              data-testid="select-finance-money-period"
              className="h-8 rounded-md border border-line bg-panel px-2 text-sm"
            >
              {PERIOD_KINDS.map((p) => (
                <option key={p.kind} value={p.kind}>
                  {p.label}
                </option>
              ))}
            </select>
            <Button
              type="button"
              variant={reviewed ? "outline" : "default"}
              size="sm"
              onClick={markReviewed}
              disabled={marking || reviewed || loading}
              data-testid="button-finance-week-review"
            >
              {reviewed ? "✓ Reviewed" : marking ? "Saving…" : "Mark reviewed"}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {loading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-16 rounded-lg border border-line bg-muted/30 animate-pulse" />
            ))}
          </div>
        ) : err ? (
          <EmptyState
            title="Couldn't load the period"
            description="The payroll figures weren't reachable just now. Try another period."
            testId="finance-money-error"
          />
        ) : (
          <>
            <MoneyTile title={PERIOD_KINDS.find((p) => p.kind === kind)?.label} stats={stats} />
            {period?.deltas && (
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
                <span className="text-muted-foreground">vs prior period:</span>
                <span className="flex items-center gap-1">Collected <Delta value={num(period.deltas.collected)} /></span>
                <span className="flex items-center gap-1">Rent <Delta value={num(period.deltas.rentWePay)} /></span>
                <span className="flex items-center gap-1">Net <Delta value={num(period.deltas.net)} /></span>
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-3">
              <DiffColumn
                title="New this week"
                tone="ok"
                people={diff?.added ?? []}
              />
              <DiffColumn
                title="Stopped"
                tone="risk"
                people={diff?.stopped ?? []}
              />
              <div className="rounded-lg border border-line bg-panel p-3">
                <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <StatusDot status="warn" size="sm" /> Amount changed
                </div>
                {(diff?.changed ?? []).length === 0 ? (
                  <p className="text-xs text-muted-foreground">None</p>
                ) : (
                  <ul className="space-y-1.5">
                    {(diff?.changed ?? []).map((c, i) => (
                      <li key={`${c.name}-${i}`} className="flex items-center justify-between gap-2 text-sm">
                        <span className="truncate">{c.name ?? "—"}</span>
                        <span className="tabular-nums text-xs text-muted-foreground">
                          {formatUsd(num(c.from))} → <span className="text-ink font-medium">{formatUsd(num(c.to))}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function DiffColumn({
  title,
  tone,
  people,
}: {
  title: string;
  tone: "ok" | "risk";
  people: DiffPerson[];
}) {
  return (
    <div className="rounded-lg border border-line bg-panel p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <StatusDot status={tone} size="sm" /> {title}
        <span className="ml-auto tabular-nums">{people.length}</span>
      </div>
      {people.length === 0 ? (
        <p className="text-xs text-muted-foreground">None</p>
      ) : (
        <ul className="space-y-1.5">
          {people.map((p, i) => (
            <li key={`${p.personId ?? p.name}-${i}`} className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate">{p.name ?? p.personId ?? "—"}</span>
              <DeductionBadge size="sm" weeklyAmount={p.weekly ?? null} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
