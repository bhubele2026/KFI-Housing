import { useSyncExternalStore } from "react";

export type PayrollReconciliationKind =
  | "confirm"
  | "typo"
  | "cross-employer";

export interface PayrollReconciliationPrevState {
  chargePerBed: number;
  billingFrequency: string;
  employeeId: string;
  company: string;
}

export interface RecentPayrollReconciliation {
  id: string;
  occupantId: string;
  occupantName: string;
  propertyName: string | null;
  employer: string;
  weekly: number;
  kind: PayrollReconciliationKind;
  timestamp: number;
  prev: PayrollReconciliationPrevState;
}

const MAX_ENTRIES = 8;
const STORAGE_KEY = "housingops:recent-payroll-reconciliations";
const TTL_MS = 24 * 60 * 60 * 1000;

function pruneStale(
  list: RecentPayrollReconciliation[],
  now: number = Date.now(),
): RecentPayrollReconciliation[] {
  return list.filter((e) => now - e.timestamp < TTL_MS);
}

function loadFromStorage(): RecentPayrollReconciliation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: RecentPayrollReconciliation[] = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const cleaned = pruneStale(parsed).slice(0, MAX_ENTRIES);
    if (cleaned.length !== parsed.length) {
      saveToStorage(cleaned);
    }
    return cleaned;
  } catch {
    return [];
  }
}

function saveToStorage(list: RecentPayrollReconciliation[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // Storage full or unavailable — silently ignore.
  }
}

let entries: RecentPayrollReconciliation[] = loadFromStorage();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function recordPayrollReconciliation(
  entry: RecentPayrollReconciliation,
): void {
  entries = [entry, ...pruneStale(entries)].slice(0, MAX_ENTRIES);
  saveToStorage(entries);
  emit();
}

/** Remove a single entry by id (used by the Undo button). */
export function removePayrollReconciliation(id: string): void {
  entries = entries.filter((e) => e.id !== id);
  saveToStorage(entries);
  emit();
}

export function __resetRecentPayrollReconciliationsForTests(): void {
  entries = [];
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // noop
  }
  emit();
}

export function __getRecentPayrollReconciliationsForTests(): RecentPayrollReconciliation[] {
  return entries;
}

export function __reloadFromStorageForTests(): void {
  entries = loadFromStorage();
  emit();
}

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
