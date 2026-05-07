import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { ArrowRight, BedDouble, Trash2, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useData } from "@/context/data-store";
import { useToast } from "@/hooks/use-toast";
import type { Occupant, Property } from "@/data/mockData";
import { formatUsd } from "@/data/mockData";
import { shortPropertyName } from "@/lib/property-name";
import { isPendingPlacementProperty } from "@/lib/pending-placement";

export interface PendingPlacementBoardProps {
  property: Property;
}

/**
 * Focused board rendered in place of the normal property detail view when
 * the property is a synthetic "Roster — Pending Placement (<Customer>)"
 * bucket created by `seedPayrollOccupantsIfMissing` (Task #305).
 *
 * Each row is one payroll-only occupant (propertyId = this bucket,
 * bedId = null). The operator picks a real property + vacant bed and
 * clicks "Move to bed". On save:
 *   1. PATCH the EXISTING occupant with the new propertyId+bedId (and
 *      a moveInDate of today if it was still blank from the seed). We
 *      deliberately do NOT call addOccupant — that would create a
 *      duplicate row and orphan the pending one.
 *   2. PATCH the chosen bed to status="Occupied" with occupantId set.
 *
 * Once the last pending occupant is moved out, the bucket property is
 * automatically deleted and the operator is sent back to /properties.
 */
