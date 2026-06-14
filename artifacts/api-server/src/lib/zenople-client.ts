// Zenople API client for pulling weekly housing deductions.
//
// Zenople is KFI's staffing/payroll system. Housing deductions live in
// its `DeductionData` action under TransactionCode "Housing". This
// client is the API-driven replacement for the manual XLSX export that
// previously fed `seedHousingDeductions` — it authenticates, pulls the
// current deduction history, and reshapes the rows into the exact
// `HousingDeductionRow[]` the existing seeder already understands,
// bucketed by Mon→Sat pay-week.
//
// Field/quirk notes verified against the live API:
//   * Auth is OAuth2 client-credentials: POST /connect/token
//     (form-urlencoded) returns a ~2h bearer token. We cache it.
//   * Data comes from POST /api/common/data with
//     {action, filters:{uTCStartDateTime,uTCEndDateTime,includeData}}.
//   * The date window filters on a *last-modified* timestamp, NOT on
//     the pay/check date — so a recent window (e.g. last 30 days)
//     returns the FULL current deduction history (180+ pay periods)
//     for active people in a single call. We therefore fetch one
//     recent window and bucket by pay-week ourselves.
//   * `Adjustment` is the recurring weekly rate (what the app wants);
//     `Deduction` is the amount actually taken on a run and can include
//     catch-up balances, so it diverges on ~75% of rows. We use
//     Adjustment, matching the old XLSX flow.
//   * `AccountingPeriod` is always a Sunday and is the clean weekly
//     marker. The Mon→Sat pay-week's Saturday end-date is
//     `AccountingPeriod - 1 day`. `CheckDate` is paid-in-arrears and
//     varies (Thu/Fri/Mon), so it is unreliable for week attribution.
//   * No client-employer ("customer") name is present on the row, so we
//     emit customer="" and let the seeder resolve the customer/property
//     from the matched occupant (matching is driven by PersonId, which
//     equals the occupant's employeeId).

import {
  isSaturdayDate,
  parsePayWeekDate,
} from "./pay-week";
import type { HousingDeductionRow } from "./seed-housing-deductions";

const HOUSING_TRANSACTION_CODE = "Housing";
// How far back (in days, on the modified-time window) to ask for in one
// call. A recent window returns the full current history; 30 days
// comfortably covers ~4 weekly payroll runs so every active deduction
// is included while staying under the API's "Large data set" ceiling.
const LOOKBACK_DAYS = 30;

interface ZenopleConfig {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
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
  return { baseUrl: baseUrl.replace(/\/+$/, ""), clientId, clientSecret };
}

// ── Token cache ────────────────────────────────────────────────────
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getToken(cfg: ZenopleConfig): Promise<string> {
  const now = Date.now();
  // Refresh a minute early to avoid using a token that expires mid-call.
  if (cachedToken && cachedToken.expiresAt - 60_000 > now) {
    return cachedToken.token;
  }
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
  });
  const res = await fetch(`${cfg.baseUrl}/connect/token`, {
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

interface RawDeductionRow {
  PersonId?: number | string;
  Name?: string;
  TransactionCode?: string;
  Adjustment?: number | string;
  AccountingPeriod?: string;
  CheckDate?: string;
}

async function fetchDeductionData(
  cfg: ZenopleConfig,
  token: string,
  start: Date,
  end: Date,
): Promise<RawDeductionRow[]> {
  const res = await fetch(`${cfg.baseUrl}/api/common/data`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "DeductionData",
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
      `Zenople DeductionData request failed (${res.status}). ${text.slice(0, 200)}`.trim(),
    );
  }
  const json: unknown = await res.json();
  if (!Array.isArray(json)) {
    // The API returns a non-array object like {"msg":"Large data set"}
    // when a window is too big. Our 30-day window is well under that
    // ceiling in practice, but surface a clear error if it ever trips.
    const msg =
      json && typeof json === "object" && "msg" in json
        ? String((json as { msg: unknown }).msg)
        : "unexpected non-array response";
    throw new Error(`Zenople DeductionData returned no rows: ${msg}.`);
  }
  return json as RawDeductionRow[];
}

/** Saturday Mon→Sat end-date for a Zenople AccountingPeriod (a Sunday). */
export function saturdayFromAccountingPeriod(
  accountingPeriod: string | undefined,
): string | null {
  if (!accountingPeriod) return null;
  const day = String(accountingPeriod).slice(0, 10);
  const d = parsePayWeekDate(day);
  if (!d) return null;
  // AccountingPeriod is the Sunday immediately after the pay-week's
  // Saturday end-date, so subtract one day.
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const sat = `${y}-${m}-${dd}`;
  return isSaturdayDate(sat) ? sat : null;
}

function toAmount(raw: number | string | undefined): number {
  if (raw == null) return 0;
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export interface ZenopleWeekBucket {
  payWeekEndDate: string;
  rows: HousingDeductionRow[];
}

/**
 * Pull housing deductions from Zenople and group them into Mon→Sat
 * pay-weeks whose Saturday end-date falls within [sinceSat, untilSat]
 * (inclusive). Each bucket's `rows` are ready to hand straight to
 * `seedHousingDeductions({ rows, payWeekEndDate })`.
 *
 * Within a single (personId, pay-week) we keep the row with the latest
 * CheckDate — the most current recurring rate — collapsing duplicate
 * runs that touch the same period.
 */
export async function fetchHousingDeductionsByWeek(
  sinceSat: string,
  untilSat: string,
): Promise<ZenopleWeekBucket[]> {
  const cfg = getConfig();
  const token = await getToken(cfg);
  const now = new Date();
  const start = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000);
  const raw = await fetchDeductionData(cfg, token, start, now);

  // weekKey -> personId -> { row, checkDate }
  const byWeek = new Map<
    string,
    Map<string, { row: HousingDeductionRow; checkDate: string }>
  >();

  for (const r of raw) {
    if (r.TransactionCode !== HOUSING_TRANSACTION_CODE) continue;
    const weekly = toAmount(r.Adjustment);
    if (weekly <= 0) continue;
    const personId = r.PersonId == null ? "" : String(r.PersonId).trim();
    const name = (r.Name ?? "").trim();
    if (!personId || !name) continue;
    const sat = saturdayFromAccountingPeriod(r.AccountingPeriod);
    if (!sat) continue;
    if (sat < sinceSat || sat > untilSat) continue;

    let people = byWeek.get(sat);
    if (!people) {
      people = new Map();
      byWeek.set(sat, people);
    }
    const checkDate = String(r.CheckDate ?? "").slice(0, 10);
    const existing = people.get(personId);
    // Keep the most recent CheckDate's rate for the period.
    if (!existing || checkDate > existing.checkDate) {
      people.set(personId, {
        row: { customer: "", name, personId, weekly },
        checkDate,
      });
    }
  }

  return [...byWeek.entries()]
    .sort((a, b) => a[0].localeCompare(b[0])) // ascending pay-week
    .map(([payWeekEndDate, people]) => ({
      payWeekEndDate,
      rows: [...people.values()].map((v) => v.row),
    }));
}
