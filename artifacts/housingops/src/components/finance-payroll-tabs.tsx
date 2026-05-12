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

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { formatUsd } from "@/data/mockData";
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
  | "monthlyRentKfiPays"
  | "mostRecentWeekRecovered"
  | "monthToDateRecovered"
  | "net";

export function FinancePayrollByCustomerTab(props: SharedProps) {
  const { t } = useTranslation();
  const { data } = useListFinanceByCustomer(scopeParams(props));
  const result: ByCustomerResult | null = useMemo(
    () => (data as ByCustomerResult | undefined) ?? null,
    [data],
  );

  const rawRows = useMemo(() => result?.rows ?? [], [result]);
  const [sort, setSort] = useState<SortState<ByCustomerKey>>({
    key: "customerName",
    dir: "asc",
  });
  const rows = useMemo(
    () =>
      sortRows(rawRows, sort, {
        customerName: (r) => r.customerName,
        activeOccupants: (r) => r.activeOccupants,
        monthlyRentKfiPays: (r) => r.monthlyRentKfiPays,
        mostRecentWeekRecovered: (r) => r.mostRecentWeekRecovered,
        monthToDateRecovered: (r) => r.monthToDateRecovered,
        net: (r) => r.net,
      }),
    [rawRows, sort],
  );

  const totals = rows.reduce(
    (acc, r) => ({
      activeOccupants: acc.activeOccupants + r.activeOccupants,
      monthlyRentKfiPays: acc.monthlyRentKfiPays + r.monthlyRentKfiPays,
      mostRecentWeekRecovered:
        acc.mostRecentWeekRecovered + r.mostRecentWeekRecovered,
      monthToDateRecovered: acc.monthToDateRecovered + r.monthToDateRecovered,
      net: acc.net + r.net,
    }),
    {
      activeOccupants: 0,
      monthlyRentKfiPays: 0,
      mostRecentWeekRecovered: 0,
      monthToDateRecovered: 0,
      net: 0,
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
                  <SortHeader
                    label={t("pages.finance.payroll.monthlyRentKfiPays")}
                    sortKey="monthlyRentKfiPays"
                    state={sort}
                    setState={setSort}
                    align="right"
                  />
                </TableHead>
                <TableHead className="text-right">
                  <SortHeader
                    label={t("pages.finance.payroll.mostRecentWeek")}
                    sortKey="mostRecentWeekRecovered"
                    state={sort}
                    setState={setSort}
                    align="right"
                  />
                </TableHead>
                <TableHead className="text-right">
                  <SortHeader
                    label={t("pages.finance.payroll.monthToDate")}
                    sortKey="monthToDateRecovered"
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
                    {formatUsd(r.monthlyRentKfiPays)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatUsd(r.mostRecentWeekRecovered)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatUsd(r.monthToDateRecovered)}
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
                  {totals.activeOccupants}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatUsd(totals.monthlyRentKfiPays)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatUsd(totals.mostRecentWeekRecovered)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatUsd(totals.monthToDateRecovered)}
                </TableCell>
                <TableCell
                  className={`text-right tabular-nums ${deltaCellClass(totals.net)}`}
                >
                  {formatUsd(totals.net)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
          </>
        )}
      </CardContent>
    </Card>
  );
}
