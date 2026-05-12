// Finance Weekly / Monthly / By-Customer tab content (Task #597).
//
// All three tabs are thin presentation layers over server-side rollup
// endpoints (`/api/finance/weekly|monthly|by-customer`). Aggregation
// lives on the server so the three views can never disagree about
// what "rent paid" or "recovered" means and so the wire payload stays
// small (one row per pay-week / month / customer).
//
// Each tab supports CSV export of the displayed rows.

import { useMemo } from "react";
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
import { Download } from "lucide-react";
import { formatUsd } from "@/data/mockData";
import { ALL_CUSTOMERS } from "@/context/customer-scope";
import {
  formatMonthBucketLabel,
  formatPayWeekRange,
} from "@/lib/finance-pay-weeks";

type SharedProps = {
  customerFilter: string;
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

function deltaCellClass(n: number): string {
  return n >= 0 ? "text-green-600" : "text-destructive";
}

function csvEscape(v: string | number): string {
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadCsv(filename: string, header: string[], rows: (string | number)[][]) {
  const body = [header, ...rows]
    .map((r) => r.map(csvEscape).join(","))
    .join("\n");
  const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ── Weekly tab ─────────────────────────────────────────────────────
export function FinancePayrollWeeklyTab(_props: SharedProps) {
  const { t } = useTranslation();
  const { data } = useListFinanceWeekly({ weeks: 13 });
  const rows: WeeklyRow[] = useMemo(
    () => (data as WeeklyRow[] | undefined) ?? [],
    [data],
  );
  // Newest first for display.
  const display = useMemo(() => [...rows].reverse(), [rows]);

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
    downloadCsv(
      "finance-weekly.csv",
      ["pay_week_end_date", "recovered", "rent_paid", "utilities", "net"],
      display.map((r) => [
        r.payWeekEndDate,
        r.recovered,
        r.rentPaid,
        r.utilities,
        r.net,
      ]),
    );
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base">
            {t("pages.finance.payroll.weeklyTitle")}
          </CardTitle>
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
      </CardHeader>
      <CardContent>
        {display.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("pages.finance.payroll.noSnapshotsDescription")}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("pages.finance.payroll.payWeek")}</TableHead>
                <TableHead className="text-right">
                  {t("pages.finance.payroll.recovered")}
                </TableHead>
                <TableHead className="text-right">
                  {t("pages.finance.payroll.rentPaid")}
                </TableHead>
                <TableHead className="text-right">
                  {t("pages.finance.payroll.utilities")}
                </TableHead>
                <TableHead className="text-right">
                  {t("pages.finance.payroll.net")}
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
export function FinancePayrollMonthlyTab(_props: SharedProps) {
  const { t } = useTranslation();
  const { data } = useListFinanceMonthly({ months: 12 });
  const rows: MonthlyRow[] = useMemo(
    () => (data as MonthlyRow[] | undefined) ?? [],
    [data],
  );
  const display = useMemo(() => [...rows].reverse(), [rows]);

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
    downloadCsv(
      "finance-monthly.csv",
      [
        "month",
        "recovered",
        "rent_paid",
        "utilities",
        "other_costs",
        "net",
      ],
      display.map((r) => [
        r.month,
        r.recovered,
        r.rentPaid,
        r.utilities,
        r.otherCosts,
        r.net,
      ]),
    );
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base">
            {t("pages.finance.payroll.monthlyTitle")}
          </CardTitle>
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
      </CardHeader>
      <CardContent>
        {display.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("pages.finance.payroll.noSnapshotsDescription")}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("pages.finance.payroll.month")}</TableHead>
                <TableHead className="text-right">
                  {t("pages.finance.payroll.recovered")}
                </TableHead>
                <TableHead className="text-right">
                  {t("pages.finance.payroll.rentPaid")}
                </TableHead>
                <TableHead className="text-right">
                  {t("pages.finance.payroll.utilities")}
                </TableHead>
                <TableHead className="text-right">
                  {t("pages.finance.payroll.otherCosts")}
                </TableHead>
                <TableHead className="text-right">
                  {t("pages.finance.payroll.net")}
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
export function FinancePayrollByCustomerTab({ customerFilter }: SharedProps) {
  const { t } = useTranslation();
  const { data } = useListFinanceByCustomer();
  const result: ByCustomerResult | null = useMemo(
    () => (data as ByCustomerResult | undefined) ?? null,
    [data],
  );

  const rows = useMemo(() => {
    const all = result?.rows ?? [];
    if (customerFilter === ALL_CUSTOMERS) return all;
    return all.filter((r) => r.customerId === customerFilter);
  }, [result, customerFilter]);

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
    downloadCsv(
      "finance-by-customer.csv",
      [
        "customer_id",
        "customer_name",
        "active_occupants",
        "monthly_rent_kfi_pays",
        "most_recent_week_recovered",
        "month_to_date_recovered",
        "net",
      ],
      rows.map((r) => [
        r.customerId,
        r.customerName,
        r.activeOccupants,
        r.monthlyRentKfiPays,
        r.mostRecentWeekRecovered,
        r.monthToDateRecovered,
        r.net,
      ]),
    );
  };

  const subtitle = result
    ? t("pages.finance.payroll.byCustomerSubtitle", {
        week: result.mostRecentWeekEndDate ?? "—",
        month: formatMonthBucketLabel(result.currentMonth),
      })
    : "";

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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("pages.finance.payroll.customer")}</TableHead>
                <TableHead className="text-right">
                  {t("pages.finance.payroll.activeOccupants")}
                </TableHead>
                <TableHead className="text-right">
                  {t("pages.finance.payroll.monthlyRentKfiPays")}
                </TableHead>
                <TableHead className="text-right">
                  {t("pages.finance.payroll.mostRecentWeek")}
                </TableHead>
                <TableHead className="text-right">
                  {t("pages.finance.payroll.monthToDate")}
                </TableHead>
                <TableHead className="text-right">
                  {t("pages.finance.payroll.net")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow
                  key={r.customerId}
                  data-testid={`row-finance-by-customer-${r.customerId}`}
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
        )}
      </CardContent>
    </Card>
  );
}
