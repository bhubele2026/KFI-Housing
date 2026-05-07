import { pgTable, text } from "drizzle-orm/pg-core";

export const schedulerStateTable = pgTable("scheduler_state", {
  id: text("id").primaryKey(),
  lastSentKey: text("last_sent_key").notNull().default(""),
});

export type SchedulerStateRow = typeof schedulerStateTable.$inferSelect;
export type InsertSchedulerStateRow = typeof schedulerStateTable.$inferInsert;
