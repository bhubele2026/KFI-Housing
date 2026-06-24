import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useSearch } from "wouter";
import { PropertyNameCell } from "@/components/property-name-cell";
import { shortPropertyName } from "@/lib/property-name";
import { MainLayout } from "@/components/layout/main-layout";
import { PageHeader } from "@/components/layout/page-header";
import { useData } from "@/context/data-store";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Search, UserPlus, Download, Upload, Users, Trash2, AlertTriangle, UserPlus2,
  CheckCircle2, ChevronLeft, ChevronRight, RefreshCw,
} from "lucide-react";
import { EmptyStateRow } from "@/components/empty-state";
import { DeductionBadge } from "@/components/kit";
import { SkeletonRows } from "@/components/skeleton-rows";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import { MoveOccupantDialog } from "@/components/move-occupant-dialog";
import { useToast } from "@/hooks/use-toast";
import { toCsv, downloadCsv, timestampedCsvName } from "@/lib/csv";
import { formatUsd, STANDARD_SHIFTS } from "@/data/mockData";
import { ALL_CUSTOMERS, useCustomerScope } from "@/context/customer-scope";
import { useMemo } from "react";
import {
  useListPayrollDeductions,
  useListUnplacedPayroll,
  getListUnplacedPayrollQueryKey,
  getListPayrollDeductionsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  isSaturdayDate,
  mostRecentSaturday,
  shiftWeeks,
  formatPayWeekRange,
} from "@/lib/finance-pay-weeks";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";

// Monthly equivalent of a single weekly deduction. 52 pay-weeks ÷ 12
// months matches the rest of the app's weekly→monthly conversion.
const WEEKS_PER_MONTH = 52 / 12;

