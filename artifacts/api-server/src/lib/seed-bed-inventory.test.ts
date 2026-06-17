import { describe, it, expect } from "vitest";
import { planBedsToCreate, AUTO_BED_ID, AUTO_ROOM_ID } from "./seed-bed-inventory";

describe("planBedsToCreate", () => {
  const pid = "prop-x";

  it("creates the full target when no beds exist yet", () => {
    const plan = planBedsToCreate(pid, [], 4);
    expect(plan.roomId).toBe(AUTO_ROOM_ID(pid));
    expect(plan.beds.map((b) => b.id)).toEqual([
      AUTO_BED_ID(pid, 1),
      AUTO_BED_ID(pid, 2),
      AUTO_BED_ID(pid, 3),
      AUTO_BED_ID(pid, 4),
    ]);
    expect(plan.beds.map((b) => b.bedNumber)).toEqual([1, 2, 3, 4]);
  });

  it("only fills the shortfall, counting existing beds toward the target", () => {
    // Two real (non-auto) beds already exist → need 2 more to reach 4.
    const plan = planBedsToCreate(pid, ["bed-real-a", "bed-real-b"], 4);
    expect(plan.beds).toHaveLength(2);
    // Numbers start at 1 and skip any already-present auto ids.
    expect(plan.beds.map((b) => b.bedNumber)).toEqual([1, 2]);
  });

  it("is idempotent: re-running with the auto beds present creates nothing", () => {
    const first = planBedsToCreate(pid, [], 3);
    const ids = first.beds.map((b) => b.id);
    const second = planBedsToCreate(pid, ids, 3);
    expect(second.beds).toHaveLength(0);
  });

  it("never overshoots when already at or above target", () => {
    expect(planBedsToCreate(pid, ["a", "b", "c", "d"], 3).beds).toHaveLength(0);
  });

  it("treats zero/negative/NaN target as nothing to do", () => {
    expect(planBedsToCreate(pid, [], 0).beds).toHaveLength(0);
    expect(planBedsToCreate(pid, [], -5).beds).toHaveLength(0);
    expect(planBedsToCreate(pid, [], Number.NaN).beds).toHaveLength(0);
  });

  it("skips an existing auto id and uses the next free number", () => {
    // Auto bed #1 already there (1 existing) → need 2 more to reach 3,
    // and #1 must be skipped so we don't collide.
    const plan = planBedsToCreate(pid, [AUTO_BED_ID(pid, 1)], 3);
    expect(plan.beds.map((b) => b.id)).toEqual([
      AUTO_BED_ID(pid, 2),
      AUTO_BED_ID(pid, 3),
    ]);
  });
});
