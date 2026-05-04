import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Plus } from "lucide-react";
import type { Customer, Lease, Property } from "@/data/mockData";

export interface AddLeaseDialogProps {
  /**
   * Pre-bind the dialog to a property (Property Detail tab). When omitted,
   * the dialog renders a property picker (global Leases page).
   */
  propertyId?: string;
  /** All properties — used to populate the picker when {@link propertyId} is omitted. */
  properties?: readonly Property[];
  /** All customers — used to annotate property options with the owning customer's name. */
  customers?: readonly Customer[];
  onAdd: (lease: Lease) => void;
  /** Override the trigger; defaults to a "Add Lease" button. */
  trigger?: React.ReactNode;
  /** Optional controlled-open mode (used by the Upload-PDF flow). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

interface DraftState {
  propertyId: string;
  startDate: string;
  endDate: string;
  monthlyRent: string;
  securityDeposit: string;
  status: Lease["status"];
  notes: string;
}

const EMPTY_DRAFT: DraftState = {
  propertyId: "",
  startDate: "",
  endDate: "",
  monthlyRent: "",
  securityDeposit: "",
  status: "Active",
  notes: "",
};

export function AddLeaseDialog({
  propertyId,
  properties,
  customers,
  onAdd,
  trigger,
  open: controlledOpen,
  onOpenChange,
}: AddLeaseDialogProps) {
  const customerNameById = new Map((customers ?? []).map((c) => [c.id, c.name] as const));
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (next: boolean) => {
    if (onOpenChange) onOpenChange(next);
    else setInternalOpen(next);
  };

  const [form, setForm] = useState<DraftState>({ ...EMPTY_DRAFT, propertyId: propertyId ?? "" });

  // Keep the bound propertyId in sync if it changes while the dialog is open.
  useEffect(() => {
    if (propertyId) {
      setForm((f) => ({ ...f, propertyId }));
    }
  }, [propertyId]);

  // Reset whenever the dialog closes so reopening doesn't show stale input.
  useEffect(() => {
    if (!open) {
      setForm({ ...EMPTY_DRAFT, propertyId: propertyId ?? "" });
    }
  }, [open, propertyId]);

  const showPicker = !propertyId;
  const propertyList = properties ?? [];

  const canSubmit =
    !!form.propertyId &&
    !!form.startDate &&
    !!form.endDate &&
    !!form.monthlyRent;

  const submit = () => {
    if (!canSubmit) return;
    onAdd({
      id: `l-${Date.now()}`,
      propertyId: form.propertyId,
      startDate: form.startDate,
      endDate: form.endDate,
      monthlyRent: parseFloat(form.monthlyRent) || 0,
      securityDeposit: parseFloat(form.securityDeposit) || 0,
      status: form.status,
      notes: form.notes,
      // Extended fields default empty here — operators fill them in from the
      // dedicated lease detail page after creation.
      clauses: "",
      buyoutAvailable: false,
      buyoutCost: null,
    });
    setOpen(false);
  };

  const triggerEl = trigger ?? (
    <Button size="sm" data-testid="button-add-lease">
      <Plus className="h-4 w-4 mr-1.5" />
      Add Lease
    </Button>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* When controlled externally we skip the trigger entirely. */}
      {controlledOpen === undefined && (
        <DialogTrigger asChild>{triggerEl}</DialogTrigger>
      )}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Lease</DialogTitle>
          {showPicker && (
            <DialogDescription>
              Pick the property this lease covers, then fill in the dates and
              amounts.
            </DialogDescription>
          )}
        </DialogHeader>
        <div className="space-y-3 pt-2">
          {showPicker && (
            <div>
              <Label htmlFor="add-lease-property">Property *</Label>
              <Select
                value={form.propertyId}
                onValueChange={(v) => setForm((f) => ({ ...f, propertyId: v }))}
              >
                <SelectTrigger id="add-lease-property" data-testid="select-add-lease-property">
                  <SelectValue placeholder="Choose a property" />
                </SelectTrigger>
                <SelectContent>
                  {propertyList.length === 0 ? (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">
                      No properties yet. Add one first.
                    </div>
                  ) : (
                    propertyList.map((p) => {
                      const customerName = customerNameById.get(p.customerId);
                      const parts = [p.name];
                      if (customerName) parts.push(customerName);
                      if (p.address) parts.push(p.address);
                      return (
                        <SelectItem key={p.id} value={p.id}>
                          {parts.join(" — ")}
                        </SelectItem>
                      );
                    })
                  )}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Start Date *</Label>
              <Input
                type="date"
                value={form.startDate}
                onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                data-testid="input-add-lease-start"
              />
            </div>
            <div>
              <Label>End Date *</Label>
              <Input
                type="date"
                value={form.endDate}
                onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
                data-testid="input-add-lease-end"
              />
            </div>
            <div>
              <Label>Monthly Rent ($) *</Label>
              <Input
                type="number"
                value={form.monthlyRent}
                onChange={(e) => setForm((f) => ({ ...f, monthlyRent: e.target.value }))}
                data-testid="input-add-lease-rent"
              />
            </div>
            <div>
              <Label>Security Deposit ($)</Label>
              <Input
                type="number"
                value={form.securityDeposit}
                onChange={(e) => setForm((f) => ({ ...f, securityDeposit: e.target.value }))}
                data-testid="input-add-lease-deposit"
              />
            </div>
          </div>
          <div>
            <Label>Status</Label>
            <Select
              value={form.status}
              onValueChange={(v) => setForm((f) => ({ ...f, status: v as Lease["status"] }))}
            >
              <SelectTrigger data-testid="select-add-lease-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Active">Active</SelectItem>
                <SelectItem value="Expired">Expired</SelectItem>
                <SelectItem value="Upcoming">Upcoming</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              data-testid="textarea-add-lease-notes"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!canSubmit} data-testid="button-save-lease">
            Add Lease
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
