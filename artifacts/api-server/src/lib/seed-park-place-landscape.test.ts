import { describe, it, expect, vi, beforeEach } from "vitest";

interface Row {
  id: string;
  [k: string]: unknown;
}
type TableName = "customers" | "properties" | "rooms" | "beds" | "occupants";

const stores: Record<TableName, Map<string, Row>> = {
  customers: new Map(),
  properties: new Map(),
  rooms: new Map(),
  beds: new Map(),
  occupants: new Map(),
};

function tableNameOf(t: unknown): TableName {
  return (t as { __table: TableName }).__table;
}

type Predicate =
  | { kind: "eq"; col: string; value: unknown }
  | { kind: "like"; col: string; pattern: string }
  | { kind: "isNull"; col: string }
  | { kind: "and"; parts: Predicate[] };

function rowField(row: Row, col: string): unknown {
  return row[col];
}

function likeMatch(haystack: unknown, pattern: string): boolean {
  if (typeof haystack !== "string") return false;
  const escaped = pattern
    .replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")
    .replace(/%/g, ".*");
  return new RegExp(`^${escaped}$`).test(haystack);
}

function matches(row: Row, p: Predicate): boolean {
  if (p.kind === "eq") return rowField(row, p.col) === p.value;
  if (p.kind === "like") return likeMatch(rowField(row, p.col), p.pattern);
  if (p.kind === "isNull") {
    const v = rowField(row, p.col);
    return v === null || v === undefined;
  }
  return p.parts.every((q) => matches(row, q));
}

function makeSelect(projection: Record<string, { __col: string }>) {
  return {
    from: (table: unknown) => {
      const rows = Array.from(stores[tableNameOf(table)].values());
      const project = (matched: Row[]) =>
        matched.map((r) => {
          const out: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(projection)) {
            out[k] = rowField(r, v.__col);
          }
          return out;
        });
      return {
        where: (pred: Predicate) => {
          const filtered = rows.filter((r) => matches(r, pred));
          const projected = project(filtered);
          return {
            then: (
              onF: (v: unknown[]) => unknown,
              onR?: (e: unknown) => unknown,
            ) => Promise.resolve(projected).then(onF, onR),
            limit: (n: number) => Promise.resolve(projected.slice(0, n)),
          };
        },
      };
    },
  };
}

function makeUpdate(table: unknown) {
  return {
    set: (patch: Record<string, unknown>) => ({
      where: (pred: Predicate) => {
        const exec = async (): Promise<Row[]> => {
          const store = stores[tableNameOf(table)];
          const updated: Row[] = [];
          for (const [id, row] of store) {
            if (matches(row, pred)) {
              store.set(id, { ...row, ...patch });
              updated.push({ id });
            }
          }
          return updated;
        };
        return {
          returning: (_cols?: unknown) => exec(),
          then: (
            onF: (v: Row[]) => unknown,
            onR?: (e: unknown) => unknown,
          ) => exec().then(onF, onR),
        };
      },
    }),
  };
}

function makeDelete(table: unknown) {
  return {
    where: (pred: Predicate) => ({
      returning: async (_cols?: unknown) => {
        const store = stores[tableNameOf(table)];
        const removed: Row[] = [];
        for (const [id, row] of Array.from(store.entries())) {
          if (matches(row, pred)) {
            store.delete(id);
            removed.push({ id });
          }
        }
        return removed;
      },
    }),
  };
}

function makeInsert(table: unknown) {
  return {
    values: (rows: Row | Row[]) => {
      const arr = Array.isArray(rows) ? rows : [rows];
      return {
        onConflictDoNothing: () => ({
          returning: async (_cols?: unknown) => {
            const store = stores[tableNameOf(table)];
            const inserted: Row[] = [];
            for (const row of arr) {
              if (!store.has(row.id)) {
                store.set(row.id, { ...row });
                inserted.push({ id: row.id });
              }
            }
            return inserted;
          },
        }),
      };
    },
  };
}

const tx = {
  select: makeSelect,
  insert: makeInsert,
  update: makeUpdate,
  delete: makeDelete,
};
type Tx = typeof tx;
const fakeDb = {
  select: makeSelect,
  insert: makeInsert,
  update: makeUpdate,
  delete: makeDelete,
  transaction: <T,>(cb: (tx: Tx) => Promise<T>): Promise<T> => cb(tx),
};

vi.mock("drizzle-orm", () => ({
  eq: (col: { __col: string }, value: unknown) => ({
    kind: "eq" as const,
    col: col.__col,
    value,
  }),
  like: (col: { __col: string }, pattern: string) => ({
    kind: "like" as const,
    col: col.__col,
    pattern,
  }),
  isNull: (col: { __col: string }) => ({
    kind: "isNull" as const,
    col: col.__col,
  }),
  and: (...parts: Predicate[]) => ({ kind: "and" as const, parts }),
}));

