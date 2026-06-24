import { useMemo, type ReactNode } from "react";
import { Link, useParams, useLocation } from "wouter";
import { MainLayout } from "@/components/layout/main-layout";
import { useData } from "@/context/data-store";
import {
  toMonthlyCharge,
  formatUsd,
  sumCustomerResponsibleRent,
  sumOtherCostsForProperty,
} from "@/data/mockData";
import { Card, CardHead, StatCard, Ring, WhyPopover, type WhyRow } from "@/components/kit-v2";
import { NotFoundScreen } from "@/components/not-found-screen";

/** Signed money, mockup style: +$1,518 / −$210. */
function net$(n: number): string {
  return (n < 0 ? "−" : "+") + formatUsd(Math.abs(Math.round(n)));
}
const weeklyOf = (o: { chargePerBed?: number; deduction?: { weeklyAmount?: number } }): number =>
  (o.deduction?.weeklyAmount ?? o.chargePerBed ?? 0);

/**
 * Customer overview — v2 redesign + Consolidated Fix #1. A full client cockpit:
 * rich KPI set, every figure clickable via WhyPopover (formula + numbers +
 * source link), the properties list (each → its bed board), and a money card
 * whose ring shows recovery % (net sits beside it — no overlap).
 */
export default function CustomerDetail() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { customers, properties, beds, occupants, leases, otherCosts, isLoading } = useData();

  const customer = customers.find((c) => c.id === id);

  const view = useMemo(() => {
    if (!id) return null;
    const props = properties.filter(
      (p) =>
        p.customerId === id ||
        ((p as { sharedWithCustomerIds?: string[] }).sharedWithCustomerIds ?? []).includes(id),
    );
    const propIds = new Set(props.map((p) => p.id));

    const statFor = (p: (typeof props)[number]) => {
      const pb = beds.filter((b) => b.propertyId === p.id);
      const total = pb.length;
      const occ = pb.filter((b) => b.status === "Occupied").length;
      const open = pb.filter(
        (b) => b.status === "Vacant" && (b as { cleaningStatus?: string }).cleaningStatus === "ready",
      ).length;
      const occs = occupants.filter(
        (o) => o.propertyId === p.id && (o.status ?? "Active") !== "Former",
      );
      const collected = occs.reduce(
        (s, o) => s + toMonthlyCharge(o.chargePerBed || 0, o.billingFrequency ?? "Monthly"),
        0,
      );
      const rent = Number((p as { monthlyRent?: number }).monthlyRent) || 0;
      const util = sumOtherCostsForProperty(otherCosts, p.id);
      return { p, total, occ, open, collected, rent, util, net: collected - rent - util };
    };

    const perProp = props.map(statFor).sort((a, b) => b.net - a.net);
    const capacity = perProp.reduce((s, x) => s + x.total, 0);
    const occupied = perProp.reduce((s, x) => s + x.occ, 0);
    const open = perProp.reduce((s, x) => s + x.open, 0);
    const placedOccs = occupants.filter(
      (o) => propIds.has(o.propertyId ?? "") && (o.status ?? "Active") !== "Former",
    );
    const housed = placedOccs.length;
    const notInPayroll = placedOccs.filter(
      (o) => ((o as { zenopleStatus?: string }).zenopleStatus ?? "pending") !== "linked",
    ).length;
    const zeroDeduction = placedOccs.filter(
      (o) => !!o.bedId && weeklyOf(o as { chargePerBed?: number; deduction?: { weeklyAmount?: number } }) === 0,
    ).length;
    const needsCleaning = beds.filter(
      (b) => propIds.has(b.propertyId) && (b as { cleaningStatus?: string }).cleaningStatus === "needs_cleaning",
    ).length;
    const collected = perProp.reduce((s, x) => s + x.collected, 0);
    const rent = sumCustomerResponsibleRent(leases, properties, id);
    const utilities = perProp.reduce((s, x) => s + x.util, 0);
    const cities = [...new Set(props.map((p) => (p as { city?: string }).city).filter(Boolean))];
    const aptCount = props.filter((p) => /apart/i.test(String((p as { type?: string }).type ?? ""))).length;
    const occPct = capacity > 0 ? Math.round((occupied / capacity) * 100) : 0;

    return {
      perProp, capacity, occupied, open, housed, collected, rent, utilities,
      net: collected - rent - utilities, cities, occPct,
      collectedWeekly: Math.round((collected * 12) / 52),
      rentWeekly: Math.round((rent * 12) / 52),
      avgRentBed: capacity > 0 ? Math.round(rent / capacity) : 0,
      notInPayroll, zeroDeduction, needsCleaning,
      propCount: props.length, aptCount, motelCount: props.length - aptCount,
    };
  }, [id, properties, beds, occupants, leases, otherCosts]);

  if (isLoading && !customer) {
    return (
      <MainLayout>
        <div className="mx-auto max-w-[1120px] px-6 py-5">
          <div className="h-40 animate-pulse rounded-[18px] bg-panel" />
        </div>
      </MainLayout>
    );
  }
  if (!customer || !view) {
    return (
      <MainLayout>
        <NotFoundScreen title="Client not found" description="This client may have been removed." />
      </MainLayout>
    );
  }

  const bedsHref = `/customers/${id}/beds`;
  // A KPI card whose value explains itself + links to the rows behind it.
  const KPI = (props: {
    label: string;
    value: ReactNode;
    sub?: string;
    tone?: "ink" | "ok" | "warn" | "risk" | "brand";
    title: string;
    formula: string;
    rows: WhyRow[];
    href: string;
  }) => (
    <StatCard
      label={props.label}
      tone={props.tone}
      sub={props.sub}
      value={
        <WhyPopover title={props.title} formula={props.formula} rows={props.rows} href={props.href}>
          {props.value}
        </WhyPopover>
      }
    />
  );

  return (
    <MainLayout>
      <div className="mx-auto max-w-[1120px] px-6 py-5">
        <div className="mb-4">
          <Link href="/customers" className="mb-1.5 inline-block text-[13px] font-semibold text-brand">
            ← Customers
          </Link>
          <h1 className="text-[21px] tracking-[-0.3px] text-ink" data-testid="customer-detail-name">{customer.name}</h1>
          <div className="mt-0.5 text-[13px] text-muted-foreground tabular-nums">
            {view.propCount} properties · {view.capacity} beds · {view.occPct}% full
            {view.cities.length > 0 ? ` · ${view.cities.join(" & ")}` : ""}
            {" · "}
            <Link href={bedsHref} className="font-semibold text-brand">manage all beds →</Link>
          </div>
        </div>

        {/* KPI cockpit — every figure clickable + why */}
        <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-4">
          <KPI label="Properties" value={view.propCount} sub={`${view.aptCount} apts · ${view.motelCount} motel`}
            title="Properties" formula="Active + shared properties for this client" rows={[{ k: "Apartments", v: view.aptCount }, { k: "Other", v: view.motelCount }]} href="/properties" />
          <KPI label="Housed" value={view.housed} sub={`of ${view.capacity} beds`}
            title="Housed" formula="Active occupants in this client's properties" rows={[{ k: "Housed", v: view.housed }, { k: "Capacity", v: view.capacity }]} href={bedsHref} />
          <KPI label="Occupancy" value={`${view.occPct}%`} tone={view.occPct >= 85 ? "ok" : "warn"} sub="occupied ÷ beds"
            title="Occupancy %" formula="Occupied beds ÷ total beds" rows={[{ k: "Occupied", v: view.occupied }, { k: "Beds", v: view.capacity }]} href={bedsHref} />
          <KPI label="Open beds" value={view.open} tone="warn" sub="ready now"
            title="Open beds" formula="Vacant beds that are clean & ready" rows={[{ k: "Open & ready", v: view.open }]} href={bedsHref} />

          <KPI label="Net / mo" value={net$(view.net)} tone={view.net < 0 ? "risk" : "ok"} sub="collected − rent − util"
            title="Net / mo" formula="Collected − Rent we pay − Utilities" rows={[{ k: "Collected", v: formatUsd(view.collected) }, { k: "Rent", v: formatUsd(view.rent) }, { k: "Utilities", v: formatUsd(view.utilities) }]} href="/finance" />
          <KPI label="Collected / wk" value={formatUsd(view.collectedWeekly)} sub="deductions"
            title="Collected / wk" formula="Monthly collected × 12 ÷ 52" rows={[{ k: "Collected / mo", v: formatUsd(view.collected) }]} href="/finance" />
          <KPI label="Rent / wk" value={formatUsd(view.rentWeekly)} sub="we pay"
            title="Rent / wk" formula="Monthly rent × 12 ÷ 52" rows={[{ k: "Rent / mo", v: formatUsd(view.rent) }]} href="/finance" />
          <KPI label="Avg rent / bed" value={formatUsd(view.avgRentBed)} sub="rent ÷ beds"
            title="Avg rent / bed" formula="Monthly rent ÷ total beds" rows={[{ k: "Rent / mo", v: formatUsd(view.rent) }, { k: "Beds", v: view.capacity }]} href="/finance" />

          <KPI label="Not in payroll" value={view.notInPayroll} tone={view.notInPayroll > 0 ? "warn" : "ink"} sub="not Zenople-linked"
            title="Not in payroll yet" formula="Housed people not linked to a Zenople payroll record" rows={[{ k: "Not linked", v: view.notInPayroll }, { k: "Housed", v: view.housed }]} href="/roster" />
          <KPI label="$0 deduction" value={view.zeroDeduction} tone={view.zeroDeduction > 0 ? "risk" : "ink"} sub="housed, $0/wk"
            title="$0 deduction" formula="Housed people with no weekly rent deducted (unrecovered)" rows={[{ k: "$0 deduction", v: view.zeroDeduction }]} href="/roster" />
          <KPI label="Needs cleaning" value={view.needsCleaning} tone={view.needsCleaning > 0 ? "warn" : "ink"} sub="beds in turnover"
            title="Needs cleaning" formula="Vacated beds awaiting turnover" rows={[{ k: "Needs cleaning", v: view.needsCleaning }]} href={bedsHref} />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHead
              label="Properties — click to manage beds"
              link={<Link href={bedsHref} className="text-[12.5px] font-semibold text-brand">All beds →</Link>}
            />
            <div className="space-y-3">
              {view.perProp.map(({ p, total, occ, open, net }) => {
                const pct = total > 0 ? occ / total : 0;
                return (
                  <div
                    key={p.id}
                    onClick={() => navigate(`/properties/${p.id}`)}
                    data-testid={`row-customer-property-${p.id}`}
                    className="flex cursor-pointer items-center gap-3.5 rounded-2xl bg-panel p-3 shadow-[0_1px_2px_rgba(16,24,40,.05),0_4px_14px_rgba(16,24,40,.06)] transition-all hover:-translate-y-0.5"
                  >
                    <Ring size={44} stroke={5} fraction={pct} color={pct >= 0.85 ? "grad1" : "warn"} centerLabel={`${Math.round(pct * 100)}`} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15px] font-bold text-ink">{p.name}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {(p as { city?: string }).city ?? ""} · {total} beds · {open} open
                      </div>
                    </div>
                    <b className={net < 0 ? "text-risk" : "text-ok"}>{net$(net)}</b>
                  </div>
                );
              })}
              {view.perProp.length === 0 && (
                <div className="py-6 text-center text-sm text-muted-foreground">No properties for this client yet.</div>
              )}
            </div>
          </Card>

          <Card>
            <CardHead
              label="This client — money"
              link={<Link href="/finance" className="text-[12.5px] font-semibold text-brand">Week review →</Link>}
            />
            {/* Ring shows recovery %; the net figure sits BESIDE it (no overlap). */}
            <div className="flex items-center gap-5">
              <Ring
                size={116}
                fraction={view.rent > 0 ? Math.min(1, view.collected / view.rent) : 0}
                color={view.net < 0 ? "risk" : "ok"}
                centerLabel={`${view.rent > 0 ? Math.round((view.collected / view.rent) * 100) : 0}%`}
                centerSub="RECOVERED"
              />
              <div className="flex-1">
                <div className="mb-2">
                  <div className="text-[11px] font-bold uppercase tracking-wide text-faint">Net / mo</div>
                  <WhyPopover
                    title="Net / mo"
                    formula="Collected − Rent we pay − Utilities"
                    rows={[{ k: "Collected", v: formatUsd(view.collected) }, { k: "Rent", v: formatUsd(view.rent) }, { k: "Utilities", v: formatUsd(view.utilities) }]}
                    href="/finance"
                  >
                    <span className={`text-[22px] font-extrabold tabular-nums ${view.net < 0 ? "text-risk" : "text-ok"}`}>{net$(view.net)}</span>
                  </WhyPopover>
                </div>
                <div className="flex items-center justify-between border-t border-line py-1.5 text-[13.5px]">
                  <span>Collected</span><span className="font-bold tabular-nums">{formatUsd(view.collected)}</span>
                </div>
                <div className="flex items-center justify-between border-t border-line py-1.5 text-[13.5px]">
                  <span>Rent we pay</span><span className="font-bold tabular-nums">{formatUsd(view.rent)}</span>
                </div>
                <div className="flex items-center justify-between border-t border-line py-1.5 text-[13.5px]">
                  <span>Utilities</span><span className="font-bold tabular-nums">{formatUsd(view.utilities)}</span>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </MainLayout>
  );
}
