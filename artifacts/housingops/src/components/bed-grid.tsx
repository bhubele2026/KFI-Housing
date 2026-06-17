import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useListActiveRoster } from "@workspace/api-client-react";
import { useData } from "@/context/data-store";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChevronRight,
  Plus,
  Search,
  ArrowLeftRight,
  LogOut,
  UserPlus,
  Trash2,
} from "lucide-react";
import { shortPropertyName } from "@/lib/property-name";
import { titleCaseName } from "@/lib/name-format";
import type { Bed, Occupant, Property } from "@/data/mockData";

/**
 * Shared BED GRID for ONE property — one row per room, beds as columns.
 * Used by the customer-scoped bed area AND the property page's Beds tab so
 * both surfaces look and behave identically. Self-contained: it reads the
 * data store + active roster and owns every mutation (assign / move /
 * remove / replace / match / cleaning / add-unit / add-bed / remove-unit),
 * so callers only pass the property.
 *
 * Click a person's NAME for an actions menu (Match / Move / Replace /
 * Remove); assign a vacant bed from the ACTIVE ROSTER (most recent payroll
 * week). The name is never an inline rename — it only opens the menu.
 */

const MAX_BED_COLS = 6;
const today = () => new Date().toISOString().split("T")[0];

type RosterPerson = { personId: string; name: string; company: string };
type VacantBed = { id: string; propertyId: string; label: string };

