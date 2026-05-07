import { describe, it, expect, beforeEach } from "vitest";
import {
  recordPayrollReconciliation,
  __resetRecentPayrollReconciliationsForTests,
  __getRecentPayrollReconciliationsForTests,
  __reloadFromStorageForTests,
  type RecentPayrollReconciliation,
} from "./recent-payroll-reconciliations";

function make(
  partial: Partial<RecentPayrollReconciliation> & { id: string },
): RecentPayrollReconciliation {
  return {
    id: partial.id,
    occupantId: partial.occupantId ?? `occ-${partial.id}`,
    occupantName: partial.occupantName ?? `Name ${partial.id}`,
    propertyName: partial.propertyName ?? null,
    employer: partial.employer ?? "Acme Co",
    weekly: partial.weekly ?? 100,
    kind: partial.kind ?? "typo",
    timestamp: partial.timestamp ?? Date.now(),
  };
}

describe("recent-payroll-reconciliations store", () => {
  beforeEach(() => {
    __resetRecentPayrollReconciliationsForTests();
  });

  it("records newest entries at the front", () => {
    recordPayrollReconciliation(make({ id: "a" }));
    recordPayrollReconciliation(make({ id: "b" }));
    expect(
      __getRecentPayrollReconciliationsForTests().map((e) => e.id),
    ).toEqual(["b", "a"]);
  });

  it("caps the list at 8 entries, dropping the oldest", () => {
    for (let i = 0; i < 10; i++) {
      recordPayrollReconciliation(make({ id: `e${i}` }));
    }
    const snap = __getRecentPayrollReconciliationsForTests();
    expect(snap).toHaveLength(8);
    expect(snap.map((e) => e.id)).toEqual([
      "e9",
      "e8",
      "e7",
      "e6",
      "e5",
      "e4",
      "e3",
      "e2",
    ]);
  });

  it("preserves all fields including the cross-employer kind", () => {
    recordPayrollReconciliation(
      make({
        id: "x",
        occupantId: "occ-1",
        occupantName: "Jose Garcia",
        propertyName: "Park Place",
        employer: "Penda",
        weekly: 175.5,
        kind: "cross-employer",
        timestamp: 12345,
      }),
    );
    const top = __getRecentPayrollReconciliationsForTests()[0]!;
    expect(top).toEqual({
      id: "x",
      occupantId: "occ-1",
      occupantName: "Jose Garcia",
      propertyName: "Park Place",
      employer: "Penda",
      weekly: 175.5,
      kind: "cross-employer",
      timestamp: 12345,
    });
  });

  describe("localStorage persistence", () => {
    it("persists entries to localStorage and restores them on reload", () => {
      recordPayrollReconciliation(make({ id: "p1", timestamp: Date.now() }));
      recordPayrollReconciliation(make({ id: "p2", timestamp: Date.now() }));

      __reloadFromStorageForTests();

      const snap = __getRecentPayrollReconciliationsForTests();
      expect(snap.map((e) => e.id)).toEqual(["p2", "p1"]);
    });

    it("returns an empty list when localStorage is empty", () => {
      __reloadFromStorageForTests();
      expect(__getRecentPayrollReconciliationsForTests()).toEqual([]);
    });

    it("handles corrupted localStorage data gracefully", () => {
      localStorage.setItem(
        "housingops:recent-payroll-reconciliations",
        "not-json!!!",
      );
      __reloadFromStorageForTests();
      expect(__getRecentPayrollReconciliationsForTests()).toEqual([]);
    });

    it("clears localStorage on reset", () => {
      recordPayrollReconciliation(make({ id: "c1", timestamp: Date.now() }));
      __resetRecentPayrollReconciliationsForTests();
      expect(
        localStorage.getItem("housingops:recent-payroll-reconciliations"),
      ).toBeNull();
    });
  });

  describe("24h TTL pruning", () => {
    it("prunes entries older than 24 hours on reload", () => {
      const now = Date.now();
      const twentyFiveHoursAgo = now - 25 * 60 * 60 * 1000;

      recordPayrollReconciliation(
        make({ id: "fresh", timestamp: now }),
      );
      recordPayrollReconciliation(
        make({ id: "stale", timestamp: twentyFiveHoursAgo }),
      );

      __reloadFromStorageForTests();

      const snap = __getRecentPayrollReconciliationsForTests();
      expect(snap.map((e) => e.id)).toEqual(["fresh"]);
    });

    it("prunes stale entries when recording a new one", () => {
      const now = Date.now();
      const twentyFiveHoursAgo = now - 25 * 60 * 60 * 1000;

      recordPayrollReconciliation(
        make({ id: "old", timestamp: twentyFiveHoursAgo }),
      );

      expect(
        __getRecentPayrollReconciliationsForTests().map((e) => e.id),
      ).toEqual(["old"]);

      recordPayrollReconciliation(make({ id: "new", timestamp: now }));

      const snap = __getRecentPayrollReconciliationsForTests();
      expect(snap.map((e) => e.id)).toEqual(["new"]);
    });

    it("keeps entries that are exactly under 24 hours old", () => {
      const now = Date.now();
      const justUnder = now - (24 * 60 * 60 * 1000 - 1000);

      recordPayrollReconciliation(
        make({ id: "borderline", timestamp: justUnder }),
      );

      __reloadFromStorageForTests();

      expect(
        __getRecentPayrollReconciliationsForTests().map((e) => e.id),
      ).toEqual(["borderline"]);
    });
  });
});
