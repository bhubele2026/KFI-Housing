import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Plus } from "lucide-react";
import type { Building, Customer, Lease, Property } from "@/data/mockData";
import { useData } from "@/context/data-store";
import { useToast } from "@/hooks/use-toast";

export interface AddLeaseDialogProps {
  propertyId?: string;
  properties?: readonly Property[];
  customers?: readonly Customer[];
  // Building roster (Task #570). Optional so callers that haven't been
  // upgraded keep working as before — the picker only renders when the
  // selected property has more than one building.
  buildings?: readonly Building[];
  onAdd: (lease: Lease) => void;
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

interface DraftState {
  propertyId: string;
  // Empty string = "All buildings / unassigned"; sent as null on the
  // wire so single-building properties don't have to remember an id.
  buildingId: string;
  // Optional customer override for the lease (Task #607). Empty string
  // means "fall back to the property's customer" so we don't fabricate
  // an override that doesn't exist.
  customerId: string;
  startDate: string;
  endDate: string;
  monthlyRent: string;
  securityDeposit: string;
  status: Lease["status"];
  notes: string;
}

const EMPTY_DRAFT: DraftState = {
  propertyId: "",
  buildingId: "",
  customerId: "",
  startDate: "",
  endDate: "",
  monthlyRent: "",
  securityDeposit: "",
  status: "Active",
  notes: "",
};

// Sentinel values used inside the customer <Select>. Kept as `__…__`
// to match the same pattern the Add Property dialog and Upload-PDF
// dialog already use for their "+ Create new customer" rows.
const NEW_CUSTOMER_VALUE = "__new__";
const SAME_AS_PROPERTY_VALUE = "__same__";

interface NewCustomerDraft {
  name: string;
  contactName: string;
  email: string;
  phone: string;
}

const EMPTY_NEW_CUSTOMER: NewCustomerDraft = {
  name: "",
  contactName: "",
  email: "",
  phone: "",
};

export function AddLeaseDialog({
  propertyId,
  properties,
  customers,
  buildings,
  onAdd,
  trigger,
  open: controlledOpen,
  onOpenChange,
}: AddLeaseDialogProps) {
  const { t } = useTranslation();
  const { addCustomer } = useData();
  const { toast } = useToast();
  const customerNameById = new Map((customers ?? []).map((c) => [c.id, c.name] as const));
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (next: boolean) => {
    if (onOpenChange) onOpenChange(next);
    else setInternalOpen(next);
  };

  const [form, setForm] = useState<DraftState>({ ...EMPTY_DRAFT, propertyId: propertyId ?? "" });
  // Inline "+ Create new customer…" state (Task #607). Mirrors the
  // same pattern the Add Property dialog and PDF-import flow already
  // use: a sentinel option in the customer <Select> reveals a small
  // sub-form, and submit creates the customer first before the lease
  // is added so the new customerId can be threaded onto the lease.
  const [showNewCustomerForm, setShowNewCustomerForm] = useState(false);
  const [newCustomer, setNewCustomer] = useState<NewCustomerDraft>(EMPTY_NEW_CUSTOMER);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (propertyId) {
      setForm((f) => ({ ...f, propertyId }));
    }
  }, [propertyId]);

  useEffect(() => {
    if (!open) {
      setForm({ ...EMPTY_DRAFT, propertyId: propertyId ?? "" });
      // Reset the inline new-customer state alongside the form so the
      // next open starts clean — nothing typed into the inline form
      // is persisted when the operator cancels (Task #607).
      setShowNewCustomerForm(false);
      setNewCustomer(EMPTY_NEW_CUSTOMER);
      setSaving(false);
    }
  }, [open, propertyId]);

  const showPicker = !propertyId;
  const propertyList = properties ?? [];
  // Buildings under whichever property is currently selected. When the
  // property has 0–1 buildings we hide the picker entirely so the
  // single-building flow stays one click (Task #570).
  const propertyBuildings = (buildings ?? []).filter(
    (b) => b.propertyId === form.propertyId,
  );
  const showBuildingPicker = propertyBuildings.length > 1;

  const canSubmit =
    !!form.propertyId &&
    !!form.startDate &&
    !!form.endDate &&
    !!form.monthlyRent &&
    !saving;

  const submit = async () => {
    if (!canSubmit) return;

    // If the operator chose "+ Create new customer…", persist the
    // customer FIRST and await the server response so the lease's
    // customerId is real before we hand the lease off to the parent
    // (Task #607). Mirrors the inline-create flow in the Add Property
    // dialog: name required; contact/email/phone optional.
    let leaseCustomerId: string | null = form.customerId || null;
    if (showNewCustomerForm) {
      const cName = newCustomer.name.trim();
      if (!cName) {
        toast({
          title: t("toasts.newCustomerNameRequiredTitle"),
          description: t("toasts.newCustomerNameRequiredDescription"),
          variant: "destructive",
        });
        return;
      }
      const newId = `cust-${Date.now()}`;
      setSaving(true);
      try {
        await addCustomer({
          id: newId,
          name: cName,
          contactName: newCustomer.contactName.trim(),
          email: newCustomer.email.trim(),
          phone: newCustomer.phone.trim(),
          notes: "",
          state: "",
          customShifts: [],
          isInactive: false,
        });
      } catch {
        toast({
          title: t("toasts.couldntCreateCustomerTitle"),
          description: t("toasts.couldntCreateCustomerDescription"),
          variant: "destructive",
        });
        setSaving(false);
        return;
      }
      leaseCustomerId = newId;
    }

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
      // Persist the explicit picker choice when the operator picked one;
      // null means "lease applies at the property level / single
      // building" so we don't fabricate a bldg_*_1 id (Task #570).
      buildingId: form.buildingId ? form.buildingId : null,
      // Customer override (Task #607). Null = fall back to the
      // property's customerId, which is the historical behavior.
      customerId: leaseCustomerId,
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
      utilitiesIncludedInRent: false,
      customerResponsibleForRent: false,
      noticePeriodDays: inheritedNoticePeriodDays,
    });
    setSaving(false);
    setOpen(false);
  };

  const triggerEl = trigger ?? (
    <Button size="sm" data-testid="button-add-lease">
      <Plus className="h-4 w-4 mr-1.5" />
      {t("dialogs.addLease.triggerLabel")}
    </Button>
  );

  const customerSelectValue = showNewCustomerForm
    ? NEW_CUSTOMER_VALUE
    : form.customerId || SAME_AS_PROPERTY_VALUE;

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
          {showBuildingPicker && (
            <div>
              <Label htmlFor="add-lease-building">Building</Label>
              <Select
                value={form.buildingId}
                onValueChange={(v) => setForm((f) => ({ ...f, buildingId: v === "__all__" ? "" : v }))}
              >
                <SelectTrigger id="add-lease-building" data-testid="select-add-lease-building">
                  <SelectValue placeholder="All buildings" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All buildings</SelectItem>
                  {propertyBuildings.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {/* Optional customer override (Task #607). Defaults to "Same
              as property" so the historical behavior — lease inherits
              the property's customer — is preserved when the operator
              doesn't touch this field. The "+ Create new customer…"
              row at the top mirrors the Add Property dialog and the
              PDF-import flow. */}
          <div>
            <Label htmlFor="add-lease-customer">{t("dialogs.addLease.customer")}</Label>
            <Select
              value={customerSelectValue}
              onValueChange={(v) => {
                if (v === NEW_CUSTOMER_VALUE) {
                  setShowNewCustomerForm(true);
                  setForm((f) => ({ ...f, customerId: "" }));
                } else if (v === SAME_AS_PROPERTY_VALUE) {
                  setShowNewCustomerForm(false);
                  setForm((f) => ({ ...f, customerId: "" }));
                } else {
                  setShowNewCustomerForm(false);
                  setForm((f) => ({ ...f, customerId: v }));
                }
              }}
            >
              <SelectTrigger id="add-lease-customer" data-testid="select-add-lease-customer">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NEW_CUSTOMER_VALUE}>
                  {t("dialogs.addLease.createNewCustomer")}
                </SelectItem>
                <SelectItem value={SAME_AS_PROPERTY_VALUE}>
                  {t("dialogs.addLease.sameAsProperty")}
                </SelectItem>
                {(customers ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {showNewCustomerForm && (
            <div
              className="space-y-3 p-3 rounded-md border bg-muted/30"
              data-testid="section-add-lease-new-customer"
            >
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t("dialogs.addLease.newCustomerSection")}
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="add-lease-new-cust-name">
                  {t("dialogs.addLease.newCustomerName")}
                </Label>
                <Input
                  id="add-lease-new-cust-name"
                  value={newCustomer.name}
                  onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })}
                  data-testid="input-add-lease-new-customer-name"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="add-lease-new-cust-contact">
                    {t("dialogs.addLease.newCustomerContact")}
                  </Label>
                  <Input
                    id="add-lease-new-cust-contact"
                    value={newCustomer.contactName}
                    onChange={(e) =>
                      setNewCustomer({ ...newCustomer, contactName: e.target.value })
                    }
                    data-testid="input-add-lease-new-customer-contact"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="add-lease-new-cust-phone">
                    {t("dialogs.addLease.newCustomerPhone")}
                  </Label>
                  <Input
                    id="add-lease-new-cust-phone"
                    value={newCustomer.phone}
                    onChange={(e) =>
                      setNewCustomer({ ...newCustomer, phone: e.target.value })
                    }
                    data-testid="input-add-lease-new-customer-phone"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="add-lease-new-cust-email">
                  {t("dialogs.addLease.newCustomerEmail")}
                </Label>
                <Input
                  id="add-lease-new-cust-email"
                  type="email"
                  value={newCustomer.email}
                  onChange={(e) =>
                    setNewCustomer({ ...newCustomer, email: e.target.value })
                  }
                  data-testid="input-add-lease-new-customer-email"
                />
              </div>
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
