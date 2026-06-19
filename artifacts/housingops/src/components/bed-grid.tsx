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
  Pencil,
  Sparkles,
} from "lucide-react";
import { shortPropertyName } from "@/lib/property-name";
import { titleCaseName } from "@/lib/name-format";
import {
  STANDARD_SHIFTS,
  toWeeklyCharge,
  toMonthlyCharge,
  formatUsdWhole,
} from "@/data/mockData";
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

type RosterPerson = {
  personId: string;
  name: string;
  company: string;
  aliases: string[];
  weeklyDeduction: number;
  jobTitle: string;
};
type VacantBed = { id: string; propertyId: string; label: string };

// Strip crew/role tags that get appended to imported names ("Jonathan P
// Wheeler - T5", "Felix Arroyo - KFI Sup.", "Bucky Lee Gonzalez -T4") so the
// fuzzy matcher compares the real name. Hyphenated surnames (Smith-Jones)
// are left intact — only short trailing codes / known role words are cut.
function stripNameTag(s: string): string {
  return s
    .replace(/\s*-\s*(t\d+|p\d+|c\d+)\.?$/i, "")
    .replace(/\s*-\s*kfi\b.*$/i, "")
    .replace(/\s*-\s*(sup|supv|lead|driver|temp|crew)\.?$/i, "")
    .trim();
}

