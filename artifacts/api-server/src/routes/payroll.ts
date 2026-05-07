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
router.get("/payroll/unplaced", async (_req, res): Promise<void> => {
  const result = await seedHousingDeductions({ logger });
  res.json(
    ListUnplacedPayrollResponse.parse({
      unmatched: result.unmatched,
      lowConfidenceMatches: result.lowConfidenceMatches,
    }),
  );
});

export default router;
