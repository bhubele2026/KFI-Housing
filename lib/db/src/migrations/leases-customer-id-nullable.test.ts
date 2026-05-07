import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { migrateLeasesCustomerIdNullableIfNeeded } from "./leases-customer-id-nullable";

interface FakeQueryCall {
  text: string;
  values?: unknown[];
}

function makeFakePool(
  responder: (
    text: string,
    values?: unknown[],
  ) => { rows: Record<string, unknown>[]; rowCount?: number },
): { pool: Pool; calls: FakeQueryCall[] } {
  const calls: FakeQueryCall[] = [];
  const pool = {
    query: vi.fn(async (text: string, values?: unknown[]) => {
      calls.push({ text, values });
      return responder(text, values);
    }),
  } as unknown as Pool;
  return { pool, calls };
}

describe("migrateLeasesCustomerIdNullableIfNeeded (Task #439)", () => {
  it("no-ops when the pool is undefined (e.g. tests without a DB)", async () => {
    const result = await migrateLeasesCustomerIdNullableIfNeeded(undefined);
    expect(result).toEqual({ migrated: false, rowsBackfilled: 0 });
  });

  it("no-ops when the pool has no `query` method", async () => {
    const result = await migrateLeasesCustomerIdNullableIfNeeded(
      {} as unknown as Pool,
    );
    expect(result).toEqual({ migrated: false, rowsBackfilled: 0 });
  });

  it("no-ops on a fresh DB where the leases table doesn't exist yet", async () => {
    const { pool, calls } = makeFakePool((text) => {
      if (text.includes("to_regclass")) return { rows: [{ exists: false }] };
      throw new Error(`unexpected query: ${text}`);
    });

    const result = await migrateLeasesCustomerIdNullableIfNeeded(pool);

    expect(result).toEqual({ migrated: false, rowsBackfilled: 0 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toMatch(/to_regclass/);
  });

  it("no-ops when the column is already nullable AND no '' rows remain", async () => {
    const { pool, calls } = makeFakePool((text) => {
      if (text.includes("to_regclass")) return { rows: [{ exists: true }] };
      if (text.includes("information_schema.columns"))
        return { rows: [{ is_nullable: "YES" }] };
      if (/SELECT count\(\*\)/i.test(text)) return { rows: [{ c: 0 }] };
      throw new Error(`unexpected query: ${text}`);
    });

    const result = await migrateLeasesCustomerIdNullableIfNeeded(pool);

    expect(result).toEqual({ migrated: false, rowsBackfilled: 0 });
    expect(calls).toHaveLength(3);
    // Critically, no ALTER TABLE / UPDATE was issued — clean re-runs are free.
    expect(calls.some((c) => /ALTER TABLE|UPDATE leases/i.test(c.text))).toBe(
      false,
    );
  });

  it("backfills stray '' rows even when the column is already nullable (recovers from a partial earlier run)", async () => {
    // Models the partial-failure case the reviewer flagged: the
    // column DDL succeeded on a prior run but the backfill UPDATE
    // never landed. The guard must still mop up the leftover rows
    // on the next pass instead of short-circuiting on nullability
    // alone.
    const { pool, calls } = makeFakePool((text) => {
      if (text.includes("to_regclass")) return { rows: [{ exists: true }] };
      if (text.includes("information_schema.columns"))
        return { rows: [{ is_nullable: "YES" }] };
      if (/SELECT count\(\*\)/i.test(text)) return { rows: [{ c: 3 }] };
      if (/^UPDATE leases/i.test(text)) return { rows: [], rowCount: 3 };
      throw new Error(`unexpected query: ${text}`);
    });

    const result = await migrateLeasesCustomerIdNullableIfNeeded(pool);

    expect(result).toEqual({ migrated: true, rowsBackfilled: 3 });
    // No ALTER TABLE — the column was already nullable.
    expect(calls.some((c) => /ALTER TABLE/i.test(c.text))).toBe(false);
    expect(calls.some((c) => /^UPDATE leases/i.test(c.text))).toBe(true);
  });

  it("drops the default + NOT NULL inside a transaction and backfills '' → NULL when the column is still notNull", async () => {
    const { pool, calls } = makeFakePool((text) => {
      if (text.includes("to_regclass")) return { rows: [{ exists: true }] };
      if (text.includes("information_schema.columns"))
        return { rows: [{ is_nullable: "NO" }] };
      if (/SELECT count\(\*\)/i.test(text)) return { rows: [{ c: 7 }] };
      if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(text.trim())) return { rows: [] };
      if (/ALTER TABLE/i.test(text)) return { rows: [] };
      if (/^UPDATE leases/i.test(text))
        return { rows: [], rowCount: 7 };
      throw new Error(`unexpected query: ${text}`);
    });
    const log = vi.fn();

    const result = await migrateLeasesCustomerIdNullableIfNeeded(pool, log);

    expect(result).toEqual({ migrated: true, rowsBackfilled: 7 });

    // Schema change is wrapped in BEGIN/COMMIT so a mid-statement
    // crash can't leave the column half-relaxed.
    const beginIdx = calls.findIndex((c) => /^BEGIN$/i.test(c.text.trim()));
    const alterIdxDefault = calls.findIndex((c) =>
      /ALTER COLUMN customer_id DROP DEFAULT/i.test(c.text),
    );
    const alterIdxNotNull = calls.findIndex((c) =>
      /ALTER COLUMN customer_id DROP NOT NULL/i.test(c.text),
    );
    const commitIdx = calls.findIndex((c) => /^COMMIT$/i.test(c.text.trim()));
    const updateIdx = calls.findIndex((c) =>
      /UPDATE leases SET customer_id = NULL WHERE customer_id = ''/i.test(
        c.text,
      ),
    );
    // The order matters: the column must be relaxed BEFORE the UPDATE
    // to NULL can succeed (NOT NULL would otherwise reject the write).
    expect(beginIdx).toBeGreaterThanOrEqual(0);
    expect(alterIdxDefault).toBeGreaterThan(beginIdx);
    expect(alterIdxNotNull).toBeGreaterThan(alterIdxDefault);
    expect(commitIdx).toBeGreaterThan(alterIdxNotNull);
    expect(updateIdx).toBeGreaterThan(commitIdx);

    // Logs bracket the migration so operators can correlate it in deploy logs.
    expect(log).toHaveBeenCalledTimes(2);
  });

  it("rolls back the transaction when an ALTER TABLE step fails mid-flight", async () => {
    let altersSeen = 0;
    const { pool, calls } = makeFakePool((text) => {
      if (text.includes("to_regclass")) return { rows: [{ exists: true }] };
      if (text.includes("information_schema.columns"))
        return { rows: [{ is_nullable: "NO" }] };
      if (/SELECT count\(\*\)/i.test(text)) return { rows: [{ c: 0 }] };
      if (/^(BEGIN|ROLLBACK)$/i.test(text.trim())) return { rows: [] };
      if (/ALTER TABLE/i.test(text)) {
        altersSeen += 1;
        if (altersSeen === 2) {
          // Simulate a crash on DROP NOT NULL after DROP DEFAULT
          // succeeded; the surrounding try/catch should ROLLBACK.
          throw new Error("simulated DDL failure");
        }
        return { rows: [] };
      }
      throw new Error(`unexpected query: ${text}`);
    });

    await expect(
      migrateLeasesCustomerIdNullableIfNeeded(pool),
    ).rejects.toThrow(/simulated DDL failure/);

    // ROLLBACK was issued; no COMMIT, no UPDATE.
    expect(calls.some((c) => /^ROLLBACK$/i.test(c.text.trim()))).toBe(true);
    expect(calls.some((c) => /^COMMIT$/i.test(c.text.trim()))).toBe(false);
    expect(calls.some((c) => /^UPDATE leases/i.test(c.text))).toBe(false);
  });
});
