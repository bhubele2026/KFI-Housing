import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { useData } from "@/context/data-store";
import {
  BILLING_FREQUENCIES,
  type BillingFrequency,
  type Bed,
  type Occupant,
} from "@/data/mockData";
import { shortPropertyName } from "@/lib/property-name";

export interface AssignOccupantInitialValues {
  name?: string;
  employeeId?: string;
  company?: string;
  chargePerBed?: number;
  billingFrequency?: BillingFrequency;
  email?: string;
  phone?: string;
}

export interface AssignOccupantDialogProps {
  /**
   * When provided, the dialog skips the property/bed picker and assigns the
   * new occupant straight to this bed. Mirrors the existing per-bed flow on
   * the property-detail page.
   */
  bed?: { id: string; propertyId: string };
  /** Pre-fill the form. Useful for the dashboard "Unplaced payroll" tile. */
  initial?: AssignOccupantInitialValues;
  /**
   * Called after the parent should run `addOccupant(occ)` and
   * `updateBed(bed.id, { status: "Occupied", occupantId: occ.id })`. The
   * dialog handles building the Occupant; the parent decides whether to
   * persist via the data-store hooks (so this component stays usable
   * without baking the data-store into it).
   */
  onAssign: (occupant: Occupant, bed: { id: string; propertyId: string }) => void;
  /** Custom trigger. Defaults to the small italic "Assign occupant" link. */
  trigger?: ReactNode;
  /**
   * Optional id suffix so multiple instances on the same page get unique
   * `data-testid`s (e.g. one per unplaced-payroll row).
   */
  testIdSuffix?: string;
}

const EMPTY_FORM = {
  name: "",
  employeeId: "",
  company: "",
  moveInDate: "",
  chargePerBed: "",
  billingFrequency: "Monthly" as BillingFrequency,
  email: "",
  phone: "",
};

function buildInitialForm(initial: AssignOccupantInitialValues | undefined) {
  if (!initial) return EMPTY_FORM;
  return {
    name: initial.name ?? "",
    employeeId: initial.employeeId ?? "",
    company: initial.company ?? "",
    moveInDate: "",
    chargePerBed:
      typeof initial.chargePerBed === "number" && Number.isFinite(initial.chargePerBed)
        ? String(initial.chargePerBed)
        : "",
    billingFrequency: initial.billingFrequency ?? "Monthly",
    email: initial.email ?? "",
    phone: initial.phone ?? "",
  };
}

