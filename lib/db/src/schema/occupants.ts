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
  // Empty string = manually entered. "payroll" = last set by the housing
  // deduction seeder; in that case the (customer, personId) pair from
  // the payroll export is captured below so the UI can show what payroll
  // row the value came from. Cleared automatically by PATCH /occupants
  // whenever charge or frequency are written manually.
  chargeSource: text("charge_source").notNull().default(""),
  chargeSourceCustomer: text("charge_source_customer").notNull().default(""),
  chargeSourcePersonId: text("charge_source_person_id").notNull().default(""),
});

export type OccupantRow = typeof occupantsTable.$inferSelect;
export type InsertOccupantRow = typeof occupantsTable.$inferInsert;
