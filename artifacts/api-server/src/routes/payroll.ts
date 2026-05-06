import { Router, type IRouter } from "express";
import { ListUnplacedPayrollResponse } from "@workspace/api-zod";
import { seedHousingDeductions } from "../lib/seed-housing-deductions";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// Re-runs the idempotent payroll → occupant reconciler and returns the
// rows that still don't match any occupant. The seeder only writes when
// a matched occupant's chargePerBed/billingFrequency would change, so
// calling this on every dashboard load is safe — and it guarantees the
// list stays fresh after leasing assigns someone to a bed (the row
// drops off automatically once the seeder's match logic finds them).
router.get("/payroll/unplaced", async (_req, res): Promise<void> => {
  const result = await seedHousingDeductions({ logger });
  res.json(ListUnplacedPayrollResponse.parse(result.unmatched));
});

export default router;
