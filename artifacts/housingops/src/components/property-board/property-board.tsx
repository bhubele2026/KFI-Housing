import { useMemo, useState, type ReactNode } from "react";
import { Link } from "wouter";
import type { Property, Occupant, Bed } from "@/data/mockData";
import { useData } from "@/context/data-store";
import { shortPropertyName } from "@/lib/property-name";
import { titleCaseName } from "@/lib/name-format";
import { useListVehicles } from "@workspace/api-client-react";
import { FinanceMoneyReviewTab } from "@/components/finance-payroll-tabs";
import { cn } from "@/lib/utils";

const WEEKS_PER_MONTH = 52 / 12;
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  if (!m) return String(iso);
  return `${MONTH[Number(m[2]) - 1] ?? ""} ${Number(m[3])}`;
}
const usd0 = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
const usd2 = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n);

/** Cast-safe weekly deduction for an occupant (server truth, then manual charge). */
function weeklyOf(o: Occupant): number {
  const ded = (o as { deduction?: { weeklyAmount?: number } }).deduction;
  return Number(ded?.weeklyAmount ?? (o as { chargePerBed?: number }).chargePerBed) || 0;
}
type PillTone = "ok" | "warn" | "risk" | "neutral";
function bedPill(o: Occupant): { tone: PillTone; text: string } {
  const weekly = weeklyOf(o);
  const z = (o as { zenopleStatus?: string }).zenopleStatus;
  const src = (o as { chargeSource?: string }).chargeSource;
  if (weekly > 0 && (z === "linked" || src === "payroll" || z == null))
    return { tone: "ok", text: `$${Math.round(weekly)}/wk` };
  if (z === "needs_review") return { tone: "warn", text: "review" };
  if (z === "not_in_zenople" || z === "pending") return { tone: "neutral", text: "not in payroll yet" };
  if (weekly > 0) return { tone: "ok", text: `$${Math.round(weekly)}/wk` };
  return { tone: "risk", text: "$0 — not deducted" };
}
const PILL: Record<PillTone, string> = {
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  risk: "bg-risk-soft text-risk",
  neutral: "bg-muted text-muted-foreground",
};
const DOT: Record<PillTone, string> = { ok: "bg-ok", warn: "bg-warn", risk: "bg-risk", neutral: "bg-muted-foreground/60" };

function Pill({ tone, text }: { tone: PillTone; text: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums", PILL[tone])}>
      <span className={cn("inline-block h-1.5 w-1.5 rounded-full", DOT[tone])} />
      {text}
    </span>
  );
}