export function PropertyBedTable({
  property,
  showHeaderLink = true,
}: {
  property: Property;
  /** Link the property name to its detail page (off when already there). */
  showHeaderLink?: boolean;
}) {
  const {
    properties, rooms, beds, occupants,
    addOccupant, addBed, addRoom, updateBed, updateOccupant, deleteBed, deleteRoom,
  } = useData();

  const rosterPeople: RosterPerson[] = (useListActiveRoster().data?.people ?? []).map((p) => ({
    personId: p.personId,
    name: p.name,
    company: p.company,
  }));
  const rosterIds = new Set(rosterPeople.map((p) => p.personId));

  const propertyName = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of properties) m.set(p.id, shortPropertyName(p.name));
    return m;
  }, [properties]);
  const roomName = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rooms) m.set(r.id, r.name);
    return m;
  }, [rooms]);

  const occupantByBedId = useMemo(() => {
    const m = new Map<string, Occupant>();
    for (const o of occupants) {
      if (o.status === "Active" && o.bedId) m.set(o.bedId, o);
    }
    return m;
  }, [occupants]);

  const vacantBeds: VacantBed[] = useMemo(
    () =>
      beds
        .filter((b) => b.status === "Vacant" && b.cleaningStatus === "ready")
        .map((b) => ({
          id: b.id,
          propertyId: b.propertyId,
          label: `${propertyName.get(b.propertyId) ?? "—"} · ${roomName.get(b.roomId) ?? "—"} · Bed ${b.bedNumber}`,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [beds, propertyName, roomName],
  );

  const block = useMemo(() => {
    const propBeds = beds.filter((b) => b.propertyId === property.id);
    const byRoom = new Map<string, Bed[]>();
    for (const b of propBeds) {
      const arr = byRoom.get(b.roomId) ?? [];
      arr.push(b);
      byRoom.set(b.roomId, arr);
    }
    const roomRows = [...byRoom.entries()]
      .map(([roomId, rBeds]) => ({
        roomId,
        name: roomName.get(roomId) || "—",
        beds: rBeds.slice().sort((a, b) => a.bedNumber - b.bedNumber),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    const maxBeds = roomRows.reduce((m, r) => Math.max(m, r.beds.length), 1);
    const colCount = Math.min(Math.max(maxBeds, 1), MAX_BED_COLS);
    const total = propBeds.length;
    const occupied = propBeds.filter((b) => occupantByBedId.has(b.id)).length;
    return { roomRows, colCount, total, occupied };
  }, [beds, property.id, roomName, occupantByBedId]);

  // ── Mutations ──────────────────────────────────────────────────────
  const makeOccupant = (person: RosterPerson, bed: Bed): Occupant => ({
    id: `occ-${Date.now()}`,
    propertyId: bed.propertyId,
    bedId: bed.id,
    name: titleCaseName(person.name),
    employeeId: person.personId,
    company: person.company ?? "",
    moveInDate: today(),
    moveOutDate: null,
    status: "Active",
    chargePerBed: 0,
    billingFrequency: "Monthly",
    email: "",
    phone: "",
    chargeSource: "",
    chargeSourceCustomer: "",
    chargeSourcePersonId: "",
    shift: null,
    language: null,
    gender: null,
    title: null,
    kfisAuthorizedToDrive: null,
    createdAt: new Date().toISOString(),
  });

  const handleAssign = (bed: Bed, person: RosterPerson) => {
    const occ = makeOccupant(person, bed);
    addOccupant(occ);
    updateBed(bed.id, { status: "Occupied", occupantId: occ.id });
  };
  const handleMove = (occ: Occupant, bedId: string, propertyId: string) => {
    updateOccupant(occ.id, { bedId, propertyId });
    updateBed(bedId, { status: "Occupied", occupantId: occ.id });
  };
  const handleRemove = (bed: Bed, occ: Occupant) => {
    updateBed(bed.id, { status: "Vacant", occupantId: null });
    updateOccupant(occ.id, { status: "Former", bedId: null });
  };
  const handleReplace = (bed: Bed, current: Occupant, person: RosterPerson) => {
    updateOccupant(current.id, { status: "Former", bedId: null });
    updateBed(bed.id, { status: "Vacant", occupantId: null, cleaningStatus: "ready" });
    const occ = makeOccupant(person, bed);
    addOccupant(occ);
    updateBed(bed.id, { status: "Occupied", occupantId: occ.id });
  };
  const handleSetCleaning = (bed: Bed, status: "ready" | "needs_cleaning") =>
    updateBed(bed.id, { cleaningStatus: status });
  const handleMatch = (occ: Occupant, person: RosterPerson) =>
    updateOccupant(occ.id, {
      employeeId: person.personId,
      name: titleCaseName(person.name),
      company: person.company || occ.company,
    });

  const handleAddBed = (roomId: string, existingBeds: Bed[]) => {
    const nextNum = existingBeds.reduce((m, b) => Math.max(m, b.bedNumber), 0) + 1;
    addBed({ id: `bed-${Date.now()}`, propertyId: property.id, bedNumber: nextNum, roomId, status: "Vacant", occupantId: null });
  };
  const handleAddUnit = (unitCount: number) => {
    const roomId = `room-${Date.now()}`;
    addRoom({ id: roomId, propertyId: property.id, buildingId: "", name: `New Unit ${unitCount + 1}`, sqft: 0, bathrooms: 0, monthlyRent: 0 });
    addBed({ id: `bed-${Date.now() + 1}`, propertyId: property.id, bedNumber: 1, roomId, status: "Vacant", occupantId: null });
  };
  const handleRemoveUnit = async (roomId: string, roomBeds: Bed[]) => {
    for (const b of roomBeds) deleteBed(b.id);
    try {
      await deleteRoom(roomId);
    } catch {
      /* data-store surfaces a toast; beds are already gone */
    }
  };

  const cellProps = { rosterPeople, rosterIds, vacantBeds, onAssign: handleAssign, onMove: handleMove, onRemove: handleRemove, onReplace: handleReplace, onSetCleaning: handleSetCleaning, onMatch: handleMatch };
  const { roomRows, colCount, total, occupied } = block;
  const bedCols = Array.from({ length: colCount }, (_, i) => i);

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-muted/60 px-4 py-3 border-b">
        {showHeaderLink ? (
          <Link href={`/properties/${property.id}`} className="group min-w-0 flex items-baseline gap-2">
            <span className="font-semibold group-hover:text-primary group-hover:underline truncate">
              {shortPropertyName(property.name)}
            </span>
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary shrink-0 self-center" />
            <span className="text-xs text-muted-foreground truncate">
              {[property.address, property.city, property.state].filter(Boolean).join(", ")}
            </span>
          </Link>
        ) : (
          <span className="font-semibold truncate min-w-0">{shortPropertyName(property.name)}</span>
        )}
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant={occupied < total ? "secondary" : "default"}>
            {occupied}/{total} beds filled
          </Badge>
          <Button type="button" variant="outline" size="sm" className="gap-1 h-7"
            onClick={() => handleAddUnit(roomRows.length)} title="Add a new unit / room with a bed">
            <Plus className="h-3.5 w-3.5" /> Add unit
          </Button>
        </div>
      </div>

      {total === 0 ? (
        <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-muted-foreground">
          <span>No beds set up yet for this property.</span>
          <Button type="button" variant="outline" size="sm" className="gap-1 h-7 shrink-0"
            onClick={() => handleAddUnit(roomRows.length)}>
            <Plus className="h-3.5 w-3.5" /> Add unit
          </Button>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full table-fixed text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/30">
                <th className="px-3 py-2.5 text-left font-medium w-[26%]">Room / Unit</th>
                <th className="px-2 py-2.5 text-center font-medium w-14">Cap</th>
                {bedCols.map((i) => (
                  <th key={i} className="px-3 py-2.5 text-left font-medium border-l border-border/40">Bed {i + 1}</th>
                ))}
                <th className="px-2 py-2.5 text-center font-medium w-16 border-l border-border/40">Open</th>
              </tr>
            </thead>
            <tbody>
              {roomRows.map((room) => {
                const cap = room.beds.length;
                const occ = room.beds.filter((b) => occupantByBedId.has(b.id)).length;
                const open = cap - occ;
                return (
                  <tr key={room.roomId} className="border-t hover:bg-muted/20">
                    <td className="px-3 py-2.5">
                      <div className="group/r flex items-center gap-2">
                        <span className="font-medium truncate">{room.name}</span>
                        <button type="button" onClick={() => handleAddBed(room.roomId, room.beds)}
                          title="Add a bed to this unit"
                          className="opacity-0 group-hover/r:opacity-100 focus:opacity-100 transition-opacity inline-flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-primary shrink-0">
                          <Plus className="h-3 w-3" /> bed
                        </button>
                        <button type="button"
                          disabled={occ > 0}
                          onClick={() => {
                            if (occ === 0 && window.confirm(`Remove unit "${room.name}" and its ${cap} bed${cap === 1 ? "" : "s"}?`)) {
                              handleRemoveUnit(room.roomId, room.beds);
                            }
                          }}
                          title={occ > 0 ? "Vacate occupants before removing this unit" : "Remove this unit"}
                          className="opacity-0 group-hover/r:opacity-100 focus:opacity-100 transition-opacity inline-flex items-center text-muted-foreground hover:text-destructive disabled:cursor-not-allowed disabled:opacity-30 shrink-0">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                    <td className="px-2 py-2.5 text-center text-muted-foreground">{cap}</td>
                    {bedCols.map((i) => {
                      if (i === colCount - 1 && room.beds.length > colCount) {
                        return (
                          <td key={i} className="px-3 py-2 border-l border-border/40 align-middle">
                            <div className="space-y-1.5">
                              {room.beds.slice(colCount - 1).map((b) => (
                                <BedCell key={b.id} bed={b} occ={occupantByBedId.get(b.id)} {...cellProps} />
                              ))}
                            </div>
                          </td>
                        );
                      }
                      const b = room.beds[i];
                      return (
                        <td key={i} className="px-3 py-2 border-l border-border/40 align-middle">
                          {b ? <BedCell bed={b} occ={occupantByBedId.get(b.id)} {...cellProps} /> : null}
                        </td>
                      );
                    })}
                    <td className={"px-2 py-2.5 text-center font-medium border-l border-border/40 " + (open > 0 ? "text-amber-600" : "text-muted-foreground")}>
                      {open}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

interface CellHandlers {
  rosterPeople: RosterPerson[];
  vacantBeds: VacantBed[];
  onAssign: (bed: Bed, person: RosterPerson) => void;
  onMove: (occ: Occupant, bedId: string, propertyId: string) => void;
  onRemove: (bed: Bed, occ: Occupant) => void;
  onReplace: (bed: Bed, current: Occupant, person: RosterPerson) => void;
  rosterIds: Set<string>;
  onSetCleaning: (bed: Bed, status: "ready" | "needs_cleaning") => void;
  onMatch: (occ: Occupant, person: RosterPerson) => void;
}

function BedCell({ bed, occ, ...h }: { bed: Bed; occ: Occupant | undefined } & CellHandlers) {
  if (occ) return <ManageOccupantDialog bed={bed} occ={occ} {...h} />;
  if (bed.cleaningStatus !== "ready")
    return (
      <button
        type="button"
        onClick={() => h.onSetCleaning(bed, "ready")}
        title="Mark clean & ready to assign"
        className="inline-flex items-center gap-1 text-xs text-amber-600 hover:text-amber-700"
      >
        🧹 cleaning <span className="underline">· mark ready</span>
      </button>
    );
  return (
    <div className="group/bc flex items-center justify-between gap-1">
      <AssignFromRosterDialog bed={bed} rosterPeople={h.rosterPeople} onAssign={h.onAssign} />
      <button
        type="button"
        onClick={() => h.onSetCleaning(bed, "needs_cleaning")}
        title="Flag this bed as needs cleaning"
        className="opacity-0 group-hover/bc:opacity-100 focus:opacity-100 transition-opacity shrink-0 text-[11px] text-muted-foreground hover:text-amber-600"
      >
        🧹
      </button>
    </div>
  );
}

function RosterPicker({ people, onPick }: { people: RosterPerson[]; onPick: (p: RosterPerson) => void }) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const filtered = needle
    ? people.filter((p) => `${p.name} ${p.company}`.toLowerCase().includes(needle))
    : people;
  return (
    <div className="min-w-0 space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the active roster…" className="pl-8" autoFocus />
      </div>
      <div className="max-h-72 w-full overflow-y-auto overflow-x-hidden rounded-md border divide-y">
        {filtered.length === 0 ? (
          <div className="p-3 text-sm text-muted-foreground text-center">
            {people.length === 0 ? "Active roster not loaded." : "No matches."}
          </div>
        ) : (
          filtered.slice(0, 200).map((p) => (
            <button key={p.personId} type="button" onClick={() => onPick(p)}
              className="flex w-full min-w-0 items-center justify-between gap-3 px-3 py-2 text-left hover:bg-muted/50">
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{titleCaseName(p.name)}</span>
              <span className="min-w-0 shrink truncate text-right text-xs text-muted-foreground">{p.company}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function AssignFromRosterDialog({ bed, rosterPeople, onAssign }: { bed: Bed; rosterPeople: RosterPerson[]; onAssign: (bed: Bed, person: RosterPerson) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary" title="Assign from the active roster">
          <Plus className="h-3 w-3" /> Assign
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Assign to this bed</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground -mt-1">Pick someone from the most recent active payroll week.</p>
        <RosterPicker people={rosterPeople} onPick={(p) => { onAssign(bed, p); setOpen(false); }} />
      </DialogContent>
    </Dialog>
  );
}

function ManageOccupantDialog({ bed, occ, rosterPeople, rosterIds, vacantBeds, onMove, onRemove, onReplace, onMatch }: { bed: Bed; occ: Occupant } & CellHandlers) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"menu" | "move" | "replace" | "match">("menu");
  const [moveBedId, setMoveBedId] = useState("");
  const reset = () => { setMode("menu"); setMoveBedId(""); };
  const close = () => { setOpen(false); reset(); };
  const moveTargets = vacantBeds.filter((b) => b.id !== bed.id);
  const chosen = moveTargets.find((b) => b.id === moveBedId);
  const payrollDeduction = occ.chargeSource === "payroll" && occ.chargePerBed > 0 ? occ.chargePerBed : 0;
  const matched = !!occ.employeeId && rosterIds.has(occ.employeeId);
  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <button type="button" className="block w-full text-left group/cell" title={`Manage ${titleCaseName(occ.name)}`}>
          <span className="block text-sm font-medium truncate group-hover/cell:text-primary group-hover/cell:underline">
            {titleCaseName(occ.name)}
          </span>
          <span className="mt-0.5 flex items-center gap-2 text-[11px] leading-tight">
            {payrollDeduction > 0 && (
              <span className="text-muted-foreground">${Math.round(payrollDeduction)}/wk</span>
            )}
            {matched ? (
              <span className="text-emerald-600">✓ matched</span>
            ) : (
              <span className="text-amber-600">⚠ needs match</span>
            )}
          </span>
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{titleCaseName(occ.name)}</DialogTitle></DialogHeader>
        {mode === "menu" && (
          <div className="space-y-2 pt-1">
            <Button
              variant={matched ? "outline" : "default"}
              className="w-full justify-start gap-2"
              onClick={() => setMode("match")}
            >
              <Search className="h-4 w-4" />
              {matched ? "Re-match to a roster person" : "Match to a roster person"}
            </Button>
            <Button variant="outline" className="w-full justify-start gap-2" onClick={() => setMode("move")}>
              <ArrowLeftRight className="h-4 w-4" /> Move to another bed
            </Button>
            <Button variant="outline" className="w-full justify-start gap-2" onClick={() => setMode("replace")}>
              <UserPlus className="h-4 w-4" /> Replace with someone else
            </Button>
            <Button variant="outline" className="w-full justify-start gap-2 text-destructive hover:text-destructive"
              onClick={() => { onRemove(bed, occ); close(); }}>
              <LogOut className="h-4 w-4" /> Remove from bed
            </Button>
          </div>
        )}
        {mode === "move" && (
          <div className="space-y-3 pt-1">
            <p className="text-sm text-muted-foreground">Move {titleCaseName(occ.name)} to a vacant, ready bed (their current bed is freed automatically).</p>
            <Select value={moveBedId} onValueChange={setMoveBedId}>
              <SelectTrigger><SelectValue placeholder={moveTargets.length ? "Choose a vacant bed…" : "No vacant beds available"} /></SelectTrigger>
              <SelectContent>
                {moveTargets.map((b) => <SelectItem key={b.id} value={b.id}>{b.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setMode("menu")}>Back</Button>
              <Button disabled={!chosen} onClick={() => { if (chosen) { onMove(occ, chosen.id, chosen.propertyId); close(); } }}>Move</Button>
            </div>
          </div>
        )}
        {mode === "replace" && (
          <div className="space-y-2 pt-1">
            <p className="text-sm text-muted-foreground">Replace {titleCaseName(occ.name)} in this bed with someone from the active roster.</p>
            <RosterPicker people={rosterPeople} onPick={(p) => { onReplace(bed, occ, p); close(); }} />
            <div className="flex justify-end">
              <Button variant="ghost" onClick={() => setMode("menu")}>Back</Button>
            </div>
          </div>
        )}
        {mode === "match" && (
          <div className="space-y-2 pt-1">
            <p className="text-sm text-muted-foreground">
              Link {titleCaseName(occ.name)} to a Zenople roster person so their payroll deduction
              ties to the right employee. Their name is updated to match Zenople.
            </p>
            <RosterPicker people={rosterPeople} onPick={(p) => { onMatch(occ, p); close(); }} />
            <div className="flex justify-end">
              <Button variant="ghost" onClick={() => setMode("menu")}>Back</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
