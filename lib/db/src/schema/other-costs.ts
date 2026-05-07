import { pgTable, text, doublePrecision } from "drizzle-orm/pg-core";

export const otherCostsTable = pgTable("other_costs", {
  id: text("id").primaryKey(),
  propertyId: text("property_id").notNull(),
  label: text("label").notNull().default(""),
  monthlyCost: doublePrecision("monthly_cost").notNull().default(0),
});

export type OtherCostRow = typeof otherCostsTable.$inferSelect;
export type InsertOtherCostRow = typeof otherCostsTable.$inferInsert;
