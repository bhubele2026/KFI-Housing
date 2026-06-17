import { useMemo } from "react";
import { Link, useParams } from "wouter";
import { MainLayout } from "@/components/layout/main-layout";
import { useData } from "@/context/data-store";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, BedDouble, Plus, X } from "lucide-react";
import { AssignOccupantDialog } from "@/components/assign-occupant-dialog";
import { shortPropertyName } from "@/lib/property-name";
import type { Bed, Occupant } from "@/data/mockData";

/**
 * Customer-scoped BED GRID — the "who's in which bed" drill-down off a
 * customer file. Laid out like the operator's spreadsheet: grouped by
 * property, ONE ROW PER ROOM, with each bed as a column (Bed 1, Bed 2,
 * …) and the occupant in the cell. Occupied / available counts sit on
 * the right. Every cell is editable in place — click a vacant bed to
 * assign, an occupant to edit, or ✕ to move them out — so it's fast to
 * scan and change without leaving the page.
 */

// Cap the number of Bed columns so a high-capacity room can't blow the
// width out (overflow beds wrap into the last cell). Real rooms are 1–2
// beds, so this rarely bites.
const MAX_BED_COLS = 6;

export default function CustomerBeds() {
  const { id } = useParams<{ id: string }>();
  const { customers, properties, rooms, beds, occupants, addOccupant, addBed, addRoom, updateBed, updateOccupant, isLoading } =
    useData();

  const customer = customers.find((c) => c.id === id);

  // Add one vacant bed to an existing room (manual inventory growth).
  const handleAddBed = (propertyId: string, roomId: string, existingBeds: Bed[]) => {
    const nextNum = existingBeds.reduce((m, b) => Math.max(m, b.bedNumber), 0) + 1;
    addBed({
      id: `bed-${Date.now()}`,
      propertyId,
      bedNumber: nextNum,
      roomId,
      status: "Vacant",
      occupantId: null,
    });
  };

  // Add a brand-new unit/room (with one vacant bed) to a property. The
  // operator renames it on the property page. This is the manual path;
  // lease ingestion can create units the same way server-side later.
  const handleAddUnit = (propertyId: string, unitCount: number) => {
    const roomId = `room-${Date.now()}`;
    addRoom({
      id: roomId,
      propertyId,
      buildingId: "",
      name: `New Unit ${unitCount + 1}`,
      sqft: 0,
      bathrooms: 0,
      monthlyRent: 0,
    });
    addBed({
      id: `bed-${Date.now() + 1}`,
      propertyId,
      bedNumber: 1,
      roomId,
      status: "Vacant",
      occupantId: null,
    });
  };

  const occupantByBedId = useMemo(() => {
    const m = new Map<string, Occupant>();
    for (const o of occupants) {
      if (o.status === "Active" && o.bedId) m.set(o.bedId, o);
    }
    return m;
  }, [occupants]);

  // Properties for this customer (primary or shared), with their rooms
  // and beds grouped for the grid.
  const propertyBlocks = useMemo(() => {
    const scoped = properties.filter(
      (p) => p.customerId === id || (p.sharedWithCustomerIds ?? []).includes(id),
    );
    const bedsByRoom = new Map<string, Bed[]>();
    for (const b of beds) {
      const arr = bedsByRoom.get(b.roomId) ?? [];
      arr.push(b);
      bedsByRoom.set(b.roomId, arr);
    }
    const roomName = new Map<string, string>();
    for (const r of rooms) roomName.set(r.id, r.name);

    return scoped
      .map((p) => {
        const propBeds = beds.filter((b) => b.propertyId === p.id);
        // Group this property's beds by room.
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
      // Show properties that actually have beds first; keep empties last
      // so the operator sees real inventory without scrolling past blanks.
      .sort((a, b) => Number(b.total > 0) - Number(a.total > 0) || a.property.name.localeCompare(b.property.name));
  }, [properties, rooms, beds, id, occupantByBedId]);

  const handleVacate = (bed: Bed, occ: Occupant) => {
    updateBed(bed.id, { status: "Vacant", occupantId: null });
    updateOccupant(occ.id, { status: "Former", bedId: null });
  };

  const renderBedCell = (bed: Bed | undefined) => {
    if (!bed) return <td className="px-3 py-2 border-l border-border/40" />;
    const occ = occupantByBedId.get(bed.id);
    if (occ) {
      return (
        <td className="px-3 py-2 border-l border-border/40 align-middle">
          <div className="group flex items-center justify-between gap-1">
            {/* Plain, selectable name — NOT an edit trigger. */}
            <span className="text-sm font-medium truncate" title={occ.name}>
              {occ.name}
            </span>
            {/* Move-out reveals on hover so the cell stays clean. */}
            <button
              type="button"
              onClick={() => handleVacate(bed, occ)}
              title="Move out"
              className="shrink-0 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </td>
      );
    }
    // Vacant. A bed mid-turnover (needs_cleaning / in_progress) isn't
    // assignable yet — show its state instead of an Assign affordance.
    const ready = bed.cleaningStatus === "ready";
    return (
      <td className="px-3 py-2 border-l border-border/40 align-middle">
        {ready ? (
          <AssignOccupantDialog
            bed={{ id: bed.id, propertyId: bed.propertyId }}
            onAssign={(occupant, b) => {
              addOccupant(occupant);
              updateBed(b.id, { status: "Occupied", occupantId: occupant.id });
            }}
            trigger={
              <button
                type="button"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
                title="Assign occupant"
              >
                <Plus className="h-3 w-3" /> Assign
              </button>
            }
          />
        ) : (
          <span className="text-xs text-amber-600">🧹 cleaning</span>
        )}
      </td>
    );
  };

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
                {/* Property header — the whole title block opens the property */}
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
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1 h-7"
                      onClick={() => handleAddUnit(property.id, roomRows.length)}
                      title="Add a new unit / room with a bed"
                    >
                      <Plus className="h-3.5 w-3.5" /> Add unit
                    </Button>
                  </div>
                </div>

                {total === 0 ? (
                  <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-muted-foreground">
                    <span>No beds set up yet for this property.</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1 h-7 shrink-0"
                      onClick={() => handleAddUnit(property.id, roomRows.length)}
                    >
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
                            <th key={i} className="px-3 py-2.5 text-left font-medium border-l border-border/40">
                              Bed {i + 1}
                            </th>
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
                                  <button
                                    type="button"
                                    onClick={() => handleAddBed(property.id, room.roomId, room.beds)}
                                    title="Add a bed to this unit"
                                    className="opacity-0 group-hover/r:opacity-100 focus:opacity-100 transition-opacity inline-flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-primary shrink-0"
                                  >
                                    <Plus className="h-3 w-3" /> bed
                                  </button>
                                </div>
                              </td>
                              <td className="px-2 py-2.5 text-center text-muted-foreground">{cap}</td>
                              {bedCols.map((i) => {
                                // Last visible column absorbs any overflow beds
                                // (rooms with more beds than columns are rare).
                                if (i === colCount - 1 && room.beds.length > colCount) {
                                  return (
                                    <td key={i} className="px-2 py-1.5 border-l border-border/40">
                                      <div className="space-y-1">
                                        {room.beds.slice(colCount - 1).map((b) => (
                                          <BedInline
                                            key={b.id}
                                            bed={b}
                                            occ={occupantByBedId.get(b.id)}
                                            onAssign={(occupant, bb) => {
                                              addOccupant(occupant);
                                              updateBed(bb.id, { status: "Occupied", occupantId: occupant.id });
                                            }}
                                            onVacate={handleVacate}
                                          />
                                        ))}
                                      </div>
                                    </td>
                                  );
                                }
                                return <BedTd key={i} render={() => renderBedCell(room.beds[i])} />;
                              })}
                              <td
                                className={
                                  "px-2 py-2.5 text-center font-medium border-l border-border/40 " +
                                  (open > 0 ? "text-amber-600" : "text-muted-foreground")
                                }
                              >
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

// Small wrapper so renderBedCell (which returns a <td>) can be used in the map.
function BedTd({ render }: { render: () => React.ReactNode }) {
  return <>{render()}</>;
}

// Inline (non-<td>) bed control used inside the overflow cell.
function BedInline({
  bed,
  occ,
  onAssign,
  onVacate,
}: {
  bed: Bed;
  occ: Occupant | undefined;
  onAssign: (o: Occupant, b: { id: string; propertyId: string }) => void;
  onVacate: (bed: Bed, occ: Occupant) => void;
}) {
  if (occ) {
    return (
      <div className="group flex items-center justify-between gap-1">
        <span className="text-sm font-medium truncate" title={occ.name}>
          {occ.name}
        </span>
        <button
          type="button"
          onClick={() => onVacate(bed, occ)}
          title="Move out"
          className="shrink-0 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }
  const ready = bed.cleaningStatus === "ready";
  return ready ? (
    <AssignOccupantDialog
      bed={{ id: bed.id, propertyId: bed.propertyId }}
      onAssign={onAssign}
      trigger={
        <button type="button" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary">
          <Plus className="h-3 w-3" /> Assign
        </button>
      }
    />
  ) : (
    <span className="text-xs text-amber-600">🧹 cleaning</span>
  );
}
