// Zenople API client for the *active employee roster* — the pool of
// people currently on assignment as of the last payroll run. This is a
// DIFFERENT concern from `zenople-client.ts`, which pulls housing
// *deductions* (only people who already have a housing charge). The
// Roster page uses THIS so an operator can place any active employee
// into a property/bed, not just people who already appear in payroll
// deductions.
//
// Transport mirrors the proven deductions client exactly: OAuth2
// client-credentials → ~2h bearer token (cached), then
// POST /api/common/data {action, filters:{uTCStartDateTime,
// uTCEndDateTime, includeData}}. See `.agents/memory/zenople-api.md`.
//
// WHICH ACTION: "active as of last payroll" is the staffing definition
// of an active assignment, so we read `AssignmentData` with
// includeData:"Current". The date window filters on *last-modified*
// time (same quirk as DeductionData), so a recent window returns the
// full current assignment set in one call.
//
// FIELD NAMES ARE NOT YET CONFIRMED against this tenant's AssignmentData
// schema (we couldn't run the probe locally — no Node + secrets are
// Replit-only). So every field is read through a tolerant alias list
// and the first row's actual keys are logged once on each pull. If the
// roster comes back empty or thin, check the server log line
// "zenople active-roster: discovered fields" and adjust the alias lists
// below — that's the only change needed.

import { logger as defaultLogger } from "./logger";
import type { Logger } from "pino";

const ASSIGNMENT_ACTION = "AssignmentData";
// The modified-time window must be wide enough to return EVERY current
// assignment, not just those touched recently — otherwise people whose
// assignment row hasn't changed in weeks come back with no company. A
// 45-day window only resolved ~195 of ~500; widen to ~13 months so the
// client/company resolves for the whole active roster.
const LOOKBACK_DAYS = 400;

interface ZenopleConfig {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  tokenPath: string;
  dataPath: string;
}

function getConfig(): ZenopleConfig {
  const clientId = process.env.ZENOPLE_CLIENT_ID;
  const clientSecret = process.env.ZENOPLE_CLIENT_SECRET;
  const baseUrl =
    process.env.ZENOPLE_BASE_URL || "https://kfistaffingapi.zenople.com";
  if (!clientId || !clientSecret) {
    throw new Error(
      "Zenople is not configured: missing ZENOPLE_CLIENT_ID / ZENOPLE_CLIENT_SECRET.",
    );
  }
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    clientId,
    clientSecret,
    tokenPath: process.env.ZENOPLE_TOKEN_PATH || "/connect/token",
    dataPath: process.env.ZENOPLE_DATA_PATH || "/api/common/data",
  };
}

// ── Token cache (re-auth is rate-limited to 20/hr, so never per-call) ─
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getToken(cfg: ZenopleConfig): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt - 60_000 > now) {
    return cachedToken.token;
  }
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
  });
  const res = await fetch(`${cfg.baseUrl}${cfg.tokenPath}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Zenople auth failed (${res.status}). ${text.slice(0, 200)}`.trim(),
    );
  }
  const json = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!json.access_token) {
    throw new Error("Zenople auth response did not include an access_token.");
  }
  const ttlMs = (json.expires_in ?? 7200) * 1000;
  cachedToken = { token: json.access_token, expiresAt: now + ttlMs };
  return json.access_token;
}

// Zenople expects ".NET-style" UTC strings, e.g. "2026-06-14 12:00:00.0000000".
function toZenopleUtc(d: Date): string {
  return d.toISOString().replace("T", " ").replace("Z", "0000");
}

async function fetchAction(
  cfg: ZenopleConfig,
  token: string,
  action: string,
  start: Date,
  end: Date,
): Promise<Record<string, unknown>[]> {
  const res = await fetch(`${cfg.baseUrl}${cfg.dataPath}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action,
      filters: {
        uTCStartDateTime: toZenopleUtc(start),
        uTCEndDateTime: toZenopleUtc(end),
        includeData: "Current",
      },
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Zenople ${action} request failed (${res.status}). ${text.slice(0, 200)}`.trim(),
    );
  }
  const json: unknown = await res.json();
  if (!Array.isArray(json)) {
    // Non-array 200 means "narrow the window" (e.g. {"msg":"Large data set"}).
    const msg =
      json && typeof json === "object" && "msg" in json
        ? String((json as { msg: unknown }).msg)
        : "unexpected non-array response";
    throw new Error(`Zenople ${action} returned no rows: ${msg}.`);
  }
  return json as Record<string, unknown>[];
}

