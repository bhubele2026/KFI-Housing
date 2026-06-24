import { useMemo, useState } from "react";
import { Link, useParams } from "wouter";
import { MainLayout } from "@/components/layout/main-layout";
import { useData } from "@/context/data-store";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronLeft, BedDouble } from "lucide-react";
import { shortPropertyName } from "@/lib/property-name";
import { ProjectedMoveInsSection } from "@/components/projected-move-ins-section";
import { BedBoardV2 } from "@/components/bed-board/bed-board-v2";

/**
 * Customer-scoped CARD BED VIEW (Consolidated Fix §6) — the "who's in which
 * bed" drill-down off a customer file. Renders ALL of this client's
 * properties' rooms in the same v2 card board, one <BedBoardV2> per property
 * (its property-name header doubles as the per-property section header — the
 * identical board the property page uses). Above it, a move-in / move-out
 * scheduler scoped to whichever property you pick.
 */

export default function CustomerBeds() {
  const { id } = useParams<{ id: string }>();
  const { customers, properties, rooms, beds, occupants, isLoading } = useData();

  const customer = customers.find((c) => c.id === id);

  const scopedProperties = useMemo(
    () =>
      properties.filter(
        (p) => p.customerId === id || (p.sharedWithCustomerIds ?? []).includes(id),
      ),
    [properties, id],
  );

  // Order: properties that have beds set up first, then alphabetical.
  const orderedProperties = useMemo(() => {
    const bedCount = new Map<string, number>();
    for (const b of beds) bedCount.set(b.propertyId, (bedCount.get(b.propertyId) ?? 0) + 1);
    return [...scopedProperties].sort(
      (a, b) =>
        Number((bedCount.get(b.id) ?? 0) > 0) - Number((bedCount.get(a.id) ?? 0) > 0) ||
        a.name.localeCompare(b.name),
    );
  }, [scopedProperties, beds]);

  // Customer-wide data for the read-only move-out overview.
  const scopedForMoves = useMemo(() => {
    const scopedIds = new Set(scopedProperties.map((p) => p.id));
    const propertyNameById: Record<string, string> = {};
    for (const p of scopedProperties) propertyNameById[p.id] = shortPropertyName(p.name);
    return {
      propRooms: rooms.filter((r) => scopedIds.has(r.propertyId)),
      propBeds: beds.filter((b) => scopedIds.has(b.propertyId)),
      propOccupants: occupants.filter((o) => o.propertyId && scopedIds.has(o.propertyId)),
      propertyNameById,
    };
  }, [scopedProperties, rooms, beds, occupants]);

  // Which property the move-in/out scheduler is pointed at. "" = the
  // read-only customer-wide overview; pick a property to actually schedule.
  const [moveProp, setMoveProp] = useState<string>("");
  const moveScope = useMemo(() => {
    if (!moveProp) return null;
    return {
      propRooms: rooms.filter((r) => r.propertyId === moveProp),
      propBeds: beds.filter((b) => b.propertyId === moveProp),
      propOccupants: occupants.filter((o) => o.propertyId === moveProp),
    };
  }, [moveProp, rooms, beds, occupants]);

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
        ) : orderedProperties.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              No properties for this customer yet.
            </CardContent>
          </Card>
        ) : (
          orderedProperties.map((property) => (
            <section key={property.id} data-testid={`customer-bed-section-${property.id}`}>
              <BedBoardV2 property={property} />
            </section>
          ))
        )}
      </div>
    </MainLayout>
  );
}
