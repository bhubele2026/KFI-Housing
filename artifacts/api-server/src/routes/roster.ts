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
  /** Available payroll periods (>= go-live floor), newest first. */
  periods: string[];
  count: number;
  withDeduction: number;
  excludedCorp: number;
  excludedNoCompany: number;
  payrollFields: string[];
  people: RosterPerson[];
}
// Cache per selected period ("" = latest/default). Zenople re-auth is
// capped at 20/hr, so we keep each period's composed roster ~15 min.
const cache = new Map<string, { at: number; result: RosterResult }>();

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// PRIVACY: corp/internal employees must NEVER appear in the roster. Their
// assignment "company" is the internal corporate entity, so we exclude by
// company name. Tunable via env (comma-separated, case-insensitive
// substring match) WITHOUT a deploy. Deliberately does NOT pattern on a
// bare "corp" — that would wrongly drop real clients like "Penda Corp".
const CORP_COMPANY_PATTERNS = (
  process.env.ROSTER_CORP_COMPANY_PATTERNS ||
  "internal corporate,kfi staffing internal,kfi internal,corporate office,corporate hq"
)
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

function isCorpCompany(company: string): boolean {
  const c = company.trim().toLowerCase();
  if (!c) return false;
  return CORP_COMPANY_PATTERNS.some((p) => c.includes(p));
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
async function buildRoster(period?: string): Promise<RosterResult> {
  const payroll = await fetchLastPayrollPeople(logger, { period });

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

  const all: RosterPerson[] = payroll.people.map((p) => {
    const m = meta.get(p.personId);
    const weekly = deduction.get(p.personId) ?? 0;
    return {
      personId: p.personId,
      name: p.name,
      company: (m?.company ?? "").trim(),
      jobTitle: m?.jobTitle ?? "",
      hasDeduction: weekly > 0,
      weeklyDeduction: weekly,
    };
  });

  // The roster shows client-assigned associates ONLY. Per the operator's
  // rule: every visible person must carry a (non-corp) company, and corp/
  // internal employees must never appear. So we drop (a) corp/internal
  // companies and (b) anyone whose client company didn't resolve at all
  // (treated as internal/non-client). Counts are surfaced via ?fields=1
  // and logged so we can tell corp exclusions apart from unresolved-company
  // gaps and tune the widened AssignmentData window if needed.
  let excludedCorp = 0;
  let excludedNoCompany = 0;
  const people = all.filter((p) => {
    if (isCorpCompany(p.company)) {
      excludedCorp++;
      return false;
    }
    if (!p.company) {
      excludedNoCompany++;
      return false;
    }
    return true;
  });
  logger.info(
    {
      onPayroll: all.length,
      shown: people.length,
      excludedCorp,
      excludedNoCompany,
    },
    "roster: built (corp + no-company excluded)",
  );

  return {
    asOf: payroll.asOf,
    source: "PayrollData + AssignmentData + DeductionData",
    payPeriod: payroll.payPeriod,
    periods: payroll.periods,
    count: people.length,
    withDeduction: people.filter((p) => p.hasDeduction).length,
    excludedCorp,
    excludedNoCompany,
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
  // ?period=YYYY-MM-DD selects a prior payroll period (AccountingPeriod).
  // Anything blank/invalid falls back to the latest in buildRoster.
  const period = typeof req.query.period === "string" ? req.query.period : "";

  try {
    const now = Date.now();
    const cached = cache.get(period);
    if (forceRefresh || !cached || now - cached.at > CACHE_TTL_MS) {
      cache.set(period, { at: now, result: await buildRoster(period || undefined) });
    }
    const r = cache.get(period)!.result;
    if (wantFields) {
      res.json({
        asOf: r.asOf,
        source: r.source,
        payPeriod: r.payPeriod,
        periods: r.periods,
        count: r.count,
        withDeduction: r.withDeduction,
        excludedCorp: r.excludedCorp,
        excludedNoCompany: r.excludedNoCompany,
        payrollFields: r.payrollFields,
      });
      return;
    }
    res.json({
      asOf: r.asOf,
      source: r.source,
      payPeriod: r.payPeriod,
      periods: r.periods,
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
      periods: [],
      count: 0,
      withDeduction: 0,
      people: [],
    });
  }
});

export default router;
