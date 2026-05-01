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
});

export type OccupantRow = typeof occupantsTable.$inferSelect;
export type InsertOccupantRow = typeof occupantsTable.$inferInsert;
