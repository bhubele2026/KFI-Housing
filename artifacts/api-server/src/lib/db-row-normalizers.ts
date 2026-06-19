/**
 * Single import-time normalizer that sits at the DB ↔ API boundary
 * (Task #365). Coerces legacy / loose values that may already be in
 * the database — or that an importer is about to write — into the
 * canonical shape the openapi/zod contract accepts:
 *
 *   - dates → `YYYY-MM-DD` (or `""` for OptionalLeaseDate columns)
 *   - enums → known members (anything else falls back to a safe default)
 *   - blanks → empty string
 *
 * The same normalizer is applied:
 *   - on the way OUT in the GET routes, so legacy rows already in the
 *     DB never 500 the list endpoint (one bad row used to poison
 *     `ListLeasesResponse.parse(...)` and blank the entire dashboard);
 *   - on the way IN by the XLSX/PDF importers (e.g. `import-master-leases.ts`,
 *     `lease-pdf-import.ts`) so a freshly-imported row that happens to
 *     carry a stray time suffix or an unknown payment-method label is
 *     coerced before it lands in the DB.
 *
 * Each normalizer is intentionally a pure function over a Partial of the
 * row shape — it never throws and never invents values it doesn't have
 * (so a missing field stays missing, a present-but-bad field becomes
 * the canonical fallback). This lets it run safely against
 * `InsertXxxRow` payloads as well as against full DB rows.
 *
 * Each `normalizeXxxRow` accepts an optional `fixups` collector
 * (Task #372). When supplied, every coercion that actually changed a
 * non-empty caller-supplied value is appended to the array as a
 * `{ field, before, after }` entry, so importers can surface the list
 * to the operator running the import. Coercions of missing/blank
 * values to a default (e.g. `null` -> `""`) are NOT recorded — those
 * aren't fix-ups, they're just defaults — so the list only carries
 * genuine data-quality issues the operator should clean up upstream.
 */

import type {
  PropertyRow,
  InsertPropertyRow,
  LeaseRow,
  InsertLeaseRow,
  CustomerRow,
  InsertCustomerRow,
  OccupantRow,
  InsertOccupantRow,
  RoomRow,
  InsertRoomRow,
  BedRow,
  InsertBedRow,
  RoomNightLogRow,
  InsertRoomNightLogRow,
  UtilityRow,
  InsertUtilityRow,
} from "@workspace/db";

/**
 * One normalizer-applied coercion. `before` and `after` are the raw
 * value as we saw it (stringified) and the canonical value we wrote
 * back. `field` is the offending column name on the row being
 * normalised.
 */
export interface NormalizerFixup {
  field: string;
  before: string;
  after: string;
}

function asDisplayString(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value;
  return String(value);
}

/**
 * Records a fix-up entry when the normaliser coerced a caller-supplied
 * value into something different. Missing inputs (null / undefined /
 * "") are treated as "no value" and produce no fix-up — the operator
 * only cares about cells that *had* content we had to rewrite.
 */
