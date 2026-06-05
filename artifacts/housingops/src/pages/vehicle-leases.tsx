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
  useListVehicleLeases,
  useCreateVehicleLease,
  useUpdateVehicleLease,
  useDeleteVehicleLease,
  getListVehicleLeasesQueryKey,
  useListVehicles,
} from "@workspace/api-client-react";
import { FileText, Plus, Pencil, Trash2, Loader2 } from "lucide-react";

const NONE = "__none__";
const STATUSES = ["Active", "Expired", "Upcoming"] as const;
type LeaseStatus = (typeof STATUSES)[number];

interface LeaseForm {
  vehicleId: string;
  lessor: string;
  startDate: string;
  endDate: string;
  monthlyCost: string;
  deposit: string;
  buyoutCost: string;
  deductions: string;
  status: LeaseStatus;
  note: string;
}

const EMPTY_FORM: LeaseForm = {
  vehicleId: "",
  lessor: "",
  startDate: "",
  endDate: "",
  monthlyCost: "",
  deposit: "",
  buyoutCost: "",
  deductions: "",
  status: "Active",
  note: "",
};

function num(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function statusVariant(
  status: string,
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "Active":
      return "default";
    case "Upcoming":
      return "secondary";
    case "Expired":
      return "outline";
    default:
      return "outline";
  }
}

