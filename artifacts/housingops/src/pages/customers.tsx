import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { MainLayout } from "@/components/layout/main-layout";
import { useData } from "@/context/data-store";
import { computePropertyEconomics } from "@/lib/property-economics";
import { netDisplay } from "@/lib/money-honesty";
import {
  EntityCard,
  accentFor,
  initialsOf,
  EmptyState,
  type ERow,
} from "@/components/kit-v2";

/** "+$1,518" / "−$180" with a tabular minus. */
function fmtNet(n: number): string {
  const sign = n < 0 ? "−" : "+";
  return `${sign}$${Math.abs(Math.round(n)).toLocaleString()}`;
}

interface CustAgg {
  props: number;
  beds: number;
  occ: number;
  net: number;
  collected: number;
  cost: number;
}

/**
 * Customers — v2 redesign (mockup #cust): a grid of client cards. Each shows
 * the client's property count + states, people housed / beds, occupancy %, and
 * net/mo (collected − cost), computed from the shared property-economics helper.
 * Click → that client's overview.
 */
export default function Customers() {
  const [, navigate] = useLocation();
  const [showInactive, setShowInactive] = useState(false);
  // Defensive defaults — a briefly-undefined list must never throw into the
  // page ErrorBoundary (that throw is what paints the red fallback block).
  const {
    customers = [],
    properties = [],
    leases = [],
    occupants = [],
    utilities = [],
    isLoading,
  } = useData();

  const cards = useMemo(() => {
    const { rows } = computePropertyEconomics(properties, leases, occupants, utilities);
    const byCust = new Map<string, CustAgg>();
    for (const r of rows) {
      const e = byCust.get(r.customerId) ?? { props: 0, beds: 0, occ: 0, net: 0, collected: 0, cost: 0 };
      e.props += 1;
      e.beds += r.beds;
      e.occ += r.occupied;
      e.net += r.recoveredMonthly - r.monthlyCost;
      e.collected += r.recoveredMonthly;
      e.cost += r.monthlyCost;
      byCust.set(r.customerId, e);
    }
    // distinct states per client, from their properties
    const statesByCust = new Map<string, Set<string>>();
    for (const p of properties) {
      const cid = (p as { customerId?: string }).customerId ?? "";
      const st = (p as { state?: string }).state ?? "";
      if (!cid || !st) continue;
      const s = statesByCust.get(cid) ?? new Set<string>();
      s.add(st);
      statesByCust.set(cid, s);
    }
    return customers
      .map((c) => ({
        c,
        e: byCust.get(c.id),
        states: [...(statesByCust.get(c.id) ?? [])].sort().join(", "),
        isInactive: !!(c as { isInactive?: boolean }).isInactive,
      }))
      .filter((x): x is { c: (typeof customers)[number]; e: CustAgg; states: string; isInactive: boolean } =>
        !!x.e && x.e.props > 0,
      )
      .sort((a, b) => a.c.name.localeCompare(b.c.name));
  }, [customers, properties, leases, occupants, utilities]);

  // Item 1 — inactive customers drop out of the active list + counts, but stay
  // reachable behind a toggle.
  const activeCards = cards.filter((x) => !x.isInactive);
  const inactiveCount = cards.length - activeCards.length;
  const shown = showInactive ? cards : activeCards;

  return (
    <MainLayout>
      <div className="mx-auto max-w-[1120px] px-6 pb-10 pt-4">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[21px] font-bold tracking-[-0.3px] text-ink">Customers</h1>
            <div className="mt-0.5 text-[13px] text-muted-foreground">
              {activeCards.length} active client{activeCards.length === 1 ? "" : "s"} · click a client to see their properties &amp; beds
            </div>
          </div>
          {inactiveCount > 0 && (
            <button
              type="button"
              onClick={() => setShowInactive((v) => !v)}
              className="rounded-full border border-line bg-panel px-3 py-1.5 text-[12.5px] font-semibold text-ink2 transition-colors hover:bg-track"
              data-testid="toggle-inactive-customers"
            >
              {showInactive ? "Hide inactive" : `Show inactive (${inactiveCount})`}
            </button>
          )}
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-[150px] animate-pulse rounded-2xl bg-panel" />
            ))}
          </div>
        ) : shown.length === 0 ? (
          <EmptyState
            title="No clients with active properties"
            hint="Add a customer and a property to see them here."
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map(({ c, e, states, isInactive }) => {
              const occPct = e.beds > 0 ? Math.round((e.occ / e.beds) * 100) : null;
              // Item 5 — no bed inventory: a neutral "add a unit" state, never "x / 0" + "—".
              // Item 3 — money honesty: when people are housed but collections are still
              // syncing, show "syncing" not a scary red negative.
              const nd = netDisplay({ collected: e.collected, rent: e.cost, occupants: e.occ });
              const rows: ERow[] = e.beds === 0
                ? [{ label: "Beds", value: "No beds set — add a unit", tone: "ink" }]
                : [
                    { label: "Housed", value: `${e.occ} / ${e.beds}` },
                    { label: "Occupancy", value: occPct == null ? "—" : `${occPct}%` },
                    nd.kind === "syncing"
                      ? { label: "Net / mo", value: "rent set · syncing", tone: "ink" }
                      : { label: "Net / mo", value: fmtNet(nd.value), tone: nd.value >= 0 ? "ok" : "risk" },
                  ];
              return (
                <EntityCard
                  key={c.id}
                  initials={initialsOf(c.name)}
                  accent={accentFor(c.name)}
                  name={isInactive ? `${c.name} · Inactive` : c.name}
                  sub={`${e.props} ${e.props === 1 ? "property" : "properties"}${states ? ` · ${states}` : ""}`}
                  rows={rows}
                  onClick={() => navigate(`/customers/${c.id}`)}
                  testId={`customer-card-${c.id}`}
                />
              );
            })}
          </div>
        )}
      </div>
    </MainLayout>
  );
}
