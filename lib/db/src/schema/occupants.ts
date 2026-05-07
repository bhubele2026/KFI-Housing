import { pgTable, text, doublePrecision } from "drizzle-orm/pg-core";

export const occupantsTable = pgTable("occupants", {
  id: text("id").primaryKey(),
  name: text("name").notNull().default(""),
  email: text("email").notNull().default(""),
  phone: text("phone").notNull().default(""),
  bedId: text("bed_id"),
  propertyId: text("property_id"),
  moveInDate: text("move_in_date").notNull().default(""),
  moveOutDate: text("move_out_date"),
  status: text("status").notNull().default("Active"),
  chargePerBed: doublePrecision("charge_per_bed").notNull().default(0),
  billingFrequency: text("billing_frequency").notNull().default("Monthly"),
  employeeId: text("employee_id").notNull().default(""),
  company: text("company").notNull().default(""),
  // Provenance of the current `chargePerBed` + `billingFrequency` values.
  // Empty string  = manually entered, no payroll history.
  // "payroll"     = last set by the housing-deduction seeder.
  // "manual_override" = the seeder originally set the value, but a human
  //                 has since edited charge/frequency. The
  //                 chargeSourceCustomer + chargeSourcePersonId stamps
  //                 are KEPT in this case so the UI can render
  //                 "manually overridden — was payroll for cust/person"
  //                 and accounting can trace the original payroll link.
  // PATCH /occupants does this transition automatically (see
  // routes/occupants.ts) so the UI never has to set chargeSource
  // explicitly. The seeder skips "manual_override" rows by default;
  // pass `reclaimOverridden: true` to make it re-claim them.
  chargeSource: text("charge_source").notNull().default(""),
  chargeSourceCustomer: text("charge_source_customer").notNull().default(""),
  chargeSourcePersonId: text("charge_source_person_id").notNull().default(""),
  // Crew shift this occupant works (e.g. "1st", "2nd"). Null for properties
  // where shift assignments don't apply (most of the portfolio). Surfaced
  // for hot-bedded units like 1850 W. Pine St. Baraboo where bedrooms are
  // shared across two shifts (task #315).
  shift: text("shift"),
});

export type OccupantRow = typeof occupantsTable.$inferSelect;
export type InsertOccupantRow = typeof occupantsTable.$inferInsert;
