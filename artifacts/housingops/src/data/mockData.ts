import { z } from "zod";
import { isBlankYMD, parseYMD } from "@/lib/lease-dates";

// ── Property ratings ───────────────────────────────────────────────────
// Each category is a whole-star value 0–5. A value of 0 means "not yet rated"
// and is excluded from the overall average.
export const RATING_CATEGORIES = [
  { key: "landlord",      label: "Landlord" },
  { key: "cleanliness",   label: "Cleanliness" },
  { key: "amenities",     label: "Amenities" },
  { key: "occupants",     label: "Occupants" },
  { key: "location",      label: "Location" },
  { key: "valueForMoney", label: "Value for Money" },
] as const;

export type RatingCategoryKey = typeof RATING_CATEGORIES[number]["key"];

export const RatingsSchema = z.object({
  landlord:      z.number().int().min(0).max(5).default(0),
  cleanliness:   z.number().int().min(0).max(5).default(0),
  amenities:     z.number().int().min(0).max(5).default(0),
  occupants:     z.number().int().min(0).max(5).default(0),
  location:      z.number().int().min(0).max(5).default(0),
  valueForMoney: z.number().int().min(0).max(5).default(0),
});
export type Ratings = z.infer<typeof RatingsSchema>;

export const EMPTY_RATINGS: Ratings = {
  landlord: 0, cleanliness: 0, amenities: 0,
  occupants: 0, location: 0, valueForMoney: 0,
};

/** Average of the non-zero category ratings. Returns null when nothing is rated. */
export function computeOverallRating(ratings?: Ratings | null): number | null {
  if (!ratings) return null;
  const values = RATING_CATEGORIES
    .map(c => ratings[c.key])
    .filter(v => typeof v === "number" && v > 0);
  if (values.length === 0) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  return Math.round((sum / values.length) * 10) / 10;
}

export const CustomerSchema = z.object({
  id: z.string(),
  name: z.string(),
  contactName: z.string(),
  email: z.string(),
  phone: z.string(),
  notes: z.string(),
  // Two-letter US state code (e.g. "WI", "MN"). Empty string when unknown.
  // Marked optional + defaulted so older API payloads (and existing test
  // fixtures) continue to parse without each one having to be updated.
  state: z.string().optional().default(""),
});
export type Customer = z.infer<typeof CustomerSchema>;

export const PropertySchema = z.object({
  id: z.string(),
  customerId: z.string(),
  name: z.string(),
  address: z.string(),
  city: z.string(),
  state: z.string(),
  zip: z.string(),
  totalBeds: z.number(),
  monthlyRent: z.number(),
  chargePerBed: z.number(),
  status: z.enum(["Active", "Inactive"]),
  landlordName: z.string(),
  landlordEmail: z.string(),
  landlordPhone: z.string(),
  // Mirror the OpenAPI enum (task #364): blank covers triage rows
  // whose payment method isn't filled in yet, "Invoice" covers
  // hotel-style corporate-rate agreements (e.g. Ridge Motor Inn).
  paymentMethod: z.enum(["", "ACH", "Check", "Wire", "Online Portal", "Money Order", "Invoice"]),
  paymentRecipient: z.string(),
  paymentDueDay: z.number(),
  rentFrequency: z.enum(["Weekly", "Bi-Weekly", "Monthly"]).optional(),
  paymentNotes: z.string(),
  bankName: z.string(),
  bankRouting: z.string(),
  bankAccount: z.string(),
  portalUrl: z.string(),
  notes: z.string(),
  furnishings: z.array(z.string()).default([]),
  ratings: RatingsSchema.optional(),
  // Additional customer ids that share this property (e.g. Penda + Trienda
  // both housing employees at the Ridge Motor Inn). Optional so legacy
  // backups and seed literals parse cleanly; the API populates it on the
  // wire and callers default to `[]` when reading.
  sharedWithCustomerIds: z.array(z.string()).optional(),
  // Cached geocoded coordinates. Persisted on the server so the
  // portfolio map renders instantly on subsequent loads instead of
  // re-geocoding on every visit. Cleared whenever the address fields
  // change so the next view re-resolves.
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  // Whether the operator has confirmed lat/lng pinpoints the property
  // accurately. Auto-geocoded pins arrive as `false` so the UI can
  // label the marker "approximate location"; cleared back to `false`
  // automatically whenever the address changes.
  coordsVerified: z.boolean().optional(),
});
export type Property = z.infer<typeof PropertySchema>;

// ── Furnishings catalogue ──────────────────────────────────────────────
// Each item is identified by its label string (stored on Property.furnishings).
export interface FurnishingCategory {
  id: string;
  name: string;
  iconName: string; // lucide-react icon name; resolved in the UI
  items: string[];
}

