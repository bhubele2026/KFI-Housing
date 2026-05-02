// Date helpers for the renew-lease flow.
//
// `addMonthsToYMD` adds (or subtracts) a number of calendar months to a
// "YYYY-MM-DD" string and returns a string in the same format. It handles
// year wrap, month wrap, and short-month clamping (e.g. Jan 31 + 1 month
// becomes Feb 28 or Feb 29 depending on leap year) without going through
// the host timezone, so the result is purely calendar arithmetic.

export function addMonthsToYMD(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const targetMonthAbs = m - 1 + months;
  const targetYear = y + Math.floor(targetMonthAbs / 12);
  const normalizedMonth = ((targetMonthAbs % 12) + 12) % 12;
  const lastDayOfTargetMonth = new Date(targetYear, normalizedMonth + 1, 0).getDate();
  const day = Math.min(d, lastDayOfTargetMonth);
  return `${targetYear}-${String(normalizedMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
