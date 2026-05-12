import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { MainLayout } from "@/components/layout/main-layout";
import { PageHeader } from "@/components/layout/page-header";
import { useData, CustomerInUseError } from "@/context/data-store";
import {
  type Customer,
  toMonthlyCharge,
  formatUsd,
  NO_HOUSING_REASONS,
  NO_HOUSING_REASON_LABELS,
  type NoHousingReason,
} from "@/data/mockData";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Search, Plus, Edit2, Trash2, Briefcase, Mail, Phone, ChevronRight, Trophy, TrendingUp, Building2, FileText, Zap, Eye, ArrowUp, ArrowDown, ArrowUpDown, Download } from "lucide-react";
import { toCsv, downloadCsv, timestampedCsvName } from "@/lib/csv";
import { EmptyStateRow } from "@/components/empty-state";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type SortDir = "asc" | "desc" | null;
type SortKey = "properties" | "occupancy" | "revenue";

const EMPTY_DRAFT: Customer = {
  id: "",
  name: "",
  contactName: "",
  email: "",
  phone: "",
  notes: "",
  state: "",
  noHousingReason: null,
};

const UNASSIGNED_STATE_KEY = "__unassigned__";

// Normalize whatever the importer / operator typed into a stable two-letter
// bucket key. Empty / whitespace-only values fall through to a sentinel
// bucket key so we never render a blank section header. The sentinel is
// translated for display via `pages.customers.unassignedStateLabel`.
function stateBucketKey(raw: string | undefined): string {
  const trimmed = (raw ?? "").trim().toUpperCase();
  return trimmed === "" ? UNASSIGNED_STATE_KEY : trimmed;
}

