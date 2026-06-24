import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { useData } from "@/context/data-store";
import { useToast } from "@/hooks/use-toast";
import { StatCard, Seg, accentFor, initialsOf, PrintView } from "@/components/kit-v2";
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

const MOVE_OUT_REASONS = ["Left job", "Transferred", "Terminated", "Other"] as const;

/**
 * The Property Beds board — the management centerpiece (v2 mockup "#beds").
 * Stat cards + room cards with draggable bed rows. Drag (or click-to-move) a
 * person onto an open bed -> POST /api/beds/move (optimistic + Undo). Drag to
 * the zone / hit ✕ -> a move-out prompt (reason + bed-ready). ⇄ opens a
 * cross-property picker. Open beds get ranked "suggested" highlights while
 * dragging (GET /api/beds/open). Print/Export via PrintView.
 */
export function BedBoardV2({ property }: { property: Property }) {
  const { rooms, beds, occupants, customers, properties, updateBed, updateOccupant } = useData();
  const { toast } = useToast();
  const [colorBy, setColorBy] = useState<ColorBy>("shift");
  const [dragOcc, setDragOcc] = useState<{ occ: Occupant; fromBedId: string } | null>(null);
  const [overOpen, setOverOpen] = useState<string | null>(null);
  const [overZone, setOverZone] = useState(false);
  const [occByBed, setOccByBed] = useState<Record<string, string>>({});
  // refinements
  const [moveOutModal, setMoveOutModal] = useState<{ occ: Occupant; fromBedId: string } | null>(null);
  const [moReason, setMoReason] = useState<string>(MOVE_OUT_REASONS[0]);
  const [moBedReady, setMoBedReady] = useState(false);
  const [undoBar, setUndoBar] = useState<{ label: string; run: () => void } | null>(null);
  const [xprop, setXprop] = useState<{ occ: Occupant; fromBedId: string } | null>(null);
  const [clickMove, setClickMove] = useState<{ occ: Occupant; fromBedId: string } | null>(null);
  const [suggested, setSuggested] = useState<Set<string>>(new Set());

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

  useEffect(() => {
    const seed: Record<string, string> = {};
    occupants.forEach((o) => {
      const bid = (o as { bedId?: string }).bedId;
      const status = String((o as { status?: string }).status ?? "Active");
      if (bid && status !== "Former") seed[bid] = o.id;
    });
    setOccByBed(seed);
  }, [occupants]);

  // auto-dismiss the undo bar after 6s
  useEffect(() => {
    if (!undoBar) return;
    const t = setTimeout(() => setUndoBar(null), 6000);
    return () => clearTimeout(t);
  }, [undoBar]);

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

  // open beds in THIS property (for click-to-move menu)
  const openBedsHere = useMemo(
    () => propBeds.filter((b) => !occByBed[b.id]).map((b) => ({ id: b.id, label: roomBedLabel(b.id) })),
    [propBeds, occByBed],
  );
  function roomBedLabel(bedId: string): string {
    const b = propBeds.find((x) => x.id === bedId);
    const room = propRooms.find((r) => r.id === (b as { roomId?: string })?.roomId);
    const rn = (room as { name?: string })?.name ?? "Unit";
    const bn = (b as { bedNumber?: number })?.bedNumber ?? "";
    return `${rn} · Bed ${bn}`;
  }

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

  // low-level optimistic move (no undo registration) — used by doMove + undo
  function optimisticMove(occId: string, fromBedId: string, toBedId: string) {
    setOccByBed((prev) => {
      const next = { ...prev };
      if (fromBedId) delete next[fromBedId];
      next[toBedId] = occId;
      return next;
    });
  }

  async function postMove(occId: string, fromBedId: string, toBedId: string): Promise<boolean> {
    try {
      const r = await fetch(`${apiBase()}api/beds/move`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ occupantId: occId, fromBedId, toBedId }),
      });
      if (!r.ok) throw new Error("move failed");
      try {
        if (fromBedId) updateBed(fromBedId, { occupantId: "", status: "Vacant", cleaningStatus: "needs_cleaning" } as never);
        updateBed(toBedId, { occupantId: occId, status: "Occupied" } as never);
        updateOccupant(occId, { bedId: toBedId } as never);
      } catch {
        /* cache sync best-effort */
      }
      return true;
    } catch {
      return false;
    }
  }

  async function doMove(occ: Occupant, fromBedId: string, toBedId: string) {
    if (fromBedId === toBedId) return;
    optimisticMove(occ.id, fromBedId, toBedId);
    const ok = await postMove(occ.id, fromBedId, toBedId);
    if (!ok) {
      optimisticMove(occ.id, toBedId, fromBedId); // roll back
      toast({ title: "Move failed — put them back", variant: "destructive" as never });
      return;
    }
    const nm = (occ as { name?: string }).name ?? "person";
    toast({ title: `Moved ${nm}` });
    // Undo (refinement #15): replay the inverse move.
    setUndoBar({
      label: `Moved ${nm}`,
      run: async () => {
        optimisticMove(occ.id, toBedId, fromBedId);
        await postMove(occ.id, toBedId, fromBedId);
        setUndoBar(null);
        toast({ title: "Move undone" });
      },
    });
  }

  async function reallyMoveOut(occ: Occupant, fromBedId: string, reason: string, bedReady: boolean) {
    setMoveOutModal(null);
    setOccByBed((prev) => {
      const next = { ...prev };
      delete next[fromBedId];
      return next;
    });
    try {
      const r = await fetch(`${apiBase()}api/occupants/${occ.id}/move-out`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason, bedReady }),
      });
      if (!r.ok) throw new Error("move-out failed");
      try {
        updateBed(fromBedId, {
          occupantId: "",
          status: "Vacant",
          cleaningStatus: bedReady ? "ready" : "needs_cleaning",
        } as never);
        updateOccupant(occ.id, { status: "Former", bedId: "" } as never);
      } catch {
        /* best-effort */
      }
      const nm = (occ as { name?: string }).name ?? "Person";
      toast({ title: `${nm} moved out — bed is ${bedReady ? "ready" : "in cleaning"}` });
      // Undo (#15): re-seat them.
      setUndoBar({
        label: `${nm} moved out`,
        run: async () => {
          setOccByBed((prev) => ({ ...prev, [fromBedId]: occ.id }));
          try {
            await fetch(`${apiBase()}api/occupants/${occ.id}`, {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ status: "Active", bedId: fromBedId }),
            });
            updateBed(fromBedId, { occupantId: occ.id, status: "Occupied" } as never);
            updateOccupant(occ.id, { status: "Active", bedId: fromBedId } as never);
          } catch {
            /* best-effort */
          }
          setUndoBar(null);
          toast({ title: "Move-out undone" });
        },
      });
    } catch {
      setOccByBed((prev) => ({ ...prev, [fromBedId]: occ.id }));
      toast({ title: "Move-out failed", variant: "destructive" as never });
    }
  }

  // cross-property move (#11): move to a bed in another property + confirm
  async function doXPropMove(occ: Occupant, fromBedId: string, toBedId: string) {
    setXprop(null);
    setOccByBed((prev) => {
      const next = { ...prev };
      delete next[fromBedId];
      return next;
    });
    const ok = await postMove(occ.id, fromBedId, toBedId);
    const nm = (occ as { name?: string }).name ?? "person";
    if (!ok) {
      setOccByBed((prev) => ({ ...prev, [fromBedId]: occ.id }));
      toast({ title: "Cross-property move failed", variant: "destructive" as never });
      return;
    }
    toast({ title: `Moved ${nm} to another property` });
  }

  // smart suggestions (#20): rank open beds for the dragged occupant
  async function loadSuggestions(occId: string) {
    try {
      const r = await fetch(`${apiBase()}api/beds/open?occupantId=${encodeURIComponent(occId)}`);
      if (!r.ok) return;
      const body = (await r.json()) as { rows?: Array<{ bedId?: string }> } | Array<{ bedId?: string }>;
      const rows = Array.isArray(body) ? body : body.rows ?? [];
      setSuggested(new Set(rows.map((x) => String(x.bedId)).filter(Boolean)));
    } catch {
      /* non-fatal */
    }
  }

  // open beds across OTHER properties for the cross-property picker
  const otherOpenBeds = useMemo(() => {
    if (!xprop) return [] as Array<{ propName: string; bedId: string; label: string }>;
    const occupiedBedIds = new Set(
      occupants
        .filter((o) => String((o as { status?: string }).status ?? "Active") !== "Former")
        .map((o) => (o as { bedId?: string }).bedId)
        .filter(Boolean) as string[],
    );
    return beds
      .filter((b) => {
        const pid = (b as { propertyId?: string }).propertyId;
        return pid && pid !== property.id && !occupiedBedIds.has(b.id);
      })
      .slice(0, 60)
      .map((b) => {
        const pid = (b as { propertyId?: string }).propertyId;
        const pn = properties.find((p) => p.id === pid);
        return {
          propName: (pn as { name?: string })?.name ?? "Property",
          bedId: b.id,
          label: `Bed ${(b as { bedNumber?: number }).bedNumber ?? ""}`,
        };
      })
      .sort((a, b) => a.propName.localeCompare(b.propName));
  }, [xprop, beds, occupants, properties, property.id]);

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

      <PrintView title={`${(property as { name?: string }).name ?? "Property"} — Beds`} subtitle={(property as { address?: string }).address || undefined}>
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
        {propRooms.map((room) => {
          const rbeds = bedsByRoom.get(room.id) ?? [];
          const rOcc = rbeds.filter((b) => occByBed[b.id]).length;
          return (
            <RoomCard key={room.id} unit={(room as { name?: string }).name ?? "Unit"} occupied={rOcc} capacity={rbeds.length}>
              {rbeds.map((b) => {
                const occ = occupantInBed(b.id);
                if (!occ) {
                  const isSuggested = suggested.has(b.id) && !!dragOcc;
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
                      className={
                        overOpen === b.id
                          ? "rounded-[11px] outline outline-2 outline-brand"
                          : isSuggested
                          ? "rounded-[11px] outline outline-2 outline-ok/60"
                          : undefined
                      }
                      title={isSuggested ? "Suggested — same client/shift/property" : undefined}
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
                    onDragStart={() => {
                      setDragOcc({ occ, fromBedId: b.id });
                      loadSuggestions(occ.id);
                    }}
                    onDragEnd={() => {
                      setDragOcc(null);
                      setSuggested(new Set());
                    }}
                    testId={`bed-occ-${b.id}`}
                    actions={
                      <div className="ml-1.5 hidden gap-1 group-hover:flex print:hidden">
                        <button
                          type="button"
                          title="Move to a bed (click-to-move)"
                          onClick={() => setClickMove({ occ, fromBedId: b.id })}
                          className="flex h-6 w-6 items-center justify-center rounded-[7px] border border-line bg-panel text-xs text-muted-foreground hover:text-ink"
                        >
                          ⇲
                        </button>
                        <button
                          type="button"
                          title="Move to another property"
                          onClick={() => setXprop({ occ, fromBedId: b.id })}
                          className="flex h-6 w-6 items-center justify-center rounded-[7px] border border-line bg-panel text-xs text-muted-foreground hover:text-ink"
                        >
                          ⇄
                        </button>
                        <button
                          type="button"
                          title="Move out / remove"
                          onClick={() => {
                            setMoReason(MOVE_OUT_REASONS[0]);
                            setMoBedReady(false);
                            setMoveOutModal({ occ, fromBedId: b.id });
                          }}
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
      </PrintView>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOverZone(true);
        }}
        onDragLeave={() => setOverZone(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOverZone(false);
          if (dragOcc) {
            setMoReason(MOVE_OUT_REASONS[0]);
            setMoBedReady(false);
            setMoveOutModal({ occ: dragOcc.occ, fromBedId: dragOcc.fromBedId });
          }
        }}
        className={[
          "print:hidden mt-4 rounded-[14px] border-2 border-dashed p-4 text-center text-[13px] font-bold transition-colors",
          overZone ? "border-risk bg-risk-soft text-risk" : "border-[#E2A9B4] bg-[#FDF3F5] text-[#B0405A]",
        ].join(" ")}
      >
        ↩ Drag a person here to move them out / unassign
      </div>

      {/* Move-out reason prompt (#24 + confirm #17) */}
      {moveOutModal && (
        <Modal onClose={() => setMoveOutModal(null)} title={`Move out ${(moveOutModal.occ as { name?: string }).name ?? "person"}?`}>
          <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-faint">Reason</label>
          <select
            value={moReason}
            onChange={(e) => setMoReason(e.target.value)}
            className="mb-3 w-full rounded-[9px] border border-line bg-panel px-3 py-2 text-sm text-ink"
          >
            {MOVE_OUT_REASONS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
          <label className="mb-4 flex items-center gap-2 text-[13px] text-ink">
            <input type="checkbox" checked={moBedReady} onChange={(e) => setMoBedReady(e.target.checked)} />
            Bed is clean &amp; ready now (otherwise it goes to cleaning)
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setMoveOutModal(null)} className="rounded-[9px] border border-line px-3 py-1.5 text-[13px] font-semibold text-ink">Cancel</button>
            <button
              type="button"
              onClick={() => reallyMoveOut(moveOutModal.occ, moveOutModal.fromBedId, moReason, moBedReady)}
              className="rounded-[9px] bg-risk px-3 py-1.5 text-[13px] font-semibold text-white"
            >
              Move out
            </button>
          </div>
        </Modal>
      )}

      {/* Click-to-move (#23): open-bed menu in this property */}
      {clickMove && (
        <Modal onClose={() => setClickMove(null)} title={`Move ${(clickMove.occ as { name?: string }).name ?? "person"} to…`}>
          {openBedsHere.length === 0 ? (
            <div className="text-[13px] text-muted-foreground">No open beds in this property.</div>
          ) : (
            <div className="max-h-72 overflow-auto">
              {openBedsHere.map((ob) => (
                <button
                  key={ob.id}
                  type="button"
                  onClick={() => {
                    doMove(clickMove.occ, clickMove.fromBedId, ob.id);
                    setClickMove(null);
                  }}
                  className="flex w-full items-center justify-between border-b border-line px-1 py-2 text-left text-[13px] text-ink hover:bg-accent"
                >
                  <span>{ob.label}</span>
                  <span className="text-brand">Move →</span>
                </button>
              ))}
            </div>
          )}
        </Modal>
      )}

      {/* Cross-property picker (#11) */}
      {xprop && (
        <Modal onClose={() => setXprop(null)} title={`Move ${(xprop.occ as { name?: string }).name ?? "person"} to another property`}>
          {otherOpenBeds.length === 0 ? (
            <div className="text-[13px] text-muted-foreground">No open beds at other properties.</div>
          ) : (
            <div className="max-h-80 overflow-auto">
              {otherOpenBeds.map((ob) => (
                <button
                  key={ob.bedId}
                  type="button"
                  onClick={() => doXPropMove(xprop.occ, xprop.fromBedId, ob.bedId)}
                  className="flex w-full items-center justify-between border-b border-line px-1 py-2 text-left text-[13px] text-ink hover:bg-accent"
                >
                  <span><b>{ob.propName}</b> · {ob.label}</span>
                  <span className="text-brand">Move →</span>
                </button>
              ))}
            </div>
          )}
        </Modal>
      )}

      {/* Undo bar (#15) */}
      {undoBar && (
        <div className="print:hidden fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-[12px] bg-ink px-4 py-2.5 text-[13px] font-semibold text-white shadow-lg">
          <span>✓ {undoBar.label}</span>
          <button type="button" onClick={undoBar.run} className="rounded-[7px] bg-white/15 px-2.5 py-1 hover:bg-white/25">Undo</button>
        </div>
      )}
    </div>
  );
}

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="print:hidden fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-[16px] bg-panel p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 text-[15px] font-bold text-ink">{title}</h3>
        {children}
      </div>
    </div>
  );
}