export default function VehicleLeases() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: leases, isLoading } = useListVehicleLeases();
  const { data: vehicles } = useListVehicles();
  const createMutation = useCreateVehicleLease();
  const updateMutation = useUpdateVehicleLease();
  const deleteMutation = useDeleteVehicleLease();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<LeaseForm>(EMPTY_FORM);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const vehicleLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const v of vehicles ?? []) {
      const vv = v as Record<string, unknown>;
      map.set(
        String(vv.id),
        String(vv.merchantUnit || "") ||
          [vv.year, vv.make, vv.model].filter(Boolean).join(" ") ||
          String(vv.id),
      );
    }
    return map;
  }, [vehicles]);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListVehicleLeasesQueryKey() });

  const openAdd = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (l: Record<string, unknown>) => {
    setEditingId(String(l.id));
    setForm({
      vehicleId: String(l.vehicleId ?? ""),
      lessor: String(l.lessor ?? ""),
      startDate: String(l.startDate ?? ""),
      endDate: String(l.endDate ?? ""),
      monthlyCost: l.monthlyCost == null ? "" : String(l.monthlyCost),
      deposit: l.deposit == null ? "" : String(l.deposit),
      buyoutCost: l.buyoutCost == null ? "" : String(l.buyoutCost),
      deductions: String(l.deductions ?? ""),
      status: (STATUSES as readonly string[]).includes(String(l.status))
        ? (l.status as LeaseStatus)
        : "Active",
      note: String(l.note ?? ""),
    });
    setDialogOpen(true);
  };

  const buildPayload = () => ({
    vehicleId: form.vehicleId,
    lessor: form.lessor.trim(),
    startDate: form.startDate,
    endDate: form.endDate,
    monthlyCost: num(form.monthlyCost),
    deposit: num(form.deposit),
    buyoutCost: num(form.buyoutCost),
    deductions: form.deductions.trim(),
    status: form.status,
    note: form.note.trim(),
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
            toast({ title: "Lease updated" });
          },
          onError: () =>
            toast({ title: "Failed to update lease", variant: "destructive" }),
        },
      );
    } else {
      createMutation.mutate(
        { data: { id: `vlease-${Date.now()}`, ...payload } },
        {
          onSuccess: () => {
            invalidate();
            setDialogOpen(false);
            toast({ title: "Lease added" });
          },
          onError: () =>
            toast({ title: "Failed to add lease", variant: "destructive" }),
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
          toast({ title: "Lease removed" });
          setDeletingId(null);
        },
        onError: () => {
          toast({ title: "Failed to remove lease", variant: "destructive" });
          setDeletingId(null);
        },
      },
    );
  };

  const saving = createMutation.isPending || updateMutation.isPending;
  const rows = leases ?? [];

  return (
    <MainLayout>
      <PageHeader
        title="Vehicle Leases"
        description="Lease and rental agreements for the fleet — lessor, term, cost, and deductions."
      />

      <div className="flex justify-end mb-4">
        <Button onClick={openAdd} data-testid="vlease-add-btn">
          <Plus className="h-4 w-4" />
          <span className="ml-1">Add lease</span>
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Loading leases…
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
              <FileText className="h-8 w-8 mb-2 opacity-60" />
              <p className="text-sm">No vehicle leases yet.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vehicle</TableHead>
                  <TableHead>Lessor</TableHead>
                  <TableHead>Term</TableHead>
                  <TableHead className="text-right">Monthly</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-24 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((l) => {
                  const ll = l as Record<string, unknown>;
                  const id = String(ll.id);
                  return (
                    <TableRow key={id} data-testid="vlease-row">
                      <TableCell className="font-medium">
                        {ll.vehicleId
                          ? vehicleLabel.get(String(ll.vehicleId)) ??
                            String(ll.vehicleId)
                          : "—"}
                      </TableCell>
                      <TableCell>{String(ll.lessor || "—")}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {String(ll.startDate || "?")} – {String(ll.endDate || "?")}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {Number(ll.monthlyCost ?? 0) > 0
                          ? `$${Number(ll.monthlyCost).toLocaleString()}`
                          : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(String(ll.status))}>
                          {String(ll.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEdit(ll)}
                          data-testid="vlease-edit-btn"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeletingId(id)}
                          data-testid="vlease-delete-btn"
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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit lease" : "Add lease"}</DialogTitle>
            <DialogDescription>
              Lease / rental agreement details for a vehicle.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-4 py-2">
            <Field label="Vehicle">
              <Select
                value={form.vehicleId === "" ? NONE : form.vehicleId}
                onValueChange={(val) =>
                  setForm({ ...form, vehicleId: val === NONE ? "" : val })
                }
              >
                <SelectTrigger data-testid="vlease-field-vehicle">
                  <SelectValue placeholder="Select a vehicle" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Unassigned</SelectItem>
                  {(vehicles ?? []).map((v) => {
                    const vv = v as Record<string, unknown>;
                    return (
                      <SelectItem key={String(vv.id)} value={String(vv.id)}>
                        {vehicleLabel.get(String(vv.id))}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Status">
              <Select
                value={form.status}
                onValueChange={(val) =>
                  setForm({ ...form, status: val as LeaseStatus })
                }
              >
                <SelectTrigger data-testid="vlease-field-status">
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

            <div className="col-span-2">
              <Field label="Lessor">
                <Input
                  value={form.lessor}
                  onChange={(e) => setForm({ ...form, lessor: e.target.value })}
                />
              </Field>
            </div>

            <Field label="Start date">
              <Input
                type="date"
                value={form.startDate}
                onChange={(e) =>
                  setForm({ ...form, startDate: e.target.value })
                }
              />
            </Field>
            <Field label="End date">
              <Input
                type="date"
                value={form.endDate}
                onChange={(e) => setForm({ ...form, endDate: e.target.value })}
              />
            </Field>

            <Field label="Monthly cost ($)">
              <Input
                inputMode="decimal"
                value={form.monthlyCost}
                onChange={(e) =>
                  setForm({ ...form, monthlyCost: e.target.value })
                }
              />
            </Field>
            <Field label="Deposit ($)">
              <Input
                inputMode="decimal"
                value={form.deposit}
                onChange={(e) => setForm({ ...form, deposit: e.target.value })}
              />
            </Field>
            <Field label="Buyout cost ($)">
              <Input
                inputMode="decimal"
                value={form.buyoutCost}
                onChange={(e) =>
                  setForm({ ...form, buyoutCost: e.target.value })
                }
              />
            </Field>

            <div className="col-span-2">
              <Field label="Deductions">
                <Input
                  value={form.deductions}
                  onChange={(e) =>
                    setForm({ ...form, deductions: e.target.value })
                  }
                />
              </Field>
            </div>
            <div className="col-span-2">
              <Field label="Notes">
                <Input
                  value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
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
              data-testid="vlease-save-btn"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : editingId ? (
                "Save changes"
              ) : (
                "Add lease"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!deletingId}
        onOpenChange={(open) => {
          if (!open) setDeletingId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this lease?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the lease record.
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

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
