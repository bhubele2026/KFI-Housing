import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { dropAssistantExportsContentIfNeeded } from "./drop-assistant-exports-content";

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

describe("dropAssistantExportsContentIfNeeded (Task #684)", () => {
  it("no-ops when the pool is undefined", async () => {
    const result = await dropAssistantExportsContentIfNeeded(undefined);
    expect(result).toEqual({ migrated: false });
  });

  it("no-ops on a fresh DB where assistant_exports doesn't exist", async () => {
    const { pool, calls } = makeFakePool((text) => {
      if (text.includes("to_regclass")) return { rows: [{ exists: false }] };
      throw new Error(`unexpected query: ${text}`);
    });
    const result = await dropAssistantExportsContentIfNeeded(pool);
    expect(result).toEqual({ migrated: false });
    expect(calls).toHaveLength(1);
  });

  it("no-ops once content is gone and storage_key is in place", async () => {
    const { pool, calls } = makeFakePool((text, values) => {
      if (text.includes("to_regclass")) return { rows: [{ exists: true }] };
      if (text.includes("information_schema.columns")) {
        const col = (values?.[1] as string) ?? "";
        if (col === "content") return { rows: [{ exists: false }] };
        if (col === "storage_key") return { rows: [{ exists: true }] };
      }
      throw new Error(`unexpected query: ${text}`);
    });
    const result = await dropAssistantExportsContentIfNeeded(pool);
    expect(result).toEqual({ migrated: false });
    // Critically, no DELETE / ALTER was issued — repeat runs are free.
    expect(calls.some((c) => /DELETE|ALTER/i.test(c.text))).toBe(false);
  });

  it("drops content, adds storage_key NOT NULL, and clears legacy rows when both apply", async () => {
    const { pool, calls } = makeFakePool((text, values) => {
      if (text.includes("to_regclass")) return { rows: [{ exists: true }] };
      if (text.includes("information_schema.columns")) {
        const col = (values?.[1] as string) ?? "";
        if (col === "content") return { rows: [{ exists: true }] };
        if (col === "storage_key") return { rows: [{ exists: false }] };
      }
      if (/^DELETE FROM assistant_exports/i.test(text))
        return { rows: [], rowCount: 5 };
      if (/ALTER TABLE/i.test(text)) return { rows: [] };
      throw new Error(`unexpected query: ${text}`);
    });
    const log = vi.fn();
    const result = await dropAssistantExportsContentIfNeeded(pool, log);
    expect(result).toEqual({ migrated: true });

    // The order must be: DELETE → ADD storage_key (with default) →
    // DROP default → DROP content. Otherwise adding a NOT NULL column
    // without a default would fail on the legacy rows.
    const deleteIdx = calls.findIndex((c) =>
      /^DELETE FROM assistant_exports/i.test(c.text),
    );
    const addIdx = calls.findIndex((c) =>
      /ADD COLUMN storage_key/i.test(c.text),
    );
    const dropDefaultIdx = calls.findIndex((c) =>
      /storage_key DROP DEFAULT/i.test(c.text),
    );
    const dropContentIdx = calls.findIndex((c) =>
      /DROP COLUMN IF EXISTS content/i.test(c.text),
    );
    expect(deleteIdx).toBeGreaterThanOrEqual(0);
    expect(addIdx).toBeGreaterThan(deleteIdx);
    expect(dropDefaultIdx).toBeGreaterThan(addIdx);
    expect(dropContentIdx).toBeGreaterThan(dropDefaultIdx);
  });

  it("just drops content when storage_key was already added by a partial earlier run", async () => {
    const { pool, calls } = makeFakePool((text, values) => {
      if (text.includes("to_regclass")) return { rows: [{ exists: true }] };
      if (text.includes("information_schema.columns")) {
        const col = (values?.[1] as string) ?? "";
        if (col === "content") return { rows: [{ exists: true }] };
        if (col === "storage_key") return { rows: [{ exists: true }] };
      }
      if (/^DELETE FROM assistant_exports/i.test(text))
        return { rows: [], rowCount: 0 };
      if (/ALTER TABLE/i.test(text)) return { rows: [] };
      throw new Error(`unexpected query: ${text}`);
    });
    const result = await dropAssistantExportsContentIfNeeded(pool);
    expect(result).toEqual({ migrated: true });
    // No second ADD COLUMN attempt — storage_key was already in place.
    expect(calls.some((c) => /ADD COLUMN storage_key/i.test(c.text))).toBe(
      false,
    );
    expect(
      calls.some((c) => /DROP COLUMN IF EXISTS content/i.test(c.text)),
    ).toBe(true);
  });
});
