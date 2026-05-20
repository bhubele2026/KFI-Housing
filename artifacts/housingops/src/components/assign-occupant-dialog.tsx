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
import { ShiftPicker } from "@/components/shift-picker";

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
   * When provided, switches the dialog into edit mode: every field is
   * pre-filled from this occupant's current values and the submit button
   * calls `onUpdate` instead of `onAssign`. The property/bed picker is
   * hidden because the occupant is already assigned.
   */
  occupant?: Occupant;
  /**
   * Called after the parent should run `addOccupant(occ)` and
   * `updateBed(bed.id, { status: "Occupied", occupantId: occ.id })`. The
   * dialog handles building the Occupant; the parent decides whether to
   * persist via the data-store hooks (so this component stays usable
   * without baking the data-store into it).
   */
  onAssign?: (occupant: Occupant, bed: { id: string; propertyId: string }) => void;
  /**
   * Called in edit mode when the operator saves the dialog. Receives only
   * the changed fields so the data-store/API patch is minimal.
   */
  onUpdate?: (id: string, patch: Partial<Occupant>) => void;
  /** Custom trigger. Defaults to the small italic "Assign occupant" link. */
  trigger?: ReactNode;
  /**
   * Optional id suffix so multiple instances on the same page get unique
   * `data-testid`s (e.g. one per unplaced-payroll row).
   */
  testIdSuffix?: string;
  /**
   * Controlled-open support. The bed-map tile wraps the trigger directly,
   * but other entry points (keyboard handlers, "Open row" buttons) need to
   * open the dialog imperatively, so we expose a controlled mode.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
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
  moveOutDate: "",
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
  shift: null as string | null,
};

function buildInitialForm(initial: AssignOccupantInitialValues | undefined) {
  if (!initial) return EMPTY_FORM;
  return {
    name: initial.name ?? "",
    employeeId: initial.employeeId ?? "",
    company: initial.company ?? "",
    moveInDate: "",
    moveOutDate: "",
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
    shift: null as string | null,
  };
}

function buildEditForm(occupant: Occupant) {
  return {
    name: occupant.name ?? "",
    employeeId: occupant.employeeId ?? "",
    company: occupant.company ?? "",
    moveInDate: occupant.moveInDate ?? "",
    moveOutDate: occupant.moveOutDate ?? "",
    chargePerBed:
      typeof occupant.chargePerBed === "number" && Number.isFinite(occupant.chargePerBed)
        ? String(occupant.chargePerBed)
        : "",
    billingFrequency: (occupant.billingFrequency ?? "Monthly") as BillingFrequency,
    email: occupant.email ?? "",
    phone: occupant.phone ?? "",
    language: (occupant.language ?? UNSET) as OccupantLanguage | typeof UNSET,
    gender: (occupant.gender ?? UNSET) as OccupantGender | typeof UNSET,
    title: (occupant.title ?? UNSET) as OccupantTitle | typeof UNSET,
    kfisAuthorizedToDrive: occupant.kfisAuthorizedToDrive ?? null,
    shift: occupant.shift ?? null,
  };
}

export function AssignOccupantDialog({
  bed,
  initial,
  occupant,
  onAssign,
  onUpdate,
  trigger,
  testIdSuffix,
  open: openProp,
  onOpenChange,
}: AssignOccupantDialogProps) {
  const { t } = useTranslation();
  const { properties, beds, customers } = useData();
  const isEdit = !!occupant;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = openProp ?? internalOpen;
  const setOpen = (v: boolean) => {
    if (onOpenChange) onOpenChange(v);
    if (openProp === undefined) setInternalOpen(v);
  };
  const [form, setForm] = useState(() =>
    isEdit ? buildEditForm(occupant!) : buildInitialForm(initial),
  );
  const [pickedPropertyId, setPickedPropertyId] = useState<string>("");
  const [pickedBedId, setPickedBedId] = useState<string>("");

  // Reset the form whenever the dialog re-opens so the next click always
  // starts from a clean (and freshly pre-filled) state — without this,
  // edits made in a previous open session would persist.
  useEffect(() => {
    if (open) {
      if (isEdit && occupant) {
        setForm(buildEditForm(occupant));
      } else {
        const base = buildInitialForm(initial);
        // Default Company to the property's customer — when an operator
        // assigns someone to a bed inside, say, "Burnett Dairy" housing,
        // 99% of the time they work for Burnett Dairy. Operator can still
        // override. Only applied when the parent fixed the bed AND nothing
        // was explicitly passed via `initial.company`.
        if (bed && !initial?.company) {
          const prop = properties.find((p) => p.id === bed.propertyId);
          const customer = prop
            ? customers.find((c) => c.id === prop.customerId)
            : null;
          if (customer?.name) base.company = customer.name;
        }
        setForm(base);
      }
      setPickedPropertyId("");
      setPickedBedId("");
    }
  }, [open, initial, bed, properties, customers, isEdit, occupant]);

  const f =
    (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((p) => ({ ...p, [k]: e.target.value }));

  // When a bed is supplied by the parent (or we're editing an already-
  // placed occupant), lock to that bed/property. Otherwise the user picks
  // both via dropdowns inside the dialog.
  const fixedBed = isEdit
    ? occupant!.bedId && occupant!.propertyId
      ? { id: occupant!.bedId, propertyId: occupant!.propertyId }
      : null
    : (bed ?? null);

  const propertyOptions = useMemo(() => {
    if (fixedBed || isEdit) return [];
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
  }, [fixedBed, isEdit, properties, beds]);

  const vacantBedsForProperty = useMemo(() => {
    if (fixedBed || isEdit) return [];
    if (!pickedPropertyId) return [];
    return beds
      .filter(
        (b) =>
          b.propertyId === pickedPropertyId &&
          b.status === "Vacant" &&
          b.cleaningStatus === "ready",
      )
      .sort((a, b) => a.bedNumber - b.bedNumber);
  }, [fixedBed, isEdit, beds, pickedPropertyId]);

  // Reset the picked bed if the property changes underneath it.
  useEffect(() => {
    if (fixedBed || isEdit) return;
    if (pickedBedId && !vacantBedsForProperty.some((b) => b.id === pickedBedId)) {
      setPickedBedId("");
    }
  }, [fixedBed, isEdit, pickedBedId, vacantBedsForProperty]);

  const resolvedBed: { id: string; propertyId: string } | null = fixedBed
    ? fixedBed
    : pickedBedId && pickedPropertyId
      ? { id: pickedBedId, propertyId: pickedPropertyId }
      : null;

  const canSubmit = isEdit ? !!form.name : !!form.name && !!resolvedBed;

  const submit = () => {
    if (!form.name) return;
    if (isEdit && occupant) {
      if (!onUpdate) return;
      const patch: Partial<Occupant> = {};
      const nextName = form.name.trim();
      if (nextName !== occupant.name) patch.name = nextName;
      const nextEmployeeId = form.employeeId.trim();
      if (nextEmployeeId !== (occupant.employeeId ?? "")) patch.employeeId = nextEmployeeId;
      const nextCompany = form.company.trim();
      if (nextCompany !== (occupant.company ?? "")) patch.company = nextCompany;
      if (form.moveInDate !== (occupant.moveInDate ?? "")) {
        patch.moveInDate = form.moveInDate;
      }
      const nextMoveOut = form.moveOutDate === "" ? null : form.moveOutDate;
      if (nextMoveOut !== (occupant.moveOutDate ?? null)) {
        patch.moveOutDate = nextMoveOut;
      }
      const parsedCharge = form.chargePerBed === "" ? 0 : parseFloat(form.chargePerBed);
      if (!Number.isNaN(parsedCharge) && parsedCharge !== (occupant.chargePerBed ?? 0)) {
        patch.chargePerBed = parsedCharge;
      }
      if (form.billingFrequency !== occupant.billingFrequency) {
        patch.billingFrequency = form.billingFrequency;
      }
      const nextEmail = form.email.trim();
      if (nextEmail !== (occupant.email ?? "")) patch.email = nextEmail;
      const nextPhone = form.phone.trim();
      if (nextPhone !== (occupant.phone ?? "")) patch.phone = nextPhone;
      const nextLanguage = form.language === UNSET ? null : form.language;
      if (nextLanguage !== (occupant.language ?? null)) {
        patch.language = nextLanguage;
      }
      const nextGender = form.gender === UNSET ? null : form.gender;
      if (nextGender !== (occupant.gender ?? null)) {
        patch.gender = nextGender;
      }
      const nextTitle = form.title === UNSET ? null : form.title;
      if (nextTitle !== (occupant.title ?? null)) {
        patch.title = nextTitle;
      }
      if (form.kfisAuthorizedToDrive !== (occupant.kfisAuthorizedToDrive ?? null)) {
        patch.kfisAuthorizedToDrive = form.kfisAuthorizedToDrive;
      }
      if ((form.shift ?? null) !== (occupant.shift ?? null)) {
        patch.shift = form.shift;
      }
      if (Object.keys(patch).length > 0) onUpdate(occupant.id, patch);
      setOpen(false);
      return;
    }
    if (!resolvedBed) return;
    if (!onAssign) return;
    const occ: Occupant = {
      id: `occ-${Date.now()}`,
      propertyId: resolvedBed.propertyId,
      bedId: resolvedBed.id,
      name: form.name,
      employeeId: form.employeeId,
      company: form.company,
      moveInDate: form.moveInDate || new Date().toISOString().split("T")[0],
      moveOutDate: form.moveOutDate === "" ? null : form.moveOutDate,
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
      shift: form.shift,
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
      {trigger !== undefined || !isEdit ? (
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
      ) : null}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit
              ? t("dialogs.assignOccupant.editTitle", { defaultValue: "Edit Occupant" })
              : t("dialogs.assignOccupant.title")}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-2">
          {!fixedBed && !isEdit && (
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
              <Label>
                {t("dialogs.assignOccupant.moveOutDate", { defaultValue: "Move-out Date" })}
              </Label>
              <Input
                type="date"
                value={form.moveOutDate}
                onChange={f("moveOutDate")}
                data-testid={`input-assign-move-out${tidSuffix}`}
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
              <Label>Shift</Label>
              <ShiftPicker
                value={form.shift}
                onChange={(v) => setForm((p) => ({ ...p, shift: v }))}
                customerId={
                  resolvedBed
                    ? properties.find((p) => p.id === resolvedBed.propertyId)?.customerId ?? null
                    : null
                }
                testId={`select-assign-shift${tidSuffix}`}
                triggerClassName="h-9 text-sm w-full"
              />
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
              {isEdit
                ? t("dialogs.assignOccupant.save", { defaultValue: "Save" })
                : t("dialogs.assignOccupant.submit")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
