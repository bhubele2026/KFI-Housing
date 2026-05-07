import { useEffect, useMemo } from "react";
import { useLocation, useSearch } from "wouter";
import { MainLayout } from "@/components/layout/main-layout";
import { PageHeader } from "@/components/layout/page-header";
import { getRenewalInfo, sortLeases } from "@/data/mockData";
import { useData } from "@/context/data-store";
import { ALL_CUSTOMERS, useCustomerScope } from "@/context/customer-scope";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, ChevronRight, Calendar, CalendarPlus, Briefcase, X, Download, Rows3, Users, Hotel, CalendarClock } from "lucide-react";
import { useListRoomNightLogs } from "@workspace/api-client-react";
import { getHotelRateMonthRisk, currentMonthKey } from "@/lib/hotel-rate-status";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { motion } from "framer-motion";
import { RenewLeasePopover } from "@/components/renew-lease-popover";
import { useToast } from "@/hooks/use-toast";
import { toCsv, downloadCsv, timestampedCsvName } from "@/lib/csv";
import { LeasesTable } from "@/components/leases-table";
import { AddLeaseDialog } from "@/components/add-lease-dialog";
import { UploadLeasePdfDialog } from "@/components/upload-lease-pdf-dialog";
import { ImportMasterLeasesButton } from "@/components/import-master-leases-button";
import { LastAutoImportIndicator } from "@/components/last-auto-import-indicator";
import { useState } from "react";

// Buyout filter values. "All" lets every lease through; "Yes" / "No" map
// directly onto the lease's `buyoutAvailable` flag. Kept narrow so a
// regression that introduces a new option also has to teach the filter
// what to do with it.
type BuyoutFilter = "All" | "Yes" | "No";

type NeedsReviewFilter = "All" | "NeedsReview";

type AtRiskFilter = "All" | "AtRisk";

type NeedsDatesFilter = "All" | "NeedsDates";

// Customer-pays filter values. "All" lets every lease through; "Yes" / "No"
// map to the lease's `customerResponsibleForRent` flag (task #313). Kept
// narrow so a regression that introduces a new option also has to teach
// the filter what to do with it.
type CustomerResponsibleFilter = "All" | "Yes" | "No";

type ViewMode = "flat" | "by-customer";

