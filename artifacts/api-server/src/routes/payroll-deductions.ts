import { Router, type IRouter } from "express";
import { and, asc, gte, lte } from "drizzle-orm";
import { db, payrollDeductionsTable } from "@workspace/db";
import { ListPayrollDeductionsResponse } from "@workspace/api-zod";
import { isSaturdayDate } from "../lib/pay-week";

const router: IRouter = Router();

// Per-pay-week housing-deduction snapshots (Task #597). The Finance
// Weekly / Monthly / By Customer tabs and the per-property 13-week
// mini-chart consume server-side rollups under `/api/finance/*`
// instead of re-bucketing this raw list — see routes/finance.ts. This
// endpoint stays around as a low-level audit feed (CSV exports,
// debugging tools, future per-occupant detail views) and is the
// primary read path tests assert against.
//
// `since` / `until` are inclusive Saturday YYYY-MM-DD end-dates; both
// are optional. Bad input (non-string, non-Saturday) is silently
// dropped — the filter just goes unbounded on that side rather than
// 400ing a polling dashboard.
router.get("/payroll-deductions", async (req, res): Promise<void> => {
  const sinceRaw = typeof req.query.since === "string" ? req.query.since : null;
  const untilRaw = typeof req.query.until === "string" ? req.query.until : null;
  const since = sinceRaw && isSaturdayDate(sinceRaw) ? sinceRaw : null;
  const until = untilRaw && isSaturdayDate(untilRaw) ? untilRaw : null;
  const conds = [
    since ? gte(payrollDeductionsTable.payWeekEndDate, since) : null,
    until ? lte(payrollDeductionsTable.payWeekEndDate, until) : null,
  ].filter((c): c is NonNullable<typeof c> => c !== null);
  const rows = await db
    .select()
    .from(payrollDeductionsTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(
      asc(payrollDeductionsTable.payWeekEndDate),
      asc(payrollDeductionsTable.occupantId),
    );
  res.json(ListPayrollDeductionsResponse.parse(rows));
});

export default router;
