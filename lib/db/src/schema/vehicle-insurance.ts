import { pgTable, text, doublePrecision, timestamp } from "drizzle-orm/pg-core";

/**
 * Commercial auto insurance policies for a vehicle. Mirrors the property
 * `insurance_certificates` table: each row is a policy with a carrier,
 * number, coverage description, premium, and an expiry date that feeds the
 * Vehicles attention strip's expiry alerts.
 */
export const vehicleInsuranceTable = pgTable("vehicle_insurance", {
  id: text("id").primaryKey(),
  vehicleId: text("vehicle_id").notNull(),
  carrier: text("carrier").notNull().default(""),
  policyNumber: text("policy_number").notNull().default(""),
  // Free-text coverage description (e.g. "Liability + Collision").
  coverage: text("coverage").notNull().default(""),
  // Premium amount in dollars (period is operator's convention).
  premium: doublePrecision("premium").notNull().default(0),
  effectiveDate: text("effective_date").notNull().default(""),
  expiryDate: text("expiry_date").notNull().default(""),
  // Optional serving path / URL to the policy document.
  documentUrl: text("document_url").notNull().default(""),
  note: text("note").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export type VehicleInsuranceRow = typeof vehicleInsuranceTable.$inferSelect;
export type InsertVehicleInsuranceRow =
  typeof vehicleInsuranceTable.$inferInsert;