export function PendingPlacementBoard({ property }: PendingPlacementBoardProps) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const {
    properties,
    beds,
    occupants,
    customers,
    updateOccupant,
    updateBed,
    deleteProperty,
  } = useData();

  const pendingOccupants = useMemo(
    () =>
      occupants
        .filter((o) => o.propertyId === property.id && o.status === "Active")
        .sort((a, b) => a.name.localeCompare(b.name)),
    [occupants, property.id],
  );

  const propertiesWithVacancy = useMemo(() => {
    const vacantPropertyIds = new Set(
      beds
        .filter(
          (b) =>
            b.status === "Vacant" &&
            // Never offer the pending-placement buckets themselves as a
            // destination — they have no real beds anyway, but belt and
            // suspenders against future seeds adding placeholder beds.
            !isPendingPlacementProperty(
              properties.find((p) => p.id === b.propertyId)?.name,
            ),
        )
        .map((b) => b.propertyId),
    );
    return properties
      .filter((p) => vacantPropertyIds.has(p.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [properties, beds]);

  const customer = customers.find((c) => c.id === property.customerId);

  // Auto-clear if the bucket is already empty when the operator opens
  // it (e.g., it was emptied via another flow). We delete + redirect
  // instead of forcing them to click a manual "Delete this bucket"
  // button on a row-less screen.
  useEffect(() => {
    if (pendingOccupants.length === 0) {
      deleteProperty(property.id);
      toast({
        title: "Bucket cleared",
        description: `${property.name} was deleted because it had no pending people left.`,
      });
      navigate("/properties");
    }
    // We intentionally only depend on the count flipping to zero — not
    // on the toast/navigate identities — to avoid double-firing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingOccupants.length === 0]);

  const handleDeleteEmpty = () => {
    deleteProperty(property.id);
    toast({
      title: "Bucket cleared",
      description: `${property.name} was deleted because it had no pending people left.`,
    });
    navigate("/properties");
  };

  return (
    <div
      className="space-y-4"
      data-testid="pending-placement-board"
    >
      <Card className="border-amber-500/40 bg-amber-500/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <UserCheck className="h-4 w-4 text-amber-600" />
            Pending placement{customer ? ` — ${customer.name}` : ""}
          </CardTitle>
          <CardDescription>
            These people appear on the weekly housing-deduction roster but
            haven't been placed in a real bed yet. Pick a property + bed for
            each row and click <span className="font-medium">Move to bed</span>.
            This bucket auto-deletes once everyone is placed.
          </CardDescription>
        </CardHeader>
      </Card>

      {pendingOccupants.length === 0 ? (
        <Card data-testid="pending-placement-empty">
          <CardContent className="py-8 text-center space-y-3">
            <p className="text-sm text-muted-foreground">
              Everyone in this bucket has been placed.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDeleteEmpty}
              data-testid="button-delete-empty-pending"
            >
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              Delete this bucket
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <BedDouble className="h-4 w-4 text-muted-foreground" />
              {pendingOccupants.length} pending{" "}
              {pendingOccupants.length === 1 ? "person" : "people"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {pendingOccupants.map((occ) => (
              <PendingRow
                key={occ.id}
                occupant={occ}
                propertyOptions={propertiesWithVacancy}
                onMove={(destPropertyId, destBedId) => {
                  // Race guard: another row may have moved someone into
                  // this bed between this row's selection and click.
                  // Re-check the live `beds` snapshot before we commit
                  // anything so we never produce two occupants pointing
                  // at the same bed (or stomp the previous occupantId).
                  const destBed = beds.find((b) => b.id === destBedId);
                  if (!destBed || destBed.status !== "Vacant") {
                    toast({
                      title: "Bed no longer available",
                      description: `Someone else just moved into that bed. Pick another vacant bed for ${occ.name}.`,
                      variant: "destructive",
                    });
                    return;
                  }
                  // 1. Move the EXISTING occupant — never addOccupant here,
                  //    that would create a duplicate and orphan the pending
                  //    row.
                  updateOccupant(occ.id, {
                    propertyId: destPropertyId,
                    bedId: destBedId,
                    moveInDate:
                      occ.moveInDate && occ.moveInDate !== ""
                        ? occ.moveInDate
                        : new Date().toISOString().split("T")[0],
                  });
                  // 2. Mark the chosen bed Occupied with this occupant.
                  updateBed(destBedId, {
                    status: "Occupied",
                    occupantId: occ.id,
                  });
                  toast({
                    title: "Moved to bed",
                    description: `${occ.name} was placed in a real bed.`,
                  });
                  // 3. If that was the last one, auto-delete the bucket.
                  //    `pendingOccupants` is the pre-move list, so length===1
                  //    means we just moved the final person.
                  if (pendingOccupants.length === 1) {
                    deleteProperty(property.id);
                    toast({
                      title: "Bucket cleared",
                      description: `${property.name} was deleted because it's now empty.`,
                    });
                    navigate("/properties");
                  }
                }}
              />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

interface PendingRowProps {
  occupant: Occupant;
  propertyOptions: Property[];
  onMove: (propertyId: string, bedId: string) => void;
}

function PendingRow({ occupant, propertyOptions, onMove }: PendingRowProps) {
  const { beds } = useData();
  const [pickedPropertyId, setPickedPropertyId] = useState<string>("");
  const [pickedBedId, setPickedBedId] = useState<string>("");

  const vacantBedsForProperty = useMemo(() => {
    if (!pickedPropertyId) return [];
    return beds
      .filter((b) => b.propertyId === pickedPropertyId && b.status === "Vacant")
      .sort((a, b) => a.bedNumber - b.bedNumber);
  }, [beds, pickedPropertyId]);

  // Guard against the "two rows pick the same bed" race: once another
  // row's submit flips the bed to Occupied, our local `pickedBedId` is
  // stale. Re-derive eligibility from the live `beds` list (not just
  // the truthiness of the local state) so the Move button disables
  // immediately, and clear the stale selection so the operator is
  // prompted to pick again.
  const pickedBedStillVacant =
    !!pickedBedId &&
    vacantBedsForProperty.some((b) => b.id === pickedBedId);
  useEffect(() => {
    if (pickedBedId && !pickedBedStillVacant) {
      setPickedBedId("");
    }
  }, [pickedBedId, pickedBedStillVacant]);

  const canMove = !!pickedPropertyId && pickedBedStillVacant;

  return (
    <div
      className="grid gap-2 sm:grid-cols-[2fr_2fr_1.5fr_auto] items-end rounded-md border bg-card p-3"
      data-testid={`pending-placement-row-${occupant.id}`}
    >
      <div>
        <p className="text-sm font-medium" data-testid={`pending-name-${occupant.id}`}>
          {occupant.name}
        </p>
        <p className="text-xs text-muted-foreground">
          {occupant.employeeId ? `#${occupant.employeeId}` : "no employee id"}
          {" · "}
          {occupant.billingFrequency ?? "Monthly"}{" "}
          {formatUsd((occupant.chargePerBed ?? 0))}
        </p>
      </div>
      <Select
        value={pickedPropertyId}
        onValueChange={(v) => {
          setPickedPropertyId(v);
          setPickedBedId("");
        }}
      >
        <SelectTrigger
          className="h-9"
          data-testid={`pending-property-select-${occupant.id}`}
        >
          <SelectValue placeholder="Pick a property" />
        </SelectTrigger>
        <SelectContent>
          {propertyOptions.length === 0 ? (
            <SelectItem value="__none" disabled>
              No properties have a vacant bed
            </SelectItem>
          ) : (
            propertyOptions.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {shortPropertyName(p.name)}
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>
      <Select
        value={pickedBedId}
        onValueChange={setPickedBedId}
        disabled={!pickedPropertyId}
      >
        <SelectTrigger
          className="h-9"
          data-testid={`pending-bed-select-${occupant.id}`}
        >
          <SelectValue
            placeholder={pickedPropertyId ? "Pick a bed" : "Pick property first"}
          />
        </SelectTrigger>
        <SelectContent>
          {vacantBedsForProperty.map((b) => (
            <SelectItem key={b.id} value={b.id}>
              Bed {b.bedNumber}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        size="sm"
        disabled={!canMove}
        onClick={() => onMove(pickedPropertyId, pickedBedId)}
        data-testid={`pending-move-button-${occupant.id}`}
      >
        Move to bed
        <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
      </Button>
    </div>
  );
}
