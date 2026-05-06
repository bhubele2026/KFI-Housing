import { pgTable, text, doublePrecision, boolean, integer } from "drizzle-orm/pg-core";

export const leasesTable = pgTable("leases", {
  id: text("id").primaryKey(),
  propertyId: text("property_id").notNull(),
  startDate: text("start_date").notNull().default(""),
  endDate: text("end_date").notNull().default(""),
  monthlyRent: doublePrecision("monthly_rent").notNull().default(0),
  securityDeposit: doublePrecision("security_deposit").notNull().default(0),
  status: text("status").notNull().default("Active"),
  notes: text("notes").notNull().default(""),
  // Extended lease fields (added with task #120). These are optional in
  // import payloads (see openapi.yaml `Lease`) so older backups still load —
  // the column-level defaults below fill in sensible values for fresh rows
  // and for legacy rows after migration.
  clauses: text("clauses").notNull().default(""),
  buyoutAvailable: boolean("buyout_available").notNull().default(false),
  buyoutCost: doublePrecision("buyout_cost"),
  // Master-lease import fields (task #288). The master spreadsheet
  // tracks rent as a per-week-per-bed amount; `monthlyRent` is the
  // derived monthly equivalent when both are present. `vendor` is the
  // "Housing Vendor for Lease" column from the master file (often
  // distinct from the property's landlord). `needsReview` is set when
  // the source row had ambiguous / TBD / descriptive values that an
  // operator must triage before the lease can be considered active.
  weeklyCost: doublePrecision("weekly_cost").notNull().default(0),
  vendor: text("vendor").notNull().default(""),
  needsReview: boolean("needs_review").notNull().default(false),
  // Hotel/room-night agreement fields (task #299). Most leases are a flat
  // monthly rent (`rateType = "monthly"`); hotel-rate agreements like the
  // Ridge Motor Inn are billed per room-night and use the four fields
  // below instead. Defaults keep monthly leases unchanged.
  rateType: text("rate_type").notNull().default("monthly"),
  nightlyRate: doublePrecision("nightly_rate").notNull().default(0),
  guaranteedRooms: integer("guaranteed_rooms").notNull().default(0),
  monthlyRoomNightMin: integer("monthly_room_night_min").notNull().default(0),
  longStayTaxExempt: boolean("long_stay_tax_exempt").notNull().default(false),
  // Optional override for the tenant on this lease. Leases normally
  // inherit their tenant from `propertiesTable.customerId`, but for
  // shared-housing properties used by multiple customers (e.g. the
  // Ridge Motor Inn shared by Penda + Trienda KFI crews — task #295)
  // each lease points at the specific customer it belongs to so the
  // Leases "By customer" view can show one lease under each. Empty
  // string ("") means "fall back to the property's customerId".
  customerId: text("customer_id").notNull().default(""),
  // Corporate-responsibility flag (task #313). True when the customer
  // (e.g. KFI Staffing per the 01/22/2026 Chateau Knoll LOI) is on the
  // hook for rent, utilities, and damages on this unit — i.e. the
  // landlord bills the customer rather than the occupant. Defaults to
  // false so legacy rows and ordinary occupant-paid leases are unchanged.
  customerResponsibleForRent: boolean("customer_responsible_for_rent")
    .notNull()
    .default(false),
});

export type LeaseRow = typeof leasesTable.$inferSelect;
export type InsertLeaseRow = typeof leasesTable.$inferInsert;
