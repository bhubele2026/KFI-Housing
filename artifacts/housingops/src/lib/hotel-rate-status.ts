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
/**
 * Returns the subset of `leases` that are hotel-rate (have a positive
 * `monthlyRoomNightMin`), still in scope (Active or Upcoming), and
 * have **no** room-night log recorded for `month`. Used by the
 * month-rollover reminder so the toast description can name a count
 * the operator can act on without paging through /leases. Expired
 * hotel-rate leases are skipped — there's no rate left to void.
 */
export function getHotelRateLeasesMissingMonthLog<
  L extends Pick<Lease, "id" | "monthlyRoomNightMin"> & { status?: Lease["status"] },
>(
  leases: readonly L[],
  logs: readonly RoomNightLog[],
  month: string = currentMonthKey(),
): L[] {
  const loggedLeaseIds = new Set(
    logs.filter((l) => l.month === month).map((l) => l.leaseId),
  );
  return leases.filter((lease) => {
    const monthlyMin = lease.monthlyRoomNightMin ?? 0;
    if (monthlyMin <= 0) return false;
    if (lease.status && lease.status !== "Active" && lease.status !== "Upcoming") {
      return false;
    }
    return !loggedLeaseIds.has(lease.id);
  });
}

/**
 * localStorage key holding the most recent `YYYY-MM` for which the
 * operator has dismissed (or implicitly acknowledged by viewing) the
 * "no room-night log yet" reminder. Persisting the *month* — not a
 * boolean — is what makes the reminder auto-roll forward: the next
 * calendar month will not match the stored value, so the toast fires
 * once, gets dismissed, the new month is written, and the cycle
 * repeats. Centralized here so the hook and tests share one constant.
 */
export const HOTEL_RATE_REMINDER_STORAGE_KEY =
  "housingops:hotel-rate-month-reminder-ack";

/**
 * Read the month the operator last acknowledged the reminder for.
 * Returns `null` when nothing is persisted (fresh session) or when
 * localStorage is unavailable (Safari Private Mode, SSR). A `null`
 * return is treated as "never acknowledged" — the reminder will fire
 * the first time conditions warrant it.
 */
export function readAcknowledgedReminderMonth(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(HOTEL_RATE_REMINDER_STORAGE_KEY);
    return v && /^\d{4}-\d{2}$/.test(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Persist the month the operator just acknowledged. Best-effort:
 * losing the value (Safari Private Mode, quota exceeded) means the
 * reminder may re-fire on the next reload, which is the safe failure
 * mode — better to nag twice than silently swallow a missed log.
 */
export function writeAcknowledgedReminderMonth(month: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(HOTEL_RATE_REMINDER_STORAGE_KEY, month);
  } catch {
    // Best-effort persistence — see the read counterpart.
  }
}

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