function recordFixup(
  fixups: NormalizerFixup[] | undefined,
  field: string,
  before: unknown,
  after: unknown,
): void {
  if (!fixups) return;
  if (before === null || before === undefined || before === "") return;
  if (before === after) return;
  fixups.push({
    field,
    before: asDisplayString(before),
    after: asDisplayString(after),
  });
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/**
 * Coerce datetime-style date strings (e.g. `"2026-05-31 00:00:00"` or
 * `"2026-05-31T00:00:00.000Z"`) down to the canonical `YYYY-MM-DD`
 * form the shared schema accepts. Anything we can't recognise is
 * passed through unchanged so the schema's regex still surfaces it as
 * a real bug rather than quietly papering over it.
 */
export function normalizeLeaseDate(value: string | null | undefined): string {
  if (value == null) return "";
  if (value === "") return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const m = value.match(/^(\d{4}-\d{2}-\d{2})[T ]/);
  return m ? m[1] : value;
}

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

const PROPERTY_PAYMENT_METHODS = new Set<string>([
  "",
  "ACH",
  "Check",
  "Wire",
  "Online Portal",
  "Money Order",
  "Invoice",
]);

const PROPERTY_STATUSES = new Set<string>(["Active", "Inactive"]);

const PROPERTY_RENT_FREQUENCIES = new Set<string>([
  "Weekly",
  "Bi-Weekly",
  "Monthly",
]);

const PROPERTY_TYPES = new Set<string>(["Town house", "Apartment", "Motel"]);

/**
 * Coerce the operator-picked property classification (task #501) down
 * to the canonical enum. Anything outside the known set — and any
 * blank string — collapses to `null`, which means "no type recorded
 * yet". Existing rows created before this field existed are stored
 * as `null` and the UI hides the badge accordingly.
 */
function normalizePropertyType(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  return PROPERTY_TYPES.has(trimmed) ? trimmed : null;
}

function normalizePaymentMethod(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (PROPERTY_PAYMENT_METHODS.has(trimmed)) return trimmed;
  return "";
}

function normalizePropertyStatus(value: unknown): "Active" | "Inactive" {
  if (typeof value === "string" && PROPERTY_STATUSES.has(value)) {
    return value as "Active" | "Inactive";
  }
  return "Active";
}

function normalizeRentFrequency(
  value: unknown,
): "Weekly" | "Bi-Weekly" | "Monthly" {
  if (typeof value === "string" && PROPERTY_RENT_FREQUENCIES.has(value)) {
    return value as "Weekly" | "Bi-Weekly" | "Monthly";
  }
  return "Monthly";
}

/**
 * Coerce a notice-period day count into either a non-negative integer
 * or `null`. The schema allows `null` (no notice tracking) so anything
 * we can't read as a non-negative integer collapses to `null` rather
 * than persisting a junk value (Task #492).
 */
export function normalizeNoticePeriodDays(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  if (i < 0) return null;
  return i;
}

/**
 * Normalize a property row (or insert payload) into the canonical
 * shape the openapi `Property` schema accepts. Only fields that have
 * historically caused trouble are touched; everything else is passed
 * through verbatim so partial PATCH payloads keep working.
 */
export function normalizePropertyRow<
  T extends Partial<PropertyRow> | Partial<InsertPropertyRow>,
>(row: T, fixups?: NormalizerFixup[]): T {
  const out: Record<string, unknown> = { ...row };
  if ("paymentMethod" in row) {
    const after = normalizePaymentMethod(row.paymentMethod);
    recordFixup(fixups, "paymentMethod", row.paymentMethod, after);
    out.paymentMethod = after;
  }
  if ("status" in row) {
    const after = normalizePropertyStatus(row.status);
    recordFixup(fixups, "status", row.status, after);
    out.status = after;
  }
  if ("rentFrequency" in row) {
    const after = normalizeRentFrequency(row.rentFrequency);
    recordFixup(fixups, "rentFrequency", row.rentFrequency, after);
    out.rentFrequency = after;
  }
  if ("defaultNoticePeriodDays" in row) {
    const after = normalizeNoticePeriodDays(row.defaultNoticePeriodDays);
    recordFixup(
      fixups,
      "defaultNoticePeriodDays",
      row.defaultNoticePeriodDays,
      after,
    );
    out.defaultNoticePeriodDays = after;
  }
  if ("propertyType" in row) {
    const after = normalizePropertyType(row.propertyType);
    recordFixup(fixups, "propertyType", row.propertyType, after);
    out.propertyType = after;
  }
  // `updated_at` is server-managed (Task #676) — DB triggers bump it
  // on any property or child-row write, so a client value would just
  // be overwritten. Strip it from the payload so an Insert doesn't
  // pin the column to a stale timestamp and an Update doesn't
  // short-circuit the BEFORE UPDATE trigger.
  if ("updatedAt" in out) {
    delete (out as Record<string, unknown>).updatedAt;
  }
  return out as T;
}

// ---------------------------------------------------------------------------
// Leases
// ---------------------------------------------------------------------------

const LEASE_STATUSES = new Set<string>(["Active", "Expired", "Upcoming"]);
const LEASE_RATE_TYPES = new Set<string>(["monthly", "room-night"]);

function normalizeLeaseStatus(
  value: unknown,
): "Active" | "Expired" | "Upcoming" {
  if (typeof value === "string" && LEASE_STATUSES.has(value)) {
    return value as "Active" | "Expired" | "Upcoming";
  }
  return "Active";
}

function normalizeRateType(value: unknown): "monthly" | "room-night" {
  if (typeof value === "string" && LEASE_RATE_TYPES.has(value)) {
    return value as "monthly" | "room-night";
  }
  return "monthly";
}

/**
 * Normalize a lease row (or insert payload). Coerces datetime-style
 * date strings down to `YYYY-MM-DD` (or blank), and any unknown
 * status / rateType label down to a safe default. The lease term
 * dates accept blank in the openapi `OptionalLeaseDate` schema, so
 * `null`/`undefined` is mapped to `""` — never to a fake date.
 */
export function normalizeLeaseRow<
  T extends Partial<LeaseRow> | Partial<InsertLeaseRow>,
>(row: T, fixups?: NormalizerFixup[]): T {
  const out: Record<string, unknown> = { ...row };
  if ("startDate" in row) {
    const after = normalizeLeaseDate(row.startDate as string | null);
    recordFixup(fixups, "startDate", row.startDate, after);
    out.startDate = after;
  }
  if ("endDate" in row) {
    const after = normalizeLeaseDate(row.endDate as string | null);
    recordFixup(fixups, "endDate", row.endDate, after);
    out.endDate = after;
  }
  if ("status" in row) {
    const after = normalizeLeaseStatus(row.status);
    recordFixup(fixups, "status", row.status, after);
    out.status = after;
  }
  if ("rateType" in row) {
    const after = normalizeRateType(row.rateType);
    recordFixup(fixups, "rateType", row.rateType, after);
    out.rateType = after;
  }
  if ("customerId" in row) {
    // Lease-level customer override (Task #439). Both the legacy
    // empty-string sentinel and `null` mean "fall back to the
    // property's customerId" — collapse them both to `null` so the
    // DB never stores "" again. Trim whitespace before checking so a
    // hand-crafted `"   "` payload behaves the same. Not recorded as
    // a fix-up because going from `""` → `null` is a default-shape
    // collapse, not an operator-visible data-quality issue.
    const raw = row.customerId;
    const after =
      typeof raw === "string" && raw.trim() === ""
        ? null
        : raw == null
          ? null
          : raw;
    out.customerId = after;
  }
  if ("snoozedUntil" in row) {
    // Same boundary treatment as the term dates so a datetime-style
    // value (e.g. an XLSX date cell) can't sneak through. Blank means
    // "not snoozed".
    const after = normalizeLeaseDate(row.snoozedUntil as string | null);
    recordFixup(fixups, "snoozedUntil", row.snoozedUntil, after);
    out.snoozedUntil = after;
  }
  if ("noticePeriodDays" in row) {
    const after = normalizeNoticePeriodDays(row.noticePeriodDays);
    recordFixup(fixups, "noticePeriodDays", row.noticePeriodDays, after);
    out.noticePeriodDays = after;
  }
  if ("buildingId" in row) {
    // Lease-level building scope (Task #570). Both blank string and
    // `null` mean "lease is not pinned to a specific building under
    // the property" — collapse blank to `null` so the DB never
    // stores an empty FK. Not a fix-up: a `""` → `null` shape
    // collapse isn't an operator-visible data-quality issue.
    const raw = (row as Record<string, unknown>).buildingId;
    out.buildingId =
      typeof raw === "string" && raw.trim() === ""
        ? null
        : raw == null
          ? null
          : raw;
  }
  return out as T;
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

const CUSTOMER_NO_HOUSING_REASONS = new Set<string>([
  "provided_by_client",
  "kfis_property",
  "all_associates_local",
]);

/**
 * Coerce the operator-picked "why no housing?" reason into the canonical
 * enum (Task #498). Anything outside the known set — and any blank
 * string — collapses to `null`, which means "no reason recorded yet".
 */
function normalizeNoHousingReason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  return CUSTOMER_NO_HOUSING_REASONS.has(trimmed) ? trimmed : null;
}

/**
 * Normalize a customer row. Coerces the `noHousingReason` enum down to
 * the canonical set (Task #498) and otherwise passes through — the
 * remaining customer fields are free-form strings with a `""` default
 * at the schema layer.
 */
export function normalizeCustomerRow<
  T extends Partial<CustomerRow> | Partial<InsertCustomerRow>,
>(row: T, fixups?: NormalizerFixup[]): T {
  const out: Record<string, unknown> = { ...row };
  if ("noHousingReason" in row) {
    const after = normalizeNoHousingReason(row.noHousingReason);
    recordFixup(fixups, "noHousingReason", row.noHousingReason, after);
    out.noHousingReason = after;
  }
  if ("customShifts" in row) {
    const after = normalizeCustomShifts(row.customShifts);
    recordFixup(fixups, "customShifts", row.customShifts, after);
    out.customShifts = after;
  }
  if ("isInactive" in row) {
    // Coerce truthy/falsy values (e.g. "true", 1, "1") into a strict
    // boolean so older callers / loose payloads land on a clean column
    // value. Anything genuinely missing stays missing.
    const raw: unknown = row.isInactive;
    const after =
      raw === true ||
      raw === "true" ||
      raw === 1 ||
      raw === "1";
    recordFixup(fixups, "isInactive", raw, after);
    out.isInactive = after;
  }
  return out as T;
}

/**
 * Normalize a per-customer custom shifts array (Task #506). Drops
 * non-string entries, trims whitespace, removes empty strings, and
 * de-duplicates while preserving the original order. Returns `[]` for
 * any non-array input so the column always carries a clean array.
 */
function normalizeCustomShifts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of value) {
    if (typeof v !== "string") continue;
    const trimmed = v.trim();
    if (trimmed === "") continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Occupants
// ---------------------------------------------------------------------------

const OCCUPANT_STATUSES = new Set<string>(["Active", "Former"]);
const OCCUPANT_BILLING_FREQUENCIES = new Set<string>([
  "Weekly",
  "Biweekly",
  "Monthly",
]);
const OCCUPANT_CHARGE_SOURCES = new Set<string>([
  "",
  "payroll",
  "manual_override",
]);
// Standard shift titles. Per-customer custom titles are *also* accepted
// (Task #506) — the column is free-form text so any non-empty trimmed
// string round-trips, and the standard set is just there for code that
// wants to know whether a value is one of the canonical options.
export const STANDARD_OCCUPANT_SHIFTS = new Set<string>([
  "Days",
  "Nights",
  "Overnights",
]);
// Legacy values from before Task #506 — coerced to the renamed
// canonical "Days"/"Nights" at the read/write boundary so older DB
// rows and import payloads keep round-tripping without a destructive
// migration.
const LEGACY_SHIFT_REMAP: Record<string, string> = {
  "1st": "Days",
  "2nd": "Nights",
};
const OCCUPANT_LANGUAGES = new Set<string>([
  "Bilingual",
  "English only",
  "Spanish only",
  "French only",
  "Other only",
]);
const OCCUPANT_GENDERS = new Set<string>(["Female", "Male"]);
const OCCUPANT_TITLES = new Set<string>([
  "Onsite Supervisor",
  "Onsite Lead",
  "Driver + Associate",
  "Driver ONLY",
  "Associate",
  "Mentor",
]);

function normalizeOccupantLanguage(value: unknown): string | null {
  if (typeof value === "string" && OCCUPANT_LANGUAGES.has(value)) return value;
  return null;
}

function normalizeOccupantGender(value: unknown): string | null {
  if (typeof value === "string" && OCCUPANT_GENDERS.has(value)) return value;
  return null;
}

function normalizeOccupantTitle(value: unknown): string | null {
  if (typeof value === "string" && OCCUPANT_TITLES.has(value)) return value;
  return null;
}

/**
 * Coerce loose driver-license inputs (booleans straight through, plus
 * the common "true"/"false"/"yes"/"no"/"y"/"n" string variants an XLSX
 * import might surface) down to a real boolean. Anything we can't
 * recognise — including missing values — collapses to `null` ("not on
 * file yet") so the importer never throws on a malformed cell.
 */
function normalizeKfisAuthorizedToDrive(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "true" || v === "yes" || v === "y" || v === "1") return true;
    if (v === "false" || v === "no" || v === "n" || v === "0") return false;
  }
  return null;
}

