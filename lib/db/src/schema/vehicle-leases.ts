import { pgTable, text, doublePrecision, timestamp } from "drizzle-orm/pg-core";

/**
 * Lease / rental agreements for a vehicle. A van's quick ownership +
 * monthly-cost figures live on the vehicle row; this table is the full
 * agreement detail (lessor, term, deposit, buyout, deductions) for the
 * leased/rented vans. Mirrors the housing `leases` table for properties.
 */
export const vehicleLeasesTable = pgTable("vehicle_leases", {
  id: text("id").primaryKey(),
  vehicleId: text("vehicle_id").notNull().default(""),
  // Leasing company / lessor.
  lessor: text("lessor").notNull().default(""),
  startDate: text("start_date").notNull().default(""),
  endDate: text("end_date").notNull().default(""),
  monthlyCost: doublePrecision("monthly_cost").notNull().default(0),
  deposit: doublePrecision("deposit").notNull().default(0),
  // Early-termination buyout cost, when offered.
  buyoutCost: doublePrecision("buyout_cost").notNull().default(0),
  // Free-text description of any recurring deductions on this lease.
  deductions: text("deductions").notNull().default(""),
  // "Active" | "Expired" | "Upcoming".
  status: text("status").notNull().default("Active"),
  note: text("note").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export type VehicleLeaseRow = typeof vehicleLeasesTable.$inferSelect;
export type InsertVehicleLeaseRow = typeof vehicleLeasesTable.$inferInsert;
