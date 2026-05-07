import { Router, type IRouter } from "express";
import { ListUnplacedPayrollResponse } from "@workspace/api-zod";
import { seedHousingDeductions } from "../lib/seed-housing-deductions";
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
  const result = await seedHousingDeductions({
    logger,
    reclaimOverridden,
    reclaimOccupantIds,
  });
  res.json(
    ListUnplacedPayrollResponse.parse({
      unmatched: result.unmatched,
      lowConfidenceMatches: result.lowConfidenceMatches,
    }),
  );
});

export default router;
