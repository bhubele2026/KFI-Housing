import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Static "default" rider roster — which associates (occupants) a given
 * vehicle regularly transports. One row per (vehicle, occupant). This is
 * the baseline the per-client / per-lease transport list reads from:
 * for each van it can show the driver plus the set of associates it
 * normally carries.
 *
 * Riders are occupants, the same entity used for housing — so a rider's
 * housing (bed / property / customer) is available for free, and the
 * same person can be both a driver of one van and a rider of another.
 *
 * Day-to-day exceptions (someone rode a different van today, or didn't
 * ride at all) are NOT edited here — they live in
 * `vehicle_ride_overrides` so the default roster stays stable.
 */
export const vehicleRidersTable = pgTable("vehicle_riders", {
  id: text("id").primaryKey(),
  vehicleId: text("vehicle_id").notNull(),
  occupantId: text("occupant_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export type VehicleRiderRow = typeof vehicleRidersTable.$inferSelect;
export type InsertVehicleRiderRow = typeof vehicleRidersTable.$inferInsert;

/**
 * Per-day exceptions to the static roster. The effective roster for a
 * vehicle on date D is:
 *
 *   (static riders of the vehicle, minus those with a "remove" override
 *    for D) ∪ (occupants with an "add" override for the vehicle on D)
 *
 * `action` is "add" or "remove". `date` is a `YYYY-MM-DD` string (same
 * convention as the lease / move-in date columns). One row per
 * (vehicle, occupant, date); re-recording the same exception updates the
 * existing row rather than stacking duplicates.
 */
export const vehicleRideOverridesTable = pgTable("vehicle_ride_overrides", {
  id: text("id").primaryKey(),
  vehicleId: text("vehicle_id").notNull(),
  occupantId: text("occupant_id").notNull(),
  date: text("date").notNull().default(""),
  action: text("action").notNull().default("add"),
  note: text("note").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export type VehicleRideOverrideRow =
  typeof vehicleRideOverridesTable.$inferSelect;
export type InsertVehicleRideOverrideRow =
  typeof vehicleRideOverridesTable.$inferInsert;
