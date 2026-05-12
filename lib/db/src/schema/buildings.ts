import { pgTable, text } from "drizzle-orm/pg-core";

/**
 * A Building is a physical address that belongs to a Property.
 * Properties can have one (the common case — `Property.address` mirrors
 * the default building) or many buildings (e.g. Schuette Metals with
 * 1331 & 1341 S 8th Ave). The hierarchy is:
 *
 *   Customer → Property → Building → Room → Bed
 *
 * Existing single-address properties get a single backfilled building
 * via `lib/db/src/migrations/backfill-buildings.ts` so every Room and
 * Lease can be linked to a real building id.
 */
export const buildingsTable = pgTable("buildings", {
  id: text("id").primaryKey(),
  propertyId: text("property_id").notNull().default(""),
  name: text("name").notNull().default(""),
  address: text("address").notNull().default(""),
  city: text("city").notNull().default(""),
  state: text("state").notNull().default(""),
  zip: text("zip").notNull().default(""),
  notes: text("notes").notNull().default(""),
});

export type BuildingRow = typeof buildingsTable.$inferSelect;
export type InsertBuildingRow = typeof buildingsTable.$inferInsert;
