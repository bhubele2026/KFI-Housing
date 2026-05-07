import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  OCCUPANT_GENDERS,
  OCCUPANT_LANGUAGES,
  OCCUPANT_TITLES,
  type BillingFrequency,
  type Bed,
  type Occupant,
  type OccupantGender,
  type OccupantLanguage,
  type OccupantTitle,
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
  language?: OccupantLanguage | null;
  gender?: OccupantGender | null;
  title?: OccupantTitle | null;
  kfisAuthorizedToDrive?: boolean | null;
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

// Sentinel option value used by the optional Language/Gender/Title
// <Select>s to represent "not on file yet". Radix's <SelectItem> can't
// take an empty-string value, so we map this sentinel to `null` when
// building the Occupant payload on submit.
const UNSET = "__unset";

const EMPTY_FORM = {
  name: "",
  employeeId: "",
  company: "",
  moveInDate: "",
  chargePerBed: "",
  billingFrequency: "Monthly" as BillingFrequency,
  email: "",
  phone: "",
  language: UNSET as OccupantLanguage | typeof UNSET,
  gender: UNSET as OccupantGender | typeof UNSET,
  title: UNSET as OccupantTitle | typeof UNSET,
  // Nullable tri-state: `null` = "not on file yet" (renders as the
  // checkbox's indeterminate state), `true`/`false` = explicit
  // operator answer. Defaulting to `null` preserves the schema's
  // nullability so an untouched form never collapses an unknown
  // driver-license status to a hard `false`.
  kfisAuthorizedToDrive: null as boolean | null,
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
    language: (initial.language ?? UNSET) as OccupantLanguage | typeof UNSET,
    gender: (initial.gender ?? UNSET) as OccupantGender | typeof UNSET,
    title: (initial.title ?? UNSET) as OccupantTitle | typeof UNSET,
    kfisAuthorizedToDrive: initial.kfisAuthorizedToDrive ?? null,
  };
}

