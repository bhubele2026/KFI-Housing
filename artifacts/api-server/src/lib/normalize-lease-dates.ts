/**
 * Coerce a date string to plain `YYYY-MM-DD` by stripping any trailing time
 * component (e.g. `"2026-05-31 00:00:00"` or `"2026-05-31T00:00:00.000Z"`).
 *
 * Some imported/legacy spreadsheet rows arrive with a time suffix attached;
 * downstream code (in particular the renewal calculator on the frontend)
 * splits the string on `-` and treats the trailing piece as a day number,
 * which yields `NaN`. Normalizing on write keeps the database canonical so
 * the renewal alerts panel cannot be silently disabled by a single bad row.
 */
export function normalizeDateOnly<T extends string | undefined | null>(
  value: T,
): T {
  if (value == null || value === "") return value;
  const cut = value.search(/[ T]/);
  return (cut === -1 ? value : value.slice(0, cut)) as T;
}

/**
 * Return a copy of the given lease-shaped object with `startDate` and
 * `endDate` normalized to `YYYY-MM-DD` (when present).
 */
export function normalizeLeaseDates<
  T extends { startDate?: string; endDate?: string },
>(input: T): T {
  const out: T = { ...input };
  if (typeof input.startDate === "string") {
    out.startDate = normalizeDateOnly(input.startDate);
  }
  if (typeof input.endDate === "string") {
    out.endDate = normalizeDateOnly(input.endDate);
  }
  return out;
}
