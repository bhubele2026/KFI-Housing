import { pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

// Operator sign-off that a money period (a Mon→Sat pay-week, a month, or a
// quarter) has been reviewed. `periodKey` is whatever the Money review tab
// shows for the period — the Saturday end-date for a week (YYYY-MM-DD), the
// "YYYY-MM" bucket for a month, or "YYYY-Qn" for a quarter — so one row per
// reviewable period. Unique on periodKey makes "Mark reviewed" an idempotent
// upsert (re-marking the same period overwrites the timestamp/note in place).
export const weeklyReviewsTable = pgTable(
  "weekly_reviews",
  {
    id: text("id").primaryKey(),
    periodKey: text("period_key").notNull(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    reviewedBy: text("reviewed_by").notNull().default(""),
    note: text("note").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    periodKeyUnique: uniqueIndex("weekly_reviews_period_key_unique").on(
      table.periodKey,
    ),
  }),
);

export type WeeklyReviewRow = typeof weeklyReviewsTable.$inferSelect;
export type InsertWeeklyReviewRow = typeof weeklyReviewsTable.$inferInsert;
