import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useListAllProjectedMoveIns, useListActiveRoster } from "@workspace/api-client-react";
import { useData } from "@/context/data-store";
import { useToast } from "@/hooks/use-toast";
import { StatCard, Seg, accentFor, initialsOf, PrintView, WhyPopover } from "@/components/kit-v2";
import { Bed, RoomCard } from "@/components/kit-v2";
import { ErrorBoundary } from "@/components/error-boundary";
import { netDisplay } from "@/lib/money-honesty";
import { toWeeklyCharge, formatUsdWhole, type Property, type Occupant } from "@/data/mockData";

const apiBase = (): string => (import.meta.env.BASE_URL ?? "/") as string;
const CHARGE_MODE_KEY = "kfi.xprop.chargeMode"; // remembered session choice (#26)
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
export function BedBoardV2({
  property,
  showStats = true,
}: {
  property: Property;
  /**
   * Item 6 — the property-detail page already renders its own richer KPI
   * header (Total Beds / Occupied / Available / Net Profit + financials), so
   * it passes showStats={false} to suppress this board's duplicate Capacity/
   * Occupied/Open/Net strip. Defaults true so the customer all-beds view (no
   * page header) keeps the stats — the gold look is unchanged there.
   */
  showStats?: boolean;
}) {
  const { rooms, beds, occupants, customers, properties, updateBed, updateOccupant, addOccupant, addBed, deleteBed, addRoom } = useData();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [colorBy, setColorBy] = useState<ColorBy>("shift");
  // Item 2 — "Edit beds" mode: changes bed/room INVENTORY (add/remove beds,
  // add a room). Deliberately separate from assigning a PERSON to a bed so the
  // two never get confused. Off by default.
  const [editBeds, setEditBeds] = useState(false);
  // Item 3 guard rail — confirm before removing a bed (only empty beds).
  const [confirmRemoveBed, setConfirmRemoveBed] = useState<string | null>(null);
  // #5 assign-bed picker (Zenople roster or manual) for an open bed
  const [assignBed, setAssignBed] = useState<string | null>(null);
  const [assignQ, setAssignQ] = useState("");
  const [assignBusy, setAssignBusy] = useState(false);
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
  // #26 charge-mode prompt, #22 bulk select, #21 move-in queue
  const [chargePick, setChargePick] = useState<{ occ: Occupant; fromBedId: string; toBedId: string } | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set()); // selected occupied bedIds
  const [dragMoveIn, setDragMoveIn] = useState<{ id: string; name: string } | null>(null);
  // Phase 6 — a big ALL-empty room (e.g. a synthetic "Auto — capacity backfill"
  // with 9-11 open slots) is collapsed to a compact "N open beds" card so it
  // can't blow card height; operators expand it to assign bed-by-bed.
  const [expandedRooms, setExpandedRooms] = useState<Set<string>>(new Set());

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
  // Item 2 — inventory edits (use the existing data-store hooks). IDs are
  // time-based so they're unique within the session; the server keys on them.
  const nextBedNumber = () =>
    propBeds.reduce((m, b) => Math.max(m, Number((b as { bedNumber?: number }).bedNumber) || 0), 0) + 1;
  const handleAddBed = (roomId: string) => {
    const n = nextBedNumber();
    addBed({
      id: `bed-${roomId}-${Date.now()}`,
      propertyId: property.id,
      bedNumber: n,
      roomId,
      status: "Vacant",
      occupantId: null,
      cleaningStatus: "ready",
    } as never);
    toast({ title: "Bed added", description: `Empty bed #${n} added to the room.` });
  };
  const handleRemoveBed = (bedId: string) => {
    // Safety: only ever remove a bed with no person on it.
    if (occByBed[bedId]) return;
    deleteBed(bedId);
    toast({ title: "Bed removed" });
  };
  const handleAddRoom = () => {
    const n = propRooms.length + 1;
    void addRoom({
      id: `room-${property.id}-${Date.now()}`,
      propertyId: property.id,
      buildingId: "",
      name: `Room ${n}`,
      sqft: 0,
      bathrooms: 1,
      monthlyRent: 0,
    } as never);
    toast({ title: "Room added", description: `“Room ${n}” added — add beds to it.` });
  };

  const occById = useMemo(() => {
    const m = new Map<string, Occupant>();
    occupants.forEach((o) => m.set(o.id, o));
    return m;
  }, [occupants]);

  // #5 — the live Zenople roster powers the "+ assign bed" picker. Cast-safe:
  // the shape comes from the direct /api/roster/active endpoint.
  const rosterQuery = useListActiveRoster();
  const rosterPeople = useMemo(
    () =>
      ((rosterQuery.data as unknown as {
        people?: Array<{ personId: string; name?: string; company?: string; weeklyDeduction?: number }>;
      })?.people ?? []),
    [rosterQuery.data],
  );
  // employeeId(personId) -> existing occupant, so picking someone already in the
  // system MOVES them (never duplicates). Prefer an Active record.
  const occByEmp = useMemo(() => {
    const m = new Map<string, Occupant>();
    occupants.forEach((o) => {
      const eid = (o as { employeeId?: string }).employeeId;
      if (!eid) return;
      const prev = m.get(eid);
      const active = String((o as { status?: string }).status ?? "Active") !== "Former";
      if (!prev || active) m.set(eid, o);
    });
    return m;
  }, [occupants]);
  const assignChoices = useMemo(() => {
    const q = assignQ.trim().toLowerCase();
    return rosterPeople
      .map((p) => {
        const existing = occByEmp.get(p.personId);
        return {
          personId: p.personId,
          name: p.name || "—",
          company: p.company || "",
          weekly: typeof p.weeklyDeduction === "number" ? p.weeklyDeduction : 0,
          existing,
          placed: !!(existing && (existing as { bedId?: string }).bedId),
        };
      })
      .filter((r) => !q || r.name.toLowerCase().includes(q) || r.company.toLowerCase().includes(q))
      .sort((a, b) => Number(a.placed) - Number(b.placed) || a.name.localeCompare(b.name))
      .slice(0, 40);
  }, [rosterPeople, occByEmp, assignQ]);

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
  // Phase 4/11 money honesty — only call it a loss when collected is real.
  // People housed + rent set but $0 collected => deductions still syncing,
  // not a −$rent loss. netDisplay returns {kind:"syncing"} in that case.
  const netD = netDisplay({ collected: collectedMo, rent: rentMo, housed: occupied });
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

  async function postMove(occId: string, fromBedId: string, toBedId: string, chargeMode?: string): Promise<boolean> {
    try {
      const r = await fetch(`${apiBase()}api/beds/move`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ occupantId: occId, fromBedId, toBedId, ...(chargeMode ? { chargeMode } : {}) }),
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

  // cross-property move (#11) + charge-follows-move (#26): ask once which rate to
  // use, remember the choice for the session, pass chargeMode to the move.
  async function doXPropMove(occ: Occupant, fromBedId: string, toBedId: string, chargeMode: string) {
    setXprop(null);
    setChargePick(null);
    setOccByBed((prev) => {
      const next = { ...prev };
      delete next[fromBedId];
      return next;
    });
    const ok = await postMove(occ.id, fromBedId, toBedId, chargeMode);
    const nm = (occ as { name?: string }).name ?? "person";
    if (!ok) {
      setOccByBed((prev) => ({ ...prev, [fromBedId]: occ.id }));
      toast({ title: "Cross-property move failed", variant: "destructive" as never });
      return;
    }
    toast({ title: `Moved ${nm} to another property` });
    setUndoBar({
      label: `Moved ${nm}`,
      run: async () => {
        setOccByBed((prev) => ({ ...prev, [fromBedId]: occ.id }));
        await postMove(occ.id, toBedId, fromBedId);
        setUndoBar(null);
        toast({ title: "Move undone" });
      },
    });
  }

  // Resolve chargeMode for a cross-property pick: use the remembered choice
  // silently, else open the one-time prompt.
  function pickXPropTarget(occ: Occupant, fromBedId: string, toBedId: string) {
    const remembered = (() => { try { return localStorage.getItem(CHARGE_MODE_KEY) || ""; } catch { return ""; } })();
    if (remembered) {
      doXPropMove(occ, fromBedId, toBedId, remembered);
    } else {
      setChargePick({ occ, fromBedId, toBedId });
    }
  }
  function commitChargeMode(mode: string) {
    try { localStorage.setItem(CHARGE_MODE_KEY, mode); } catch { /* ignore */ }
    if (chargePick) doXPropMove(chargePick.occ, chargePick.fromBedId, chargePick.toBedId, mode);
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

  // #21 Move-in queue: upcoming projected move-ins for THIS property.
  const projectedQuery = useListAllProjectedMoveIns();
  const upcomingMoveIns = useMemo(() => {
    const rows = (projectedQuery.data ?? []) as Array<{ id: string; propertyId: string; personName: string; projectedMoveInDate: string; convertedOccupantId?: string | null }>;
    return rows
      .filter((m) => m.propertyId === property.id && !m.convertedOccupantId)
      .sort((a, b) => String(a.projectedMoveInDate).localeCompare(String(b.projectedMoveInDate)));
  }, [projectedQuery.data, property.id]);

  // #21 convert a projected move-in onto an open bed
  async function convertMoveIn(moveInId: string, name: string, toBedId: string) {
    setDragMoveIn(null);
    try {
      const r = await fetch(`${apiBase()}api/properties/${property.id}/projected-move-ins/${moveInId}/convert`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bedId: toBedId }),
      });
      if (!r.ok) throw new Error("convert failed");
      const body = (await r.json().catch(() => ({}))) as { occupant?: { id?: string }; projectedMoveIn?: { convertedOccupantId?: string | null } };
      const newOccId = body.occupant?.id || body.projectedMoveIn?.convertedOccupantId || "";
      if (newOccId) setOccByBed((prev) => ({ ...prev, [toBedId]: newOccId }));
      toast({ title: `${name} moved in` });
      projectedQuery.refetch?.();
    } catch {
      toast({ title: "Move-in failed", variant: "destructive" as never });
    }
  }

  // #22 bulk move: pair selected occupied beds with open beds in THIS property
  async function doBulkMove() {
    const sel = [...selected];
    const opens = openBedsHere.map((o) => o.id).filter((id) => !sel.includes(id));
    const moves: Array<{ occupantId: string; fromBedId: string; toBedId: string }> = [];
    sel.forEach((fromBedId, i) => {
      const occId = occByBed[fromBedId];
      const toBedId = opens[i];
      if (occId && toBedId) moves.push({ occupantId: occId, fromBedId, toBedId });
    });
    if (moves.length === 0) {
      toast({ title: "Not enough open beds here" });
      return;
    }
    const prevMap = { ...occByBed };
    setOccByBed((prev) => {
      const next = { ...prev };
      moves.forEach((m) => {
        delete next[m.fromBedId];
        next[m.toBedId] = m.occupantId;
      });
      return next;
    });
    try {
      const r = await fetch(`${apiBase()}api/beds/move-batch`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ moves }),
      });
      if (!r.ok) throw new Error("batch failed");
      toast({ title: `Moved ${moves.length} people` });
      setUndoBar({
        label: `Moved ${moves.length} people`,
        run: async () => {
          setOccByBed(prevMap);
          await fetch(`${apiBase()}api/beds/move-batch`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ moves: moves.map((m) => ({ occupantId: m.occupantId, fromBedId: m.toBedId, toBedId: m.fromBedId })) }),
          });
          setUndoBar(null);
          toast({ title: "Bulk move undone" });
        },
      });
    } catch {
      setOccByBed(prevMap);
      toast({ title: "Bulk move failed", variant: "destructive" as never });
    }
    setSelected(new Set());
    setSelectMode(false);
  }

  // #5 — assign a roster person to an open bed. Existing occupant => a real move
  // (so we never duplicate them); brand-new => create them seated here. We never
  // fabricate a rent — chargePerBed starts at 0 and is flagged until payroll sets it.
  async function assignExisting(toBedId: string, occ: Occupant, name: string) {
    setAssignBed(null);
    setAssignQ("");
    const from = (occ as { bedId?: string }).bedId || "";
    await doMove(occ, from, toBedId);
    if (!from) toast({ title: `Assigned ${name} to a bed` });
  }
  async function createSeated(toBedId: string, name: string, personId: string, company: string) {
    setAssignBed(null);
    setAssignQ("");
    setAssignBusy(true);
    const trimmed = name.trim();
    if (!trimmed) {
      setAssignBusy(false);
      return;
    }
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `occ-${toBedId}-${trimmed.replace(/\W+/g, "")}`;
    const today = new Date().toISOString().slice(0, 10);
    const occ = {
      id,
      name: trimmed,
      email: "",
      phone: "",
      bedId: toBedId,
      propertyId: property.id,
      moveInDate: today,
      moveOutDate: null,
      status: "Active",
      chargePerBed: 0,
      billingFrequency: "Weekly",
      employeeId: personId || "",
      company: company || "",
      chargeSource: "",
      chargeSourceCustomer: "",
      chargeSourcePersonId: "",
      shift: null,
      zenoplePersonId: personId || undefined,
      zenopleStatus: personId ? "linked" : "needs_review",
    } as unknown as Occupant;
    try {
      addOccupant(occ);
      setOccByBed((prev) => ({ ...prev, [toBedId]: id }));
      try {
        updateBed(toBedId, { occupantId: id, status: "Occupied", cleaningStatus: "occupied" } as never);
      } catch {
        /* best-effort cache sync */
      }
      toast({ title: `Added ${trimmed}${personId ? "" : " — flag for payroll match"}` });
    } catch {
      toast({ title: "Could not add the person", variant: "destructive" as never });
    } finally {
      setAssignBusy(false);
    }
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

      {showStats && (
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="grid flex-1 grid-cols-2 gap-4 sm:grid-cols-4">
          <WhyPopover
            className="block w-full text-left [text-decoration:none]"
            title="Capacity"
            formula="Every bed configured in this property"
            rows={[{ k: "Rooms", v: propRooms.length }, { k: "Beds", v: capacity }]}
          >
            <StatCard label="Capacity" value={capacity} />
          </WhyPopover>
          <WhyPopover
            className="block w-full text-left [text-decoration:none]"
            title="Occupied"
            formula="Beds with an active person assigned"
            rows={[{ k: "Occupied", v: occupied }, { k: "Open", v: open }, { k: "Capacity", v: capacity }]}
          >
            <StatCard label="Occupied" value={occupied} tone="ok" />
          </WhyPopover>
          <WhyPopover
            className="block w-full text-left [text-decoration:none]"
            title="Open beds"
            formula="Capacity − Occupied"
            rows={[{ k: "Capacity", v: capacity }, { k: "Occupied", v: occupied }, { k: "Open", v: open }]}
          >
            <StatCard label="Open" value={open} tone="warn" />
          </WhyPopover>
          <WhyPopover
            className="block w-full text-left [text-decoration:none]"
            title="Net per month"
            formula={
              netD.kind === "syncing"
                ? "Rent is set, but payroll deductions for this property are still syncing — so this isn't a loss yet."
                : netD.kind === "none"
                ? "Rent is set, but nobody is housed here yet — so this isn't a loss."
                : "Collected from associates − Rent paid to landlord"
            }
            rows={[
              { k: "Collected /mo", v: formatUsdWhole(collectedMo) },
              { k: "Rent /mo", v: formatUsdWhole(rentMo) },
              netD.kind !== "net"
                ? { k: "Status", v: netD.label }
                : { k: "Net /mo", v: formatUsdWhole(netD.value) },
            ]}
            href="/finance"
            hrefLabel="See the money view →"
          >
            {netD.kind !== "net" ? (
              <StatCard label="Net /mo" value={netD.kind === "syncing" ? "Syncing…" : "—"} sub={netD.label} />
            ) : (
              <StatCard label="Net /mo" value={formatUsdWhole(netD.value)} tone={netD.value < 0 ? "risk" : "ok"} />
            )}
          </WhyPopover>
        </div>
      </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-bold uppercase tracking-[0.6px] text-faint">Color by</span>
        <Seg
          options={[
            { value: "shift", label: "Shift" },
            { value: "payroll", label: "Payroll" },
            { value: "deduction", label: "Deduction" },
          ]}
          value={colorBy}
          onChange={(v) => setColorBy(v as ColorBy)}
        />
        {/* Item 2 — toggle bed/room INVENTORY editing (add/remove beds, add a
            room). Distinct from assigning a person. */}
        <button
          type="button"
          onClick={() => { setEditBeds((s) => !s); setSelectMode(false); }}
          title="Add or remove beds & rooms (inventory) — not the same as assigning a person"
          className={[
            "ml-auto rounded-[9px] border px-3 py-1.5 text-[12px] font-bold",
            editBeds ? "border-brand bg-brand text-white" : "border-line bg-panel text-ink",
          ].join(" ")}
          data-testid="toggle-edit-beds"
        >
          {editBeds ? "Done editing beds" : "Edit beds"}
        </button>
        <button
          type="button"
          onClick={() => { setSelectMode((s) => !s); setSelected(new Set()); }}
          className={[
            "rounded-[9px] border px-3 py-1.5 text-[12px] font-bold",
            selectMode ? "border-brand bg-brand text-white" : "border-line bg-panel text-ink",
          ].join(" ")}
        >
          {selectMode ? "Done" : "Select"}
        </button>
      </div>
      {editBeds && (
        <div className="mb-3 rounded-[12px] border border-brand/30 bg-accent px-3 py-2 text-[12.5px] text-ink2">
          <b className="text-ink">Editing bed inventory.</b> Add or remove beds &amp; rooms below — this changes how many beds exist, <i>not</i> who's assigned. Only empty beds can be removed.
        </div>
      )}

      {/* #22 bulk action bar */}
      {selectMode && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-[12px] border border-brand/30 bg-accent px-3 py-2 text-[13px]">
          <b className="text-ink">{selected.size} selected</b>
          <button
            type="button"
            disabled={selected.size === 0}
            onClick={doBulkMove}
            className="rounded-[9px] bg-brand px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-40"
          >
            Move to open beds here →
          </button>
          {selected.size > 0 && (
            <button type="button" onClick={() => setSelected(new Set())} className="text-[12px] font-semibold text-muted-foreground">Clear</button>
          )}
          <span className="text-[12px] text-faint">Tap people to select, then fill the open beds in this property.</span>
        </div>
      )}

      {/* #21 Move-in queue */}
      <div className="mb-3 rounded-[14px] border border-line bg-panel p-3 print:hidden">
        <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.6px] text-faint">Coming this week — drag onto an open bed</div>
        {upcomingMoveIns.length === 0 ? (
          <div className="text-[12px] text-muted-foreground">No upcoming move-ins.</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {upcomingMoveIns.map((m) => (
              <div
                key={m.id}
                draggable
                onDragStart={() => setDragMoveIn({ id: m.id, name: m.personName })}
                onDragEnd={() => setDragMoveIn(null)}
                className="flex cursor-grab items-center gap-2 rounded-[10px] border border-dashed border-brand/40 bg-accent px-2.5 py-1.5 text-[12px] text-ink"
                title={`Projected ${m.projectedMoveInDate}`}
              >
                <span className="font-semibold">{m.personName}</span>
                <span className="text-faint">{m.projectedMoveInDate}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <PrintView title={`${(property as { name?: string }).name ?? "Property"} — Beds`} subtitle={(property as { address?: string }).address || undefined}>
      {/* Phase 5 — items-start (NOT auto-rows-fr): each card sizes to its own
          content, so a room with many open slots can't stretch its neighbors
          and leave giant blank gaps. */}
      <div className="grid items-start grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {propRooms.map((room) => {
          const rbeds = bedsByRoom.get(room.id) ?? [];
          const rOcc = rbeds.filter((b) => occByBed[b.id]).length;
          const roomName = (room as { name?: string }).name ?? "Unit";
          // Phase 6 — collapse a big all-empty room (synthetic backfill etc.).
          const collapsedEmpty = rOcc === 0 && rbeds.length >= 6 && !expandedRooms.has(room.id);
          const firstOpen = rbeds.find((b) => !occByBed[b.id]);
          return (
            // Per-card boundary (Phase 2): one bad room can never blank the board.
            <ErrorBoundary key={room.id}>
            {collapsedEmpty ? (
              <CompactEmptyRoom
                name={roomName}
                count={rbeds.length}
                onAssign={firstOpen ? () => { setAssignQ(""); setAssignBed(firstOpen.id); } : undefined}
                onExpand={() => setExpandedRooms((p) => { const n = new Set(p); n.add(room.id); return n; })}
              />
            ) : (
            <RoomCard unit={roomName} occupied={rOcc} capacity={rbeds.length}>
              {rbeds.map((b) => {
                const occ = occupantInBed(b.id);
                if (!occ) {
                  const isSuggested = suggested.has(b.id) && !!dragOcc;
                  // Item 2 — in edit mode an empty bed shows a remove control
                  // (inventory), not the assign-a-person affordance.
                  if (editBeds) {
                    return (
                      <div key={b.id} className="relative">
                        <Bed open testId={`bed-open-${b.id}`} />
                        <button
                          type="button"
                          onClick={() => setConfirmRemoveBed(b.id)}
                          title="Remove this empty bed"
                          data-testid={`bed-remove-${b.id}`}
                          className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-[7px] border border-line bg-panel text-xs text-muted-foreground hover:border-risk/40 hover:bg-risk-soft hover:text-risk"
                        >
                          ✕
                        </button>
                      </div>
                    );
                  }
                  return (
                    <div
                      key={b.id}
                      onClick={selectMode ? undefined : () => { setAssignQ(""); setAssignBed(b.id); }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setOverOpen(b.id);
                      }}
                      onDragLeave={() => setOverOpen((p) => (p === b.id ? null : p))}
                      onDrop={(e) => {
                        e.preventDefault();
                        setOverOpen(null);
                        if (dragMoveIn) convertMoveIn(dragMoveIn.id, dragMoveIn.name, b.id);
                        else if (dragOcc) doMove(dragOcc.occ, dragOcc.fromBedId, b.id);
                      }}
                      className={[
                        selectMode ? "" : "cursor-pointer",
                        overOpen === b.id
                          ? "rounded-[11px] outline outline-2 outline-brand"
                          : isSuggested
                          ? "rounded-[11px] outline outline-2 outline-ok/60"
                          : "",
                      ].filter(Boolean).join(" ") || undefined}
                      title={isSuggested ? "Suggested — same client/shift/property" : "Click to assign someone"}
                    >
                      <Bed open testId={`bed-open-${b.id}`} />
                    </div>
                  );
                }
                const nm = (occ as { name?: string }).name ?? "?";
                const isSel = selected.has(b.id);
                return (
                  <div
                    key={b.id}
                    onClick={
                      selectMode
                        ? () => setSelected((prev) => { const n = new Set(prev); if (n.has(b.id)) n.delete(b.id); else n.add(b.id); return n; })
                        : () => navigate(`/occupants/${occ.id}`)
                    }
                    title={selectMode ? undefined : `Open ${nm}'s profile`}
                    className={selectMode ? `cursor-pointer rounded-[11px] outline ${isSel ? "outline-2 outline-brand" : "outline-1 outline-line"}` : "cursor-pointer"}
                  >
                  <Bed
                    name={nm}
                    sub={shiftSub(occ)}
                    initials={initialsOf(nm)}
                    accent={avatarAccent(occ, colorBy)}
                    badge={badgeFor(occ)}
                    draggable={!selectMode}
                    onDragStart={() => {
                      setDragOcc({ occ, fromBedId: b.id });
                      loadSuggestions(occ.id);
                    }}
                    onDragEnd={() => {
                      setDragOcc(null);
                      setSuggested(new Set());
                    }}
                    testId={`bed-occ-${b.id}`}
                    actions={selectMode ? undefined : (
                      <div className="ml-1.5 hidden gap-1 group-hover:flex print:hidden">
                        <button
                          type="button"
                          title="Move to a bed (click-to-move)"
                          onClick={(e) => { e.stopPropagation(); setClickMove({ occ, fromBedId: b.id }); }}
                          className="flex h-6 w-6 items-center justify-center rounded-[7px] border border-line bg-panel text-xs text-muted-foreground hover:text-ink"
                        >
                          ⇲
                        </button>
                        <button
                          type="button"
                          title="Move to another property"
                          onClick={(e) => { e.stopPropagation(); setXprop({ occ, fromBedId: b.id }); }}
                          className="flex h-6 w-6 items-center justify-center rounded-[7px] border border-line bg-panel text-xs text-muted-foreground hover:text-ink"
                        >
                          ⇄
                        </button>
                        <button
                          type="button"
                          title="Move out / remove"
                          onClick={(e) => {
                            e.stopPropagation();
                            setMoReason(MOVE_OUT_REASONS[0]);
                            setMoBedReady(false);
                            setMoveOutModal({ occ, fromBedId: b.id });
                          }}
                          className="flex h-6 w-6 items-center justify-center rounded-[7px] border border-line bg-panel text-xs text-muted-foreground hover:border-risk/40 hover:bg-risk-soft hover:text-risk"
                        >
                          ✕
                        </button>
                      </div>
                    )}
                  />
                  </div>
                );
              })}
              {editBeds && (
                <button
                  type="button"
                  onClick={() => handleAddBed(room.id)}
                  data-testid={`room-add-bed-${room.id}`}
                  className="flex w-full items-center justify-center gap-1.5 rounded-[11px] border border-dashed border-brand/50 bg-accent/40 px-3 py-2 text-[12.5px] font-bold text-brand hover:bg-accent print:hidden"
                >
                  <span aria-hidden className="text-[15px] leading-none">＋</span> Add bed to this room
                </button>
              )}
            </RoomCard>
            )}
            </ErrorBoundary>
          );
        })}
        {editBeds && (
          <button
            type="button"
            onClick={handleAddRoom}
            data-testid="board-add-room"
            className="flex min-h-[120px] flex-col items-center justify-center gap-2 rounded-[14px] border-2 border-dashed border-brand/40 bg-accent/30 p-4 text-[13px] font-bold text-brand hover:bg-accent print:hidden"
          >
            <span aria-hidden className="text-[22px] leading-none">＋</span> Add room / unit
          </button>
        )}
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

      {/* Item 3 — confirm before removing a bed from inventory. */}
      {confirmRemoveBed && (
        <Modal onClose={() => setConfirmRemoveBed(null)} title="Remove this empty bed?">
          <div className="space-y-4 text-[13px] text-ink2">
            <p>
              This removes the bed from the room&apos;s inventory. It has no one assigned,
              so nobody is affected — you can add it back anytime with <b>+ Add bed</b>.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmRemoveBed(null)}
                className="rounded-[9px] border border-line bg-panel px-3.5 py-2 text-[13px] font-semibold text-ink2 hover:bg-track"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="bed-remove-confirm"
                onClick={() => {
                  handleRemoveBed(confirmRemoveBed);
                  setConfirmRemoveBed(null);
                }}
                className="rounded-[9px] bg-risk px-3.5 py-2 text-[13px] font-bold text-white hover:bg-risk/90"
              >
                Remove bed
              </button>
            </div>
          </div>
        </Modal>
      )}

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
                  onClick={() => pickXPropTarget(xprop.occ, xprop.fromBedId, ob.bedId)}
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

      {/* Charge-follows-move prompt (#26) — asked once, remembered */}
      {chargePick && (
        <Modal onClose={() => setChargePick(null)} title="Which rent should follow them?">
          <div className="mb-4 text-[13px] text-muted-foreground">
            {(chargePick.occ as { name?: string }).name ?? "This person"} is moving to a different client's property.
          </div>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => commitChargeMode("keep")}
              className="rounded-[9px] border border-line bg-panel px-3 py-2 text-left text-[13px] font-semibold text-ink hover:bg-accent"
            >
              Keep their current weekly rent
            </button>
            <button
              type="button"
              onClick={() => commitChargeMode("client_default")}
              className="rounded-[9px] border border-line bg-panel px-3 py-2 text-left text-[13px] font-semibold text-ink hover:bg-accent"
            >
              Use the new client's rate
            </button>
          </div>
          <div className="mt-3 text-[11px] text-faint">We'll remember this choice for this session.</div>
        </Modal>
      )}

      {/* Assign a bed (#5) — Zenople roster picker or manual add */}
      {assignBed && (
        <Modal onClose={() => { setAssignBed(null); setAssignQ(""); }} title={`Assign ${roomBedLabel(assignBed)}`}>
          <input
            autoFocus
            value={assignQ}
            onChange={(e) => setAssignQ(e.target.value)}
            placeholder="Search the active roster by name or client…"
            className="mb-2 w-full rounded-[9px] border border-line bg-panel px-3 py-2 text-sm text-ink outline-none placeholder:text-faint focus:border-brand"
          />
          <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.5px] text-faint">
            {rosterQuery.isLoading ? "Loading roster…" : `Active roster (${assignChoices.length}${assignChoices.length === 40 ? "+" : ""})`}
          </div>
          <div className="max-h-64 overflow-auto rounded-[10px] border border-line">
            {assignChoices.length === 0 ? (
              <div className="px-3 py-4 text-center text-[12.5px] text-muted-foreground">
                {rosterQuery.isLoading ? "Loading…" : assignQ.trim() ? "No roster match — add them manually below." : "No active roster available."}
              </div>
            ) : (
              assignChoices.map((c) => (
                <button
                  key={c.personId}
                  type="button"
                  disabled={assignBusy}
                  onClick={() =>
                    c.existing
                      ? assignExisting(assignBed, c.existing, c.name)
                      : createSeated(assignBed, c.name, c.personId, c.company)
                  }
                  className="flex w-full items-center justify-between gap-2 border-b border-line px-3 py-2 text-left text-[13px] text-ink last:border-b-0 hover:bg-accent disabled:opacity-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{c.name}</span>
                    <span className="block truncate text-[11.5px] text-muted-foreground">
                      {c.company || "—"}
                      {c.placed ? " · already in a bed (will move)" : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-[11.5px] font-semibold text-faint">
                    {c.weekly > 0 ? `$${Math.round(c.weekly)}/wk` : "no deduction"}
                  </span>
                </button>
              ))
            )}
          </div>
          {assignQ.trim() && (
            <button
              type="button"
              disabled={assignBusy}
              onClick={() => createSeated(assignBed, assignQ, "", "")}
              className="mt-3 w-full rounded-[9px] border border-dashed border-brand/50 bg-accent px-3 py-2 text-[13px] font-semibold text-brand hover:bg-accent/70 disabled:opacity-50"
            >
              + Add “{assignQ.trim()}” as a new person (flag for payroll match)
            </button>
          )}
          <div className="mt-2 text-[11px] text-faint">
            Picking someone already in the system moves them here. New people start at $0 rent until payroll matches them.
          </div>
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

/** Phase 6 — a compact stand-in for a big all-empty room so a synthetic
 *  backfill room with many open slots stays a small, tidy card. */
function CompactEmptyRoom({
  name,
  count,
  onAssign,
  onExpand,
}: {
  name: string;
  count: number;
  onAssign?: () => void;
  onExpand: () => void;
}) {
  return (
    <div className="rounded-[14px] border border-line bg-panel p-3.5">
      <div className="flex items-center justify-between">
        <div className="truncate text-[13px] font-bold text-ink">{name}</div>
        <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold text-brand tabular-nums">
          {count} open
        </span>
      </div>
      <div className="mt-1 text-[12px] text-muted-foreground">All beds open — nobody assigned yet.</div>
      <div className="mt-2.5 flex flex-wrap gap-2">
        {onAssign && (
          <button
            type="button"
            onClick={onAssign}
            className="rounded-[9px] bg-brand px-2.5 py-1.5 text-[12px] font-bold text-white hover:opacity-90"
          >
            + Assign a bed
          </button>
        )}
        <button
          type="button"
          onClick={onExpand}
          className="rounded-[9px] border border-line bg-panel px-2.5 py-1.5 text-[12px] font-semibold text-ink hover:bg-accent"
        >
          Show all {count} beds
        </button>
      </div>
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
