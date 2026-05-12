import { describe, expect, it } from "vitest";
import { planBuildingsBackfill, type PropertyShape } from "./backfill-buildings";

describe("planBuildingsBackfill", () => {
  it("creates one building per property mirroring its address", () => {
    const props: PropertyShape[] = [
      { id: "p1", address: "100 Oak Way", city: "Austin", state: "TX", zip: "78701" },
      { id: "p2", address: "200 Pine St", city: "Dallas", state: "TX", zip: "75201" },
    ];
    const plan = planBuildingsBackfill(props);
    expect(plan.buildings).toEqual([
      { id: "bldg_p1_1", propertyId: "p1", name: "Main building", address: "100 Oak Way", city: "Austin", state: "TX", zip: "78701" },
      { id: "bldg_p2_1", propertyId: "p2", name: "Main building", address: "200 Pine St", city: "Dallas", state: "TX", zip: "75201" },
    ]);
    expect(plan.defaultBuildingByProperty.get("p1")).toBe("bldg_p1_1");
    expect(plan.defaultBuildingByProperty.get("p2")).toBe("bldg_p2_1");
  });

  it("is deterministic regardless of input order", () => {
    const a = planBuildingsBackfill([
      { id: "p2", address: "", city: "", state: "", zip: "" },
      { id: "p1", address: "", city: "", state: "", zip: "" },
    ]);
    const b = planBuildingsBackfill([
      { id: "p1", address: "", city: "", state: "", zip: "" },
      { id: "p2", address: "", city: "", state: "", zip: "" },
    ]);
    expect(a.buildings).toEqual(b.buildings);
  });
});