export default function Customers() {
  const { t } = useTranslation();
  const [location, navigate] = useLocation();
  const { customers, properties, beds, occupants, isLoading, addCustomer, updateCustomer, deleteCustomer } = useData();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Customer | null>(null);
  const [draft, setDraft] = useState<Customer>(EMPTY_DRAFT);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Customer | null>(null);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);

  // Per-customer roll-ups: property count, total/occupied beds, occupancy %, and
  // monthly revenue (summed from each occupant's normalized monthly charge).
  // Recomputes whenever properties, beds, or occupants change so the numbers
  // stay in sync with edits elsewhere in the app.
  const statsByCustomer = useMemo(() => {
    const propertiesByCustomer = new Map<string, Set<string>>();
    for (const p of properties) {
      const ownerIds = [p.customerId, ...(p.sharedWithCustomerIds ?? [])];
      for (const cid of ownerIds) {
        const set = propertiesByCustomer.get(cid) ?? new Set<string>();
        set.add(p.id);
        propertiesByCustomer.set(cid, set);
      }
    }

    const bedsByProperty = new Map<string, { total: number; occupied: number }>();
    for (const b of beds) {
      const entry = bedsByProperty.get(b.propertyId) ?? { total: 0, occupied: 0 };
      entry.total += 1;
      if (b.status === "Occupied") entry.occupied += 1;
      bedsByProperty.set(b.propertyId, entry);
    }

    const revenueByProperty = new Map<string, number>();
    for (const o of occupants) {
      if (o.status !== "Active" || !o.propertyId) continue;
      const monthly = toMonthlyCharge(o.chargePerBed, o.billingFrequency ?? "Monthly");
      revenueByProperty.set(o.propertyId, (revenueByProperty.get(o.propertyId) ?? 0) + monthly);
    }

    const map = new Map<
      string,
      { propertyCount: number; totalBeds: number; occupiedBeds: number; occupancyPct: number; monthlyRevenue: number }
    >();
    for (const c of customers) {
      const propIds = propertiesByCustomer.get(c.id) ?? new Set<string>();
      let totalBeds = 0;
      let occupiedBeds = 0;
      let monthlyRevenue = 0;
      for (const pid of propIds) {
        const bedInfo = bedsByProperty.get(pid);
        if (bedInfo) {
          totalBeds += bedInfo.total;
          occupiedBeds += bedInfo.occupied;
        }
        monthlyRevenue += revenueByProperty.get(pid) ?? 0;
      }
      const occupancyPct = totalBeds > 0 ? (occupiedBeds / totalBeds) * 100 : 0;
      map.set(c.id, {
        propertyCount: propIds.size,
        totalBeds,
        occupiedBeds,
        occupancyPct,
        monthlyRevenue: Math.round(monthlyRevenue),
      });
    }
    return map;
  }, [customers, properties, beds, occupants]);

  // Top customers across the portfolio (highest occupancy %, highest revenue).
  // Ties broken by revenue / occupancy to give a stable, sensible pick. Only
  // customers with at least one bed (occupancy) or any revenue qualify.
  const topCustomers = useMemo(() => {
    let topOccupancy: { customer: Customer; pct: number; occupied: number; total: number } | null = null;
    let topRevenue: { customer: Customer; revenue: number } | null = null;
    for (const c of customers) {
      const s = statsByCustomer.get(c.id);
      if (!s) continue;
      if (s.totalBeds > 0) {
        if (
          !topOccupancy ||
          s.occupancyPct > topOccupancy.pct ||
          (s.occupancyPct === topOccupancy.pct && s.monthlyRevenue > (statsByCustomer.get(topOccupancy.customer.id)?.monthlyRevenue ?? 0))
        ) {
          topOccupancy = { customer: c, pct: s.occupancyPct, occupied: s.occupiedBeds, total: s.totalBeds };
        }
      }
      if (s.monthlyRevenue > 0) {
        if (!topRevenue || s.monthlyRevenue > topRevenue.revenue) {
          topRevenue = { customer: c, revenue: s.monthlyRevenue };
        }
      }
    }
    return { topOccupancy, topRevenue };
  }, [customers, statsByCustomer]);

  // If we arrived via #customer-<id>, briefly highlight that row and scroll to it.
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash.startsWith("#customer-")) return;
    const targetId = hash.slice("#customer-".length);
    if (!customers.some((c) => c.id === targetId)) return;
    setHighlightedId(targetId);
    const el = document.getElementById(`customer-row-${targetId}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    const t = setTimeout(() => setHighlightedId(null), 2200);
    return () => clearTimeout(t);
  }, [customers, location]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    const list = q
      ? customers.filter((c) =>
          c.name.toLowerCase().includes(q) ||
          c.contactName.toLowerCase().includes(q) ||
          c.email.toLowerCase().includes(q) ||
          c.phone.toLowerCase().includes(q),
        )
      : customers.slice();

    if (sortKey && sortDir) {
      // Pull the metric for a customer based on the current sort column.
      // Customers with no beds have no real occupancy %, and customers
      // with $0 monthly revenue have nothing meaningful to rank on, so we
      // treat both as "missing" and always push them to the bottom
      // regardless of direction. Property count keeps its natural 0
      // ordering — a customer with zero properties is still a real value
      // worth showing at the top of an ascending list.
      const valueOf = (id: string): number | null => {
        const s = statsByCustomer.get(id);
        if (!s) return null;
        if (sortKey === "properties") return s.propertyCount;
        if (sortKey === "revenue") return s.monthlyRevenue > 0 ? s.monthlyRevenue : null;
        // occupancy
        return s.totalBeds > 0 ? s.occupancyPct : null;
      };
      list.sort((a, b) => {
        const av = valueOf(a.id);
        const bv = valueOf(b.id);
        if (av === null && bv === null) return 0;
        if (av === null) return 1;
        if (bv === null) return -1;
        const cmp = av - bv;
        return sortDir === "asc" ? cmp : -cmp;
      });
    }
    return list;
  }, [customers, search, sortKey, sortDir, statsByCustomer]);

  // Bucket the visible customers by US state so the table can render a
  // section header per state. Buckets are ordered alphabetically by state
  // code (A → Z) with the catch-all "Other / Unassigned" pinned to the
  // bottom. Within each bucket we preserve the order produced by `filtered`
  // so any active sort/search still applies.
  const grouped = useMemo(() => {
    const buckets = new Map<string, Customer[]>();
    for (const c of filtered) {
      const key = stateBucketKey(c.state);
      const list = buckets.get(key) ?? [];
      list.push(c);
      buckets.set(key, list);
    }
    return Array.from(buckets.entries())
      .sort(([a], [b]) => {
        if (a === UNASSIGNED_STATE_KEY) return 1;
        if (b === UNASSIGNED_STATE_KEY) return -1;
        return a.localeCompare(b);
      })
      .map(([state, rows]) => ({ state, rows }));
  }, [filtered]);

  // Tri-state cycle: unsorted -> asc -> desc -> unsorted. Switching to a new
  // column always restarts at ascending, matching the Properties page UX.
  const cycleSort = (key: SortKey) => {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("asc");
      return;
    }
    if (sortDir === "asc") {
      setSortDir("desc");
    } else if (sortDir === "desc") {
      setSortKey(null);
      setSortDir(null);
    } else {
      setSortDir("asc");
    }
  };

  const dirFor = (key: SortKey): SortDir => (sortKey === key ? sortDir : null);
  const sortIcon = (dir: SortDir) =>
    dir === "asc" ? (
      <ArrowUp className="h-3.5 w-3.5" />
    ) : dir === "desc" ? (
      <ArrowDown className="h-3.5 w-3.5" />
    ) : (
      <ArrowUpDown className="h-3.5 w-3.5 opacity-50" />
    );

  const openAdd = () => {
    setEditing(null);
    setDraft(EMPTY_DRAFT);
    setDialogOpen(true);
  };

  const openEdit = (c: Customer) => {
    setEditing(c);
    setDraft(c);
    setDialogOpen(true);
  };

  const handleSave = () => {
    const name = draft.name.trim();
    if (!name) {
      toast({
        title: t("toasts.customerNameRequiredTitle"),
        description: t("toasts.customerNameRequiredDescription"),
        variant: "destructive",
      });
      return;
    }
    const payload: Customer = {
      ...draft,
      name,
      contactName: draft.contactName.trim(),
      email: draft.email.trim(),
      phone: draft.phone.trim(),
      notes: draft.notes,
      state: (draft.state ?? "").trim().toUpperCase(),
      noHousingReason: draft.noHousingReason ?? null,
    };
    if (editing) {
      updateCustomer(editing.id, payload);
      toast({ title: t("toasts.customerUpdatedTitle"), description: t("toasts.customerUpdatedDescription", { name: payload.name }) });
    } else {
      const id = `cust-${Date.now()}`;
      addCustomer({ ...payload, id });
      toast({ title: t("toasts.customerAddedTitle"), description: t("toasts.customerAddedDescription", { name: payload.name }) });
    }
    setDialogOpen(false);
  };

  const handleDownloadCsv = () => {
    const csv = toCsv(filtered, [
      { header: "Name",            value: (c) => c.name },
      { header: "Contact Name",    value: (c) => c.contactName },
      { header: "Email",           value: (c) => c.email },
      { header: "Phone",           value: (c) => c.phone },
      { header: "State",           value: (c) => c.state ?? "" },
      { header: "# Properties",    value: (c) => statsByCustomer.get(c.id)?.propertyCount ?? 0 },
      { header: "Total Beds",      value: (c) => statsByCustomer.get(c.id)?.totalBeds ?? 0 },
      { header: "Occupied Beds",   value: (c) => statsByCustomer.get(c.id)?.occupiedBeds ?? 0 },
      { header: "Occupancy %",     value: (c) => {
          const s = statsByCustomer.get(c.id);
          return s && s.totalBeds > 0 ? Math.round(s.occupancyPct) : "";
        } },
      { header: "Monthly Revenue", value: (c) => statsByCustomer.get(c.id)?.monthlyRevenue ?? 0 },
      { header: "No Housing Reason", value: (c) => {
          if ((statsByCustomer.get(c.id)?.propertyCount ?? 0) > 0) return "";
          return c.noHousingReason ? t(`common.noHousingReasons.${c.noHousingReason}`) : "";
        } },
      { header: "Notes",           value: (c) => c.notes },
    ]);
    downloadCsv(timestampedCsvName("housingops-customers"), csv);
    toast({
      title: t("toasts.customersExportedTitle"),
      description: t("toasts.customersExportedDescription", { count: filtered.length }),
    });
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteCustomer(deleteTarget.id);
      toast({ title: t("toasts.customerDeletedTitle"), description: t("toasts.customerDeletedDescription", { name: deleteTarget.name }) });
      setDeleteTarget(null);
    } catch (err) {
      if (err instanceof CustomerInUseError) {
        toast({
          title: t("toasts.customerCantDeleteTitle"),
          description: t("toasts.customerCantDeleteDescription", { name: deleteTarget.name }),
          variant: "destructive",
        });
      } else {
        toast({
          title: t("toasts.deleteFailedTitle"),
          description: t("toasts.deleteFailedDescription"),
          variant: "destructive",
        });
      }
      setDeleteTarget(null);
    }
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
          title={t("pages.customers.title")}
          description={t("pages.customers.description")}
          actions={
            <>
              <Button
                variant="outline"
                onClick={handleDownloadCsv}
                disabled={isLoading || filtered.length === 0}
                data-testid="button-download-customers-csv"
              >
                <Download className="mr-2 h-4 w-4" />
                {t("pages.customers.downloadCsv")}
              </Button>
              <Button onClick={openAdd} data-testid="button-add-customer">
                <Plus className="mr-2 h-4 w-4" />
                {t("pages.customers.addCustomer")}
              </Button>
            </>
          }
        />

        {/* Top customers summary — each card hides itself when its
            metric has no winner so we never render an "empty"
            placeholder card. The whole row collapses when neither
            card has data. */}
        {(topCustomers.topOccupancy || topCustomers.topRevenue) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {topCustomers.topOccupancy && (
              <Card data-testid="card-top-occupancy">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
                        {t("pages.customers.highestOccupancy")}
                      </p>
                      <p className="text-lg font-semibold">{topCustomers.topOccupancy.customer.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {t("pages.customers.bedsOccupied", { occupied: topCustomers.topOccupancy.occupied, total: topCustomers.topOccupancy.total })}
                        {" · "}
                        <span className="font-medium text-foreground">
                          {topCustomers.topOccupancy.pct.toFixed(0)}%
                        </span>
                      </p>
                    </div>
                    <div className="p-2 rounded-md bg-emerald-100 text-emerald-700">
                      <Trophy className="h-4 w-4" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
            {topCustomers.topRevenue && (
              <Card data-testid="card-top-revenue">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
                        {t("pages.customers.highestRevenue")}
                      </p>
                      <p className="text-lg font-semibold">{topCustomers.topRevenue.customer.name}</p>
                      <p className="text-sm text-muted-foreground">
                        <span className="font-medium text-foreground">
                          {formatUsd(topCustomers.topRevenue.revenue)}
                        </span>
                        {t("pages.customers.perMoAcrossAll")}
                      </p>
                    </div>
                    <div className="p-2 rounded-md bg-primary/10 text-primary">
                      <TrendingUp className="h-4 w-4" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        <Card>
          <CardContent className="p-0">
            <div className="p-4 border-b flex flex-col sm:flex-row gap-4 items-center justify-between">
              <div className="relative w-full sm:w-72">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={t("pages.customers.searchPlaceholder")}
                  className="pl-9"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  data-testid="input-search-customers"
                />
              </div>
              <span className="text-xs text-muted-foreground">
                {t("pages.customers.countOfTotal", { shown: filtered.length, total: customers.length, count: customers.length })}
              </span>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("pages.customers.table.customer")}</TableHead>
                  <TableHead>{t("pages.customers.table.primaryContact")}</TableHead>
                  <TableHead>{t("pages.customers.table.email")}</TableHead>
                  <TableHead>{t("pages.customers.table.phone")}</TableHead>
                  <TableHead className="text-center">
                    <button
                      type="button"
                      onClick={() => cycleSort("properties")}
                      className="inline-flex items-center gap-1 mx-auto hover:text-foreground transition-colors"
                      data-testid="button-sort-properties"
                      aria-label={`Sort by properties${
                        dirFor("properties") === "asc"
                          ? " (currently ascending)"
                          : dirFor("properties") === "desc"
                            ? " (currently descending)"
                            : ""
                      }`}
                    >
                      {t("pages.customers.table.properties")}
                      {sortIcon(dirFor("properties"))}
                    </button>
                  </TableHead>
                  <TableHead className="text-center">
                    <button
                      type="button"
                      onClick={() => cycleSort("occupancy")}
                      className="inline-flex items-center gap-1 mx-auto hover:text-foreground transition-colors"
                      data-testid="button-sort-occupancy"
                      aria-label={`Sort by occupancy${
                        dirFor("occupancy") === "asc"
                          ? " (currently ascending)"
                          : dirFor("occupancy") === "desc"
                            ? " (currently descending)"
                            : ""
                      }`}
                    >
                      {t("pages.customers.table.beds")}
                      {sortIcon(dirFor("occupancy"))}
                    </button>
                  </TableHead>
                  <TableHead className="text-right">
                    <button
                      type="button"
                      onClick={() => cycleSort("revenue")}
                      className="inline-flex items-center gap-1 ml-auto hover:text-foreground transition-colors"
                      data-testid="button-sort-revenue"
                      aria-label={`Sort by revenue${
                        dirFor("revenue") === "asc"
                          ? " (currently ascending)"
                          : dirFor("revenue") === "desc"
                            ? " (currently descending)"
                            : ""
                      }`}
                    >
                      {t("pages.customers.table.revenuePerMo")}
                      {sortIcon(dirFor("revenue"))}
                    </button>
                  </TableHead>
                  <TableHead>{t("pages.customers.table.noHousingReason")}</TableHead>
                  <TableHead className="w-32 text-right">{t("pages.customers.table.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <EmptyStateRow
                    colSpan={9}
                    icon={Briefcase}
                    title={
                      customers.length === 0
                        ? t("pages.customers.empty.noCustomersTitle")
                        : t("pages.customers.empty.noMatchTitle")
                    }
                    description={
                      customers.length === 0
                        ? t("pages.customers.empty.noCustomersDescription")
                        : t("pages.customers.empty.noMatchDescription")
                    }
                    action={
                      customers.length === 0 ? (
                        <Button onClick={openAdd} data-testid="button-add-customer-empty">
                          <Plus className="mr-2 h-4 w-4" />
                          {t("pages.customers.addCustomer")}
                        </Button>
                      ) : undefined
                    }
                    testId="empty-customers-table"
                  />
                ) : (
                  grouped.flatMap((group, groupIdx) => {
                    let rowIndex = -1;
                    return [
                      <tr
                        key={`state-header-${group.state}`}
                        className="bg-muted/40 border-b"
                        data-testid={`row-state-group-${group.state}`}
                      >
                        <th
                          colSpan={9}
                          scope="colgroup"
                          className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                        >
                          <span className="inline-flex items-center gap-2">
                            <span data-testid={`text-state-group-label-${group.state}`}>
                              {group.state === UNASSIGNED_STATE_KEY
                                ? t("pages.customers.unassignedStateLabel")
                                : group.state}
                            </span>
                            <span className="text-muted-foreground/70 normal-case font-normal">
                              {t("pages.customers.groupCustomerCount", { count: group.rows.length })}
                            </span>
                          </span>
                        </th>
                      </tr>,
                      ...group.rows.map((c) => {
                        rowIndex += 1;
                        const i = groupIdx * 100 + rowIndex;
                    const stats = statsByCustomer.get(c.id);
                    const count = stats?.propertyCount ?? 0;
                    const totalBeds = stats?.totalBeds ?? 0;
                    const occupiedBeds = stats?.occupiedBeds ?? 0;
                    const occupancyPct = stats?.occupancyPct ?? 0;
                    const monthlyRevenue = stats?.monthlyRevenue ?? 0;
                    const isHighlighted = highlightedId === c.id;
                    return (
                      <motion.tr
                        key={c.id}
                        id={`customer-row-${c.id}`}
                        initial={false}
                        animate={{ opacity: 1, y: 0 }}
                        className={`border-b hover:bg-muted/40 transition-colors ${
                          isHighlighted ? "bg-primary/5 ring-1 ring-primary/30" : ""
                        }`}
                        data-testid={`row-customer-${c.id}`}
                      >
                        <td className="p-4">
                          <div className="flex items-center gap-2">
                            <div className="p-1.5 rounded-md bg-primary/10">
                              <Briefcase className="h-3.5 w-3.5 text-primary" />
                            </div>
                            <button
                              type="button"
                              onClick={() => navigate(`/customers/${encodeURIComponent(c.id)}`)}
                              className="font-semibold text-left hover:underline hover:text-primary transition-colors"
                              data-testid={`link-customer-name-${c.id}`}
                              title={`Open ${c.name}`}
                            >
                              {c.name}
                            </button>
                          </div>
                        </td>
                        <td className="p-4 text-sm">{c.contactName || <span className="text-muted-foreground">—</span>}</td>
                        <td className="p-4 text-sm">
                          {c.email ? (
                            <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1 hover:underline">
                              <Mail className="h-3 w-3 text-muted-foreground" />
                              {c.email}
                            </a>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="p-4 text-sm">
                          {c.phone ? (
                            <span className="inline-flex items-center gap-1">
                              <Phone className="h-3 w-3 text-muted-foreground" />
                              {c.phone}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="p-4 text-center">
                          {count > 0 ? (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  type="button"
                                  className="inline-flex items-center"
                                  data-testid={`link-customer-properties-${c.id}`}
                                  aria-label={t("pages.customers.rowActions.viewPropertiesOrLeasesAria", { name: c.name })}
                                >
                                  <Badge variant="secondary" className="gap-1 cursor-pointer hover:bg-secondary/70">
                                    {count}
                                    <ChevronRight className="h-3 w-3" />
                                  </Badge>
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="center" className="w-48">
                                <DropdownMenuItem
                                  onClick={() => navigate(`/properties?customer=${encodeURIComponent(c.id)}`)}
                                  data-testid={`link-customer-goto-properties-${c.id}`}
                                >
                                  <Building2 className="mr-2 h-4 w-4" />
                                  {t("pages.customers.rowActions.viewProperties")}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => navigate(`/leases?customer=${encodeURIComponent(c.id)}`)}
                                  data-testid={`link-customer-goto-leases-${c.id}`}
                                >
                                  <FileText className="mr-2 h-4 w-4" />
                                  {t("pages.customers.rowActions.viewLeases")}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => navigate(`/utilities?customer=${encodeURIComponent(c.id)}`)}
                                  data-testid={`link-customer-goto-utilities-${c.id}`}
                                >
                                  <Zap className="mr-2 h-4 w-4" />
                                  {t("pages.customers.rowActions.viewUtilities")}
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          ) : (
                            <Badge variant="outline" className="text-muted-foreground">0</Badge>
                          )}
                        </td>
                        <td className="p-4 text-center text-sm" data-testid={`cell-customer-beds-${c.id}`}>
                          {totalBeds > 0 ? (
                            <div className="flex flex-col items-center leading-tight">
                              <span className="font-medium tabular-nums">
                                {occupiedBeds}/{totalBeds}
                              </span>
                              <span className="text-xs text-muted-foreground tabular-nums">
                                {occupancyPct.toFixed(0)}%
                              </span>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="p-4 text-right text-sm tabular-nums" data-testid={`cell-customer-revenue-${c.id}`}>
                          {monthlyRevenue > 0 ? (
                            <span className="font-medium">{formatUsd(monthlyRevenue)}</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="p-4 text-sm" data-testid={`cell-customer-no-housing-${c.id}`}>
                          {count === 0 ? (
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" data-testid={`badge-no-housing-${c.id}`}>
                                {t("pages.customers.noHousingBadge")}
                              </Badge>
                              <Select
                                value={c.noHousingReason ?? ""}
                                onValueChange={(value) =>
                                  updateCustomer(c.id, {
                                    noHousingReason: value as NoHousingReason,
                                  })
                                }
                              >
                                <SelectTrigger
                                  className="h-8 w-[200px] text-xs"
                                  data-testid={`select-no-housing-reason-${c.id}`}
                                  aria-label={t("pages.customers.rowActions.setNoHousingReasonAria", { name: c.name })}
                                >
                                  {c.noHousingReason ? (
                                    <SelectValue />
                                  ) : (
                                    <span className="text-muted-foreground italic">
                                      {t("pages.customers.table.setReasonPlaceholder")}
                                    </span>
                                  )}
                                </SelectTrigger>
                                <SelectContent>
                                  {NO_HOUSING_REASONS.map((reason) => (
                                    <SelectItem
                                      key={reason}
                                      value={reason}
                                      data-testid={`select-no-housing-reason-${c.id}-${reason}`}
                                    >
                                      {t(`common.noHousingReasons.${reason}`)}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          ) : null}
                        </td>
                        <td className="p-4">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 w-8 p-0"
                              onClick={() => navigate(`/customers/${encodeURIComponent(c.id)}`)}
                              aria-label={t("pages.customers.rowActions.viewAria", { name: c.name })}
                              data-testid={`button-view-customer-${c.id}`}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 w-8 p-0"
                              onClick={() => openEdit(c)}
                              aria-label={t("pages.customers.rowActions.editAria", { name: c.name })}
                              data-testid={`button-edit-customer-${c.id}`}
                            >
                              <Edit2 className="h-4 w-4" />
                            </Button>
                            {count > 0 ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  {/* span wrapper so Tooltip works even when the button is disabled */}
                                  <span>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                                      disabled
                                      aria-label={t("pages.customers.rowActions.deleteAria", { name: c.name })}
                                      aria-disabled="true"
                                      data-testid={`button-delete-customer-${c.id}`}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent side="left" className="max-w-xs">
                                  {t("pages.customers.cantDeleteTooltip", { name: c.name, count })}
                                </TooltipContent>
                              </Tooltip>
                            ) : (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                                onClick={() => setDeleteTarget(c)}
                                aria-label={t("pages.customers.rowActions.deleteAria", { name: c.name })}
                                data-testid={`button-delete-customer-${c.id}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </motion.tr>
                    );
                  }),
                    ];
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </motion.div>

      {/* Add / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? t("pages.customers.dialog.editTitle") : t("pages.customers.dialog.addTitle")}</DialogTitle>
            <DialogDescription>
              {editing
                ? t("pages.customers.dialog.editDescription")
                : t("pages.customers.dialog.addDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-2">
            <div className="sm:col-span-2 space-y-1.5">
              <Label htmlFor="cust-name">{t("pages.customers.dialog.companyName")}</Label>
              <Input
                id="cust-name"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder={t("pages.customers.dialog.companyNamePlaceholder")}
                data-testid="input-customer-name"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cust-contact">{t("pages.customers.dialog.primaryContact")}</Label>
              <Input
                id="cust-contact"
                value={draft.contactName}
                onChange={(e) => setDraft({ ...draft, contactName: e.target.value })}
                placeholder={t("pages.customers.dialog.primaryContactPlaceholder")}
                data-testid="input-customer-contact"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cust-phone">{t("pages.customers.dialog.phone")}</Label>
              <Input
                id="cust-phone"
                value={draft.phone}
                onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
                placeholder={t("pages.customers.dialog.phonePlaceholder")}
                data-testid="input-customer-phone"
              />
            </div>
            <div className="sm:col-span-2 space-y-1.5">
              <Label htmlFor="cust-state">{t("pages.customers.dialog.state")}</Label>
              <Input
                id="cust-state"
                value={draft.state ?? ""}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    // Force uppercase so "wi" and "WI" land in the same
                    // bucket. Trim length so an accidental "Wisconsin"
                    // doesn't break the two-letter convention used by
                    // the master-lease importer.
                    state: e.target.value.toUpperCase().slice(0, 2),
                  })
                }
                placeholder={t("pages.customers.dialog.statePlaceholder")}
                maxLength={2}
                className="uppercase"
                data-testid="input-customer-state"
              />
              <p className="text-xs text-muted-foreground">
                {t("pages.customers.dialog.stateHint")}
              </p>
            </div>
            <div className="sm:col-span-2 space-y-1.5">
              <Label htmlFor="cust-email">{t("pages.customers.dialog.email")}</Label>
              <Input
                id="cust-email"
                type="email"
                value={draft.email}
                onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                placeholder={t("pages.customers.dialog.emailPlaceholder")}
                data-testid="input-customer-email"
              />
            </div>
            <div className="sm:col-span-2 space-y-1.5">
              <Label htmlFor="cust-no-housing-reason">{t("pages.customers.dialog.noHousingReason")}</Label>
              <Select
                value={draft.noHousingReason ?? "__none__"}
                onValueChange={(value) =>
                  setDraft({
                    ...draft,
                    noHousingReason:
                      value === "__none__" ? null : (value as NoHousingReason),
                  })
                }
              >
                <SelectTrigger
                  id="cust-no-housing-reason"
                  data-testid="select-customer-no-housing-reason"
                >
                  <SelectValue placeholder={t("pages.customers.table.setReasonPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{t("pages.customers.dialog.noHousingNoneOption")}</SelectItem>
                  {NO_HOUSING_REASONS.map((reason) => (
                    <SelectItem key={reason} value={reason}>
                      {t(`common.noHousingReasons.${reason}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {t("pages.customers.dialog.noHousingHint")}
              </p>
            </div>
            <div className="sm:col-span-2 space-y-1.5">
              <Label htmlFor="cust-notes">{t("pages.customers.dialog.notes")}</Label>
              <Textarea
                id="cust-notes"
                value={draft.notes}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                placeholder={t("pages.customers.dialog.notesPlaceholder")}
                className="min-h-[72px]"
                data-testid="input-customer-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {t("pages.customers.dialog.cancel")}
            </Button>
            <Button onClick={handleSave} data-testid="button-save-customer">
              {editing ? t("pages.customers.dialog.saveChanges") : t("pages.customers.dialog.addAction")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("pages.customers.deleteDialog.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && (statsByCustomer.get(deleteTarget.id)?.propertyCount ?? 0) > 0 ? (
                t("pages.customers.deleteDialog.stillOwns", {
                  name: deleteTarget.name,
                  count: statsByCustomer.get(deleteTarget.id)?.propertyCount ?? 0,
                })
              ) : (
                t("pages.customers.deleteDialog.permanentlyRemove", { name: deleteTarget?.name ?? "" })
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-delete-customer-cancel">{t("pages.customers.deleteDialog.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-delete-customer-confirm"
            >
              {t("pages.customers.deleteDialog.confirmDelete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </MainLayout>
  );
}
