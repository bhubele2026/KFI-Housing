import { Router, type IRouter, type Request, type Response } from "express";
import { resetToSampleData, wipeAllOnly } from "../lib/seed";

const router: IRouter = Router();

/**
 * Production gate for the destructive `/reset` and `/reset/wipe`
 * endpoints (Task #640). Pre-#640 these endpoints had NO auth, NO env
 * gate, and NO confirmation — a stray POST from a script, browser
 * tab, or crawler in production would wipe every business table.
 *
 * Behavior:
 *   - In development the endpoints are unrestricted (tests, sample
 *     resets, and the in-app "Reset sample data" button keep working).
 *   - In production the request must carry an `x-reset-confirm` header
 *     whose value exactly matches the `RESET_CONFIRM_TOKEN` env var.
 *     Mismatch / missing header / missing env var all return 403.
 */
export function isProductionResetBlocked(
  env: NodeJS.ProcessEnv,
  headerValue: string | undefined,
): { allowed: true } | { allowed: false; reason: string } {
  if ((env["NODE_ENV"] ?? "") !== "production") {
    return { allowed: true };
  }
  const expected = (env["RESET_CONFIRM_TOKEN"] ?? "").trim();
  if (expected === "") {
    return {
      allowed: false,
      reason:
        "Refusing to wipe production data: RESET_CONFIRM_TOKEN is not set on the server. " +
        "Set the secret and retry with `x-reset-confirm: <token>`.",
    };
  }
  const provided = (headerValue ?? "").trim();
  if (provided === "" || provided !== expected) {
    return {
      allowed: false,
      reason:
        "Refusing to wipe production data: missing or invalid `x-reset-confirm` header. " +
        "Set the header to the RESET_CONFIRM_TOKEN secret value to confirm.",
    };
  }
  return { allowed: true };
}

function headerString(req: Request, name: string): string | undefined {
  const v = req.header(name);
  return typeof v === "string" ? v : undefined;
}

function guardReset(req: Request, res: Response): boolean {
  const decision = isProductionResetBlocked(
    process.env,
    headerString(req, "x-reset-confirm"),
  );
  if (!decision.allowed) {
    res.status(403).json({ error: decision.reason });
    return false;
  }
  return true;
}

router.post("/reset", async (req, res): Promise<void> => {
  if (!guardReset(req, res)) return;
  await resetToSampleData();
  res.json({ status: "ok" });
});

router.post("/reset/wipe", async (req, res): Promise<void> => {
  if (!guardReset(req, res)) return;
  await wipeAllOnly();
  res.json({ status: "ok" });
});

export default router;