function normalizeOccupantStatus(value: unknown): "Active" | "Former" {
  if (typeof value === "string" && OCCUPANT_STATUSES.has(value)) {
    return value as "Active" | "Former";
  }
  return "Active";
}

function normalizeOccupantBillingFrequency(
  value: unknown,
): "Weekly" | "Biweekly" | "Monthly" {
  if (
    typeof value === "string" &&
    OCCUPANT_BILLING_FREQUENCIES.has(value)
  ) {
    return value as "Weekly" | "Biweekly" | "Monthly";
  }
  return "Monthly";
}

function normalizeChargeSource(
  value: unknown,
): "" | "payroll" | "manual_override" {
  if (typeof value === "string" && OCCUPANT_CHARGE_SOURCES.has(value)) {
    return value as "" | "payroll" | "manual_override";
  }
  return "";
}

function normalizeOccupantShift(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  // One-shot legacy coercion: "1st" → "Days", "2nd" → "Nights"
  // (Task #506). Idempotent because the remap target is itself a
  // canonical value.
  if (Object.prototype.hasOwnProperty.call(LEGACY_SHIFT_REMAP, trimmed)) {
    return LEGACY_SHIFT_REMAP[trimmed]!;
  }
  // Free-form: any non-empty title is accepted so per-customer custom
  // shifts round-trip without needing the normalizer to know about
  // them. The standard set (`STANDARD_OCCUPANT_SHIFTS`) is exposed for
  // callers that want to distinguish canonical vs. custom titles.
  return trimmed;
}

