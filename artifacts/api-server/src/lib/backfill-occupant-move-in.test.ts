import { describe, it, expect, vi } from "vitest";

interface OccupantRow {
  id: string;
  propertyId: string | null;
  moveInDate: string;
}
interface LeaseRow {
  id: string;
  propertyId: string;
  startDate: string;
}

const occupants = new Map<string, OccupantRow>();
const leases = new Map<string, LeaseRow>();

// Drizzle-shaped fluent fake. The backfill helper only uses:
//   db.select({...}).from(table).where(predicate)
//   db.update(table).set(vals).where(predicate)
// where predicates are produced by `eq`/`and`/`ne` from drizzle-orm,
// which we mock below to return plain objects we can interpret here.

type Predicate =
  | { kind: "eq"; col: string; value: unknown }
  | { kind: "ne"; col: string; value: unknown }
  | { kind: "and"; parts: Predicate[] };

function tableNameOf(t: unknown): string {
  return (t as { __table: string }).__table;
}

function rowField(row: OccupantRow | LeaseRow, col: string): unknown {
  return (row as unknown as Record<string, unknown>)[col];
}

function matches(row: OccupantRow | LeaseRow, p: Predicate): boolean {
  if (p.kind === "eq") return rowField(row, p.col) === p.value;
  if (p.kind === "ne") return rowField(row, p.col) !== p.value;
  return p.parts.every((q) => matches(row, q));
}

function tableRows(table: unknown): Array<OccupantRow | LeaseRow> {
  const name = tableNameOf(table);
  if (name === "occupants") return Array.from(occupants.values());
  if (name === "leases") return Array.from(leases.values());
  throw new Error(`Unknown table ${name}`);
}

function setOnTable(table: unknown, id: string, vals: Partial<OccupantRow>) {
  const name = tableNameOf(table);
  if (name !== "occupants") throw new Error(`update on ${name} not modeled`);
  const cur = occupants.get(id);
  if (!cur) return;
  occupants.set(id, { ...cur, ...vals });
}

const fakeDb = {
  select: (projection: Record<string, { __col: string }>) => ({
    from: (table: unknown) => ({
      where: (pred: Predicate) =>
        tableRows(table)
          .filter((r) => matches(r, pred))
          .map((r) => {
            const out: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(projection)) {
              out[k] = rowField(r, v.__col);
            }
            return out;
          }),
    }),
  }),
  update: (table: unknown) => ({
    set: (vals: Partial<OccupantRow>) => ({
      where: (pred: Predicate) => {
        for (const r of tableRows(table)) {
          if (matches(r, pred)) setOnTable(table, (r as OccupantRow).id, vals);
        }
        return Promise.resolve();
      },
    }),
  }),
};

vi.mock("drizzle-orm", () => ({
  eq: (col: { __col: string }, value: unknown) => ({
    kind: "eq" as const,
    col: col.__col,
    value,
  }),
  ne: (col: { __col: string }, value: unknown) => ({
    kind: "ne" as const,
    col: col.__col,
    value,
  }),
  and: (...parts: Predicate[]) => ({ kind: "and" as const, parts }),
}));

vi.mock("@workspace/db", () => ({
  db: fakeDb,
  occupantsTable: {
    __table: "occupants",
    id: { __col: "id" },
    propertyId: { __col: "propertyId" },
    moveInDate: { __col: "moveInDate" },
  },
  leasesTable: {
    __table: "leases",
    propertyId: { __col: "propertyId" },
    startDate: { __col: "startDate" },
  },
}));

const { backfillOccupantMoveInDates } = await import(
  "./backfill-occupant-move-in"
);

const silentLogger = { info: vi.fn(), warn: vi.fn() };

function seed(
  occRows: OccupantRow[],
  leaseRows: LeaseRow[] = [],
): void {
  occupants.clear();
  leases.clear();
  for (const o of occRows) occupants.set(o.id, o);
  for (const l of leaseRows) leases.set(l.id, l);
}

describe("backfillOccupantMoveInDates", () => {
  it("does nothing when no occupants are missing a move-in date", async () => {
    seed([{ id: "o1", propertyId: "p1", moveInDate: "2024-01-15" }]);
    const result = await backfillOccupantMoveInDates({ logger: silentLogger });
    expect(result).toEqual({ scanned: 0, updated: 0, remaining: 0 });
    expect(occupants.get("o1")!.moveInDate).toBe("2024-01-15");
  });

  it("fills empty move-in dates from the earliest lease start for the same property", async () => {
    seed(
      [
        { id: "o1", propertyId: "p1", moveInDate: "" },
        { id: "o2", propertyId: "p1", moveInDate: "" },
      ],
      [
        { id: "l1", propertyId: "p1", startDate: "2024-06-01" },
        { id: "l2", propertyId: "p1", startDate: "2023-03-15" },
        { id: "l3", propertyId: "p1", startDate: "2025-01-01" },
      ],
    );
    const result = await backfillOccupantMoveInDates({ logger: silentLogger });
    expect(result).toEqual({ scanned: 2, updated: 2, remaining: 0 });
    expect(occupants.get("o1")!.moveInDate).toBe("2023-03-15");
    expect(occupants.get("o2")!.moveInDate).toBe("2023-03-15");
  });

  it("leaves occupants unchanged when no lease for their property has a real start date", async () => {
    seed(
      [
        { id: "o1", propertyId: "p1", moveInDate: "" },
        { id: "o2", propertyId: "p2", moveInDate: "" },
      ],
      [
        { id: "l1", propertyId: "p1", startDate: "" },
        { id: "l2", propertyId: "p2", startDate: "2024-04-01" },
      ],
    );
    const result = await backfillOccupantMoveInDates({ logger: silentLogger });
    expect(result.updated).toBe(1);
    expect(result.remaining).toBe(1);
    expect(occupants.get("o1")!.moveInDate).toBe("");
    expect(occupants.get("o2")!.moveInDate).toBe("2024-04-01");
  });

  it("ignores occupants with no propertyId", async () => {
    seed([{ id: "o1", propertyId: null, moveInDate: "" }]);
    const result = await backfillOccupantMoveInDates({ logger: silentLogger });
    expect(result).toEqual({ scanned: 1, updated: 0, remaining: 1 });
    expect(occupants.get("o1")!.moveInDate).toBe("");
  });

  it("rejects malformed lease start dates as backfill candidates", async () => {
    seed(
      [{ id: "o1", propertyId: "p1", moveInDate: "" }],
      [
        { id: "l1", propertyId: "p1", startDate: "2024/01/15" },
        { id: "l2", propertyId: "p1", startDate: "not-a-date" },
      ],
    );
    // ne("") is true for both, but neither matches strict YYYY-MM-DD.
    const result = await backfillOccupantMoveInDates({ logger: silentLogger });
    expect(result.updated).toBe(0);
    expect(result.remaining).toBe(1);
    expect(occupants.get("o1")!.moveInDate).toBe("");
  });

  it("is idempotent on a second pass", async () => {
    seed(
      [{ id: "o1", propertyId: "p1", moveInDate: "" }],
      [{ id: "l1", propertyId: "p1", startDate: "2024-02-02" }],
    );
    await backfillOccupantMoveInDates({ logger: silentLogger });
    const second = await backfillOccupantMoveInDates({ logger: silentLogger });
    expect(second).toEqual({ scanned: 0, updated: 0, remaining: 0 });
    expect(occupants.get("o1")!.moveInDate).toBe("2024-02-02");
  });
});
