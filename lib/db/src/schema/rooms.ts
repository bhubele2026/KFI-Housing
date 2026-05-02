import { pgTable, text, integer, doublePrecision } from "drizzle-orm/pg-core";

export const roomsTable = pgTable("rooms", {
  id: text("id").primaryKey(),
  propertyId: text("property_id").notNull().default(""),
  name: text("name").notNull().default(""),
  sqft: integer("sqft").notNull().default(0),
  bathrooms: doublePrecision("bathrooms").notNull().default(0),
  monthlyRent: doublePrecision("monthly_rent").notNull().default(0),
});

export type RoomRow = typeof roomsTable.$inferSelect;
export type InsertRoomRow = typeof roomsTable.$inferInsert;
