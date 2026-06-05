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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { toCsv, downloadCsv, timestampedCsvName } from "@/lib/csv";
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
  useListVehicleRiders,
  useCreateVehicleRider,
  useDeleteVehicleRider,
  getListVehicleRidersQueryKey,
  useListVehicleRideOverrides,
  useCreateVehicleRideOverride,
  useDeleteVehicleRideOverride,
  getListVehicleRideOverridesQueryKey,
  useListVehicleFuelCharges,
  useCreateVehicleFuelCharge,
  useDeleteVehicleFuelCharge,
  getListVehicleFuelChargesQueryKey,
  useListVehicleMaintenance,
  useCreateVehicleMaintenance,
  useUpdateVehicleMaintenance,
  useDeleteVehicleMaintenance,
  getListVehicleMaintenanceQueryKey,
  useListVehicleInsurance,
  useCreateVehicleInsurance,
  useDeleteVehicleInsurance,
  getListVehicleInsuranceQueryKey,
} from "@workspace/api-client-react";
import {
  Truck,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  AlertTriangle,
  Users,
  Fuel,
  Wrench,
  Download,
  ShieldCheck,
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

function todayYMD(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

// Whole days from today until `ymd` (YYYY-MM-DD); negative if past. Null
// when the string is blank or unparseable.
function daysUntilYMD(ymd: string): number | null {
  if (!ymd) return null;
  const parts = ymd.split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => !n)) return null;
  const [y, m, d] = parts;
  const target = new Date(y, m - 1, d).getTime();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((target - today) / 86400000);
}

function vehicleLabelOf(vv: Record<string, unknown>): string {
  return (
    String(vv.merchantUnit || "") ||
    [vv.year, vv.make, vv.model].filter(Boolean).join(" ") ||
    String(vv.id)
  );
}

