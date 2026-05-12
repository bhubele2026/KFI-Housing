import {
  pgTable,
  text,
  doublePrecision,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

// Per-bed "current weekly rate" with a roll-forward semantic
// (Task #598 follow-up to #597). Each row records the weekly
// dollar amount that takes effect on a given Saturday pay-week
// (Mon→Sat) and stays in force until a later row supersedes it.
//
// Why per-bed rather than per-occupant? Operators reasoned about
// the rate as a property of the bed: a new occupant moving into
// the bed inherits the rate already set for it, and the rate
// doesn't reset every time the occupant changes. Storing it on
// the bed keeps the history continuous across turnover.
//
// `effectivePayWeekEndDate` is the Saturday end-date of the
// pay-week the rate first applies to (YYYY-MM-DD, treated as a
// calendar day everywhere — no TZ math). Lookup for "what is the
// rate for week W?" is `MAX(effective_pay_week_end_date) ≤ W`.
//
// `(bedId, effective_pay_week_end_date)` is unique so re-saving the
// rate for the same week overwrites the row in place instead of
// creating duplicates the lookup would have to reconcile.
export const bedWeeklyRatesTable = pgTable(
  "bed_weekly_rates",
  {
    id: text("id").primaryKey(),
    bedId: text("bed_id").notNull(),
    effectivePayWeekEndDate: text("effective_pay_week_end_date").notNull(),
    weeklyRate: doublePrecision("weekly_rate").notNull().default(0),
    source: text("source").notNull().default("manual"),
    note: text("note").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    bedWeekUnique: uniqueIndex("bed_weekly_rates_bed_week_unique").on(
      table.bedId,
      table.effectivePayWeekEndDate,
    ),
    bedIdx: index("bed_weekly_rates_bed_idx").on(table.bedId),
  }),
);

export type BedWeeklyRateRow = typeof bedWeeklyRatesTable.$inferSelect;
export type InsertBedWeeklyRateRow = typeof bedWeeklyRatesTable.$inferInsert;
