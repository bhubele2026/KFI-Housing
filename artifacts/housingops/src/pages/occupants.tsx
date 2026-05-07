import { useEffect, useState } from "react";
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
import { Search, UserPlus, Download, Users, Trash2 } from "lucide-react";
import { EmptyStateRow } from "@/components/empty-state";
import { SkeletonRows } from "@/components/skeleton-rows";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import { useToast } from "@/hooks/use-toast";
import { toCsv, downloadCsv, timestampedCsvName } from "@/lib/csv";
import { toWeeklyCharge, toMonthlyCharge, formatUsd, STANDARD_SHIFTS } from "@/data/mockData";
import { ALL_CUSTOMERS, useCustomerScope } from "@/context/customer-scope";
import { useMemo } from "react";

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
    return matchesSearch && matchesProperty && matchesStatus && matchesMoveIn && matchesShift && matchesChargeSource && matchesCustomer;
  });

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
      <div className="p-8 max-w-7xl mx-auto space-y-8">
        <PageHeader
          title={t("pages.occupants.title")}
          description={t("pages.occupants.description")}
          actions={
            <>
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
                          {formatUsd(
                            toWeeklyCharge(
                              occupant.chargePerBed,
                              occupant.billingFrequency ?? "Monthly",
                            ),
                          )}
                        </TableCell>
                        <TableCell
                          className="text-right tabular-nums text-muted-foreground"
                          data-testid={`cell-occupant-monthly-${occupant.id}`}
                          title={t("pages.occupants.monthlyEquivalentTitle")}
                        >
                          {formatUsd(
                            toMonthlyCharge(
                              occupant.chargePerBed,
                              occupant.billingFrequency ?? "Monthly",
                            ),
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant={occupant.status === "Active" ? "default" : "secondary"}>
                            {occupant.status === "Active" ? t("pages.occupants.statusActive") : t("pages.occupants.statusFormer")}
                          </Badge>
                        </TableCell>
                        <TableCell>
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
