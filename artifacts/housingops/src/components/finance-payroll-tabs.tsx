// Finance Weekly / Monthly / By Customer tab content (Task #597).
//
// All three views are derived client-side from the per-pay-week
// deduction snapshots returned by `useListPayrollDeductions` (React
// Query dedupes the request when each tab calls the hook). There's no
// server-side aggregation: the volume is small (~250 occupants ×
// however-many weeks of history) and keeping the rollups here means
// re-bucketing when the operator changes the pay-week / month picker
// is instantaneous and re-uses the same in-memory rows.
//
// The Weekly tab also doubles as the "re-import payroll for week
// ending …" entry point — it sends the chosen Saturday end-date down
// to `/payroll/unplaced?payWeekEndDate=YYYY-MM-DD`, which is the same
// idempotent seeder the dashboard polls (just stamped this time so the
// snapshot row gets written).

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useListPayrollDeductions,
  customFetch,
  getListPayrollDeductionsQueryKey,
  type ListUnplacedPayrollResult,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { formatUsd, type Lease, type Property } from "@/data/mockData";
import { ALL_CUSTOMERS } from "@/context/customer-scope";
import {
  currentMonthBucket,
  formatMonthBucketLabel,
  formatPayWeekRange,
  isSaturdayDate,
  monthBucketForPayWeek,
  mostRecentSaturday,
  shiftWeeks,
} from "@/lib/finance-pay-weeks";

type PayrollDeductionRow = {
  id: string;
  occupantId: string;
  customerId: string;
  propertyId: string;
  payWeekEndDate: string;
  weeklyAmount: number;
  personId: string;
  nameSnapshot: string;
  customerSnapshot: string;
};

type SharedProps = {
  properties: readonly Property[];
  leases: readonly Lease[];
  customerById: Map<string, string>;
  customerFilter: string;
};

// `monthlyRent` is collected on the lease as a calendar-month figure.
// Per the task spec we count the FULL monthlyRent for any month a lease
// is active for at least one day, and we EXCLUDE leases flagged
// `customerResponsibleForRent` (the customer pays the landlord directly,
// so the deduction column shouldn't be measured against them).
function leaseActiveAnyDayInMonth(lease: Lease, ym: string): boolean {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) return false;
  const monthStart = `${ym}-01`;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const lastDay = new Date(y, mo, 0).getDate();
  const monthEnd = `${ym}-${String(lastDay).padStart(2, "0")}`;
  // Blank end-date means the lease is ongoing (open-ended) — treat as
  // active through the end of the month. Blank start-date is genuinely
  // missing data and we exclude it.
  if (!lease.startDate) return false;
  const effectiveEnd = lease.endDate && lease.endDate.length > 0 ? lease.endDate : "9999-12-31";
  // Inclusive YYYY-MM-DD lex comparison is correct here.
  return lease.startDate <= monthEnd && effectiveEnd >= monthStart;
}

function isMonthlyRentLease(lease: Lease): boolean {
  if (lease.customerResponsibleForRent) return false;
  if ((lease.rateType ?? "monthly") !== "monthly") return false;
  return true;
}

function rentExpectedForMonth(
  ym: string,
  leases: readonly Lease[],
  propertyId: string,
): number {
  let total = 0;
  for (const l of leases) {
    if (l.propertyId !== propertyId) continue;
    if (!isMonthlyRentLease(l)) continue;
    if (!leaseActiveAnyDayInMonth(l, ym)) continue;
    total += l.monthlyRent || 0;
  }
  return total;
}

const WEEKS_PER_MONTH = 52 / 12;

function useScopedDeductions(customerFilter: string) {
  const { data } = useListPayrollDeductions();
  const deductions: PayrollDeductionRow[] = useMemo(
    () => (data as PayrollDeductionRow[] | undefined) ?? [],
    [data],
  );
  const scoped = useMemo(() => {
    if (customerFilter === ALL_CUSTOMERS) return deductions;
    return deductions.filter((d) => d.customerId === customerFilter);
  }, [deductions, customerFilter]);
  return { all: deductions, scoped };
}

function visibleSlice(
  properties: readonly Property[],
  customerFilter: string,
): readonly Property[] {
  if (customerFilter === ALL_CUSTOMERS) return properties;
  return properties.filter((p) => p.customerId === customerFilter);
}

function deltaCellClass(delta: number): string {
  return delta >= 0 ? "text-green-600" : "text-destructive";
}

function signed(n: number): string {
  return `${n >= 0 ? "+" : ""}${formatUsd(n)}`;
}

