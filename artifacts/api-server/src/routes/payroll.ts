import { Router, type IRouter } from "express";
import { ListUnplacedPayrollResponse } from "@workspace/api-zod";
import { seedHousingDeductions } from "../lib/seed-housing-deductions";
import { isSaturdayDate } from "../lib/pay-week";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// Re-runs the idempotent payroll → occupant reconciler and returns
// two lists for the dashboard:
//   - `unmatched`: rows that don't match any occupant (assign-to-bed)
//   - `lowConfidenceMatches`: rows matched only via the fragile
//     name-only fallback (operator should confirm the namesake)
// The seeder only writes when a matched occupant's
// chargePerBed/billingFrequency would change, so calling this on every
// dashboard load is safe — and it guarantees the lists stay fresh
// after leasing assigns someone to a bed or stamps an employeeId (the
// row drops off automatically once the seeder's strong match path
// finds them).
//
// Optional query: `reclaimOverridden=true` (Task #330). By default the
// seeder skips occupants whose `chargeSource === "manual_override"` so
// human edits aren't silently undone. Operators who want payroll to
// take precedence again — typically after re-importing a payroll file
// known to be authoritative — can pass the flag to overwrite those
// rows. Anything other than the literal string "true" (case-insensitive)
// keeps the safe default.
router.get("/payroll/unplaced", async (req, res): Promise<void> => {
  const reclaimOverridden =
    typeof req.query.reclaimOverridden === "string" &&
    req.query.reclaimOverridden.toLowerCase() === "true";
  const reclaimOccupantIds =
    typeof req.query.reclaimOccupantIds === "string" && req.query.reclaimOccupantIds.trim()
      ? req.query.reclaimOccupantIds.split(",").map((id) => id.trim()).filter(Boolean)
      : undefined;
  // Optional pay-week stamp (Task #597). When the operator triggers a
  // re-import for a specific Mon→Sat pay-week, the dashboard sends the
  // Saturday YYYY-MM-DD here so the seeder writes per-week snapshots
  // into `payroll_deductions`. Bad input (non-string, non-Saturday) is
  // dropped silently — the seeder logs a warning and just runs the
  // matcher without snapshotting, so dashboard polls (which omit it)
  // continue to be a cheap no-op on the snapshot table.
  const payWeekEndDate =
    typeof req.query.payWeekEndDate === "string" && isSaturdayDate(req.query.payWeekEndDate)
      ? req.query.payWeekEndDate
      : null;
  const result = await seedHousingDeductions({
    logger,
    reclaimOverridden,
    reclaimOccupantIds,
    payWeekEndDate,
  });
  // Per-import summary for the dashboard toast (Task #597). Only
  // included when a Saturday pay-week was passed AND the seeder
  // actually wrote snapshots — that way background dashboard polls
  // (which omit payWeekEndDate) keep returning the legacy
  // {unmatched, lowConfidenceMatches} shape and don't surface a
  // misleading "Imported 0 deductions" toast.
  const importSummary =
    payWeekEndDate && (result.snapshotsWritten ?? 0) > 0 && result.payWeekEndDate
      ? {
          payWeekEndDate: result.payWeekEndDate,
          deductionsImported: result.snapshotsWritten ?? 0,
          totalAmount: result.snapshotsTotalAmount ?? 0,
        }
      : undefined;
  res.json(
    ListUnplacedPayrollResponse.parse({
      unmatched: result.unmatched,
      lowConfidenceMatches: result.lowConfidenceMatches,
      ...(importSummary ? { importSummary } : {}),
    }),
  );
});

export default router;
