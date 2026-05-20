import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { Lease, Property } from "@/data/mockData";

export interface LeaseDraftState {
  startDate: string;
  endDate: string;
  monthlyRent: string;
  securityDeposit: string;
  status: Lease["status"];
  notes: string;
}

export const EMPTY_LEASE_DRAFT: LeaseDraftState = {
  startDate: "",
  endDate: "",
  monthlyRent: "",
  securityDeposit: "",
  status: "Active",
  notes: "",
};

export function leaseDraftCanSubmit(form: LeaseDraftState): boolean {
  return !!form.startDate && !!form.endDate && !!form.monthlyRent;
}

export interface BuildLeaseFromDraftOptions {
  propertyId: string;
  buildingId: string | null;
  property?: Pick<Property, "defaultNoticePeriodDays"> | null;
  id?: string;
}

export function buildLeaseFromDraft(
  form: LeaseDraftState,
  { propertyId, buildingId, property, id }: BuildLeaseFromDraftOptions,
): Lease {
  // Mirrors the inheritance behavior the standalone AddLeaseDialog has
  // used since Task #492: pin the property's current
  // defaultNoticePeriodDays onto the lease at creation so a later
  // property-level change doesn't silently mutate this lease.
  const inheritedNoticePeriodDays = property?.defaultNoticePeriodDays ?? null;
  return {
    id: id ?? `l-${Date.now()}`,
    propertyId,
    buildingId: buildingId ?? null,
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
  };
}

export interface LeaseFormFieldsProps {
  form: LeaseDraftState;
  setForm: (updater: (prev: LeaseDraftState) => LeaseDraftState) => void;
  disabled?: boolean;
  /**
   * Suffix appended to data-testid values so two of these forms can be
   * rendered on the same page without clashing (the combined
   * Add-Building dialog reuses these inputs alongside the standalone
   * Add-Lease dialog in tests).
   */
  testIdSuffix?: string;
}

export function LeaseFormFields({
  form,
  setForm,
  disabled,
  testIdSuffix = "",
}: LeaseFormFieldsProps) {
  const { t } = useTranslation();
  const tid = (base: string) => `${base}${testIdSuffix}`;
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>{t("dialogs.addLease.startDateRequired")}</Label>
          <Input
            type="date"
            value={form.startDate}
            disabled={disabled}
            onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
            data-testid={tid("input-add-lease-start")}
          />
        </div>
        <div>
          <Label>{t("dialogs.addLease.endDateRequired")}</Label>
          <Input
            type="date"
            value={form.endDate}
            disabled={disabled}
            onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
            data-testid={tid("input-add-lease-end")}
          />
        </div>
        <div>
          <Label>{t("dialogs.addLease.monthlyRentRequired")}</Label>
          <Input
            type="number"
            value={form.monthlyRent}
            disabled={disabled}
            onChange={(e) => setForm((f) => ({ ...f, monthlyRent: e.target.value }))}
            data-testid={tid("input-add-lease-rent")}
          />
        </div>
        <div>
          <Label>{t("dialogs.addLease.securityDeposit")}</Label>
          <Input
            type="number"
            value={form.securityDeposit}
            disabled={disabled}
            onChange={(e) => setForm((f) => ({ ...f, securityDeposit: e.target.value }))}
            data-testid={tid("input-add-lease-deposit")}
          />
        </div>
      </div>
      <div>
        <Label>{t("dialogs.addLease.status")}</Label>
        <Select
          value={form.status}
          disabled={disabled}
          onValueChange={(v) => setForm((f) => ({ ...f, status: v as Lease["status"] }))}
        >
          <SelectTrigger data-testid={tid("select-add-lease-status")}>
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
          disabled={disabled}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          data-testid={tid("textarea-add-lease-notes")}
        />
      </div>
    </>
  );
}
