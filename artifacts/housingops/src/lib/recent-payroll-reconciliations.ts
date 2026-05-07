// In-memory audit trail of payroll suggestions that the operator just
// applied from the dashboard "Did you mean" / "Confirm match" buttons.
//
// When a suggestion is applied the corresponding row silently disappears
// from the unplaced / low-confidence lists on the next refetch — there
// was no way to spot a wrong guess afterwards. This store keeps the last
// few applied suggestions so the dashboard can render a "Recently
// reconciled from payroll" card with a link back to the occupant for
// sanity-checking or undoing the change.
//
// Mirrors the shape of `recent-lease-uploads.ts` (in-memory,
// useSyncExternalStore). Persistence across reloads is not necessary —
// the audit trail's purpose is to catch a wrong guess immediately after
// the click, not weeks later.

import { useSyncExternalStore } from "react";

export type PayrollReconciliationKind =
  // Operator confirmed the seeder's name-only fallback pick (low-
  // confidence "Confirm" button). Same employer, same person.
  | "confirm"
  // Operator picked a same-employer alternative from the "Did you mean"
  // list — typically a payroll typo / initial fix.
  | "typo"
  // Operator picked a different-employer alternative. The occupant's
  // company is also being changed, which is the higher-risk class of
  // mistake; surfaced with a warning badge so it stands out.
  | "cross-employer";

export interface RecentPayrollReconciliation {
  /** Stable id for the row (also used as React key). */
  id: string;
  occupantId: string;
  /** Display name of the occupant the rate was applied to. */
  occupantName: string;
  /** Optional property name for context — null if the occupant is unassigned. */
  propertyName: string | null;
  /** The new employer the occupant is now associated with. */
  employer: string;
  /** Weekly rate that was applied. */
  weekly: number;
  kind: PayrollReconciliationKind;
  /** Epoch ms — used for relative-time display and ordering. */
  timestamp: number;
}

const MAX_ENTRIES = 8;

let entries: RecentPayrollReconciliation[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** Push a new entry to the front of the list, capped at MAX_ENTRIES. */
export function recordPayrollReconciliation(
  entry: RecentPayrollReconciliation,
): void {
  entries = [entry, ...entries].slice(0, MAX_ENTRIES);
  emit();
}

/** Test helper — wipes the store. Not exported through any UI surface. */
export function __resetRecentPayrollReconciliationsForTests(): void {
  entries = [];
  emit();
}

/** Test helper — current list snapshot without going through React. */
export function __getRecentPayrollReconciliationsForTests(): RecentPayrollReconciliation[] {
  return entries;
}

/**
 * React hook returning the current list of recent reconciliations,
 * newest first. Components re-render when the list changes.
 */
export function useRecentPayrollReconciliations(): RecentPayrollReconciliation[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => entries,
    () => entries,
  );
}