// ── Weekly tab ─────────────────────────────────────────────────────
export function FinancePayrollWeeklyTab({
  properties,
  leases,
  customerFilter,
}: SharedProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { scoped, all } = useScopedDeductions(customerFilter);
  const visibleProperties = visibleSlice(properties, customerFilter);

  // Re-import card state (same Saturday end-date that powers the
  // /payroll/unplaced?payWeekEndDate=… stamp on the seeder).
  const [importWeek, setImportWeek] = useState<string>(() =>
    mostRecentSaturday(),
  );
  const importWeekValid = isSaturdayDate(importWeek);
  const [importing, setImporting] = useState(false);
  const queryClient = useQueryClient();
  const handleReimport = async () => {
    if (!importWeekValid) {
      toast({
        title: t("pages.finance.payroll.invalidWeekTitle"),
        description: t("pages.finance.payroll.invalidWeekDescription"),
        variant: "destructive",
      });
      return;
    }
    setImporting(true);
    try {
      const data = await customFetch<ListUnplacedPayrollResult>(
        `/api/payroll/unplaced?payWeekEndDate=${encodeURIComponent(importWeek)}`,
      );
      // Invalidate the deductions query so the freshly-written
      // snapshot rows show up in Weekly/Monthly/By Customer
      // immediately. We invalidate ALL variants of the query (no
      // params filter) since each tab calls the hook with its own
      // since/until window.
      await queryClient.invalidateQueries({
        queryKey: getListPayrollDeductionsQueryKey().slice(0, 1),
      });
      toast({
        title: t("pages.finance.payroll.reimportedTitle"),
        description: t("pages.finance.payroll.reimportedDescription", {
          week: importWeek,
          unmatched: data?.unmatched?.length ?? 0,
          review: data?.lowConfidenceMatches?.length ?? 0,
        }),
      });
    } catch (err) {
      toast({
        title: t("pages.finance.payroll.reimportFailedTitle"),
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setImporting(false);
    }
  };

  // Picker for which week to view. Falls back to the most-recent week
  // we actually have a snapshot for so the table is never empty when
  // the operator hasn't imported the very latest Saturday yet.
  const availableWeeks = useMemo(() => {
    const set = new Set<string>();
    for (const d of scoped) set.add(d.payWeekEndDate);
    return Array.from(set).sort().reverse();
  }, [scoped]);
  const [selectedWeek, setSelectedWeek] = useState<string>("");
  const effectiveWeek =
    selectedWeek && availableWeeks.includes(selectedWeek)
      ? selectedWeek
      : availableWeeks[0] ?? "";

  const rows = useMemo(() => {
    const byProp = new Map<string, number>();
    for (const d of scoped) {
      if (d.payWeekEndDate !== effectiveWeek) continue;
      byProp.set(d.propertyId, (byProp.get(d.propertyId) ?? 0) + d.weeklyAmount);
    }
    return visibleProperties
      .map((p) => {
        const collected = Math.round((byProp.get(p.id) ?? 0) * 100) / 100;
        const month = effectiveWeek
          ? monthBucketForPayWeek(effectiveWeek)
          : currentMonthBucket();
        const monthly = rentExpectedForMonth(month, leases, p.id);
        const expected = Math.round((monthly / WEEKS_PER_MONTH) * 100) / 100;
        return {
          property: p,
          collected,
          expected,
          delta: Math.round((collected - expected) * 100) / 100,
        };
      })
      .sort((a, b) => a.property.name.localeCompare(b.property.name));
  }, [scoped, effectiveWeek, visibleProperties, leases]);

  const totals = rows.reduce(
    (acc, r) => ({
      collected: acc.collected + r.collected,
      expected: acc.expected + r.expected,
    }),
    { collected: 0, expected: 0 },
  );
  const totalsDelta = totals.collected - totals.expected;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {t("pages.finance.payroll.importTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {t("pages.finance.payroll.importDescription")}
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label
                htmlFor="finance-payroll-import-week"
                className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
              >
                {t("pages.finance.payroll.payWeekEndingSaturday")}
              </label>
              <Input
                id="finance-payroll-import-week"
                type="date"
                value={importWeek}
                onChange={(e) => setImportWeek(e.target.value)}
                className="w-44"
                data-testid="input-finance-payroll-import-week"
              />
            </div>
            <Button
              type="button"
              onClick={handleReimport}
              disabled={!importWeekValid || importing}
              data-testid="button-finance-payroll-reimport"
            >
              {importing
                ? t("pages.finance.payroll.reimporting")
                : t("pages.finance.payroll.reimport")}
            </Button>
            {!importWeekValid && importWeek && (
              <Badge variant="destructive">
                {t("pages.finance.payroll.notSaturday")}
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-base">
              {t("pages.finance.payroll.weeklyTitle")}
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!effectiveWeek}
                onClick={() => setSelectedWeek(shiftWeeks(effectiveWeek, -1))}
                data-testid="button-finance-week-prev"
              >
                ←
              </Button>
              <span
                className="text-sm font-medium"
                data-testid="text-finance-week-label"
              >
                {effectiveWeek
                  ? formatPayWeekRange(effectiveWeek)
                  : t("pages.finance.payroll.noSnapshots")}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!effectiveWeek}
                onClick={() => setSelectedWeek(shiftWeeks(effectiveWeek, 1))}
                data-testid="button-finance-week-next"
              >
                →
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {all.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("pages.finance.payroll.noSnapshotsDescription")}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("pages.finance.payroll.property")}</TableHead>
                  <TableHead className="text-right">
                    {t("pages.finance.payroll.collected")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("pages.finance.payroll.expectedWeekly")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("pages.finance.payroll.delta")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow
                    key={r.property.id}
                    data-testid={`row-finance-weekly-${r.property.id}`}
                  >
                    <TableCell>{r.property.name}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatUsd(r.collected)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {formatUsd(r.expected)}
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums ${deltaCellClass(r.delta)}`}
                    >
                      {signed(r.delta)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-semibold border-t-2">
                  <TableCell>{t("pages.finance.payroll.totals")}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatUsd(totals.collected)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatUsd(totals.expected)}
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${deltaCellClass(totalsDelta)}`}
                  >
                    {signed(totalsDelta)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Monthly tab ────────────────────────────────────────────────────
export function FinancePayrollMonthlyTab({
  properties,
  leases,
  customerFilter,
}: SharedProps) {
  const { t } = useTranslation();
  const { scoped, all } = useScopedDeductions(customerFilter);
  const visibleProperties = visibleSlice(properties, customerFilter);

  const availableMonths = useMemo(() => {
    const set = new Set<string>();
    for (const d of scoped) set.add(monthBucketForPayWeek(d.payWeekEndDate));
    if (set.size === 0) set.add(currentMonthBucket());
    return Array.from(set).sort().reverse();
  }, [scoped]);
  const [selectedMonth, setSelectedMonth] = useState<string>("");
  const effectiveMonth =
    selectedMonth && availableMonths.includes(selectedMonth)
      ? selectedMonth
      : availableMonths[0] ?? currentMonthBucket();

  const rows = useMemo(() => {
    const byProp = new Map<string, number>();
    for (const d of scoped) {
      if (monthBucketForPayWeek(d.payWeekEndDate) !== effectiveMonth) continue;
      byProp.set(d.propertyId, (byProp.get(d.propertyId) ?? 0) + d.weeklyAmount);
    }
    return visibleProperties
      .map((p) => {
        const collected = Math.round((byProp.get(p.id) ?? 0) * 100) / 100;
        const expected = rentExpectedForMonth(effectiveMonth, leases, p.id);
        return {
          property: p,
          collected,
          expected,
          delta: Math.round((collected - expected) * 100) / 100,
        };
      })
      .sort((a, b) => a.property.name.localeCompare(b.property.name));
  }, [scoped, effectiveMonth, visibleProperties, leases]);

  const totals = rows.reduce(
    (acc, r) => ({
      collected: acc.collected + r.collected,
      expected: acc.expected + r.expected,
    }),
    { collected: 0, expected: 0 },
  );
  const totalsDelta = totals.collected - totals.expected;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base">
            {t("pages.finance.payroll.monthlyTitle")}
          </CardTitle>
          <select
            value={effectiveMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm"
            data-testid="select-finance-month"
          >
            {availableMonths.map((m) => (
              <option key={m} value={m}>
                {formatMonthBucketLabel(m)}
              </option>
            ))}
          </select>
        </div>
      </CardHeader>
      <CardContent>
        {all.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("pages.finance.payroll.noSnapshotsDescription")}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("pages.finance.payroll.property")}</TableHead>
                <TableHead className="text-right">
                  {t("pages.finance.payroll.collected")}
                </TableHead>
                <TableHead className="text-right">
                  {t("pages.finance.payroll.expectedMonthly")}
                </TableHead>
                <TableHead className="text-right">
                  {t("pages.finance.payroll.delta")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow
                  key={r.property.id}
                  data-testid={`row-finance-monthly-${r.property.id}`}
                >
                  <TableCell>{r.property.name}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatUsd(r.collected)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {formatUsd(r.expected)}
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${deltaCellClass(r.delta)}`}
                  >
                    {signed(r.delta)}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="font-semibold border-t-2">
                <TableCell>{t("pages.finance.payroll.totals")}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatUsd(totals.collected)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatUsd(totals.expected)}
                </TableCell>
                <TableCell
                  className={`text-right tabular-nums ${deltaCellClass(totalsDelta)}`}
                >
                  {signed(totalsDelta)}
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
export function FinancePayrollByCustomerTab({
  properties,
  leases,
  customerById,
  customerFilter,
}: SharedProps) {
  const { t } = useTranslation();
  const { scoped } = useScopedDeductions(customerFilter);

  const availableMonths = useMemo(() => {
    const set = new Set<string>();
    for (const d of scoped) set.add(monthBucketForPayWeek(d.payWeekEndDate));
    if (set.size === 0) set.add(currentMonthBucket());
    return Array.from(set).sort().reverse();
  }, [scoped]);
  const [selectedMonth, setSelectedMonth] = useState<string>("");
  const effectiveMonth =
    selectedMonth && availableMonths.includes(selectedMonth)
      ? selectedMonth
      : availableMonths[0] ?? currentMonthBucket();

  const rows = useMemo(() => {
    const collectedBy = new Map<string, number>();
    for (const d of scoped) {
      if (monthBucketForPayWeek(d.payWeekEndDate) !== effectiveMonth) continue;
      collectedBy.set(
        d.customerId,
        (collectedBy.get(d.customerId) ?? 0) + d.weeklyAmount,
      );
    }
    const expectedBy = new Map<string, number>();
    const propertyCustomerById = new Map<string, string>();
    for (const p of properties) propertyCustomerById.set(p.id, p.customerId);
    for (const l of leases) {
      if (!isMonthlyRentLease(l)) continue;
      if (!leaseActiveAnyDayInMonth(l, effectiveMonth)) continue;
      const cid =
        l.customerId ?? propertyCustomerById.get(l.propertyId) ?? "";
      if (!cid) continue;
      if (customerFilter !== ALL_CUSTOMERS && cid !== customerFilter) {
        continue;
      }
      expectedBy.set(cid, (expectedBy.get(cid) ?? 0) + (l.monthlyRent || 0));
    }
    const ids = new Set<string>([...collectedBy.keys(), ...expectedBy.keys()]);
    return Array.from(ids)
      .map((id) => {
        const collected = Math.round((collectedBy.get(id) ?? 0) * 100) / 100;
        const expected = expectedBy.get(id) ?? 0;
        return {
          customerId: id,
          customerName: customerById.get(id) ?? (id || "—"),
          collected,
          expected,
          delta: Math.round((collected - expected) * 100) / 100,
        };
      })
      .sort((a, b) => a.customerName.localeCompare(b.customerName));
  }, [scoped, effectiveMonth, leases, properties, customerById, customerFilter]);

  const totals = rows.reduce(
    (acc, r) => ({
      collected: acc.collected + r.collected,
      expected: acc.expected + r.expected,
    }),
    { collected: 0, expected: 0 },
  );
  const totalsDelta = totals.collected - totals.expected;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base">
            {t("pages.finance.payroll.byCustomerTitle", {
              month: formatMonthBucketLabel(effectiveMonth),
            })}
          </CardTitle>
          <select
            value={effectiveMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm"
            data-testid="select-finance-bycustomer-month"
          >
            {availableMonths.map((m) => (
              <option key={m} value={m}>
                {formatMonthBucketLabel(m)}
              </option>
            ))}
          </select>
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
                  {t("pages.finance.payroll.collected")}
                </TableHead>
                <TableHead className="text-right">
                  {t("pages.finance.payroll.expectedMonthly")}
                </TableHead>
                <TableHead className="text-right">
                  {t("pages.finance.payroll.delta")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow
                  key={r.customerId || "unattributed"}
                  data-testid={`row-finance-bycustomer-${r.customerId || "unattributed"}`}
                >
                  <TableCell>{r.customerName}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatUsd(r.collected)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {formatUsd(r.expected)}
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${deltaCellClass(r.delta)}`}
                  >
                    {signed(r.delta)}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="font-semibold border-t-2">
                <TableCell>{t("pages.finance.payroll.totals")}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatUsd(totals.collected)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatUsd(totals.expected)}
                </TableCell>
                <TableCell
                  className={`text-right tabular-nums ${deltaCellClass(totalsDelta)}`}
                >
                  {signed(totalsDelta)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