export const FURNISHING_CATEGORIES: FurnishingCategory[] = [
  {
    id: "bedroom",
    name: "Bedroom",
    iconName: "BedDouble",
    items: [
      "Single beds", "Queen beds", "King beds", "Bunk beds",
      "Mattresses", "Mattress protectors", "Pillows", "Bedding & linens",
      "Nightstands", "Dressers", "Wardrobes / Closets",
      "Desk", "Desk chair", "Reading lamps",
    ],
  },
  {
    id: "living",
    name: "Living Room",
    iconName: "Sofa",
    items: [
      "Sofa / Couch", "Loveseat", "Armchairs",
      "Coffee table", "End tables", "Bookshelves",
      "Floor lamps", "Area rug", "Curtains / Blinds",
    ],
  },
  {
    id: "kitchen",
    name: "Kitchen",
    iconName: "Refrigerator",
    items: [
      "Refrigerator", "Freezer", "Stove / Range", "Oven", "Microwave", "Dishwasher",
      "Coffee maker", "Toaster", "Kettle", "Blender",
      "Cookware set", "Dinnerware", "Utensils & cutlery", "Trash can",
    ],
  },
  {
    id: "dining",
    name: "Dining",
    iconName: "Utensils",
    items: ["Dining table", "Dining chairs", "Bar stools"],
  },
  {
    id: "bathroom",
    name: "Bathroom",
    iconName: "Bath",
    items: ["Towels", "Shower curtain", "Bath mat", "Hair dryer", "Toilet plunger"],
  },
  {
    id: "laundry",
    name: "Laundry",
    iconName: "WashingMachine",
    items: ["Washing machine", "Dryer", "Iron", "Ironing board", "Drying rack"],
  },
  {
    id: "climate",
    name: "Climate Control",
    iconName: "Thermometer",
    items: [
      "Central A/C", "Window A/C units", "Central heating",
      "Space heaters", "Ceiling fans", "Smart thermostat",
    ],
  },
  {
    id: "tech",
    name: "Tech & Entertainment",
    iconName: "Tv",
    items: [
      "Wi-Fi", "Smart TV", "Cable / Satellite", "Streaming device",
      "Sound system", "Printer",
    ],
  },
  {
    id: "safety",
    name: "Safety & Security",
    iconName: "ShieldCheck",
    items: [
      "Smoke detectors", "Carbon monoxide detectors", "Fire extinguisher",
      "First aid kit", "Security system", "Smart locks", "Doorbell camera",
    ],
  },
  {
    id: "outdoor",
    name: "Outdoor",
    iconName: "Trees",
    items: ["Patio furniture", "Grill / BBQ", "Fire pit", "Hot tub", "Yard / Garden"],
  },
  {
    id: "amenities",
    name: "Building Amenities",
    iconName: "Building2",
    items: [
      "Gym / Fitness center", "Swimming pool", "Sauna", "Game room",
      "Shared laundry room", "Parking", "Garage", "Bike storage",
      "Elevator", "Rooftop deck", "Concierge",
    ],
  },
  {
    id: "cleaning",
    name: "Cleaning",
    iconName: "Sparkles",
    items: ["Vacuum cleaner", "Mop", "Broom", "Cleaning supplies"],
  },
];

export const ALL_FURNISHINGS_COUNT = FURNISHING_CATEGORIES.reduce(
  (n, c) => n + c.items.length,
  0,
);

export const RentFrequencySchema = z.enum(["Weekly", "Bi-Weekly", "Monthly"]);
export type RentFrequency = z.infer<typeof RentFrequencySchema>;

export const LeaseSchema = z.object({
  id: z.string(),
  propertyId: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  monthlyRent: z.number(),
  securityDeposit: z.number(),
  status: z.enum(["Active", "Expired", "Upcoming"]),
  notes: z.string(),
  // Extended lease fields (task #120). Each is `.optional().default(...)` so
  // backups exported BEFORE this version still parse cleanly: zod fills in
  // the default when the key is absent. The API always returns these fields
  // (the DB columns have defaults), so on the read path the defaults are a
  // no-op — they only matter for legacy import.
  clauses: z.string().optional().default(""),
  buyoutAvailable: z.boolean().optional().default(false),
  buyoutCost: z.number().nullable().optional().default(null),
  // Master-importer fields (task #301). Set on rows whose source cell was
  // ambiguous so operators can see and clean them up later. All `.optional()`
  // with safe defaults so legacy backups (no keys) and the manual create
  // flow (which never sets them) keep parsing.
  weeklyCost: z.number().optional(),
  vendor: z.string().optional(),
  needsReview: z.boolean().optional(),
  // Hotel-rate / room-night agreement fields (task #299). Optional with
  // safe defaults so legacy backups + monthly leases parse unchanged.
  rateType: z.enum(["monthly", "room-night"]).optional().default("monthly"),
  nightlyRate: z.number().optional().default(0),
  guaranteedRooms: z.number().optional().default(0),
  monthlyRoomNightMin: z.number().optional().default(0),
  longStayTaxExempt: z.boolean().optional().default(false),
  // Customer this lease is billed to. Optional so legacy backups and seed
  // literals parse cleanly; the API populates it on the wire. Callers
  // fall back to the parent property's customerId when absent.
  customerId: z.string().optional(),
  // Corporate-responsibility flag (task #313). True when the customer
  // (e.g. KFI Staffing per the 01/22/2026 Chateau Knoll LOI) is on the
  // hook for rent, utilities, and damages on this unit. Optional with a
  // safe default so legacy backups and ordinary occupant-paid leases
  // parse unchanged.
  customerResponsibleForRent: z.boolean().optional().default(false),
  // Apartment-unit identifier inside a multi-unit property (task #310).
  // Optional so legacy backups, manual create flows, and older API
  // clients keep parsing. Treat `undefined` as "no unit".
  unit: z.string().optional(),
  // Snooze date for the dashboard "Lease expiry alerts" card (task #357).
  // YYYY-MM-DD or "" (not snoozed). Optional so legacy backups, seed
  // literals and pre-task #357 API clients keep parsing — the API always
  // returns the field on the wire. Treat `undefined` as "not snoozed"
  // (mirrors `unit`).
  snoozedUntil: z.string().optional(),
});
export type Lease = z.infer<typeof LeaseSchema>;

// Room-night log entry — actual revenue-producing nights consumed against
// a hotel-rate lease in a given month. `month` is `YYYY-MM`.
export const RoomNightLogSchema = z.object({
  id: z.string(),
  leaseId: z.string(),
  month: z.string(),
  roomNights: z.number(),
  notes: z.string(),
});
export type RoomNightLog = z.infer<typeof RoomNightLogSchema>;

// ── Lease aggregation helpers ──────────────────────────────────────────
// Centralized so the property header, finance tab, and any future caller
// agree on what "active rent for this property" means. A property can hold
// more than one Active lease at a time (e.g. renewals overlap, or two
// rooms are leased separately) — the database has always allowed this and
// the UI must sum across them rather than pick "the first match".

/** Every Active lease that belongs to this property, in input order. */
export function getActiveLeasesForProperty(
  leases: readonly Lease[],
  propertyId: string,
): Lease[] {
  return leases.filter(
    (l) => l.propertyId === propertyId && l.status === "Active",
  );
}

/** Sum of `monthlyRent` across every Active lease for the property. */
export function sumActiveRent(
  leases: readonly Lease[],
  propertyId: string,
): number {
  return getActiveLeasesForProperty(leases, propertyId).reduce(
    (s, l) => s + (l.monthlyRent || 0),
    0,
  );
}

