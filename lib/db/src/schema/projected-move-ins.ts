import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Projected (planned) future move-ins for a property (Task #567).
 *
 * Customers like Interwire plan move-ins weeks in advance — they
 * have a list of names and the date each person is expected to
 * start at housing, but the bed assignment may or may not be
 * finalised yet. This table captures those upcoming arrivals
 * before they actually move in. Once the date arrives and the
 * person physically shows up, the operator clicks "Move them in"
 * which creates the real `occupants` row and stamps
 * `convertedOccupantId` here so the projected entry stays linked
 * to the resulting occupant for audit.
 *
 * Fields:
 *   - `bedId` is nullable — operators often add a row before the
 *     bed assignment is decided.
 *   - `notes` is free-form ("with crew B", "needs ground floor").
 *   - `convertedOccupantId` is null while the entry is still
 *     "projected"; once converted, it points at the new occupant
 *     id and the row is hidden from the active projected list.
 *   - Dates are YYYY-MM-DD to match every other date column in
 *     the schema.
 */
export const projectedMoveInsTable = pgTable("projected_move_ins", {
  id: text("id").primaryKey(),
  propertyId: text("property_id").notNull(),
  personName: text("person_name").notNull().default(""),
  projectedMoveInDate: text("projected_move_in_date").notNull().default(""),
  bedId: text("bed_id"),
  notes: text("notes").notNull().default(""),
  convertedOccupantId: text("converted_occupant_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export type ProjectedMoveInRow = typeof projectedMoveInsTable.$inferSelect;
export type InsertProjectedMoveInRow =
  typeof projectedMoveInsTable.$inferInsert;
