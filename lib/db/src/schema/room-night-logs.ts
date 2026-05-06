import { pgTable, text, integer } from "drizzle-orm/pg-core";

/**
 * Room-night log (task #299). Lets staff record actual nights consumed per
 * month against a hotel-rate lease (`leases.rateType = "room-night"`). One
 * row per (leaseId, month). `month` is `YYYY-MM`. `roomNights` is a count.
 */
export const roomNightLogsTable = pgTable("room_night_logs", {
  id: text("id").primaryKey(),
  leaseId: text("lease_id").notNull(),
  month: text("month").notNull().default(""),
  roomNights: integer("room_nights").notNull().default(0),
  notes: text("notes").notNull().default(""),
});

export type RoomNightLogRow = typeof roomNightLogsTable.$inferSelect;
export type InsertRoomNightLogRow = typeof roomNightLogsTable.$inferInsert;
