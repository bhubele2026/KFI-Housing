import { pgTable, text, doublePrecision, timestamp } from "drizzle-orm/pg-core";

/**
 * Itemized fuel-card charges for a vehicle. Each row is one gas-card
 * purchase so operators can see exactly what's being spent per van. The
 * drivers carry gas cards; this is the per-van charge history rolled up
 * on the Vehicles page (and, later, into per-client cost reconciliation).
 */
export const vehicleFuelChargesTable = pgTable("vehicle_fuel_charges", {
  id: text("id").primaryKey(),
  vehicleId: text("vehicle_id").notNull(),
  // Purchase date (YYYY-MM-DD), same convention as the other date columns.
  date: text("date").notNull().default(""),
  // Dollar amount charged.
  amount: doublePrecision("amount").notNull().default(0),
  // Gallons purchased (0 when not recorded).
  gallons: doublePrecision("gallons").notNull().default(0),
  // Where it was purchased (station / merchant name).
  merchant: text("merchant").notNull().default(""),
  // Last 4 of the gas card used, for matching against statements.
  cardLast4: text("card_last4").notNull().default(""),
  note: text("note").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export type VehicleFuelChargeRow = typeof vehicleFuelChargesTable.$inferSelect;
export type InsertVehicleFuelChargeRow =
  typeof vehicleFuelChargesTable.$inferInsert;