/**
 * Every Active lease that the customer is on the hook for (the LOI-style
 * "customer pays the landlord" arrangement, task #313). A lease counts when
 * `customerResponsibleForRent` is true AND its effective customer id matches
 * — `lease.customerId` when present, else the parent property's `customerId`
 * as a fallback so legacy rows imported before the lease-level field existed
 * still attribute correctly.
 */
export function getCustomerResponsibleLeases(
  leases: readonly Lease[],
  properties: readonly Property[],
  customerId: string,
): Lease[] {
  const propertyCustomerById = new Map<string, string>();
  for (const p of properties) propertyCustomerById.set(p.id, p.customerId);
  return leases.filter((l) => {
    if (l.status !== "Active") return false;
    if (!l.customerResponsibleForRent) return false;
    const effective = l.customerId || propertyCustomerById.get(l.propertyId);
    return effective === customerId;
  });
}

/**
 * Sum of `monthlyRent` across every Active lease the customer is responsible
 * for. Hotel-rate leases are intentionally excluded — their rent isn't a
 * fixed monthly obligation, so adding them would inflate the customer's
 * "owes the landlord" liability with revenue that depends on usage.
 */
export function sumCustomerResponsibleRent(
  leases: readonly Lease[],
  properties: readonly Property[],
  customerId: string,
): number {
  return getCustomerResponsibleLeases(leases, properties, customerId).reduce(
    (s, l) => s + ((l.rateType ?? "monthly") === "monthly" ? l.monthlyRent || 0 : 0),
    0,
  );
}

/**
 * Most recent `RoomNightLog` (highest `month`, YYYY-MM) for a lease, or
 * `null` when no entries have been logged. Used by the property page to
 * estimate hotel-rate revenue from the latest billed month.
 */
export function getLatestRoomNightLog(
  logs: readonly RoomNightLog[],
  leaseId: string,
): RoomNightLog | null {
  let latest: RoomNightLog | null = null;
  for (const log of logs) {
    if (log.leaseId !== leaseId) continue;
    if (!latest || log.month > latest.month) latest = log;
  }
  return latest;
}

/**
 * Estimated monthly rent for a single lease, accounting for `rateType`:
 *   - "monthly" leases return their stored `monthlyRent`.
 *   - "room-night" (hotel-rate) leases return `nightlyRate × roomNights`
 *     from the lease's most recent `RoomNightLog`, or `0` when no log
 *     has been recorded yet (so finance numbers don't invent revenue
 *     from thin air).
 * Rounded to cents to keep aggregates free of floating-point noise.
 */
export function estimateLeaseMonthlyRent(
  lease: Lease,
  logs: readonly RoomNightLog[],
): number {
  if ((lease.rateType ?? "monthly") !== "room-night") {
    return lease.monthlyRent || 0;
  }
  const latest = getLatestRoomNightLog(logs, lease.id);
  if (!latest) return 0;
  return (
    Math.round((lease.nightlyRate || 0) * (latest.roomNights || 0) * 100) / 100
  );
}

/**
 * Sum of estimated monthly rent across every Active lease for a property,
 * combining monthly leases (their stored rent) with hotel-rate leases
 * (nightly × the latest logged month's room-nights). Returns the same
 * value as {@link sumActiveRent} when no hotel-rate leases are present.
 */
export function sumActiveRentEstimated(
  leases: readonly Lease[],
  logs: readonly RoomNightLog[],
  propertyId: string,
): number {
  return getActiveLeasesForProperty(leases, propertyId).reduce(
    (s, l) => s + estimateLeaseMonthlyRent(l, logs),
    0,
  );
}

const LEASE_STATUS_ORDER: Record<Lease["status"], number> = {
  Active: 0,
  Upcoming: 1,
  Expired: 2,
};

/**
 * Stable display order for leases: Active first, then Upcoming, then Expired.
 * Within each group, most-recent end date first so the lease most likely to
 * matter (still running / about to renew / just expired) sits at the top.
 * Returns a NEW array — the input is treated as readonly.
 */
export function sortLeases(leases: readonly Lease[]): Lease[] {
  return [...leases].sort((a, b) => {
    const sa = LEASE_STATUS_ORDER[a.status] ?? 99;
    const sb = LEASE_STATUS_ORDER[b.status] ?? 99;
    if (sa !== sb) return sa - sb;
    // Newest end date first within the same status group. localeCompare on
    // YYYY-MM-DD strings is a correct chronological sort.
    return b.endDate.localeCompare(a.endDate);
  });
}

export const RoomSchema = z.object({
  id: z.string(),
  propertyId: z.string(),
  name: z.string(),
  sqft: z.number(),
  bathrooms: z.number(),
  monthlyRent: z.number(),
});
export type Room = z.infer<typeof RoomSchema>;

/**
 * Aggregate room metrics for a property. Returns zeros for an empty list so
 * callers can render placeholders without a separate empty check.
 */
export interface RoomTotals {
  roomCount: number;
  totalSqft: number;
  totalBathrooms: number;
  totalMonthlyRent: number;
}

export function computeRoomTotals(rooms: Room[]): RoomTotals {
  return rooms.reduce<RoomTotals>(
    (acc, r) => ({
      roomCount: acc.roomCount + 1,
      totalSqft: acc.totalSqft + (r.sqft || 0),
      totalBathrooms: acc.totalBathrooms + (r.bathrooms || 0),
      totalMonthlyRent: acc.totalMonthlyRent + (r.monthlyRent || 0),
    }),
    { roomCount: 0, totalSqft: 0, totalBathrooms: 0, totalMonthlyRent: 0 },
  );
}

/**
 * Derived price-per-square-foot for a property's rooms. Returns `null` when
 * either the rent or the sqft total is zero so callers can omit the metric
 * rather than display a misleading `0` or `Infinity`. Rounded to cents.
 */
export function computePricePerSqft(
  totalMonthlyRent: number,
  totalSqft: number,
): number | null {
  if (!totalMonthlyRent || !totalSqft) return null;
  return Math.round((totalMonthlyRent / totalSqft) * 100) / 100;
}

