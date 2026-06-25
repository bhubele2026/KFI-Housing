import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { addCoreIndexesIfNeeded } from "./add-core-indexes";

interface FakeQueryCall {
  text: string;
  values?: unknown[];
}

function makeFakePool(
  responder: (text: string, values?: unknown[]) => Record<string, unknown>[],
): {
  pool: Pool;
  calls: FakeQueryCall[];
} {
  const calls: FakeQueryCall[] = [];
  const pool = {
    query: vi.fn(async (text: string, values?: unknown[]) => {
      calls.push({ text, values });
      return { rows: responder(text, values) };
    }),
  } as unknown as Pool;
  return { pool, calls };
}

describe("addCoreIndexesIfNeeded", () => {
  it("no-ops when the pool is undefined", async () => {
    const result = await addCoreIndexesIfNeeded(undefined);
    expect(result).toEqual({ migrated: false, createdIndexes: [] });
  });

  it("no-ops when the pool has no query method", async () => {
    const result = await addCoreIndexesIfNeeded({} as unknown as Pool);
    expect(result).toEqual({ migrated: false, createdIndexes: [] });
  });

  it("creates no indexes on a fresh DB where the tables don't exist yet", async () => {
    const { pool, calls } = makeFakePool((text) => {
      if (text.includes("to_regclass")) return [{ exists: false }];
      return [];
    });
    const result = await addCoreIndexesIfNeeded(pool);
    expect(result).toEqual({ migrated: false, createdIndexes: [] });
    expect(calls.some((c) => c.text.includes("CREATE INDEX"))).toBe(false);
  });

  it("creates all core indexes when every table + column is present", async () => {
    const { pool, calls } = makeFakePool((text) => {
      if (text.includes("to_regclass")) return [{ exists: true }];
      if (text.includes("information_schema.columns")) return [{ exists: true }];
      return [];
    });
    const result = await addCoreIndexesIfNeeded(pool);
    expect(result.migrated).toBe(true);
    // All 11 declared indexes get an idempotent CREATE INDEX IF NOT EXISTS.
    expect(result.createdIndexes).toEqual([
      "beds_property_id_idx",
      "beds_room_id_idx",
      "occupants_status_idx",
      "occupants_property_id_idx",
      "occupants_bed_id_idx",
      "leases_property_id_idx",
      "leases_customer_id_idx",
      "leases_building_id_idx",
      "rooms_property_id_idx",
      "rooms_building_id_idx",
      "properties_customer_id_idx",
    ]);
    const creates = calls
      .filter((c) => c.text.includes("CREATE INDEX"))
      .map((c) => c.text);
    expect(creates).toHaveLength(11);
    expect(creates.every((s) => s.includes("IF NOT EXISTS"))).toBe(true);
    expect(creates[0]).toContain(
      "CREATE INDEX IF NOT EXISTS beds_property_id_idx ON beds (property_id)",
    );
  });

  it("skips an index whose column is missing (partial schema)", async () => {
    // Simulate a DB that has every table but is missing leases.building_id.
    const { pool, calls } = makeFakePool((text, values) => {
      if (text.includes("to_regclass")) return [{ exists: true }];
      if (text.includes("information_schema.columns")) {
        const table = String(values?.[0] ?? "");
        const column = String(values?.[1] ?? "");
        const missing = table === "leases" && column === "building_id";
        return [{ exists: !missing }];
      }
      return [];
    });
    const result = await addCoreIndexesIfNeeded(pool);
    expect(result.createdIndexes).not.toContain("leases_building_id_idx");
    expect(result.createdIndexes).toContain("leases_customer_id_idx");
    expect(
      calls.some((c) => c.text.includes("leases_building_id_idx")),
    ).toBe(false);
  });
});
