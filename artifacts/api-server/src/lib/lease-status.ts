/**
 * Single source of truth for lease status (Active / Expired / Upcoming).
 *
 * Status is derived from `(startDate, endDate, today)` so the value the UI
 * shows always reflects today's calendar — a lease seeded as "Active"
 * automatically transitions to "Expired" the day after its end date,
 * without re-running any seed or importer.
 *
 * All dates are zero-padded ISO `YYYY-MM-DD` strings, so a lexicographic
 * compare is equivalent to a chronological compare and we don't need to
 * parse anything.
 */

export type LeaseStatus = "Active" | "Expired" | "Upcoming";

/**
 * Compute the status of a lease whose term is `[startDate, endDate]` as
 * of `today`. Today before the start → "Upcoming"; today after the end →
 * "Expired"; otherwise "Active".
 */
export function computeLeaseStatus(
  startDate: string,
  endDate: string,
  today: string,
): LeaseStatus {
  if (today < startDate) return "Upcoming";
  if (today > endDate) return "Expired";
  return "Active";
}

/**
 * Number of whole calendar days from `today` until `endDate`. Negative
 * when the lease is already past its end date. Both inputs must be
 * zero-padded ISO `YYYY-MM-DD` strings (the same shape the API enforces
 * at its boundary), so we can do plain Date arithmetic without parsing
 * a free-form string.
 *
 * Used by the dashboard "Expiring soon" alerts to bucket leases into
 * 30 / 60 / 90-day windows before they actually flip to "Expired".
 */
export function daysUntilExpiry(endDate: string, today: string): number {
  const end = new Date(`${endDate}T00:00:00Z`);
  const now = new Date(`${today}T00:00:00Z`);
  const ms = end.getTime() - now.getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

/** Format a `Date` as the same `YYYY-MM-DD` form the schema uses. */
export function todayIso(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Derive the status of a lease row whose `startDate` / `endDate` may be
 * blank. When both term dates are present we always re-derive from
 * today; when either is missing (e.g. master-import rows that still need
 * triage) we keep the stored status, since there is no calendar to
 * compare against.
 */
export function deriveLeaseStatus(
  lease: { startDate: string; endDate: string; status: string },
  now: Date = new Date(),
): string {
  if (!lease.startDate || !lease.endDate) return lease.status;
  return computeLeaseStatus(lease.startDate, lease.endDate, todayIso(now));
}