export default function Vehicles() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: vehicles, isLoading } = useListVehicles();
  const { data: customers } = useListCustomers();
  const { data: occupants } = useListOccupants();
  const { data: properties } = useListProperties();
  const { data: riders } = useListVehicleRiders();
  const { data: insurance } = useListVehicleInsurance();
  const { data: allFuel } = useListVehicleFuelCharges();
  const { data: allMaint } = useListVehicleMaintenance();

  const createMutation = useCreateVehicle();
  const updateMutation = useUpdateVehicle();
  const deleteMutation = useDeleteVehicle();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<VehicleForm>(EMPTY_FORM);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [ridersVehicleId, setRidersVehicleId] = useState<string | null>(null);
  const [fuelVehicleId, setFuelVehicleId] = useState<string | null>(null);
  const [maintVehicleId, setMaintVehicleId] = useState<string | null>(null);
  const [insVehicleId, setInsVehicleId] = useState<string | null>(null);

  // vehicleId -> number of associates on its static roster.
  const riderCountByVehicle = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of riders ?? []) {
      map.set(r.vehicleId, (map.get(r.vehicleId) ?? 0) + 1);
    }
    return map;
  }, [riders]);

  // At-a-glance attention buckets surfaced above the table.
  const attention = useMemo(() => {
    const idleOffBase: string[] = [];
    const regSoon: string[] = [];
    const inShop: string[] = [];
    const insSoon: string[] = [];
    const labelById = new Map<string, string>();
    for (const v of vehicles ?? []) {
      const vv = v as Record<string, unknown>;
      const label = vehicleLabelOf(vv);
      labelById.set(String(vv.id), label);
      const loc = String(vv.currentLocationNote ?? "").trim();
      // Available van parked somewhere noted = not in use for a client and
      // sitting off-base. Goal is to bring it back to WI.
      if (String(vv.status) === "Available" && loc !== "") {
        idleOffBase.push(`${label} — ${loc}`);
      }
      if (String(vv.status) === "In shop") inShop.push(label);
      const dd = daysUntilYMD(String(vv.registrationExpires ?? ""));
      if (dd !== null && dd <= 45) {
        regSoon.push(
          `${label} ${dd < 0 ? `(expired ${-dd}d ago)` : `(in ${dd}d)`}`,
        );
      }
    }
    for (const p of insurance ?? []) {
      const dd = daysUntilYMD(String(p.expiryDate ?? ""));
      if (dd !== null && dd <= 45) {
        const label = labelById.get(p.vehicleId) ?? p.vehicleId;
        insSoon.push(
          `${label} ${dd < 0 ? `(expired ${-dd}d ago)` : `(in ${dd}d)`}`,
        );
      }
    }
    return { idleOffBase, regSoon, inShop, insSoon };
  }, [vehicles, insurance]);
  const hasAttention =
    attention.idleOffBase.length > 0 ||
    attention.regSoon.length > 0 ||
    attention.inShop.length > 0 ||
    attention.insSoon.length > 0;

  // Fleet cost rollup: recurring monthly (lease/own) across the fleet,
  // plus all fuel and maintenance logged to date.
  const fleetCost = useMemo(() => {
    const monthly = (vehicles ?? []).reduce(
      (s, v) => s + Number((v as Record<string, unknown>).monthlyCost ?? 0),
      0,
    );
    const fuel = (allFuel ?? []).reduce((s, c) => s + Number(c.amount ?? 0), 0);
    const maint = (allMaint ?? []).reduce((s, m) => s + Number(m.cost ?? 0), 0);
    return { monthly, fuel, maint };
  }, [vehicles, allFuel, allMaint]);
  // vehicleId -> total fuel logged, for the per-row cost hint.
  const fuelByVehicle = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of allFuel ?? []) {
      map.set(c.vehicleId, (map.get(c.vehicleId) ?? 0) + Number(c.amount ?? 0));
    }
    return map;
  }, [allFuel]);

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

  const handleExport = () => {
    const data = vehicles ?? [];
    const cell = (vv: Record<string, unknown>, k: string) =>
      vv[k] == null ? "" : String(vv[k]);
    const csv = toCsv(
      data.map((v) => v as Record<string, unknown>),
      [
        { header: "Unit", value: (v) => cell(v, "merchantUnit") },
        { header: "Year", value: (v) => cell(v, "year") },
        { header: "Make", value: (v) => cell(v, "make") },
        { header: "Model", value: (v) => cell(v, "model") },
        { header: "VIN", value: (v) => cell(v, "vin") },
        { header: "Plate", value: (v) => cell(v, "plate") },
        { header: "Plate State", value: (v) => cell(v, "plateState") },
        { header: "Seats", value: (v) => cell(v, "seats") },
        { header: "Ownership", value: (v) => cell(v, "ownership") },
        { header: "Monthly Cost", value: (v) => Number(v.monthlyCost ?? 0) },
        { header: "Book Value", value: (v) => Number(v.bookValue ?? 0) },
        { header: "Status", value: (v) => cell(v, "status") },
        {
          header: "Client",
          value: (v) =>
            v.customerId
              ? customerName.get(String(v.customerId)) ?? String(v.customerId)
              : "",
        },
        {
          header: "Driver",
          value: (v) =>
            v.driverOccupantId
              ? occupantName.get(String(v.driverOccupantId)) ??
                String(v.driverOccupantId)
              : "",
        },
        {
          header: "Riders",
          value: (v) => riderCountByVehicle.get(String(v.id)) ?? 0,
        },
        { header: "Home Base", value: (v) => cell(v, "homeBaseState") },
        { header: "Current Location", value: (v) => cell(v, "currentLocationNote") },
        { header: "Registration Expires", value: (v) => cell(v, "registrationExpires") },
      ],
    );
    downloadCsv(timestampedCsvName("housingops-vehicles"), csv);
  };

  const saving = createMutation.isPending || updateMutation.isPending;
  const rows = vehicles ?? [];

  return (
    <MainLayout>
      <PageHeader
        title="Vehicles"
        description="KFI transportation fleet — vans, their driver, the client they serve, and where they are."
      />

      {hasAttention && (
        <div className="grid gap-3 sm:grid-cols-3 mb-4" data-testid="vehicle-attention">
          {attention.idleOffBase.length > 0 && (
            <AttentionCard
              tone="amber"
              icon={<AlertTriangle className="h-4 w-4" />}
              title={`${attention.idleOffBase.length} available, off-base`}
              items={attention.idleOffBase}
              footer="Goal: return to WI."
            />
          )}
          {attention.regSoon.length > 0 && (
            <AttentionCard
              tone="red"
              icon={<AlertTriangle className="h-4 w-4" />}
              title={`${attention.regSoon.length} registration${attention.regSoon.length === 1 ? "" : "s"} due`}
              items={attention.regSoon}
              footer="Renew before the plate expires."
            />
          )}
          {attention.insSoon.length > 0 && (
            <AttentionCard
              tone="red"
              icon={<ShieldCheck className="h-4 w-4" />}
              title={`${attention.insSoon.length} insurance policy${attention.insSoon.length === 1 ? "" : " policies"} due`}
              items={attention.insSoon}
              footer="Renew before coverage lapses."
            />
          )}
          {attention.inShop.length > 0 && (
            <AttentionCard
              tone="slate"
              icon={<Wrench className="h-4 w-4" />}
              title={`${attention.inShop.length} in the shop`}
              items={attention.inShop}
            />
          )}
        </div>
      )}

      <div className="flex justify-end gap-2 mb-4">
        <Button
          variant="outline"
          onClick={handleExport}
          disabled={rows.length === 0}
          data-testid="vehicle-export-btn"
        >
          <Download className="h-4 w-4" />
          <span className="ml-1">Export CSV</span>
        </Button>
        <Button onClick={openAdd} data-testid="vehicle-add-btn">
          <Plus className="h-4 w-4" />
          <span className="ml-1">Add vehicle</span>
        </Button>
      </div>

      {rows.length > 0 && (
        <div
          className="grid grid-cols-3 gap-3 mb-4"
          data-testid="vehicle-cost-summary"
        >
          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">
                Monthly lease/rent
              </div>
              <div className="text-lg font-semibold tabular-nums">
                ${fleetCost.monthly.toLocaleString()}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">
                Fuel logged
              </div>
              <div className="text-lg font-semibold tabular-nums">
                ${fleetCost.fuel.toLocaleString()}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">
                Maintenance logged
              </div>
              <div className="text-lg font-semibold tabular-nums">
                ${fleetCost.maint.toLocaleString()}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

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
                  const rosterCount = riderCountByVehicle.get(id) ?? 0;
                  // Prefer the live roster count; fall back to the manual
                  // quick-capture figure when no riders have been assigned.
                  const riderCount =
                    rosterCount > 0
                      ? rosterCount
                      : Number(vv.associatesTransported ?? 0);
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
                        <button
                          type="button"
                          onClick={() => setRidersVehicleId(id)}
                          className="hover:underline"
                          data-testid="vehicle-riders-count"
                          title="Manage riders"
                        >
                          {riderCount}
                          {seats ? (
                            <span className="text-muted-foreground">
                              /{seats}
                            </span>
                          ) : null}
                        </button>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {Number(vv.monthlyCost ?? 0) > 0
                          ? `$${Number(vv.monthlyCost).toLocaleString()}`
                          : "—"}
                        {(fuelByVehicle.get(id) ?? 0) > 0 && (
                          <div className="text-[11px] text-muted-foreground">
                            ⛽ ${Number(fuelByVehicle.get(id)).toLocaleString()}
                          </div>
                        )}
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
                          onClick={() => setInsVehicleId(id)}
                          data-testid="vehicle-ins-btn"
                          title="Insurance"
                        >
                          <ShieldCheck className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setMaintVehicleId(id)}
                          data-testid="vehicle-maint-btn"
                          title="Maintenance / repairs"
                        >
                          <Wrench className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setFuelVehicleId(id)}
                          data-testid="vehicle-fuel-btn"
                          title="Fuel charges"
                        >
                          <Fuel className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setRidersVehicleId(id)}
                          data-testid="vehicle-riders-btn"
                          title="Manage riders"
                        >
                          <Users className="h-4 w-4" />
                        </Button>
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

      {ridersVehicleId && (
        <RidersDialog
          vehicleId={ridersVehicleId}
          label={(() => {
            const v = rows.find(
              (r) => String((r as Record<string, unknown>).id) === ridersVehicleId,
            ) as Record<string, unknown> | undefined;
            if (!v) return "vehicle";
            return (
              String(v.merchantUnit || "") ||
              [v.year, v.make, v.model].filter(Boolean).join(" ") ||
              "vehicle"
            );
          })()}
          occupants={occupants ?? []}
          onClose={() => setRidersVehicleId(null)}
        />
      )}

      {fuelVehicleId && (
        <FuelDialog
          vehicleId={fuelVehicleId}
          label={(() => {
            const v = rows.find(
              (r) => String((r as Record<string, unknown>).id) === fuelVehicleId,
            ) as Record<string, unknown> | undefined;
            if (!v) return "vehicle";
            return (
              String(v.merchantUnit || "") ||
              [v.year, v.make, v.model].filter(Boolean).join(" ") ||
              "vehicle"
            );
          })()}
          onClose={() => setFuelVehicleId(null)}
        />
      )}

      {maintVehicleId && (
        <MaintenanceDialog
          vehicleId={maintVehicleId}
          label={(() => {
            const v = rows.find(
              (r) =>
                String((r as Record<string, unknown>).id) === maintVehicleId,
            ) as Record<string, unknown> | undefined;
            if (!v) return "vehicle";
            return (
              String(v.merchantUnit || "") ||
              [v.year, v.make, v.model].filter(Boolean).join(" ") ||
              "vehicle"
            );
          })()}
          onClose={() => setMaintVehicleId(null)}
        />
      )}

      {insVehicleId && (
        <InsuranceDialog
          vehicleId={insVehicleId}
          label={(() => {
            const v = rows.find(
              (r) => String((r as Record<string, unknown>).id) === insVehicleId,
            ) as Record<string, unknown> | undefined;
            return v ? vehicleLabelOf(v) : "vehicle";
          })()}
          onClose={() => setInsVehicleId(null)}
        />
      )}
    </MainLayout>
  );
}

