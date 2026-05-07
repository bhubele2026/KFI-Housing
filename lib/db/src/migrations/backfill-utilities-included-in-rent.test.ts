import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import {
  backfillUtilitiesIncludedInRent,
  detectsUtilitiesIncludedInRent,
} from "./backfill-utilities-included-in-rent";

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

describe("detectsUtilitiesIncludedInRent", () => {
  it("matches common operator phrasings (case-insensitive)", () => {
    const positives = [
      "Utilities included in lease except internet.",
      "Utilities are included.",
      "utilities included",
      "Util incl",
      "utils included",
      "util. included",
      "Utilities in rent.",
      "utility is in the rent",
    ];
    for (const text of positives) {
      expect(
        detectsUtilitiesIncludedInRent(text),
        `expected match for: ${text}`,
      ).toBe(true);
    }
  });

  it("returns false on unrelated text and empty inputs", () => {
    expect(detectsUtilitiesIncludedInRent("")).toBe(false);
    expect(detectsUtilitiesIncludedInRent(null, undefined)).toBe(false);
    expect(
      detectsUtilitiesIncludedInRent("Tenant pays own utilities."),
    ).toBe(false);
    expect(detectsUtilitiesIncludedInRent("internet not included")).toBe(false);
  });

  it("scans every supplied field — any match wins", () => {
    expect(
      detectsUtilitiesIncludedInRent(
        "no rent details",
        "n/a",
        "utilities included",
      ),
    ).toBe(true);
  });
});

describe("backfillUtilitiesIncludedInRent", () => {
  it("no-ops when the pool is undefined", async () => {
    const result = await backfillUtilitiesIncludedInRent(undefined);
    expect(result).toEqual({ migrated: false, updated: 0 });
  });

  it("no-ops on a fresh DB where the leases table doesn't exist", async () => {
    const { pool, calls } = makeFakePool((text) => {
      if (text.includes("to_regclass")) return [{ exists: false }];
      throw new Error(`unexpected query: ${text}`);
    });
    const result = await backfillUtilitiesIncludedInRent(pool);
    expect(result).toEqual({ migrated: false, updated: 0 });
    expect(calls).toHaveLength(1);
  });

  it("no-ops when the column hasn't been pushed yet", async () => {
    const { pool, calls } = makeFakePool((text) => {
      if (text.includes("to_regclass")) return [{ exists: true }];
      if (text.includes("information_schema.columns"))
        return [{ exists: false }];
      throw new Error(`unexpected query: ${text}`);
    });
    const result = await backfillUtilitiesIncludedInRent(pool);
    expect(result).toEqual({ migrated: false, updated: 0 });
    expect(calls.some((c) => /UPDATE leases/i.test(c.text))).toBe(false);
  });

  it("flips matching rows and reports the count", async () => {
    const { pool, calls } = makeFakePool((text) => {
      if (text.includes("to_regclass")) return [{ exists: true }];
      if (text.includes("information_schema.columns"))
        return [{ exists: true }];
      if (/SELECT id, notes, clauses/i.test(text)) {
        return [
          { id: "l1", notes: "Utilities included.", clauses: "" },
          { id: "l2", notes: "Tenant pays own utilities.", clauses: "" },
          { id: "l3", notes: "", clauses: "util incl" },
        ];
      }
      if (/UPDATE leases/i.test(text)) return [];
      throw new Error(`unexpected query: ${text}`);
    });
    const log = vi.fn();
    const result = await backfillUtilitiesIncludedInRent(pool, log);
    expect(result).toEqual({ migrated: true, updated: 2 });
    const update = calls.find((c) => /UPDATE leases/i.test(c.text));
    expect(update?.values?.[0]).toEqual(["l1", "l3"]);
    expect(log).toHaveBeenCalledTimes(2);
  });

  it("no-ops when no rows match (idempotent re-run)", async () => {
    const { pool, calls } = makeFakePool((text) => {
      if (text.includes("to_regclass")) return [{ exists: true }];
      if (text.includes("information_schema.columns"))
        return [{ exists: true }];
      if (/SELECT id, notes, clauses/i.test(text)) {
        return [
          { id: "l1", notes: "Tenant pays own utilities.", clauses: "" },
        ];
      }
      throw new Error(`unexpected query: ${text}`);
    });
    const result = await backfillUtilitiesIncludedInRent(pool);
    expect(result).toEqual({ migrated: false, updated: 0 });
    expect(calls.some((c) => /UPDATE leases/i.test(c.text))).toBe(false);
  });
});
