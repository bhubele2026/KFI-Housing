import { pgTable, text, doublePrecision } from "drizzle-orm/pg-core";

export const utilitiesTable = pgTable("utilities", {
  id: text("id").primaryKey(),
  propertyId: text("property_id").notNull(),
  type: text("type").notNull().default("Other"),
  company: text("company").notNull().default(""),
  monthlyCost: doublePrecision("monthly_cost").notNull().default(0),
  accountNumber: text("account_number").notNull().default(""),
  notes: text("notes").notNull().default(""),
});

export type UtilityRow = typeof utilitiesTable.$inferSelect;
export type InsertUtilityRow = typeof utilitiesTable.$inferInsert;
