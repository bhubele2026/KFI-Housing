import { pgTable, text, integer } from "drizzle-orm/pg-core";

export const bedsTable = pgTable("beds", {
  id: text("id").primaryKey(),
  propertyId: text("property_id").notNull(),
  bedNumber: integer("bed_number").notNull().default(1),
  room: text("room").notNull().default(""),
  status: text("status").notNull().default("Vacant"),
  occupantId: text("occupant_id"),
});

export type BedRow = typeof bedsTable.$inferSelect;
export type InsertBedRow = typeof bedsTable.$inferInsert;