vi.mock("@workspace/db", () => ({
  db: fakeDb,
  customersTable: {
    __table: "customers",
    id: { __col: "id" },
    name: { __col: "name" },
  },
  propertiesTable: {
    __table: "properties",
    id: { __col: "id" },
    customerId: { __col: "customerId" },
    address: { __col: "address" },
    zip: { __col: "zip" },
  },
  roomsTable: {
    __table: "rooms",
    id: { __col: "id" },
    propertyId: { __col: "propertyId" },
    name: { __col: "name" },
  },
  bedsTable: {
    __table: "beds",
    id: { __col: "id" },
    propertyId: { __col: "propertyId" },
    roomId: { __col: "roomId" },
    bedNumber: { __col: "bedNumber" },
    occupantId: { __col: "occupantId" },
    status: { __col: "status" },
  },
  occupantsTable: {
    __table: "occupants",
    id: { __col: "id" },
    propertyId: { __col: "propertyId" },
    name: { __col: "name" },
    bedId: { __col: "bedId" },
    employeeId: { __col: "employeeId" },
  },
}));

vi.mock("./logger", () => ({
  logger: { info: () => undefined, warn: () => undefined },
}));

const {
  seedParkPlaceLandscapeIfMissing,
  LANDSCAPE_PARK_PLACE_CUSTOMER_ID,
  LANDSCAPE_PARK_PLACE_PROPERTY_ID,
  landscapeRoomId,
  landscapeBedId,
  landscapeOccupantId,
  PARK_PLACE_LANDSCAPE_UNITS,
} = await import("./seed-park-place-landscape");

const silentLogger = { info: vi.fn(), warn: vi.fn() };

const UNITS = [
  "500-118",
  "600-127",
  "600-315",
  "600-342",
  "605-201",
  "605-218",
] as const;

// Vacant beds per the spreadsheet: Apt 315 Bedroom 2 bed 2, Apt 342
// Bedroom 2 bed 1.
const VACANT_BEDS: Array<{ unit: string; room: 1 | 2; bed: 1 | 2 }> = [
  { unit: "600-315", room: 2, bed: 2 },
  { unit: "600-342", room: 2, bed: 1 },
];

// PersonIds sourced from the Landscape Structures block of
// seed-housing-deductions.ts (lines 173-192). Joseph Bullock and Noe
// Morales are deliberately absent — they have no payroll personId yet.
const EXPECTED_PERSON_IDS: Record<string, string> = {
  "Julio Orgonez": "2002940",
  "Raymundo Leija": "2002939",
  "Ethan Davis": "2002636",
  "Alfred A Beserra": "2004710",
  "Jordan Torres": "2002938",
  "Erasmo Garza": "2002379",
  "Abel A Guzman": "2005096",
  "Luis Rodriguez Rivera": "2001894",
  "Nicholas R Franklin": "2004544",
  "Jose Molina": "2002031",
  "David Davis": "2002373",
  "Marcos Antonio Lara": "2002820",
  "Evarado Delgado": "2004070",
  "Jonathan Reynosa": "2002442",
  "Sebastian Villarreal": "2005166",
  "Tyrek J Patterson": "2004786",
  "Eduardo Campos": "2000822",
  "Gabriel J Womack": "2005111",
  "Gilbert Bustos Jr": "2002861",
  "Justin DeAngelis": "2005110",
};

beforeEach(() => {
  for (const s of Object.values(stores)) s.clear();
});

