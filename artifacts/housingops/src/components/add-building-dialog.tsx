import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  EMPTY_LEASE_DRAFT,
  LeaseFormFields,
  buildLeaseFromDraft,
  leaseDraftCanSubmit,
  type LeaseDraftState,
} from "@/components/lease-form-fields";
import type { Building, Lease, Property } from "@/data/mockData";

export interface AddBuildingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  property: Pick<Property, "id" | "defaultNoticePeriodDays">;
  defaultBuildingName: string;
  addBuilding: (building: Building) => Promise<Building>;
  addLease: (lease: Lease) => Promise<void>;
}

interface BuildingDraft {
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  notes: string;
}

const EMPTY_BUILDING: BuildingDraft = {
  name: "",
  address: "",
  city: "",
  state: "",
  zip: "",
  notes: "",
};

/**
 * Combined Add-Building dialog (Task #609).
 *
 * The default flow creates a building **and** its first lease in one
 * submit — operators almost always add both back-to-back, so we let
 * them capture both at once instead of leaving an empty placeholder
 * row behind. A clearly-labeled secondary action covers the
 * hotel / shared-occupancy case where there's no first tenant lease
 * to attach.
 *
 * The partial-failure path is real: the building create succeeds but
 * the lease create fails (network blip, validation, etc). We keep the
 * dialog open in that case, surface the lease error, and on retry only
 * re-issue the lease create — the operator never has to re-enter the
 * building fields.
 */
