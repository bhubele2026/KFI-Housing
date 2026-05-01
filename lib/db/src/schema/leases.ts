import { pgTable, text, doublePrecision } from "drizzle-orm/pg-core";

export const leasesTable = pgTable("leases", {
  id: text("id").primaryKey(),
  propertyId: text("property_id").notNull(),
  startDate: text("start_date").notNull().default(""),
  endDate: text("end_date").notNull().default(""),
  monthlyRent: doublePrecision("monthly_rent").notNull().default(0),
  securityDeposit: doublePrecision("security_deposit").notNull().default(0),
  status: text("status").notNull().default("Active"),
  notes: text("notes").notNull().default(""),
});

export type LeaseRow = typeof leasesTable.$inferSelect;
export type InsertLeaseRow = typeof leasesTable.$inferInsert;
