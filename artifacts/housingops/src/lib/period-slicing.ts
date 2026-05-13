// Period-slicing helpers shared by the dashboard period picker.
//
// The dashboard headline tiles (Recovered Rent, Rent + Utilities, Net)
// can be viewed by Mon→Sat pay-week or by calendar month. Both modes
// reuse the same `monthlyRent` / `monthlyCost` source rows; the
// helpers below slice those monthly numbers down to a specific week
// using ACTUAL days (so a week split 4 days in May / 2 days in June
// contributes `4·rent/31 + 2·rent/30`, not `rent / 4.33`).

const SATURDAY = 6;

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseYmd(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

/** Most recent Saturday on/before `now`. */
export function mostRecentSaturday(now: Date = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = (d.getDay() - SATURDAY + 7) % 7;
  d.setDate(d.getDate() - diff);
  return ymd(d);
}

/** Saturday of the Mon→Sat pay-week containing `date`. */
export function payWeekEndForDate(date: Date): string {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dow = d.getDay();
  const add = (SATURDAY - dow + 7) % 7;
  d.setDate(d.getDate() + add);
  return ymd(d);
}

/** Monday start of a Mon→Sat pay-week (given its Saturday end). */
export function payWeekStartForEnd(saturdayYmd: string): string | null {
  const d = parseYmd(saturdayYmd);
  if (!d) return null;
  d.setDate(d.getDate() - 5);
  return ymd(d);
}

/** Add `weeks` (can be negative) to a Saturday end-date. */
export function addWeeks(saturdayYmd: string, weeks: number): string {
  const d = parseYmd(saturdayYmd);
  if (!d) return saturdayYmd;
  d.setDate(d.getDate() + weeks * 7);
  return ymd(d);
}

/** Current calendar month key (e.g. "2026-05"). */
export function currentMonthKey(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/** Add `months` (can be negative) to a YYYY-MM key. */
export function addMonths(yyyymm: string, months: number): string {
  const m = /^(\d{4})-(\d{2})$/.exec(yyyymm);
  if (!m) return yyyymm;
  const d = new Date(Number(m[1]), Number(m[2]) - 1 + months, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Days in the calendar month that contains `date`. */
function daysInMonthOf(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

/**
 * Slice a monthly amount down to one Mon→Sat pay-week using the actual
 * day count in each calendar month the week touches.
 *
 *   weeklyCostSlice(3000, "2026-05-02")
 *     → 3000/30·1 + 3000/31·5  (week of Apr 27 → May 2)
 *
 * Returns 0 if `monthlyAmount` is 0 or falsy, or if the date is bad.
 */
export function weeklyCostSlice(
  monthlyAmount: number,
  saturdayYmd: string,
): number {
  if (!monthlyAmount) return 0;
  const sat = parseYmd(saturdayYmd);
  if (!sat) return 0;
  let total = 0;
  for (let i = 5; i >= 0; i -= 1) {
    const day = new Date(sat.getFullYear(), sat.getMonth(), sat.getDate() - i);
    total += monthlyAmount / daysInMonthOf(day);
  }
  return total;
}

/** True if `ymdString` (YYYY-MM-DD) lies within the Mon→Sat week ending `saturdayYmd`. */
export function isInPayWeek(
  ymdString: string,
  saturdayYmd: string,
): boolean {
  const start = payWeekStartForEnd(saturdayYmd);
  if (!start) return false;
  return ymdString >= start && ymdString <= saturdayYmd;
}

/** True if a date string (YYYY-MM-DD) lies in the given calendar month (YYYY-MM). */
export function isInMonth(ymdString: string, yyyymm: string): boolean {
  return ymdString.startsWith(`${yyyymm}-`);
}

/**
 * True if a lease (with start/end YYYY-MM-DD strings; blank end = open)
 * is active for at least one day in the Mon→Sat pay-week.
 */
export function isLeaseActiveInWeek(
  startDate: string,
  endDate: string,
  saturdayYmd: string,
): boolean {
  if (!startDate) return false;
  const start = payWeekStartForEnd(saturdayYmd);
  if (!start) return false;
  const effectiveEnd = endDate && endDate.length > 0 ? endDate : "9999-12-31";
  return startDate <= saturdayYmd && effectiveEnd >= start;
}

/** True if a lease is active for any day in the calendar month `yyyymm`. */
export function isLeaseActiveInMonth(
  startDate: string,
  endDate: string,
  yyyymm: string,
): boolean {
  const m = /^(\d{4})-(\d{2})$/.exec(yyyymm);
  if (!m) return false;
  const lastDay = new Date(Number(m[1]), Number(m[2]), 0).getDate();
  const monthStart = `${yyyymm}-01`;
  const monthEnd = `${yyyymm}-${String(lastDay).padStart(2, "0")}`;
  if (!startDate) return false;
  const effectiveEnd = endDate && endDate.length > 0 ? endDate : "9999-12-31";
  return startDate <= monthEnd && effectiveEnd >= monthStart;
}

/** Format a Saturday YMD as "Week ending May 9, 2026". */
export function formatPayWeekLabel(saturdayYmd: string): string {
  const d = parseYmd(saturdayYmd);
  if (!d) return saturdayYmd;
  return `Week ending ${d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;
}

/** Format a YYYY-MM key as "May 2026". */
export function formatMonthLabel(yyyymm: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(yyyymm);
  if (!m) return yyyymm;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, 1);
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}
