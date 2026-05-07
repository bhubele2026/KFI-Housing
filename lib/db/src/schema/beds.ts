import { pgTable, text, integer } from "drizzle-orm/pg-core";

export const bedsTable = pgTable("beds", {
  id: text("id").primaryKey(),
  propertyId: text("property_id").notNull(),
  bedNumber: integer("bed_number").notNull().default(1),
  roomId: text("room_id").notNull().default(""),
  status: text("status").notNull().default("Vacant"),
  occupantId: text("occupant_id"),
  // Cleaning workflow status (task #500). Values:
  //   "occupied"       — bed is currently occupied (mirrors status="Occupied").
  //   "needs_cleaning" — occupant just moved out, room turnover not started.
  //   "in_progress"    — staff is actively cleaning.
  //   "ready"          — clean and available for a new placement.
  // Only "ready" beds are offered up to new occupants. The API set this
  // to "needs_cleaning" automatically when an occupant is removed or
  // moved out, and operators advance it from there. Defaults to "ready"
  // so existing vacant beds continue to be assignable, and the
  // boundary normaliser pairs it with `status` so an occupied row is
  // always reported as "occupied" regardless of what's persisted.
  cleaningStatus: text("cleaning_status").notNull().default("ready"),
});

export type BedRow = typeof bedsTable.$inferSelect;
export type InsertBedRow = typeof bedsTable.$inferInsert;
