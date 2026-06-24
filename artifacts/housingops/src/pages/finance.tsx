import { useEffect, useMemo, useState, type ReactNode } from "react";
import { MainLayout } from "@/components/layout/main-layout";
import { useData } from "@/context/data-store";
import {
  Card,
  CardHead,
  StatCard,
  Seg,
  DataTable,
  EmptyState,
  type Column,
} from "@/components/kit-v2";
import {
  FinancePayrollWeeklyTab,
  FinancePayrollMonthlyTab,
  FinancePayrollByCustomerTab,
} from "@/components/finance-payroll-tabs";

// ---------------------------------------------------------------------------
// Money — week review (v2 redesign, KFI_Housing_Redesign_Mockup_v2 #money).
// Primary view is the period KPIs + week-diff + who-was-deducted table; the
// detailed payroll tabs (weekly/monthly/by-customer) stay reachable below.
// History floor = Jun 1 2026. Month/quarter exactness is Phase 2 — we show
// what the period endpoint returns.
// ---------------------------------------------------------------------------

type Kind = "this-week" | "last-week" | "this-month" | "last-month" | "this-quarter";
const KINDS: { value: Kind; label: string }[] = [
  { value: "this-week", label: "This week" },
  { value: "last-week", label: "Last week" },
  { value: "this-month", label: "This month" },
  { value: "last-month", label: "Last month" },
  { value: "this-quarter", label: "This quarter" },
];

const baseUrl = (): string => import.meta.env.BASE_URL ?? "/";
function num(x: unknown): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}
function fmt$(n: number, cents = false): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  }).format(n || 0);
}
/** Most recent Saturday (the pay-week end the diff is keyed on). */
function lastSaturday(): string {
  const d = new Date();
  const back = (d.getDay() + 1) % 7; // 0=Sun..6=Sat → days since Saturday
  d.setDate(d.getDate() - back);
  return d.toISOString().slice(0, 10);
}

interface PeriodResp {
  periodKey?: string;
  current?: { collected?: number; rent?: number; net?: number; weeks?: number; properties?: number };
  prior?: { collected?: number; rent?: number; net?: number };
  delta?: { collected?: number; rent?: number; net?: number };
  reviewed?: boolean;
}
interface DiffPerson { name?: string; weekly?: number; prior?: number; current?: number }
interface DiffResp {
  counts?: { new?: number; stopped?: number; changed?: number };
  added?: DiffPerson[];
  stopped?: DiffPerson[];
  changed?: DiffPerson[];
}

