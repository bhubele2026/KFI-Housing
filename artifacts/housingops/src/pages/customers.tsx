import { useMemo } from "react";
import { useLocation } from "wouter";
import { MainLayout } from "@/components/layout/main-layout";
import { useData } from "@/context/data-store";
import { computePropertyEconomics } from "@/lib/property-economics";
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
}

/**
 * Customers — v2 redesign (mockup #cust): a grid of client cards. Each shows
 * the client's property count + states, people housed / beds, occupancy %, and
 * net/mo (collected − cost), computed from the shared property-economics helper.
 * Click → that client's overview.
 */
export default function Customers() {
  const [, navigate] = useLocation();
  const { customers, properties, leases, occupants, utilities, isLoading } = useData();

  const cards = useMemo(() => {
    const { rows } = computePropertyEconomics(properties, leases, occupants, utilities);
    const byCust = new Map<string, CustAgg>();
    for (const r of rows) {
      const e = byCust.get(r.customerId) ?? { props: 0, beds: 0, occ: 0, net: 0 };
      e.props += 1;
      e.beds += r.beds;
      e.occ += r.occupied;
      e.net += r.recoveredMonthly - r.monthlyCost;
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
      }))
      .filter((x): x is { c: (typeof customers)[number]; e: CustAgg; states: string } =>
        !!x.e && x.e.props > 0,
      )
      .sort((a, b) => a.c.name.localeCompare(b.c.name));
  }, [customers, properties, leases, occupants, utilities]);

  return (
    <MainLayout>
      <div className="mx-auto max-w-[1120px] px-6 pb-10 pt-4">
        <div className="mb-4">
          <h1 className="text-[21px] font-bold tracking-[-0.3px] text-ink">Customers</h1>
          <div className="mt-0.5 text-[13px] text-muted-foreground">
            {cards.length} active client{cards.length === 1 ? "" : "s"} · click a client to see their properties &amp; beds
          </div>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-[150px] animate-pulse rounded-2xl bg-panel" />
            ))}
          </div>
        ) : cards.length === 0 ? (
          <EmptyState
            title="No clients with active properties"
            hint="Add a customer and a property to see them here."
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map(({ c, e, states }) => {
              const occPct = e.beds > 0 ? Math.round((e.occ / e.beds) * 100) : null;
              const rows: ERow[] = [
                { label: "Housed", value: `${e.occ} / ${e.beds}` },
                { label: "Occupancy", value: occPct == null ? "—" : `${occPct}%` },
                { label: "Net / mo", value: fmtNet(e.net), tone: e.net >= 0 ? "ok" : "risk" },
              ];
              return (
                <EntityCard
                  key={c.id}
                  initials={initialsOf(c.name)}
                  accent={accentFor(c.name)}
                  name={c.name}
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
