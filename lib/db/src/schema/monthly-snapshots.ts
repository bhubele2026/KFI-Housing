import {
  pgTable,
  text,
  doublePrecision,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";

// Admin-locked snapshot of a *closed* calendar month's headline numbers.
//
// Once an admin closes a month from the dashboard period picker, the
// live-computed Recovered / Rent + Utilities / Net values are frozen
// here and the dashboard reads from this row instead of recomputing.
// That guarantees historical months don't drift when someone later
// backfills a payroll deduction or edits a lease.
//
// `yyyymm` is the calendar-month key (e.g. "2026-04"). Re-opening a
// month deletes the row; re-closing recomputes and inserts. We keep
// `closedByEmail` denormalised so the audit trail survives even if
// the user record is later removed from the team allowlist.
export const monthlySnapshotsTable = pgTable("monthly_snapshots", {
  yyyymm: text("yyyymm").primaryKey(),
  recovered: doublePrecision("recovered").notNull().default(0),
  rentPaid: doublePrecision("rent_paid").notNull().default(0),
  utilities: doublePrecision("utilities").notNull().default(0),
  otherCosts: doublePrecision("other_costs").notNull().default(0),
  net: doublePrecision("net").notNull().default(0),
  occupancyAvg: doublePrecision("occupancy_avg").notNull().default(0),
  totalBeds: integer("total_beds").notNull().default(0),
  closedAt: timestamp("closed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  closedByUserId: text("closed_by_user_id").notNull().default(""),
  closedByEmail: text("closed_by_email").notNull().default(""),
});

export type MonthlySnapshotRow = typeof monthlySnapshotsTable.$inferSelect;
export type InsertMonthlySnapshotRow =
  typeof monthlySnapshotsTable.$inferInsert;
