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
  return out as T;
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

/**
 * Normalize a customer row. The `Customer` schema is loose — every
 * field is a free-form string with a `""` default — so today this is
 * mostly a pass-through. Defined as a first-class function anyway so
 * that future fields with stricter contracts (e.g. an enum on
 * customer type) automatically get the same boundary treatment, and
 * accepts the same optional `fixups` collector for symmetry with the
 * other normalisers.
 */
export function normalizeCustomerRow<
  T extends Partial<CustomerRow> | Partial<InsertCustomerRow>,
>(row: T, _fixups?: NormalizerFixup[]): T {
  return { ...row };
}
