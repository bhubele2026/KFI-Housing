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
});

export type CustomerRow = typeof customersTable.$inferSelect;
export type InsertCustomerRow = typeof customersTable.$inferInsert;
