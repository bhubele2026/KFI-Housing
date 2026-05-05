// Date helpers for the renew-lease flow and renewal alerts.
//
// Every helper here goes through `parseYMD`, which is the single hardened
// entry point for turning a stored lease date into numeric year/month/day
// parts. It enforces an exact `YYYY-MM-DD` shape and validates that the
// values describe a real calendar date — anything else throws loudly with
// the offending input in the message.
//
// Why "throw loudly":
//   We previously kept defensive layers (a startup SQL job that stripped
//   stray time suffixes and a server-side `normalizeLeaseDates` call in
//   the seed/insert path) to paper over malformed values like
//   `"2026-05-31 00:00:00"`. Those rows used to render as `NaN days left`
//   and silently disabled the Renewal Alerts panel. The API now rejects
//   anything that doesn't match `^\d{4}-\d{2}-\d{2}$` at the boundary, so
//   the only remaining job for the frontend is to fail visibly if a bad
//   value somehow slips through — silent fallbacks are exactly what hid
//   the original bug.

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface YMDParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

/**
 * Parse an exact `YYYY-MM-DD` string into numeric parts.
 *
 * Throws an `Error` (with the original input in the message) on:
 *   - non-string input
 *   - any extra characters (e.g. a trailing time component like
 *     `"2026-05-31 00:00:00"` or `"2026-05-31T00:00:00.000Z"`)
 *   - impossible calendar dates (e.g. `"2025-02-30"`, `"2025-13-01"`)
 *
 * The Date roundtrip catches month/day overflow that the regex alone
 * would accept.
 */
export function parseYMD(dateStr: string): YMDParts {
  if (typeof dateStr !== "string") {
    throw new Error(
      `Invalid lease date: expected a YYYY-MM-DD string, got ${typeof dateStr}`,
    );
  }
  const match = YMD_RE.exec(dateStr);
  if (!match) {
    throw new Error(
      `Invalid lease date "${dateStr}": expected exact YYYY-MM-DD format`,
    );
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // Roundtrip through Date to reject impossible calendar dates the regex
  // can't catch on its own (Feb 30, month 13, etc.).
  const probe = new Date(year, month - 1, day);
  if (
    probe.getFullYear() !== year ||
    probe.getMonth() !== month - 1 ||
    probe.getDate() !== day
  ) {
    throw new Error(
      `Invalid lease date "${dateStr}": not a real calendar date`,
    );
  }
  return { year, month, day };
}

/**
 * Add (or subtract, with a negative argument) a number of calendar months
 * to a `YYYY-MM-DD` string and return a string in the same format.
 *
 * Handles year wrap, month wrap, and short-month clamping (e.g. Jan 31 +
 * 1 month becomes Feb 28 or Feb 29 depending on leap year) without going
 * through the host timezone, so the result is purely calendar arithmetic.
 *
 * Throws if `dateStr` is not a valid `YYYY-MM-DD`.
 */
export function addMonthsToYMD(dateStr: string, months: number): string {
  const { year, month, day } = parseYMD(dateStr);
  const targetMonthAbs = month - 1 + months;
  const targetYear = year + Math.floor(targetMonthAbs / 12);
  const normalizedMonth = ((targetMonthAbs % 12) + 12) % 12;
  const lastDayOfTargetMonth = new Date(
    targetYear,
    normalizedMonth + 1,
    0,
  ).getDate();
  const clampedDay = Math.min(day, lastDayOfTargetMonth);
  return `${targetYear}-${String(normalizedMonth + 1).padStart(2, "0")}-${String(
    clampedDay,
  ).padStart(2, "0")}`;
}

/**
 * Format a `YYYY-MM-DD` value as `Mon D, YYYY` in the user's locale, using
 * a *local* `Date` so the output never drifts a day in timezones west of
 * UTC. Throws on a malformed input via `parseYMD`.
 */
export function formatYMDPretty(dateStr: string): string {
  const { year, month, day } = parseYMD(dateStr);
  const dt = new Date(year, month - 1, day);
  return dt.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
