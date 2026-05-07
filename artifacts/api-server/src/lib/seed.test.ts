import { describe, expect, it } from "vitest";
import {
  AUTO_SEED_DISABLED_MARKER_ID,
  isAutoSeedDisabled,
} from "./seed";

// Lightweight stand-in for the rows `isAutoSeedDisabled` reads. The
// real query is a single `select({ lastSentKey }) from(scheduler_state)
// where(id = AUTO_SEED_DISABLED_MARKER_ID).limit(1)` — we only need a
// builder shape that yields whatever rows the test wants.
type Row = { lastSentKey: string | null };

function makeFakeDb(rows: Row[]) {
  const calls = {
    lastWhereId: undefined as string | undefined,
    selectCount: 0,
  };
  const builder = {
    from() {
      return builder;
    },
    where(_predicate: unknown) {
      // The predicate is a Drizzle SQL expression with internal
      // circular refs — we don't introspect it, only verify the
      // call happened. Marker-id correctness is locked in by the
      // separate `AUTO_SEED_DISABLED_MARKER_ID` constant test.
      calls.lastWhereId = "called";
      return builder;
    },
    async limit(_n: number) {
      return rows;
    },
  };
  const fakeDb = {
    select() {
      calls.selectCount += 1;
      return builder;
    },
  } as unknown as Parameters<typeof isAutoSeedDisabled>[0];
  return { fakeDb, calls };
}

describe("isAutoSeedDisabled (Task #486 marker read)", () => {
  it("exports the marker id `auto-seed-disabled` so the wipe writer + boot reader stay in sync", () => {
    // The marker id is the single source of truth wiring three pieces
    // together: `setAutoSeedDisabledMarker` (writes it on wipe),
    // `clearAutoSeedDisabledMarker` (clears it on reseed), and
    // `isAutoSeedDisabled` (reads it on boot). Renaming on one side
    // without the others would silently break the gate, so this
    // assertion locks the value down.
    expect(AUTO_SEED_DISABLED_MARKER_ID).toBe("auto-seed-disabled");
  });

  it("returns false when no marker row exists (fresh DB / pre-486 install)", async () => {
    const { fakeDb } = makeFakeDb([]);
    expect(await isAutoSeedDisabled(fakeDb)).toBe(false);
  });

  it("returns true when the marker row exists with a non-empty wipedAt timestamp", async () => {
    // `wipeAllOnly` writes the wipe instant as ISO 8601 into
    // `lastSentKey`. Any non-empty value means "an operator
    // deliberately wiped — keep the DB empty across boots."
    const { fakeDb } = makeFakeDb([{ lastSentKey: "2026-05-07T14:43:07.000Z" }]);
    expect(await isAutoSeedDisabled(fakeDb)).toBe(true);
  });

  it("returns false when a marker row exists but its lastSentKey is empty (treated as cleared)", async () => {
    // Belt-and-suspenders for the case where some other code path or
    // a manual SQL edit blanks the column instead of deleting the
    // row outright. Empty payload == not-disabled, matching the
    // semantics `clearAutoSeedDisabledMarker` codifies.
    const { fakeDb } = makeFakeDb([{ lastSentKey: "" }]);
    expect(await isAutoSeedDisabled(fakeDb)).toBe(false);
  });

  it("returns false when a marker row exists but its lastSentKey is null", async () => {
    const { fakeDb } = makeFakeDb([{ lastSentKey: null }]);
    expect(await isAutoSeedDisabled(fakeDb)).toBe(false);
  });
});
