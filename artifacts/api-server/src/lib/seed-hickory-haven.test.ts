import { describe, it, expect, vi, beforeEach } from "vitest";

interface Row {
  id: string;
  [k: string]: unknown;
}
type TableName =
  | "customers"
  | "properties"
  | "leases"
  | "rooms"
  | "beds"
  | "occupants";

const stores: Record<TableName, Map<string, Row>> = {
  customers: new Map(),
  properties: new Map(),
  leases: new Map(),
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
  leasesTable: {
    __table: "leases",
    id: { __col: "id" },
    propertyId: { __col: "propertyId" },
    startDate: { __col: "startDate" },
    endDate: { __col: "endDate" },
    notes: { __col: "notes" },
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
  },
  occupantsTable: {
    __table: "occupants",
    id: { __col: "id" },
    propertyId: { __col: "propertyId" },
    name: { __col: "name" },
    shift: { __col: "shift" },
  },
}));

vi.mock("./logger", () => ({
  logger: { info: () => undefined, warn: () => undefined },
}));

const {
  seedHickoryHavenIfMissing,
  HICKORY_HAVEN_CUSTOMER_ID,
  HICKORY_HAVEN_PROPERTY_ID,
  hickoryHavenLeaseId,
  hickoryHavenRoomId,
  hickoryHavenBedId,
  hickoryHavenOccupantId,
} = await import("./seed-hickory-haven");

const silentLogger = { info: vi.fn(), warn: vi.fn() };

const UNITS = ["6", "8", "11", "12"] as const;

const EXPECTED: Record<
  string,
  { startDate: string; rent: number; deposit: number; source: string }
> = {
  "6": {
    startDate: "2026-02-27",
    rent: 1075,
    deposit: 1075,
    source: "Lease_Agreement_-_Unit_6_1778107900898.pdf",
  },
  "8": {
    startDate: "2026-02-27",
    rent: 900,
    deposit: 900,
    source: "Lease_Agreement_-_Unit_8_1778107900898.pdf",
  },
  "11": {
    startDate: "2026-03-13",
    rent: 900,
    deposit: 900,
    source: "Lease_Agreement_-_Unit_11_1778107900898.pdf",
  },
  "12": {
    startDate: "2026-03-13",
    rent: 1075,
    deposit: 1075,
    source: "Lease_Agreement_-_Unit_12_1778107900898.pdf",
  },
};

beforeEach(() => {
  for (const s of Object.values(stores)) s.clear();
});

