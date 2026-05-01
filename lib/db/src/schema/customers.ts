import { pgTable, text } from "drizzle-orm/pg-core";

export const customersTable = pgTable("customers", {
  id: text("id").primaryKey(),
  name: text("name").notNull().default(""),
  contactName: text("contact_name").notNull().default(""),
  email: text("email").notNull().default(""),
  phone: text("phone").notNull().default(""),
  notes: text("notes").notNull().default(""),
});

export type CustomerRow = typeof customersTable.$inferSelect;
export type InsertCustomerRow = typeof customersTable.$inferInsert;