interface OccupantLite {
  id: string;
  name?: string;
  kfisAuthorizedToDrive?: boolean | null;
}

function RidersDialog({
  vehicleId,
  label,
  occupants,
  onClose,
}: {
  vehicleId: string;
  label: string;
  occupants: OccupantLite[];
  onClose: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: allRiders } = useListVehicleRiders();
  const { data: allOverrides } = useListVehicleRideOverrides();
  const createRider = useCreateVehicleRider();
  const deleteRider = useDeleteVehicleRider();
  const createOverride = useCreateVehicleRideOverride();
  const deleteOverride = useDeleteVehicleRideOverride();
  const [addId, setAddId] = useState<string>(NONE);
  const [dayAddId, setDayAddId] = useState<string>(NONE);
  const [date, setDate] = useState<string>(todayYMD());

  const invalidateRiders = () =>
    queryClient.invalidateQueries({ queryKey: getListVehicleRidersQueryKey() });
  const invalidateOverrides = () =>
    queryClient.invalidateQueries({
      queryKey: getListVehicleRideOverridesQueryKey(),
    });

  const roster = useMemo(
    () => (allRiders ?? []).filter((r) => r.vehicleId === vehicleId),
    [allRiders, vehicleId],
  );
  const rosterOccupantIds = useMemo(
    () => new Set(roster.map((r) => r.occupantId)),
    [roster],
  );

  const occName = useMemo(() => {
    const map = new Map<string, string>();
    for (const o of occupants) map.set(o.id, o.name || o.id);
    return map;
  }, [occupants]);

  // Occupants not already on this roster, authorised drivers first.
  const available = useMemo(
    () =>
      occupants
        .filter((o) => !rosterOccupantIds.has(o.id))
        .sort((a, b) => {
          const ad = a.kfisAuthorizedToDrive ? 0 : 1;
          const bd = b.kfisAuthorizedToDrive ? 0 : 1;
          if (ad !== bd) return ad - bd;
          return (a.name || "").localeCompare(b.name || "");
        }),
    [occupants, rosterOccupantIds],
  );

  // --- Daily overrides for the selected date ---
  const removeOverrideByOcc = useMemo(() => {
    const m = new Map<string, { id: string }>();
    for (const o of allOverrides ?? []) {
      if (o.vehicleId === vehicleId && o.date === date && o.action === "remove")
        m.set(o.occupantId, { id: o.id });
    }
    return m;
  }, [allOverrides, vehicleId, date]);
  const addOverrideByOcc = useMemo(() => {
    const m = new Map<string, { id: string }>();
    for (const o of allOverrides ?? []) {
      if (o.vehicleId === vehicleId && o.date === date && o.action === "add")
        m.set(o.occupantId, { id: o.id });
    }
    return m;
  }, [allOverrides, vehicleId, date]);

  // Effective roster for the date: static riders not removed today, plus
  // anyone explicitly added for today.
  const ridingToday = useMemo(() => {
    const ids: string[] = [];
    for (const r of roster)
      if (!removeOverrideByOcc.has(r.occupantId)) ids.push(r.occupantId);
    for (const id of addOverrideByOcc.keys())
      if (!ids.includes(id)) ids.push(id);
    return ids;
  }, [roster, removeOverrideByOcc, addOverrideByOcc]);
  const removedToday = useMemo(
    () => roster.filter((r) => removeOverrideByOcc.has(r.occupantId)),
    [roster, removeOverrideByOcc],
  );
  const dayAvailable = useMemo(() => {
    const taken = new Set(ridingToday);
    return occupants
      .filter((o) => !taken.has(o.id))
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [occupants, ridingToday]);

  const handleAdd = () => {
    if (addId === NONE || !addId) return;
    createRider.mutate(
      { data: { vehicleId, occupantId: addId } },
      {
        onSuccess: () => {
          invalidateRiders();
          setAddId(NONE);
        },
        onError: () =>
          toast({ title: "Failed to add rider", variant: "destructive" }),
      },
    );
  };

  const handleRemove = (riderId: string) => {
    deleteRider.mutate(
      { id: riderId },
      {
        onSuccess: invalidateRiders,
        onError: () =>
          toast({ title: "Failed to remove rider", variant: "destructive" }),
      },
    );
  };

  const recordOverride = (occupantId: string, action: "add" | "remove") => {
    createOverride.mutate(
      { data: { vehicleId, occupantId, date, action } },
      {
        onSuccess: () => {
          invalidateOverrides();
          setDayAddId(NONE);
        },
        onError: () =>
          toast({ title: "Failed to update day", variant: "destructive" }),
      },
    );
  };

  const clearOverride = (overrideId: string) => {
    deleteOverride.mutate(
      { id: overrideId },
      {
        onSuccess: invalidateOverrides,
        onError: () =>
          toast({ title: "Failed to update day", variant: "destructive" }),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Riders — {label}</DialogTitle>
          <DialogDescription>
            The default roster is who this van normally transports. Use “By
            day” to record one-off exceptions.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="default" className="w-full">
          <TabsList>
            <TabsTrigger value="default" data-testid="riders-tab-default">
              Default roster
            </TabsTrigger>
            <TabsTrigger value="byday" data-testid="riders-tab-byday">
              By day
            </TabsTrigger>
          </TabsList>

          <TabsContent value="default" className="mt-4">
            <div className="flex gap-2 py-1">
              <Select value={addId} onValueChange={setAddId}>
                <SelectTrigger data-testid="rider-add-select">
                  <SelectValue placeholder="Add an associate…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE} disabled>
                    Add an associate…
                  </SelectItem>
                  {available.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.name || o.id}
                      {o.kfisAuthorizedToDrive ? " (driver)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                onClick={handleAdd}
                disabled={addId === NONE || createRider.isPending}
                data-testid="rider-add-btn"
              >
                {createRider.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
              </Button>
            </div>

            {roster.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                No riders assigned yet.
              </div>
            ) : (
              <div className="mt-2 divide-y rounded-md border">
                {roster.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between px-3 py-2"
                    data-testid="rider-row"
                  >
                    <span className="text-sm">
                      {occName.get(r.occupantId) ?? r.occupantId}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemove(r.id)}
                      data-testid="rider-remove-btn"
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="byday" className="mt-4 space-y-3">
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">Date</Label>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-44"
                data-testid="riders-day-date"
              />
            </div>

            <div className="flex gap-2">
              <Select value={dayAddId} onValueChange={setDayAddId}>
                <SelectTrigger data-testid="day-add-select">
                  <SelectValue placeholder="Add someone for this day…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE} disabled>
                    Add someone for this day…
                  </SelectItem>
                  {dayAvailable.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.name || o.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                onClick={() =>
                  dayAddId !== NONE && recordOverride(dayAddId, "add")
                }
                disabled={dayAddId === NONE || createOverride.isPending}
                data-testid="day-add-btn"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">
                Riding on {date} ({ridingToday.length})
              </p>
              {ridingToday.length === 0 ? (
                <div className="py-4 text-center text-sm text-muted-foreground">
                  No one riding this day.
                </div>
              ) : (
                <div className="divide-y rounded-md border">
                  {ridingToday.map((occId) => {
                    const added = addOverrideByOcc.get(occId);
                    return (
                      <div
                        key={occId}
                        className="flex items-center justify-between px-3 py-2"
                        data-testid="day-rider-row"
                      >
                        <span className="text-sm">
                          {occName.get(occId) ?? occId}
                          {added ? (
                            <span className="ml-2 text-xs text-muted-foreground">
                              (added for today)
                            </span>
                          ) : null}
                        </span>
                        {added ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => clearOverride(added.id)}
                          >
                            Remove
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => recordOverride(occId, "remove")}
                          >
                            Not riding
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {removedToday.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">
                  Off the van today
                </p>
                <div className="divide-y rounded-md border">
                  {removedToday.map((r) => {
                    const ov = removeOverrideByOcc.get(r.occupantId);
                    return (
                      <div
                        key={r.id}
                        className="flex items-center justify-between px-3 py-2"
                      >
                        <span className="text-sm text-muted-foreground line-through">
                          {occName.get(r.occupantId) ?? r.occupantId}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => ov && clearOverride(ov.id)}
                        >
                          Restore
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const MAINT_TYPES = ["Repair", "Service", "Inspection", "Other"] as const;
const MAINT_STATUSES = ["Needed", "In shop", "Completed"] as const;

function maintStatusVariant(
  status: string,
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "Completed":
      return "secondary";
    case "In shop":
      return "destructive";
    case "Needed":
      return "default";
    default:
      return "outline";
  }
}

function MaintenanceDialog({
  vehicleId,
  label,
  onClose,
}: {
  vehicleId: string;
  label: string;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: allRecords } = useListVehicleMaintenance();
  const createRec = useCreateVehicleMaintenance();
  const updateRec = useUpdateVehicleMaintenance();
  const deleteRec = useDeleteVehicleMaintenance();

  const [date, setDate] = useState<string>(todayYMD());
  const [type, setType] = useState<(typeof MAINT_TYPES)[number]>("Repair");
  const [description, setDescription] = useState("");
  const [cost, setCost] = useState("");
  const [status, setStatus] =
    useState<(typeof MAINT_STATUSES)[number]>("Needed");
  const [shopName, setShopName] = useState("");

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: getListVehicleMaintenanceQueryKey(),
    });

  const records = useMemo(
    () =>
      (allRecords ?? [])
        .filter((r) => r.vehicleId === vehicleId)
        .sort((a, b) => (b.date || "").localeCompare(a.date || "")),
    [allRecords, vehicleId],
  );

  const handleAdd = () => {
    if (description.trim() === "") return;
    createRec.mutate(
      {
        data: {
          vehicleId,
          date,
          type,
          description: description.trim(),
          cost: cost.trim() === "" ? 0 : num(cost),
          status,
          shopName: shopName.trim(),
        },
      },
      {
        onSuccess: () => {
          invalidate();
          setDescription("");
          setCost("");
          setShopName("");
        },
        onError: () =>
          toast({ title: "Failed to add record", variant: "destructive" }),
      },
    );
  };

  const changeStatus = (id: string, next: string) => {
    updateRec.mutate(
      {
        id,
        data: {
          status: next,
          completedDate: next === "Completed" ? todayYMD() : "",
        },
      },
      {
        onSuccess: invalidate,
        onError: () =>
          toast({ title: "Failed to update record", variant: "destructive" }),
      },
    );
  };

  const handleDelete = (id: string) => {
    deleteRec.mutate(
      { id },
      {
        onSuccess: invalidate,
        onError: () =>
          toast({ title: "Failed to delete record", variant: "destructive" }),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Maintenance — {label}</DialogTitle>
          <DialogDescription>
            Repairs, service, and inspections for this van.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-12 gap-2 items-end py-2">
          <div className="col-span-3">
            <Label className="text-xs text-muted-foreground">Date</Label>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="col-span-3">
            <Label className="text-xs text-muted-foreground">Type</Label>
            <Select
              value={type}
              onValueChange={(v) =>
                setType(v as (typeof MAINT_TYPES)[number])
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MAINT_TYPES.map((tp) => (
                  <SelectItem key={tp} value={tp}>
                    {tp}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-3">
            <Label className="text-xs text-muted-foreground">Status</Label>
            <Select
              value={status}
              onValueChange={(v) =>
                setStatus(v as (typeof MAINT_STATUSES)[number])
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MAINT_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-3">
            <Label className="text-xs text-muted-foreground">Cost $</Label>
            <Input
              inputMode="decimal"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
            />
          </div>
          <div className="col-span-8">
            <Label className="text-xs text-muted-foreground">Description</Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              data-testid="maint-description"
            />
          </div>
          <div className="col-span-4">
            <Label className="text-xs text-muted-foreground">Shop</Label>
            <Input
              value={shopName}
              onChange={(e) => setShopName(e.target.value)}
            />
          </div>
        </div>
        <div className="flex justify-end">
          <Button
            onClick={handleAdd}
            disabled={description.trim() === "" || createRec.isPending}
            data-testid="maint-add-btn"
          >
            {createRec.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            <span className="ml-1">Add record</span>
          </Button>
        </div>

        {records.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            No maintenance records yet.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map((r) => (
                <TableRow key={r.id} data-testid="maint-row">
                  <TableCell>{r.date || "—"}</TableCell>
                  <TableCell>{r.type}</TableCell>
                  <TableCell className="max-w-[16rem] truncate">
                    {r.description || "—"}
                    {r.shopName ? (
                      <span className="text-muted-foreground"> · {r.shopName}</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {Number(r.cost ?? 0) > 0
                      ? `$${Number(r.cost).toLocaleString()}`
                      : "—"}
                  </TableCell>
                  <TableCell>
                    <Select
                      value={r.status}
                      onValueChange={(v) => changeStatus(r.id, v)}
                    >
                      <SelectTrigger className="h-7 w-32">
                        <Badge
                          variant={maintStatusVariant(r.status)}
                          className="text-[10px] px-1.5 py-0"
                        >
                          {r.status}
                        </Badge>
                      </SelectTrigger>
                      <SelectContent>
                        {MAINT_STATUSES.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDelete(r.id)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InsuranceDialog({
  vehicleId,
  label,
  onClose,
}: {
  vehicleId: string;
  label: string;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: allPolicies } = useListVehicleInsurance();
  const createPolicy = useCreateVehicleInsurance();
  const deletePolicy = useDeleteVehicleInsurance();

  const [carrier, setCarrier] = useState("");
  const [policyNumber, setPolicyNumber] = useState("");
  const [coverage, setCoverage] = useState("");
  const [premium, setPremium] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: getListVehicleInsuranceQueryKey(),
    });

  const policies = useMemo(
    () => (allPolicies ?? []).filter((p) => p.vehicleId === vehicleId),
    [allPolicies, vehicleId],
  );

  const handleAdd = () => {
    if (carrier.trim() === "" && policyNumber.trim() === "") return;
    createPolicy.mutate(
      {
        data: {
          vehicleId,
          carrier: carrier.trim(),
          policyNumber: policyNumber.trim(),
          coverage: coverage.trim(),
          premium: premium.trim() === "" ? 0 : num(premium),
          effectiveDate,
          expiryDate,
        },
      },
      {
        onSuccess: () => {
          invalidate();
          setCarrier("");
          setPolicyNumber("");
          setCoverage("");
          setPremium("");
          setEffectiveDate("");
          setExpiryDate("");
        },
        onError: () =>
          toast({ title: "Failed to add policy", variant: "destructive" }),
      },
    );
  };

  const handleDelete = (id: string) => {
    deletePolicy.mutate(
      { id },
      {
        onSuccess: invalidate,
        onError: () =>
          toast({ title: "Failed to delete policy", variant: "destructive" }),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Insurance — {label}</DialogTitle>
          <DialogDescription>
            Commercial-auto policies for this van.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-12 gap-2 items-end py-2">
          <div className="col-span-4">
            <Label className="text-xs text-muted-foreground">Carrier</Label>
            <Input
              value={carrier}
              onChange={(e) => setCarrier(e.target.value)}
              data-testid="ins-carrier"
            />
          </div>
          <div className="col-span-4">
            <Label className="text-xs text-muted-foreground">Policy #</Label>
            <Input
              value={policyNumber}
              onChange={(e) => setPolicyNumber(e.target.value)}
            />
          </div>
          <div className="col-span-4">
            <Label className="text-xs text-muted-foreground">Premium $</Label>
            <Input
              inputMode="decimal"
              value={premium}
              onChange={(e) => setPremium(e.target.value)}
            />
          </div>
          <div className="col-span-4">
            <Label className="text-xs text-muted-foreground">Coverage</Label>
            <Input
              value={coverage}
              onChange={(e) => setCoverage(e.target.value)}
            />
          </div>
          <div className="col-span-4">
            <Label className="text-xs text-muted-foreground">Effective</Label>
            <Input
              type="date"
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
            />
          </div>
          <div className="col-span-4">
            <Label className="text-xs text-muted-foreground">Expires</Label>
            <Input
              type="date"
              value={expiryDate}
              onChange={(e) => setExpiryDate(e.target.value)}
            />
          </div>
        </div>
        <div className="flex justify-end">
          <Button
            onClick={handleAdd}
            disabled={
              (carrier.trim() === "" && policyNumber.trim() === "") ||
              createPolicy.isPending
            }
            data-testid="ins-add-btn"
          >
            {createPolicy.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            <span className="ml-1">Add policy</span>
          </Button>
        </div>

        {policies.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            No insurance policies recorded yet.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Carrier</TableHead>
                <TableHead>Policy #</TableHead>
                <TableHead>Coverage</TableHead>
                <TableHead className="text-right">Premium</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {policies.map((p) => {
                const dd = daysUntilYMD(String(p.expiryDate ?? ""));
                return (
                  <TableRow key={p.id} data-testid="ins-row">
                    <TableCell>{p.carrier || "—"}</TableCell>
                    <TableCell>{p.policyNumber || "—"}</TableCell>
                    <TableCell className="max-w-[12rem] truncate">
                      {p.coverage || "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {Number(p.premium ?? 0) > 0
                        ? `$${Number(p.premium).toLocaleString()}`
                        : "—"}
                    </TableCell>
                    <TableCell>
                      {p.expiryDate || "—"}
                      {dd !== null && dd <= 45 && (
                        <Badge
                          variant={dd < 0 ? "destructive" : "secondary"}
                          className="ml-2 text-[10px] px-1.5 py-0"
                        >
                          {dd < 0 ? "expired" : `${dd}d`}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(p.id)}
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

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FuelDialog({
  vehicleId,
  label,
  onClose,
}: {
  vehicleId: string;
  label: string;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: allCharges } = useListVehicleFuelCharges();
  const createCharge = useCreateVehicleFuelCharge();
  const deleteCharge = useDeleteVehicleFuelCharge();

  const [date, setDate] = useState<string>(todayYMD());
  const [amount, setAmount] = useState("");
  const [gallons, setGallons] = useState("");
  const [merchant, setMerchant] = useState("");
  const [cardLast4, setCardLast4] = useState("");

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: getListVehicleFuelChargesQueryKey(),
    });

  const charges = useMemo(
    () =>
      (allCharges ?? [])
        .filter((c) => c.vehicleId === vehicleId)
        .sort((a, b) => (b.date || "").localeCompare(a.date || "")),
    [allCharges, vehicleId],
  );
  const total = useMemo(
    () => charges.reduce((sum, c) => sum + Number(c.amount ?? 0), 0),
    [charges],
  );

  const handleAdd = () => {
    if (amount.trim() === "") return;
    createCharge.mutate(
      {
        data: {
          vehicleId,
          date,
          amount: num(amount),
          gallons: gallons.trim() === "" ? 0 : num(gallons),
          merchant: merchant.trim(),
          cardLast4: cardLast4.trim(),
        },
      },
      {
        onSuccess: () => {
          invalidate();
          setAmount("");
          setGallons("");
          setMerchant("");
        },
        onError: () =>
          toast({ title: "Failed to add charge", variant: "destructive" }),
      },
    );
  };

  const handleDelete = (id: string) => {
    deleteCharge.mutate(
      { id },
      {
        onSuccess: invalidate,
        onError: () =>
          toast({ title: "Failed to delete charge", variant: "destructive" }),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Fuel charges — {label}</DialogTitle>
          <DialogDescription>
            Itemized gas-card purchases for this van.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-12 gap-2 items-end py-2">
          <div className="col-span-3">
            <Label className="text-xs text-muted-foreground">Date</Label>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="col-span-2">
            <Label className="text-xs text-muted-foreground">Amount $</Label>
            <Input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              data-testid="fuel-amount"
            />
          </div>
          <div className="col-span-2">
            <Label className="text-xs text-muted-foreground">Gallons</Label>
            <Input
              inputMode="decimal"
              value={gallons}
              onChange={(e) => setGallons(e.target.value)}
            />
          </div>
          <div className="col-span-3">
            <Label className="text-xs text-muted-foreground">Merchant</Label>
            <Input
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
            />
          </div>
          <div className="col-span-2">
            <Label className="text-xs text-muted-foreground">Card ••</Label>
            <Input
              value={cardLast4}
              onChange={(e) => setCardLast4(e.target.value)}
              maxLength={4}
            />
          </div>
        </div>
        <div className="flex justify-end">
          <Button
            onClick={handleAdd}
            disabled={amount.trim() === "" || createCharge.isPending}
            data-testid="fuel-add-btn"
          >
            {createCharge.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            <span className="ml-1">Add charge</span>
          </Button>
        </div>

        {charges.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            No fuel charges recorded yet.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Gallons</TableHead>
                <TableHead>Merchant</TableHead>
                <TableHead>Card</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {charges.map((c) => (
                <TableRow key={c.id} data-testid="fuel-row">
                  <TableCell>{c.date || "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    ${Number(c.amount ?? 0).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {Number(c.gallons ?? 0) > 0 ? Number(c.gallons) : "—"}
                  </TableCell>
                  <TableCell>{c.merchant || "—"}</TableCell>
                  <TableCell>{c.cardLast4 ? `••${c.cardLast4}` : "—"}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDelete(c.id)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell className="font-medium">Total</TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  ${total.toLocaleString()}
                </TableCell>
                <TableCell colSpan={4} />
              </TableRow>
            </TableBody>
          </Table>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AttentionCard({
  tone,
  icon,
  title,
  items,
  footer,
}: {
  tone: "amber" | "red" | "slate";
  icon: ReactNode;
  title: string;
  items: string[];
  footer?: string;
}) {
  const toneClasses: Record<"amber" | "red" | "slate", string> = {
    amber: "border-amber-300 bg-amber-50 text-amber-800",
    red: "border-red-300 bg-red-50 text-red-800",
    slate: "border-slate-300 bg-slate-50 text-slate-700",
  };
  return (
    <Card className={toneClasses[tone]}>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          {icon}
          {title}
        </div>
        <ul className="mt-2 space-y-0.5 text-xs">
          {items.slice(0, 5).map((s, i) => (
            <li key={i} className="truncate">
              {s}
            </li>
          ))}
          {items.length > 5 && (
            <li className="opacity-70">+{items.length - 5} more</li>
          )}
        </ul>
        {footer && <p className="mt-2 text-[11px] opacity-70">{footer}</p>}
      </CardContent>
    </Card>
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