function Card({ title, className, children, action }: { title: string; className?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className={cn("rounded-xl border border-line bg-panel", className)}>
      <div className="flex items-center justify-between border-b border-line/70 px-3.5 py-2.5">
        <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

/**
 * The Property Board — rebuilt to the design-target mockup
 * (HousingOps_UI_Mockup.html): a two-tab head (Property Board / Money — Week
 * Review), a warm header with capacity chips, a 4-up money strip, the
 * spreadsheet-style bed matrix beside the move-ledger / shift / vehicle cards,
 * and a full-width contact roster. Dense, warm, spreadsheet-familiar.
 */
export function PropertyBoard({ property }: { property: Property }) {
  const [tab, setTab] = useState<"board" | "money">("board");
  const data = useData();
  const { beds, occupants, customers, rooms } = data;
  const utilities =
    (data as { utilities?: { propertyId: string; type: string; monthlyCost: number }[] }).utilities ?? [];

  const client = customers.find((c) => c.id === property.customerId);
  const monthlyRent = Number((property as { monthlyRent?: number }).monthlyRent) || 0;
  const address = (property as { address?: string }).address ?? "";
  const landlord = (property as { landlordName?: string }).landlordName ?? "";
  const landlordPhone = (property as { landlordPhone?: string }).landlordPhone ?? "";

  const propOccupants = useMemo(() => occupants.filter((o) => o.propertyId === property.id), [occupants, property.id]);
  const occById = useMemo(() => new Map(occupants.map((o) => [o.id, o])), [occupants]);

  // Rooms → their beds (sorted), + matrix column count.
  const { roomRows, maxBeds, capacity, occupied, open } = useMemo(() => {
    const propRooms = rooms.filter((r) => r.propertyId === property.id);
    const bedsByRoom = new Map<string, Bed[]>();
    let cap = 0, occ = 0;
    for (const b of beds) {
      if (b.propertyId !== property.id) continue;
      cap += 1;
      if (b.status === "Occupied") occ += 1;
      const list = bedsByRoom.get(b.roomId) ?? [];
      list.push(b);
      bedsByRoom.set(b.roomId, list);
    }
    const rrows = propRooms
      .map((r) => ({ room: r, beds: (bedsByRoom.get(r.id) ?? []).sort((a, b) => a.bedNumber - b.bedNumber) }))
      .sort((a, b) => a.room.name.localeCompare(b.room.name, undefined, { numeric: true }));
    const mb = Math.min(6, Math.max(2, ...rrows.map((r) => r.beds.length), 0));
    return { roomRows: rrows, maxBeds: mb, capacity: cap, occupied: occ, open: cap - occ };
  }, [beds, rooms, property.id]);

  // Money strip.
  const { collectedMonthly, utilitiesMonthly, net } = useMemo(() => {
    let weekly = 0;
    for (const o of propOccupants) {
      if (o.status === "Active" && o.bedId) weekly += weeklyOf(o);
    }
    const util = utilities
      .filter((u) => u.propertyId === property.id && u.type === "Electric")
      .reduce((s, u) => s + (Number(u.monthlyCost) || 0), 0);
    const collected = weekly * WEEKS_PER_MONTH;
    return { collectedMonthly: collected, utilitiesMonthly: util, net: collected - monthlyRent - util };
  }, [propOccupants, utilities, property.id, monthlyRent]);

  // Move ledger.
  const { movingIn, movingOut } = useMemo(() => {
    const inn = propOccupants
      .filter((o) => o.status === "Active" && o.moveInDate)
      .sort((a, b) => String(b.moveInDate).localeCompare(String(a.moveInDate)))
      .slice(0, 5);
    const out = propOccupants
      .filter((o) => o.status === "Former" || (o as { moveOutDate?: string }).moveOutDate)
      .sort((a, b) => String((b as { moveOutDate?: string }).moveOutDate ?? "").localeCompare(String((a as { moveOutDate?: string }).moveOutDate ?? "")))
      .slice(0, 5);
    return { movingIn: inn, movingOut: out };
  }, [propOccupants]);

  // Shift coverage buckets.
  const shifts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const o of propOccupants) {
      if (o.status !== "Active" || !o.bedId) continue;
      const s = (o.shift ?? "").trim() || "Unassigned";
      c[s] = (c[s] ?? 0) + 1;
    }
    return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 3);
  }, [propOccupants]);

  // Vehicles.
  const { data: vehicles } = useListVehicles();
  const vans = useMemo(() => {
    const name = (id?: string | null) => (id ? occById.get(id)?.name ?? "—" : "—");
    return (vehicles ?? [])
      .filter((v) => (v as { propertyId?: string | null }).propertyId === property.id)
      .map((v) => ({
        id: v.id,
        driver: name((v as { driverOccupantId?: string | null }).driverOccupantId),
        plate: (v as { plate?: string }).plate ?? "",
        makeModel: `${(v as { make?: string }).make ?? ""} ${(v as { model?: string }).model ?? ""}`.trim() || "—",
        year: String((v as { year?: number | null }).year ?? ""),
        color: (v as { color?: string }).color ?? "—",
        inShop: Boolean((v as { inShop?: boolean }).inShop),
      }));
  }, [vehicles, occById, property.id]);

  const roomName = (o: Occupant) => {
    if (!o.bedId) return "—";
    const bed = beds.find((b) => b.id === o.bedId);
    const room = bed ? rooms.find((r) => r.id === bed.roomId) : undefined;
    return room?.name ?? "—";
  };

  return (
    <div className="space-y-4">
      {/* two-tab switch (mockup) */}
      <div className="flex gap-2">
        {([["board", "🏠 Property Board"], ["money", "💵 Money — Week Review"]] as const).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            data-testid={`board-tab-${k}`}
            className={cn(
              "rounded-lg border px-3.5 py-2 text-sm font-semibold",
              tab === k ? "border-brand bg-brand text-brand-foreground" : "border-line bg-panel text-ink hover-elevate",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "money" ? (
        <FinanceMoneyReviewTab />
      ) : (
        <div className="space-y-3.5">
          {/* header */}
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              {client && <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{client.name} · Client</div>}
              <h1 className="text-2xl font-bold tracking-tight text-ink">{shortPropertyName(property.name)}</h1>
              <div className="mt-0.5 text-sm text-muted-foreground">
                {address}
                {landlord && <> · Landlord: {landlord}{landlordPhone ? ` · ${landlordPhone}` : ""}</>}
              </div>
            </div>
            <div className="flex gap-2">
              {[
                { n: capacity, l: "Capacity", c: "text-ink" },
                { n: occupied, l: "Occupied", c: "text-ok" },
                { n: open, l: "Open beds", c: "text-warn" },
              ].map((s) => (
                <div key={s.l} className="min-w-[5.25rem] rounded-xl border border-line bg-panel px-3.5 py-2 text-center">
                  <div className={cn("text-xl font-bold tabular-nums", s.c)}>{s.n}</div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{s.l}</div>
                </div>
              ))}
            </div>
          </div>

          {/* money strip */}
          <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-line bg-panel sm:grid-cols-4">
            {[
              { l: "Rent we pay", v: usd0(monthlyRent), c: "text-ink" },
              { l: "Collected (deductions)", v: usd0(collectedMonthly), c: "text-ink" },
              { l: "Utilities (electric)", v: usd0(utilitiesMonthly), c: "text-ink" },
              { l: "Net spread", v: `${net >= 0 ? "+" : ""}${usd0(net)}`, c: net >= 0 ? "text-ok" : "text-risk" },
            ].map((m, i) => (
              <div key={m.l} className={cn("px-4 py-3", i < 3 && "sm:border-r border-line/70")}>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{m.l}</div>
                <div className={cn("text-xl font-bold tabular-nums", m.c)}>
                  {m.v}<span className="text-xs font-normal text-muted-foreground">/mo</span>
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[1.55fr_1fr]">
            {/* bed matrix */}
            <Card title="Bed board — who's in each room" action={<Link href={`/properties/${property.id}?tab=beds`} className="text-xs font-medium text-brand hover:underline">Manage</Link>}>
              <div className="overflow-auto">
                <table className="w-full border-collapse text-[12.5px]">
                  <thead>
                    <tr className="bg-brand text-brand-foreground">
                      <th className="w-20 px-2.5 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide">Apt</th>
                      {Array.from({ length: maxBeds }, (_, i) => (
                        <th key={i} className="px-2.5 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide">Bed {i + 1}</th>
                      ))}
                      <th className="w-12 px-2 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wide">Occ</th>
                      <th className="w-12 px-2 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wide">Open</th>
                    </tr>
                  </thead>
                  <tbody>
                    {roomRows.length === 0 ? (
                      <tr><td colSpan={maxBeds + 3} className="px-3 py-6 text-center text-sm text-muted-foreground">No rooms/beds set up for this property yet.</td></tr>
                    ) : roomRows.map(({ room, beds: rbeds }, ri) => {
                      const occ = rbeds.filter((b) => b.status === "Occupied").length;
                      return (
                        <tr key={room.id} className="border-b border-line/60">
                          <td className={cn("border-r border-line/60 px-2.5 py-1.5 font-bold", ri % 2 ? "bg-surface" : "bg-surface/60")}>{room.name}</td>
                          {Array.from({ length: maxBeds }, (_, i) => {
                            const bed = rbeds[i];
                            const bocc = bed?.occupantId ? occById.get(bed.occupantId) : undefined;
                            if (!bed) return <td key={i} className="border-r border-line/60 bg-surface/30" />;
                            if (!bocc)
                              return <td key={i} className="border-r border-line/60 px-2.5 py-1.5 text-xs italic text-muted-foreground/60">— open —</td>;
                            const pill = bedPill(bocc);
                            return (
                              <td key={i} className="border-r border-line/60 px-2.5 py-1.5">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-semibold text-ink">{titleCaseName(bocc.name)}</span>
                                  <Pill {...pill} />
                                </div>
                              </td>
                            );
                          })}
                          <td className="px-2 py-1.5 text-center font-semibold tabular-nums text-ok">{occ}</td>
                          <td className="px-2 py-1.5 text-center font-semibold tabular-nums text-muted-foreground">{rbeds.length - occ}</td>
                        </tr>
                      );
                    })}
                    <tr className="border-t-2 border-line bg-surface font-extrabold">
                      <td className="px-2.5 py-1.5">Totals</td>
                      <td colSpan={maxBeds} />
                      <td className="px-2 py-1.5 text-center tabular-nums text-ok">{occupied}</td>
                      <td className="px-2 py-1.5 text-center tabular-nums">{open}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </Card>

            {/* right column */}
            <div className="space-y-3.5">
              <Card title="Move in / move out">
                <div className="grid grid-cols-2">
                  <div className="border-r border-line/70">
                    <div className="px-3 pt-2 text-[11px] font-extrabold uppercase tracking-wide text-ok">↳ Moving in</div>
                    {movingIn.length === 0 ? <div className="px-3 py-2 text-xs text-muted-foreground">—</div> :
                      movingIn.map((o) => (
                        <div key={o.id} className="flex justify-between gap-2 border-t border-line/60 px-3 py-1 text-[12.5px]">
                          <span className="truncate">{titleCaseName(o.name)}</span><span className="tabular-nums text-muted-foreground">{fmtDate(o.moveInDate)}</span>
                        </div>
                      ))}
                  </div>
                  <div>
                    <div className="px-3 pt-2 text-[11px] font-extrabold uppercase tracking-wide text-risk">↰ Moving out</div>
                    {movingOut.length === 0 ? <div className="px-3 py-2 text-xs text-muted-foreground">—</div> :
                      movingOut.map((o) => (
                        <div key={o.id} className="flex justify-between gap-2 border-t border-line/60 px-3 py-1 text-[12.5px]">
                          <span className="truncate">{titleCaseName(o.name)}</span><span className="tabular-nums text-muted-foreground">{fmtDate((o as { moveOutDate?: string }).moveOutDate)}</span>
                        </div>
                      ))}
                  </div>
                </div>
              </Card>

              <Card title="Shift coverage">
                <div className="flex gap-2.5 p-3.5">
                  {shifts.length === 0 ? <p className="text-sm text-muted-foreground">No shifts recorded.</p> :
                    shifts.map(([label, n]) => (
                      <div key={label} className="flex-1 rounded-lg border border-line bg-surface px-2.5 py-2">
                        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
                        <div className="text-lg font-bold tabular-nums text-ink">{n}</div>
                      </div>
                    ))}
                </div>
              </Card>

              <Card title="Vehicles">
                {vans.length === 0 ? <p className="px-3.5 py-3 text-sm text-muted-foreground">No vehicles at this property.</p> : (
                  <table className="w-full border-collapse text-[12.5px]">
                    <thead><tr className="text-[10.5px] uppercase tracking-wide text-muted-foreground">
                      <th className="px-3 py-1.5 text-left font-medium">Driver</th><th className="px-3 py-1.5 text-left font-medium">Plate</th>
                      <th className="px-3 py-1.5 text-left font-medium">Make / model</th><th className="px-3 py-1.5 text-left font-medium">Color</th>
                    </tr></thead>
                    <tbody>
                      {vans.map((v) => (
                        <tr key={v.id} className="border-t border-line/60">
                          <td className="px-3 py-1.5 font-semibold">{v.driver}{v.inShop && <span className="ml-1 text-[10px] text-warn">🔧</span>}</td>
                          <td className="px-3 py-1.5 tabular-nums">{v.plate || "—"}</td><td className="px-3 py-1.5">{v.makeModel}</td>
                          <td className="px-3 py-1.5">{v.color}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>
            </div>
          </div>

          {/* contact roster */}
          <Card title="Associates at this property — contact roster">
            <div className="overflow-auto">
              <table className="w-full border-collapse text-[12.5px]">
                <thead><tr className="text-[10.5px] uppercase tracking-wide text-muted-foreground">
                  {["Associate", "Apt", "Phone", "Shift", "Start", "Weekly rent", "Payroll"].map((h) => (
                    <th key={h} className="border-b border-line px-3 py-2 text-left font-medium">{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {propOccupants.filter((o) => o.status === "Active").length === 0 ? (
                    <tr><td colSpan={7} className="px-3 py-6 text-center text-sm text-muted-foreground">No associates housed here yet.</td></tr>
                  ) : propOccupants.filter((o) => o.status === "Active").sort((a, b) => a.name.localeCompare(b.name)).map((o, i) => {
                    const weekly = weeklyOf(o);
                    const z = (o as { zenopleStatus?: string }).zenopleStatus;
                    const payroll = weekly > 0 ? { t: "ok" as PillTone, l: "Linked" } : z === "needs_review" ? { t: "warn" as PillTone, l: "Review" } : z === "not_in_zenople" || z === "pending" ? { t: "neutral" as PillTone, l: "Not in payroll yet" } : { t: "risk" as PillTone, l: "Not deducted" };
                    return (
                      <tr key={o.id} className={cn("border-b border-line/60", i % 2 && "bg-surface/50")}>
                        <td className="px-3 py-1.5 font-semibold">{titleCaseName(o.name)}</td>
                        <td className="px-3 py-1.5">{roomName(o)}</td>
                        <td className="px-3 py-1.5 tabular-nums">{o.phone || "—"}</td>
                        <td className="px-3 py-1.5">{o.shift || "—"}</td>
                        <td className="px-3 py-1.5 tabular-nums">{fmtDate(o.moveInDate)}</td>
                        <td className={cn("px-3 py-1.5 tabular-nums", weekly === 0 && "font-bold text-risk")}>{weekly > 0 ? usd2(weekly) : o.status === "Active" ? "$0.00" : "—"}</td>
                        <td className="px-3 py-1.5"><span className={cn("rounded-full px-2 py-0.5 text-[10.5px] font-semibold", PILL[payroll.t])}>{payroll.l}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
