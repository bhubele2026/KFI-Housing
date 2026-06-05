import { useMemo, useState, type ReactNode } from "react";
import { MainLayout } from "@/components/layout/main-layout";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListVehicles,
  useCreateVehicle,
  useUpdateVehicle,
  useDeleteVehicle,
  getListVehiclesQueryKey,
  useListCustomers,
  useListOccupants,
  useListProperties,
} from "@workspace/api-client-react";
import {
  Truck,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  AlertTriangle,
} from "lucide-react";

// Sentinel value for the optional dropdowns. Radix Select cannot use an
// empty-string value, so "unassigned" is modelled with this token and
// mapped back to "" / null on submit.
const NONE = "__none__";

const OWNERSHIPS = ["owned", "leased", "rented"] as const;
const STATUSES = [
  "In use",
  "Available",
  "In shop",
  "Out of service",
] as const;

type Ownership = (typeof OWNERSHIPS)[number];
type VehicleStatus = (typeof STATUSES)[number];

interface VehicleForm {
  merchantUnit: string;
  vin: string;
  plate: string;
  plateState: string;
  year: string;
  make: string;
  model: string;
  seats: string;
  bookValue: string;
  ownership: Ownership;
  monthlyCost: string;
  status: VehicleStatus;
  customerId: string;
  propertyId: string;
  driverOccupantId: string;
  homeBaseState: string;
  currentLocationNote: string;
  associatesTransported: string;
  registrationExpires: string;
  repairsNeeded: string;
  notes: string;
}

const EMPTY_FORM: VehicleForm = {
  merchantUnit: "",
  vin: "",
  plate: "",
  plateState: "",
  year: "",
  make: "",
  model: "",
  seats: "",
  bookValue: "",
  ownership: "owned",
  monthlyCost: "",
  status: "Available",
  customerId: "",
  propertyId: "",
  driverOccupantId: "",
  homeBaseState: "WI",
  currentLocationNote: "",
  associatesTransported: "",
  registrationExpires: "",
  repairsNeeded: "",
  notes: "",
};

function statusVariant(
  status: string,
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "In use":
      return "default";
    case "Available":
      return "secondary";
    case "In shop":
      return "destructive";
    default:
      return "outline";
  }
}

