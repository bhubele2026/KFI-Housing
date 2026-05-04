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
});

export type LeaseRow = typeof leasesTable.$inferSelect;
export type InsertLeaseRow = typeof leasesTable.$inferInsert;
