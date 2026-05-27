import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { addBedNeedsCleaningSinceIfNeeded } from "./add-bed-needs-cleaning-since";

interface FakeQueryCall {
  text: string;
  values?: unknown[];
}

function makeFakePool(
  responder: (
    text: string,
    values?: unknown[],
  ) => { rows: Record<string, unknown>[]; rowCount?: number },
): {
  pool: Pool;
  calls: FakeQueryCall[];
} {
  const calls: FakeQueryCall[] = [];
  const pool = {
    query: vi.fn(async (text: string, values?: unknown[]) => {
      calls.push({ text, values });
      return responder(text, values);
    }),
  } as unknown as Pool;
  return { pool, calls };
}

describe("addBedNeedsCleaningSinceIfNeeded", () => {
  it("no-ops when the pool is undefined", async () => {
    const result = await addBedNeedsCleaningSinceIfNeeded(undefined);
    expect(result).toEqual({ migrated: false, backfilled: 0 });
  });

  it("no-ops when the pool has no query method", async () => {
    const result = await addBedNeedsCleaningSinceIfNeeded(
      {} as unknown as Pool,
    );
    expect(result).toEqual({ migrated: false, backfilled: 0 });
  });

  it("no-ops on a fresh DB where the beds table doesn't exist yet", async () => {
    const { pool, calls } = makeFakePool((text) => {
      if (text.includes("to_regclass")) return { rows: [{ exists: false }] };
      return { rows: [] };
    });
    const result = await addBedNeedsCleaningSinceIfNeeded(pool);
    expect(result).toEqual({ migrated: false, backfilled: 0 });
    expect(calls.some((c) => c.text.includes("ALTER TABLE"))).toBe(false);
  });

  it("no-ops when the column is already present", async () => {
    const { pool, calls } = makeFakePool((text) => {
      if (text.includes("to_regclass")) return { rows: [{ exists: true }] };
      if (text.includes("information_schema.columns"))
        return { rows: [{ exists: true }] };
      return { rows: [] };
    });
    const result = await addBedNeedsCleaningSinceIfNeeded(pool);
    expect(result).toEqual({ migrated: false, backfilled: 0 });
    expect(calls.some((c) => c.text.includes("ALTER TABLE"))).toBe(false);
  });

  it("adds the column and back-fills existing needs_cleaning rows", async () => {
    const { pool, calls } = makeFakePool((text) => {
      if (text.includes("to_regclass")) return { rows: [{ exists: true }] };
      if (text.includes("information_schema.columns"))
        return { rows: [{ exists: false }] };
      if (text.includes("UPDATE beds")) return { rows: [], rowCount: 3 };
      return { rows: [] };
    });
    const result = await addBedNeedsCleaningSinceIfNeeded(pool);
    expect(result).toEqual({ migrated: true, backfilled: 3 });
    const alter = calls.find((c) => c.text.includes("ALTER TABLE"));
    expect(alter?.text).toContain(
      "ADD COLUMN IF NOT EXISTS needs_cleaning_since timestamptz",
    );
    const update = calls.find((c) => c.text.includes("UPDATE beds"));
    expect(update?.text).toContain("cleaning_status = 'needs_cleaning'");
    expect(update?.text).toContain(
      "needs_cleaning_since = updated_at",
    );
  });
});
