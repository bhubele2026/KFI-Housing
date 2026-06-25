import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowRightLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { useData } from "@/context/data-store";
import { useToast } from "@/hooks/use-toast";
import { shortPropertyName } from "@/lib/property-name";
import type { Occupant } from "@/data/mockData";

export interface MoveOccupantDialogProps {
  occupant: Occupant;
  trigger?: ReactNode;
  testIdSuffix?: string;
}

/**
 * Reassigns an occupant to a different property (and bed) — and, by virtue of
 * the destination property's customerId, a different customer. The PATCH
 * /occupants route already handles freeing the prior bed (Vacant +
 * needs_cleaning); the destination bed has to be flipped to Occupied here so
 * the bed→occupant link mirrors what AssignOccupantDialog does.
 */
export function MoveOccupantDialog({
  occupant,
  trigger,
  testIdSuffix,
}: MoveOccupantDialogProps) {
  const { properties, beds, customers, updateOccupant, updateBed } = useData();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [destPropertyId, setDestPropertyId] = useState<string>("");
  const [destBedId, setDestBedId] = useState<string>("");

  const currentProperty = useMemo(
    () => properties.find((p) => p.id === occupant.propertyId) ?? null,
    [properties, occupant.propertyId],
  );
  const currentCustomer = useMemo(
    () =>
      currentProperty
        ? customers.find((c) => c.id === currentProperty.customerId) ?? null
        : null,
    [customers, currentProperty],
  );

  // Any property with a vacant bed is a valid destination. Cleaning state
  // never gates a move (Item 3) — occupying a needs_cleaning bed clears its
  // flag, matching PATCH /occupants/:id and /api/beds/move (both ungated).
  const propertyOptions = useMemo(() => {
    const idsWithVacancy = new Set(
      beds
        .filter((b) => b.status === "Vacant")
        .map((b) => b.propertyId),
    );
    return properties
      .filter((p) => idsWithVacancy.has(p.id))
      .map((p) => {
        const cust = customers.find((c) => c.id === p.customerId);
        return { property: p, customer: cust ?? null };
      })
      .sort((a, b) => {
        const ac = a.customer?.name ?? "";
        const bc = b.customer?.name ?? "";
        if (ac !== bc) return ac.localeCompare(bc);
        return a.property.name.localeCompare(b.property.name);
      });
  }, [properties, beds, customers]);

  const vacantBedsForDest = useMemo(() => {
    if (!destPropertyId) return [];
    return beds
      .filter(
        (b) => b.propertyId === destPropertyId && b.status === "Vacant",
      )
      .sort((a, b) => a.bedNumber - b.bedNumber);
  }, [beds, destPropertyId]);

  const destProperty = useMemo(
    () => propertyOptions.find((o) => o.property.id === destPropertyId) ?? null,
    [propertyOptions, destPropertyId],
  );

  // Reset selections each time the dialog opens so a previous attempt's
  // half-filled state doesn't leak in.
  useEffect(() => {
    if (open) {
      setDestPropertyId("");
      setDestBedId("");
    }
  }, [open]);

  // Default to the first vacant bed when the property changes; clear if
  // the previously-picked bed isn't valid in the new property.
  useEffect(() => {
    if (!destPropertyId) return;
    if (!destBedId || !vacantBedsForDest.some((b) => b.id === destBedId)) {
      setDestBedId(vacantBedsForDest[0]?.id ?? "");
    }
  }, [destPropertyId, destBedId, vacantBedsForDest]);

  const sameProperty =
    destPropertyId !== "" && destPropertyId === occupant.propertyId;
  const sameBed = destBedId !== "" && destBedId === occupant.bedId;
  const canSubmit =
    destPropertyId !== "" && destBedId !== "" && !(sameProperty && sameBed);

  const submit = async () => {
    if (!canSubmit) return;
    try {
      await Promise.resolve(
        updateOccupant(occupant.id, {
          propertyId: destPropertyId,
          bedId: destBedId,
        }),
      );
      // Mirror AssignOccupantDialog's bed-side update: occupant patch
      // frees the prior bed but does not flip the destination.
      await Promise.resolve(
        updateBed(destBedId, { status: "Occupied", occupantId: occupant.id }),
      );
      toast({
        title: "Occupant moved",
        description: `${occupant.name} moved to ${destProperty?.property.name ?? "new property"}${
          destProperty?.customer ? ` (${destProperty.customer.name})` : ""
        }.`,
      });
      setOpen(false);
    } catch (err) {
      toast({
        title: "Move failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const tid = testIdSuffix ? `-${testIdSuffix}` : "";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button
            size="sm"
            variant="outline"
            data-testid={`button-move-occupant${tid}`}
          >
            <ArrowRightLeft className="h-3.5 w-3.5 mr-1" />
            Move
          </Button>
        )}
      </DialogTrigger>
      <DialogContent
        className="sm:max-w-md"
        data-testid={`dialog-move-occupant${tid}`}
      >
        <DialogHeader>
          <DialogTitle>Move {occupant.name}</DialogTitle>
          <DialogDescription>
            Reassign this occupant to a different property. The current bed
            will be vacated and flagged for cleaning automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
            <div className="text-muted-foreground">Currently at</div>
            <div className="font-medium">
              {currentProperty
                ? shortPropertyName(currentProperty.name)
                : "Unassigned"}
              {currentCustomer ? (
                <span className="text-muted-foreground font-normal">
                  {" "}— {currentCustomer.name}
                </span>
              ) : null}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="move-occ-property">Destination property</Label>
            {propertyOptions.length === 0 ? (
              <div className="text-xs text-muted-foreground italic">
                No other property has a ready vacant bed. Finish a cleaning
                workflow or vacate a bed elsewhere first.
              </div>
            ) : (
              <Select value={destPropertyId} onValueChange={setDestPropertyId}>
                <SelectTrigger
                  id="move-occ-property"
                  data-testid={`select-move-property${tid}`}
                >
                  <SelectValue placeholder="Pick a property…" />
                </SelectTrigger>
                <SelectContent>
                  {propertyOptions.map(({ property, customer }) => (
                    <SelectItem key={property.id} value={property.id}>
                      {shortPropertyName(property.name)}
                      {customer ? ` — ${customer.name}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {destPropertyId ? (
            <div className="space-y-2">
              <Label htmlFor="move-occ-bed">Destination bed</Label>
              <Select value={destBedId} onValueChange={setDestBedId}>
                <SelectTrigger
                  id="move-occ-bed"
                  data-testid={`select-move-bed${tid}`}
                >
                  <SelectValue placeholder="Pick a bed…" />
                </SelectTrigger>
                <SelectContent>
                  {vacantBedsForDest.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      Bed {b.bedNumber}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {destProperty ? (
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
              <div className="text-muted-foreground">Will move to</div>
              <div className="font-medium">
                {shortPropertyName(destProperty.property.name)}
                {destProperty.customer ? (
                  <span className="text-muted-foreground font-normal">
                    {" "}— {destProperty.customer.name}
                  </span>
                ) : null}
              </div>
              {destProperty.customer?.id !== currentCustomer?.id ? (
                <div className="mt-1 text-amber-700 dark:text-amber-400">
                  Note: this is a different customer
                  {currentCustomer ? ` (was ${currentCustomer.name})` : ""}.
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            data-testid={`button-move-cancel${tid}`}
          >
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={!canSubmit}
            data-testid={`button-move-submit${tid}`}
            title={
              sameProperty && sameBed
                ? "Pick a different bed or property"
                : undefined
            }
          >
            Move occupant
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
