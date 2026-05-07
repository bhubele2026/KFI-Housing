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

// ── Blank-aware helpers ───────────────────────────────────────────────
//
// Lease term dates can legitimately be blank in our data (master-import
// rows awaiting triage, some seed leases like the Ridge Motor Inn —
// see task #359). The strict `parseYMD` above throws on a blank string
// because that's the right behaviour for the renewal pipeline (a stray
// time suffix should never silently emit `NaN days left`). But UI
// consumers that just need to render an end-date column shouldn't crash
// the whole page just because one lease is awaiting triage — they
// should fall back to a neutral "No end date" indicator instead.
//
// These helpers give the UI an opt-in escape hatch without weakening
// `parseYMD`'s loud failure on genuinely malformed non-blank input.

/**
 * True when `value` is an empty string, a whitespace-only string, or
 * not a string at all (null/undefined). Anything else — including
 * malformed date strings — returns false, so callers still get the
 * loud `parseYMD` throw on those.
 */
export function isBlankYMD(value: unknown): boolean {
  if (typeof value !== "string") return true;
  return value.trim().length === 0;
}

/**
 * Blank-aware variant of `formatYMDPretty`. Returns `fallback` when the
 * input is blank (default `""`). Still throws loudly on a non-blank
 * malformed value via `parseYMD`.
 */
export function formatYMDPrettyOrBlank(
  dateStr: string,
  fallback: string = "",
): string {
  if (isBlankYMD(dateStr)) return fallback;
  return formatYMDPretty(dateStr);
}

/**
 * Blank-aware variant of `addMonthsToYMD`. Returns `null` when the input
 * is blank. Still throws loudly on a non-blank malformed value via
 * `parseYMD`.
 */
export function addMonthsToYMDOrNull(
  dateStr: string,
  months: number,
): string | null {
  if (isBlankYMD(dateStr)) return null;
  return addMonthsToYMD(dateStr, months);
}