function num(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export default function Vehicles() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: vehicles, isLoading } = useListVehicles();
  const { data: customers } = useListCustomers();
  const { data: occupants } = useListOccupants();
  const { data: properties } = useListProperties();

  const createMutation = useCreateVehicle();
  const updateMutation = useUpdateVehicle();
  const deleteMutation = useDeleteVehicle();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<VehicleForm>(EMPTY_FORM);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const customerName = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of customers ?? []) map.set(c.id, c.name || c.id);
    return map;
  }, [customers]);

  const occupantName = useMemo(() => {
    const map = new Map<string, string>();
    for (const o of occupants ?? []) map.set(o.id, o.name || o.id);
    return map;
  }, [occupants]);

  // Drivers are occupants; surface authorised drivers first but allow any
  // occupant (a local non-resident driver is an occupant without a bed).
  const driverOptions = useMemo(() => {
    return [...(occupants ?? [])].sort((a, b) => {
      const ad = (a as { kfisAuthorizedToDrive?: boolean }).kfisAuthorizedToDrive
        ? 0
        : 1;
      const bd = (b as { kfisAuthorizedToDrive?: boolean }).kfisAuthorizedToDrive
        ? 0
        : 1;
      if (ad !== bd) return ad - bd;
      return (a.name || "").localeCompare(b.name || "");
    });
  }, [occupants]);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListVehiclesQueryKey() });

  const openAdd = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (v: Record<string, unknown>) => {
    setEditingId(String(v.id));
    setForm({
      merchantUnit: String(v.merchantUnit ?? ""),
      vin: String(v.vin ?? ""),
      plate: String(v.plate ?? ""),
      plateState: String(v.plateState ?? ""),
      year: v.year == null ? "" : String(v.year),
      make: String(v.make ?? ""),
      model: String(v.model ?? ""),
      seats: v.seats == null ? "" : String(v.seats),
      bookValue: v.bookValue == null ? "" : String(v.bookValue),
      ownership: (OWNERSHIPS as readonly string[]).includes(String(v.ownership))
        ? (v.ownership as Ownership)
        : "owned",
      monthlyCost: v.monthlyCost == null ? "" : String(v.monthlyCost),
      status: (STATUSES as readonly string[]).includes(String(v.status))
        ? (v.status as VehicleStatus)
        : "Available",
      customerId: String(v.customerId ?? ""),
      propertyId: v.propertyId == null ? "" : String(v.propertyId),
      driverOccupantId:
        v.driverOccupantId == null ? "" : String(v.driverOccupantId),
      homeBaseState: String(v.homeBaseState ?? "WI"),
      currentLocationNote: String(v.currentLocationNote ?? ""),
      associatesTransported:
        v.associatesTransported == null ? "" : String(v.associatesTransported),
      registrationExpires: String(v.registrationExpires ?? ""),
      repairsNeeded: String(v.repairsNeeded ?? ""),
      notes: String(v.notes ?? ""),
    });
    setDialogOpen(true);
  };

  const buildPayload = () => ({
    vin: form.vin.trim(),
    plate: form.plate.trim(),
    plateState: form.plateState.trim(),
    year: form.year.trim() === "" ? null : num(form.year),
    make: form.make.trim(),
    model: form.model.trim(),
    seats: num(form.seats),
    merchantUnit: form.merchantUnit.trim(),
    bookValue: num(form.bookValue),
    ownership: form.ownership,
    monthlyCost: form.monthlyCost.trim() === "" ? 0 : num(form.monthlyCost),
    customerId: form.customerId,
    propertyId: form.propertyId === "" ? null : form.propertyId,
    driverOccupantId:
      form.driverOccupantId === "" ? null : form.driverOccupantId,
    status: form.status,
    inShop: form.status === "In shop",
    repairsNeeded: form.repairsNeeded.trim(),
    homeBaseState: form.homeBaseState.trim() || "WI",
    currentLocationNote: form.currentLocationNote.trim(),
    associatesTransported: num(form.associatesTransported),
    registrationExpires: form.registrationExpires.trim(),
    notes: form.notes.trim(),
  });

  const handleSave = () => {
    const payload = buildPayload();
    if (editingId) {
      updateMutation.mutate(
        { id: editingId, data: payload },
        {
          onSuccess: () => {
            invalidate();
            setDialogOpen(false);
            toast({ title: "Vehicle updated" });
          },
          onError: () =>
            toast({ title: "Failed to update vehicle", variant: "destructive" }),
        },
      );
    } else {
      createMutation.mutate(
        { data: { id: `veh-${Date.now()}`, ...payload } },
        {
          onSuccess: () => {
            invalidate();
            setDialogOpen(false);
            toast({ title: "Vehicle added" });
          },
          onError: () =>
            toast({ title: "Failed to add vehicle", variant: "destructive" }),
        },
      );
    }
  };

  const confirmDelete = () => {
    if (!deletingId) return;
    deleteMutation.mutate(
      { id: deletingId },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: "Vehicle removed" });
          setDeletingId(null);
        },
        onError: () => {
          toast({ title: "Failed to remove vehicle", variant: "destructive" });
          setDeletingId(null);
        },
      },
    );
  };

  const saving = createMutation.isPending || updateMutation.isPending;
  const rows = vehicles ?? [];

  return (
    <MainLayout>
      <PageHeader
        title="Vehicles"
        description="KFI transportation fleet — vans, their driver, the client they serve, and where they are."
      />

      <div className="flex justify-end mb-4">
        <Button onClick={openAdd} data-testid="vehicle-add-btn">
          <Plus className="h-4 w-4" />
          <span className="ml-1">Add vehicle</span>
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Loading vehicles…
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
              <Truck className="h-8 w-8 mb-2 opacity-60" />
              <p className="text-sm">No vehicles yet.</p>
              <p className="text-xs">Add your first van to start tracking the fleet.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Unit</TableHead>
                  <TableHead>Vehicle</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Driver</TableHead>
                  <TableHead className="text-right">Riders</TableHead>
                  <TableHead className="text-right">Monthly</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead className="w-24 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((v) => {
                  const vv = v as Record<string, unknown>;
                  const id = String(vv.id);
                  const offWi =
                    String(vv.status) === "Available" &&
                    String(vv.currentLocationNote ?? "").trim() !== "";
                  const seats = Number(vv.seats ?? 0);
                  const riders = Number(vv.associatesTransported ?? 0);
                  return (
                    <TableRow key={id} data-testid="vehicle-row">
                      <TableCell className="font-medium">
                        {String(vv.merchantUnit || "—")}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">
                          {[vv.year, vv.make, vv.model]
                            .filter((x) => x != null && String(x) !== "")
                            .join(" ") || "—"}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {String(vv.plate || "")}
                          {vv.plate && vv.vin ? " · " : ""}
                          {String(vv.vin || "")}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(String(vv.status))}>
                          {String(vv.status)}
                        </Badge>
                        {offWi && (
                          <div className="mt-1 flex items-center gap-1 text-xs text-amber-600">
                            <AlertTriangle className="h-3 w-3" />
                            off-WI, available
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        {vv.customerId
                          ? customerName.get(String(vv.customerId)) ??
                            String(vv.customerId)
                          : "—"}
                      </TableCell>
                      <TableCell>
                        {vv.driverOccupantId
                          ? occupantName.get(String(vv.driverOccupantId)) ??
                            String(vv.driverOccupantId)
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {riders}
                        {seats ? (
                          <span className="text-muted-foreground">/{seats}</span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {Number(vv.monthlyCost ?? 0) > 0
                          ? `$${Number(vv.monthlyCost).toLocaleString()}`
                          : "—"}
                      </TableCell>
                      <TableCell className="max-w-[14rem] truncate text-sm text-muted-foreground">
                        {String(
                          vv.currentLocationNote ||
                            (vv.propertyId
                              ? "Based at a housing unit"
                              : vv.homeBaseState || ""),
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEdit(vv)}
                          data-testid="vehicle-edit-btn"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeletingId(id)}
                          data-testid="vehicle-delete-btn"
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Add / edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Edit vehicle" : "Add vehicle"}
            </DialogTitle>
            <DialogDescription>
              Identifiers, ownership, and how this van is being used.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-4 py-2">
            <Field label="Merchant Unit #">
              <Input
                value={form.merchantUnit}
                onChange={(e) =>
                  setForm({ ...form, merchantUnit: e.target.value })
                }
                data-testid="vehicle-field-merchantUnit"
              />
            </Field>
            <Field label="Status">
              <Select
                value={form.status}
                onValueChange={(val) =>
                  setForm({ ...form, status: val as VehicleStatus })
                }
              >
                <SelectTrigger data-testid="vehicle-field-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Year">
              <Input
                inputMode="numeric"
                value={form.year}
                onChange={(e) => setForm({ ...form, year: e.target.value })}
              />
            </Field>
            <Field label="Make">
              <Input
                value={form.make}
                onChange={(e) => setForm({ ...form, make: e.target.value })}
              />
            </Field>
            <Field label="Model">
              <Input
                value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
              />
            </Field>
            <Field label="Seats">
              <Input
                inputMode="numeric"
                value={form.seats}
                onChange={(e) => setForm({ ...form, seats: e.target.value })}
              />
            </Field>

            <Field label="VIN">
              <Input
                value={form.vin}
                onChange={(e) => setForm({ ...form, vin: e.target.value })}
              />
            </Field>
            <Field label="Plate">
              <div className="flex gap-2">
                <Input
                  value={form.plate}
                  onChange={(e) => setForm({ ...form, plate: e.target.value })}
                  placeholder="Number"
                />
                <Input
                  value={form.plateState}
                  onChange={(e) =>
                    setForm({ ...form, plateState: e.target.value })
                  }
                  placeholder="ST"
                  className="w-16"
                />
              </div>
            </Field>

            <Field label="Ownership">
              <Select
                value={form.ownership}
                onValueChange={(val) =>
                  setForm({ ...form, ownership: val as Ownership })
                }
              >
                <SelectTrigger data-testid="vehicle-field-ownership">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OWNERSHIPS.map((o) => (
                    <SelectItem key={o} value={o}>
                      {o}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Monthly lease/rent ($)">
              <Input
                inputMode="decimal"
                value={form.monthlyCost}
                onChange={(e) =>
                  setForm({ ...form, monthlyCost: e.target.value })
                }
                disabled={form.ownership === "owned"}
                placeholder={form.ownership === "owned" ? "Owned — $0" : ""}
              />
            </Field>
            <Field label="Current book value ($)">
              <Input
                inputMode="decimal"
                value={form.bookValue}
                onChange={(e) =>
                  setForm({ ...form, bookValue: e.target.value })
                }
              />
            </Field>
            <Field label="Registration expires">
              <Input
                type="date"
                value={form.registrationExpires}
                onChange={(e) =>
                  setForm({ ...form, registrationExpires: e.target.value })
                }
              />
            </Field>

            <Field label="Client served">
              <Select
                value={form.customerId === "" ? NONE : form.customerId}
                onValueChange={(val) =>
                  setForm({ ...form, customerId: val === NONE ? "" : val })
                }
              >
                <SelectTrigger data-testid="vehicle-field-customer">
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Unassigned</SelectItem>
                  {(customers ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name || c.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Driver">
              <Select
                value={form.driverOccupantId === "" ? NONE : form.driverOccupantId}
                onValueChange={(val) =>
                  setForm({
                    ...form,
                    driverOccupantId: val === NONE ? "" : val,
                  })
                }
              >
                <SelectTrigger data-testid="vehicle-field-driver">
                  <SelectValue placeholder="No driver" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No driver</SelectItem>
                  {driverOptions.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.name || o.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Based at housing">
              <Select
                value={form.propertyId === "" ? NONE : form.propertyId}
                onValueChange={(val) =>
                  setForm({ ...form, propertyId: val === NONE ? "" : val })
                }
              >
                <SelectTrigger data-testid="vehicle-field-property">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None</SelectItem>
                  {(properties ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name || p.address || p.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Home-base state (goal)">
              <Input
                value={form.homeBaseState}
                onChange={(e) =>
                  setForm({ ...form, homeBaseState: e.target.value })
                }
                placeholder="WI"
              />
            </Field>

            <Field label="Associates transported">
              <Input
                inputMode="numeric"
                value={form.associatesTransported}
                onChange={(e) =>
                  setForm({ ...form, associatesTransported: e.target.value })
                }
              />
            </Field>
            <Field label="Current location (if not at housing)">
              <Input
                value={form.currentLocationNote}
                onChange={(e) =>
                  setForm({ ...form, currentLocationNote: e.target.value })
                }
                placeholder="e.g. Parked at Schuette Metals — Schofield WI"
              />
            </Field>

            <div className="col-span-2">
              <Field label="Repairs needed">
                <Input
                  value={form.repairsNeeded}
                  onChange={(e) =>
                    setForm({ ...form, repairsNeeded: e.target.value })
                  }
                />
              </Field>
            </div>
            <div className="col-span-2">
              <Field label="Notes">
                <Input
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </Field>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving}
              data-testid="vehicle-save-btn"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : editingId ? (
                "Save changes"
              ) : (
                "Add vehicle"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog
        open={!!deletingId}
        onOpenChange={(open) => {
          if (!open) setDeletingId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this vehicle?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the vehicle record. This cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </MainLayout>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
