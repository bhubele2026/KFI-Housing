import { Router, type IRouter } from "express";
import { seedHousingDeductions } from "../lib/seed-housing-deductions";
import { recomputeZenopleLinkStatus } from "../lib/zenople-link-status";
import { fetchHousingDeductionsByWeek } from "../lib/zenople-client";
import {
  isSaturdayDate,
  mostRecentSaturday,
  trailingPayWeeks,
} from "../lib/pay-week";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const DEFAULT_WEEKS = 13;
const MAX_WEEKS = 104;

// Pull weekly housing deductions straight from Zenople and feed them
// into the same `seedHousingDeductions` pipeline the manual XLSX import
// uses. This is the API-driven replacement for exporting a spreadsheet
// from Zenople and uploading it on the Occupants page.
//
// Query params:
//   * `weeks`  — number of trailing Mon→Sat pay-weeks to sync
//                (default 13, clamped to 1..104). Ignored when both
//                `since` and `until` are supplied.
//   * `since` / `until` — explicit inclusive Saturday YYYY-MM-DD
//                end-dates to bound the sync window.
//
// Each pay-week found in the requested range is handed to the seeder in
// chronological order, so the most recent week wins the occupant
// `chargePerBed` cache. Snapshots are upserted idempotently on
// (occupantId, payWeekEndDate) — re-running is safe.
router.post(
  "/payroll/sync-zenople-deductions",
  async (req, res): Promise<void> => {
    try {
      const sinceRaw =
        typeof req.query.since === "string" ? req.query.since : null;
      const untilRaw =
        typeof req.query.until === "string" ? req.query.until : null;

      let sinceSat: string;
      let untilSat: string;
      if (
        sinceRaw &&
        untilRaw &&
        isSaturdayDate(sinceRaw) &&
        isSaturdayDate(untilRaw)
      ) {
        sinceSat = sinceRaw <= untilRaw ? sinceRaw : untilRaw;
        untilSat = sinceRaw <= untilRaw ? untilRaw : sinceRaw;
      } else {
        const weeksRaw = Number(req.query.weeks);
        const weeks =
          Number.isFinite(weeksRaw) && weeksRaw >= 1
            ? Math.min(Math.floor(weeksRaw), MAX_WEEKS)
            : DEFAULT_WEEKS;
        untilSat = mostRecentSaturday();
        const span = trailingPayWeeks(weeks, untilSat);
        sinceSat = span[0] ?? untilSat;
      }

      const buckets = await fetchHousingDeductionsByWeek(sinceSat, untilSat);

      let snapshotsWritten = 0;
      let totalAmount = 0;
      let totalRows = 0;
      const unmatchedPersonIds = new Set<string>();
      const lowConfidencePersonIds = new Set<string>();
      // Occupants matched only via the fragile name-only fallback -> flagged
      // needs_review by the Stage 3c link-status recompute below.
      const lowConfidenceOccupantIds = new Set<string>();
      const weeks: Array<{
        payWeekEndDate: string;
        deductionsImported: number;
        totalAmount: number;
        unmatchedCount: number;
      }> = [];

      for (const bucket of buckets) {
        totalRows += bucket.rows.length;
        const result = await seedHousingDeductions({
          logger,
          rows: bucket.rows,
          payWeekEndDate: bucket.payWeekEndDate,
        });
        snapshotsWritten += result.snapshotsWritten;
        totalAmount += result.snapshotsTotalAmount;
        for (const u of result.unmatched) unmatchedPersonIds.add(u.personId);
        for (const lc of result.lowConfidenceMatches) {
          lowConfidencePersonIds.add(lc.personId);
          if (lc.matched?.occupantId) {
            lowConfidenceOccupantIds.add(lc.matched.occupantId);
          }
        }
        weeks.push({
          payWeekEndDate: bucket.payWeekEndDate,
          deductionsImported: result.snapshotsWritten,
          totalAmount: result.snapshotsTotalAmount,
          unmatchedCount: result.unmatched.length,
        });
      }

      // Stage 3c: now that the deductions are written, recompute every
      // occupant's Zenople link status from them (re-runnable; promotes
      // not_in_zenople -> linked as people appear in payroll).
      const linkStatus = await recomputeZenopleLinkStatus({
        logger,
        needsReviewOccupantIds: [...lowConfidenceOccupantIds],
      });

      res.json({
        sinceSat,
        untilSat,
        weeksProcessed: buckets.length,
        rowsFetched: totalRows,
        deductionsImported: snapshotsWritten,
        totalAmount: Math.round(totalAmount * 100) / 100,
        unmatchedCount: unmatchedPersonIds.size,
        lowConfidenceCount: lowConfidencePersonIds.size,
        linkStatus,
        weeks,
      });
    } catch (err) {
      logger.error({ err }, "Zenople housing deduction sync failed");
      const message = err instanceof Error ? err.message : String(err);
      // Configuration / upstream auth problems are the operator's to fix;
      // surface the message so the UI toast is actionable.
      const status = /not configured|auth failed/i.test(message) ? 502 : 500;
      res.status(status).json({ error: message });
    }
  },
);

export default router;
