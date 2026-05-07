import { describe, it, expect, beforeEach } from "vitest";
import {
  recordPayrollReconciliation,
  __resetRecentPayrollReconciliationsForTests,
  __getRecentPayrollReconciliationsForTests,
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
});