describe("seedParkPlaceLandscapeIfMissing", () => {
  it("inserts the customer, property, 12 rooms, 24 beds, and 22 occupants on a fresh DB", async () => {
    const result = await seedParkPlaceLandscapeIfMissing({
      logger: silentLogger,
    });

    expect(result).toEqual({
      customerInserted: true,
      propertyInserted: true,
      roomsInserted: 12,
      bedsInserted: 24,
      occupantsInserted: 22,
      customerId: LANDSCAPE_PARK_PLACE_CUSTOMER_ID,
      propertyId: LANDSCAPE_PARK_PLACE_PROPERTY_ID,
    });

    expect(stores.customers.has(LANDSCAPE_PARK_PLACE_CUSTOMER_ID)).toBe(true);
    expect(stores.properties.has(LANDSCAPE_PARK_PLACE_PROPERTY_ID)).toBe(true);
    expect(PARK_PLACE_LANDSCAPE_UNITS).toEqual([...UNITS]);
    expect(stores.rooms.size).toBe(12);
    expect(stores.beds.size).toBe(24);
    expect(stores.occupants.size).toBe(22);
  });

  it("seeds 24 beds with exactly 22 occupied and the two known vacant beds", async () => {
    await seedParkPlaceLandscapeIfMissing({ logger: silentLogger });

    const propertyBeds = Array.from(stores.beds.values()).filter(
      (b) => b["propertyId"] === LANDSCAPE_PARK_PLACE_PROPERTY_ID,
    );
    expect(propertyBeds).toHaveLength(24);

    const occupied = propertyBeds.filter(
      (b) => b["status"] === "Occupied" && b["occupantId"],
    );
    const vacant = propertyBeds.filter(
      (b) =>
        b["status"] === "Vacant" &&
        (b["occupantId"] === null || b["occupantId"] === undefined),
    );
    expect(occupied).toHaveLength(22);
    expect(vacant).toHaveLength(2);

    const vacantIds = new Set(vacant.map((b) => b["id"]));
    for (const v of VACANT_BEDS) {
      const expectedBedId = landscapeBedId(v.unit, v.room, v.bed);
      expect(vacantIds.has(expectedBedId)).toBe(true);
      const bed = stores.beds.get(expectedBedId)!;
      expect(bed["roomId"]).toBe(landscapeRoomId(v.unit, v.room));
      expect(bed["bedNumber"]).toBe(v.bed);
      expect(bed["occupantId"]).toBeNull();
    }

    // No occupant rows were created for the two vacant slots.
    for (const v of VACANT_BEDS) {
      expect(
        stores.occupants.has(landscapeOccupantId(v.unit, v.room, v.bed)),
      ).toBe(false);
    }
  });

  it("is idempotent on re-run — a second call inserts nothing new", async () => {
    await seedParkPlaceLandscapeIfMissing({ logger: silentLogger });

    const second = await seedParkPlaceLandscapeIfMissing({
      logger: silentLogger,
    });
    expect(second).toEqual({
      customerInserted: false,
      propertyInserted: false,
      roomsInserted: 0,
      bedsInserted: 0,
      occupantsInserted: 0,
      customerId: LANDSCAPE_PARK_PLACE_CUSTOMER_ID,
      propertyId: LANDSCAPE_PARK_PLACE_PROPERTY_ID,
    });

    // Row counts unchanged.
    expect(stores.customers.size).toBe(1);
    expect(stores.properties.size).toBe(1);
    expect(stores.rooms.size).toBe(12);
    expect(stores.beds.size).toBe(24);
    expect(stores.occupants.size).toBe(22);
  });

  it("does not overwrite operator-edited rows on a re-run", async () => {
    await seedParkPlaceLandscapeIfMissing({ logger: silentLogger });

    const propBefore = stores.properties.get(LANDSCAPE_PARK_PLACE_PROPERTY_ID)!;
    stores.properties.set(LANDSCAPE_PARK_PLACE_PROPERTY_ID, {
      ...propBefore,
      notes: "operator edit",
      landlordEmail: "ops@centerspace.example",
    });
    const occId = landscapeOccupantId("500-118", 1, 1);
    const occBefore = stores.occupants.get(occId)!;
    stores.occupants.set(occId, {
      ...occBefore,
      phone: "763-555-0101",
      email: "operator@example.com",
    });

    await seedParkPlaceLandscapeIfMissing({ logger: silentLogger });

    const propAfter = stores.properties.get(LANDSCAPE_PARK_PLACE_PROPERTY_ID)!;
    expect(propAfter["notes"]).toBe("operator edit");
    expect(propAfter["landlordEmail"]).toBe("ops@centerspace.example");
    const occAfter = stores.occupants.get(occId)!;
    expect(occAfter["phone"]).toBe("763-555-0101");
    expect(occAfter["email"]).toBe("operator@example.com");
  });

  it("persists Joseph Bullock and Noe Morales with empty employeeId", async () => {
    await seedParkPlaceLandscapeIfMissing({ logger: silentLogger });

    const bullock = stores.occupants.get(
      landscapeOccupantId("500-118", 2, 2),
    )!;
    expect(bullock["name"]).toBe("Joseph Bullock");
    expect(bullock["employeeId"]).toBe("");

    const morales = stores.occupants.get(
      landscapeOccupantId("600-127", 2, 2),
    )!;
    expect(morales["name"]).toBe("Noe Morales");
    expect(morales["employeeId"]).toBe("");
  });

  it("carries the personIds from seed-housing-deductions.ts for the other 20 occupants", async () => {
    await seedParkPlaceLandscapeIfMissing({ logger: silentLogger });

    const occupantsByName = new Map<string, Row>();
    for (const occ of stores.occupants.values()) {
      occupantsByName.set(String(occ["name"]), occ);
    }

    for (const [name, personId] of Object.entries(EXPECTED_PERSON_IDS)) {
      const occ = occupantsByName.get(name);
      expect(occ, `expected occupant ${name} to be seeded`).toBeDefined();
      expect(occ!["employeeId"]).toBe(personId);
    }

    // Sanity: 20 named personIds + 2 empty (Bullock, Morales) = 22.
    const withPersonId = Array.from(stores.occupants.values()).filter(
      (o) => String(o["employeeId"] ?? "") !== "",
    );
    expect(withPersonId).toHaveLength(20);
  });

  it("backfills employeeId on a previously-seeded occupant whose payroll id arrives later", async () => {
    // First seed.
    await seedParkPlaceLandscapeIfMissing({ logger: silentLogger });

    // Simulate a DB seeded before the personIds were known: blank out
    // the employeeId on Julio Orgonez (Apt 500-118 r1-b1).
    const occId = landscapeOccupantId("500-118", 1, 1);
    const occ = stores.occupants.get(occId)!;
    expect(occ["name"]).toBe("Julio Orgonez");
    stores.occupants.set(occId, { ...occ, employeeId: "" });

    await seedParkPlaceLandscapeIfMissing({ logger: silentLogger });

    expect(stores.occupants.get(occId)!["employeeId"]).toBe("2002940");
  });
});
