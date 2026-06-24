import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useData } from "@/context/data-store";
import {
  Card,
  EntityCard,
  Seg,
  EmptyState,
  accentFor,
  initialsOf,
  type ERow,
} from "@/components/kit-v2";
import { AddPropertyDialog } from "@/components/add-property/add-property-dialog";

const MO = 52 / 12;
const money = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(Math.round(n)).toLocaleString()}`;

export default function PropertiesPage() {
  const [, navigate] = useLocation();
  const { properties, beds, occupants, customers } = useData();
  const [view, setView] = useState<"table" | "map">("table");
  const [addOpen, setAddOpen] = useState(false);

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
    for (const o of occupants) {
      const oo = o as { propertyId?: string; bedId?: string; status?: string; chargePerBed?: number; deduction?: { weeklyAmount?: number } };
      if (!oo.propertyId || !oo.bedId || oo.status === "Former") continue;
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
        return {
          p,
          total,
          occ,
          open: Math.max(0, total - occ),
          net: collected - rent,
          city: (p as { city?: string }).city ?? "",
          state: (p as { state?: string }).state ?? "",
          lat: (p as { lat?: number | null }).lat ?? null,
          lng: (p as { lng?: number | null }).lng ?? null,
        };
      })
      .sort((a, b) => a.p.name.localeCompare(b.p.name));
  }, [properties, beds, occupants]);

  const withCoords = rows.filter((r) => typeof r.lat === "number" && typeof r.lng === "number");

  return (
    <section>
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-ink">Properties</h1>
          <p className="text-sm text-muted-foreground">
            {rows.length} locations · click one to open its bed board · or drop a lease to add one
          </p>
        </div>
        <Seg
          value={view}
          onChange={(v) => setView(v)}
          options={[
            { value: "table", label: "Grid" },
            { value: "map", label: "Map" },
          ]}
        />
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

          {rows.map(({ p, total, occ, open, net }) => {
            const erows: ERow[] = [
              { label: "Beds", value: `${occ} / ${total}` },
              { label: "Open", value: open, tone: open > 0 ? "risk" : "ink" },
              { label: "Net /mo", value: money(net), tone: net < 0 ? "risk" : "ok" },
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

          {rows.length === 0 && (
            <Card className="sm:col-span-2 lg:col-span-3">
              <EmptyState title="No active properties" hint="Drop a lease to add one." />
            </Card>
          )}
        </div>
      ) : (
        <Card>
          <p className="mb-3 text-sm text-muted-foreground">
            {withCoords.length} of {rows.length} properties have map coordinates.
            {withCoords.length < rows.length && " Set lat/lng on a property to plot it here."}
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
                      background: r.net < 0 ? "hsl(var(--risk))" : r.open > 0 ? "hsl(var(--warn))" : "hsl(var(--ok))",
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
