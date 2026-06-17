import { Router, type IRouter } from "express";
import { fetchActiveRoster, type ActiveRosterResult } from "../lib/zenople-active-roster";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// Zenople re-auth is capped at 20 token requests/hr and data calls at
// 60/min, so we cache the active roster in-memory and only refresh it
// every 15 minutes (or on ?refresh=1). The roster changes at most once
// per payroll run, so this is plenty fresh.
const CACHE_TTL_MS = 15 * 60 * 1000;
let cache: { at: number; result: ActiveRosterResult } | null = null;

/**
 * GET /roster/active — the active employee roster (active assignments)
 * as of the last payroll run, pulled live from Zenople. This is the
 * pool the Roster page lets an operator place into a property/bed.
 *
 *   ?refresh=1  bypass the 15-minute cache and pull fresh.
 *   ?fields=1   return ONLY {asOf, source, count, fields} — the raw
 *               Zenople field names (no PII) — for diagnosing a
 *               field-name mismatch without exposing employee data.
 */
router.get("/roster/active", async (req, res): Promise<void> => {
  const wantFields = req.query.fields === "1" || req.query.fields === "true";
  const forceRefresh = req.query.refresh === "1" || req.query.refresh === "true";

  try {
    const now = Date.now();
    if (forceRefresh || !cache || now - cache.at > CACHE_TTL_MS) {
      cache = { at: now, result: await fetchActiveRoster(logger) };
    }
    const r = cache.result;
    if (wantFields) {
      res.json({
        asOf: r.asOf,
        source: r.source,
        count: r.people.length,
        fields: r.discoveredFields,
      });
      return;
    }
    res.json({
      asOf: r.asOf,
      source: r.source,
      count: r.people.length,
      people: r.people,
    });
  } catch (err) {
    // Surface a clean, actionable error instead of a 500 stack. The most
    // common causes are missing ZENOPLE_* secrets or a field/window issue.
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.warn({ err }, "Failed to fetch Zenople active roster");
    res.status(502).json({
      error: `Could not load the active roster from Zenople: ${message}`,
      asOf: new Date().toISOString(),
      source: "AssignmentData",
      count: 0,
      people: [],
    });
  }
});

export default router;
