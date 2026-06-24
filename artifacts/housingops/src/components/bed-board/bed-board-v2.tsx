import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useData } from "@/context/data-store";
import { useToast } from "@/hooks/use-toast";
import { StatCard, Seg, accentFor, initialsOf } from "@/components/kit-v2";
import { Bed, RoomCard } from "@/components/kit-v2";
import { toWeeklyCharge, formatUsdWhole, type Property, type Occupant } from "@/data/mockData";

const apiBase = (): string => (import.meta.env.BASE_URL ?? "/") as string;
const MONTH_WK = 52 / 12;

type ColorBy = "shift" | "payroll" | "deduction";

/** Weekly $ actually recovered for an occupant (cast-safe across pre/post codegen). */
function weeklyOf(occ: Occupant): number {
  const ded = (occ as { deduction?: { weeklyAmount?: number } }).deduction;
  if (ded && typeof ded.weeklyAmount === "number") return ded.weeklyAmount;
  const src = (occ as { chargeSource?: string }).chargeSource;
  const cpb = (occ as { chargePerBed?: number }).chargePerBed ?? 0;
  if (src === "payroll" && cpb > 0) {
    const freq = (occ as { billingFrequency?: string }).billingFrequency ?? "Weekly";
    return toWeeklyCharge(cpb, freq as never);
  }
  return 0;
}

function badgeFor(occ: Occupant): { kind: "ok" | "risk" | "grey"; label: string } {
  const weekly = weeklyOf(occ);
  if (weekly > 0) return { kind: "ok", label: `$${Math.round(weekly)}` };
  const z = (occ as { zenopleStatus?: string }).zenopleStatus;
  const eid = (occ as { employeeId?: string }).employeeId;
  if (z === "linked" || (z === undefined && eid)) return { kind: "risk", label: "$0" };
  if (!eid || z === "not_in_zenople" || z === "pending" || z === "needs_review") {
    return { kind: "grey", label: "not in payroll" };
  }
  return { kind: "risk", label: "$0" };
}

function avatarAccent(occ: Occupant, colorBy: ColorBy): string {
  if (colorBy === "payroll") {
    const b = badgeFor(occ);
    return b.kind === "ok" ? "teal" : b.kind === "risk" ? "red" : "slate";
  }
  if (colorBy === "deduction") {
    const w = weeklyOf(occ);
    return w >= 120 ? "purple" : w >= 70 ? "blue" : w > 0 ? "teal" : "red";
  }
  // shift (default-ish)
  const shift = String((occ as { shift?: string }).shift ?? "");
  if (/1|day/i.test(shift)) return "blue";
  if (/2|night|pm/i.test(shift)) return "purple";
  if (/3/.test(shift)) return "orange";
  return accentFor((occ as { name?: string }).name ?? occ.id);
}

function shiftSub(occ: Occupant): string {
  const shift = String((occ as { shift?: string }).shift ?? "").trim();
  const time = String((occ as { shiftTime?: string }).shiftTime ?? "").trim();
  return [shift, time].filter(Boolean).join(" · ") || "—";
}

/**
 * The Property Beds board — the management centerpiece, matching the v2 mockup
 * "#beds" screen: stat cards + room cards with draggable bed rows, a move-out
 * drop zone, and a color-by toggle. Drag a person onto an open bed to move
 * them (optimistic + POST /api/beds/move); drag to the zone or hit ✕ to move
 * them out (POST /api/occupants/:id/move-out).
 */
