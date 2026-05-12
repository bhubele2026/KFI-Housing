import {
  pgTable,
  text,
  doublePrecision,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

// Per-pay-week snapshot of an occupant's weekly housing deduction.
//
// Why a separate table instead of just trusting `occupants.chargePerBed`?
// `chargePerBed` is a *cache* of the most recent payroll value (so the
// existing UI doesn't need to fan out per-week queries). It overwrites
// itself on every payroll re-import, so historical weeks are lost.
// `payroll_deductions` keeps an immutable per-week record so the new
// Finance tabs (Weekly / Monthly / By Customer) can reconstruct what
// actually deducted on a specific Mon→Sat pay-week, and the per-property
// finance mini-chart can show a 13-week trailing trend.
//
// `payWeekEndDate` is the Saturday end-date of the Mon→Sat pay-week
// (YYYY-MM-DD, treated as a calendar-day string everywhere — no TZ math).
// `customerId` and `propertyId` are denormalized snapshots taken at
// import time so historical rollups stay correct even if the occupant
// later moves to a different property / employer.
//
// The composite unique index on (occupantId, payWeekEndDate) makes the
// importer's upsert safe and idempotent: re-importing the same payroll
// file for the same week overwrites the snapshot rows in place instead
// of duplicating them.
export const payrollDeductionsTable = pgTable(
  "payroll_deductions",
  {
    id: text("id").primaryKey(),
    occupantId: text("occupant_id").notNull(),
    customerId: text("customer_id").notNull().default(""),
    propertyId: text("property_id").notNull().default(""),
    payWeekEndDate: text("pay_week_end_date").notNull(),
    weeklyAmount: doublePrecision("weekly_amount").notNull().default(0),
    personId: text("person_id").notNull().default(""),
    nameSnapshot: text("name_snapshot").notNull().default(""),
    customerSnapshot: text("customer_snapshot").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    occupantWeekUnique: uniqueIndex("payroll_deductions_occupant_week_unique").on(
      table.occupantId,
      table.payWeekEndDate,
    ),
    weekIdx: index("payroll_deductions_week_idx").on(table.payWeekEndDate),
    customerWeekIdx: index("payroll_deductions_customer_week_idx").on(
      table.customerId,
      table.payWeekEndDate,
    ),
  }),
);

export type PayrollDeductionRow = typeof payrollDeductionsTable.$inferSelect;
export type InsertPayrollDeductionRow = typeof payrollDeductionsTable.$inferInsert;
