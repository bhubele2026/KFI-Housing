import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { addOccupantProfileFieldsIfNeeded } from "./add-occupant-profile-fields";

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

describe("addOccupantProfileFieldsIfNeeded", () => {
  it("no-ops when the pool is undefined", async () => {
    const result = await addOccupantProfileFieldsIfNeeded(undefined);
    expect(result).toEqual({ migrated: false, addedColumns: [] });
  });

  it("no-ops when the pool has no query method", async () => {
    const result = await addOccupantProfileFieldsIfNeeded(
      {} as unknown as Pool,
    );
    expect(result).toEqual({ migrated: false, addedColumns: [] });
  });

  it("no-ops on a fresh DB where the occupants table doesn't exist yet", async () => {
    const { pool, calls } = makeFakePool((text) => {
      if (text.includes("to_regclass")) return [{ exists: false }];
      return [];
    });
    const result = await addOccupantProfileFieldsIfNeeded(pool);
    expect(result).toEqual({ migrated: false, addedColumns: [] });
    expect(calls.some((c) => c.text.includes("ALTER TABLE"))).toBe(false);
  });

  it("no-ops when all four profile columns are already present", async () => {
    const { pool, calls } = makeFakePool((text) => {
      if (text.includes("to_regclass")) return [{ exists: true }];
      if (text.includes("information_schema.columns")) {
        return [{ exists: true }];
      }
      return [];
    });
    const result = await addOccupantProfileFieldsIfNeeded(pool);
    expect(result).toEqual({ migrated: false, addedColumns: [] });
    expect(calls.some((c) => c.text.includes("ALTER TABLE"))).toBe(false);
  });

  it("adds the four nullable columns when none of them exist yet", async () => {
    const { pool, calls } = makeFakePool((text) => {
      if (text.includes("to_regclass")) return [{ exists: true }];
      if (text.includes("information_schema.columns")) {
        return [{ exists: false }];
      }
      return [];
    });
    const result = await addOccupantProfileFieldsIfNeeded(pool);
    expect(result.migrated).toBe(true);
    expect(result.addedColumns).toEqual([
      "language",
      "gender",
      "title",
      "kfis_authorized_to_drive",
    ]);
    const alters = calls
      .filter((c) => c.text.includes("ALTER TABLE"))
      .map((c) => c.text);
    expect(alters).toHaveLength(4);
    expect(alters[0]).toContain("ADD COLUMN IF NOT EXISTS language text");
    expect(alters[1]).toContain("ADD COLUMN IF NOT EXISTS gender text");
    expect(alters[2]).toContain("ADD COLUMN IF NOT EXISTS title text");
    expect(alters[3]).toContain(
      "ADD COLUMN IF NOT EXISTS kfis_authorized_to_drive boolean",
    );
  });

  it("only adds the columns that are actually missing", async () => {
    const present = new Set(["language", "title"]);
    const { pool, calls } = makeFakePool((text, values) => {
      if (text.includes("to_regclass")) return [{ exists: true }];
      if (text.includes("information_schema.columns")) {
        const col = String(values?.[1] ?? "");
        return [{ exists: present.has(col) }];
      }
      return [];
    });
    const result = await addOccupantProfileFieldsIfNeeded(pool);
    expect(result.migrated).toBe(true);
    expect(result.addedColumns).toEqual(["gender", "kfis_authorized_to_drive"]);
    const alters = calls
      .filter((c) => c.text.includes("ALTER TABLE"))
      .map((c) => c.text);
    expect(alters).toHaveLength(2);
    expect(alters[0]).toContain("ADD COLUMN IF NOT EXISTS gender text");
    expect(alters[1]).toContain(
      "ADD COLUMN IF NOT EXISTS kfis_authorized_to_drive boolean",
    );
  });
});
