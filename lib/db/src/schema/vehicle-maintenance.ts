import { pgTable, text, doublePrecision, timestamp } from "drizzle-orm/pg-core";

/**
 * Maintenance / repair records for a vehicle. The vehicle row itself
 * carries a quick `repairsNeeded` note and an `inShop` flag; this table
 * is the detailed history — each repair/service/inspection with its cost
 * and status, so operators can see what a van has been through and what's
 * outstanding.
 */
export const vehicleMaintenanceTable = pgTable("vehicle_maintenance", {
  id: text("id").primaryKey(),
  vehicleId: text("vehicle_id").notNull(),
  // When the work was logged / scheduled (YYYY-MM-DD).
  date: text("date").notNull().default(""),
  // "Repair" | "Service" | "Inspection" | "Other".
  type: text("type").notNull().default("Repair"),
  description: text("description").notNull().default(""),
  cost: doublePrecision("cost").notNull().default(0),
  // "Needed" | "In shop" | "Completed".
  status: text("status").notNull().default("Needed"),
  shopName: text("shop_name").notNull().default(""),
  // When the work was completed (YYYY-MM-DD); empty until done.
  completedDate: text("completed_date").notNull().default(""),
  note: text("note").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export type VehicleMaintenanceRow =
  typeof vehicleMaintenanceTable.$inferSelect;
export type InsertVehicleMaintenanceRow =
  typeof vehicleMaintenanceTable.$inferInsert;
