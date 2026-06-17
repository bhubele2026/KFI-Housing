import { Router, type IRouter } from "express";
import {
  fetchLastPayrollPeople,
  fetchActiveRoster,
} from "../lib/zenople-active-roster";
import { fetchHousingDeductionsByWeek } from "../lib/zenople-client";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// Cache the composed roster in-memory (Zenople re-auth is capped at
// 20/hr). The roster changes at most once per payroll run.
const CACHE_TTL_MS = 15 * 60 * 1000;

interface RosterPerson {
  personId: string;
  name: string;
  company: string;
  jobTitle: string;
  hasDeduction: boolean;
  weeklyDeduction: number;
}
interface RosterResult {
  asOf: string;
  source: string;
  payPeriod: string;
  count: number;
  withDeduction: number;
  payrollFields: string[];
  people: RosterPerson[];
}
let cache: { at: number; result: RosterResult } | null = null;

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Build the Roster the way payroll thinks about it:
 *   1. Everyone on the LAST PAYROLL RUN (PayrollData) — the headcount.
 *   2. Layer company/role from active assignments (AssignmentData).
 *   3. Layer housing-deduction status (DeductionData, TransactionCode
 *      "Housing") — who is being charged for housing.
 * The client then computes placement from occupants and highlights the
 * key group: has a housing deduction but is NOT placed in a bed.
 */
async function buildRoster(): Promise<RosterResult> {
  const payroll = await fetchLastPayrollPeople(logger);

  // Company + role per person from active assignments. Non-fatal: if it
  // fails we still return the payroll headcount, just without company.
  const meta = new Map<string, { company: string; jobTitle: string }>();
  try {
    const active = await fetchActiveRoster(logger);
    for (const p of active.people) {
      meta.set(p.personId, { company: p.company, jobTitle: p.jobTitle });
    }
  } catch (err) {
    logger.warn({ err }, "roster: assignment enrichment failed — continuing without company/role");
  }

  // Housing deductions over a wide window; keep the latest weekly rate
  // per person. Non-fatal for the same reason.
  const deduction = new Map<string, number>();
  try {
    const now = new Date();
    const since = ymd(new Date(now.getTime() - 70 * 86_400_000));
    const until = ymd(new Date(now.getTime() + 7 * 86_400_000));
    const buckets = await fetchHousingDeductionsByWeek(since, until);
    for (const b of buckets) {
      for (const r of b.rows) deduction.set(r.personId, r.weekly);
    }
  } catch (err) {
    logger.warn({ err }, "roster: deduction enrichment failed — continuing without deductions");
  }

  const people: RosterPerson[] = payroll.people.map((p) => {
    const m = meta.get(p.personId);
    const weekly = deduction.get(p.personId) ?? 0;
    return {
      personId: p.personId,
      name: p.name,
      company: m?.company ?? "",
      jobTitle: m?.jobTitle ?? "",
      hasDeduction: weekly > 0,
      weeklyDeduction: weekly,
    };
  });

  return {
    asOf: payroll.asOf,
    source: "PayrollData + AssignmentData + DeductionData",
    payPeriod: payroll.payPeriod,
    count: people.length,
    withDeduction: people.filter((p) => p.hasDeduction).length,
    payrollFields: payroll.discoveredFields,
    people,
  };
}

/**
 * GET /roster/active — the last-payroll roster with deduction + role
 * enrichment. The pool the Roster page lets an operator place into beds.
 *   ?refresh=1  bypass the 15-minute cache.
 *   ?fields=1   return only the Zenople field names (no PII) for debugging.
 */
router.get("/roster/active", async (req, res): Promise<void> => {
  const wantFields = req.query.fields === "1" || req.query.fields === "true";
  const forceRefresh = req.query.refresh === "1" || req.query.refresh === "true";

  try {
    const now = Date.now();
    if (forceRefresh || !cache || now - cache.at > CACHE_TTL_MS) {
      cache = { at: now, result: await buildRoster() };
    }
    const r = cache.result;
    if (wantFields) {
      res.json({
        asOf: r.asOf,
        source: r.source,
        payPeriod: r.payPeriod,
        count: r.count,
        withDeduction: r.withDeduction,
        payrollFields: r.payrollFields,
      });
      return;
    }
    res.json({
      asOf: r.asOf,
      source: r.source,
      payPeriod: r.payPeriod,
      count: r.count,
      withDeduction: r.withDeduction,
      people: r.people,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.warn({ err }, "Failed to build Zenople roster");
    res.status(502).json({
      error: `Could not load the roster from Zenople: ${message}`,
      asOf: new Date().toISOString(),
      source: "PayrollData",
      payPeriod: "",
      count: 0,
      withDeduction: 0,
      people: [],
    });
  }
});

export default router;
