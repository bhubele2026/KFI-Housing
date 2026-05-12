// Client-side pay-week helpers. Mirror the server's `pay-week.ts` so the
// Finance Weekly / Monthly / By Customer tabs and the per-property mini-
// chart can pick a Saturday end-date, walk a trailing run, and bucket
// deduction snapshots into calendar months without any API round-trip.
//
// Pay-week = Mon → Sat. The Saturday end-date is the canonical label
// (YYYY-MM-DD) used everywhere — never a Date object — so the same
// string survives JSON, URL params, and timezone shifts.

const SATURDAY = 6;

export function ymdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

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

export function isSaturdayDate(s: string): boolean {
  const d = parsePayWeekDate(s);
  return d !== null && d.getDay() === SATURDAY;
}

export function mostRecentSaturday(now: Date = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = (d.getDay() - SATURDAY + 7) % 7;
  d.setDate(d.getDate() - diff);
  return ymdLocal(d);
}

export function shiftWeeks(saturdayYmd: string, weeks: number): string {
  const d = parsePayWeekDate(saturdayYmd);
  if (!d) return saturdayYmd;
  d.setDate(d.getDate() + weeks * 7);
  return ymdLocal(d);
}

export function trailingPayWeeks(count: number, endingSaturday: string): string[] {
  const end = parsePayWeekDate(endingSaturday);
  if (!end) return [];
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(end.getFullYear(), end.getMonth(), end.getDate() - i * 7);
    out.push(ymdLocal(d));
  }
  return out;
}

/** "May 9, 2026" — short, locale-aware label for a Saturday end-date. */
export function formatPayWeekLabel(saturdayYmd: string): string {
  const d = parsePayWeekDate(saturdayYmd);
  if (!d) return saturdayYmd;
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** "Apr 27 – May 9" — pay-week range (Monday → Saturday). */
export function formatPayWeekRange(saturdayYmd: string): string {
  const sat = parsePayWeekDate(saturdayYmd);
  if (!sat) return saturdayYmd;
  const mon = new Date(sat.getFullYear(), sat.getMonth(), sat.getDate() - 5);
  const sameMonth = mon.getMonth() === sat.getMonth();
  const monLbl = mon.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  const satLbl = sat.toLocaleDateString(undefined, {
    month: sameMonth ? undefined : "short",
    day: "numeric",
  });
  return `${monLbl} – ${satLbl}`;
}

/** "2026-05" — calendar-month bucket for a Saturday end-date (uses Saturday's month). */
export function monthBucketForPayWeek(saturdayYmd: string): string {
  const d = parsePayWeekDate(saturdayYmd);
  if (!d) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** "May 2026" — locale-aware label for a YYYY-MM bucket. */
export function formatMonthBucketLabel(ym: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) return ym;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, 1);
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

/** Generate trailing N YYYY-MM bucket strings ending at `endingMonth` (inclusive). */
export function trailingMonthBuckets(count: number, endingMonth: string): string[] {
  const m = /^(\d{4})-(\d{2})$/.exec(endingMonth);
  if (!m) return [];
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(y, mo - 1 - i, 1);
    out.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
    );
  }
  return out;
}

/** YYYY-MM for the current calendar month (local time). */
export function currentMonthBucket(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}
