import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Plus } from "lucide-react";
import type { Customer, Lease, Property } from "@/data/mockData";

export interface AddLeaseDialogProps {
  propertyId?: string;
  properties?: readonly Property[];
  customers?: readonly Customer[];
  onAdd: (lease: Lease) => void;
  trigger?: React.ReactNode;
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
  const { t } = useTranslation();
  const customerNameById = new Map((customers ?? []).map((c) => [c.id, c.name] as const));
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (next: boolean) => {
    if (onOpenChange) onOpenChange(next);
    else setInternalOpen(next);
  };

  const [form, setForm] = useState<DraftState>({ ...EMPTY_DRAFT, propertyId: propertyId ?? "" });

  useEffect(() => {
    if (propertyId) {
      setForm((f) => ({ ...f, propertyId }));
    }
  }, [propertyId]);

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
    // Task #492: a brand-new lease inherits its parent property's
    // `defaultNoticePeriodDays` at creation time, so the value is
    // pinned on the lease row even if the property default later
    // changes. Operators can still override (or clear back to null) on
    // the lease detail page. When the property has no default
    // configured, the lease starts at null and the alert simply skips
    // it — same null-means-skip semantics the digest uses.
    const selectedProperty = propertyList.find((p) => p.id === form.propertyId);
    const inheritedNoticePeriodDays =
      selectedProperty?.defaultNoticePeriodDays ?? null;
    onAdd({
      id: `l-${Date.now()}`,
      propertyId: form.propertyId,
      startDate: form.startDate,
      endDate: form.endDate,
      monthlyRent: parseFloat(form.monthlyRent) || 0,
      securityDeposit: parseFloat(form.securityDeposit) || 0,
      status: form.status,
      notes: form.notes,
      clauses: "",
      buyoutAvailable: false,
      buyoutCost: null,
      rateType: "monthly",
      nightlyRate: 0,
      guaranteedRooms: 0,
      monthlyRoomNightMin: 0,
      longStayTaxExempt: false,
      customerResponsibleForRent: false,
      noticePeriodDays: inheritedNoticePeriodDays,
    });
    setOpen(false);
  };

  const triggerEl = trigger ?? (
    <Button size="sm" data-testid="button-add-lease">
      <Plus className="h-4 w-4 mr-1.5" />
      {t("dialogs.addLease.triggerLabel")}
    </Button>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {controlledOpen === undefined && (
        <DialogTrigger asChild>{triggerEl}</DialogTrigger>
      )}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("dialogs.addLease.title")}</DialogTitle>
          {showPicker && (
            <DialogDescription>
              {t("dialogs.addLease.description")}
            </DialogDescription>
          )}
        </DialogHeader>
        <div className="space-y-3 pt-2">
          {showPicker && (
            <div>
              <Label htmlFor="add-lease-property">{t("dialogs.addLease.propertyRequired")}</Label>
              <Select
                value={form.propertyId}
                onValueChange={(v) => setForm((f) => ({ ...f, propertyId: v }))}
              >
                <SelectTrigger id="add-lease-property" data-testid="select-add-lease-property">
                  <SelectValue placeholder={t("dialogs.addLease.chooseProperty")} />
                </SelectTrigger>
                <SelectContent>
                  {propertyList.length === 0 ? (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">
                      {t("dialogs.addLease.noPropertiesYet")}
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
              <Label>{t("dialogs.addLease.startDateRequired")}</Label>
              <Input
                type="date"
                value={form.startDate}
                onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                data-testid="input-add-lease-start"
              />
            </div>
            <div>
              <Label>{t("dialogs.addLease.endDateRequired")}</Label>
              <Input
                type="date"
                value={form.endDate}
                onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
                data-testid="input-add-lease-end"
              />
            </div>
            <div>
              <Label>{t("dialogs.addLease.monthlyRentRequired")}</Label>
              <Input
                type="number"
                value={form.monthlyRent}
                onChange={(e) => setForm((f) => ({ ...f, monthlyRent: e.target.value }))}
                data-testid="input-add-lease-rent"
              />
            </div>
            <div>
              <Label>{t("dialogs.addLease.securityDeposit")}</Label>
              <Input
                type="number"
                value={form.securityDeposit}
                onChange={(e) => setForm((f) => ({ ...f, securityDeposit: e.target.value }))}
                data-testid="input-add-lease-deposit"
              />
            </div>
          </div>
          <div>
            <Label>{t("dialogs.addLease.status")}</Label>
            <Select
              value={form.status}
              onValueChange={(v) => setForm((f) => ({ ...f, status: v as Lease["status"] }))}
            >
              <SelectTrigger data-testid="select-add-lease-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Active">{t("dialogs.addLease.statusActive")}</SelectItem>
                <SelectItem value="Expired">{t("dialogs.addLease.statusExpired")}</SelectItem>
                <SelectItem value="Upcoming">{t("dialogs.addLease.statusUpcoming")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{t("dialogs.addLease.notes")}</Label>
            <Textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              data-testid="textarea-add-lease-notes"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{t("dialogs.addLease.cancel")}</Button>
          <Button onClick={submit} disabled={!canSubmit} data-testid="button-save-lease">
            {t("dialogs.addLease.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
