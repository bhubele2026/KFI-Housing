import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { MainLayout } from "@/components/layout/main-layout";
import { useData } from "@/context/data-store";
import { computePropertyEconomics, type DeductionLite } from "@/lib/property-economics";
import { useListPayrollDeductions } from "@workspace/api-client-react";
import { formatUsdWhole } from "@/data/mockData";
import { netDisplay } from "@/lib/money-honesty";
import { shortPropertyName } from "@/lib/property-name";
import { Card, CardHead, Lab, Ring, AreaChart, Heatmap, type HeatKind } from "@/components/kit-v2";

/**
 * Dashboard (home) — the "how are we today" overview, built to
 * KFI_Housing_Redesign_Mockup_v2: occupancy ring · money-this-week · payroll
 * match · collected area chart · rent-coverage ring · property heatmap.
 * Every card clicks through. Figures are real (computePropertyEconomics +
 * payroll deductions + the Zenople roster/unlinked endpoints).
 */
export default function Dashboard() {
  const [, navigate] = useLocation();
  const { properties, leases, occupants, utilities, customers, beds } = useData();
  const dedQuery = useListPayrollDeductions();
  const deductions = (dedQuery.data ?? []) as unknown as (DeductionLite & { weeklyAmount?: number })[];

  const months = useMemo(
    () => Array.from(new Set(deductions.map((d) => (d.payWeekEndDate || "").slice(0, 7)).filter(Boolean))).sort().reverse(),
    [deductions],
  );
  const period = months[0] || "";
  const { rows, summary } = useMemo(
    () => computePropertyEconomics(properties, leases, occupants, utilities, deductions, period || undefined),
    [properties, leases, occupants, utilities, deductions, period],
  );

  const rosterCount = useQuery({
    queryKey: ["dash-roster-count"],
    queryFn: async () => {
      const r = await fetch("/api/roster/active");
      if (!r.ok) throw new Error(String(r.status));
      return (await r.json()) as { count: number };
    },
    retry: false,
    staleTime: 600_000,
  });
  const unlinked = useQuery({
    queryKey: ["dash-unlinked"],
    queryFn: async () => {
      const base = import.meta.env.BASE_URL ?? "/";
      const r = await fetch(`${base}api/zenople/unlinked`);
      if (!r.ok) throw new Error(String(r.status));
      return (await r.json()) as { count: number; totalMonthlyAtRisk: number };
    },
    retry: false,
    staleTime: 300_000,
  });
  const attention = useQuery({
    queryKey: ["dash-attention"],
    queryFn: async () => {
      const base = import.meta.env.BASE_URL ?? "/";
      const r = await fetch(`${base}api/attention`);
      if (!r.ok) throw new Error(String(r.status));
      return (await r.json()) as {
        rows: { kind: string; label: string; dollarsAtRisk: number; fixHref: string }[];
        totalAtRisk: number;
      };
    },
    retry: false,
    staleTime: 300_000,
  });

  const weeklyByOcc = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of deductions) {
      if (!d.occupantId) continue;
      const w = Number((d as { weeklyAmount?: number }).weeklyAmount) || 0;
      if (w > (m.get(d.occupantId) ?? 0)) m.set(d.occupantId, w);
    }
    return m;
  }, [deductions]);

  const placed = useMemo(
    () => occupants.filter((o) => (o as { bedId?: string }).bedId && (o as { status?: string }).status === "Active"),
    [occupants],
  );
  const atRisk = placed.filter((o) => !((weeklyByOcc.get(o.id) ?? Number((o as { chargePerBed?: number }).chargePerBed) ?? 0) > 0)).length;
  const vacantReady = beds.filter((b) => (b as { status?: string }).status === "Vacant" && (b as { cleaningStatus?: string }).cleaningStatus === "ready").length;

  // #30 empty-bed nudge — weekly cost of open-ready beds (rent / beds-in-prop,
  // monthly→weekly). Properties with $0 rent contribute nothing (no guessing).
  const idleWeekly = useMemo(() => {
    const bedsPerProp = new Map<string, number>();
    for (const b of beds) {
      const pid = (b as { propertyId?: string }).propertyId;
      if (pid) bedsPerProp.set(pid, (bedsPerProp.get(pid) ?? 0) + 1);
    }
    let w = 0;
    for (const b of beds) {
      if ((b as { status?: string }).status !== "Vacant" || (b as { cleaningStatus?: string }).cleaningStatus !== "ready") continue;
      const pid = (b as { propertyId?: string }).propertyId;
      const p = properties.find((pp) => pp.id === pid) as { monthlyRent?: number } | undefined;
      const rent = Number(p?.monthlyRent) || 0;
      const tb = (pid && bedsPerProp.get(pid)) || 1;
      if (rent) w += (rent / tb) * (12 / 52);
    }
    return w;
  }, [beds, properties]);

  const totalBeds = summary.totalBeds || beds.length;
  const occupied = summary.totalOccupied || placed.length;
  const collected = summary.totalRecovered;
  const rent = summary.totalRentCost;
  const coverage = rent > 0 ? Math.round((collected / rent) * 100) : null;

  // weekly collected series (Jun 1 2026 floor) for the area chart
  const weekly = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of deductions) {
      const wk = (d.payWeekEndDate || "").slice(0, 10);
      if (!wk || wk < "2026-06-01") continue;
      m.set(wk, (m.get(wk) ?? 0) + (Number((d as { weeklyAmount?: number }).weeklyAmount) || 0));
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [deductions]);
  const series = weekly.map(([, v]) => v);
  const latestWeek = series[series.length - 1] ?? collected;

  // payroll match
  const base = rosterCount.data?.count ?? placed.length;
  const notInPayroll = unlinked.data?.count ?? 0;
  const linked = Math.max(0, base - notInPayroll - atRisk);
  const pctOf = (n: number) => (base > 0 ? Math.round((n / base) * 100) : 0);

  // property heatmap
  const heat = useMemo(() => {
    const occByProp = new Map<string, number>();
    const zeroByProp = new Set<string>();
    for (const o of placed) {
      const pid = (o as { propertyId?: string }).propertyId;
      if (!pid) continue;
      occByProp.set(pid, (occByProp.get(pid) ?? 0) + 1);
      if (!((weeklyByOcc.get(o.id) ?? Number((o as { chargePerBed?: number }).chargePerBed) ?? 0) > 0)) zeroByProp.add(pid);
    }
    return rows
      .filter((r) => (properties.find((p) => p.id === r.propertyId) as { status?: string } | undefined)?.status !== "Inactive")
      .map((r) => {
        let kind: HeatKind;
        if (zeroByProp.has(r.propertyId)) kind = "r";
        else {
          const occPct = r.occupancyRate ?? 0;
          kind = occPct >= 95 ? "f" : occPct >= 70 ? "h" : "m";
        }
        return { kind, title: `${shortPropertyName(r.name)} · ${Math.round(r.occupancyRate ?? 0)}%`, onClick: () => navigate(`/properties/${r.propertyId}`) };
      });
  }, [rows, placed, weeklyByOcc, properties, navigate]);

  const Bar = ({ pct, color }: { pct: number; color: string }) => (
    <div className="my-[7px] h-[9px] overflow-hidden rounded-[6px] bg-track">
      <span className="block h-full rounded-[6px]" style={{ width: `${Math.min(100, pct)}%`, background: `hsl(var(--${color}))` }} />
    </div>
  );
  const Kv = ({ label, value }: { label: React.ReactNode; value: React.ReactNode }) => (
    <div className="flex items-center justify-between border-t border-line py-[7px] text-[13.5px] first:border-t-0">
      <span>{label}</span>
      <span className="font-bold tabular-nums">{value}</span>
    </div>
  );

  return (
    <MainLayout>
      <div className="mx-auto max-w-[1180px] px-6 pb-10 pt-2">
        {/* needs attention — refinement #1 */}
        {(() => {
          const aRows = [...(attention.data?.rows ?? [])].sort((a, b) => (Number(b.dollarsAtRisk) || 0) - (Number(a.dollarsAtRisk) || 0));
          const aTotal = Number(attention.data?.totalAtRisk) || 0;
          if (attention.isLoading || (aRows.length === 0 && vacantReady === 0)) return null;
          return (
            <Card className="mb-4 border-l-4 border-l-risk">
              <CardHead
                label={<span className="text-risk">Needs attention{aTotal > 0 ? ` — ${formatUsdWhole(aTotal)}/mo at risk` : ""}</span>}
                link={<span className="cursor-pointer text-[12.5px] font-semibold text-brand" onClick={() => navigate("/attention")}>See all →</span>}
              />
              {aRows.slice(0, 4).map((r, i) => (
                <div key={`${r.kind}-${i}`} className="flex items-center justify-between border-t border-line py-2 text-[13.5px] first:border-t-0">
                  <span className="text-ink">{r.label}</span>
                  <span className="flex items-center gap-3">
                    <span className="font-bold tabular-nums text-risk">{formatUsdWhole(Number(r.dollarsAtRisk) || 0)}</span>
                    <span className="cursor-pointer font-semibold text-brand" onClick={() => navigate(r.fixHref || "/attention")}>Fix →</span>
                  </span>
                </div>
              ))}
              {vacantReady > 0 && (
                <div className="mt-2 border-t border-line pt-2 text-[12.5px] text-muted-foreground">
                  {vacantReady} open bed{vacantReady === 1 ? "" : "s"} ready
                  {idleWeekly > 0 ? <> — about <span className="font-bold tabular-nums text-ink">{formatUsdWhole(idleWeekly)}/wk</span> sitting idle</> : <> (set property rent to see the cost)</>}
                  {" · "}
                  <span className="cursor-pointer font-semibold text-brand" onClick={() => navigate("/properties")}>fill them →</span>
                </div>
              )}
            </Card>
          );
        })()}

        {/* row 1 */}
        <div className="mb-4 grid gap-4 md:grid-cols-3">
          <Card>
            <CardHead label="Occupancy" link={<span className="cursor-pointer text-[12.5px] font-semibold text-brand" onClick={() => navigate("/properties")}>Properties →</span>} />
            <div className="flex items-center gap-[18px]">
              <Ring size={128} fraction={totalBeds ? occupied / totalBeds : 0} color="grad1" inner={{ fraction: totalBeds ? atRisk / totalBeds : 0, color: "risk" }} centerLabel={String(occupied)} centerSub="BEDS FULL" />
              <div className="flex-1">
                <Kv label={<span><span className="text-ink">●</span> Occupied</span>} value={occupied} />
                <Kv label={<span className="text-warn">● Open</span>} value={vacantReady} />
                <Kv label={<span className="text-risk">● At-risk ($0)</span>} value={atRisk} />
              </div>
            </div>
          </Card>

          <Card>
            <CardHead label="Money — this period" link={<span className="cursor-pointer text-[12.5px] font-semibold text-brand" onClick={() => navigate("/finance")}>Review →</span>} />
            {/* Phase 1 — money honesty via the single shared helper. A spread
                driven by housed people who aren't collecting yet ($0-deduction)
                is NOT a real loss. Layout unchanged; only the false-neg logic. */}
            {(() => {
              const nd = netDisplay({ collected, rent, housed: occupied, zeroDeduction: atRisk });
              return nd.kind !== "net" ? (
                <>
                  <div className="text-[27px] font-extrabold text-ink">{nd.kind === "syncing" ? "Syncing…" : "—"}</div>
                  <div className="mb-3 text-[12.5px] text-muted-foreground">{nd.label}</div>
                </>
              ) : (
                <>
                  <div className={`text-[27px] font-extrabold ${nd.value >= 0 ? "text-ok" : "text-risk"}`}>{nd.value >= 0 ? "+" : ""}{formatUsdWhole(nd.value)}</div>
                  <div className="mb-3 text-[12.5px] text-muted-foreground">net spread (collected − rent)</div>
                </>
              );
            })()}
            <Kv label="Collected (deductions)" value={formatUsdWhole(collected)} />
            <Kv label="Rent we pay" value={formatUsdWhole(rent)} />
            <Kv label="Utilities" value={formatUsdWhole((summary as { totalUtilities?: number }).totalUtilities ?? 0)} />
          </Card>

          <Card>
            <CardHead label="Payroll match (Zenople)" link={<span className="cursor-pointer text-[12.5px] font-semibold text-brand" onClick={() => navigate("/roster")}>Review →</span>} />
            <div className="flex justify-between text-xs text-muted-foreground"><span>Linked</span><span><b className="text-ink">{linked}</b> / {base}</span></div>
            <Bar pct={pctOf(linked)} color="brand" />
            <div className="mt-3 flex justify-between text-xs"><span className="text-muted-foreground">Not in payroll yet</span><b>{notInPayroll}</b></div>
            <Bar pct={pctOf(notInPayroll)} color="faint" />
            <div className="mt-3 flex justify-between text-xs"><span className="text-risk">$0 deduction (housed)</span><b className="text-risk">{atRisk}</b></div>
            <Bar pct={pctOf(atRisk)} color="risk" />
          </Card>
        </div>

        {/* row 2 */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHead label="Collected — Jun → now" />
            <div className="text-[26px] font-extrabold text-ink">{formatUsdWhole(latestWeek)}<span className="text-[13px] font-semibold text-muted-foreground"> /wk</span></div>
            <div className="mt-2"><AreaChart points={series.length >= 2 ? series : [0, latestWeek]} /></div>
          </Card>

          <Card className="flex flex-col items-center">
            <Lab className="self-start">Rent coverage</Lab>
            <Ring size={148} stroke={13} fraction={coverage == null ? 0 : Math.min(1, coverage / 100)} color="ok" centerLabel={coverage == null ? "—" : `${coverage}%`} centerSub="COLLECTED vs RENT" />
            <div className="text-[12.5px] text-muted-foreground">{formatUsdWhole(collected)} collected · {formatUsdWhole(rent)} rent</div>
          </Card>

          <Card>
            <CardHead label="Properties" link={<span className="cursor-pointer text-[12.5px] font-semibold text-brand" onClick={() => navigate("/properties")}>All →</span>} />
            {heat.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No properties yet.</p>
            ) : (
              <Heatmap cells={heat} />
            )}
            <div className="mt-3.5 flex flex-wrap gap-2.5 text-xs text-muted-foreground">
              <span><span style={{ color: "hsl(var(--grad1))" }}>●</span> full</span>
              <span><span style={{ color: "hsl(var(--brand2))" }}>●</span> high</span>
              <span><span style={{ color: "#9DC0F5" }}>●</span> open</span>
              <span><span className="text-risk">●</span> at risk</span>
            </div>
          </Card>
        </div>
      </div>
    </MainLayout>
  );
}
