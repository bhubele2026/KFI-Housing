import { pgTable, text, doublePrecision, boolean } from "drizzle-orm/pg-core";

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
});

export type LeaseRow = typeof leasesTable.$inferSelect;
export type InsertLeaseRow = typeof leasesTable.$inferInsert;
