import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useParams } from "wouter";
import { motion } from "framer-motion";
import { MainLayout } from "@/components/layout/main-layout";
import { useData } from "@/context/data-store";
import { getCustomerResponsibleLeases, sumCustomerResponsibleRent, sumOtherCostsForProperty, toMonthlyCharge, formatUsd, NO_HOUSING_REASONS, type NoHousingReason } from "@/data/mockData";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ChevronLeft, ChevronRight, Building2, BedDouble,
  TrendingUp, Mail, Phone, FileText, User, Receipt, Truck, Users, MapPin,
} from "lucide-react";
import {
  useListVehicles,
  useListVehicleRiders,
  useListVehicleFuelCharges,
} from "@workspace/api-client-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { InlineEdit, NotesEditor } from "./property-detail";
import { useToast } from "@/hooks/use-toast";
import { NotFoundScreen } from "@/components/not-found-screen";
import { CustomerLogo } from "@/components/customer-logo";

function StatCard({
  label, value, sub, icon: Icon, color = "text-foreground", testId, onClick,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon?: React.ElementType;
  color?: string;
  testId?: string;
  /** When provided, the whole card becomes a button that drills in. */
  onClick?: () => void;
}) {
  const clickable = !!onClick;
  return (
    <Card
      data-testid={testId}
      onClick={onClick}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick!();
              }
            }
          : undefined
      }
      className={
        clickable
          ? "cursor-pointer transition-shadow hover:shadow-md hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          : undefined
      }
    >
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</p>
            <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </div>
          {Icon && (
            <div className="p-2 rounded-lg bg-muted">
              <Icon className="h-4 w-4 text-muted-foreground" />
            </div>
          )}
        </div>
        {clickable && (
          <p className="mt-2 inline-flex items-center gap-0.5 text-[11px] font-medium text-primary">
            View <ChevronRight className="h-3 w-3" />
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function CustomerDetail() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { customers, properties, beds, occupants, leases, otherCosts, isLoading, updateCustomer, updateProperty } = useData();
  const { toast } = useToast();

  // Transportation rollup (Task: per-client transport list). Vans served by
  // this customer, each with its driver and rider roster. Read directly from
  // the vehicles API hooks since vehicles aren't part of the data-store.
  const { data: allVehicles } = useListVehicles();
  const { data: allVehicleRiders } = useListVehicleRiders();
  const { data: allVehicleFuel } = useListVehicleFuelCharges();
  const transportRollup = useMemo(() => {
    const occName = new Map<string, string>();
    for (const o of occupants) occName.set(o.id, o.name || o.id);
    const ridersByVehicle = new Map<string, string[]>();
    for (const r of allVehicleRiders ?? []) {
      const list = ridersByVehicle.get(r.vehicleId) ?? [];
      list.push(occName.get(r.occupantId) ?? r.occupantId);
      ridersByVehicle.set(r.vehicleId, list);
    }
    const fuelByVehicle = new Map<string, number>();
    for (const c of allVehicleFuel ?? []) {
      fuelByVehicle.set(
        c.vehicleId,
        (fuelByVehicle.get(c.vehicleId) ?? 0) + Number(c.amount ?? 0),
      );
    }
    const vans = (allVehicles ?? [])
      .filter((v) => v.customerId === id)
      .map((v) => ({
        id: v.id,
        label:
          v.merchantUnit ||
          [v.year, v.make, v.model].filter(Boolean).join(" ") ||
          v.id,
        status: v.status,
        driver: v.driverOccupantId
          ? occName.get(v.driverOccupantId) ?? v.driverOccupantId
          : "",
        riders: ridersByVehicle.get(v.id) ?? [],
        monthly: Number(v.monthlyCost ?? 0),
        fuel: fuelByVehicle.get(v.id) ?? 0,
      }));
    const monthlyTotal = vans.reduce((s, v) => s + v.monthly, 0);
    const fuelTotal = vans.reduce((s, v) => s + v.fuel, 0);
    return { vans, monthlyTotal, fuelTotal };
  }, [allVehicles, allVehicleRiders, allVehicleFuel, occupants, id]);
  const [trendMonths, setTrendMonths] = useState<3 | 6 | 12 | 24>(() => {
    if (typeof window === "undefined") return 12;
    try {
      const stored = window.localStorage.getItem("revenue-trend-range-months");
      const parsed = stored ? Number(stored) : NaN;
      if (parsed === 3 || parsed === 6 || parsed === 12 || parsed === 24) {
        return parsed;
      }
    } catch {
      // ignore storage failures (private mode, quota, etc.)
    }
    return 12;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem("revenue-trend-range-months", String(trendMonths));
    } catch {
      // ignore storage failures
    }
  }, [trendMonths]);

  // Per-property roll-ups for THIS customer: total beds, occupied beds, and
  // monthly revenue (summed from each active occupant's normalized monthly
  // charge). Memoized so the calculation only re-runs when the underlying
  // collections actually change.
  const propertyStats = useMemo(() => {
    // Include shared-housing properties (task #295/#311): a property
    // belongs to this customer's page if it's their primary
    // `customerId` OR if they're listed in `sharedWithCustomerIds`.
    const customerProperties = properties.filter(
      (p) =>
        p.customerId === id ||
        (p.sharedWithCustomerIds ?? []).includes(id),
    );

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
      revenueByProperty.set(
        o.propertyId,
        (revenueByProperty.get(o.propertyId) ?? 0) + monthly,
      );
    }

    return customerProperties.map((p) => {
      const bed = bedsByProperty.get(p.id) ?? { total: 0, occupied: 0 };
      const revenue = Math.round(revenueByProperty.get(p.id) ?? 0);
      const occupancyPct = bed.total > 0 ? (bed.occupied / bed.total) * 100 : 0;
      return {
        property: p,
        totalBeds: bed.total,
        occupiedBeds: bed.occupied,
        occupancyPct,
        monthlyRevenue: revenue,
      };
    });
  }, [properties, beds, occupants, id]);

  // Last ~12 months of monthly revenue for THIS customer. For each month, we
  // sum up the normalized monthly charge of every occupant who was at one of
  // this customer's properties during that month — based on the occupant's
  // moveInDate / moveOutDate window, not their current Active/Former status,
  // so historical revenue stays correct even after move-outs.
  const revenueTrend = useMemo(() => {
    const now = new Date();
    const months: { key: string; label: string; tooltipLabel: string }[] = [];
    for (let i = trendMonths - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const year = d.getFullYear();
      const month = d.getMonth() + 1;
      const key = `${year}-${String(month).padStart(2, "0")}`;
      // Use the active i18n language so Spanish operators see
      // localized month abbreviations (e.g. `ene`, `feb`) on the
      // monthly trend axis. Falls back to English when no language
      // is set.
      const lang = (
        globalThis as { i18next?: { language?: string } }
      ).i18next?.language?.toLowerCase().startsWith("es")
        ? "es-ES"
        : "en-US";
      const short = d.toLocaleString(lang, { month: "short" });
      months.push({
        key,
        label: short,
        tooltipLabel: `${short} ${year}`,
      });
    }

    const customerPropIds = new Set(
      properties
        .filter(
          (p) =>
            p.customerId === id ||
            (p.sharedWithCustomerIds ?? []).includes(id),
        )
        .map((p) => p.id),
    );
    const relevantOccupants = occupants.filter(
      (o) => o.propertyId && customerPropIds.has(o.propertyId),
    );

    return months.map(({ key, label, tooltipLabel }) => {
      let revenue = 0;
      for (const o of relevantOccupants) {
        const moveInKey = (o.moveInDate ?? "").slice(0, 7);
        if (!moveInKey || moveInKey > key) continue;
        const moveOutKey = o.moveOutDate ? o.moveOutDate.slice(0, 7) : null;
        if (moveOutKey && moveOutKey < key) continue;
        revenue += toMonthlyCharge(o.chargePerBed, o.billingFrequency ?? "Monthly");
      }
      return { key, label, tooltipLabel, revenue: Math.round(revenue) };
    });
  }, [properties, occupants, id, trendMonths]);

  // Active leases where THIS customer is on the hook for rent (LOI-style
  // "customer pays the landlord" arrangement, task #313). We sort by monthly
  // rent descending so the biggest liabilities surface first in the
  // drill-down list under the stat card.
  const customerPaidLeases = useMemo(() => {
    if (!id) return [];
    return getCustomerResponsibleLeases(leases, properties, id).sort(
      (a, b) => (b.monthlyRent || 0) - (a.monthlyRent || 0),
    );
  }, [leases, properties, id]);

  const customerPaidRent = useMemo(
    () => (id ? sumCustomerResponsibleRent(leases, properties, id) : 0),
    [leases, properties, id],
  );

  const propertyById = useMemo(() => {
    const m = new Map<string, (typeof properties)[number]>();
    for (const p of properties) m.set(p.id, p);
    return m;
  }, [properties]);

  const totals = useMemo(() => {
    let totalBeds = 0;
    let occupiedBeds = 0;
    let monthlyRevenue = 0;
    for (const s of propertyStats) {
      totalBeds += s.totalBeds;
      occupiedBeds += s.occupiedBeds;
      monthlyRevenue += s.monthlyRevenue;
    }
    const occupancyPct = totalBeds > 0 ? (occupiedBeds / totalBeds) * 100 : 0;
    return {
      propertyCount: propertyStats.length,
      totalBeds,
      occupiedBeds,
      occupancyPct,
      monthlyRevenue,
    };
  }, [propertyStats]);

  if (isLoading) {
    return (
      <MainLayout>
        <div className="p-8 max-w-[1600px] mx-auto space-y-6" data-testid="customer-detail-loading">
          <div className="flex items-center gap-3">
            <Skeleton className="h-7 w-28" />
            <span className="text-muted-foreground">/</span>
            <Skeleton className="h-4 w-40" />
          </div>
          <div className="flex items-center gap-3">
            <Skeleton className="h-11 w-11 rounded-xl" />
            <div className="space-y-2">
              <Skeleton className="h-6 w-56" />
              <Skeleton className="h-4 w-72" />
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-xl" />
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Skeleton className="h-56 w-full rounded-xl lg:col-span-1" />
            <Skeleton className="h-56 w-full rounded-xl lg:col-span-2" />
          </div>
        </div>
      </MainLayout>
    );
  }

  const customer = customers.find((c) => c.id === id);
  if (!customer) {
    return (
      <MainLayout>
        <NotFoundScreen
          title={t("pages.customerDetail.notFoundTitle")}
          description={t("pages.customerDetail.notFoundDescription")}
          secondary={{
            label: t("pages.customerDetail.backToCustomers"),
            href: "/customers",
            testId: "button-back-to-customers",
          }}
          testId="customer-detail-not-found"
        />
      </MainLayout>
    );
  }

  // Optimistic save for an inline-edited customer field. The data store
  // applies the patch immediately and reverts (with a destructive toast) if
  // the server save fails, so we surface a confirmation toast right away —
  // mirroring the pattern used by the Customers list dialog.
  const saveField = <K extends keyof typeof customer>(
    field: K,
    nextValue: (typeof customer)[K],
    label: string,
  ) => {
    if (customer[field] === nextValue) return;
    updateCustomer(customer.id, { [field]: nextValue } as Partial<typeof customer>);
    toast({
      title: t("pages.customerDetail.toastUpdatedTitle"),
      description: t("pages.customerDetail.toastSavedDescription", { label }),
    });
  };

  const saveName = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) {
      toast({
        title: t("pages.customerDetail.toastNameRequiredTitle"),
        description: t("pages.customerDetail.toastNameRequiredDescription"),
        variant: "destructive",
      });
      return;
    }
    saveField("name", trimmed, t("pages.customerDetail.fieldLabelCompanyName"));
  };

  return (
    <MainLayout>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="p-8 max-w-[1600px] mx-auto space-y-6"
      >
        {/* Breadcrumb */}
        <div className="flex items-center gap-3">
          <Link href="/customers">
            <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground hover:text-foreground" data-testid="link-back-to-customers">
              <ChevronLeft className="h-4 w-4" />
              {t("pages.customerDetail.breadcrumbCustomers")}
            </Button>
          </Link>
          <span className="text-muted-foreground">/</span>
          <span className="text-sm font-medium">{customer.name}</span>
        </div>

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <CustomerLogo name={customer.name} size={56} />
            <div>
              <h1
                className="text-2xl font-bold tracking-tight"
                data-testid="customer-detail-name"
              >
                <InlineEdit
                  value={customer.name}
                  onSave={saveName}
                  displayClassName="!text-2xl font-bold tracking-tight"
                  inputClassName="w-72 !text-base"
                  testId="inline-customer-name"
                />
              </h1>
              <p className="text-sm text-muted-foreground">
                {t("pages.customerDetail.headerSummary", {
                  propertyCount: totals.propertyCount,
                  bedCount: totals.totalBeds,
                  count: totals.propertyCount,
                })}
              </p>
            </div>
          </div>
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard
            label={t("pages.customerDetail.summaryProperties")}
            value={totals.propertyCount}
            icon={Building2}
            testId="stat-properties"
            onClick={() => navigate(`/properties?customer=${encodeURIComponent(id)}`)}
          />
          <StatCard
            label={t("pages.customerDetail.summaryBeds")}
            value={totals.totalBeds > 0 ? `${totals.occupiedBeds}/${totals.totalBeds}` : "—"}
            sub={totals.totalBeds > 0 ? t("pages.customerDetail.occupiedOverTotal") : undefined}
            icon={BedDouble}
            testId="stat-beds"
            onClick={() => navigate(`/customers/${encodeURIComponent(id)}/beds`)}
          />
          <StatCard
            label={t("pages.customerDetail.summaryOccupancy")}
            value={totals.totalBeds > 0 ? `${totals.occupancyPct.toFixed(0)}%` : "—"}
            color={totals.totalBeds > 0 ? "text-emerald-600" : "text-muted-foreground"}
            icon={TrendingUp}
            testId="stat-occupancy"
            onClick={() => navigate(`/customers/${encodeURIComponent(id)}/beds`)}
          />
          <StatCard
            label={t("pages.customerDetail.summaryMonthlyRevenue")}
            value={totals.monthlyRevenue > 0 ? `${formatUsd(totals.monthlyRevenue)}` : "—"}
            sub={t("pages.customerDetail.acrossAllProperties")}
            color={totals.monthlyRevenue > 0 ? "text-emerald-600" : "text-muted-foreground"}
            icon={TrendingUp}
            testId="stat-revenue"
          />
        </div>

        {/* Customer-paid monthly rent (LOI / corporate-responsibility leases) */}
        <Card data-testid="card-customer-paid-rent">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <Receipt className="h-4 w-4" />
                {t("pages.customerDetail.customerPaidTitle")}
              </span>
              <span className="text-xs font-normal text-muted-foreground">
                {t("pages.customerDetail.activeLeases", { count: customerPaidLeases.length })}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p
              className={`text-2xl font-bold ${customerPaidRent > 0 ? "text-emerald-600" : "text-muted-foreground"}`}
              data-testid="stat-customer-paid-rent"
            >
              {customerPaidRent > 0 ? `${formatUsd(customerPaidRent)}` : "—"}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t("pages.customerDetail.customerPaidHelper")}
            </p>
            {customerPaidLeases.length === 0 ? (
              <p
                className="mt-4 text-sm text-muted-foreground"
                data-testid="empty-customer-paid-leases"
              >
                {t("pages.customerDetail.noLeasesFlagged")}
              </p>
            ) : (
              <ul className="mt-4 divide-y border rounded-md" data-testid="list-customer-paid-leases">
                {customerPaidLeases.map((l) => {
                  const property = propertyById.get(l.propertyId);
                  const isHotelRate = (l.rateType ?? "monthly") === "room-night";
                  return (
                    <li key={l.id}>
                      <Link
                        href={`/leases/${l.id}`}
                        className="flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-muted/50 transition-colors group"
                        data-testid={`link-customer-paid-lease-${l.id}`}
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <span className="font-medium truncate">
                            {property?.name ?? t("pages.customerDetail.unknownProperty")}
                            {l.unit ? ` · ${l.unit}` : ""}
                          </span>
                          {isHotelRate && (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                              {t("pages.customerDetail.hotelRateBadge")}
                            </Badge>
                          )}
                        </span>
                        <span className="flex items-center gap-2 shrink-0 text-muted-foreground">
                          <span className="tabular-nums font-medium text-foreground">
                            {isHotelRate
                              ? "—"
                              : property?.rentFree
                                ? `${formatUsd(sumOtherCostsForProperty(otherCosts, l.propertyId))}/mo`
                                : `${formatUsd((l.monthlyRent || 0))}/mo`}
                          </span>
                          <ChevronRight className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Revenue trend (last 12 months) */}
        <Card data-testid="card-customer-revenue-trend">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4" />
                {t("pages.customerDetail.revenueTrend")}
              </span>
              <div
                className="flex items-center gap-1"
                role="group"
                aria-label={t("pages.customerDetail.selectRangeAria")}
                data-testid="revenue-trend-range"
              >
                {([3, 6, 12, 24] as const).map((m) => {
                  const active = trendMonths === m;
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setTrendMonths(m)}
                      aria-pressed={active}
                      className={`px-2 py-0.5 text-xs font-medium rounded-md border transition-colors ${
                        active
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-transparent text-muted-foreground border-border hover:text-foreground hover:bg-muted"
                      }`}
                      data-testid={`revenue-trend-range-${m}m`}
                    >
                      {m}M
                    </button>
                  );
                })}
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-44" data-testid="customer-revenue-trend-chart">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={revenueTrend}
                  margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="label"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    width={48}
                    tickFormatter={(v: number) =>
                      v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`
                    }
                  />
                  <Tooltip
                    cursor={{ fill: "transparent" }}
                    formatter={(value: number) => [
                      `${formatUsd(value)}`,
                      t("pages.customerDetail.revenueLabel"),
                    ]}
                    labelFormatter={(_label, payload) =>
                      (payload?.[0]?.payload as { tooltipLabel?: string } | undefined)
                        ?.tooltipLabel ?? ""
                    }
                  />
                  <Bar dataKey="revenue" fill="#0f172a" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Contact + Properties */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Contact card */}
          <Card className="lg:col-span-1" data-testid="card-customer-contact">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <User className="h-4 w-4" />
                {t("pages.customerDetail.contact")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium">{t("pages.customerDetail.primaryContact")}</p>
                <div className="mt-0.5" data-testid="contact-name">
                  <InlineEdit
                    value={customer.contactName}
                    placeholder={t("pages.customerDetail.addContactName")}
                    inputClassName="w-56"
                    onSave={(v) => saveField("contactName", v.trim(), t("pages.customerDetail.fieldLabelContactName"))}
                    testId="inline-contact-name"
                  />
                </div>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium">{t("pages.customerDetail.email")}</p>
                <div className="mt-0.5 flex items-center gap-1.5" data-testid="contact-email">
                  {customer.email && <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                  <InlineEdit
                    value={customer.email}
                    type="email"
                    placeholder={t("pages.customerDetail.addEmail")}
                    inputClassName="w-56"
                    onSave={(v) => saveField("email", v.trim(), t("pages.customerDetail.fieldLabelEmail"))}
                    testId="inline-contact-email"
                  />
                </div>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium">{t("pages.customerDetail.phone")}</p>
                <div className="mt-0.5 flex items-center gap-1.5" data-testid="contact-phone">
                  {customer.phone && <Phone className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                  <InlineEdit
                    value={customer.phone}
                    type="tel"
                    placeholder={t("pages.customerDetail.addPhone")}
                    inputClassName="w-56"
                    onSave={(v) => saveField("phone", v.trim(), t("pages.customerDetail.fieldLabelPhone"))}
                    testId="inline-contact-phone"
                  />
                </div>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium flex items-center gap-1.5">
                  <MapPin className="h-3 w-3" /> State
                </p>
                <div className="mt-0.5" data-testid="contact-state">
                  <InlineEdit
                    value={customer.state ?? ""}
                    placeholder="Add state"
                    inputClassName="w-24"
                    onSave={(v) => saveField("state", v.trim().toUpperCase(), "State")}
                    testId="inline-contact-state"
                  />
                </div>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium">No-housing reason</p>
                <div className="mt-1" data-testid="contact-no-housing-reason">
                  <Select
                    value={customer.noHousingReason ?? "__none"}
                    onValueChange={(v) =>
                      saveField("noHousingReason", (v === "__none" ? null : (v as NoHousingReason)) as typeof customer.noHousingReason, "No-housing reason")
                    }
                  >
                    <SelectTrigger className="h-8 w-full" data-testid="select-no-housing-reason">
                      <SelectValue placeholder="— none —" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">— none —</SelectItem>
                      {NO_HOUSING_REASONS.map((reason) => (
                        <SelectItem key={reason} value={reason}>
                          {t(`common.noHousingReasons.${reason}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium flex items-center gap-1.5">
                  <FileText className="h-3 w-3" />
                  {t("pages.customerDetail.notes")}
                </p>
                <div className="mt-1" data-testid="contact-notes">
                  <NotesEditor
                    value={customer.notes ?? ""}
                    onSave={(v) => saveField("notes", v, t("pages.customerDetail.fieldLabelNotes"))}
                    className="min-h-[88px] text-sm"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Properties list */}
          <Card className="lg:col-span-2" data-testid="card-customer-properties">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <Building2 className="h-4 w-4" />
                  {t("pages.customerDetail.propertiesTitle")}
                </span>
                <span className="text-xs font-normal text-muted-foreground">
                  {t("pages.customerDetail.propertiesTotal", { count: totals.propertyCount })}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {propertyStats.length === 0 ? (
                <p className="px-6 pb-6 text-sm text-muted-foreground" data-testid="empty-properties">
                  {t("pages.customerDetail.noPropertiesYet")}
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("pages.customerDetail.colProperty")}</TableHead>
                      <TableHead>{t("pages.customerDetail.colLocation")}</TableHead>
                      <TableHead className="text-center">{t("pages.customerDetail.colBeds")}</TableHead>
                      <TableHead className="text-center">{t("pages.customerDetail.colOccupancy")}</TableHead>
                      <TableHead className="text-right">{t("pages.customerDetail.colRevenuePerMo")}</TableHead>
                      <TableHead className="w-8" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {propertyStats.map(({ property, totalBeds, occupiedBeds, occupancyPct, monthlyRevenue }, i) => (
                      <motion.tr
                        key={property.id}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.03 }}
                        className="cursor-pointer hover:bg-muted/50 border-b transition-colors group"
                        onClick={() => navigate(`/properties/${property.id}`)}
                        data-testid={`row-customer-property-${property.id}`}
                      >
                        <td className="p-4">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold">{property.name}</span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                updateProperty(property.id, {
                                  status: property.status === "Active" ? "Inactive" : "Active",
                                });
                              }}
                              title={property.status === "Active" ? "Click to set Inactive" : "Click to set Active"}
                              data-testid={`button-customer-property-status-${property.id}`}
                              className="shrink-0"
                            >
                              <Badge
                                variant={property.status === "Active" ? "default" : "secondary"}
                                className="text-[10px] px-1.5 py-0 cursor-pointer gap-1 ring-1 ring-transparent transition hover:opacity-80 hover:ring-primary/40"
                              >
                                {property.status}
                                <ChevronRight className="h-2.5 w-2.5 rotate-90 opacity-60" />
                              </Badge>
                            </button>
                          </div>
                        </td>
                        <td className="p-4 text-sm text-muted-foreground">
                          {property.city}{property.state ? `, ${property.state}` : ""}
                        </td>
                        <td className="p-4 text-center text-sm tabular-nums">
                          {totalBeds > 0 ? (
                            <span className="font-medium">{occupiedBeds}/{totalBeds}</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="p-4 text-center text-sm tabular-nums">
                          {totalBeds > 0 ? (
                            <span className="font-medium">{occupancyPct.toFixed(0)}%</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="p-4 text-right text-sm tabular-nums">
                          {monthlyRevenue > 0 ? (
                            <span className="font-medium">{formatUsd(monthlyRevenue)}</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="p-4">
                          <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                        </td>
                      </motion.tr>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        <Card data-testid="card-customer-transport">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <Truck className="h-4 w-4" />
                Transportation
              </span>
              <span className="text-xs font-normal text-muted-foreground">
                {transportRollup.vans.length === 1
                  ? "1 van"
                  : `${transportRollup.vans.length} vans`}
                {transportRollup.monthlyTotal > 0 &&
                  ` · ${formatUsd(transportRollup.monthlyTotal)}/mo`}
                {transportRollup.fuelTotal > 0 &&
                  ` · ${formatUsd(transportRollup.fuelTotal)} fuel`}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {transportRollup.vans.length === 0 ? (
              <p
                className="px-6 pb-6 text-sm text-muted-foreground"
                data-testid="empty-transport"
              >
                No vans assigned to this client yet.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Van</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Driver</TableHead>
                    <TableHead className="text-center">Riders</TableHead>
                    <TableHead>Associates transported</TableHead>
                    <TableHead className="w-8" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transportRollup.vans.map((v) => (
                    <tr
                      key={v.id}
                      className="cursor-pointer hover:bg-muted/50 border-b transition-colors group"
                      onClick={() => navigate("/transport/vehicles")}
                      data-testid={`row-customer-van-${v.id}`}
                    >
                      <td className="p-4 font-semibold">{v.label}</td>
                      <td className="p-4">
                        <Badge
                          variant={
                            v.status === "In use"
                              ? "default"
                              : v.status === "In shop"
                                ? "destructive"
                                : "secondary"
                          }
                          className="text-[10px] px-1.5 py-0"
                        >
                          {v.status}
                        </Badge>
                      </td>
                      <td className="p-4 text-sm">
                        {v.driver ? (
                          <span className="flex items-center gap-1">
                            <User className="h-3 w-3 text-muted-foreground" />
                            {v.driver}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">
                            No driver
                          </span>
                        )}
                      </td>
                      <td className="p-4 text-center text-sm tabular-nums">
                        <span className="flex items-center justify-center gap-1">
                          <Users className="h-3 w-3 text-muted-foreground" />
                          {v.riders.length}
                        </span>
                      </td>
                      <td className="p-4 text-sm text-muted-foreground max-w-[20rem] truncate">
                        {v.riders.length > 0 ? v.riders.join(", ") : "—"}
                      </td>
                      <td className="p-4">
                        <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                      </td>
                    </tr>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </MainLayout>
  );
}