export function normalizeOccupantRow<
  T extends Partial<OccupantRow> | Partial<InsertOccupantRow>,
>(row: T, fixups?: NormalizerFixup[]): T {
  const out: Record<string, unknown> = { ...row };
  // XLSX importers may surface the boolean driver-license column as
  // either the canonical camelCase key (`kfisAuthorizedToDrive`) or
  // the snake_case header (`kfis_authorized_to_drive`). Promote the
  // snake_case alias to the canonical key here so the rest of the
  // normalizer (and the DB insert) only ever sees one shape. We
  // deliberately do not overwrite an existing camelCase value.
  if (
    "kfis_authorized_to_drive" in out &&
    !("kfisAuthorizedToDrive" in out)
  ) {
    const aliased = out["kfis_authorized_to_drive"];
    out.kfisAuthorizedToDrive = normalizeKfisAuthorizedToDrive(aliased);
    delete out["kfis_authorized_to_drive"];
  }
  if ("status" in row) {
    const after = normalizeOccupantStatus(row.status);
    recordFixup(fixups, "status", row.status, after);
    out.status = after;
  }
  if ("billingFrequency" in row) {
    const after = normalizeOccupantBillingFrequency(row.billingFrequency);
    recordFixup(fixups, "billingFrequency", row.billingFrequency, after);
    out.billingFrequency = after;
  }
  if ("chargeSource" in row) {
    const after = normalizeChargeSource(row.chargeSource);
    recordFixup(fixups, "chargeSource", row.chargeSource, after);
    out.chargeSource = after;
  }
  if ("shift" in row) {
    const after = normalizeOccupantShift(row.shift);
    recordFixup(fixups, "shift", row.shift, after);
    out.shift = after;
  }
  if ("moveInDate" in row) {
    const after = normalizeLeaseDate(row.moveInDate as string | null);
    recordFixup(fixups, "moveInDate", row.moveInDate, after);
    out.moveInDate = after;
  }
  if ("moveOutDate" in row) {
    const after = normalizeLeaseDate(row.moveOutDate as string | null);
    recordFixup(fixups, "moveOutDate", row.moveOutDate, after);
    out.moveOutDate = after;
  }
  if ("language" in row) {
    const after = normalizeOccupantLanguage(row.language);
    recordFixup(fixups, "language", row.language, after);
    out.language = after;
  }
  if ("gender" in row) {
    const after = normalizeOccupantGender(row.gender);
    recordFixup(fixups, "gender", row.gender, after);
    out.gender = after;
  }
  if ("title" in row) {
    const after = normalizeOccupantTitle(row.title);
    recordFixup(fixups, "title", row.title, after);
    out.title = after;
  }
  if ("kfisAuthorizedToDrive" in row) {
    const after = normalizeKfisAuthorizedToDrive(row.kfisAuthorizedToDrive);
    recordFixup(
      fixups,
      "kfisAuthorizedToDrive",
      row.kfisAuthorizedToDrive,
      after,
    );
    out.kfisAuthorizedToDrive = after;
  }
  if ("responsibilities" in row) {
    const after = normalizeResponsibilities(
      (row as Record<string, unknown>).responsibilities,
    );
    recordFixup(
      fixups,
      "responsibilities",
      (row as Record<string, unknown>).responsibilities,
      after,
    );
    out.responsibilities = after;
  }
  if ("isLead" in row) {
    const after = Boolean((row as Record<string, unknown>).isLead);
    out.isLead = after;
  }
  if ("keysIssued" in row) {
    const raw = (row as Record<string, unknown>).keysIssued;
    const n = typeof raw === "number" ? raw : Number(raw);
    const after = Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
    recordFixup(fixups, "keysIssued", raw, after);
    out.keysIssued = after;
  }
  return out as T;
}