// Name-similarity (Dice over char bigrams + last-name boost) used to
// SUGGEST the roster person a needs-match occupant most likely is, so one
// click stamps their Zenople ID. Scores against the person's name AND every
// known alias.
function nbigrams(s: string): string[] {
  const t = s.trim().toLowerCase().replace(/[^a-z0-9 ]/g, "");
  const g: string[] = [];
  for (let i = 0; i < t.length - 1; i++) g.push(t.slice(i, i + 2));
  return g;
}
function diceScore(a: string, b: string): number {
  const A = nbigrams(a);
  const B = nbigrams(b);
  if (!A.length || !B.length) return 0;
  const m = new Map<string, number>();
  for (const x of A) m.set(x, (m.get(x) ?? 0) + 1);
  let o = 0;
  for (const x of B) { const c = m.get(x) ?? 0; if (c > 0) { o++; m.set(x, c - 1); } }
  return (2 * o) / (A.length + B.length);
}
function toks(s: string): string[] {
  return s.trim().toLowerCase().replace(/[^a-z ]/g, "").split(/\s+/).filter(Boolean);
}
function firstTok(s: string): string {
  return toks(s)[0] ?? "";
}
function lastTok(s: string): string {
  const p = toks(s);
  return p[p.length - 1] ?? "";
}
// Fuzzy similarity that weighs BOTH first and last name: a base Dice score
// over the full strings, plus boosts when the first names match and when the
// last names match (so "Ryan Fiegen" ↔ "Fiegen, Ryan J" still scores high).
function matchScore(a: string, b: string): number {
  const na = stripNameTag(a);
  const nb = stripNameTag(b);
  let s = diceScore(na, nb);
  if (lastTok(na) && lastTok(na) === lastTok(nb)) s = Math.min(1, s + 0.18);
  if (firstTok(na) && firstTok(na) === firstTok(nb)) s = Math.min(1, s + 0.12);
  return s;
}
function bestRosterMatch(name: string, people: RosterPerson[]): { person: RosterPerson; score: number } | null {
  let best: { person: RosterPerson; score: number } | null = null;
  for (const p of people) {
    const score = Math.max(matchScore(name, p.name), ...(p.aliases ?? []).map((a) => matchScore(name, a)));
    if (!best || score > best.score) best = { person: p, score };
  }
  return best;
}

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
    addOccupant, addBed, addRoom, updateRoom, updateBed, updateOccupant, deleteBed, deleteRoom,
  } = useData();

  const rosterPeople: RosterPerson[] = (useListActiveRoster().data?.people ?? []).map((p) => ({
    personId: p.personId,
    name: p.name,
    company: p.company,
    // Cast-safe: the generated client may not carry `aliases` until codegen
    // re-runs on deploy; reading it defensively keeps `pnpm build` typecheck
    // green either way.
    aliases: (p as { aliases?: string[] }).aliases ?? [],
    weeklyDeduction: p.weeklyDeduction ?? 0,
    jobTitle: p.jobTitle ?? "",
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
    // Bring in the Zenople housing deduction + role when the matched roster
    // person carries one, so assigning/matching populates the charge.
    chargePerBed: person.weeklyDeduction > 0 ? person.weeklyDeduction : 0,
    billingFrequency: person.weeklyDeduction > 0 ? "Weekly" : "Monthly",
    email: "",
    phone: "",
    chargeSource: person.weeklyDeduction > 0 ? "payroll" : "",
    chargeSourceCustomer: "",
    chargeSourcePersonId: person.weeklyDeduction > 0 ? person.personId : "",
    shift: null,
    language: null,
    gender: null,
    title: (person.jobTitle || null) as Occupant["title"],
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
      // Matching also brings in the Zenople deduction + role (employee
      // details) when the roster person has them.
      ...(person.weeklyDeduction > 0
        ? {
            chargePerBed: person.weeklyDeduction,
            billingFrequency: "Weekly" as const,
            chargeSource: "payroll",
            chargeSourcePersonId: person.personId,
          }
        : {}),
      ...(person.jobTitle ? { title: person.jobTitle as Occupant["title"] } : {}),
    });

  const handleAddBed = (roomId: string, existingBeds: Bed[]) => {
    const nextNum = existingBeds.reduce((m, b) => Math.max(m, b.bedNumber), 0) + 1;
    addBed({ id: `bed-${Date.now()}`, propertyId: property.id, bedNumber: nextNum, roomId, status: "Vacant", occupantId: null });
  };
  const handleAddUnit = (name: string, bedCount: number) => {
    const roomId = `room-${Date.now()}`;
    addRoom({ id: roomId, propertyId: property.id, buildingId: "", name: name.trim() || "New Unit", sqft: 0, bathrooms: 0, monthlyRent: 0 });
    for (let i = 0; i < Math.max(1, bedCount); i++) {
      addBed({ id: `bed-${Date.now() + 1 + i}`, propertyId: property.id, bedNumber: i + 1, roomId, status: "Vacant", occupantId: null });
    }
  };
  const handleRemoveUnit = async (roomId: string, roomBeds: Bed[]) => {
    for (const b of roomBeds) deleteBed(b.id);
    try {
      await deleteRoom(roomId);
    } catch {
      /* data-store surfaces a toast; beds are already gone */
    }
  };

  const handleUpdate = (o: Occupant, patch: Partial<Occupant>) => updateOccupant(o.id, patch);
  const cellProps = { rosterPeople, rosterIds, vacantBeds, onAssign: handleAssign, onMove: handleMove, onRemove: handleRemove, onReplace: handleReplace, onSetCleaning: handleSetCleaning, onMatch: handleMatch, onUpdate: handleUpdate };
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
          <AddUnitDialog count={roomRows.length} onCreate={handleAddUnit} />
        </div>
      </div>

      {total === 0 ? (
        <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-muted-foreground">
          <span>No beds set up yet for this property.</span>
          <AddUnitDialog count={roomRows.length} onCreate={handleAddUnit} />
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
                        <RenameUnitName name={room.name} onRename={(v) => updateRoom(room.roomId, { name: v })} />
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

const SHIFT_NONE = "__none";

/**
 * Clean, grid-style occupant detail for one property — the same flat look
 * as the bed grid, one row per housed person, showing the info the old
 * per-room table carried (minus Company): Zenople ID + match status, shift
 * (editable), move-in, projected move-out (editable — ties the bed back to
 * the move-out plan), and the weekly/monthly charge.
 */
export function PropertyOccupantDetail({ property }: { property: Property }) {
  const { rooms, beds, occupants, updateOccupant } = useData();
  const rosterIds = new Set((useListActiveRoster().data?.people ?? []).map((p) => p.personId));

  const roomName = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rooms) m.set(r.id, r.name);
    return m;
  }, [rooms]);
  const bedById = useMemo(() => {
    const m = new Map<string, Bed>();
    for (const b of beds) m.set(b.id, b);
    return m;
  }, [beds]);

  const rows = useMemo(() => {
    return occupants
      .filter((o) => o.status === "Active" && o.propertyId === property.id && o.bedId)
      .map((o) => {
        const bed = o.bedId ? bedById.get(o.bedId) : undefined;
        return {
          occ: o,
          room: bed ? roomName.get(bed.roomId) ?? "—" : "—",
          bedNum: bed?.bedNumber ?? 0,
        };
      })
      .sort(
        (a, b) =>
          a.room.localeCompare(b.room, undefined, { numeric: true }) || a.bedNum - b.bedNum,
      );
  }, [occupants, property.id, bedById, roomName]);

  if (rows.length === 0) return null;

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 bg-muted/60 px-4 py-3 border-b">
        <span className="font-semibold text-sm">Occupant detail</span>
        <span className="text-xs text-muted-foreground">{rows.length} housed · move-in / move-out / charge</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/30">
              <th className="px-3 py-2.5 text-left font-medium">Room · Bed</th>
              <th className="px-3 py-2.5 text-left font-medium">Occupant</th>
              <th className="px-3 py-2.5 text-left font-medium">Shift</th>
              <th className="px-3 py-2.5 text-left font-medium">Move-in</th>
              <th className="px-3 py-2.5 text-left font-medium">Move-out (proj.)</th>
              <th className="px-3 py-2.5 text-right font-medium">Charge</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ occ, room, bedNum }) => {
              const matched = !!occ.employeeId && rosterIds.has(occ.employeeId);
              const freq = occ.billingFrequency ?? "Monthly";
              const wk = occ.chargePerBed > 0 ? toWeeklyCharge(occ.chargePerBed, freq) : 0;
              const mo = occ.chargePerBed > 0 ? toMonthlyCharge(occ.chargePerBed, freq) : 0;
              return (
                <tr key={occ.id} className="border-t hover:bg-muted/20">
                  <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">{room} · Bed {bedNum}</td>
                  <td className="px-3 py-2.5">
                    <div className="font-medium">{titleCaseName(occ.name)}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-[11px]">
                      {occ.employeeId ? <span className="text-muted-foreground">ID {occ.employeeId}</span> : null}
                      {matched ? (
                        <span className="text-emerald-600">✓ matched</span>
                      ) : (
                        <span className="text-amber-600">⚠ needs match</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <Select
                      value={occ.shift ?? SHIFT_NONE}
                      onValueChange={(v) => updateOccupant(occ.id, { shift: v === SHIFT_NONE ? null : v })}
                    >
                      <SelectTrigger className="h-7 w-28 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={SHIFT_NONE}>—</SelectItem>
                        {STANDARD_SHIFTS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">{occ.moveInDate || "—"}</td>
                  <td className="px-3 py-2.5">
                    <Input
                      type="date"
                      value={occ.moveOutDate ?? ""}
                      onChange={(e) => updateOccupant(occ.id, { moveOutDate: e.target.value || null })}
                      className="h-7 w-36 text-xs"
                    />
                  </td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap">
                    {wk > 0 ? (
                      <>
                        <span className="font-medium">{formatUsdWhole(wk)}/wk</span>
                        <span className="block text-[11px] text-muted-foreground">{formatUsdWhole(mo)}/mo</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
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
  onUpdate: (occ: Occupant, patch: Partial<Occupant>) => void;
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

// Add a unit/room with a name + a chosen number of beds in one step,
// instead of dropping a generically-named "New Unit" with a single bed.
function AddUnitDialog({ count, onCreate }: { count: number; onCreate: (name: string, beds: number) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [beds, setBeds] = useState("2");
  const reset = () => { setName(""); setBeds("2"); };
  const create = () => {
    const n = Math.min(12, Math.max(1, parseInt(beds, 10) || 1));
    onCreate(name.trim() || `Unit ${count + 1}`, n);
    setOpen(false);
    reset();
  };
  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="gap-1 h-7 shrink-0">
          <Plus className="h-3.5 w-3.5" /> Add unit
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Add a unit</DialogTitle></DialogHeader>
        <div className="space-y-3 pt-1">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Unit / room name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={`e.g. Room ${count + 1}, Apt 2B`} autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") create(); }} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Number of beds</label>
            <Input type="number" min={1} max={12} value={beds} onChange={(e) => setBeds(e.target.value)} className="w-24"
              onKeyDown={(e) => { if (e.key === "Enter") create(); }} />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => { setOpen(false); reset(); }}>Cancel</Button>
            <Button onClick={create}>Add unit</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Inline rename for a unit/room name — a hover pencil flips to an input so
// the generic "New Unit" label is easy to correct without a trap-click.
function RenameUnitName({ name, onRename }: { name: string; onRename: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(name);
  if (editing) {
    const save = () => { const v = val.trim(); if (v && v !== name) onRename(v); setEditing(false); };
    return (
      <Input
        autoFocus
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") { setVal(name); setEditing(false); } }}
        className="h-7 w-40 text-sm font-medium"
      />
    );
  }
  return (
    <span className="flex items-center gap-1 min-w-0">
      <span className="font-medium truncate">{name}</span>
      <button type="button" onClick={() => { setVal(name); setEditing(true); }} title="Rename unit"
        className="opacity-0 group-hover/r:opacity-100 focus:opacity-100 transition-opacity text-muted-foreground hover:text-primary shrink-0">
        <Pencil className="h-3 w-3" />
      </button>
    </span>
  );
}

function RosterPicker({ people, onPick }: { people: RosterPerson[]; onPick: (p: RosterPerson) => void }) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const filtered = needle
    ? people.filter((p) =>
        `${p.name} ${(p.aliases ?? []).join(" ")} ${p.company} ${p.personId}`
          .toLowerCase()
          .includes(needle),
      )
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

function ManageOccupantDialog({ bed, occ, rosterPeople, rosterIds, vacantBeds, onMove, onRemove, onReplace, onMatch, onUpdate }: { bed: Bed; occ: Occupant } & CellHandlers) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"menu" | "move" | "replace" | "match">("menu");
  const [moveBedId, setMoveBedId] = useState("");
  const reset = () => { setMode("menu"); setMoveBedId(""); };
  const close = () => { setOpen(false); reset(); };
  const moveTargets = vacantBeds.filter((b) => b.id !== bed.id);
  const chosen = moveTargets.find((b) => b.id === moveBedId);
  const payrollDeduction = occ.chargeSource === "payroll" && occ.chargePerBed > 0 ? occ.chargePerBed : 0;
  const freq = occ.billingFrequency ?? "Monthly";
  const wk = occ.chargePerBed > 0 ? toWeeklyCharge(occ.chargePerBed, freq) : 0;
  const mo = occ.chargePerBed > 0 ? toMonthlyCharge(occ.chargePerBed, freq) : 0;
  const matched = !!occ.employeeId && rosterIds.has(occ.employeeId);
  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <button type="button" className="block w-full text-left group/cell" title={`Manage ${titleCaseName(occ.name)}`}>
          <span className="block text-sm font-medium truncate group-hover/cell:text-primary group-hover/cell:underline">
            {titleCaseName(occ.name)}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] leading-tight">
            {occ.employeeId && <span className="text-muted-foreground">ID {occ.employeeId}</span>}
            {matched ? (
              <span className="text-emerald-600">✓ matched</span>
            ) : (
              <span className="text-amber-600">⚠ needs match</span>
            )}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] leading-tight text-muted-foreground">
            {payrollDeduction > 0 && <span>${Math.round(payrollDeduction)}/wk</span>}
            {occ.shift && <span>· {occ.shift}</span>}
            {occ.moveOutDate && <span>· out {occ.moveOutDate}</span>}
          </span>
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{titleCaseName(occ.name)}</DialogTitle></DialogHeader>
        {mode === "menu" && (
          <div className="space-y-3 pt-1">
            {/* One-click suggested match by Zenople ID — links the best
                roster person (by name + aliases) so matching is by ID. */}
            {!matched && (() => {
              const sug = bestRosterMatch(occ.name, rosterPeople);
              if (!sug || sug.score < 0.55) return null;
              return (
                <button
                  type="button"
                  onClick={() => { onMatch(occ, sug.person); close(); }}
                  className="w-full rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-left hover:bg-primary/10"
                  data-testid="suggested-match"
                >
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    <Sparkles className="h-3.5 w-3.5 text-primary" /> Suggested match — link by Zenople ID
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {titleCaseName(sug.person.name)} · ID {sug.person.personId}
                    {sug.person.company ? ` · ${sug.person.company}` : ""} · {Math.round(sug.score * 100)}% name match
                  </div>
                </button>
              );
            })()}
            {/* Detail — editable shift + projected move-out, read-only ID,
                move-in, and charge — so the bed section carries the full
                picture without a separate table. */}
            <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Zenople ID</span>
                <span className="font-medium">{occ.employeeId || "—"} {matched ? <span className="text-emerald-600 text-xs">✓ matched</span> : <span className="text-amber-600 text-xs">⚠ needs match</span>}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Shift</span>
                <Select value={occ.shift ?? SHIFT_NONE} onValueChange={(v) => onUpdate(occ, { shift: v === SHIFT_NONE ? null : v })}>
                  <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SHIFT_NONE}>—</SelectItem>
                    {STANDARD_SHIFTS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Move-in</span>
                <span className="font-medium">{occ.moveInDate || "—"}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Move-out (proj.)</span>
                <Input type="date" value={occ.moveOutDate ?? ""} onChange={(e) => onUpdate(occ, { moveOutDate: e.target.value || null })} className="h-8 w-36" />
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Charge</span>
                <span className="font-medium">{wk > 0 ? `${formatUsdWhole(wk)}/wk · ${formatUsdWhole(mo)}/mo` : "—"}</span>
              </div>
            </div>
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
