import { pgTable, text } from "drizzle-orm/pg-core";

export const customersTable = pgTable("customers", {
  id: text("id").primaryKey(),
  name: text("name").notNull().default(""),
  contactName: text("contact_name").notNull().default(""),
  email: text("email").notNull().default(""),
  phone: text("phone").notNull().default(""),
  notes: text("notes").notNull().default(""),
  // US state code (e.g. "WI", "MN", "MO") used to group customers on the
  // Customers page and lock the master-lease import to its correct
  // section header. Empty string when unknown.
  state: text("state").notNull().default(""),
  // Operator-recorded reason explaining why a customer has zero housing
  // managed through HousingOps (Task #498). Nullable: only set when the
  // customer has no associated properties and the operator picked one
  // of the canonical values from the Customers page. Allowed values are
  // enforced at the API + normalizer boundary; the column is plain text
  // so a future reason can be added without a destructive migration.
  noHousingReason: text("no_housing_reason"),
  // Per-customer reusable shift titles (Task #506). Operators add free-form
  // shift names through the bed-row "Add custom shift…" UI; the chosen
  // titles are stored here so they appear as picker options the next time
  // an occupant on one of this customer's properties needs a shift set.
  // Empty array = no per-customer custom shifts; the standard
  // "Days" / "Nights" / "Overnights" options are always available.
  customShifts: text("custom_shifts").array().notNull().default([]),
});

export type CustomerRow = typeof customersTable.$inferSelect;
export type InsertCustomerRow = typeof customersTable.$inferInsert;

/**
 * Canonical reasons an operator can record for a customer that has no
 * housing managed through HousingOps. See Task #498.
 */
export const NO_HOUSING_REASONS = [
  "provided_by_client",
  "kfis_property",
  "all_associates_local",
] as const;
export type NoHousingReason = (typeof NO_HOUSING_REASONS)[number];
