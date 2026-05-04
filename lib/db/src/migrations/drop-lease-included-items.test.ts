import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { dropLeaseIncludedItemsIfNeeded } from "./drop-lease-included-items";

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

describe("dropLeaseIncludedItemsIfNeeded", () => {
  it("no-ops when the pool is undefined (e.g. tests without a DB)", async () => {
    const result = await dropLeaseIncludedItemsIfNeeded(undefined);
    expect(result).toEqual({ migrated: false });
  });

  it("no-ops when the pool has no `query` method", async () => {
    const result = await dropLeaseIncludedItemsIfNeeded(
      {} as unknown as Pool,
    );
    expect(result).toEqual({ migrated: false });
  });

  it("no-ops on a fresh DB where the leases table doesn't exist yet", async () => {
    const { pool, calls } = makeFakePool((text) => {
      if (text.includes("to_regclass")) return [{ exists: false }];
      throw new Error(`unexpected query: ${text}`);
    });

    const result = await dropLeaseIncludedItemsIfNeeded(pool);

    expect(result).toEqual({ migrated: false });
    // Only the table-existence probe should have run — no column probe, no DROP.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toMatch(/to_regclass/);
  });

  it("no-ops when the leases table exists but the column has already been dropped", async () => {
    const { pool, calls } = makeFakePool((text) => {
      if (text.includes("to_regclass")) return [{ exists: true }];
      if (text.includes("information_schema.columns"))
        return [{ exists: false }];
      throw new Error(`unexpected query: ${text}`);
    });

    const result = await dropLeaseIncludedItemsIfNeeded(pool);

    expect(result).toEqual({ migrated: false });
    expect(calls).toHaveLength(2);
    // Critically, no ALTER TABLE call was issued.
    expect(calls.some((c) => /ALTER TABLE/i.test(c.text))).toBe(false);
  });

  it("drops the column when it still exists, and reports migrated:true", async () => {
    const { pool, calls } = makeFakePool((text) => {
      if (text.includes("to_regclass")) return [{ exists: true }];
      if (text.includes("information_schema.columns"))
        return [{ exists: true }];
      if (/ALTER TABLE/i.test(text)) return [];
      throw new Error(`unexpected query: ${text}`);
    });
    const log = vi.fn();

    const result = await dropLeaseIncludedItemsIfNeeded(pool, log);

    expect(result).toEqual({ migrated: true });
    const alter = calls.find((c) => /ALTER TABLE/i.test(c.text));
    expect(alter?.text).toMatch(
      /ALTER TABLE leases DROP COLUMN IF EXISTS included_items/i,
    );
    // Logs bracket the drop so operators can correlate the change in deploy logs.
    expect(log).toHaveBeenCalledTimes(2);
  });
});
