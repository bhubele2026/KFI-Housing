import { pgTable, text, integer, doublePrecision } from "drizzle-orm/pg-core";

export const propertiesTable = pgTable("properties", {
  id: text("id").primaryKey(),
  name: text("name").notNull().default(""),
  address: text("address").notNull().default(""),
  city: text("city").notNull().default(""),
  state: text("state").notNull().default(""),
  zip: text("zip").notNull().default(""),
  totalBeds: integer("total_beds").notNull().default(0),
  monthlyRent: doublePrecision("monthly_rent").notNull().default(0),
  chargePerBed: doublePrecision("charge_per_bed").notNull().default(0),
  status: text("status").notNull().default("Active"),
  landlordName: text("landlord_name").notNull().default(""),
  landlordEmail: text("landlord_email").notNull().default(""),
  landlordPhone: text("landlord_phone").notNull().default(""),
  paymentMethod: text("payment_method").notNull().default("ACH"),
  paymentRecipient: text("payment_recipient").notNull().default(""),
  paymentDueDay: integer("payment_due_day").notNull().default(1),
  paymentNotes: text("payment_notes").notNull().default(""),
  bankName: text("bank_name").notNull().default(""),
  bankRouting: text("bank_routing").notNull().default(""),
  bankAccount: text("bank_account").notNull().default(""),
  portalUrl: text("portal_url").notNull().default(""),
  notes: text("notes").notNull().default(""),
  furnishings: text("furnishings").array().notNull().default([]),
  customerId: text("customer_id").notNull().default(""),
});

export type PropertyRow = typeof propertiesTable.$inferSelect;
export type InsertPropertyRow = typeof propertiesTable.$inferInsert;
