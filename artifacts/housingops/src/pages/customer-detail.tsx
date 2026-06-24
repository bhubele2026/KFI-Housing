import { useMemo } from "react";
import { Link, useParams, useLocation } from "wouter";
import { MainLayout } from "@/components/layout/main-layout";
import { useData } from "@/context/data-store";
import {
  toMonthlyCharge,
  formatUsd,
  sumCustomerResponsibleRent,
  sumOtherCostsForProperty,
} from "@/data/mockData";
import { Card, CardHead, StatCard, Ring } from "@/components/kit-v2";
import { NotFoundScreen } from "@/components/not-found-screen";

/** Signed money, mockup style: +$1,518 / −$210. */
function net$(n: number): string {
  return (n < 0 ? "−" : "+") + formatUsd(Math.abs(Math.round(n)));
}

/**
 * Customer overview — v2 redesign (#custOv in KFI_Housing_Redesign_Mockup_v2).
 * Breadcrumb → 4 stat cards → Properties list (each → its bed board) + a
 * client money ring. Leads with properties so managers jump to beds fast.
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
    const housed = occupants.filter(
      (o) => propIds.has(o.propertyId ?? "") && (o.status ?? "Active") !== "Former",
    ).length;
    const collected = perProp.reduce((s, x) => s + x.collected, 0);
    const rent = sumCustomerResponsibleRent(leases, properties, id);
    const utilities = perProp.reduce((s, x) => s + x.util, 0);
    const cities = [...new Set(props.map((p) => (p as { city?: string }).city).filter(Boolean))];
    const aptCount = props.filter((p) => /apart/i.test(String((p as { type?: string }).type ?? ""))).length;

    return {
      perProp, capacity, occupied, open, housed, collected, rent, utilities,
      net: collected - rent - utilities, cities,
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

  const occPct = view.capacity > 0 ? Math.round((view.occupied / view.capacity) * 100) : 0;

  return (
    <MainLayout>
      <div className="mx-auto max-w-[1120px] px-6 py-5">
        <div className="mb-4">
          <Link href="/customers" className="mb-1.5 inline-block text-[13px] font-semibold text-brand">
            ← Customers
          </Link>
          <h1 className="text-[21px] tracking-[-0.3px] text-ink">{customer.name}</h1>
          <div className="mt-0.5 text-[13px] text-muted-foreground tabular-nums">
            {view.propCount} properties · {view.capacity} beds · {occPct}% full
            {view.cities.length > 0 ? ` · ${view.cities.join(" & ")}` : ""}
          </div>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard label="Properties" value={view.propCount} sub={`${view.aptCount} apts · ${view.motelCount} motel`} />
          <StatCard label="Housed" value={view.housed} sub={`of ${view.capacity} beds`} />
          <StatCard label="Open beds" value={view.open} sub="ready now" tone="warn" />
          <StatCard label="Net / mo" value={net$(view.net)} sub="collected − rent" tone={view.net < 0 ? "risk" : "ok"} />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHead label="Properties — click to manage beds" />
            <div className="space-y-3">
              {view.perProp.map(({ p, total, occ, open, net }) => {
                const pct = total > 0 ? occ / total : 0;
                return (
                  <div
                    key={p.id}
                    onClick={() => navigate(`/properties/${p.id}`)}
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
            <div className="flex items-center gap-5">
              <Ring
                size={116}
                fraction={view.rent > 0 ? Math.min(1, view.collected / view.rent) : 0}
                color={view.net < 0 ? "risk" : "ok"}
                centerLabel={net$(view.net)}
                centerSub="NET / MO"
              />
              <div className="flex-1">
                <div className="flex items-center justify-between border-b border-line py-1.5 text-[13.5px]">
                  <span>Collected</span><span className="font-bold tabular-nums">{formatUsd(view.collected)}</span>
                </div>
                <div className="flex items-center justify-between border-b border-line py-1.5 text-[13.5px]">
                  <span>Rent we pay</span><span className="font-bold tabular-nums">{formatUsd(view.rent)}</span>
                </div>
                <div className="flex items-center justify-between py-1.5 text-[13.5px]">
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
