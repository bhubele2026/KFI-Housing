import { describe, it, expect } from "vitest";
import {
  planUtilityInserts,
  utilityKey,
  UTILITIES_FROM_EMAIL,
  type UtilitySeed,
} from "./seed-utilities-from-email";

const allProps = new Set(UTILITIES_FROM_EMAIL.map((u) => u.propertyId));

describe("planUtilityInserts", () => {
  it("inserts every embedded utility when none exist and all properties are known", () => {
    const rows = planUtilityInserts(new Set(), allProps);
    expect(rows).toHaveLength(UTILITIES_FROM_EMAIL.length);
    // ids are deterministic + unique
    const ids = rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    // type stays within the enum (sample check)
    expect(rows.every((r) => ["Electric", "Gas", "Propane", "Water", "Garbage", "Internet", "Other"].includes(r.type as string))).toBe(true);
  });

  it("skips a utility whose natural key already exists (idempotent / no dupes vs manual rows)", () => {
    const sunset = UTILITIES_FROM_EMAIL.find((u) => u.propertyId === "prop-sunset-place-neillsville")!;
    const existing = new Set([utilityKey(sunset.propertyId, sunset.type, sunset.company)]);
    const rows = planUtilityInserts(existing, allProps);
    expect(rows.some((r) => r.propertyId === sunset.propertyId && r.type === sunset.type)).toBe(false);
    expect(rows).toHaveLength(UTILITIES_FROM_EMAIL.length - 1);
  });

  it("skips utilities whose property doesn't exist", () => {
    const rows = planUtilityInserts(new Set(), new Set(["prop-only-this-one" as string]));
    expect(rows).toEqual([]);
  });

  it("dedupes within the embedded list itself", () => {
    const dupes: UtilitySeed[] = [
      { propertyId: "p", type: "Electric", company: "Acme", accountNumber: "", notes: "" },
      { propertyId: "p", type: "Electric", company: "acme", accountNumber: "", notes: "x" },
    ];
    const rows = planUtilityInserts(new Set(), new Set(["p"]), dupes);
    expect(rows).toHaveLength(1);
  });
});