/**
 * Sum of `monthlyCost` across every "Electric" utility for a property.
 * Other utility types (gas, water, internet, etc.) are intentionally
 * excluded — the rent+electric/bed metric is electric-only so callers
 * can compare unit economics consistently.
 */
export function computeMonthlyElectricCost(
  utilities: readonly Utility[],
  propertyId: string,
): number {
  return utilities.reduce(
    (s, u) =>
      u.propertyId === propertyId && u.type === "Electric"
        ? s + (u.monthlyCost || 0)
        : s,
    0,
  );
}

/**
 * Monthly rent divided by the number of beds. Returns `null` when the
 * property has 0 beds so callers can render a dashed placeholder
 * instead of dividing by zero.
 */
export function computeRentPerBed(
  monthlyRent: number,
  bedCount: number,
): number | null {
  if (!bedCount) return null;
  return Math.round((monthlyRent / bedCount) * 100) / 100;
}

/**
 * Monthly Electric utility cost divided by beds — the per-bed share of
 * the electric bill alone. Same `null`-on-zero-beds contract as
 * {@link computeRentPerBed}.
 */
export function computeElectricPerBed(
  monthlyElectricCost: number,
  bedCount: number,
): number | null {
  if (!bedCount) return null;
  return Math.round((monthlyElectricCost / bedCount) * 100) / 100;
}

/**
 * (Monthly rent + total monthly Electric utility cost) divided by beds —
 * the all-in per-bed cost the operator is responsible for each month
 * (rent plus electric utility outlay). Same `null`-on-zero-beds contract
 * as {@link computeRentPerBed}.
 */
export function computeRentPlusElectricPerBed(
  monthlyRent: number,
  monthlyElectricCost: number,
  bedCount: number,
): number | null {
  if (!bedCount) return null;
  return Math.round(((monthlyRent + monthlyElectricCost) / bedCount) * 100) / 100;
}

export const BedSchema = z.object({
  id: z.string(),
  propertyId: z.string(),
  bedNumber: z.number(),
  roomId: z.string(),
  status: z.enum(["Occupied", "Vacant"]),
  occupantId: z.string().nullable(),
});
export type Bed = z.infer<typeof BedSchema>;

export const BILLING_FREQUENCIES = ["Weekly", "Biweekly", "Monthly"] as const;
export type BillingFrequency = typeof BILLING_FREQUENCIES[number];

export const OccupantSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  phone: z.string(),
  bedId: z.string().nullable(),
  propertyId: z.string().nullable(),
  moveInDate: z.string(),
  moveOutDate: z.string().nullable(),
  status: z.enum(["Active", "Former"]),
  chargePerBed: z.number(),
  billingFrequency: z.enum(BILLING_FREQUENCIES).default("Monthly"),
  employeeId: z.string(),
  company: z.string(),
  // Provenance of `chargePerBed` + `billingFrequency`. "" = manual entry,
  // "payroll" = last set by the housing-deduction seeder, "manual_override"
  // = was set by the seeder but a human has since edited charge or
  // frequency (the customer + personId stamps are KEPT in this case so
  // the property-page badge can render "manually overridden — was payroll
  // for cust/person" and accounting can trace the source).
  // Defaulted on the client so older payloads (legacy export imports,
  // older API responses during a deploy) keep parsing.
  chargeSource: z.enum(["", "payroll", "manual_override"]).default(""),
  chargeSourceCustomer: z.string().default(""),
  chargeSourcePersonId: z.string().default(""),
  // Crew shift this occupant works (e.g. "1st", "2nd"). Null for properties
  // where shift assignments don't apply. Surfaced for hot-bedded units like
  // 1850 W. Pine St. Baraboo (task #315).
  shift: z.enum(["1st", "2nd"]).nullable().default(null),
  createdAt: z.string().nullable().optional().default(null),
});
export type Occupant = z.infer<typeof OccupantSchema>;

export function toMonthlyCharge(charge: number, freq: BillingFrequency): number {
  if (freq === "Weekly")   return Math.round(charge * (52 / 12) * 100) / 100;
  if (freq === "Biweekly") return Math.round(charge * (26 / 12) * 100) / 100;
  return charge;
}

// Inverse of `toMonthlyCharge`. Used by the Occupants and per-property
// views to surface a weekly deduction next to its monthly equivalent
// regardless of which cadence the underlying `chargePerBed` was stored
// in. Rounded to cents so the UI never displays floating-point noise.
export function toWeeklyCharge(charge: number, freq: BillingFrequency): number {
  if (freq === "Weekly")   return Math.round(charge * 100) / 100;
  if (freq === "Biweekly") return Math.round((charge / 2) * 100) / 100;
  // Monthly → weekly: monthly * 12 / 52
  return Math.round(charge * (12 / 52) * 100) / 100;
}

// Currency formatter shared by the deduction columns so weekly +
// monthly values render consistently across views.
const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});
export function formatUsd(amount: number): string {
  return USD.format(amount);
}

// ── Lease renewal helpers ──────────────────────────────────────────────
export type RenewalUrgency = "expired" | "critical" | "warning" | "soon" | "ok";