/** First non-empty value across a list of candidate keys (case-sensitive). */
function pick(row: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return undefined;
}

function str(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

function dateOnly(v: unknown): string {
  const s = str(v);
  return s ? s.slice(0, 10) : "";
}

export interface ActiveRosterPerson {
  /** Zenople PersonId — equals HousingOps `occupant.employeeId`. */
  personId: string;
  name: string;
  /** Staffing client / customer the assignment is for ("" if absent). */
  company: string;
  jobTitle: string;
  branch: string;
  startDate: string;
  endDate: string;
}

export interface ActiveRosterResult {
  asOf: string;
  source: string;
  /** Field names seen on the raw rows — surfaced for debugging. */
  discoveredFields: string[];
  people: ActiveRosterPerson[];
}

// Alias lists — first present wins. Extend these (NOT the call sites) if
// the probe reveals different casings on this tenant.
const PERSON_ID_KEYS = ["PersonId", "personId", "EmployeeId", "employeeId", "Id", "id"];
const NAME_KEYS = ["Name", "EmployeeName", "FullName", "PersonName", "name"];
const FIRST_KEYS = ["FirstName", "firstName", "First"];
const LAST_KEYS = ["LastName", "lastName", "Last"];
const COMPANY_KEYS = [
  "CustomerName", "Customer", "ClientName", "Client",
  "OrganizationName", "Organization", "Company", "companyName",
];
const JOB_KEYS = ["JobTitle", "Title", "Position", "Job", "jobTitle"];
const BRANCH_KEYS = ["Branch", "Office", "OfficeName", "branch"];
const START_KEYS = ["StartDate", "AssignmentStartDate", "startDate", "Start"];
const END_KEYS = ["EndDate", "AssignmentEndDate", "endDate", "End"];
const ACTIVE_KEYS = ["IsActive", "Active", "Status", "AssignmentStatus", "status"];

/** Treat a row as active unless it has an explicit ended/inactive marker. */
function isActiveRow(row: Record<string, unknown>, today: string): boolean {
  const end = dateOnly(pick(row, END_KEYS));
  if (end && end < today) return false;
  const active = pick(row, ACTIVE_KEYS);
  if (active === false) return false;
  const a = str(active).toLowerCase();
  if (a && (a === "inactive" || a === "ended" || a === "terminated" || a === "closed" || a === "false")) {
    return false;
  }
  return true;
}

/**
 * Pull the active employee roster (active assignments) from Zenople.
 * Dedupes by personId, keeping the row with the latest startDate (the
 * person's current assignment). `includeData:"Current"` already scopes
 * to live assignments; `isActiveRow` is a belt-and-braces filter for any
 * ended rows that slip through the modified-time window.
 */
export async function fetchActiveRoster(
  log: Logger = defaultLogger,
): Promise<ActiveRosterResult> {
  const cfg = getConfig();
  const token = await getToken(cfg);
  const now = new Date();
  const start = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000);
  const raw = await fetchAction(cfg, token, ASSIGNMENT_ACTION, start, now);

  const discoveredFields =
    raw.length > 0 && raw[0] && typeof raw[0] === "object"
      ? Object.keys(raw[0])
      : [];
  // Log once per pull so a field-name mismatch is diagnosable from the
  // server log alone (no PII — field NAMES only).
  log.info(
    { action: ASSIGNMENT_ACTION, rows: raw.length, fields: discoveredFields },
    "zenople active-roster: discovered fields",
  );

  const today = now.toISOString().slice(0, 10);
  // personId -> {person, startDate} keeping the latest assignment.
  const byPerson = new Map<string, { person: ActiveRosterPerson; start: string }>();

  for (const row of raw) {
    if (!isActiveRow(row, today)) continue;
    const personId = str(pick(row, PERSON_ID_KEYS));
    let name = str(pick(row, NAME_KEYS));
    if (!name) {
      const first = str(pick(row, FIRST_KEYS));
      const last = str(pick(row, LAST_KEYS));
      name = `${first} ${last}`.trim();
    }
    if (!personId || !name) continue;

    const person: ActiveRosterPerson = {
      personId,
      name,
      company: str(pick(row, COMPANY_KEYS)),
      jobTitle: str(pick(row, JOB_KEYS)),
      branch: str(pick(row, BRANCH_KEYS)),
      startDate: dateOnly(pick(row, START_KEYS)),
      endDate: dateOnly(pick(row, END_KEYS)),
    };
    const existing = byPerson.get(personId);
    if (!existing || person.startDate > existing.start) {
      byPerson.set(personId, { person, start: person.startDate });
    }
  }

  const people = [...byPerson.values()]
    .map((v) => v.person)
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    asOf: now.toISOString(),
    source: ASSIGNMENT_ACTION,
    discoveredFields,
    people,
  };
}

