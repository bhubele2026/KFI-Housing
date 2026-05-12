import { pgTable, text, integer, doublePrecision } from "drizzle-orm/pg-core";

export const roomsTable = pgTable("rooms", {
  id: text("id").primaryKey(),
  propertyId: text("property_id").notNull().default(""),
  // Building this room belongs to (Task #570). Empty string when the
  // room hasn't been assigned to a building yet — the
  // `backfill-buildings.ts` migration creates a default building per
  // existing property and backfills this column so every room ends up
  // pointing at a real building. The UI groups rooms by building on
  // the property detail page; new rooms inherit the picker selection
  // (or the property's only building when there's just one).
  buildingId: text("building_id").notNull().default(""),
  name: text("name").notNull().default(""),
  sqft: integer("sqft").notNull().default(0),
  bathrooms: doublePrecision("bathrooms").notNull().default(0),
  monthlyRent: doublePrecision("monthly_rent").notNull().default(0),
});

export type RoomRow = typeof roomsTable.$inferSelect;
export type InsertRoomRow = typeof roomsTable.$inferInsert;