export function AddBuildingDialog({
  open,
  onOpenChange,
  property,
  defaultBuildingName,
  addBuilding,
  addLease,
}: AddBuildingDialogProps) {
  const [building, setBuilding] = useState<BuildingDraft>(() => ({
    ...EMPTY_BUILDING,
    name: defaultBuildingName,
  }));
  const [lease, setLease] = useState<LeaseDraftState>(EMPTY_LEASE_DRAFT);
  // Once true the building create succeeded but the lease create
  // failed — we lock the building fields, remember the saved id, and
  // let the operator retry just the lease step.
  const [createdBuildingId, setCreatedBuildingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Two modes: "withLease" (default — create building + first lease)
  // and "buildingOnly" (hotel / shared occupancy — skip the lease).
  const [mode, setMode] = useState<"withLease" | "buildingOnly">("withLease");

  // Reset transient state every time the dialog re-opens, otherwise a
  // dismissed partial-failure would survive into the next open and let
  // the operator double-submit the same building id.
  useEffect(() => {
    if (open) {
      setBuilding({ ...EMPTY_BUILDING, name: defaultBuildingName });
      setLease(EMPTY_LEASE_DRAFT);
      setCreatedBuildingId(null);
      setError(null);
      setSubmitting(false);
      setMode("withLease");
    }
  }, [open, defaultBuildingName]);

  const buildingCanSubmit = building.name.trim().length > 0;
  const leaseCanSubmit = leaseDraftCanSubmit(lease);
  const canSubmit =
    mode === "buildingOnly"
      ? buildingCanSubmit && !submitting
      : // In the retry-lease state the building already exists, so we
        // only need the lease fields filled in.
        (createdBuildingId !== null || buildingCanSubmit) &&
        leaseCanSubmit &&
        !submitting;

  const submitWithLease = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    let buildingId = createdBuildingId;
    try {
      if (!buildingId) {
        const saved = await addBuilding({
          id: `bldg_${property.id}_${Date.now()}`,
          propertyId: property.id,
          name: building.name.trim(),
          address: building.address,
          city: building.city,
          state: building.state,
          zip: building.zip,
          notes: building.notes,
        });
        buildingId = saved.id;
        setCreatedBuildingId(saved.id);
      }
    } catch {
      // addBuilding already surfaced a toast; show inline error too so
      // the dialog explains why submit didn't close.
      setError("Couldn't create the building. Please try again.");
      setSubmitting(false);
      return;
    }
    try {
      await addLease(
        buildLeaseFromDraft(lease, {
          propertyId: property.id,
          buildingId,
          property,
        }),
      );
      onOpenChange(false);
    } catch {
      setError(
        "Building saved, but we couldn't create the first lease. Adjust the lease and try again, or close to add the lease later.",
      );
      setSubmitting(false);
    }
  };

  const submitBuildingOnly = async () => {
    if (!buildingCanSubmit || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await addBuilding({
        id: `bldg_${property.id}_${Date.now()}`,
        propertyId: property.id,
        name: building.name.trim(),
        address: building.address,
        city: building.city,
        state: building.state,
        zip: building.zip,
        notes: building.notes,
      });
      onOpenChange(false);
    } catch {
      setError("Couldn't create the building. Please try again.");
      setSubmitting(false);
    }
  };

  const buildingLocked = createdBuildingId !== null;
  const description = useMemo(() => {
    if (buildingLocked) {
      return "Building saved. Add the first lease, or close the dialog to add it later.";
    }
    return mode === "buildingOnly"
      ? "Create a building with no lease — use this for hotels or other shared-occupancy buildings."
      : "Create a new building and its first lease in one step.";
  }, [buildingLocked, mode]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add building</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-3">
            <div>
              <Label htmlFor="add-building-name">Building name *</Label>
              <Input
                id="add-building-name"
                value={building.name}
                disabled={buildingLocked}
                onChange={(e) =>
                  setBuilding((b) => ({ ...b, name: e.target.value }))
                }
                data-testid="input-add-building-name"
              />
            </div>
            <div>
              <Label htmlFor="add-building-address">Address</Label>
              <Input
                id="add-building-address"
                value={building.address}
                disabled={buildingLocked}
                onChange={(e) =>
                  setBuilding((b) => ({ ...b, address: e.target.value }))
                }
                data-testid="input-add-building-address"
              />
            </div>
            <div className="grid grid-cols-[1fr_120px_120px] gap-3">
              <div>
                <Label htmlFor="add-building-city">City</Label>
                <Input
                  id="add-building-city"
                  value={building.city}
                  disabled={buildingLocked}
                  onChange={(e) =>
                    setBuilding((b) => ({ ...b, city: e.target.value }))
                  }
                  data-testid="input-add-building-city"
                />
              </div>
              <div>
                <Label htmlFor="add-building-state">State</Label>
                <Input
                  id="add-building-state"
                  value={building.state}
                  disabled={buildingLocked}
                  onChange={(e) =>
                    setBuilding((b) => ({ ...b, state: e.target.value }))
                  }
                  data-testid="input-add-building-state"
                />
              </div>
              <div>
                <Label htmlFor="add-building-zip">Zip</Label>
                <Input
                  id="add-building-zip"
                  value={building.zip}
                  disabled={buildingLocked}
                  onChange={(e) =>
                    setBuilding((b) => ({ ...b, zip: e.target.value }))
                  }
                  data-testid="input-add-building-zip"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="add-building-notes">Notes</Label>
              <Textarea
                id="add-building-notes"
                value={building.notes}
                disabled={buildingLocked}
                onChange={(e) =>
                  setBuilding((b) => ({ ...b, notes: e.target.value }))
                }
                data-testid="textarea-add-building-notes"
              />
            </div>
          </div>

          {mode === "withLease" && (
            <div
              className="space-y-3 border-t pt-4"
              data-testid="add-building-lease-section"
            >
              <div className="text-sm font-medium">First lease</div>
              <LeaseFormFields
                form={lease}
                setForm={setLease}
                testIdSuffix="-building-dialog"
              />
            </div>
          )}

          {error && (
            <div
              className="text-sm text-destructive"
              data-testid="add-building-error"
              role="alert"
            >
              {error}
            </div>
          )}
        </div>
        <DialogFooter className="gap-2 sm:gap-2 flex-col sm:flex-row sm:justify-between">
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              data-testid="button-cancel-add-building"
            >
              Cancel
            </Button>
            {!buildingLocked && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  if (mode === "withLease") {
                    setMode("buildingOnly");
                    setError(null);
                  } else {
                    submitBuildingOnly();
                  }
                }}
                disabled={
                  submitting ||
                  (mode === "buildingOnly" && !buildingCanSubmit)
                }
                data-testid="button-add-building-without-lease"
              >
                {mode === "withLease"
                  ? "Add building without a lease"
                  : "Create building only"}
              </Button>
            )}
            {mode === "buildingOnly" && !buildingLocked && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setMode("withLease");
                  setError(null);
                }}
                data-testid="button-add-building-include-lease"
              >
                Include a lease instead
              </Button>
            )}
          </div>
          {mode === "withLease" && (
            <Button
              type="button"
              onClick={submitWithLease}
              disabled={!canSubmit}
              data-testid="button-save-building-and-lease"
            >
              {buildingLocked ? "Retry lease" : "Add building & lease"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