// ── Last-payroll roster ──────────────────────────────────────────────
// The Roster's headcount is everyone who was ON THE LAST PAYROLL RUN
// (≈ the company headcount, ~500), NOT just active assignments. We read
// `PayrollData`, find the most recent AccountingPeriod present, and
// return the distinct people paid in it. (Active assignments + housing
// deductions are layered on top by the route.)
const PAYROLL_ACTION = "PayrollData";
// The app went live June 2026, so all payroll worth showing is within a
// couple months — a 60-day modified-time window covers every period back
// to go-live with margin while staying well under the "Large data set"
// ceiling (which a multi-year window would trip).
const PAYROLL_LOOKBACK_DAYS = 60;
// Hard floor: never expose payroll periods before the app's go-live.
export const PAYROLL_GO_LIVE_FLOOR = "2026-06-01";
const ACCT_PERIOD_KEYS = ["AccountingPeriod", "accountingPeriod", "PayPeriod", "payPeriod"];
const CHECK_DATE_KEYS = ["CheckDate", "checkDate", "PayDate", "payDate"];

export interface PayrollPerson {
  personId: string;
  name: string;
}

export interface PayrollRosterResult {
  asOf: string;
  source: string;
  /** The AccountingPeriod we scoped to (the selected period), for display. */
  payPeriod: string;
  /** Distinct AccountingPeriods present (>= go-live floor), newest first. */
  periods: string[];
  discoveredFields: string[];
  people: PayrollPerson[];
}

/**
 * Distinct people on the most recent payroll run. We pull a short
 * modified-time window (covers the last few weekly runs), pick the
 * latest AccountingPeriod present, and dedupe by personId. If no
 * AccountingPeriod field is found we fall back to the union over the
 * whole window (week-to-week payroll membership is ~stable, so the
 * count is materially the same).
 */
export async function fetchLastPayrollPeople(
  log: Logger = defaultLogger,
  opts: { period?: string } = {},
): Promise<PayrollRosterResult> {
  const cfg = getConfig();
  const token = await getToken(cfg);
  const now = new Date();
  const start = new Date(now.getTime() - PAYROLL_LOOKBACK_DAYS * 86_400_000);
  const raw = await fetchAction(cfg, token, PAYROLL_ACTION, start, now);

  const discoveredFields =
    raw.length > 0 && raw[0] && typeof raw[0] === "object" ? Object.keys(raw[0]) : [];
  log.info(
    { action: PAYROLL_ACTION, rows: raw.length, fields: discoveredFields },
    "zenople last-payroll: discovered fields",
  );

  const periodOf = (row: Record<string, unknown>): string =>
    dateOnly(pick(row, ACCT_PERIOD_KEYS)) || dateOnly(pick(row, CHECK_DATE_KEYS));

  // Distinct periods present, floored at go-live, newest first.
  const periods = [
    ...new Set(
      raw
        .map(periodOf)
        .filter((p): p is string => !!p && p >= PAYROLL_GO_LIVE_FLOOR),
    ),
  ].sort((a, b) => b.localeCompare(a));

  // Target period: the requested one (if present + on/after the floor and
  // actually in the data), else the latest. Empty when no periods at all.
  const requested =
    opts.period && opts.period >= PAYROLL_GO_LIVE_FLOOR && periods.includes(opts.period)
      ? opts.period
      : "";
  const targetPeriod = requested || periods[0] || "";

  const byPerson = new Map<string, PayrollPerson>();
  for (const row of raw) {
    // Scope to the target period when we have one; otherwise (no period
    // markers at all) take everyone in the window.
    if (targetPeriod && periodOf(row) !== targetPeriod) continue;
    const personId = str(pick(row, PERSON_ID_KEYS));
    let name = str(pick(row, NAME_KEYS));
    if (!name) {
      name = `${str(pick(row, FIRST_KEYS))} ${str(pick(row, LAST_KEYS))}`.trim();
    }
    if (!personId || !name) continue;
    if (!byPerson.has(personId)) byPerson.set(personId, { personId, name });
  }

  return {
    asOf: now.toISOString(),
    source: PAYROLL_ACTION,
    payPeriod: targetPeriod,
    periods,
    discoveredFields,
    people: [...byPerson.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}
