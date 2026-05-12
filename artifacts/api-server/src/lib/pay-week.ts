// Pay-week helpers. The KFI payroll cycle is Monday → Saturday and the
// pay-week is identified everywhere by its Saturday end-date as a
// calendar-day string (YYYY-MM-DD) — never a Date object — so the same
// label survives JSON round-trips, DB writes, and timezone shifts.

const SATURDAY = 6;

/** YYYY-MM-DD for the given Date in its local timezone. */
function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Parse a YYYY-MM-DD string into a local-midnight Date. Returns null on bad input. */
export function parsePayWeekDate(s: string): Date | null {
  if (typeof s !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  if (
    dt.getFullYear() !== y ||
    dt.getMonth() !== mo - 1 ||
    dt.getDate() !== d
  ) {
    return null;
  }
  return dt;
}

/** True if the YYYY-MM-DD string parses to a Saturday. */
export function isSaturdayDate(s: string): boolean {
  const d = parsePayWeekDate(s);
  return d !== null && d.getDay() === SATURDAY;
}

/**
 * Most recent Saturday on or before `now` (defaults to today).
 * Returned as a YYYY-MM-DD string. If `now` is itself a Saturday it is
 * returned as-is.
 */
export function mostRecentSaturday(now: Date = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = (d.getDay() - SATURDAY + 7) % 7;
  d.setDate(d.getDate() - diff);
  return ymd(d);
}

/**
 * Saturday end-date for the Mon→Sat pay-week containing `date`.
 * If `date` is a Saturday it's returned as-is; otherwise we walk forward
 * to the next Saturday. Sundays are treated as the *previous* week's
 * Sunday-after, i.e. they fold into the upcoming Saturday — matching
 * the typical "post-pay-period" interpretation operators expect.
 */
export function payWeekEndForDate(date: Date): string {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dow = d.getDay();
  const add = (SATURDAY - dow + 7) % 7;
  d.setDate(d.getDate() + add);
  return ymd(d);
}

/**
 * Generate a list of `count` Saturday pay-week end dates ending at
 * `endingSaturday` (inclusive), in chronological order. Used by the
 * per-property weekly mini-chart (count = 13).
 */
export function trailingPayWeeks(count: number, endingSaturday: string): string[] {
  const end = parsePayWeekDate(endingSaturday);
  if (!end) return [];
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(end.getFullYear(), end.getMonth(), end.getDate() - i * 7);
    out.push(ymd(d));
  }
  return out;
}

/** Average weeks per calendar month — used to convert monthlyRent → weekly. */
export const WEEKS_PER_MONTH = 52 / 12;

/** "2026-05" — calendar month bucket for a Saturday end-date. */
export function monthBucketForPayWeek(saturdayYmd: string): string {
  const d = parsePayWeekDate(saturdayYmd);
  if (!d) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Trailing N YYYY-MM bucket strings ending at `endingMonth` inclusive. */
export function trailingMonthBuckets(count: number, endingMonth: string): string[] {
  const m = /^(\d{4})-(\d{2})$/.exec(endingMonth);
  if (!m) return [];
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(y, mo - 1 - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}