export default function FinancePage() {
  const data = useData() as unknown as {
    occupants?: Array<Record<string, unknown>>;
    properties?: Array<Record<string, unknown>>;
  };
  const occupants = data.occupants ?? [];
  const properties = data.properties ?? [];
  const propName = (id: unknown): string => {
    const p = properties.find((x) => x.id === id) as { name?: string } | undefined;
    return (p?.name as string) || String(id ?? "—");
  };

  const [kind, setKind] = useState<Kind>("last-week");
  const [period, setPeriod] = useState<PeriodResp | null>(null);
  const [diff, setDiff] = useState<DiffResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [reviewed, setReviewed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showDetail, setShowDetail] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const week = lastSaturday();
    Promise.allSettled([
      fetch(`${baseUrl()}api/finance/period?kind=${kind}`).then((r) => (r.ok ? r.json() : Promise.reject())),
      fetch(`${baseUrl()}api/finance/week-diff?week=${week}`).then((r) => (r.ok ? r.json() : Promise.reject())),
    ]).then(([p, d]) => {
      if (!alive) return;
      const pv = p.status === "fulfilled" ? (p.value as PeriodResp) : null;
      setPeriod(pv);
      setDiff(d.status === "fulfilled" ? (d.value as DiffResp) : null);
      setReviewed(!!pv?.reviewed);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [kind]);

  // "Who was deducted" + People count come from the occupant deduction objects.
  const deducted = useMemo(
    () =>
      occupants
        .map((o) => ({
          name: (o.fullName as string) || (o.name as string) || "—",
          company: (o.company as string) || "",
          propertyId: o.propertyId,
          ded: o.deduction as { weeklyAmount?: number; payWeekEndDate?: string } | undefined,
        }))
        .filter((o) => num(o.ded?.weeklyAmount) > 0)
        .sort((a, b) => num(b.ded?.weeklyAmount) - num(a.ded?.weeklyAmount))
        .slice(0, 60),
    [occupants],
  );
  const peopleCount = useMemo(
    () => occupants.filter((o) => num((o.deduction as { weeklyAmount?: number } | undefined)?.weeklyAmount) > 0).length,
    [occupants],
  );

  const cur = period?.current ?? {};
  const delta = period?.delta ?? {};
  const counts = diff?.counts ?? {};
  const peopleDelta = num(counts.new) - num(counts.stopped);

  const deltaSub = (v: unknown, money = true): ReactNode => {
    if (!period) return undefined;
    const n = num(v);
    const arrow = n >= 0 ? "▲" : "▼";
    return (
      <span className={n >= 0 ? "text-ok" : "text-risk"}>
        {arrow} {money ? fmt$(Math.abs(n)) : Math.abs(n)} vs prior
      </span>
    );
  };

  async function markReviewed() {
    if (!period?.periodKey) return;
    setSaving(true);
    try {
      await fetch(`${baseUrl()}api/finance/week-review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodKey: period.periodKey }),
      });
      setReviewed(true);
    } catch {
      /* non-fatal */
    } finally {
      setSaving(false);
    }
  }

  const dedCols: Column<(typeof deducted)[number]>[] = [
    { header: "Associate", cell: (r) => r.name, align: "left" },
    {
      header: "Client → property",
      align: "left",
      cell: (r) => (
        <span className="text-muted-foreground">
          {r.company ? `${r.company} → ` : ""}
          {propName(r.propertyId)}
        </span>
      ),
    },
    { header: "Pay-week", cell: (r) => r.ded?.payWeekEndDate || "—" },
    { header: "Amount", cell: (r) => fmt$(num(r.ded?.weeklyAmount), true) },
  ];

  return (
    <MainLayout>
      <div className="mb-4">
        <h1 className="text-[21px] font-bold tracking-[-0.3px] text-ink">Money — week review</h1>
        <div className="mt-1 text-[13px] text-muted-foreground">
          One row per associate per pay-week · history from June 2026
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Seg options={KINDS} value={kind} onChange={setKind} />
        <span className="ml-auto text-[12px] text-faint">Floor: Jun 1, 2026</span>
      </div>

      {/* KPIs */}
      <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Deducted" value={loading ? "…" : fmt$(num(cur.collected))} sub={deltaSub(delta.collected)} />
        <StatCard label="People" value={loading ? "…" : peopleCount} sub={deltaSub(peopleDelta, false)} />
        <StatCard
          label="Rent paid"
          value={loading ? "…" : fmt$(num(cur.rent))}
          sub={`${num(cur.properties) || properties.length} properties`}
        />
        <StatCard
          label="Net spread"
          value={loading ? "…" : fmt$(num(cur.net))}
          tone={num(cur.net) < 0 ? "risk" : "ok"}
          sub={deltaSub(delta.net)}
        />
      </div>

      {/* Week diff */}
      <Card className="mb-4">
        <CardHead
          label="What changed vs the week before"
          link={
            <button
              type="button"
              onClick={markReviewed}
              disabled={saving || reviewed || !period?.periodKey}
              className="font-semibold text-brand disabled:opacity-60"
            >
              {reviewed ? "✓ Reviewed" : saving ? "Saving…" : "✓ Mark week reviewed"}
            </button>
          }
        />
        {!diff ? (
          <EmptyState title={loading ? "Loading…" : "Week diff unavailable"} hint={loading ? undefined : "Zenople may be unreachable — try again shortly."} />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3">
            <DiffCol title={`＋ New (${num(counts.new)})`} tone="ok" rows={diff.added ?? []} render={(p) => `+${fmt$(num(p.weekly))}`} />
            <DiffCol title={`－ Stopped (${num(counts.stopped)})`} tone="risk" rows={diff.stopped ?? []} render={(p) => `−${fmt$(num(p.weekly))}`} />
            <DiffCol title={`≠ Changed (${num(counts.changed)})`} tone="warn" rows={diff.changed ?? []} render={(p) => `${fmt$(num(p.prior))}→${fmt$(num(p.current))}`} />
          </div>
        )}
      </Card>

      {/* Who was deducted */}
      <Card>
        <CardHead label={`Who was deducted (top ${deducted.length} of ${peopleCount})`} />
        <DataTable
          columns={dedCols}
          rows={deducted}
          getKey={(r, i) => `${r.name}-${i}`}
          empty={<EmptyState title="No deductions yet" hint="Once payroll deductions sync, everyone housed shows here." />}
        />
      </Card>

      {/* Detailed payroll views kept reachable */}
      <div className="mt-4">
        <button
          type="button"
          onClick={() => setShowDetail((v) => !v)}
          className="text-[12.5px] font-semibold text-brand"
        >
          {showDetail ? "Hide detailed payroll views" : "Detailed payroll views (weekly · monthly · by client) →"}
        </button>
        {showDetail && (
          <div className="mt-3 space-y-4">
            <Card><CardHead label="By pay-week" /><FinancePayrollWeeklyTab customerFilter="" /></Card>
            <Card><CardHead label="By month" /><FinancePayrollMonthlyTab customerFilter="" /></Card>
            <Card><CardHead label="By client" /><FinancePayrollByCustomerTab customerFilter="" /></Card>
          </div>
        )}
      </div>
    </MainLayout>
  );
}

function DiffCol({
  title,
  tone,
  rows,
  render,
}: {
  title: string;
  tone: "ok" | "risk" | "warn";
  rows: DiffPerson[];
  render: (p: DiffPerson) => string;
}) {
  const toneClass = tone === "ok" ? "text-ok" : tone === "risk" ? "text-risk" : "text-warn";
  return (
    <div className="border-line px-3.5 py-1 [&:not(:last-child)]:border-r">
      <div className={`mb-2 text-[11px] font-extrabold uppercase tracking-[0.5px] ${toneClass}`}>{title}</div>
      {rows.length === 0 ? (
        <div className="py-1 text-[12.5px] text-faint">—</div>
      ) : (
        rows.slice(0, 8).map((p, i) => (
          <div key={i} className="flex justify-between border-t border-dotted border-line py-1 text-[12.5px]">
            <span className="truncate">{p.name || "—"}</span>
            <span className="tabular-nums">{render(p)}</span>
          </div>
        ))
      )}
    </div>
  );
}
