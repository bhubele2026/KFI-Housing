import { Router, type IRouter } from "express";
import { ListUnplacedPayrollResponse } from "@workspace/api-zod";

const router: IRouter = Router();

// Read-only endpoint. The bundled-payroll auto-seeder was removed
// (operators now import an Excel deductions file from the Occupants
// page), so there is no in-memory roster to reconcile against on
// each request — `unmatched` and `lowConfidenceMatches` are computed
// per-import inside POST /api/payroll/import-deductions and surfaced
// in that response. The GET endpoint is preserved so existing
// callers keep their response shape and degrade gracefully to empty
// arrays.
router.get("/payroll/unplaced", async (_req, res): Promise<void> => {
  res.json(
    ListUnplacedPayrollResponse.parse({
      unmatched: [],
      lowConfidenceMatches: [],
    }),
  );
});

export default router;
