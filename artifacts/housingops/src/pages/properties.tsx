import { useMemo, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useData } from "@/context/data-store";
import {
  Card,
  EntityCard,
  Seg,
  EmptyState,
  WhyPopover,
  accentFor,
  initialsOf,
  type ERow,
} from "@/components/kit-v2";
import { AddPropertyDialog } from "@/components/add-property/add-property-dialog";
import { netDisplay } from "@/lib/money-honesty";

const MO = 52 / 12;
const money = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(Math.round(n)).toLocaleString()}`;

/** Stop a figure's WhyPopover click from also firing the card's navigate. */
function NoNav({ children }: { children: ReactNode }) {
  return (
    <span onClick={(e) => e.stopPropagation()} role="presentation">
      {children}
    </span>
  );
}

export default function PropertiesPage() {
  const [, navigate] = useLocation();
  // Guard every list read so a briefly-undefined query never crashes the page.
  const {
    properties = [],
    beds = [],
    occupants = [],
    customers = [],
  } = useData();
  const [view, setView] = useState<"table" | "map">("table");
  const [addOpen, setAddOpen] = useState(false);
  const [clientFilter, setClientFilter] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [openOnly, setOpenOnly] = useState(false);
  const [atRiskOnly, setAtRiskOnly] = useState(false);

  const customerName = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of customers) m.set(c.id, c.name);
    return m;
  }, [customers]);

  const rows = useMemo(() => {
    const occByProp = new Map<string, number>();
    const totByProp = new Map<string, number>();
    for (const b of beds) {
      totByProp.set(b.propertyId, (totByProp.get(b.propertyId) ?? 0) + 1);
      if (b.status === "Occupied") occByProp.set(b.propertyId, (occByProp.get(b.propertyId) ?? 0) + 1);
    }
    const collectedByProp = new Map<string, number>();
    const activeByProp = new Map<string, number>();
    for (const o of occupants) {
      const oo = o as { propertyId?: string; bedId?: string; status?: string; chargePerBed?: number; deduction?: { weeklyAmount?: number } };
      if (!oo.propertyId || oo.status === "Former") continue;
      // Active occupants in scope (placed or not) — lets money-honesty tell
      // "empty property" apart from "people housed, deductions still syncing".
      activeByProp.set(oo.propertyId, (activeByProp.get(oo.propertyId) ?? 0) + 1);
      if (!oo.bedId) continue;
      const wk = oo.deduction?.weeklyAmount ?? oo.chargePerBed ?? 0;
      collectedByProp.set(oo.propertyId, (collectedByProp.get(oo.propertyId) ?? 0) + wk);
    }
    return properties
      .filter((p) => (p as { status?: string }).status !== "Inactive")
      .map((p) => {
        const total = totByProp.get(p.id) ?? 0;
        const occ = occByProp.get(p.id) ?? 0;
        const rent = (p as { monthlyRent?: number }).monthlyRent ?? 0;
        const collected = (collectedByProp.get(p.id) ?? 0) * MO;
        const occupantsCount = activeByProp.get(p.id) ?? 0;
        // Phase 11 — honest net: only a hard number when collected is real.
        const netInfo = netDisplay({ collected, rent, occupants: occupantsCount });
        return {
          p,
          total,
          occ,
          open: Math.max(0, total - occ),
          rent,
          collected,
          net: collected - rent,
          netInfo,
          occupantsCount,
          customerId: (p as { customerId?: string }).customerId ?? "",
          city: (p as { city?: string }).city ?? "",
          state: (p as { state?: string }).state ?? "",
          lat: (p as { lat?: number | null }).lat ?? null,
          lng: (p as { lng?: number | null }).lng ?? null,
        };
      })
      .sort((a, b) => a.p.name.localeCompare(b.p.name));
  }, [properties, beds, occupants]);

  const clientOpts = useMemo(
    () =>
      [...new Set(rows.map((r) => r.customerId).filter(Boolean))]
        .map((id) => ({ id, name: customerName.get(id) || "Unassigned" }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [rows, customerName],
  );
  const stateOpts = useMemo(
    () => [...new Set(rows.map((r) => r.state).filter(Boolean))].sort(),
    [rows],
  );

  const shown = rows.filter((r) => {
    if (clientFilter && r.customerId !== clientFilter) return false;
    if (stateFilter && r.state !== stateFilter) return false;
    if (openOnly && r.open <= 0) return false;
    // At-risk = a REAL negative net (not a property whose deductions are
    // still syncing — that's not a loss, just incomplete collections).
    if (atRiskOnly && !(r.netInfo.kind === "net" && r.netInfo.value < 0)) return false;
    return true;
  });
  const anyFilter = clientFilter || stateFilter || openOnly || atRiskOnly;
  const withCoords = shown.filter((r) => typeof r.lat === "number" && typeof r.lng === "number");

  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
      active
        ? "border-brand bg-brand text-white"
        : "border-line bg-panel text-muted-foreground hover:border-brand/40"
    }`;

  return (
    <section>
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-ink">Properties</h1>
          <p className="text-sm text-muted-foreground">
            {shown.length} of {rows.length} locations · click one to open its bed board · or drop a lease to add one
          </p>
        </div>
        <Seg
          value={view}
          onChange={(v) => setView(v as "table" | "map")}
          options={[
            { value: "table", label: "Grid" },
            { value: "map", label: "Map" },
          ]}
        />
      </div>

      {/* Filter chips */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select
          value={clientFilter}
          onChange={(e) => setClientFilter(e.target.value)}
          className="rounded-full border border-line bg-panel px-3 py-1 text-xs font-semibold text-ink"
          aria-label="Filter by client"
        >
          <option value="">All clients</option>
          {clientOpts.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value)}
          className="rounded-full border border-line bg-panel px-3 py-1 text-xs font-semibold text-ink"
          aria-label="Filter by state"
        >
          <option value="">All states</option>
          {stateOpts.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <button type="button" className={chip(openOnly)} onClick={() => setOpenOnly((v) => !v)}>
          Open beds
        </button>
        <button type="button" className={chip(atRiskOnly)} onClick={() => setAtRiskOnly((v) => !v)}>
          Losing money
        </button>
        {anyFilter && (
          <button
            type="button"
            className="text-xs font-semibold text-brand hover:underline"
            onClick={() => {
              setClientFilter("");
              setStateFilter("");
              setOpenOnly(false);
              setAtRiskOnly(false);
            }}
          >
            Clear
          </button>
        )}
      </div>

      {view === "table" ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="flex min-h-[150px] cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-brand/40 bg-accent/40 p-6 text-center transition-colors hover:border-brand hover:bg-accent"
          >
            <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-xl bg-chip text-xl text-brand">＋</div>
            <b className="text-sm text-ink">Add a property</b>
            <small className="mt-1 max-w-[220px] text-xs text-muted-foreground">
              Drop a lease PDF here — we read the address, rent, beds &amp; landlord and set it up for you
            </small>
          </button>

          {shown.map(({ p, total, occ, open, rent, collected, netInfo, occupantsCount }) => {
            const noBeds = total === 0;
            // Phase 11 — honest net cell: a real number, a muted "syncing"
            // state, or (no beds) an actionable empty label. Never a scary −$.
            const netValue: ReactNode = noBeds ? (
              <span className="text-xs font-semibold text-muted-foreground">No beds set</span>
            ) : netInfo.kind === "syncing" ? (
              <NoNav>
                <WhyPopover
                  title="Collecting"
                  formula="Rent is set; housing deductions are still syncing"
                  rows={[
                    { k: "Housed", v: occupantsCount },
                    { k: "Rent /mo", v: money(rent) },
                    { k: "Collected /mo", v: money(collected) },
                  ]}
                  href={`/properties/${p.id}`}
                  hrefLabel="Open bed board →"
                >
                  <span className="text-warn">Collecting · rent set</span>
                </WhyPopover>
              </NoNav>
            ) : (
              <NoNav>
                <WhyPopover
                  title="Net /mo"
                  formula="Collected − Rent (monthly)"
                  rows={[
                    { k: "Collected /mo", v: money(collected) },
                    { k: "Rent /mo", v: money(rent) },
                    { k: "Net", v: money(netInfo.value) },
                  ]}
                  href={`/properties/${p.id}`}
                  hrefLabel="Open bed board →"
                >
                  <span className={netInfo.value < 0 ? "text-risk" : "text-ok"}>{money(netInfo.value)}</span>
                </WhyPopover>
              </NoNav>
            );
            const erows: ERow[] = [
              {
                label: "Beds",
                value: noBeds ? (
                  <span className="text-xs font-semibold text-warn">No beds — add a unit</span>
                ) : (
                  <NoNav>
                    <WhyPopover
                      title="Occupancy"
                      formula="Occupied beds ÷ total beds"
                      rows={[
                        { k: "Occupied", v: occ },
                        { k: "Total beds", v: total },
                        { k: "Open", v: open },
                      ]}
                      href={`/properties/${p.id}`}
                      hrefLabel="Open bed board →"
                    >
                      {occ} / {total}
                    </WhyPopover>
                  </NoNav>
                ),
              },
              { label: "Open", value: noBeds ? "—" : open, tone: open > 0 ? "risk" : "ink" },
              {
                label: "Net /mo",
                value: netValue,
                tone: netInfo.kind === "net" && netInfo.value < 0 ? "risk" : netInfo.kind === "net" ? "ok" : "ink",
              },
            ];
            return (
              <EntityCard
                key={p.id}
                initials={initialsOf(p.name)}
                accent={accentFor(p.name)}
                name={p.name}
                sub={`${customerName.get((p as { customerId?: string }).customerId ?? "") || "Unassigned"} · ${[
                  (p as { city?: string }).city,
                  (p as { state?: string }).state,
                ].filter(Boolean).join(" ")}`}
                rows={erows}
                onClick={() => navigate(`/properties/${p.id}`)}
              />
            );
          })}

          {shown.length === 0 && (
            <Card className="sm:col-span-2 lg:col-span-3">
              <EmptyState
                title={anyFilter ? "No properties match these filters" : "No active properties"}
                hint={anyFilter ? "Clear the filters to see them all." : "Drop a lease to add one."}
              />
            </Card>
          )}
        </div>
      ) : (
        <Card>
          <p className="mb-3 text-sm text-muted-foreground">
            {withCoords.length} of {shown.length} properties have map coordinates.
            {withCoords.length < shown.length && " Set lat/lng on a property to plot it here."}
          </p>
          {withCoords.length === 0 ? (
            <EmptyState title="No mapped locations yet" hint="Properties plot here once they have coordinates." />
          ) : (
            <div className="relative h-72 w-full overflow-hidden rounded-xl bg-track">
              {withCoords.map((r) => {
                const lats = withCoords.map((x) => x.lat as number);
                const lngs = withCoords.map((x) => x.lng as number);
                const minLa = Math.min(...lats), maxLa = Math.max(...lats);
                const minLn = Math.min(...lngs), maxLn = Math.max(...lngs);
                const x = maxLn === minLn ? 50 : ((r.lng as number) - minLn) / (maxLn - minLn) * 90 + 5;
                const y = maxLa === minLa ? 50 : (1 - ((r.lat as number) - minLa) / (maxLa - minLa)) * 90 + 5;
                return (
                  <button
                    key={r.p.id}
                    type="button"
                    title={`${r.p.name} · ${r.occ}/${r.total}`}
                    onClick={() => navigate(`/properties/${r.p.id}`)}
                    className="absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white"
                    style={{
                      left: `${x}%`,
                      top: `${y}%`,
                      background:
                        r.netInfo.kind === "net" && r.netInfo.value < 0
                          ? "hsl(var(--risk))"
                          : r.open > 0
                            ? "hsl(var(--warn))"
                            : "hsl(var(--ok))",
                    }}
                  />
                );
              })}
            </div>
          )}
        </Card>
      )}

      <AddPropertyDialog open={addOpen} onOpenChange={setAddOpen} />
    </section>
  );
}
