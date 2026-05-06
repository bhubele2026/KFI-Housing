import type { Lease, RoomNightLog } from "@/data/mockData";

/**
 * Returns the current calendar month as a `YYYY-MM` string — the same
 * format used by `RoomNightLog.month` so the two can be compared
 * directly. Lives in a module function (rather than a constant) so unit
 * tests can stub `Date` per-case if needed without freezing module load
 * order.
 */
export function currentMonthKey(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export type HotelRateRiskKind = "below-min" | "missing";

export interface HotelRateRiskStatus {
  /**
   * `below-min` — the latest logged month is short of the minimum.
   * `missing`   — the lease has no logs at all (operator never recorded one).
   */
  kind: HotelRateRiskKind;
  /** Minimum room-nights/month required by the agreement. */
  monthlyMin: number;
  /** Latest log's `YYYY-MM` (only set when kind === "below-min"). */
  latestMonth?: string;
  /** Latest log's room-nights count (only set when kind === "below-min"). */
  latestNights?: number;
}

/**
 * Decide whether a hotel-rate lease is currently *at risk* of voiding
 * its negotiated rate. We surface the same "Below min" warning that
 * lives on the lease detail page (RoomNightLogSection), but lifted to
 * the leases list / dashboard so operators can spot the at-risk months
 * across every hotel-rate agreement at a glance.
 *
 * Returns `null` when:
 *   • The lease isn't a hotel-rate agreement (no `monthlyRoomNightMin`).
 *   • The lease has at least one logged month and the most recent one
 *     met the minimum — there's nothing to flag in the list view.
 *
 * Hotel-rate leases with **no logs at all** count as `missing`: the
 * operator hasn't recorded the month yet, which is itself a problem
 * worth surfacing (we can't verify they hit the minimum).
 */
export function getHotelRateRiskStatus(
  lease: Pick<Lease, "id" | "monthlyRoomNightMin">,
  logs: readonly RoomNightLog[],
): HotelRateRiskStatus | null {
  const monthlyMin = lease.monthlyRoomNightMin ?? 0;
  if (monthlyMin <= 0) return null;
  const own = logs.filter((l) => l.leaseId === lease.id);
  if (own.length === 0) {
    return { kind: "missing", monthlyMin };
  }
  // Logs are stored as `YYYY-MM` strings, so a lexicographic compare
  // matches a chronological compare. Pick the most recent.
  const latest = own.reduce((acc, l) => (l.month > acc.month ? l : acc));
  if (latest.roomNights < monthlyMin) {
    return {
      kind: "below-min",
      monthlyMin,
      latestMonth: latest.month,
      latestNights: latest.roomNights,
    };
  }
  return null;
}

/**
 * Same risk check, but anchored to a specific calendar month (defaults
 * to the current month). Used by the dashboard / leases-page summary
 * which asks "which hotel-rate leases are at risk *this month*?" — a
 * narrower question than {@link getHotelRateRiskStatus}, which simply
 * looks at the latest log on file.
 *
 *   • `missing`   — no log exists for `month` on this lease.
 *   • `below-min` — a log exists but its `roomNights` is below the min.
 *
 * Non-hotel-rate leases always return `null`.
 */
export function getHotelRateMonthRisk(
  lease: Pick<Lease, "id" | "monthlyRoomNightMin">,
  logs: readonly RoomNightLog[],
  month: string = currentMonthKey(),
): HotelRateRiskStatus | null {
  const monthlyMin = lease.monthlyRoomNightMin ?? 0;
  if (monthlyMin <= 0) return null;
  const log = logs.find((l) => l.leaseId === lease.id && l.month === month);
  if (!log) return { kind: "missing", monthlyMin };
  if (log.roomNights < monthlyMin) {
    return {
      kind: "below-min",
      monthlyMin,
      latestMonth: log.month,
      latestNights: log.roomNights,
    };
  }
  return null;
}