export default function Occupants() {
  const { t } = useTranslation();
  const { occupants, properties, beds, customers, isLoading, deleteOccupant, updateOccupant } = useData();
  const { toast } = useToast();
  const { customerId: customerScope } = useCustomerScope();
  const customerScopedPropertyIds = useMemo(() => {
    if (customerScope === ALL_CUSTOMERS) return null;
    return new Set(
      properties
        .filter(
          (p) =>
            p.customerId === customerScope ||
            (p.sharedWithCustomerIds ?? []).includes(customerScope),
        )
        .map((p) => p.id),
    );
  }, [properties, customerScope]);
  // Move-in filter is URL-driven so the dashboard "Needs review" card can deep
  // link straight into the missing-move-in subset (`?needsReview=1`). We seed
  // state from the search string and write back on change so refresh/back work.
  // The dashboard "Recently reconciled from payroll" card (Task #351) also
  // deep-links here with `?q=<name>` so the operator lands with the search
  // box pre-filled on the just-touched occupant.
  const searchString = useSearch();
  const [, navigate] = useLocation();
  const [search, setSearch] = useState(
    () => new URLSearchParams(searchString).get("q") ?? "",
  );
  const [propertyFilter, setPropertyFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState(() =>
    new URLSearchParams(searchString).get("chargeSource") === "manual"
      ? "Active"
      : "All",
  );
  // Shift filter is free-form (Task #506): "All", "Unassigned", or any
  // shift title that appears on at least one occupant. The URL value is
  // accepted as-is for any non-empty string so per-customer custom
  // shifts deep-link cleanly.
  const [shiftFilter, setShiftFilter] = useState<string>(() => {
    const raw = new URLSearchParams(searchString).get("shift");
    return raw && raw.length > 0 ? raw : "All";
  });
  const [moveInFilter, setMoveInFilter] = useState<"All" | "NeedsReview">(() =>
    new URLSearchParams(searchString).get("needsReview") === "1"
      ? "NeedsReview"
      : "All",
  );
  const [chargeSourceFilter, setChargeSourceFilter] = useState<"All" | "manual" | "payroll">(() => {
    const v = new URLSearchParams(searchString).get("chargeSource");
    return v === "manual" || v === "payroll" ? v : "All";
  });
  // Pay-week selector. Defaults to the most recent Mon→Sat pay-week
  // (the one this week's payroll import would target). URL-driven via
  // ?week=YYYY-MM-DD so a deep link to a specific week round-trips.
  const [payWeek, setPayWeek] = useState<string>(() => {
    const raw = new URLSearchParams(searchString).get("week");
    return raw && isSaturdayDate(raw) ? raw : mostRecentSaturday();
  });
  // "This week" filter: All / Imported (has snapshot) / Missing (active
  // occupant with no snapshot for the selected week).
  const [weekFilter, setWeekFilter] = useState<"All" | "Imported" | "Missing">(
    () => {
      const v = new URLSearchParams(searchString).get("weekStatus");
      return v === "Imported" || v === "Missing" ? v : "All";
    },
  );

  useEffect(() => {
    const params = new URLSearchParams(searchString);
    const next =
      params.get("needsReview") === "1" ? "NeedsReview" : "All";
    setMoveInFilter((prev) => (prev === next ? prev : next));
    const rawShift = params.get("shift");
    const nextShift = rawShift && rawShift.length > 0 ? rawShift : "All";
    setShiftFilter((prev) => (prev === nextShift ? prev : nextShift));
    const q = params.get("q") ?? "";
    setSearch((prev) => (prev === q || prev !== "" && q === "" ? prev : q));
    const cs = params.get("chargeSource");
    const nextCs = cs === "manual" || cs === "payroll" ? cs : "All";
    setChargeSourceFilter((prev) => (prev === nextCs ? prev : nextCs));
    // Re-sync the pay-week selector + this-week filter so back/forward
    // navigation and deep links land on the right week even after mount.
    const rawWeek = params.get("week");
    const nextWeek = rawWeek && isSaturdayDate(rawWeek) ? rawWeek : mostRecentSaturday();
    setPayWeek((prev) => (prev === nextWeek ? prev : nextWeek));
    const ws = params.get("weekStatus");
    const nextWs = ws === "Imported" || ws === "Missing" ? ws : "All";
    setWeekFilter((prev) => (prev === nextWs ? prev : nextWs));
  }, [searchString]);

  const updateUrlParam = (key: string, value: string | null) => {
    const params = new URLSearchParams(window.location.search);
    if (value) params.set(key, value);
    else params.delete(key);
    const qs = params.toString();
    navigate(qs ? `/occupants?${qs}` : "/occupants", { replace: true });
  };

  const updateMoveInFilter = (value: "All" | "NeedsReview") => {
    setMoveInFilter(value);
    updateUrlParam("needsReview", value === "NeedsReview" ? "1" : null);
  };

  const updateShiftFilter = (value: string) => {
    setShiftFilter(value);
    updateUrlParam("shift", value === "All" ? null : value);
  };

  const updateChargeSourceFilter = (value: "All" | "manual" | "payroll") => {
    setChargeSourceFilter(value);
    updateUrlParam("chargeSource", value === "All" ? null : value);
  };

  const updatePayWeek = (value: string) => {
    if (!isSaturdayDate(value)) return;
    setPayWeek(value);
    updateUrlParam("week", value);
  };
  const updateWeekFilter = (value: "All" | "Imported" | "Missing") => {
    setWeekFilter(value);
    updateUrlParam("weekStatus", value === "All" ? null : value);
  };

  // Per-week deduction snapshots. Filtered to a single Saturday so the
  // payload is one row per occupant who got paid that week. The
  // unplaced-payroll endpoint surfaces the rows from the same import
  // that didn't match an existing occupant — i.e. brand-new arrivals
  // the operator still needs to place.
  const deductionsQuery = useListPayrollDeductions({
    since: payWeek,
    until: payWeek,
  });
  // The unplaced-payroll endpoint re-runs the seeder server-side and
  // upserts snapshot rows when given a payWeekEndDate, so we must NOT
  // call it on every render. Gate on the new-arrivals popover being
  // opened — the operator explicitly asks "who's new this week?".
  const [newArrivalsOpen, setNewArrivalsOpen] = useState(false);
  const unplacedQuery = useListUnplacedPayroll(
    { payWeekEndDate: payWeek },
    {
      query: {
        queryKey: getListUnplacedPayrollQueryKey({ payWeekEndDate: payWeek }),
        enabled: newArrivalsOpen && isSaturdayDate(payWeek),
      },
    },
  );
  const weekDeductionByOccupantId = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of deductionsQuery.data ?? []) {
      if (r.payWeekEndDate === payWeek) map.set(r.occupantId, r.weeklyAmount);
    }
    return map;
  }, [deductionsQuery.data, payWeek]);
  const newArrivals = unplacedQuery.data?.unmatched ?? [];

  const filteredOccupants = occupants.filter((o) => {
    const matchesSearch = o.name.toLowerCase().includes(search.toLowerCase());
    const matchesProperty = propertyFilter === "All" || o.propertyId === propertyFilter;
    const matchesStatus = statusFilter === "All" || o.status === statusFilter;
    const matchesMoveIn =
      moveInFilter === "All" ? true : !o.moveInDate;
    const matchesShift =
      shiftFilter === "All"
        ? true
        : shiftFilter === "Unassigned"
          ? !o.shift
          : o.shift === shiftFilter;
    const matchesChargeSource =
      chargeSourceFilter === "All"
        ? true
        : chargeSourceFilter === "manual"
          ? o.chargeSource !== "payroll"
          : o.chargeSource === "payroll";
    const matchesCustomer =
      customerScopedPropertyIds === null ||
      (o.propertyId !== null && customerScopedPropertyIds.has(o.propertyId));
    const hasWeekRow = weekDeductionByOccupantId.has(o.id);
    const matchesWeek =
      weekFilter === "All"
        ? true
        : weekFilter === "Imported"
          ? hasWeekRow
          : // "Missing" only flags Active occupants — Former rows
            // shouldn't appear in this week's payroll anyway.
            o.status === "Active" && !hasWeekRow;
    return matchesSearch && matchesProperty && matchesStatus && matchesMoveIn && matchesShift && matchesChargeSource && matchesCustomer && matchesWeek;
  });

  // Header counts honour every filter EXCEPT the week-status filter
  // itself, so toggling between Imported / Missing doesn't make the
  // banner numbers jump around.
  const weekScopedOccupants = useMemo(
    () =>
      occupants.filter((o) => {
        const matchesProperty = propertyFilter === "All" || o.propertyId === propertyFilter;
        const matchesCustomer =
          customerScopedPropertyIds === null ||
          (o.propertyId !== null && customerScopedPropertyIds.has(o.propertyId));
        return o.status === "Active" && matchesProperty && matchesCustomer;
      }),
    [occupants, propertyFilter, customerScopedPropertyIds],
  );
  const importedCount = useMemo(
    () => weekScopedOccupants.filter((o) => weekDeductionByOccupantId.has(o.id)).length,
    [weekScopedOccupants, weekDeductionByOccupantId],
  );
  const missingCount = weekScopedOccupants.length - importedCount;

  // Per-shift counts (Task #506). We tally every distinct title we see
  // on an occupant so the filter dropdown can offer one row per real
  // shift — the standard set is shown first (always, even when empty)
  // followed by any custom titles that actually appear.
  const shiftCounts = useMemo(() => {
    const counts: Record<string, number> = { Unassigned: 0 };
    for (const s of STANDARD_SHIFTS) counts[s] = 0;
    for (const o of occupants) {
      if (!o.shift) counts.Unassigned += 1;
      else counts[o.shift] = (counts[o.shift] ?? 0) + 1;
    }
    return counts;
  }, [occupants]);

  // Filter options reuse the same source-of-truth as <ShiftPicker>:
  // STANDARD_SHIFTS first, then per-customer customShifts (so seeded
  // presets like Penda/TriEnda always appear even at zero count), then
  // any orphaned shift titles still present on occupants. Scope honours
  // the active customer scope so operators only see shifts relevant to
  // the customers they're looking at.
  const shiftFilterOptions = useMemo(() => {
    const seen = new Set<string>(STANDARD_SHIFTS);
    const extras: string[] = [];
    const inScope = (c: { id: string }) =>
      customerScope === ALL_CUSTOMERS || c.id === customerScope;
    for (const c of customers) {
      if (!inScope(c)) continue;
      for (const s of c.customShifts ?? []) {
        if (s && !seen.has(s)) {
          seen.add(s);
          extras.push(s);
        }
      }
    }
    for (const o of occupants) {
      if (o.shift && !seen.has(o.shift)) {
        seen.add(o.shift);
        extras.push(o.shift);
      }
    }
    return [...STANDARD_SHIFTS, ...extras];
  }, [occupants, customers, customerScope]);

  // Excel deductions import (Task: clean-slate payroll). Uploads an
  // .xlsx file to POST /api/payroll/import-deductions for the
  // currently-selected pay-week, then invalidates the per-week
  // deductions query so the table refreshes in place.
  const queryClient = useQueryClient();
  const importFileInputRef = useRef<HTMLInputElement | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const handleImportExcelClick = () => {
    if (!isSaturdayDate(payWeek)) {
      toast({
        title: "Pick a Saturday pay-week first",
        description:
          "Use the date picker above the table to select the Saturday end-date of the pay-week before importing.",
        variant: "destructive",
      });
      return;
    }
    importFileInputRef.current?.click();
  };
  const handleImportExcelChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setIsImporting(true);
    try {
      const baseUrl = import.meta.env.BASE_URL ?? "/";
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(
        `${baseUrl}api/payroll/import-deductions?payWeekEndDate=${encodeURIComponent(payWeek)}`,
        { method: "POST", body: form },
      );
      const body = (await res.json().catch(() => ({}))) as {
        deductionsImported?: number;
        totalAmount?: number;
        unmatchedCount?: number;
        skippedRows?: number;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(body.error ?? `Import failed (${res.status}).`);
      }
      toast({
        title: "Deductions imported",
        description: `Imported ${body.deductionsImported ?? 0} deduction${
          (body.deductionsImported ?? 0) === 1 ? "" : "s"
        }${
          typeof body.totalAmount === "number"
            ? `, total ${formatUsd(body.totalAmount)}`
            : ""
        } for week of ${formatPayWeekRange(payWeek)}.${
          body.unmatchedCount ? ` ${body.unmatchedCount} row${body.unmatchedCount === 1 ? "" : "s"} didn't match an occupant.` : ""
        }${
          body.skippedRows ? ` ${body.skippedRows} row${body.skippedRows === 1 ? "" : "s"} skipped.` : ""
        }`,
      });
      await queryClient.invalidateQueries({
        queryKey: getListPayrollDeductionsQueryKey({
          since: payWeek,
          until: payWeek,
        }),
      });
      await queryClient.invalidateQueries({
        queryKey: getListUnplacedPayrollQueryKey({ payWeekEndDate: payWeek }),
      });
    } catch (err) {
      toast({
        title: "Couldn't import deductions",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setIsImporting(false);
    }
  };

  // Pull housing deductions straight from Zenople (the staffing/payroll
  // system) for the trailing year of Mon→Sat pay-weeks and feed them
  // into the same snapshot pipeline the .xlsx import uses. This is the
  // API-driven alternative to exporting a spreadsheet and uploading it,
  // and it backfills every pay-week in one click.
  const [isSyncing, setIsSyncing] = useState(false);
  const handleSyncZenople = async () => {
    setIsSyncing(true);
    try {
      const baseUrl = import.meta.env.BASE_URL ?? "/";
      const res = await fetch(
        `${baseUrl}api/payroll/sync-zenople-deductions?weeks=52`,
        { method: "POST" },
      );
      const body = (await res.json().catch(() => ({}))) as {
        weeksProcessed?: number;
        deductionsImported?: number;
        totalAmount?: number;
        unmatchedCount?: number;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(body.error ?? `Sync failed (${res.status}).`);
      }
      toast({
        title: "Synced from Zenople",
        description: `Imported ${body.deductionsImported ?? 0} deduction${
          (body.deductionsImported ?? 0) === 1 ? "" : "s"
        } across ${body.weeksProcessed ?? 0} pay-week${
          (body.weeksProcessed ?? 0) === 1 ? "" : "s"
        }${
          typeof body.totalAmount === "number"
            ? `, total ${formatUsd(body.totalAmount)}`
            : ""
        }.${
          body.unmatchedCount
            ? ` ${body.unmatchedCount} person${
                body.unmatchedCount === 1 ? "" : "s"
              } didn't match an occupant.`
            : ""
        }`,
      });
      // A bulk multi-week sync touches occupant cache rows and every
      // finance rollup, so refresh all active queries rather than a
      // single pay-week.
      await queryClient.invalidateQueries();
    } catch (err) {
      toast({
        title: "Couldn't sync from Zenople",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleDownloadCsv = () => {
    const csv = toCsv(filteredOccupants, [
      { header: "Name",              value: (o) => o.name },
      { header: "Email",             value: (o) => o.email },
      { header: "Phone",             value: (o) => o.phone },
      { header: "Company",           value: (o) => o.company },
      { header: "Employee ID",       value: (o) => o.employeeId },
      { header: "Property",          value: (o) => (o.propertyId ? properties.find((p) => p.id === o.propertyId)?.name ?? "" : "") },
      { header: "Bed",               value: (o) => {
          if (!o.bedId) return "";
          const bed = beds.find((b) => b.id === o.bedId);
          return bed ? `Bed ${bed.bedNumber}` : "";
        } },
      { header: "Move In",           value: (o) => o.moveInDate },
      { header: "Move Out",          value: (o) => o.moveOutDate ?? "" },
      { header: "Charge per Bed",    value: (o) => o.chargePerBed },
      { header: "Billing Frequency", value: (o) => o.billingFrequency },
      { header: `Deduction (week of ${payWeek})`, value: (o) => weekDeductionByOccupantId.get(o.id) ?? "" },
      { header: "Shift",             value: (o) => o.shift ?? "" },
      { header: "Status",            value: (o) => o.status },
    ]);
    downloadCsv(timestampedCsvName("housingops-occupants"), csv);
    toast({
      title: t("toasts.occupantsExportedTitle"),
      description: t("toasts.occupantsExportedDescription", { count: filteredOccupants.length }),
    });
  };

  return (
    <MainLayout>
      <div className="p-8 max-w-[1600px] mx-auto space-y-8">
        <PageHeader
          title={t("pages.occupants.title")}
          description={t("pages.occupants.description")}
          meta={
            <div
              className="flex flex-wrap items-center gap-3 mt-2"
              data-testid="pay-week-bar"
            >
              <div className="inline-flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => updatePayWeek(shiftWeeks(payWeek, -1))}
                  data-testid="button-pay-week-prev"
                  title="Previous week"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Input
                  type="date"
                  value={payWeek}
                  onChange={(e) => updatePayWeek(e.target.value)}
                  className="h-8 w-[10.5rem]"
                  data-testid="input-pay-week"
                  title="Pay-week ending Saturday"
                />
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => updatePayWeek(shiftWeeks(payWeek, 1))}
                  data-testid="button-pay-week-next"
                  title="Next week"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <span className="ml-2 text-sm text-muted-foreground" data-testid="text-pay-week-range">
                  Week of {formatPayWeekRange(payWeek)}
                </span>
              </div>
              <Badge
                variant="outline"
                className="gap-1"
                data-testid="badge-week-imported"
              >
                <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                {importedCount} imported
              </Badge>
              <Badge
                variant="outline"
                className={
                  missingCount > 0
                    ? "gap-1 border-amber-500 text-amber-700 dark:text-amber-400"
                    : "gap-1"
                }
                data-testid="badge-week-missing"
              >
                <AlertTriangle className="h-3 w-3" />
                {missingCount} missing
              </Badge>
              {!isSaturdayDate(payWeek) ? null : (
                <Popover open={newArrivalsOpen} onOpenChange={setNewArrivalsOpen}>
                  <PopoverTrigger asChild>
                    <Badge
                      variant="outline"
                      className="gap-1 cursor-pointer hover:bg-muted"
                      data-testid="badge-week-new-arrivals"
                    >
                      <UserPlus2 className="h-3 w-3" />
                      {newArrivalsOpen && unplacedQuery.isLoading
                        ? "Loading new arrivals…"
                        : newArrivalsOpen && unplacedQuery.data
                          ? `${newArrivals.length} new in import`
                          : "New in import"}
                    </Badge>
                  </PopoverTrigger>
                  <PopoverContent
                    align="start"
                    className="w-80 max-h-80 overflow-auto p-3"
                    data-testid="popover-week-new-arrivals"
                  >
                    <div className="text-sm font-medium mb-2">
                      New arrivals in week of {payWeek}
                    </div>
                    {unplacedQuery.isLoading ? (
                      <p className="text-xs text-muted-foreground">Loading…</p>
                    ) : newArrivals.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        Every name in this week's import already matches an
                        existing occupant.
                      </p>
                    ) : (
                      <>
                        <p className="text-xs text-muted-foreground mb-2">
                          These names appeared in the payroll file but don't
                          match any occupant yet. Place them from the
                          dashboard's payroll panel.
                        </p>
                        <ul className="space-y-1.5 text-sm">
                          {newArrivals.map((row) => (
                            <li
                              key={`${row.personId}-${row.name}`}
                              className="flex items-center justify-between gap-2"
                              data-testid={`row-new-arrival-${row.personId}`}
                            >
                              <span className="truncate">
                                <span className="font-medium">{row.name}</span>
                                <span className="text-muted-foreground"> · {row.customer}</span>
                              </span>
                              <span className="tabular-nums text-muted-foreground">
                                {formatUsd(row.weekly)}
                              </span>
                            </li>
                          ))}
                        </ul>
                        <div className="mt-3">
                          <Link
                            href="/dashboard"
                            className="text-xs text-primary hover:underline"
                            data-testid="link-new-arrivals-dashboard"
                          >
                            Go to dashboard to place them →
                          </Link>
                        </div>
                      </>
                    )}
                  </PopoverContent>
                </Popover>
              )}
            </div>
          }
          actions={
            <>
              <input
                ref={importFileInputRef}
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={handleImportExcelChange}
                data-testid="input-import-deductions-xlsx"
              />
              <Button
                variant="outline"
                onClick={handleImportExcelClick}
                disabled={isImporting}
                data-testid="button-import-deductions-xlsx"
                title={`Import a payroll deductions .xlsx for week of ${formatPayWeekRange(payWeek)}`}
              >
                <Upload className="mr-2 h-4 w-4" />
                {isImporting ? "Importing…" : "Import deductions (.xlsx)"}
              </Button>
              <Button
                variant="outline"
                onClick={handleSyncZenople}
                disabled={isSyncing}
                data-testid="button-sync-zenople-deductions"
                title="Pull the trailing year of housing deductions from Zenople"
              >
                <RefreshCw
                  className={`mr-2 h-4 w-4 ${isSyncing ? "animate-spin" : ""}`}
                />
                {isSyncing ? "Syncing…" : "Sync from Zenople"}
              </Button>
              <Button
                variant="outline"
                onClick={handleDownloadCsv}
                disabled={isLoading || filteredOccupants.length === 0}
                data-testid="button-download-occupants-csv"
              >
                <Download className="mr-2 h-4 w-4" />
                {t("pages.occupants.downloadCsv")}
              </Button>
              <Button
                asChild
                disabled={properties.length === 0}
                data-testid="button-add-occupant"
                title={
                  properties.length === 0
                    ? t("pages.occupants.addPropertyFirstTooltip")
                    : t("pages.occupants.addOccupantTooltip")
                }
              >
                <Link href={properties.length === 0 ? "/properties" : `/properties/${properties[0].id}`}>
                  <UserPlus className="mr-2 h-4 w-4" />
                  {t("pages.occupants.addOccupant")}
                </Link>
              </Button>
            </>
          }
        />

        <Card>
          <CardContent className="p-0">
            <div className="p-4 border-b flex flex-col sm:flex-row gap-4 items-center">
              <div className="relative w-full sm:w-72">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={t("pages.occupants.searchPlaceholder")}
                  className="pl-9"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Select value={propertyFilter} onValueChange={setPropertyFilter}>
                <SelectTrigger className="w-full sm:w-48">
                  <SelectValue placeholder={t("pages.occupants.propertyPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">{t("pages.occupants.allProperties")}</SelectItem>
                  {properties.map(p => (
                    <SelectItem key={p.id} value={p.id}>{shortPropertyName(p.name)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full sm:w-40">
                  <SelectValue placeholder={t("pages.occupants.statusPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">{t("pages.occupants.allStatuses")}</SelectItem>
                  <SelectItem value="Active">{t("pages.occupants.statusActive")}</SelectItem>
                  <SelectItem value="Former">{t("pages.occupants.statusFormer")}</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={shiftFilter}
                onValueChange={updateShiftFilter}
              >
                <SelectTrigger
                  className="w-full sm:w-44"
                  data-testid="select-shift-filter"
                >
                  <SelectValue placeholder={t("pages.occupants.shiftPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">{t("pages.occupants.allShifts")}</SelectItem>
                  {shiftFilterOptions.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s} ({shiftCounts[s] ?? 0})
                    </SelectItem>
                  ))}
                  <SelectItem value="Unassigned">{t("pages.occupants.shiftUnassigned")} ({shiftCounts.Unassigned})</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={moveInFilter}
                onValueChange={(v) => updateMoveInFilter(v as "All" | "NeedsReview")}
              >
                <SelectTrigger
                  className="w-full sm:w-44"
                  data-testid="select-move-in-filter"
                >
                  <SelectValue placeholder={t("pages.occupants.moveInPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">{t("pages.occupants.allMoveIns")}</SelectItem>
                  <SelectItem value="NeedsReview">{t("pages.occupants.needsReview")}</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={weekFilter}
                onValueChange={(v) => updateWeekFilter(v as "All" | "Imported" | "Missing")}
              >
                <SelectTrigger
                  className="w-full sm:w-44"
                  data-testid="select-week-status-filter"
                >
                  <SelectValue placeholder="This week" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All this week</SelectItem>
                  <SelectItem value="Imported">Imported</SelectItem>
                  <SelectItem value="Missing">Missing only</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={chargeSourceFilter}
                onValueChange={(v) => updateChargeSourceFilter(v as "All" | "manual" | "payroll")}
              >
                <SelectTrigger
                  className="w-full sm:w-44"
                  data-testid="select-charge-source-filter"
                >
                  <SelectValue placeholder={t("pages.occupants.chargeSourcePlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">{t("pages.occupants.allSources")}</SelectItem>
                  <SelectItem value="manual">{t("pages.occupants.sourceManual")}</SelectItem>
                  <SelectItem value="payroll">{t("pages.occupants.sourcePayroll")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("pages.occupants.table.name")}</TableHead>
                  <TableHead>{t("pages.occupants.table.title")}</TableHead>
                  <TableHead>{t("pages.occupants.table.property")}</TableHead>
                  <TableHead>{t("pages.occupants.table.bed")}</TableHead>
                  <TableHead>{t("pages.occupants.table.moveIn")}</TableHead>
                  <TableHead>{t("pages.occupants.table.shift")}</TableHead>
                  <TableHead className="text-right">{t("pages.occupants.table.weeklyDeduction")}</TableHead>
                  <TableHead className="text-right">{t("pages.occupants.table.monthlyEquivalent")}</TableHead>
                  <TableHead className="text-center">{t("pages.occupants.table.status")}</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <SkeletonRows rows={6} columns={10} />
                ) : filteredOccupants.length === 0 ? (
                  <EmptyStateRow
                    colSpan={10}
                    icon={Users}
                    title={t("pages.occupants.empty.noOccupantsFound")}
                    description={
                      occupants.length === 0
                        ? t("pages.occupants.empty.noOccupantsDescription")
                        : t("pages.occupants.empty.noMatchDescription")
                    }
                    action={
                      occupants.length === 0 ? (
                        <Button asChild data-testid="button-empty-occupants-cta">
                          <Link href={properties.length === 0 ? "/properties" : `/properties/${properties[0].id}`}>
                            {properties.length === 0 ? t("pages.occupants.empty.addProperty") : t("pages.occupants.empty.assignOccupant")}
                          </Link>
                        </Button>
                      ) : undefined
                    }
                    testId="empty-occupants-table"
                  />
                ) : (
                  filteredOccupants.map((occupant) => {
                    const property = occupant.propertyId ? properties.find(p => p.id === occupant.propertyId) : null;
                    const bed = occupant.bedId ? beds.find(b => b.id === occupant.bedId) : null;
                    
                    return (
                      <TableRow key={occupant.id}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            <span>{occupant.name}</span>
                            {occupant.language ? (
                              <Badge
                                variant="secondary"
                                className="font-normal text-xs"
                                data-testid={`badge-occupant-language-${occupant.id}`}
                                title={t("pages.occupants.languageBadgeTitle", { lang: occupant.language })}
                              >
                                {occupant.language}
                              </Badge>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell data-testid={`cell-occupant-title-${occupant.id}`}>
                          {occupant.title ? (
                            occupant.title
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>{property ? <PropertyNameCell name={property.name} /> : <span className="italic text-muted-foreground">—</span>}</TableCell>
                        <TableCell>{bed ? t("pages.occupants.bedNumberPrefix", { number: bed.bedNumber }) : "-"}</TableCell>
                        <TableCell>
                          {occupant.moveInDate ? (
                            occupant.moveInDate
                          ) : (
                            <div className="flex items-center gap-2">
                              <Badge
                                variant="outline"
                                className="border-amber-500 text-amber-700 dark:text-amber-400"
                                data-testid={`badge-move-in-needs-review-${occupant.id}`}
                              >
                                {t("pages.occupants.needsReview")}
                              </Badge>
                              <Input
                                type="date"
                                aria-label={t("pages.occupants.setMoveInDateAria", { name: occupant.name })}
                                title={t("pages.occupants.setMoveInDateTitle")}
                                className="h-7 w-36 text-xs"
                                data-testid={`input-move-in-date-${occupant.id}`}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  // Optimistic update — `updateOccupant` already
                                  // toasts on mutation failure (captureRollback),
                                  // so we deliberately don't fire a success toast
                                  // here to avoid a false-positive when the API
                                  // write later fails.
                                  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
                                    updateOccupant(occupant.id, { moveInDate: v });
                                  }
                                }}
                              />
                            </div>
                          )}
                        </TableCell>
                        <TableCell data-testid={`cell-occupant-shift-${occupant.id}`}>
                          {occupant.shift ? (
                            <Badge variant="outline" className="font-normal">{t("pages.occupants.shiftSuffix", { shift: occupant.shift })}</Badge>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell
                          className="text-right tabular-nums"
                          data-testid={`cell-occupant-weekly-${occupant.id}`}
                        >
                          {(() => {
                            // Prefer the API's computed deduction (after codegen),
                            // then the pay-week map already loaded on this page,
                            // then the occupant's manual chargePerBed.
                            const ded = (occupant as { deduction?: { weeklyAmount?: number; source?: string } }).deduction;
                            const mapAmt = weekDeductionByOccupantId.get(occupant.id);
                            const weekly =
                              ded?.weeklyAmount ??
                              mapAmt ??
                              (occupant as { chargePerBed?: number }).chargePerBed ??
                              null;
                            const zStatus = (occupant as { zenopleStatus?: string }).zenopleStatus;
                            // Former occupants with nothing to recover stay quiet.
                            if (occupant.status !== "Active" && !weekly) {
                              return <span className="text-muted-foreground">—</span>;
                            }
                            return (
                              <div
                                className="flex justify-end"
                                data-testid={`badge-occupant-week-${occupant.id}`}
                              >
                                <DeductionBadge
                                  weeklyAmount={weekly}
                                  zenopleStatus={zStatus}
                                  source={ded?.source}
                                />
                              </div>
                            );
                          })()}
                        </TableCell>
                        <TableCell
                          className="text-right tabular-nums text-muted-foreground"
                          data-testid={`cell-occupant-monthly-${occupant.id}`}
                          title={t("pages.occupants.monthlyEquivalentTitle")}
                        >
                          {(() => {
                            const amt = weekDeductionByOccupantId.get(occupant.id);
                            return amt !== undefined ? formatUsd(amt * WEEKS_PER_MONTH) : "—";
                          })()}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant={occupant.status === "Active" ? "default" : "secondary"}>
                            {occupant.status === "Active" ? t("pages.occupants.statusActive") : t("pages.occupants.statusFormer")}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1">
                            <MoveOccupantDialog
                              occupant={occupant}
                              testIdSuffix={occupant.id}
                            />
                            <ConfirmDeleteButton
                              title={t("pages.occupants.deleteOccupantConfirmTitle", { name: occupant.name })}
                              description={t("pages.occupants.deleteOccupantConfirmDescription")}
                              onConfirm={() => deleteOccupant(occupant.id)}
                              testId={`dialog-confirm-delete-occupant-${occupant.id}`}
                              trigger={
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                  data-testid={`button-delete-occupant-${occupant.id}`}
                                  title={t("pages.occupants.deleteOccupantTitle")}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              }
                            />
                          </div>
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
    </MainLayout>
  );
}