export function BedBoardV2({ property }: { property: Property }) {
  const { rooms, beds, occupants, customers, updateBed, updateOccupant } = useData();
  const { toast } = useToast();
  const [colorBy, setColorBy] = useState<ColorBy>("shift");
  const [dragOcc, setDragOcc] = useState<{ occ: Occupant; fromBedId: string } | null>(null);
  const [overOpen, setOverOpen] = useState<string | null>(null);
  const [overZone, setOverZone] = useState(false);
  // local optimistic occupant→bed overlay so moves reflect instantly
  const [occByBed, setOccByBed] = useState<Record<string, string>>({});

  const propBeds = useMemo(
    () => beds.filter((b) => (b as { propertyId?: string }).propertyId === property.id),
    [beds, property.id],
  );
  const propRooms = useMemo(
    () =>
      rooms
        .filter((r) => (r as { propertyId?: string }).propertyId === property.id)
        .sort((a, b) => String((a as { name?: string }).name ?? "").localeCompare(String((b as { name?: string }).name ?? ""))),
    [rooms, property.id],
  );
  const occById = useMemo(() => {
    const m = new Map<string, Occupant>();
    occupants.forEach((o) => m.set(o.id, o));
    return m;
  }, [occupants]);

  // seed the optimistic overlay from the real data (bedId → occupantId)
  useEffect(() => {
    const seed: Record<string, string> = {};
    occupants.forEach((o) => {
      const bid = (o as { bedId?: string }).bedId;
      const status = String((o as { status?: string }).status ?? "Active");
      if (bid && status !== "Former") seed[bid] = o.id;
    });
    setOccByBed(seed);
  }, [occupants]);

  const occupantInBed = (bedId: string): Occupant | undefined => {
    const oid = occByBed[bedId];
    return oid ? occById.get(oid) : undefined;
  };

  const bedsByRoom = useMemo(() => {
    const m = new Map<string, typeof propBeds>();
    propBeds.forEach((b) => {
      const rid = (b as { roomId?: string }).roomId ?? "_";
      const arr = m.get(rid) ?? [];
      arr.push(b);
      m.set(rid, arr);
    });
    for (const arr of m.values())
      arr.sort((a, b) => Number((a as { bedNumber?: number }).bedNumber ?? 0) - Number((b as { bedNumber?: number }).bedNumber ?? 0));
    return m;
  }, [propBeds]);

  // counts
  const capacity = propBeds.length;
  const occupied = propBeds.filter((b) => occByBed[b.id]).length;
  const open = Math.max(0, capacity - occupied);
  const collectedMo = propBeds.reduce((s, b) => {
    const o = occupantInBed(b.id);
    return s + (o ? weeklyOf(o) * MONTH_WK : 0);
  }, 0);
  const rentMo = (property as { monthlyRent?: number }).monthlyRent ?? 0;
  const net = collectedMo - rentMo;
  const clientName =
    customers.find((c) => c.id === (property as { customerId?: string }).customerId)?.name ?? "Customers";

  async function doMove(occ: Occupant, fromBedId: string, toBedId: string) {
    if (fromBedId === toBedId) return;
    // optimistic
    setOccByBed((prev) => {
      const next = { ...prev };
      delete next[fromBedId];
      next[toBedId] = occ.id;
      return next;
    });
    try {
      const r = await fetch(`${apiBase()}api/beds/move`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ occupantId: occ.id, fromBedId, toBedId }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || "move failed");
      // sync the shared cache so other views agree
      try {
        updateBed(fromBedId, { occupantId: "", status: "Vacant", cleaningStatus: "needs_cleaning" } as never);
        updateBed(toBedId, { occupantId: occ.id, status: "Occupied" } as never);
        updateOccupant(occ.id, { bedId: toBedId } as never);
      } catch {
        /* cache sync best-effort */
      }
      toast({ title: `Moved ${(occ as { name?: string }).name ?? "person"}` });
    } catch (e) {
      // roll back
      setOccByBed((prev) => {
        const next = { ...prev };
        delete next[toBedId];
        next[fromBedId] = occ.id;
        return next;
      });
      toast({ title: "Move failed — put them back", variant: "destructive" as never });
    }
  }

  async function doMoveOut(occ: Occupant, fromBedId: string) {
    setOccByBed((prev) => {
      const next = { ...prev };
      delete next[fromBedId];
      return next;
    });
    try {
      const r = await fetch(`${apiBase()}api/occupants/${occ.id}/move-out`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "", bedReady: false }),
      });
      if (!r.ok) throw new Error("move-out failed");
      try {
        updateBed(fromBedId, { occupantId: "", status: "Vacant", cleaningStatus: "needs_cleaning" } as never);
        updateOccupant(occ.id, { status: "Former", bedId: "" } as never);
      } catch {
        /* best-effort */
      }
      toast({ title: `${(occ as { name?: string }).name ?? "Person"} moved out — bed is open` });
    } catch {
      setOccByBed((prev) => ({ ...prev, [fromBedId]: occ.id }));
      toast({ title: "Move-out failed", variant: "destructive" as never });
    }
  }

  function crossPropertyMove(occ: Occupant) {
    // Cross-property picker is heavier; ship drag + move-out now, surface intent.
    toast({
      title: `Move ${(occ as { name?: string }).name ?? "person"} to another property`,
      description: "Open the Properties board and drag them onto an open bed there (full picker coming).",
    });
  }

  return (
    <div>
      <div className="mb-4">
        <Link href={`/customers/${(property as { customerId?: string }).customerId ?? ""}`} className="mb-1.5 inline-block text-[13px] font-semibold text-brand">
          ← {clientName}
        </Link>
        <h1 className="text-[21px] font-bold tracking-[-0.3px] text-ink">
          {(property as { name?: string }).name} · Beds
        </h1>
        <div className="mt-0.5 text-[13px] text-muted-foreground">
          {(property as { address?: string }).address || "—"} · {occupied} of {capacity} beds full ·{" "}
          <b className="text-brand">drag a person onto an open bed to move them</b>
        </div>
      </div>

      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="grid flex-1 grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard label="Capacity" value={capacity} />
          <StatCard label="Occupied" value={occupied} tone="ok" />
          <StatCard label="Open" value={open} tone="warn" />
          <StatCard label="Net /mo" value={formatUsdWhole(net)} tone={net < 0 ? "risk" : "ok"} />
        </div>
      </div>

      <div className="mb-3 flex items-center gap-2">
        <span className="text-[11px] font-bold uppercase tracking-[0.6px] text-faint">Color by</span>
        <Seg
          options={[
            { value: "shift", label: "Shift" },
            { value: "payroll", label: "Payroll" },
            { value: "deduction", label: "Deduction" },
          ]}
          value={colorBy}
          onChange={setColorBy}
        />
      </div>

      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
        {propRooms.map((room) => {
          const rbeds = bedsByRoom.get(room.id) ?? [];
          const rOcc = rbeds.filter((b) => occByBed[b.id]).length;
          return (
            <RoomCard key={room.id} unit={(room as { name?: string }).name ?? "Unit"} occupied={rOcc} capacity={rbeds.length}>
              {rbeds.map((b) => {
                const occ = occupantInBed(b.id);
                if (!occ) {
                  return (
                    <div
                      key={b.id}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setOverOpen(b.id);
                      }}
                      onDragLeave={() => setOverOpen((p) => (p === b.id ? null : p))}
                      onDrop={(e) => {
                        e.preventDefault();
                        setOverOpen(null);
                        if (dragOcc) doMove(dragOcc.occ, dragOcc.fromBedId, b.id);
                      }}
                      className={overOpen === b.id ? "rounded-[11px] outline outline-2 outline-brand" : undefined}
                    >
                      <Bed open testId={`bed-open-${b.id}`} />
                    </div>
                  );
                }
                const nm = (occ as { name?: string }).name ?? "?";
                return (
                  <Bed
                    key={b.id}
                    name={nm}
                    sub={shiftSub(occ)}
                    initials={initialsOf(nm)}
                    accent={avatarAccent(occ, colorBy)}
                    badge={badgeFor(occ)}
                    draggable
                    onDragStart={() => setDragOcc({ occ, fromBedId: b.id })}
                    onDragEnd={() => setDragOcc(null)}
                    testId={`bed-occ-${b.id}`}
                    actions={
                      <div className="ml-1.5 hidden gap-1 group-hover:flex">
                        <button
                          type="button"
                          title="Move to another property"
                          onClick={() => crossPropertyMove(occ)}
                          className="flex h-6 w-6 items-center justify-center rounded-[7px] border border-line bg-panel text-xs text-muted-foreground hover:text-ink"
                        >
                          ⇄
                        </button>
                        <button
                          type="button"
                          title="Move out / remove"
                          onClick={() => doMoveOut(occ, b.id)}
                          className="flex h-6 w-6 items-center justify-center rounded-[7px] border border-line bg-panel text-xs text-muted-foreground hover:border-risk/40 hover:bg-risk-soft hover:text-risk"
                        >
                          ✕
                        </button>
                      </div>
                    }
                  />
                );
              })}
            </RoomCard>
          );
        })}
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOverZone(true);
        }}
        onDragLeave={() => setOverZone(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOverZone(false);
          if (dragOcc) doMoveOut(dragOcc.occ, dragOcc.fromBedId);
        }}
        className={[
          "mt-4 rounded-[14px] border-2 border-dashed p-4 text-center text-[13px] font-bold transition-colors",
          overZone ? "border-risk bg-risk-soft text-risk" : "border-[#E2A9B4] bg-[#FDF3F5] text-[#B0405A]",
        ].join(" ")}
      >
        ↩ Drag a person here to move them out / unassign
      </div>
    </div>
  );
}