export function AssignOccupantDialog({
  bed,
  initial,
  onAssign,
  trigger,
  testIdSuffix,
}: AssignOccupantDialogProps) {
  const { t } = useTranslation();
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
    // Only properties that have at least one *ready* vacant bed are worth
    // picking. A vacant bed mid-cleaning (needs_cleaning / in_progress)
    // is not assignable yet — task #500's cleaning workflow gates new
    // placements on the bed reaching "ready" first.
    const propertyIdsWithVacancy = new Set(
      beds
        .filter((b) => b.status === "Vacant" && b.cleaningStatus === "ready")
        .map((b) => b.propertyId),
    );
    return properties
      .filter((p) => propertyIdsWithVacancy.has(p.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [fixedBed, properties, beds]);

  const vacantBedsForProperty = useMemo(() => {
    if (fixedBed) return [];
    if (!pickedPropertyId) return [];
    return beds
      .filter(
        (b) =>
          b.propertyId === pickedPropertyId &&
          b.status === "Vacant" &&
          b.cleaningStatus === "ready",
      )
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
      shift: null,
      language: form.language === UNSET ? null : form.language,
      gender: form.gender === UNSET ? null : form.gender,
      title: form.title === UNSET ? null : form.title,
      kfisAuthorizedToDrive: form.kfisAuthorizedToDrive,
      createdAt: new Date().toISOString(),
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
            {t("dialogs.assignOccupant.triggerDefault")}
          </button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("dialogs.assignOccupant.title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-2">
          {!fixedBed && (
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label>{t("dialogs.assignOccupant.propertyRequired")}</Label>
                <Select
                  value={pickedPropertyId}
                  onValueChange={setPickedPropertyId}
                >
                  <SelectTrigger
                    data-testid={`select-assign-property${tidSuffix}`}
                  >
                    <SelectValue placeholder={t("dialogs.assignOccupant.pickPropertyVacant")} />
                  </SelectTrigger>
                  <SelectContent>
                    {propertyOptions.length === 0 ? (
                      <SelectItem value="__none" disabled>
                        {t("dialogs.assignOccupant.noVacantProperty")}
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
                <Label>{t("dialogs.assignOccupant.vacantBedRequired")}</Label>
                <Select
                  value={pickedBedId}
                  onValueChange={setPickedBedId}
                  disabled={!pickedPropertyId}
                >
                  <SelectTrigger data-testid={`select-assign-bed${tidSuffix}`}>
                    <SelectValue
                      placeholder={
                        pickedPropertyId
                          ? t("dialogs.assignOccupant.pickVacantBed")
                          : t("dialogs.assignOccupant.pickPropertyFirst")
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {vacantBedsForProperty.map((b: Bed) => (
                      <SelectItem key={b.id} value={b.id}>
                        {t("dialogs.assignOccupant.bedNumber", { number: b.bedNumber })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>{t("dialogs.assignOccupant.fullNameRequired")}</Label>
              <Input
                value={form.name}
                onChange={f("name")}
                placeholder={t("dialogs.assignOccupant.namePlaceholder")}
                data-testid={`input-assign-name${tidSuffix}`}
              />
            </div>
            <div>
              <Label>{t("dialogs.assignOccupant.employeeId")}</Label>
              <Input
                value={form.employeeId}
                onChange={f("employeeId")}
                placeholder={t("dialogs.assignOccupant.employeeIdPlaceholder")}
                data-testid={`input-assign-employee-id${tidSuffix}`}
              />
            </div>
            <div>
              <Label>{t("dialogs.assignOccupant.company")}</Label>
              <Input
                value={form.company}
                onChange={f("company")}
                placeholder={t("dialogs.assignOccupant.companyPlaceholder")}
                data-testid={`input-assign-company${tidSuffix}`}
              />
            </div>
            <div>
              <Label>{t("dialogs.assignOccupant.moveInDate")}</Label>
              <Input
                type="date"
                value={form.moveInDate}
                onChange={f("moveInDate")}
                data-testid={`input-assign-move-in${tidSuffix}`}
              />
            </div>
            <div>
              <Label>{t("dialogs.assignOccupant.chargePerBed")}</Label>
              <Input
                type="number"
                value={form.chargePerBed}
                onChange={f("chargePerBed")}
                placeholder={t("dialogs.assignOccupant.chargePerBedPlaceholder")}
                data-testid={`input-assign-charge${tidSuffix}`}
              />
            </div>
            <div>
              <Label>{t("dialogs.assignOccupant.billingFrequency")}</Label>
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
              <Label>{t("dialogs.assignOccupant.email")}</Label>
              <Input
                value={form.email}
                onChange={f("email")}
                placeholder={t("dialogs.assignOccupant.emailPlaceholder")}
              />
            </div>
            <div>
              <Label>{t("dialogs.assignOccupant.phone")}</Label>
              <Input
                value={form.phone}
                onChange={f("phone")}
                placeholder={t("dialogs.assignOccupant.phonePlaceholder")}
              />
            </div>
            <div>
              <Label>Language</Label>
              <Select
                value={form.language}
                onValueChange={(v) =>
                  setForm((p) => ({
                    ...p,
                    language: v as OccupantLanguage | typeof UNSET,
                  }))
                }
              >
                <SelectTrigger
                  data-testid={`select-assign-language${tidSuffix}`}
                >
                  <SelectValue placeholder="Not on file" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNSET}>Not on file</SelectItem>
                  {OCCUPANT_LANGUAGES.map((lang) => (
                    <SelectItem key={lang} value={lang}>
                      {lang}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Gender</Label>
              <Select
                value={form.gender}
                onValueChange={(v) =>
                  setForm((p) => ({
                    ...p,
                    gender: v as OccupantGender | typeof UNSET,
                  }))
                }
              >
                <SelectTrigger
                  data-testid={`select-assign-gender${tidSuffix}`}
                >
                  <SelectValue placeholder="Not on file" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNSET}>Not on file</SelectItem>
                  {OCCUPANT_GENDERS.map((g) => (
                    <SelectItem key={g} value={g}>
                      {g}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <Label>Title</Label>
              <Select
                value={form.title}
                onValueChange={(v) =>
                  setForm((p) => ({
                    ...p,
                    title: v as OccupantTitle | typeof UNSET,
                  }))
                }
              >
                <SelectTrigger
                  data-testid={`select-assign-title${tidSuffix}`}
                >
                  <SelectValue placeholder="Not on file" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNSET}>Not on file</SelectItem>
                  {OCCUPANT_TITLES.map((title) => (
                    <SelectItem key={title} value={title}>
                      {title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 flex items-center gap-2">
              <Checkbox
                id={`assign-kfis-drive${tidSuffix}`}
                // `null` (not on file) renders as Radix's indeterminate
                // state so the operator can see the field hasn't been
                // answered yet — clicking cycles null -> true -> false
                // -> null and never silently writes a hard `false` to
                // the DB.
                checked={
                  form.kfisAuthorizedToDrive === null
                    ? "indeterminate"
                    : form.kfisAuthorizedToDrive
                }
                onCheckedChange={() =>
                  setForm((p) => ({
                    ...p,
                    kfisAuthorizedToDrive:
                      p.kfisAuthorizedToDrive === null
                        ? true
                        : p.kfisAuthorizedToDrive === true
                          ? false
                          : null,
                  }))
                }
                data-testid={`checkbox-assign-kfis-drive${tidSuffix}`}
              />
              <Label
                htmlFor={`assign-kfis-drive${tidSuffix}`}
                className="font-normal cursor-pointer"
              >
                KFIS authorized to drive
                {form.kfisAuthorizedToDrive === null ? (
                  <span className="ml-1 text-xs text-muted-foreground">
                    (not on file)
                  </span>
                ) : null}
              </Label>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("dialogs.assignOccupant.cancel")}
            </Button>
            <Button
              onClick={submit}
              disabled={!canSubmit}
              data-testid={`button-assign-submit${tidSuffix}`}
            >
              {t("dialogs.assignOccupant.submit")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