export function AssignOccupantDialog({
  bed,
  initial,
  onAssign,
  trigger,
  testIdSuffix,
}: AssignOccupantDialogProps) {
  const { properties, beds, customers } = useData();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(() => buildInitialForm(initial));
  const [pickedPropertyId, setPickedPropertyId] = useState<string>("");
  const [pickedBedId, setPickedBedId] = useState<string>("");

  // Reset the form whenever the dialog re-opens so the next click always
  // starts from a clean (and freshly pre-filled) state — without this,
  // edits made in a previous open session would persist.
  useEffect(() => {
    if (open) {
      setForm(buildInitialForm(initial));
      setPickedPropertyId("");
      setPickedBedId("");
    }
  }, [open, initial]);

  const f =
    (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((p) => ({ ...p, [k]: e.target.value }));

  // When a bed is supplied by the parent, lock to that bed/property.
  // Otherwise the user picks both via dropdowns inside the dialog.
  const fixedBed = bed ?? null;

  const propertyOptions = useMemo(() => {
    if (fixedBed) return [];
    // Only properties that have at least one vacant bed are worth picking.
    const propertyIdsWithVacancy = new Set(
      beds.filter((b) => b.status === "Vacant").map((b) => b.propertyId),
    );
    return properties
      .filter((p) => propertyIdsWithVacancy.has(p.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [fixedBed, properties, beds]);

  const vacantBedsForProperty = useMemo(() => {
    if (fixedBed) return [];
    if (!pickedPropertyId) return [];
    return beds
      .filter((b) => b.propertyId === pickedPropertyId && b.status === "Vacant")
      .sort((a, b) => a.bedNumber - b.bedNumber);
  }, [fixedBed, beds, pickedPropertyId]);

  // Reset the picked bed if the property changes underneath it.
  useEffect(() => {
    if (fixedBed) return;
    if (pickedBedId && !vacantBedsForProperty.some((b) => b.id === pickedBedId)) {
      setPickedBedId("");
    }
  }, [fixedBed, pickedBedId, vacantBedsForProperty]);

  const resolvedBed: { id: string; propertyId: string } | null = fixedBed
    ? fixedBed
    : pickedBedId && pickedPropertyId
      ? { id: pickedBedId, propertyId: pickedPropertyId }
      : null;

  const canSubmit = !!form.name && !!resolvedBed;

  const submit = () => {
    if (!resolvedBed) return;
    if (!form.name) return;
    const occ: Occupant = {
      id: `occ-${Date.now()}`,
      propertyId: resolvedBed.propertyId,
      bedId: resolvedBed.id,
      name: form.name,
      employeeId: form.employeeId,
      company: form.company,
      moveInDate: form.moveInDate || new Date().toISOString().split("T")[0],
      moveOutDate: null,
      status: "Active",
      chargePerBed: parseFloat(form.chargePerBed) || 0,
      billingFrequency: form.billingFrequency,
      email: form.email,
      phone: form.phone,
      // Newly-created occupants are entered manually through this dialog;
      // payroll provenance is reserved for the seeder.
      chargeSource: "",
      chargeSourceCustomer: "",
      chargeSourcePersonId: "",
    };
    onAssign(occ, resolvedBed);
    setOpen(false);
  };

  const tidSuffix = testIdSuffix ? `-${testIdSuffix}` : "";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground italic flex items-center gap-1 transition-colors"
            data-testid={`button-assign-occupant${tidSuffix}`}
          >
            <Plus className="h-3 w-3" />
            Assign occupant
          </button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Assign Occupant to Bed</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-2">
          {!fixedBed && (
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label>Property *</Label>
                <Select
                  value={pickedPropertyId}
                  onValueChange={setPickedPropertyId}
                >
                  <SelectTrigger
                    data-testid={`select-assign-property${tidSuffix}`}
                  >
                    <SelectValue placeholder="Pick a property with a vacant bed" />
                  </SelectTrigger>
                  <SelectContent>
                    {propertyOptions.length === 0 ? (
                      <SelectItem value="__none" disabled>
                        No properties have a vacant bed
                      </SelectItem>
                    ) : (
                      propertyOptions.map((p) => {
                        const customer = customers.find(
                          (c) => c.id === p.customerId,
                        );
                        return (
                          <SelectItem key={p.id} value={p.id}>
                            {shortPropertyName(p.name)}
                            {customer ? ` — ${customer.name}` : ""}
                          </SelectItem>
                        );
                      })
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <Label>Vacant Bed *</Label>
                <Select
                  value={pickedBedId}
                  onValueChange={setPickedBedId}
                  disabled={!pickedPropertyId}
                >
                  <SelectTrigger data-testid={`select-assign-bed${tidSuffix}`}>
                    <SelectValue
                      placeholder={
                        pickedPropertyId
                          ? "Pick a vacant bed"
                          : "Pick a property first"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {vacantBedsForProperty.map((b: Bed) => (
                      <SelectItem key={b.id} value={b.id}>
                        Bed {b.bedNumber}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>Full Name *</Label>
              <Input
                value={form.name}
                onChange={f("name")}
                placeholder="Jane Smith"
                data-testid={`input-assign-name${tidSuffix}`}
              />
            </div>
            <div>
              <Label>Employee ID</Label>
              <Input
                value={form.employeeId}
                onChange={f("employeeId")}
                placeholder="EMP-001"
                data-testid={`input-assign-employee-id${tidSuffix}`}
              />
            </div>
            <div>
              <Label>Company</Label>
              <Input
                value={form.company}
                onChange={f("company")}
                placeholder="Acme Corp"
                data-testid={`input-assign-company${tidSuffix}`}
              />
            </div>
            <div>
              <Label>Move-in Date</Label>
              <Input
                type="date"
                value={form.moveInDate}
                onChange={f("moveInDate")}
                data-testid={`input-assign-move-in${tidSuffix}`}
              />
            </div>
            <div>
              <Label>Charge / Bed ($)</Label>
              <Input
                type="number"
                value={form.chargePerBed}
                onChange={f("chargePerBed")}
                placeholder="0.00"
                data-testid={`input-assign-charge${tidSuffix}`}
              />
            </div>
            <div>
              <Label>Billing Frequency</Label>
              <Select
                value={form.billingFrequency}
                onValueChange={(v) =>
                  setForm((p) => ({
                    ...p,
                    billingFrequency: v as BillingFrequency,
                  }))
                }
              >
                <SelectTrigger
                  data-testid={`select-assign-billing${tidSuffix}`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BILLING_FREQUENCIES.map((fr) => (
                    <SelectItem key={fr} value={fr}>
                      {fr}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Email</Label>
              <Input
                value={form.email}
                onChange={f("email")}
                placeholder="jane@company.com"
              />
            </div>
            <div>
              <Label>Phone</Label>
              <Input
                value={form.phone}
                onChange={f("phone")}
                placeholder="555-000-0000"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={submit}
              disabled={!canSubmit}
              data-testid={`button-assign-submit${tidSuffix}`}
            >
              Assign
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