export default function Leases() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState("All");
  const [buyoutFilter, setBuyoutFilter] = useState<BuyoutFilter>("All");
  const [viewMode, setViewMode] = useState<ViewMode>("flat");
  // URL-driven so the dashboard "Needs review" tile can deep-link straight
  // to the subset of leases missing an end date (`?needsReview=1`), mirroring
  // the pattern in occupants.tsx.
  const searchString = useSearch();
  const [needsReviewFilter, setNeedsReviewFilter] = useState<NeedsReviewFilter>(
    () =>
      new URLSearchParams(searchString).get("needsReview") === "1"
        ? "NeedsReview"
        : "All",
  );
  useEffect(() => {
    const next: NeedsReviewFilter =
      new URLSearchParams(searchString).get("needsReview") === "1"
        ? "NeedsReview"
        : "All";
    setNeedsReviewFilter((prev) => (prev === next ? prev : next));
  }, [searchString]);
  const updateNeedsReviewFilter = (value: NeedsReviewFilter) => {
    setNeedsReviewFilter(value);
    const params = new URLSearchParams(window.location.search);
    if (value === "NeedsReview") params.set("needsReview", "1");
    else params.delete("needsReview");
    const qs = params.toString();
    navigate(qs ? `/leases?${qs}` : "/leases", { replace: true });
  };
  // URL-driven so the dashboard hotel-rate "at risk" tile can deep-link
  // straight to the matching rows (`?atRisk=1`), mirroring the
  // needsReview pattern above.
  const [atRiskFilter, setAtRiskFilter] = useState<AtRiskFilter>(
    () =>
      new URLSearchParams(searchString).get("atRisk") === "1"
        ? "AtRisk"
        : "All",
  );
  useEffect(() => {
    const next: AtRiskFilter =
      new URLSearchParams(searchString).get("atRisk") === "1"
        ? "AtRisk"
        : "All";
    setAtRiskFilter((prev) => (prev === next ? prev : next));
  }, [searchString]);
  const updateAtRiskFilter = (value: AtRiskFilter) => {
    setAtRiskFilter(value);
    const params = new URLSearchParams(window.location.search);
    if (value === "AtRisk") params.set("atRisk", "1");
    else params.delete("atRisk");
    const qs = params.toString();
    navigate(qs ? `/leases?${qs}` : "/leases", { replace: true });
  };
  // URL-driven so any future dashboard tile can deep-link straight to
  // blank-date triage rows (`?needsDates=1`), mirroring the needsReview
  // pattern above. Task #363.
  const [needsDatesFilter, setNeedsDatesFilter] = useState<NeedsDatesFilter>(
    () =>
      new URLSearchParams(searchString).get("needsDates") === "1"
        ? "NeedsDates"
        : "All",
  );
  useEffect(() => {
    const next: NeedsDatesFilter =
      new URLSearchParams(searchString).get("needsDates") === "1"
        ? "NeedsDates"
        : "All";
    setNeedsDatesFilter((prev) => (prev === next ? prev : next));
  }, [searchString]);
  const updateNeedsDatesFilter = (value: NeedsDatesFilter) => {
    setNeedsDatesFilter(value);
    const params = new URLSearchParams(window.location.search);
    if (value === "NeedsDates") params.set("needsDates", "1");
    else params.delete("needsDates");
    const qs = params.toString();
    navigate(qs ? `/leases?${qs}` : "/leases", { replace: true });
  };
  // URL-driven so other surfaces (e.g. the customer page "Customer pays"
  // rollup) can deep-link straight to the matching rows
  // (`?customerResponsible=1` for Yes, `=0` for No), mirroring the
  // needsReview pattern above.
  const [customerResponsibleFilter, setCustomerResponsibleFilter] =
    useState<CustomerResponsibleFilter>(() => {
      const v = new URLSearchParams(searchString).get("customerResponsible");
      return v === "1" ? "Yes" : v === "0" ? "No" : "All";
    });
  useEffect(() => {
    const v = new URLSearchParams(searchString).get("customerResponsible");
    const next: CustomerResponsibleFilter =
      v === "1" ? "Yes" : v === "0" ? "No" : "All";
    setCustomerResponsibleFilter((prev) => (prev === next ? prev : next));
  }, [searchString]);
  const updateCustomerResponsibleFilter = (value: CustomerResponsibleFilter) => {
    setCustomerResponsibleFilter(value);
    const params = new URLSearchParams(window.location.search);
    if (value === "Yes") params.set("customerResponsible", "1");
    else if (value === "No") params.set("customerResponsible", "0");
    else params.delete("customerResponsible");
    const qs = params.toString();
    navigate(qs ? `/leases?${qs}` : "/leases", { replace: true });
  };
  const { customerId: customerFilter, setCustomerId: updateCustomerFilter } =
    useCustomerScope();
  const { leases, properties, customers, updateLease, addLease, deleteLease } = useData();
  // Room-night logs power the hotel-rate "at risk this month" tile and
  // the per-row "Below min / No log yet" pill on the leases table. The
  // hook always returns a stable array (or undefined while loading) — no
  // need to gate further interactions on its readiness.
  const roomNightLogsQuery = useListRoomNightLogs();
  const roomNightLogs = useMemo(
    () => roomNightLogsQuery.data ?? [],
    [roomNightLogsQuery.data],
  );
  // When the PDF import fails (parse/AI error), we hand off to the manual
  // Add Lease dialog so the user can keep going without re-clicking.
  const [pdfFallbackOpen, setPdfFallbackOpen] = useState(false);

  // Anchor month for hotel-rate "at risk" checks. Computed once per
  // render so the filter, the tile, and the row badges all agree on
  // the same calendar month even across midnight.
  const currentMonth = currentMonthKey();

  const customerById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of customers) map.set(c.id, c.name);
    return map;
  }, [customers]);

  const propertyById = useMemo(() => {
    const map = new Map(properties.map((p) => [p.id, p] as const));
    return map;
  }, [properties]);

  const filteredLeases = useMemo(
    () =>
      // Blank-date rows come first regardless of status so operators see
      // the triage queue (task #363) at the top of the list. Within each
      // bucket the existing sortLeases ordering (Active > Upcoming >
      // Expired, then newest end date) still applies.
      ((rows) => {
        const missing = rows.filter((l) => !l.startDate || !l.endDate);
        const dated = rows.filter((l) => l.startDate && l.endDate);
        return [...sortLeases(missing), ...sortLeases(dated)];
      })(
      leases.filter((l) => {
          const matchesStatus = statusFilter === "All" || l.status === statusFilter;
          if (!matchesStatus) return false;
          // Buyout filter is independent of status — operators triaging
          // "which leases let the tenant exit early" should see hits across
          // every status group at once.
          if (buyoutFilter !== "All") {
            const hasBuyout = l.buyoutAvailable ?? false;
            if (buyoutFilter === "Yes" && !hasBuyout) return false;
            if (buyoutFilter === "No" && hasBuyout) return false;
          }
          // Needs review = the master importer flagged this row's source
          // cell as ambiguous (TBD, n/a, "$69.23???", descriptive prose,
          // etc.) and set `lease.needsReview = true`. Operators triaging
          // import quality use this to find the exact rows that need a
          // weekly cost / vendor cleanup pass.
          if (needsReviewFilter === "NeedsReview" && !l.needsReview) return false;
          // Customer-pays filter (task #335) — narrows to leases where
          // the tenant customer is on the hook for rent, or explicitly
          // not. Booleans only — `undefined` (legacy / unannotated rows)
          // are treated as "not customer-paid" so a "Yes" filter never
          // surprises operators with rows that have no badge.
          if (customerResponsibleFilter !== "All") {
            const isCustomerPaid = l.customerResponsibleForRent === true;
            if (customerResponsibleFilter === "Yes" && !isCustomerPaid) return false;
            if (customerResponsibleFilter === "No" && isCustomerPaid) return false;
          }
          // Blank-date triage filter (task #363) — surfaces just the rows
          // whose `startDate` or `endDate` is empty, so operators can work
          // through them without hunting for missing cells.
          if (needsDatesFilter === "NeedsDates" && l.startDate && l.endDate) return false;
          // At-risk = hotel-rate lease whose current month is missing a
          // log or below the negotiated minimum. Mirrors the same check
          // powering the tile above and the dashboard counter.
          if (atRiskFilter === "AtRisk") {
            if (l.status !== "Active" && l.status !== "Upcoming") return false;
            if (getHotelRateMonthRisk(l, roomNightLogs, currentMonth) === null) return false;
          }
          if (customerFilter === ALL_CUSTOMERS) return true;
          // Lease's tenant: explicit `lease.customerId` (set on shared-
          // housing leases — task #295) takes precedence over the
          // property's primary customerId so a Trienda lease against a
          // Ridge Motor Inn property primarily owned by Penda still
          // matches the Trienda customer filter.
          const property = propertyById.get(l.propertyId);
          const tenantId =
            (l.customerId && l.customerId.length > 0
              ? l.customerId
              : property?.customerId) ?? "";
          return tenantId === customerFilter;
        }),
      ),
    [leases, statusFilter, buyoutFilter, needsReviewFilter, needsDatesFilter, atRiskFilter, customerResponsibleFilter, customerFilter, propertyById, roomNightLogs, currentMonth],
  );

  // Placeholder rows: every property in the active customer scope that has no
  // lease records yet. Rendered only on the unfiltered Status view because a
  // placeholder row has no status to filter on — restricting them to the
  // "All Statuses" view keeps the count next to the dropdown honest.
  const placeholderProperties = useMemo(() => {
    const propertiesWithAnyLease = new Set(leases.map((l) => l.propertyId));
    const scoped = properties.filter((p) =>
      customerFilter === ALL_CUSTOMERS ? true : p.customerId === customerFilter,
    );
    return scoped
      .filter((p) => !propertiesWithAnyLease.has(p.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [properties, leases, customerFilter]);

  // Placeholders represent properties with no lease at all, so any
  // value-based filter on a lease (status, buyout, needs-review) also has
  // no rows to attach them to — hide them whenever any of those filters
  // are narrowing the lease list. Showing them anyway would make the
  // filtered count next to the dropdown misleading.
  const showPlaceholders =
    statusFilter === "All" &&
    buyoutFilter === "All" &&
    needsReviewFilter === "All" &&
    needsDatesFilter === "All" &&
    atRiskFilter === "All" &&
    customerResponsibleFilter === "All";
  const visiblePlaceholderProperties = showPlaceholders ? placeholderProperties : [];

  // By-customer view: one group per customer with ≥1 Active lease in
  // the filtered scope. Active-only on expand, per the task brief.
  const customerGroups = useMemo(() => {
    const map = new Map<
      string,
      {
        customerId: string;
        customerName: string;
        leases: typeof filteredLeases;
        activeCount: number;
      }
    >();
    for (const lease of filteredLeases) {
      const property = propertyById.get(lease.propertyId);
      if (!property) continue;
      // Tenant resolution: explicit `lease.customerId` wins over the
      // property's primary customerId. This is how shared-housing
      // leases (task #295 — Penda + Trienda Ridge Motor Inn) surface
      // one lease under each tenant on the by-customer view.
      const tenantId =
        lease.customerId && lease.customerId.length > 0
          ? lease.customerId
          : property.customerId;
      const name = customerById.get(tenantId);
      if (!name) continue;
      let group = map.get(tenantId);
      if (!group) {
        group = {
          customerId: tenantId,
          customerName: name,
          leases: [],
          activeCount: 0,
        };
        map.set(tenantId, group);
      }
      if (lease.status === "Active") {
        (group.leases as typeof filteredLeases) = [
          ...group.leases,
          lease,
        ];
        group.activeCount += 1;
      }
    }
    return [...map.values()]
      .filter((g) => g.activeCount > 0)
      .sort((a, b) => a.customerName.localeCompare(b.customerName));
  }, [filteredLeases, propertyById, customerById]);

  // Renewal alerts: leases that are Active or Upcoming and either expired or expire within 90 days
  const renewalAlerts = leases
    .filter((l) => l.status === "Active" || l.status === "Upcoming")
    .filter((l) => {
      if (customerFilter === ALL_CUSTOMERS) return true;
      const property = propertyById.get(l.propertyId);
      const tenantId =
        (l.customerId && l.customerId.length > 0
          ? l.customerId
          : property?.customerId) ?? "";
      return tenantId === customerFilter;
    })
    .map((l) => ({ lease: l, info: getRenewalInfo(l.endDate) }))
    .filter((row): row is { lease: typeof row.lease; info: NonNullable<typeof row.info> } => row.info !== null && row.info.level !== "ok")
    .sort((a, b) => a.info.days - b.info.days);

  // Hotel-rate "at risk this month" — every hotel-rate lease in the
  // current customer scope whose current calendar month either has no
  // log yet or logged fewer nights than the agreement's minimum. This
  // is the dashboard-style summary the leases page surfaces in a single
  // tile so operators don't have to open each lease detail page (task
  // #319). Only Active / Upcoming leases count — Expired ones can't
  // void a rate that no longer applies.
  const hotelRateAtRisk = useMemo(() => {
    return leases
      .filter((l) => l.status === "Active" || l.status === "Upcoming")
      .filter((l) => {
        if (customerFilter === ALL_CUSTOMERS) return true;
        const property = propertyById.get(l.propertyId);
        const tenantId =
          (l.customerId && l.customerId.length > 0
            ? l.customerId
            : property?.customerId) ?? "";
        return tenantId === customerFilter;
      })
      .map((lease) => {
        const risk = getHotelRateMonthRisk(lease, roomNightLogs, currentMonth);
        return risk ? { lease, risk } : null;
      })
      .filter((row): row is { lease: typeof leases[number]; risk: NonNullable<ReturnType<typeof getHotelRateMonthRisk>> } => row !== null);
  }, [leases, customerFilter, propertyById, roomNightLogs, currentMonth]);

  const activeCustomerName =
    customerFilter === ALL_CUSTOMERS ? null : customerById.get(customerFilter) ?? null;

  const handleDownloadCsv = () => {
    const csv = toCsv(filteredLeases, [
      { header: "Property",         value: (l) => propertyById.get(l.propertyId)?.name ?? "Unknown" },
      { header: "Customer",         value: (l) => {
          const property = propertyById.get(l.propertyId);
          return property ? customerById.get(property.customerId) ?? "" : "";
        } },
      { header: "Start Date",       value: (l) => l.startDate },
      { header: "End Date",         value: (l) => l.endDate },
      { header: "Days Left",        value: (l) => getRenewalInfo(l.endDate)?.days ?? "" },
      { header: "Monthly Rent",     value: (l) => l.monthlyRent },
      { header: "Security Deposit", value: (l) => l.securityDeposit },
      { header: "Status",           value: (l) => l.status },
      { header: "Notes",            value: (l) => l.notes },
    ]);
    downloadCsv(timestampedCsvName("housingops-leases"), csv);
    toast({
      title: "Leases exported",
      description: `Downloaded ${filteredLeases.length} ${filteredLeases.length === 1 ? "lease" : "leases"} as CSV.`,
    });
  };

  return (
    <MainLayout>
      <div className="p-8 max-w-7xl mx-auto space-y-8">
        <PageHeader
          title="Leases"
          description="Manage master lease agreements"
          actions={
            <>
              <Button
                variant="outline"
                onClick={handleDownloadCsv}
                disabled={filteredLeases.length === 0}
                data-testid="button-download-leases-csv"
              >
                <Download className="mr-2 h-4 w-4" />
                Download CSV
              </Button>
              <UploadLeasePdfDialog onPdfImportFailed={() => setPdfFallbackOpen(true)} />
              <LastAutoImportIndicator />
              <ImportMasterLeasesButton />
              <AddLeaseDialog
                properties={properties}
                customers={customers}
                onAdd={(lease) => {
                  addLease(lease);
                  const property = propertyById.get(lease.propertyId);
                  toast({
                    title: "Lease added",
                    description: property
                      ? `Added a new lease for ${property.name}.`
                      : "New lease created.",
                  });
                }}
              />
            </>
          }
        />
        {/* Controlled-open instance used as a fallback when the PDF import flow fails. */}
        <AddLeaseDialog
          properties={properties}
          customers={customers}
          open={pdfFallbackOpen}
          onOpenChange={setPdfFallbackOpen}
          onAdd={(lease) => {
            addLease(lease);
            const property = propertyById.get(lease.propertyId);
            toast({
              title: "Lease added",
              description: property
                ? `Added a new lease for ${property.name}.`
                : "New lease created.",
            });
          }}
        />

        {(activeCustomerName || atRiskFilter === "AtRisk" || needsDatesFilter === "NeedsDates") && (
          <div className="flex flex-wrap items-center gap-2">
            {activeCustomerName && (
              <Badge variant="secondary" className="gap-1.5 px-2 py-1" data-testid="badge-customer-filter">
                <Briefcase className="h-3 w-3" />
                Filtered by customer: <span className="font-semibold">{activeCustomerName}</span>
                <button
                  type="button"
                  onClick={() => updateCustomerFilter(ALL_CUSTOMERS)}
                  className="ml-1 rounded-sm p-0.5 hover:bg-background/40"
                  aria-label="Clear customer filter"
                  data-testid="button-clear-customer-filter"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            )}
            {needsDatesFilter === "NeedsDates" && (
              <Badge
                variant="secondary"
                className="gap-1.5 px-2 py-1 bg-amber-100 text-amber-900 hover:bg-amber-100"
                data-testid="badge-needs-dates-filter"
              >
                <CalendarClock className="h-3 w-3" />
                Missing dates
                <button
                  type="button"
                  onClick={() => updateNeedsDatesFilter("All")}
                  className="ml-1 rounded-sm p-0.5 hover:bg-background/40"
                  aria-label="Clear missing-dates filter"
                  data-testid="button-clear-needs-dates-filter"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            )}
            {atRiskFilter === "AtRisk" && (
              <Badge
                variant="secondary"
                className="gap-1.5 px-2 py-1 bg-rose-100 text-rose-900 hover:bg-rose-100"
                data-testid="badge-at-risk-filter"
              >
                <Hotel className="h-3 w-3" />
                Hotel-rate at risk this month
                <button
                  type="button"
                  onClick={() => updateAtRiskFilter("All")}
                  className="ml-1 rounded-sm p-0.5 hover:bg-background/40"
                  aria-label="Clear at-risk filter"
                  data-testid="button-clear-at-risk-filter"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            )}
          </div>
        )}

        {hotelRateAtRisk.length > 0 && (
          <Card
            className="border-rose-200 bg-rose-50/40"
            data-testid="card-hotel-rate-at-risk"
          >
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="p-1.5 rounded-md bg-rose-100">
                  <Hotel className="h-4 w-4 text-rose-700" />
                </div>
                <div>
                  <h2 className="text-base font-semibold">
                    Hotel-rate at risk this month
                  </h2>
                  <p
                    className="text-xs text-muted-foreground"
                    data-testid="text-hotel-rate-at-risk-summary"
                  >
                    {hotelRateAtRisk.length} hotel-rate lease
                    {hotelRateAtRisk.length === 1 ? "" : "s"} below minimum or
                    missing a {currentMonth} room-night log.
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                {hotelRateAtRisk.map(({ lease, risk }) => {
                  const property = propertyById.get(lease.propertyId);
                  return (
                    <button
                      key={lease.id}
                      type="button"
                      onClick={() =>
                        navigate(`/leases/${lease.id}?from=${encodeURIComponent("/leases")}`)
                      }
                      className="text-left bg-white rounded-md border border-rose-200/70 p-3 hover:shadow-sm transition-all"
                      data-testid={`tile-hotel-rate-at-risk-${lease.id}`}
                    >
                      <p className="font-semibold text-sm truncate">
                        {property?.name ?? "Unknown property"}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {risk.kind === "missing"
                          ? `No log for ${currentMonth} · min ${risk.monthlyMin}/mo`
                          : `${risk.latestNights}/${risk.monthlyMin} nights this month`}
                      </p>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {renewalAlerts.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
            <Card className="border-amber-200 bg-amber-50/40">
              <CardContent className="p-5">
                <div className="flex items-center gap-2 mb-4">
                  <div className="p-1.5 rounded-md bg-amber-100">
                    <AlertTriangle className="h-4 w-4 text-amber-700" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold">Renewal Alerts</h2>
                    <p className="text-xs text-muted-foreground">
                      {renewalAlerts.length} lease{renewalAlerts.length !== 1 ? "s" : ""} expiring within 90 days or already past
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {renewalAlerts.map(({ lease, info }) => {
                    const property = properties.find((p) => p.id === lease.propertyId);
                    const customer = property ? customers.find((c) => c.id === property.customerId) : undefined;
                    return (
                      <motion.div
                        key={lease.id}
                        whileHover={{ y: -2 }}
                        onClick={() => property && navigate(`/properties/${property.id}`)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if ((e.key === "Enter" || e.key === " ") && property) {
                            e.preventDefault();
                            navigate(`/properties/${property.id}`);
                          }
                        }}
                        className={`cursor-pointer text-left bg-white rounded-lg border ${info.rowAccentClass.replace("border-l-4", "border-l-[3px]")} p-3 hover:shadow-md transition-all group`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-semibold text-sm truncate">{property?.name ?? "Unknown property"}</p>
                            {customer && (
                              <p className="text-[11px] text-muted-foreground truncate mt-0.5">{customer.name}</p>
                            )}
                            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                              <Calendar className="h-3 w-3" />
                              ends {lease.endDate}
                            </p>
                          </div>
                          <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5" />
                        </div>
                        <div className="flex items-center justify-between mt-2.5 gap-2">
                          <Badge variant="outline" className={`text-[11px] font-medium ${info.badgeClass}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${info.dotClass} mr-1.5 inline-block`} />
                            {info.label}
                          </Badge>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-xs font-medium text-muted-foreground">${lease.monthlyRent.toLocaleString()}/mo</span>
                            <RenewLeasePopover
                              currentEndDate={lease.endDate}
                              currentStatus={lease.status}
                              propertyName={property?.name}
                              onRenew={(newEndDate, newStatus) =>
                                updateLease(lease.id, {
                                  endDate: newEndDate,
                                  status: newStatus,
                                })
                              }
                              trigger={
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 px-2 text-xs gap-1"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <CalendarPlus className="h-3 w-3" />
                                  Renew
                                </Button>
                              }
                            />
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}

        <Card>
          <CardContent className="p-0">
            <div className="p-4 border-b flex flex-col sm:flex-row gap-2 items-stretch sm:items-center justify-between">
              <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                <Select value={customerFilter} onValueChange={updateCustomerFilter}>
                  <SelectTrigger className="w-full sm:w-56" data-testid="select-customer-filter">
                    <SelectValue placeholder="Customer" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_CUSTOMERS}>All Customers</SelectItem>
                    {customers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-full sm:w-48" data-testid="select-status-filter">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="All">All Statuses</SelectItem>
                    <SelectItem value="Active">Active</SelectItem>
                    <SelectItem value="Expired">Expired</SelectItem>
                    <SelectItem value="Upcoming">Upcoming</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={buyoutFilter}
                  onValueChange={(v) => setBuyoutFilter(v as BuyoutFilter)}
                >
                  <SelectTrigger
                    className="w-full sm:w-48"
                    data-testid="select-buyout-filter"
                  >
                    <SelectValue placeholder="Buyout" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="All">Any Buyout</SelectItem>
                    <SelectItem value="Yes">Buyout available</SelectItem>
                    <SelectItem value="No">No buyout</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={customerResponsibleFilter}
                  onValueChange={(v) =>
                    updateCustomerResponsibleFilter(v as CustomerResponsibleFilter)
                  }
                >
                  <SelectTrigger
                    className="w-full sm:w-44"
                    data-testid="select-customer-responsible-filter"
                  >
                    <SelectValue placeholder="Customer pays" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="All">Any payer</SelectItem>
                    <SelectItem value="Yes">Customer pays</SelectItem>
                    <SelectItem value="No">Not customer-paid</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={needsReviewFilter}
                  onValueChange={(v) =>
                    updateNeedsReviewFilter(v as NeedsReviewFilter)
                  }
                >
                  <SelectTrigger
                    className="w-full sm:w-44"
                    data-testid="select-needs-review-filter"
                  >
                    <SelectValue placeholder="Needs review" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="All">All Leases</SelectItem>
                    <SelectItem value="NeedsReview">Needs review</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={needsDatesFilter}
                  onValueChange={(v) =>
                    updateNeedsDatesFilter(v as NeedsDatesFilter)
                  }
                >
                  <SelectTrigger
                    className="w-full sm:w-44"
                    data-testid="select-needs-dates-filter"
                  >
                    <SelectValue placeholder="Missing dates" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="All">All Leases</SelectItem>
                    <SelectItem value="NeedsDates">Missing dates</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={atRiskFilter}
                  onValueChange={(v) => updateAtRiskFilter(v as AtRiskFilter)}
                >
                  <SelectTrigger
                    className="w-full sm:w-52"
                    data-testid="select-at-risk-filter"
                  >
                    <SelectValue placeholder="Hotel-rate risk" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="All">All Leases</SelectItem>
                    <SelectItem value="AtRisk">At risk this month</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-3">
                <div
                  className="inline-flex rounded-md border bg-background p-0.5"
                  role="group"
                  aria-label="Lease view mode"
                  data-testid="leases-view-toggle"
                >
                  <Button
                    type="button"
                    size="sm"
                    variant={viewMode === "flat" ? "default" : "ghost"}
                    aria-pressed={viewMode === "flat"}
                    onClick={() => setViewMode("flat")}
                    className="h-7 gap-1 px-2 text-xs"
                    data-testid="button-view-mode-flat"
                  >
                    <Rows3 className="h-3.5 w-3.5" />
                    All
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={viewMode === "by-customer" ? "default" : "ghost"}
                    aria-pressed={viewMode === "by-customer"}
                    onClick={() => setViewMode("by-customer")}
                    className="h-7 gap-1 px-2 text-xs"
                    data-testid="button-view-mode-by-customer"
                  >
                    <Users className="h-3.5 w-3.5" />
                    By customer
                  </Button>
                </div>
                <span className="text-xs text-muted-foreground">
                  {filteredLeases.length} of {leases.length} lease{leases.length === 1 ? "" : "s"}
                  {visiblePlaceholderProperties.length > 0 && (
                    <span className="ml-2" data-testid="text-placeholder-count">
                      + {visiblePlaceholderProperties.length} propert
                      {visiblePlaceholderProperties.length === 1 ? "y" : "ies"} without a lease
                    </span>
                  )}
                </span>
              </div>
            </div>

            {/*
              Columns mirror the per-property Leases tab exactly (Property,
              Start, End, Monthly Rent, Security Deposit, Status, Notes) so
              the two surfaces stay in lockstep. Customer-level filtering is
              still available via the dropdown above and the "Filtered by
              customer" badge — no separate Customer column is needed here.
            */}
            {viewMode === "flat" ? (
              <LeasesTable
                leases={filteredLeases}
                properties={properties}
                customers={customers}
                showProperty
                onPropertyClick={(propertyId) => navigate(`/properties/${propertyId}`)}
                onDelete={deleteLease}
                onMarkReviewed={(leaseId) => {
                  updateLease(leaseId, { needsReview: false });
                  toast({
                    title: "Marked as reviewed",
                    description: "The 'Needs review' flag has been cleared.",
                  });
                }}
                onBulkMarkReviewed={(ids) => {
                  for (const id of ids) {
                    updateLease(id, { needsReview: false });
                  }
                  toast({
                    title: `Marked ${ids.length} as reviewed`,
                    description: `Cleared the 'Needs review' flag on ${ids.length} ${
                      ids.length === 1 ? "lease" : "leases"
                    }.`,
                  });
                }}
                placeholderProperties={visiblePlaceholderProperties}
                roomNightLogs={roomNightLogs}
                emptyAction={
                  leases.length === 0 ? (
                    <AddLeaseDialog
                      properties={properties}
                      customers={customers}
                      onAdd={(lease) => {
                        addLease(lease);
                        const property = propertyById.get(lease.propertyId);
                        toast({
                          title: "Lease added",
                          description: property
                            ? `Added a new lease for ${property.name}.`
                            : "New lease created.",
                        });
                      }}
                    />
                  ) : undefined
                }
                // Threaded so the lease detail back-link returns to /leases
                // (with our customer/status filters preserved by the URL).
                // Placeholder rows use the same value to thread `&from=`
                // through to the create page (`/leases/new?propertyId=…`).
                originPath="/leases"
              />
            ) : customerGroups.length === 0 ? (
              <div
                className="p-8 text-center text-sm text-muted-foreground"
                data-testid="leases-by-customer-empty"
              >
                No customer has an Active lease in the current filter scope.
              </div>
            ) : (
              <Accordion
                type="multiple"
                className="px-2"
                data-testid="leases-by-customer-accordion"
              >
                {customerGroups.map((group) => (
                  <AccordionItem
                    key={group.customerId}
                    value={group.customerId}
                    data-testid={`accordion-customer-${group.customerId}`}
                  >
                    <AccordionTrigger
                      className="px-2"
                      data-testid={`accordion-customer-trigger-${group.customerId}`}
                    >
                      <span className="flex items-center gap-2">
                        <span className="font-medium">{group.customerName}</span>
                        <Badge
                          variant="secondary"
                          className="text-[11px] font-medium"
                          data-testid={`badge-customer-active-count-${group.customerId}`}
                        >
                          {group.activeCount} Active
                        </Badge>
                      </span>
                    </AccordionTrigger>
                    <AccordionContent
                      data-testid={`accordion-customer-content-${group.customerId}`}
                    >
                      <LeasesTable
                        leases={group.leases}
                        properties={properties}
                        customers={customers}
                        showProperty
                        onPropertyClick={(propertyId) =>
                          navigate(`/properties/${propertyId}`)
                        }
                        onDelete={deleteLease}
                        onMarkReviewed={(leaseId) => {
                          updateLease(leaseId, { needsReview: false });
                          toast({
                            title: "Marked as reviewed",
                            description: "The 'Needs review' flag has been cleared.",
                          });
                        }}
                        onBulkMarkReviewed={(ids) => {
                          for (const id of ids) {
                            updateLease(id, { needsReview: false });
                          }
                          toast({
                            title: `Marked ${ids.length} as reviewed`,
                            description: `Cleared the 'Needs review' flag on ${ids.length} ${
                              ids.length === 1 ? "lease" : "leases"
                            }.`,
                          });
                        }}
                        roomNightLogs={roomNightLogs}
                        originPath="/leases"
                      />
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            )}
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