describe("seedHickoryHavenIfMissing", () => {
  it("inserts customer, property, leases, bedrooms, beds, and occupants on a fresh DB", async () => {
    const result = await seedHickoryHavenIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });

    expect(result).toEqual({
      customerInserted: true,
      propertyInserted: true,
      leasesInserted: 4,
      roomsInserted: 6,
      bedsInserted: 10,
      occupantsInserted: 7,
      customerId: HICKORY_HAVEN_CUSTOMER_ID,
      repointedToEndClient: false,
      fallbackCustomerDeleted: false,
    });
    expect(stores.customers.has(HICKORY_HAVEN_CUSTOMER_ID)).toBe(true);
    expect(stores.properties.has(HICKORY_HAVEN_PROPERTY_ID)).toBe(true);
    for (const unit of UNITS) {
      expect(stores.leases.has(hickoryHavenLeaseId(unit))).toBe(true);
    }
  });

  it("seeds the property at 600 W Hickory St, Gilman, WI with the right landlord", async () => {
    await seedHickoryHavenIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });

    const property = stores.properties.get(HICKORY_HAVEN_PROPERTY_ID)!;
    expect(property["address"]).toBe("600 W Hickory St");
    expect(property["city"]).toBe("Gilman");
    expect(property["state"]).toBe("WI");
    expect(property["zip"]).toBe("54433");
    expect(property["landlordName"]).toBe("Hickory Haven Apartments LLC");
    expect(property["landlordEmail"]).toBe("jnagelpcc@gmail.com");
    expect(property["landlordPhone"]).toBe("(715) 290-0025");
    expect(property["customerId"]).toBe(HICKORY_HAVEN_CUSTOMER_ID);
    // Sum of the 4 unit rents: 1075 + 900 + 900 + 1075 = 3950
    expect(property["monthlyRent"]).toBe(3950);
    // Insurance certificate noted as attachment, not as feature work
    expect(String(property["notes"])).toMatch(/Certificate of Liability/);
  });

  it("seeds each lease with the correct rent, deposit, term, status, and source PDF", async () => {
    await seedHickoryHavenIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });

    for (const unit of UNITS) {
      const lease = stores.leases.get(hickoryHavenLeaseId(unit))!;
      const expected = EXPECTED[unit]!;
      expect(lease["monthlyRent"]).toBe(expected.rent);
      expect(lease["securityDeposit"]).toBe(expected.deposit);
      expect(lease["startDate"]).toBe(expected.startDate);
      expect(lease["endDate"]).toBe("2026-08-31");
      expect(lease["status"]).toBe("Active");
      expect(String(lease["clauses"])).toMatch(/KFI Staffing/);
      expect(String(lease["clauses"])).toContain(
        `Source document: ${expected.source}`,
      );
      expect(String(lease["notes"])).toMatch(new RegExp(`Unit ${unit} —`));
    }
    // Units with prorated first-month rent surface that in clauses
    expect(String(stores.leases.get(hickoryHavenLeaseId("11"))!["clauses"]))
      .toMatch(/\$551\.61/);
    expect(String(stores.leases.get(hickoryHavenLeaseId("12"))!["clauses"]))
      .toMatch(/\$658\.87/);
  });

  it("seeds 6 bedrooms, 10 beds, and 7 occupants matching the Task #568 source sheet (5 rooms in use, 7 occupied beds, 3 beds available)", async () => {
    await seedHickoryHavenIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });

    // 6 bedroom rooms, named "Apt N — Bedroom M".
    expect(stores.rooms.size).toBe(6);
    const expectedRooms: Array<[string, number]> = [
      ["6", 1], ["6", 2], ["8", 1], ["11", 1], ["12", 1], ["12", 2],
    ];
    for (const [unit, br] of expectedRooms) {
      const room = stores.rooms.get(hickoryHavenRoomId(unit, br))!;
      expect(room).toBeDefined();
      expect(room["name"]).toBe(`Apt ${unit} — Bedroom ${br}`);
      expect(room["propertyId"]).toBe(HICKORY_HAVEN_PROPERTY_ID);
    }

    // 10 beds total: 2+1+2+2+2+1.
    expect(stores.beds.size).toBe(10);
    const occupiedBeds = Array.from(stores.beds.values()).filter(
      (b) => b["status"] === "Occupied",
    );
    const vacantBeds = Array.from(stores.beds.values()).filter(
      (b) => b["status"] === "Vacant",
    );
    expect(occupiedBeds).toHaveLength(7);
    expect(vacantBeds).toHaveLength(3);

    // "Rooms in use" = bedrooms with at least one Occupied bed = 5.
    const roomsInUse = new Set(
      occupiedBeds.map((b) => String(b["roomId"])),
    );
    expect(roomsInUse.size).toBe(5);

    // Specific occupant placements per source sheet.
    const placements: Array<{
      unit: string;
      bedroom: number;
      slot: number;
      name: string;
    }> = [
      { unit: "6", bedroom: 1, slot: 1, name: "Gilberto Lara" },
      { unit: "8", bedroom: 1, slot: 1, name: "Andrew Castaneda" },
      { unit: "8", bedroom: 1, slot: 2, name: "Dennis Jordan" },
      { unit: "11", bedroom: 1, slot: 1, name: "Martin Hust" },
      { unit: "12", bedroom: 1, slot: 1, name: "Isaiah Young" },
      { unit: "12", bedroom: 1, slot: 2, name: "Jacob Novak" },
      { unit: "12", bedroom: 2, slot: 1, name: "Sterlin Adams" },
    ];
    for (const p of placements) {
      const occId = hickoryHavenOccupantId(p.unit, p.bedroom, p.slot);
      const occ = stores.occupants.get(occId)!;
      expect(occ).toBeDefined();
      expect(occ["name"]).toBe(p.name);
      expect(occ["propertyId"]).toBe(HICKORY_HAVEN_PROPERTY_ID);
      expect(occ["company"]).toBe("WB Manufacturing");
      expect(occ["status"]).toBe("Active");

      const bedId = hickoryHavenBedId(p.unit, p.bedroom, p.slot);
      const bed = stores.beds.get(bedId)!;
      expect(bed).toBeDefined();
      expect(bed["status"]).toBe("Occupied");
      expect(bed["occupantId"]).toBe(occId);
      expect(bed["roomId"]).toBe(hickoryHavenRoomId(p.unit, p.bedroom));
    }

    // Apt 6 Bedroom 2 (capacity 1) must be empty per the source sheet.
    const apt6br2bed = stores.beds.get(hickoryHavenBedId("6", 2, 1))!;
    expect(apt6br2bed["status"]).toBe("Vacant");
    expect(apt6br2bed["occupantId"]).toBeNull();

    // Vacant slot in Apt 6 Bedroom 1.
    const apt6br1emptySlot = stores.beds.get(hickoryHavenBedId("6", 1, 2))!;
    expect(apt6br1emptySlot["status"]).toBe("Vacant");

    // Vacant slot in Apt 11 Bedroom 1.
    const apt11emptySlot = stores.beds.get(hickoryHavenBedId("11", 1, 2))!;
    expect(apt11emptySlot["status"]).toBe("Vacant");
  });

  it("is idempotent on re-run and does not overwrite operator edits", async () => {
    await seedHickoryHavenIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });

    const before = stores.properties.get(HICKORY_HAVEN_PROPERTY_ID)!;
    stores.properties.set(HICKORY_HAVEN_PROPERTY_ID, {
      ...before,
      notes: "operator edit",
      landlordEmail: "ops@hickoryhaven.example",
    });

    const second = await seedHickoryHavenIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });
    expect(second).toEqual({
      customerInserted: false,
      propertyInserted: false,
      leasesInserted: 0,
      roomsInserted: 0,
      bedsInserted: 0,
      occupantsInserted: 0,
      customerId: HICKORY_HAVEN_CUSTOMER_ID,
      repointedToEndClient: false,
      fallbackCustomerDeleted: false,
    });

    const after = stores.properties.get(HICKORY_HAVEN_PROPERTY_ID)!;
    expect(after["notes"]).toBe("operator edit");
    expect(after["landlordEmail"]).toBe("ops@hickoryhaven.example");
    expect(stores.leases.size).toBe(4);
    expect(stores.rooms.size).toBe(6);
    expect(stores.beds.size).toBe(10);
    expect(stores.occupants.size).toBe(7);
  });

  it("reuses a pre-existing KFI Staffing customer matched by name LIKE", async () => {
    stores.customers.set("operator-cust-kfi", {
      id: "operator-cust-kfi",
      name: "KFI Staffing",
      contactName: "",
      email: "",
      phone: "",
      notes: "operator notes",
    });

    const result = await seedHickoryHavenIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });

    expect(result.customerInserted).toBe(false);
    expect(result.propertyInserted).toBe(true);
    expect(result.leasesInserted).toBe(4);
    expect(result.roomsInserted).toBe(6);
    expect(result.bedsInserted).toBe(10);
    expect(result.occupantsInserted).toBe(7);
    expect(stores.customers.has(HICKORY_HAVEN_CUSTOMER_ID)).toBe(false);
    expect(stores.customers.size).toBe(1);
    const property = stores.properties.get(HICKORY_HAVEN_PROPERTY_ID)!;
    expect(property["customerId"]).toBe("operator-cust-kfi");
    expect(stores.customers.get("operator-cust-kfi")!["notes"]).toBe(
      "operator notes",
    );
  });

  it("attaches the property directly to WB Manufacturing on a fresh seed when the WB customer already exists (Task #568)", async () => {
    // Master-file row 8 pins units 6/8/11/12 to WB; verify the seed
    // skips the KFI Staffing fallback entirely and attaches directly.
    stores.customers.set("cust-wb-mfg", {
      id: "cust-wb-mfg",
      name: "WB Manufacturing",
      contactName: "",
      email: "",
      phone: "",
      notes: "",
    });

    const result = await seedHickoryHavenIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });

    expect(result.customerInserted).toBe(false);
    expect(result.repointedToEndClient).toBe(false);
    expect(result.fallbackCustomerDeleted).toBe(false);
    expect(result.customerId).toBe("cust-wb-mfg");
    expect(stores.customers.has(HICKORY_HAVEN_CUSTOMER_ID)).toBe(false);
    expect(
      stores.properties.get(HICKORY_HAVEN_PROPERTY_ID)!["customerId"],
    ).toBe("cust-wb-mfg");
    // Property + bedrooms + beds + occupants still seeded under WB.
    expect(result.propertyInserted).toBe(true);
    expect(result.leasesInserted).toBe(4);
    expect(result.roomsInserted).toBe(6);
    expect(result.bedsInserted).toBe(10);
    expect(result.occupantsInserted).toBe(7);
  });

  it("attaches the property directly to WB Manufactoring (master-file typo spelling) when only that variant exists", async () => {
    stores.customers.set("cust-wb-typo", {
      id: "cust-wb-typo",
      name: "WB Manufactoring - Thorp, WI",
      contactName: "",
      email: "",
      phone: "",
      notes: "",
    });

    const result = await seedHickoryHavenIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });

    expect(result.customerId).toBe("cust-wb-typo");
    expect(
      stores.properties.get(HICKORY_HAVEN_PROPERTY_ID)!["customerId"],
    ).toBe("cust-wb-typo");
    expect(stores.customers.has(HICKORY_HAVEN_CUSTOMER_ID)).toBe(false);
  });

  it("repoints the property from the KFI Staffing fallback to WB Manufactoring once the end-client shows up, and deletes the unused fallback (Task #328)", async () => {
    const first = await seedHickoryHavenIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });
    expect(first.customerInserted).toBe(true);
    expect(first.repointedToEndClient).toBe(false);
    expect(first.fallbackCustomerDeleted).toBe(false);
    expect(
      stores.properties.get(HICKORY_HAVEN_PROPERTY_ID)!["customerId"],
    ).toBe(HICKORY_HAVEN_CUSTOMER_ID);

    // Note: master file spelling preserved verbatim ("Manufactoring").
    stores.customers.set("cust-wb-mfg", {
      id: "cust-wb-mfg",
      name: "WB Manufactoring - Thorp, WI",
      contactName: "",
      email: "",
      phone: "",
      notes: "",
    });

    const second = await seedHickoryHavenIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });
    expect(second.repointedToEndClient).toBe(true);
    expect(second.fallbackCustomerDeleted).toBe(true);
    expect(second.customerId).toBe("cust-wb-mfg");
    expect(stores.customers.has(HICKORY_HAVEN_CUSTOMER_ID)).toBe(false);
    expect(
      stores.properties.get(HICKORY_HAVEN_PROPERTY_ID)!["customerId"],
    ).toBe("cust-wb-mfg");
    expect(stores.leases.size).toBe(4);
  });

  it("preserves an operator-chosen non-fallback customer even when WB Manufactoring exists (Task #328)", async () => {
    stores.customers.set("operator-cust", {
      id: "operator-cust",
      name: "Operator Custom Client",
      contactName: "",
      email: "",
      phone: "",
      notes: "",
    });
    stores.customers.set("cust-wb-mfg", {
      id: "cust-wb-mfg",
      name: "WB Manufactoring",
      contactName: "",
      email: "",
      phone: "",
      notes: "",
    });
    stores.properties.set(HICKORY_HAVEN_PROPERTY_ID, {
      id: HICKORY_HAVEN_PROPERTY_ID,
      customerId: "operator-cust",
      name: "Hickory Haven",
      address: "600 W Hickory St",
      city: "Gilman",
      state: "WI",
      zip: "54433",
      notes: "operator notes",
    });

    const result = await seedHickoryHavenIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });

    expect(result.repointedToEndClient).toBe(false);
    expect(result.customerId).toBe("operator-cust");
    expect(
      stores.properties.get(HICKORY_HAVEN_PROPERTY_ID)!["customerId"],
    ).toBe("operator-cust");
    expect(stores.customers.has("operator-cust")).toBe(true);
    expect(stores.customers.has("cust-wb-mfg")).toBe(true);
  });
});
