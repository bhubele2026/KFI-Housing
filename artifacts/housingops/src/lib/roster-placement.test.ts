import { describe, expect, it } from "vitest";
import { countPlacedRoster } from "./roster-placement";

describe("countPlacedRoster — single source of truth for placed/unplaced", () => {
  it("counts a roster person as placed only when their personId maps to a bed-holding occupant", () => {
    const people = [
      { personId: "E1" },
      { personId: "E2" },
      { personId: "E3" }, // no occupant record at all
    ];
    const occupants = [
      { employeeId: "E1", bedId: "bed-1", status: "Active" }, // placed
      { employeeId: "E2", bedId: "", status: "Active" }, // on roster, no bed
    ];
    expect(countPlacedRoster(people, occupants)).toEqual({
      total: 3,
      placed: 1,
      unplaced: 2,
    });
  });

  it("denominator is the roster, NOT the occupant list (occupants with beds who aren't on the roster don't inflate placed)", () => {
    const people = [{ personId: "E1" }];
    const occupants = [
      { employeeId: "E1", bedId: "bed-1", status: "Active" },
      { employeeId: "E9", bedId: "bed-9", status: "Active" }, // housed but not on roster
    ];
    const r = countPlacedRoster(people, occupants);
    expect(r.total).toBe(1);
    expect(r.placed).toBe(1); // not 2
  });

  it("prefers a bed-holding occupant record when an employee has duplicates, and ignores Former rows", () => {
    const people = [{ personId: "E1" }, { personId: "E2" }];
    const occupants = [
      { employeeId: "E1", bedId: "", status: "Active" },
      { employeeId: "E1", bedId: "bed-1", status: "Active" }, // bed-holding wins
      { employeeId: "E2", bedId: "bed-2", status: "Former" }, // Former is ignored
    ];
    expect(countPlacedRoster(people, occupants)).toEqual({
      total: 2,
      placed: 1, // E1 placed; E2 only had a Former bed row
      unplaced: 1,
    });
  });
});
