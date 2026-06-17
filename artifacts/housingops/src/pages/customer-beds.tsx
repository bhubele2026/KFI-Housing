import { useMemo, useState } from "react";
import { Link, useParams } from "wouter";
import { useListActiveRoster } from "@workspace/api-client-react";
import { MainLayout } from "@/components/layout/main-layout";
import { useData } from "@/context/data-store";
import { Card, CardContent } from "@/components/ui/card";
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
  ChevronLeft,
  ChevronRight,
  BedDouble,
  Plus,
  Search,
  ArrowLeftRight,
  LogOut,
  UserPlus,
  Trash2,
} from "lucide-react";
import { shortPropertyName } from "@/lib/property-name";
import { titleCaseName } from "@/lib/name-format";
import { ProjectedMoveInsSection } from "@/components/projected-move-ins-section";
import type { Bed, Occupant } from "@/data/mockData";

/**
 * Customer-scoped BED GRID — the "who's in which bed" drill-down off a
 * customer file. Grouped by property, ONE ROW PER ROOM, beds as columns.
 * Click a person's NAME for an actions menu (Move / Remove / Replace);
 * assign a vacant bed from the ACTIVE ROSTER (most recent payroll week).
 * The name is never an inline rename — it only opens the menu.
 */

const MAX_BED_COLS = 6;
const today = () => new Date().toISOString().split("T")[0];

type RosterPerson = { personId: string; name: string; company: string };
type VacantBed = { id: string; propertyId: string; label: string };