export function daysUntil(dateStr: string): number {
  // Parse YYYY-MM-DD as a *local* calendar date to avoid timezone drift.
  // (`new Date("2025-12-31")` is parsed as UTC midnight, which can shift to
  // a different local day depending on the user's timezone.)
  //
  // `parseYMD` throws loudly on a malformed input (e.g. a stray time
  // suffix or an impossible calendar date) so the renewal pipeline can
  // never silently emit `NaN days left` again — the API boundary is the
  // canonical guard, this is the visible last line of defence.
  const { year, month, day } = parseYMD(dateStr);
  const target = new Date(year, month - 1, day);
  target.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

export interface RenewalInfo {
  level: RenewalUrgency;
  badgeClass: string;
  dotClass: string;
  rowAccentClass: string;
  label: string;
  shortLabel: string;
  days: number;
}

export function getRenewalInfo(endDate: string): RenewalInfo | null {
  // Blank end dates are a legitimate state for leases that are still
  // awaiting triage (master-import rows, the Ridge Motor Inn seed, etc.
  // — see task #359). They have no calendar to compare against, so we
  // return null and let the UI fall back to a neutral "No end date"
  // indicator. `parseYMD` (called transitively via `daysUntil`) still
  // throws loudly on a *non-blank* malformed value so the renewal
  // pipeline can never silently emit `NaN days left` (task #364).
  if (isBlankYMD(endDate)) return null;
  const days = daysUntil(endDate);
  const abs = Math.abs(days);
  const dayWord = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

  if (days < 0) {
    return {
      level: "expired", days,
      badgeClass: "bg-red-100 text-red-800 border-red-200 hover:bg-red-100",
      dotClass: "bg-red-500",
      rowAccentClass: "border-l-4 border-l-red-500",
      label: `Expired ${dayWord(abs)} ago`,
      shortLabel: `−${abs}d`,
    };
  }
  if (days === 0) {
    return {
      level: "critical", days,
      badgeClass: "bg-red-100 text-red-800 border-red-200 hover:bg-red-100",
      dotClass: "bg-red-500",
      rowAccentClass: "border-l-4 border-l-red-500",
      label: "Expires today",
      shortLabel: "Today",
    };
  }
  if (days <= 30) {
    return {
      level: "critical", days,
      badgeClass: "bg-red-100 text-red-800 border-red-200 hover:bg-red-100",
      dotClass: "bg-red-500",
      rowAccentClass: "border-l-4 border-l-red-500",
      label: `${dayWord(days)} left`,
      shortLabel: `${days}d`,
    };
  }
  if (days <= 60) {
    return {
      level: "warning", days,
      badgeClass: "bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100",
      dotClass: "bg-amber-500",
      rowAccentClass: "border-l-4 border-l-amber-500",
      label: `${dayWord(days)} left`,
      shortLabel: `${days}d`,
    };
  }
  if (days <= 90) {
    return {
      level: "soon", days,
      badgeClass: "bg-yellow-100 text-yellow-800 border-yellow-200 hover:bg-yellow-100",
      dotClass: "bg-yellow-500",
      rowAccentClass: "border-l-4 border-l-yellow-500",
      label: `${dayWord(days)} left`,
      shortLabel: `${days}d`,
    };
  }
  return {
    level: "ok", days,
    badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-50",
    dotClass: "bg-emerald-500",
    rowAccentClass: "",
    label: `${dayWord(days)} left`,
    shortLabel: `${days}d`,
  };
}

export const UTILITY_TYPES = ["Electric", "Gas", "Propane", "Water", "Garbage", "Internet", "Other"] as const;
export type UtilityType = typeof UTILITY_TYPES[number];

export const UtilitySchema = z.object({
  id: z.string(),
  propertyId: z.string(),
  type: z.enum(UTILITY_TYPES),
  company: z.string(),
  monthlyCost: z.number(),
  accountNumber: z.string(),
  notes: z.string(),
});
export type Utility = z.infer<typeof UtilitySchema>;

/**
 * Renter's / liability insurance certificate on file for a property
 * (and optionally a specific lease). Mirrors `InsuranceCertificate` in
 * `lib/api-spec/openapi.yaml`. Most fields default to empty strings on
 * the server so older PDFs that only confirm a certificate exists can
 * still be captured.
 */
export const InsuranceCertificateSchema = z.object({
  id: z.string(),
  propertyId: z.string(),
  leaseId: z.string(),
  carrier: z.string(),
  policyNumber: z.string(),
  insuredName: z.string(),
  coverageStart: z.string(),
  coverageEnd: z.string(),
  documentUrl: z.string(),
  notes: z.string(),
});
export type InsuranceCertificate = z.infer<typeof InsuranceCertificateSchema>;

export const MOCK_CUSTOMERS: Customer[] = [
  { id: "c1", name: "Acme Energy",        contactName: "Dana Rivera",  email: "dana.rivera@acme-energy.com",       phone: "512-555-1100", notes: "Long-term oilfield crews. Net-15 invoicing.",            state: "TX" },
  { id: "c2", name: "Frontier Tech",      contactName: "Marcus Lee",   email: "marcus.lee@frontiertech.io",        phone: "214-555-1200", notes: "Rotating consultants and engineers. Prefers monthly billing.", state: "TX" },
  { id: "c3", name: "Sunrise Logistics",  contactName: "Hannah Park",  email: "hannah.park@sunriselogistics.com",  phone: "713-555-1300", notes: "Seasonal warehouse staff. Flexible occupancy needed.",   state: "TX" },
];

export const MOCK_PROPERTIES: Property[] = [
  {
    id: "p1",
    customerId: "c1",
    name: "Oakwood Estates",
    address: "100 Oak Way",
    city: "Austin",
    state: "TX",
    zip: "78701",
    totalBeds: 10,
    monthlyRent: 4800,
    chargePerBed: 800,
    status: "Active",
    landlordName: "James Harrington",
    landlordEmail: "j.harrington@realty.com",
    landlordPhone: "512-555-0101",
    paymentMethod: "ACH",
    paymentRecipient: "Harrington Properties LLC",
    paymentDueDay: 1,
    paymentNotes: "Auto-pay set up via bank. Confirmation email sent to billing@housingops.app.",
    bankName: "First National Bank",
    bankRouting: "021000021",
    bankAccount: "4400123456",
    portalUrl: "",
    notes: "Property manager prefers email contact. Parking included.",
    furnishings: [
      "Queen beds", "Mattresses", "Mattress protectors", "Pillows", "Bedding & linens",
      "Nightstands", "Dressers", "Desk", "Desk chair",
      "Sofa / Couch", "Coffee table", "Area rug",
      "Refrigerator", "Stove / Range", "Microwave", "Dishwasher", "Coffee maker", "Cookware set", "Dinnerware", "Utensils & cutlery",
      "Dining table", "Dining chairs",
      "Towels", "Shower curtain", "Hair dryer",
      "Washing machine", "Dryer",
      "Central A/C", "Central heating", "Smart thermostat",
      "Wi-Fi", "Smart TV", "Streaming device",
      "Smoke detectors", "Carbon monoxide detectors", "Fire extinguisher",
      "Gym / Fitness center", "Swimming pool", "Parking",
      "Vacuum cleaner",
    ],
    ratings: { landlord: 5, cleanliness: 4, amenities: 5, occupants: 4, location: 4, valueForMoney: 3 },
  },
  {
    id: "p2",
    customerId: "c2",
    name: "Maple Lofts",
    address: "200 Maple Dr",
    city: "Austin",
    state: "TX",
    zip: "78702",
    totalBeds: 12,
    monthlyRent: 5400,
    chargePerBed: 750,
    status: "Active",
    landlordName: "Sandra Kim",
    landlordEmail: "sandra.kim@maplerealty.com",
    landlordPhone: "512-555-0202",
    paymentMethod: "Online Portal",
    paymentRecipient: "Maple Realty Group",
    paymentDueDay: 5,
    paymentNotes: "Login to portal by 5th of each month. Late fee after 10th.",
    bankName: "",
    bankRouting: "",
    bankAccount: "",
    portalUrl: "https://portal.maplerealty.com",
    notes: "Utilities included in lease except internet.",
    furnishings: [
      "Single beds", "Bunk beds", "Mattresses", "Pillows", "Bedding & linens",
      "Nightstands", "Wardrobes / Closets",
      "Sofa / Couch", "Coffee table", "Floor lamps",
      "Refrigerator", "Stove / Range", "Microwave", "Coffee maker", "Toaster",
      "Cookware set", "Dinnerware", "Utensils & cutlery", "Trash can",
      "Dining table", "Dining chairs",
      "Towels", "Shower curtain", "Bath mat",
      "Washing machine", "Dryer", "Iron", "Ironing board",
      "Window A/C units", "Central heating", "Ceiling fans",
      "Wi-Fi", "Smart TV",
      "Smoke detectors", "Fire extinguisher",
      "Parking", "Garage", "Elevator",
      "Vacuum cleaner", "Cleaning supplies",
    ],
    ratings: { landlord: 4, cleanliness: 3, amenities: 4, occupants: 3, location: 5, valueForMoney: 4 },
  },
  {
    id: "p3",
    customerId: "c3",
    name: "Pine View",
    address: "300 Pine St",
    city: "Dallas",
    state: "TX",
    zip: "75201",
    totalBeds: 8,
    monthlyRent: 3600,
    chargePerBed: 900,
    status: "Active",
    landlordName: "Robert Tran",
    landlordEmail: "rtran@pinehomes.net",
    landlordPhone: "214-555-0303",
    paymentMethod: "Check",
    paymentRecipient: "Pine Homes Inc",
    paymentDueDay: 1,
    paymentNotes: "Mail check to PO Box 4401, Dallas TX 75201. Make out to Pine Homes Inc.",
    bankName: "",
    bankRouting: "",
    bankAccount: "",
    portalUrl: "",
    notes: "Requires 30-day notice before move-out of any occupant.",
    furnishings: [
      "Single beds", "Mattresses", "Pillows", "Bedding & linens",
      "Nightstands", "Dressers",
      "Sofa / Couch", "Coffee table",
      "Refrigerator", "Stove / Range", "Microwave",
      "Cookware set", "Dinnerware", "Utensils & cutlery", "Trash can",
      "Dining table", "Dining chairs",
      "Towels", "Shower curtain",
      "Washing machine", "Dryer",
      "Window A/C units", "Central heating",
      "Wi-Fi",
      "Smoke detectors", "Fire extinguisher",
      "Parking",
    ],
  },
  {
    id: "p4",
    customerId: "c2",
    name: "Cedar Ridge",
    address: "400 Cedar Ln",
    city: "Dallas",
    state: "TX",
    zip: "75202",
    totalBeds: 15,
    monthlyRent: 7500,
    chargePerBed: 700,
    status: "Active",
    landlordName: "Lisa Moreno",
    landlordEmail: "lisa@cedarprops.com",
    landlordPhone: "214-555-0404",
    paymentMethod: "Wire",
    paymentRecipient: "Cedar Properties LLC",
    paymentDueDay: 3,
    paymentNotes: "Wire transfer by 3rd. Include property ID P4 in memo.",
    bankName: "Chase Bank",
    bankRouting: "021000021",
    bankAccount: "9900556677",
    portalUrl: "",
    notes: "Best rate in portfolio. Lease up for renewal Dec 2025.",
    furnishings: [
      "Queen beds", "King beds", "Mattresses", "Mattress protectors", "Pillows", "Bedding & linens",
      "Nightstands", "Dressers", "Wardrobes / Closets", "Desk", "Desk chair", "Reading lamps",
      "Sofa / Couch", "Loveseat", "Armchairs", "Coffee table", "End tables", "Area rug", "Curtains / Blinds",
      "Refrigerator", "Freezer", "Stove / Range", "Oven", "Microwave", "Dishwasher",
      "Coffee maker", "Toaster", "Kettle", "Cookware set", "Dinnerware", "Utensils & cutlery", "Trash can",
      "Dining table", "Dining chairs", "Bar stools",
      "Towels", "Shower curtain", "Bath mat", "Hair dryer",
      "Washing machine", "Dryer", "Iron", "Ironing board",
      "Central A/C", "Central heating", "Ceiling fans", "Smart thermostat",
      "Wi-Fi", "Smart TV", "Streaming device", "Sound system",
      "Smoke detectors", "Carbon monoxide detectors", "Fire extinguisher", "First aid kit", "Security system", "Smart locks",
      "Patio furniture", "Grill / BBQ", "Yard / Garden",
      "Gym / Fitness center", "Swimming pool", "Game room", "Parking", "Garage", "Bike storage",
      "Vacuum cleaner", "Mop", "Broom", "Cleaning supplies",
    ],
    ratings: { landlord: 5, cleanliness: 5, amenities: 4, occupants: 4, location: 3, valueForMoney: 5 },
  },
  {
    id: "p5",
    customerId: "c3",
    name: "Elm Court",
    address: "500 Elm Rd",
    city: "Houston",
    state: "TX",
    zip: "77001",
    totalBeds: 6,
    monthlyRent: 3000,
    chargePerBed: 1000,
    status: "Inactive",
    landlordName: "Tom Walters",
    landlordEmail: "tom.walters@elmcourt.com",
    landlordPhone: "713-555-0505",
    paymentMethod: "ACH",
    paymentRecipient: "Elm Court Properties",
    paymentDueDay: 1,
    paymentNotes: "On hold — property temporarily inactive.",
    bankName: "Wells Fargo",
    bankRouting: "121000248",
    bankAccount: "1122334455",
    portalUrl: "",
    notes: "Currently inactive. Renovation underway. Expected reopening Q3 2025.",
    furnishings: [
      "Single beds", "Mattresses", "Pillows", "Bedding & linens",
      "Refrigerator", "Stove / Range",
      "Cookware set", "Dinnerware",
      "Smoke detectors", "Fire extinguisher",
    ],
  },
];

const names = [
  "Marcus Johnson", "Priya Sharma", "Tyler Brooks", "Ana Reyes", "Devon Carter",
  "Lena Okafor", "James Wu", "Sofia Diaz", "Elijah Grant", "Mei Lin",
  "Noah Barnes", "Aisha Patel", "Carlos Mendes", "Zoe Fischer", "Dante Mills",
  "Ingrid Sorensen", "Kwame Asante", "Ruby Chen", "Micah Torres", "Nadia Kovacs",
  "Felix Martin", "Camille Dubois", "Jerome Hayes", "Leila Hassan", "Bryce Coleman",
  "Yuki Tanaka", "Amara Ndiaye", "Owen Russell", "Paloma Vega", "Isaac King",
  "Rania Ahmed", "Connor Walsh", "Fatima Ouedraogo", "Patrick Adeyemi", "Eva Novak",
];

const companies = ["Staffco Inc", "BuildRight LLC", "TalentBridge", "ForceWorks", "NexaStaff"];

// ── Rooms layout per property ───────────────────────────────────────────
// Each property has a fixed list of rooms; beds are evenly distributed
// across them in order. The first room of p1 always has id `r_p1_1`, etc.
const ROOM_LAYOUTS: Record<string, { rooms: number; bedsPerRoom: number; sqft: number; bathrooms: number; monthlyRent: number }> = {
  p1: { rooms: 5, bedsPerRoom: 2, sqft: 180, bathrooms: 1,   monthlyRent: 960 },
  p2: { rooms: 6, bedsPerRoom: 2, sqft: 160, bathrooms: 1,   monthlyRent: 900 },
  p3: { rooms: 4, bedsPerRoom: 2, sqft: 200, bathrooms: 1,   monthlyRent: 900 },
  p4: { rooms: 5, bedsPerRoom: 3, sqft: 240, bathrooms: 1.5, monthlyRent: 1500 },
  p5: { rooms: 3, bedsPerRoom: 2, sqft: 150, bathrooms: 1,   monthlyRent: 1000 },
};

export const MOCK_ROOMS: Room[] = Object.entries(ROOM_LAYOUTS).flatMap(([propertyId, layout]) =>
  Array.from({ length: layout.rooms }, (_, r) => ({
    id: `r_${propertyId}_${r + 1}`,
    propertyId,
    name: `Room ${r + 1}`,
    sqft: layout.sqft,
    bathrooms: layout.bathrooms,
    monthlyRent: layout.monthlyRent,
  })),
);

function bedsForProperty(propertyId: string, occupiedCount: number): Bed[] {
  const layout = ROOM_LAYOUTS[propertyId];
  const total = layout.rooms * layout.bedsPerRoom;
  return Array.from({ length: total }, (_, i) => {
    const roomIndex = Math.floor(i / layout.bedsPerRoom);
    return {
      id: `b_${propertyId}_${i + 1}`,
      propertyId,
      bedNumber: i + 1,
      roomId: `r_${propertyId}_${roomIndex + 1}`,
      status: (i < occupiedCount ? "Occupied" : "Vacant") as "Occupied" | "Vacant",
      occupantId: i < occupiedCount ? `o_${propertyId}_${i + 1}` : null,
    };
  });
}

export const MOCK_BEDS: Bed[] = [
  ...bedsForProperty("p1", 8),
  ...bedsForProperty("p2", 10),
  ...bedsForProperty("p3", 6),
  ...bedsForProperty("p4", 12),
  ...bedsForProperty("p5", 0),
];

let nameIdx = 0;
export const MOCK_OCCUPANTS: Occupant[] = MOCK_BEDS
  .filter(b => b.occupantId)
  .map((b) => {
    const prop = MOCK_PROPERTIES.find(p => p.id === b.propertyId)!;
    const name = names[nameIdx % names.length];
    nameIdx++;
    return {
      id: b.occupantId!,
      name,
      email: `${name.split(" ")[0].toLowerCase()}@${prop.id}.worker.com`,
      phone: `512-555-${String(1000 + nameIdx).slice(-4)}`,
      bedId: b.id,
      propertyId: b.propertyId,
      moveInDate: "2024-01-15",
      moveOutDate: null,
      status: "Active" as const,
      chargePerBed: prop.chargePerBed,
      billingFrequency: "Monthly" as BillingFrequency,
      employeeId: `EMP-${String(1000 + nameIdx).slice(-4)}`,
      company: companies[nameIdx % companies.length],
      chargeSource: "",
      chargeSourceCustomer: "",
      chargeSourcePersonId: "",
      shift: null,
      createdAt: null,
    };
  });

const round2 = (n: number) => Math.round(n * 100) / 100;

// Defaults for the extended lease fields. Spread into every mock lease so
// the literals stay short while still satisfying the (now wider) Lease type.
// Real seed data with richer values lives in `api-server/src/lib/seed.ts` —
// this in-memory mock is only used by tests and storybook surfaces that
// don't talk to the API.
const LEASE_EXTENDED_DEFAULTS = {
  clauses: "",
  buyoutAvailable: false,
  buyoutCost: null as number | null,
  rateType: "monthly" as const,
  nightlyRate: 0,
  guaranteedRooms: 0,
  monthlyRoomNightMin: 0,
  longStayTaxExempt: false,
  customerResponsibleForRent: false,
};

export const MOCK_LEASES: Lease[] = [
  { id: "l1", propertyId: "p1", startDate: "2024-01-01", endDate: "2025-12-31", monthlyRent: 4800, securityDeposit: 9600, status: "Active", notes: "2-year term. Auto-renews with 60-day notice.", ...LEASE_EXTENDED_DEFAULTS },
  { id: "l2", propertyId: "p2", startDate: "2024-06-01", endDate: "2025-05-31", monthlyRent: 5400, securityDeposit: 10800, status: "Active", notes: "Utilities included except internet.", ...LEASE_EXTENDED_DEFAULTS },
  { id: "l3", propertyId: "p3", startDate: "2022-01-01", endDate: "2023-12-31", monthlyRent: 3600, securityDeposit: 7200, status: "Expired", notes: "Expired. In renegotiation for renewal.", ...LEASE_EXTENDED_DEFAULTS },
  { id: "l4", propertyId: "p3", startDate: "2024-03-01", endDate: "2026-02-28", monthlyRent: 3800, securityDeposit: 7600, status: "Active", notes: "Renewed at slightly higher rate.", ...LEASE_EXTENDED_DEFAULTS },
  { id: "l5", propertyId: "p4", startDate: "2024-01-01", endDate: "2025-12-31", monthlyRent: 7500, securityDeposit: 15000, status: "Active", notes: "Best rate secured. Locked in 2 years.", ...LEASE_EXTENDED_DEFAULTS },
  { id: "l6", propertyId: "p5", startDate: "2025-09-01", endDate: "2026-08-31", monthlyRent: 3000, securityDeposit: 6000, status: "Upcoming", notes: "Lease signed for reopening post-renovation.", ...LEASE_EXTENDED_DEFAULTS },
];

export const MOCK_UTILITIES: Utility[] = [
  { id: "u-p1-elec", propertyId: "p1", type: "Electric", company: "Austin Energy", monthlyCost: 220, accountNumber: "AE-110234", notes: "Avg based on last 6 months" },
  { id: "u-p1-gas",  propertyId: "p1", type: "Gas",      company: "Atmos Energy",  monthlyCost: 85,  accountNumber: "AT-559812", notes: "" },
  { id: "u-p1-water",propertyId: "p1", type: "Water",    company: "Austin Water",  monthlyCost: 95,  accountNumber: "AW-334410", notes: "" },
  { id: "u-p1-garb", propertyId: "p1", type: "Garbage",  company: "Republic Services", monthlyCost: 45, accountNumber: "RS-00192", notes: "Pickup every Tuesday" },
  { id: "u-p1-inet", propertyId: "p1", type: "Internet", company: "AT&T Fiber",    monthlyCost: 99,  accountNumber: "ATT-8821100", notes: "1Gbps plan" },

  { id: "u-p2-elec", propertyId: "p2", type: "Electric", company: "Austin Energy", monthlyCost: 260, accountNumber: "AE-220345", notes: "" },
  { id: "u-p2-gas",  propertyId: "p2", type: "Gas",      company: "Atmos Energy",  monthlyCost: 90,  accountNumber: "AT-661023", notes: "" },
  { id: "u-p2-water",propertyId: "p2", type: "Water",    company: "Austin Water",  monthlyCost: 110, accountNumber: "AW-441520", notes: "Included in lease — tracking only" },
  { id: "u-p2-garb", propertyId: "p2", type: "Garbage",  company: "Republic Services", monthlyCost: 45, accountNumber: "RS-00193", notes: "" },

  { id: "u-p3-elec", propertyId: "p3", type: "Electric", company: "Oncor / TXU",   monthlyCost: 190, accountNumber: "TXU-773410", notes: "" },
  { id: "u-p3-prop", propertyId: "p3", type: "Propane",  company: "AmeriGas",      monthlyCost: 130, accountNumber: "AG-44512",  notes: "Tank refill ~monthly in winter" },
  { id: "u-p3-water",propertyId: "p3", type: "Water",    company: "Dallas Water",  monthlyCost: 80,  accountNumber: "DW-002211", notes: "" },
  { id: "u-p3-garb", propertyId: "p3", type: "Garbage",  company: "Waste Management", monthlyCost: 50, accountNumber: "WM-55301", notes: "" },
  { id: "u-p3-inet", propertyId: "p3", type: "Internet", company: "Spectrum",      monthlyCost: 89,  accountNumber: "SP-221004", notes: "" },

  { id: "u-p4-elec", propertyId: "p4", type: "Electric", company: "Oncor / TXU",   monthlyCost: 340, accountNumber: "TXU-884521", notes: "" },
  { id: "u-p4-gas",  propertyId: "p4", type: "Gas",      company: "Atmos Energy",  monthlyCost: 120, accountNumber: "AT-772134", notes: "" },
  { id: "u-p4-water",propertyId: "p4", type: "Water",    company: "Dallas Water",  monthlyCost: 145, accountNumber: "DW-003312", notes: "" },
  { id: "u-p4-garb", propertyId: "p4", type: "Garbage",  company: "Waste Management", monthlyCost: 65, accountNumber: "WM-55302", notes: "Two bins, picked up Wednesday" },
  { id: "u-p4-inet", propertyId: "p4", type: "Internet", company: "Spectrum",      monthlyCost: 89,  accountNumber: "SP-221005", notes: "" },

  { id: "u-p5-elec", propertyId: "p5", type: "Electric", company: "CenterPoint",  monthlyCost: 160, accountNumber: "CP-990011", notes: "Property inactive — minimal draw" },
  { id: "u-p5-prop", propertyId: "p5", type: "Propane",  company: "Ferrellgas",   monthlyCost: 95,  accountNumber: "FG-112233", notes: "" },
  { id: "u-p5-water",propertyId: "p5", type: "Water",    company: "Houston Water", monthlyCost: 70,  accountNumber: "HW-445600", notes: "" },
  { id: "u-p5-garb", propertyId: "p5", type: "Garbage",  company: "Republic Services", monthlyCost: 45, accountNumber: "RS-00194", notes: "" },
];
