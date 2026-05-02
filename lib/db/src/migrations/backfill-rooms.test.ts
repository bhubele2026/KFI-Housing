import { describe, expect, it } from "vitest";
import { planBackfill, type BedRow } from "./backfill-rooms";

describe("planBackfill", () => {
  it("creates one room per (property, room-name) group and maps beds to it", () => {
    const beds: BedRow[] = [
      { id: "b1", propertyId: "p1", bedNumber: 1, room: "Room A" },
      { id: "b2", propertyId: "p1", bedNumber: 2, room: "Room A" },
      { id: "b3", propertyId: "p1", bedNumber: 3, room: "Room B" },
      { id: "b4", propertyId: "p2", bedNumber: 1, room: "Room A" },
    ];

    const plan = planBackfill(beds);

    expect(plan.rooms).toEqual([
      { id: "r_p1_1", propertyId: "p1", name: "Room A" },
      { id: "r_p1_2", propertyId: "p1", name: "Room B" },
      { id: "r_p2_1", propertyId: "p2", name: "Room A" },
    ]);
    expect(plan.bedRoomIds.get("b1")).toBe("r_p1_1");
    expect(plan.bedRoomIds.get("b2")).toBe("r_p1_1");
    expect(plan.bedRoomIds.get("b3")).toBe("r_p1_2");
    expect(plan.bedRoomIds.get("b4")).toBe("r_p2_1");
  });

  it("treats empty/whitespace room names as a single auto-named room per property", () => {
    const beds: BedRow[] = [
      { id: "b1", propertyId: "p1", bedNumber: 1, room: "" },
      { id: "b2", propertyId: "p1", bedNumber: 2, room: "   " },
      { id: "b3", propertyId: "p1", bedNumber: 3, room: "Room A" },
    ];

    const plan = planBackfill(beds);

    expect(plan.rooms).toHaveLength(2);
    expect(plan.rooms[0].name).toBe("Room 1");
    expect(plan.rooms[1].name).toBe("Room A");
    expect(plan.bedRoomIds.get("b1")).toBe(plan.bedRoomIds.get("b2"));
    expect(plan.bedRoomIds.get("b1")).not.toBe(plan.bedRoomIds.get("b3"));
  });

  it("groups case-insensitively so 'Room A' and 'room a' merge", () => {
    const beds: BedRow[] = [
      { id: "b1", propertyId: "p1", bedNumber: 1, room: "Room A" },
      { id: "b2", propertyId: "p1", bedNumber: 2, room: "room a" },
    ];
    const plan = planBackfill(beds);
    expect(plan.rooms).toHaveLength(1);
    expect(plan.bedRoomIds.get("b1")).toBe(plan.bedRoomIds.get("b2"));
  });

  it("produces deterministic output regardless of input order", () => {
    const a: BedRow[] = [
      { id: "b3", propertyId: "p1", bedNumber: 3, room: "Room B" },
      { id: "b1", propertyId: "p1", bedNumber: 1, room: "Room A" },
      { id: "b2", propertyId: "p1", bedNumber: 2, room: "Room A" },
    ];
    const b: BedRow[] = [
      { id: "b1", propertyId: "p1", bedNumber: 1, room: "Room A" },
      { id: "b2", propertyId: "p1", bedNumber: 2, room: "Room A" },
      { id: "b3", propertyId: "p1", bedNumber: 3, room: "Room B" },
    ];
    expect(planBackfill(a).rooms).toEqual(planBackfill(b).rooms);
  });
});