export default function CustomerBeds() {
  const { id } = useParams<{ id: string }>();
  const {
    customers, properties, rooms, beds, occupants,
    addOccupant, addBed, addRoom, updateBed, updateOccupant, deleteBed, deleteRoom, isLoading,
  } = useData();
  const rosterPeople: RosterPerson[] = (useListActiveRoster().data?.people ?? []).map((p) => ({
    personId: p.personId,
    name: p.name,
    company: p.company,
  }));
  // Active-roster person ids — an occupant is "matched to Zenople" when its
  // employeeId (== personId) appears here.
  const rosterIds = new Set(rosterPeople.map((p) => p.personId));

  const customer = customers.find((c) => c.id === id);

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

  // Customer-scoped data for the Move-ins & Move-outs section (spans all
  // of this customer's properties). Read-only here — move-in pre-staging
  // is managed per property; the value in the bed area is seeing upcoming
  // move-OUTS so beds can be planned.
  const scopedForMoves = useMemo(() => {
    const scopedIds = new Set(
      properties
        .filter((p) => p.customerId === id || (p.sharedWithCustomerIds ?? []).includes(id))
        .map((p) => p.id),
    );
    const propertyNameById: Record<string, string> = {};
    for (const p of properties) {
      if (scopedIds.has(p.id)) propertyNameById[p.id] = shortPropertyName(p.name);
    }
    return {
      propRooms: rooms.filter((r) => scopedIds.has(r.propertyId)),
      propBeds: beds.filter((b) => scopedIds.has(b.propertyId)),
      propOccupants: occupants.filter((o) => o.propertyId && scopedIds.has(o.propertyId)),
      propertyNameById,
    };
  }, [properties, rooms, beds, occupants, id]);

  // Which property the move-in/out scheduler is pointed at. "" = the
  // read-only customer-wide overview; pick a property to actually schedule
  // (the per-property add form is enabled then).
  const [moveProp, setMoveProp] = useState<string>("");
  const scopedProperties = useMemo(
    () =>
      properties.filter(
        (p) => p.customerId === id || (p.sharedWithCustomerIds ?? []).includes(id),
      ),
    [properties, id],
  );
  const moveScope = useMemo(() => {
    if (!moveProp) return null;
    return {
      propRooms: rooms.filter((r) => r.propertyId === moveProp),
      propBeds: beds.filter((b) => b.propertyId === moveProp),
      propOccupants: occupants.filter((o) => o.propertyId === moveProp),
    };
  }, [moveProp, rooms, beds, occupants]);

  const occupantByBedId = useMemo(() => {
    const m = new Map<string, Occupant>();
    for (const o of occupants) {
      if (o.status === "Active" && o.bedId) m.set(o.bedId, o);
    }
    return m;
  }, [occupants]);

  // Vacant, ready beds available as move targets.
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

  const propertyBlocks = useMemo(() => {
    const scoped = properties.filter(
      (p) => p.customerId === id || (p.sharedWithCustomerIds ?? []).includes(id),
    );
    return scoped
      .map((p) => {
        const propBeds = beds.filter((b) => b.propertyId === p.id);
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
        return { property: p, roomRows, colCount, total, occupied };
      })
      .sort((a, b) => Number(b.total > 0) - Number(a.total > 0) || a.property.name.localeCompare(b.property.name));
  }, [properties, beds, id, roomName, occupantByBedId]);

  // ── Bed mutations ──────────────────────────────────────────────────
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
    // Free the bed (a replace is a correction, not a turnover, so force it
    // back to "ready" so the new occupant isn't blocked by the cleaning
    // gate), then place the replacement.
    updateOccupant(current.id, { status: "Former", bedId: null });
    updateBed(bed.id, { status: "Vacant", occupantId: null, cleaningStatus: "ready" });
    const occ = makeOccupant(person, bed);
    addOccupant(occ);
    updateBed(bed.id, { status: "Occupied", occupantId: occ.id });
  };

  const handleAddBed = (propertyId: string, roomId: string, existingBeds: Bed[]) => {
    const nextNum = existingBeds.reduce((m, b) => Math.max(m, b.bedNumber), 0) + 1;
    addBed({ id: `bed-${Date.now()}`, propertyId, bedNumber: nextNum, roomId, status: "Vacant", occupantId: null });
  };
  const handleAddUnit = (propertyId: string, unitCount: number) => {
    const roomId = `room-${Date.now()}`;
    addRoom({ id: roomId, propertyId, buildingId: "", name: `New Unit ${unitCount + 1}`, sqft: 0, bathrooms: 0, monthlyRent: 0 });
    addBed({ id: `bed-${Date.now() + 1}`, propertyId, bedNumber: 1, roomId, status: "Vacant", occupantId: null });
  };
  // Remove a unit/room and its beds. Only allowed when none are occupied
  // (the row's trash control is disabled otherwise) so we never orphan an
  // occupant.
  const handleRemoveUnit = (roomId: string, roomBeds: Bed[]) => {
    for (const b of roomBeds) deleteBed(b.id);
    deleteRoom(roomId);
  };
  // Flag a vacant bed's housekeeping state (needs cleaning ↔ ready).
  const handleSetCleaning = (bed: Bed, status: "ready" | "needs_cleaning") =>
    updateBed(bed.id, { cleaningStatus: status });
  // Link an occupant to a Zenople roster person so their payroll deduction
  // matches. The roster name is authoritative (fixes "last name TBD" etc.).
  const handleMatch = (occ: Occupant, person: RosterPerson) =>
    updateOccupant(occ.id, {
      employeeId: person.personId,
      name: person.name,
      company: person.company || occ.company,
    });

  const cellProps = { rosterPeople, rosterIds, vacantBeds, onAssign: handleAssign, onMove: handleMove, onRemove: handleRemove, onReplace: handleReplace, onSetCleaning: handleSetCleaning, onMatch: handleMatch };

  return (
    <MainLayout>
      <div className="p-6 max-w-[1400px] mx-auto space-y-5">
        <div className="flex items-center gap-3">
          <Link href={`/customers/${encodeURIComponent(id)}`}>
            <Button variant="ghost" size="sm" className="gap-1.5">
              <ChevronLeft className="h-4 w-4" />
              {customer ? customer.name : "Customer"}
            </Button>
          </Link>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <BedDouble className="h-5 w-5 text-muted-foreground" />
            Beds
          </h1>
        </div>

        {/* Upcoming arrivals & departures. Pick a property to schedule a
            move-in / move-out there; leave on "All" for the read-only
            customer-wide overview. */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="text-xs text-muted-foreground">Schedule move-ins / move-outs for</span>
            <Select value={moveProp || "__all"} onValueChange={(v) => setMoveProp(v === "__all" ? "" : v)}>
              <SelectTrigger className="h-8 w-60" data-testid="select-move-property">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value="__all">All properties (overview)</SelectItem>
                {scopedProperties.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{shortPropertyName(p.name)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {moveProp && moveScope ? (
            <ProjectedMoveInsSection
              propertyId={moveProp}
              propRooms={moveScope.propRooms}
              propBeds={moveScope.propBeds}
              propOccupants={moveScope.propOccupants}
            />
          ) : (
            <ProjectedMoveInsSection
              propertyId=""
              propRooms={scopedForMoves.propRooms}
              propBeds={scopedForMoves.propBeds}
              propOccupants={scopedForMoves.propOccupants}
              propertyNameById={scopedForMoves.propertyNameById}
              readOnly
              defaultView="out"
            />
          )}
        </div>

        {isLoading ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">Loading beds…</CardContent>
          </Card>
        ) : propertyBlocks.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              No properties for this customer yet.
            </CardContent>
          </Card>
        ) : (
          propertyBlocks.map(({ property, roomRows, colCount, total, occupied }) => {
            const bedCols = Array.from({ length: colCount }, (_, i) => i);
            return (
              <Card key={property.id} className="overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-3 bg-muted/60 px-4 py-3 border-b">
                  <Link href={`/properties/${property.id}`} className="group min-w-0 flex items-baseline gap-2">
                    <span className="font-semibold group-hover:text-primary group-hover:underline truncate">
                      {shortPropertyName(property.name)}
                    </span>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary shrink-0 self-center" />
                    <span className="text-xs text-muted-foreground truncate">
                      {[property.address, property.city, property.state].filter(Boolean).join(", ")}
                    </span>
                  </Link>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant={occupied < total ? "secondary" : "default"}>
                      {occupied}/{total} beds filled
                    </Badge>
                    <Button type="button" variant="outline" size="sm" className="gap-1 h-7"
                      onClick={() => handleAddUnit(property.id, roomRows.length)} title="Add a new unit / room with a bed">
                      <Plus className="h-3.5 w-3.5" /> Add unit
                    </Button>
                  </div>
                </div>

                {total === 0 ? (
                  <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-muted-foreground">
                    <span>No beds set up yet for this property.</span>
                    <Button type="button" variant="outline" size="sm" className="gap-1 h-7 shrink-0"
                      onClick={() => handleAddUnit(property.id, roomRows.length)}>
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
                                  <button type="button" onClick={() => handleAddBed(property.id, room.roomId, room.beds)}
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
          })
        )}
      </div>
    </MainLayout>
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
  // Vacant + mid-turnover: show the cleaning state with a one-click "mark ready".
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
  // Vacant + ready: assign someone, or flag the bed as needing a clean.
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

// Searchable active-roster list (most recent active payroll week).
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

// Name → actions: Move / Replace / Remove. The name is a button, never an
// inline rename field.
function ManageOccupantDialog({ bed, occ, rosterPeople, rosterIds, vacantBeds, onMove, onRemove, onReplace, onMatch }: { bed: Bed; occ: Occupant } & CellHandlers) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"menu" | "move" | "replace" | "match">("menu");
  const [moveBedId, setMoveBedId] = useState("");
  const reset = () => { setMode("menu"); setMoveBedId(""); };
  const close = () => { setOpen(false); reset(); };
  const moveTargets = vacantBeds.filter((b) => b.id !== bed.id);
  const chosen = moveTargets.find((b) => b.id === moveBedId);
  // Real Zenople deduction only when the charge came from payroll.
  const payrollDeduction = occ.chargeSource === "payroll" && occ.chargePerBed > 0 ? occ.chargePerBed : 0;
  const matched = !!occ.employeeId && rosterIds.has(occ.employeeId);
  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <button type="button" className="block w-full text-left group/cell" title={`Manage ${occ.name}`}>
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
        <DialogHeader><DialogTitle>{occ.name}</DialogTitle></DialogHeader>
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
            <p className="text-sm text-muted-foreground">Move {occ.name} to a vacant, ready bed (their current bed is freed automatically).</p>
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
            <p className="text-sm text-muted-foreground">Replace {occ.name} in this bed with someone from the active roster.</p>
            <RosterPicker people={rosterPeople} onPick={(p) => { onReplace(bed, occ, p); close(); }} />
            <div className="flex justify-end">
              <Button variant="ghost" onClick={() => setMode("menu")}>Back</Button>
            </div>
          </div>
        )}
        {mode === "match" && (
          <div className="space-y-2 pt-1">
            <p className="text-sm text-muted-foreground">
              Link {occ.name} to a Zenople roster person so their payroll deduction
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
