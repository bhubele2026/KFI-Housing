import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { MainLayout } from "@/components/layout/main-layout";
import { PageHeader } from "@/components/layout/page-header";
import { useData } from "@/context/data-store";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle, BedDouble, CalendarClock, DollarSign, Percent, Users,
  ArrowRight, Briefcase, Contact, Calculator,
} from "lucide-react";
import { computePropertyEconomics, type DeductionLite } from "@/lib/property-economics";
import { useListPayrollDeductions } from "@workspace/api-client-react";
import { getRenewalInfo, daysUntil, formatUsdWhole } from "@/data/mockData";
import { shortPropertyName } from "@/lib/property-name";

/**
 * Dashboard — the executive overview. Answers the one question the app
 * exists for: ARE WE RECOVERING THE RENT WE PAY OUT? recovery_gap is the
 * headline. Flat/corporate, dense, every figure clicks through. Recovered
 * is ACTUAL payroll deductions for the selected month (reuses the same
 * computePropertyEconomics the Rent Recovery page uses).
 */

const monthLabel = (m: string) => {
  if (!m) return "—";
  const [y, mo] = m.split("-");
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString(undefined, {
    month: "short",
    year: "numeric",
  });
};

function Kpi({
  label, value, sub, tone = "default", icon: Icon, headline, to,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "good" | "bad";
  icon?: React.ElementType;
  headline?: boolean;
  to?: string;
}) {
  const color =
    tone === "bad" ? "text-red-600" : tone === "good" ? "text-emerald-600" : "text-foreground";
  const inner = (
    <Card className={(to ? "cursor-pointer transition-colors hover:border-primary/50 " : "") + (headline ? "bg-muted/30" : "")}>
      <CardContent className="p-3">
        <div className="flex items-center justify-between">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
          {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
        </div>
        <p className={`mt-1 font-semibold tabular-nums ${headline ? "text-2xl" : "text-xl"} ${color}`}>{value}</p>
        {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
  return to ? <Link href={to}>{inner}</Link> : inner;
}

export default function Dashboard() {
  const { properties, leases, occupants, utilities, customers, beds } = useData();
  const dedQuery = useListPayrollDeductions();
  const deductions = (dedQuery.data ?? []) as unknown as (DeductionLite & { nameSnapshot?: string })[];

  const months = useMemo(
    () =>
      Array.from(new Set(deductions.map((d) => (d.payWeekEndDate || "").slice(0, 7)).filter(Boolean)))
        .sort()
        .reverse(),
    [deductions],
  );
  const [period, setPeriod] = useState("");
  const effectivePeriod = period || months[0] || "";

  const { rows, summary } = useMemo(
    () => computePropertyEconomics(properties, leases, occupants, utilities, deductions, effectivePeriod || undefined),
    [properties, leases, occupants, utilities, deductions, effectivePeriod],
  );

  const customerName = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of customers) m.set(c.id, c.name);
    return m;
  }, [customers]);
  const propName = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of properties) m.set(p.id, shortPropertyName(p.name));
    return m;
  }, [properties]);

  // Active-on-payroll headcount — best-effort (Zenople-backed; "—" if down).
  const rosterCount = useQuery({
    queryKey: ["dash-roster-count"],
    queryFn: async () => {
      const r = await fetch("/api/roster/active");
      if (!r.ok) throw new Error(String(r.status));
      return (await r.json()) as { count: number };
    },
    retry: false,
    staleTime: 10 * 60 * 1000,
  });

  // "Not in payroll yet" — housed people whose rent isn't being deducted
  // (Stage 3e tray; direct-fetch, not in the generated client). Highest-value
  // leak: we pay rent and recover nothing. "—" if the endpoint is unavailable.
  const unlinked = useQuery({
    queryKey: ["dash-unlinked"],
    queryFn: async () => {
      const baseUrl = import.meta.env.BASE_URL ?? "/";
      const r = await fetch(`${baseUrl}api/zenople/unlinked`);
      if (!r.ok) throw new Error(String(r.status));
      return (await r.json()) as { count: number; totalMonthlyAtRisk: number };
    },
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const renewals = useMemo(
    () =>
      leases
        .filter((l) => l.status === "Active" && l.endDate)
        .map((l) => ({ l, info: getRenewalInfo(l.endDate), days: daysUntil(l.endDate) }))
        .filter((x) => x.info && x.days <= 90)
        .sort((a, b) => a.days - b.days)
        .slice(0, 8),
    [leases],
  );

  const vacantReady = beds.filter((b) => b.status === "Vacant" && b.cleaningStatus === "ready").length;
  const needsCleaning = beds.filter((b) => b.cleaningStatus === "needs_cleaning").length;

  const notPlacedNames = useMemo(() => {
    const occById = new Map(occupants.map((o) => [o.id, o] as const));
    const seen = new Set<string>();
    const names: string[] = [];
    for (const d of deductions) {
      if (effectivePeriod && (d.payWeekEndDate || "").slice(0, 7) !== effectivePeriod) continue;
      if (!d.occupantId || seen.has(d.occupantId)) continue;
      const o = occById.get(d.occupantId);
      if (!o || !o.bedId || !o.propertyId) {
        seen.add(d.occupantId);
        names.push(o?.name || d.nameSnapshot || "Unknown");
      }
    }
    return names;
  }, [deductions, occupants, effectivePeriod]);

  // Weekly amount actually deducted per occupant for the period (for leak math).
  const weeklyByOcc = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of deductions) {
      if (effectivePeriod && (d.payWeekEndDate || "").slice(0, 7) !== effectivePeriod) continue;
      if (!d.occupantId) continue;
      const w = Number((d as { weeklyAmount?: number }).weeklyAmount) || 0;
      const prev = m.get(d.occupantId) ?? 0;
      if (w > prev) m.set(d.occupantId, w);
    }
    return m;
  }, [deductions, effectivePeriod]);

  // Stage 4 — money leaks, each one click into the records that fix it.
  const leaks = useMemo(() => {
    const placed = occupants.filter((o) => o.bedId && o.status === "Active");
    const occByProp = new Map<string, number>();
    for (const o of placed) {
      if (o.propertyId) occByProp.set(o.propertyId, (occByProp.get(o.propertyId) ?? 0) + 1);
    }
    const weeklyOf = (o: { id: string; chargePerBed?: number }) =>
      weeklyByOcc.get(o.id) ?? Number((o as { chargePerBed?: number }).chargePerBed) ?? 0;

    const zeroCharge = placed.filter((o) => !(weeklyOf(o) > 0));
    const activeProps = properties.filter((p) => p.status !== "Inactive");
    const rentNoOccupants = activeProps.filter(
      (p) => Number((p as { monthlyRent?: number }).monthlyRent) > 0 && (occByProp.get(p.id) ?? 0) === 0,
    );
    const occupantsNoRent = activeProps.filter(
      (p) => (occByProp.get(p.id) ?? 0) > 0 && !(Number((p as { monthlyRent?: number }).monthlyRent) > 0),
    );
    const moveOutStillCharged = occupants.filter((o) => {
      const former = o.status === "Former" || Boolean((o as { moveOutDate?: string }).moveOutDate);
      return former && (weeklyByOcc.get(o.id) ?? 0) > 0;
    });
    return { zeroCharge, rentNoOccupants, occupantsNoRent, moveOutStillCharged };
  }, [occupants, properties, weeklyByOcc]);

  const gapPositive = summary.totalRecoveryGap > 0;
  // All properties this period (recovered or not), worst gap first — the card
  // body scrolls so a long list never blows up the dashboard layout.
  const losing = [...rows].sort((a, b) => b.recoveryGap - a.recoveryGap);
  const occPct = summary.totalBeds > 0 ? Math.round((summary.totalOccupied / summary.totalBeds) * 100) : null;

  const QUICK = [
    { href: "/customers", label: "Customers", icon: Briefcase },
    { href: "/roster", label: "Roster", icon: Contact },
    { href: "/economics", label: "Rent Recovery", icon: Calculator },
    { href: "/finance", label: "Finance", icon: DollarSign },
  ];

  return (
    <MainLayout>
      <div className="p-6 max-w-[1400px] mx-auto space-y-5">
        <PageHeader
          title="Dashboard"
          description={`Rent recovery — ${monthLabel(effectivePeriod)}`}
          actions={
            months.length > 0 ? (
              <Select value={effectivePeriod} onValueChange={setPeriod}>
                <SelectTrigger className="w-40" data-testid="dashboard-period">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {months.map((m) => (
                    <SelectItem key={m} value={m}>{monthLabel(m)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null
          }
        />

        {/* KPI strip */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <Kpi label="Recovery gap /mo" value={formatUsdWhole(summary.totalRecoveryGap)} tone={gapPositive ? "bad" : "good"} icon={AlertTriangle} headline />
          <Kpi label="Recovery rate" value={summary.blendedRecoveryRate == null ? "—" : `${summary.blendedRecoveryRate.toFixed(0)}%`} tone={(summary.blendedRecoveryRate ?? 0) >= 90 ? "good" : "bad"} icon={Percent} headline />
          <Kpi label="Rent cost /mo" value={formatUsdWhole(summary.totalRentCost)} icon={DollarSign} />
          <Kpi label="Recovered /mo" value={formatUsdWhole(summary.totalRecovered)} tone="good" icon={DollarSign} />
          <Kpi label="Occupancy" value={occPct == null ? "—" : `${occPct}%`} sub={`${summary.totalOccupied}/${summary.totalBeds} beds`} icon={BedDouble} />
          <Kpi label="On payroll" value={rosterCount.data ? String(rosterCount.data.count) : rosterCount.isLoading ? "…" : "—"} icon={Users} to="/roster" />
        </div>

        {summary.chargedNotPlacedCount > 0 && (
          <Link href="/roster">
            <div className="flex items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm hover:bg-amber-100">
              <span className="flex items-center gap-2 text-amber-800">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span><b>{summary.chargedNotPlacedCount}</b> charged for housing but not placed in a bed — unrecovered dollars</span>
              </span>
              <ArrowRight className="h-4 w-4 text-amber-700 shrink-0" />
            </div>
          </Link>
        )}

        {/* Not in payroll yet — the highest-value leak: housed people whose rent
            isn't being deducted at all. (Stage 3e tray.) */}
        {unlinked.data && unlinked.data.count > 0 && (
          <Link href="/zenople-review">
            <div className="flex items-center justify-between gap-2 rounded-md border border-risk/40 bg-risk-soft px-4 py-2.5 text-sm hover:brightness-95">
              <span className="flex items-center gap-2 text-risk">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>
                  <b>{unlinked.data.count}</b> housed but not in payroll —{" "}
                  <b className="tabular-nums">{formatUsdWhole(unlinked.data.totalMonthlyAtRisk)}/mo</b> at risk. Confirm them in Zenople.
                </span>
              </span>
              <ArrowRight className="h-4 w-4 text-risk shrink-0" />
            </div>
          </Link>
        )}

        {/* Money leaks — each one clicks into the records that fix it. */}
        {(() => {
          const items: { key: string; n: number; label: string; to: string }[] = [
            { key: "zero", n: leaks.zeroCharge.length, label: "occupied bed(s) with a $0 weekly charge", to: "/occupants" },
            { key: "rentNoOcc", n: leaks.rentNoOccupants.length, label: "propert(ies) we pay rent on with nobody housed", to: "/economics" },
            { key: "occNoRent", n: leaks.occupantsNoRent.length, label: "propert(ies) with people but $0 rent recorded", to: "/leases" },
            { key: "moveOut", n: leaks.moveOutStillCharged.length, label: "moved-out associate(s) still being charged", to: "/occupants" },
          ].filter((x) => x.n > 0);
          if (items.length === 0) return null;
          return (
            <Card className="overflow-hidden border-line">
              <div className="px-4 py-3 border-b border-line">
                <h2 className="font-semibold text-sm flex items-center gap-2 text-ink">
                  <AlertTriangle className="h-4 w-4 text-warn" /> Money leaks
                </h2>
              </div>
              <CardContent className="p-2 divide-y divide-line">
                {items.map((it) => (
                  <Link key={it.key} href={it.to} className="flex items-center justify-between gap-2 px-2 py-2 text-sm hover:bg-surface rounded">
                    <span className="flex items-center gap-2">
                      <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-md bg-risk-soft px-1.5 text-xs font-bold tabular-nums text-risk">{it.n}</span>
                      <span className="text-ink">{it.label}</span>
                    </span>
                    <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  </Link>
                ))}
              </CardContent>
            </Card>
          );
        })()}

        <div className="grid lg:grid-cols-3 gap-5">
          {/* Properties — all of them, worst gap first */}
          <Card className="lg:col-span-2 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h2 className="font-semibold text-sm flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-muted-foreground" /> Properties
              </h2>
              <Link href="/economics" className="text-xs text-primary hover:underline">Rent Recovery →</Link>
            </div>
            <div className="max-h-[28rem] overflow-y-auto overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Property</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead className="text-right">Recovered</TableHead>
                    <TableHead className="text-right">Gap</TableHead>
                    <TableHead className="text-right">Occ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {losing.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-6">
                        No properties yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    losing.map((r) => (
                      <TableRow key={r.propertyId} className="hover:bg-muted/40">
                        <TableCell className="font-medium">
                          <Link href={`/properties/${r.propertyId}`} className="hover:underline">{shortPropertyName(r.name)}</Link>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{customerName.get(r.customerId) ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatUsdWhole(r.monthlyRent)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatUsdWhole(r.recoveredMonthly)}</TableCell>
                        <TableCell className="text-right tabular-nums font-semibold text-red-600">{formatUsdWhole(r.recoveryGap)}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{r.occupancyRate == null ? "—" : `${Math.round(r.occupancyRate)}%`}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>

          {/* Needs attention */}
          <div className="space-y-5">
            <Card className="overflow-hidden">
              <div className="px-4 py-3 border-b flex items-center justify-between">
                <h2 className="font-semibold text-sm flex items-center gap-2">
                  <CalendarClock className="h-4 w-4 text-muted-foreground" /> Renewals · 90 days
                </h2>
                <span className="text-xs text-muted-foreground">{renewals.length}</span>
              </div>
              <CardContent className="p-3 space-y-1">
                {renewals.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nothing due soon.</p>
                ) : (
                  renewals.map(({ l, info, days }) => (
                    <Link key={l.id} href={`/leases/${l.id}`} className="flex items-center justify-between gap-2 text-sm hover:bg-muted/40 rounded px-1.5 py-1">
                      <span className="truncate">{propName.get(l.propertyId) ?? "—"}{l.unit ? ` · ${l.unit}` : ""}</span>
                      <Badge className={`${info!.badgeClass} text-[10px] shrink-0`}>{days < 0 ? `${Math.abs(days)}d past` : `${days}d`}</Badge>
                    </Link>
                  ))
                )}
              </CardContent>
            </Card>

            <Card className="overflow-hidden">
              <div className="px-4 py-3 border-b">
                <h2 className="font-semibold text-sm flex items-center gap-2">
                  <BedDouble className="h-4 w-4 text-muted-foreground" /> Beds
                </h2>
              </div>
              <CardContent className="p-3 grid grid-cols-2 gap-3">
                <div><div className="text-2xl font-semibold text-emerald-600 tabular-nums">{vacantReady}</div><div className="text-xs text-muted-foreground">vacant &amp; ready</div></div>
                <div><div className="text-2xl font-semibold text-amber-600 tabular-nums">{needsCleaning}</div><div className="text-xs text-muted-foreground">need cleaning</div></div>
              </CardContent>
            </Card>

            {notPlacedNames.length > 0 && (
              <Card className="overflow-hidden border-amber-300">
                <div className="px-4 py-3 border-b">
                  <h2 className="font-semibold text-sm flex items-center gap-2 text-amber-700">
                    <AlertTriangle className="h-4 w-4" /> Charged, not placed
                  </h2>
                </div>
                <CardContent className="p-3 text-sm">
                  <p className="text-muted-foreground mb-2">
                    {notPlacedNames.slice(0, 6).join(", ")}
                    {notPlacedNames.length > 6 ? `, +${notPlacedNames.length - 6} more` : ""}
                  </p>
                  <Link href="/roster"><Button variant="outline" size="sm" className="gap-1">Place them <ArrowRight className="h-3.5 w-3.5" /></Button></Link>
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        {/* Quick nav (Customers is the hub) */}
        <div className="flex flex-wrap gap-2">
          {QUICK.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href}>
              <Button variant="outline" size="sm" className="gap-1.5"><Icon className="h-4 w-4" />{label}</Button>
            </Link>
          ))}
        </div>
      </div>
    </MainLayout>
  );
}