/**
 * Coerce a `responsibilities` field to a clean array of non-empty
 * trimmed strings (task #500). Anything that isn't an array becomes
 * `[]`. Individual non-string entries are dropped, blank entries are
 * dropped, and duplicates are preserved (order matters to operators).
 */
function normalizeResponsibilities(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const v of value) {
    if (typeof v !== "string") continue;
    const trimmed = v.trim();
    if (trimmed === "") continue;
    out.push(trimmed);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

export function normalizeRoomRow<
  T extends Partial<RoomRow> | Partial<InsertRoomRow>,
>(row: T, _fixups?: NormalizerFixup[]): T {
  const out: Record<string, unknown> = { ...row };
  // buildingId is a free-form FK string. Coerce null/undefined to ""
  // so the schema's `string` type round-trips legacy rows that came
  // from the pre-buildings era (Task #570). The migration is supposed
  // to back-fill every row, but the boundary defence keeps a stray
  // null from blowing up `ListRoomsResponse.parse`.
  if ("buildingId" in row) {
    const raw = (row as Record<string, unknown>).buildingId;
    out.buildingId = typeof raw === "string" ? raw : "";
  }
  return out as T;
}

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------

import type { BuildingRow, InsertBuildingRow } from "@workspace/db";

/**
 * Normalize a building row (Task #570). Free-form text columns get
 * blank-string defaults so a legacy DB row that's missing one of
 * them never trips the schema's required string type.
 */
export function normalizeBuildingRow<
  T extends Partial<BuildingRow> | Partial<InsertBuildingRow>,
>(row: T, _fixups?: NormalizerFixup[]): T {
  const out: Record<string, unknown> = { ...row };
  for (const k of ["propertyId", "name", "address", "city", "state", "zip", "notes"] as const) {
    if (k in row) {
      const raw = (row as Record<string, unknown>)[k];
      out[k] = typeof raw === "string" ? raw : "";
    }
  }
  return out as T;
}

// ---------------------------------------------------------------------------
// Beds
// ---------------------------------------------------------------------------

const BED_STATUSES = new Set<string>(["Occupied", "Vacant"]);
const BED_CLEANING_STATUSES = new Set<string>([
  "occupied",
  "needs_cleaning",
  "in_progress",
  "ready",
]);
export type BedCleaningStatus =
  | "occupied"
  | "needs_cleaning"
  | "in_progress"
  | "ready";

function normalizeBedStatus(value: unknown): "Occupied" | "Vacant" {
  if (typeof value === "string" && BED_STATUSES.has(value)) {
    return value as "Occupied" | "Vacant";
  }
  return "Vacant";
}

function normalizeBedCleaningStatus(value: unknown): BedCleaningStatus | null {
  if (typeof value === "string" && BED_CLEANING_STATUSES.has(value)) {
    return value as BedCleaningStatus;
  }
  return null;
}

export function normalizeBedRow<
  T extends Partial<BedRow> | Partial<InsertBedRow>,
>(row: T, fixups?: NormalizerFixup[]): T {
  const out: Record<string, unknown> = { ...row };
  if ("status" in row) {
    const after = normalizeBedStatus(row.status);
    recordFixup(fixups, "status", row.status, after);
    out.status = after;
  }
  // Cleaning workflow (task #500). When the caller didn't supply a
  // value, derive a sensible default from `status` so a freshly
  // imported / freshly created bed always has a meaningful cleaning
  // state — Occupied → "occupied", Vacant → "ready". Off-list values
  // collapse to that same paired-with-status default so a corrupt
  // row never poisons the response schema's enum check.
  const statusForDerive = (out.status ?? row.status) as
    | "Occupied"
    | "Vacant"
    | undefined;
  const derivedDefault: BedCleaningStatus =
    statusForDerive === "Occupied" ? "occupied" : "ready";
  if ("cleaningStatus" in row) {
    const coerced = normalizeBedCleaningStatus(
      (row as Record<string, unknown>).cleaningStatus,
    );
    const after = coerced ?? derivedDefault;
    recordFixup(
      fixups,
      "cleaningStatus",
      (row as Record<string, unknown>).cleaningStatus,
      after,
    );
    out.cleaningStatus = after;
  } else if (statusForDerive !== undefined) {
    out.cleaningStatus = derivedDefault;
  }
  // An occupied bed should never sit at a vacancy-side cleaning state
  // (and vice versa). Keep the two columns in lock-step on the way
  // through so the UI's "advance cleaning" buttons can rely on the
  // pairing without re-deriving it.
  if (out.status === "Occupied") out.cleaningStatus = "occupied";
  if (out.status === "Vacant" && out.cleaningStatus === "occupied") {
    out.cleaningStatus = "needs_cleaning";
  }
  // `needsCleaningSince` bookkeeping (task #675). When this row write
  // also decides a cleaningStatus, keep the timestamp in lock-step:
  //   - landing on "needs_cleaning" → stamp now() (unless the caller
  //     supplied a value explicitly, e.g. a backfill / import)
  //   - landing on any other state → clear to null
  // When the row write doesn't touch cleaningStatus (a partial PATCH
  // that only updates, say, the room) we leave the column alone so the
  // age keeps accruing.
  const nextCleaningStatus = out.cleaningStatus as
    | BedCleaningStatus
    | undefined;
  const callerProvidedSince = Object.prototype.hasOwnProperty.call(
    row,
    "needsCleaningSince",
  );
  if (nextCleaningStatus !== undefined) {
    if (nextCleaningStatus === "needs_cleaning") {
      if (!callerProvidedSince || (row as Record<string, unknown>).needsCleaningSince == null) {
        out.needsCleaningSince = new Date();
      } else {
        const raw = (row as Record<string, unknown>).needsCleaningSince;
        out.needsCleaningSince = raw instanceof Date ? raw : new Date(String(raw));
      }
    } else {
      out.needsCleaningSince = null;
    }
  } else if (callerProvidedSince) {
    const raw = (row as Record<string, unknown>).needsCleaningSince;
    out.needsCleaningSince =
      raw == null ? null : raw instanceof Date ? raw : new Date(String(raw));
  }
  return out as T;
}

// ---------------------------------------------------------------------------
// Room-night logs
// ---------------------------------------------------------------------------

export function normalizeRoomNightLogRow<
  T extends Partial<RoomNightLogRow> | Partial<InsertRoomNightLogRow>,
>(row: T, _fixups?: NormalizerFixup[]): T {
  return { ...row };
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

const UTILITY_TYPES = new Set<string>([
  "Electric",
  "Gas",
  "Propane",
  "Water",
  "Garbage",
  "Internet",
  "Other",
]);

function normalizeUtilityType(value: unknown): string {
  if (typeof value === "string" && UTILITY_TYPES.has(value)) {
    return value;
  }
  return "Other";
}

export function normalizeUtilityRow<
  T extends Partial<UtilityRow> | Partial<InsertUtilityRow>,
>(row: T, fixups?: NormalizerFixup[]): T {
  const out: Record<string, unknown> = { ...row };
  if ("type" in row) {
    const after = normalizeUtilityType(row.type);
    recordFixup(fixups, "type", row.type, after);
    out.type = after;
  }
  return out as T;
}

// ---------------------------------------------------------------------------
// Vehicles (Transportation)
// ---------------------------------------------------------------------------

import type { VehicleRow, InsertVehicleRow } from "@workspace/db";

const VEHICLE_OWNERSHIPS = new Set<string>(["owned", "leased", "rented"]);
const VEHICLE_STATUSES = new Set<string>([
  "In use",
  "Available",
  "In shop",
  "Out of service",
]);

function normalizeVehicleOwnership(value: unknown): string {
  if (typeof value === "string" && VEHICLE_OWNERSHIPS.has(value)) {
    return value;
  }
  return "owned";
}

function normalizeVehicleStatus(value: unknown): string {
  if (typeof value === "string" && VEHICLE_STATUSES.has(value)) {
    return value;
  }
  return "Available";
}

/**
 * Normalize a vehicle row at the DB ↔ API boundary. Coerces the two
 * enum-ish columns (`ownership`, `status`) to known members so a legacy
 * / hand-crafted value never trips `ListVehiclesResponse.parse`, and
 * keeps the `inShop` flag consistent with a `status === "In shop"`.
 */
export function normalizeVehicleRow<
  T extends Partial<VehicleRow> | Partial<InsertVehicleRow>,
>(row: T, fixups?: NormalizerFixup[]): T {
  const out: Record<string, unknown> = { ...row };
  if ("ownership" in row) {
    const after = normalizeVehicleOwnership(row.ownership);
    recordFixup(fixups, "ownership", row.ownership, after);
    out.ownership = after;
  }
  if ("status" in row) {
    const after = normalizeVehicleStatus(row.status);
    recordFixup(fixups, "status", row.status, after);
    out.status = after;
  }
  // Keep the convenience flag in lock-step with the canonical status so
  // the list filters and the "in shop" badge never disagree.
  if (out.status === "In shop") {
    out.inShop = true;
  } else if ("status" in row && out.status !== "In shop" && !("inShop" in row)) {
    out.inShop = false;
  }
  return out as T;
}
