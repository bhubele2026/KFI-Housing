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
  leasesTable: {
    __table: "leases",
    id: { __col: "id" },
    propertyId: { __col: "propertyId" },
    startDate: { __col: "startDate" },
    endDate: { __col: "endDate" },
    notes: { __col: "notes" },
    unit: { __col: "unit" },
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
    shift: { __col: "shift" },
  },
}));

vi.mock("./logger", () => ({
  logger: { info: () => undefined, warn: () => undefined },
}));

const {
  seedPatriotBarabooIfMissing,
  PATRIOT_BARABOO_CUSTOMER_ID,
  PATRIOT_BARABOO_PROPERTY_ID,
  PATRIOT_BARABOO_END_CLIENT,
  patriotBarabooLeaseId,
  patriotBarabooRoomId,
  patriotBarabooBedId,
  patriotBarabooOccupantId,
} = await import("./seed-patriot-baraboo");

const silentLogger = { info: vi.fn(), warn: vi.fn() };

const UNITS = ["509", "510", "512", "811", "812"] as const;

beforeEach(() => {
  for (const s of Object.values(stores)) s.clear();
});

describe("seedPatriotBarabooIfMissing", () => {
  it("inserts customer, property, and 5 leases on a fresh DB", async () => {
    const result = await seedPatriotBarabooIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });

    expect(result).toEqual({
      customerInserted: true,
      propertyInserted: true,
      leasesInserted: 5,
      roomsInserted: 5,
      bedsInserted: 20,
      occupantsInserted: 20,
      customerId: PATRIOT_BARABOO_CUSTOMER_ID,
      repointedToEndClient: false,
      fallbackCustomerDeleted: false,
    });
    expect(stores.customers.has(PATRIOT_BARABOO_CUSTOMER_ID)).toBe(true);
    expect(stores.properties.has(PATRIOT_BARABOO_PROPERTY_ID)).toBe(true);
    for (const unit of UNITS) {
      expect(stores.leases.has(patriotBarabooLeaseId(unit))).toBe(true);
      expect(stores.rooms.has(patriotBarabooRoomId(unit))).toBe(true);
      for (let slot = 1; slot <= 4; slot++) {
        expect(stores.beds.has(patriotBarabooBedId(unit, slot))).toBe(true);
        expect(stores.occupants.has(patriotBarabooOccupantId(unit, slot))).toBe(
          true,
        );
      }
    }
  });

  it("seeds the property with the Baraboo address and Patriot landlord", async () => {
    await seedPatriotBarabooIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });

    const property = stores.properties.get(PATRIOT_BARABOO_PROPERTY_ID)!;
    expect(property["address"]).toBe("1850 W. Pine St.");
    expect(property["city"]).toBe("Baraboo");
    expect(property["state"]).toBe("WI");
    expect(property["zip"]).toBe("53913");
    expect(property["landlordName"]).toBe("Patriot Properties");
    expect(property["paymentRecipient"]).toBe("JCW Baraboo LLC");
    expect(property["customerId"]).toBe(PATRIOT_BARABOO_CUSTOMER_ID);
    expect(String(property["notes"])).toMatch(/JCW Baraboo|Patriot/);
  });

  it("seeds each lease with the correct rent, deposit, term, status, and source PDF", async () => {
    await seedPatriotBarabooIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });

    const sources: Record<string, string> = {
      "509": "Lease_Agreement_-_509_1778107818114.pdf",
      "510": "Lease_Agreement_-_510_1778107818114.pdf",
      "512": "Lease_Agreement_-_512_1778107818114.pdf",
      "811": "Lease_Agreement_-_811_1778107818114.pdf",
      "812": "Lease_Agreement_-_812_1778107818114.pdf",
    };
    for (const unit of UNITS) {
      const lease = stores.leases.get(patriotBarabooLeaseId(unit))!;
      expect(lease["monthlyRent"]).toBe(1675);
      expect(lease["securityDeposit"]).toBe(1675);
      expect(lease["startDate"]).toBe("2025-09-30");
      expect(lease["endDate"]).toBe("2026-08-31");
      expect(lease["status"]).toBe("Active");
      const clauses = String(lease["clauses"]);
      expect(clauses).toMatch(/KFI Staffing/);
      expect(clauses).toMatch(/5%/);
      expect(clauses).toMatch(/Valeria Alderman/);
      expect(clauses).toContain(`Source document: ${sources[unit]}`);
      expect(String(lease["notes"])).toMatch(new RegExp(`Unit ${unit} —`));
      expect(String(lease["notes"])).toMatch(/\$10\.50 LLI/);
      // Task #310: unit lives in a real column, not just the notes prose.
      expect(lease["unit"]).toBe(unit);
    }
  });

  it("is idempotent on re-run and does not overwrite operator edits", async () => {
    await seedPatriotBarabooIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });

    const before = stores.properties.get(PATRIOT_BARABOO_PROPERTY_ID)!;
    stores.properties.set(PATRIOT_BARABOO_PROPERTY_ID, {
      ...before,
      notes: "operator edit",
      landlordEmail: "ops@patriotproperties.example",
    });
    const occBefore = stores.occupants.get(
      patriotBarabooOccupantId("509", 1),
    )!;
    stores.occupants.set(patriotBarabooOccupantId("509", 1), {
      ...occBefore,
      phone: "608-555-0101",
      email: "operator@example.com",
    });

    const second = await seedPatriotBarabooIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });
    expect(second).toEqual({
      customerInserted: false,
      propertyInserted: false,
      leasesInserted: 0,
      roomsInserted: 0,
      bedsInserted: 0,
      occupantsInserted: 0,
      customerId: PATRIOT_BARABOO_CUSTOMER_ID,
      repointedToEndClient: false,
      fallbackCustomerDeleted: false,
    });

    const after = stores.properties.get(PATRIOT_BARABOO_PROPERTY_ID)!;
    expect(after["notes"]).toBe("operator edit");
    expect(after["landlordEmail"]).toBe("ops@patriotproperties.example");
    const occAfter = stores.occupants.get(
      patriotBarabooOccupantId("509", 1),
    )!;
    expect(occAfter["phone"]).toBe("608-555-0101");
    expect(occAfter["email"]).toBe("operator@example.com");
    expect(stores.occupants.size).toBe(20);
    expect(stores.beds.size).toBe(20);
    expect(stores.rooms.size).toBe(5);
  });

  it("backfills shift on previously-seeded occupants that were missing it (task #315)", async () => {
    // Seed once, then null out shift on every occupant to simulate a DB
    // that was seeded before the shift column existed. Re-running the
    // seed should backfill the shift on every roster occupant without
    // overwriting any other fields.
    await seedPatriotBarabooIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });
    for (const [id, row] of stores.occupants) {
      stores.occupants.set(id, { ...row, shift: null });
    }

    const result = await seedPatriotBarabooIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });
    expect(result.occupantsInserted).toBe(0);

    const expectedShiftBySlot: Record<number, "1st" | "2nd"> = {
      1: "1st",
      2: "2nd",
      3: "1st",
      4: "2nd",
    };
    for (const unit of UNITS) {
      for (let slot = 1; slot <= 4; slot++) {
        const occ = stores.occupants.get(patriotBarabooOccupantId(unit, slot))!;
        expect(occ["shift"]).toBe(expectedShiftBySlot[slot]);
      }
    }
  });

  it("does not overwrite an operator-edited shift on a re-run (task #315)", async () => {
    await seedPatriotBarabooIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });
    const occId = patriotBarabooOccupantId("509", 1);
    const occ = stores.occupants.get(occId)!;
    // Operator manually moved this person to the 2nd shift even though
    // the roster says 1st. The seed must not clobber that edit.
    stores.occupants.set(occId, { ...occ, shift: "2nd" });

    await seedPatriotBarabooIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });
    expect(stores.occupants.get(occId)!["shift"]).toBe("2nd");
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

    const result = await seedPatriotBarabooIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });

    expect(result.customerInserted).toBe(false);
    expect(result.propertyInserted).toBe(true);
    expect(result.leasesInserted).toBe(5);
    expect(result.roomsInserted).toBe(5);
    expect(result.bedsInserted).toBe(20);
    expect(result.occupantsInserted).toBe(20);
    expect(stores.customers.has(PATRIOT_BARABOO_CUSTOMER_ID)).toBe(false);
    expect(stores.customers.size).toBe(1);
    const property = stores.properties.get(PATRIOT_BARABOO_PROPERTY_ID)!;
    expect(property["customerId"]).toBe("operator-cust-kfi");
    expect(stores.customers.get("operator-cust-kfi")!["notes"]).toBe(
      "operator notes",
    );
  });

  it("seeds 1 room per unit and 4 beds per unit, all wired to the same property", async () => {
    await seedPatriotBarabooIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });

    expect(stores.rooms.size).toBe(5);
    expect(stores.beds.size).toBe(20);
    expect(stores.occupants.size).toBe(20);

    for (const unit of UNITS) {
      const room = stores.rooms.get(patriotBarabooRoomId(unit))!;
      expect(room["propertyId"]).toBe(PATRIOT_BARABOO_PROPERTY_ID);
      expect(room["name"]).toBe(`Unit ${unit}`);
      expect(room["monthlyRent"]).toBe(1675);

      for (let slot = 1; slot <= 4; slot++) {
        const bed = stores.beds.get(patriotBarabooBedId(unit, slot))!;
        expect(bed["propertyId"]).toBe(PATRIOT_BARABOO_PROPERTY_ID);
        expect(bed["roomId"]).toBe(patriotBarabooRoomId(unit));
        expect(bed["bedNumber"]).toBe(slot);
        expect(bed["status"]).toBe("Occupied");
        expect(bed["occupantId"]).toBe(patriotBarabooOccupantId(unit, slot));
      }
    }
  });

  it("attaches the typed roster to the right unit/bed with correct move-in dates", async () => {
    await seedPatriotBarabooIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });

    // Slot pattern across all units: 1 & 3 are 1st shift (5am–2pm), 2 & 4
     // are 2nd shift (2pm–midnight) — slots 1/2 share bedroom A, slots 3/4
     // share bedroom B, so the pairs alternate shifts so each bedroom is
     // occupied around the clock without two tenants sleeping at the same
     // time (task #315).
    const SHIFT_BY_SLOT: Record<number, "1st" | "2nd"> = {
      1: "1st",
      2: "2nd",
      3: "1st",
      4: "2nd",
    };
    const expected: Record<string, { names: string[]; moveIn: string }> = {
      "509": {
        names: [
          "Eladio Ramos Jr",
          "Lawrence Cortez",
          "Pedro Garcia",
          "Jonathan Ariola",
        ],
        moveIn: "2025-10-03",
      },
      "510": {
        names: [
          "Claudio Alvarado",
          "Juan Lozada Lugo",
          "Carlos Galvez Garcia",
          "Jacob Zepeda",
        ],
        moveIn: "2025-10-03",
      },
      "512": {
        names: [
          "Alexander A Marrero",
          "Alexis Perez",
          "Xavior R Robinson",
          "Dorian Kyles",
        ],
        moveIn: "2025-09-30",
      },
      "811": {
        names: [
          "Moices Bernal",
          "Jacob C Ferguson",
          "Gabriel Romero",
          "Ricco Antonio Lorenzana",
        ],
        moveIn: "2025-09-30",
      },
      "812": {
        names: [
          "Abein Flores",
          "Antonio Hernandez",
          "Jose Castro",
          "Ismael Meza",
        ],
        moveIn: "2025-10-03",
      },
    };

    for (const [unit, info] of Object.entries(expected)) {
      info.names.forEach((name, i) => {
        const slot = i + 1;
        const occ = stores.occupants.get(
          patriotBarabooOccupantId(unit, slot),
        )!;
        expect(occ["name"]).toBe(name);
        expect(occ["bedId"]).toBe(patriotBarabooBedId(unit, slot));
        expect(occ["propertyId"]).toBe(PATRIOT_BARABOO_PROPERTY_ID);
        expect(occ["moveInDate"]).toBe(info.moveIn);
        expect(occ["status"]).toBe("Active");
        expect(occ["company"]).toBe(PATRIOT_BARABOO_END_CLIENT);
        expect(occ["chargePerBed"]).toBeCloseTo(1675 / 4, 2);
        expect(occ["shift"]).toBe(SHIFT_BY_SLOT[slot]);
      });
    }
  });

  it("attaches an occupant to a pre-existing empty bed without duplicating the bed", async () => {
    // Seed customer + property + leases + 4 of the 5 unit setups.
    await seedPatriotBarabooIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });

    // Wipe seeded room/bed/occupant rows for unit 509 and replace with
    // an operator-created room and an unoccupied bed at slot 1.
    stores.rooms.delete(patriotBarabooRoomId("509"));
    for (let slot = 1; slot <= 4; slot++) {
      stores.beds.delete(patriotBarabooBedId("509", slot));
      stores.occupants.delete(patriotBarabooOccupantId("509", slot));
    }
    const opRoomId = "operator-room-509";
    const opBedId = "operator-bed-509-1";
    stores.rooms.set(opRoomId, {
      id: opRoomId,
      propertyId: PATRIOT_BARABOO_PROPERTY_ID,
      name: "Unit 509",
      monthlyRent: 0,
    });
    stores.beds.set(opBedId, {
      id: opBedId,
      propertyId: PATRIOT_BARABOO_PROPERTY_ID,
      roomId: opRoomId,
      bedNumber: 1,
      status: "Vacant",
      occupantId: null,
    });

    const result = await seedPatriotBarabooIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });
    // Slot 1 bed is the operator's, slots 2-4 are newly inserted.
    expect(result.bedsInserted).toBe(3);
    expect(result.occupantsInserted).toBe(4);

    const opBedAfter = stores.beds.get(opBedId)!;
    expect(opBedAfter["occupantId"]).toBe(
      patriotBarabooOccupantId("509", 1),
    );
    expect(opBedAfter["status"]).toBe("Occupied");

    // The roster occupant at slot 1 was inserted with bedId pointing at
    // the operator's bed, not our deterministic placeholder.
    const occ = stores.occupants.get(patriotBarabooOccupantId("509", 1))!;
    expect(occ["bedId"]).toBe(opBedId);

    // Re-running is a no-op now that everything is linked.
    const third = await seedPatriotBarabooIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });
    expect(third.bedsInserted).toBe(0);
    expect(third.occupantsInserted).toBe(0);
    expect(stores.beds.get(opBedId)!["occupantId"]).toBe(
      patriotBarabooOccupantId("509", 1),
    );
  });

  it("does not overwrite a pre-existing bed already assigned to another tenant", async () => {
    await seedPatriotBarabooIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });

    // Operator pre-assigned a different worker to unit 509 / slot 1.
    stores.rooms.delete(patriotBarabooRoomId("509"));
    for (let slot = 1; slot <= 4; slot++) {
      stores.beds.delete(patriotBarabooBedId("509", slot));
      stores.occupants.delete(patriotBarabooOccupantId("509", slot));
    }
    const opRoomId = "op-room-509-b";
    const opBedId = "op-bed-509-1-b";
    const opOccId = "op-occ-509-1-b";
    stores.rooms.set(opRoomId, {
      id: opRoomId,
      propertyId: PATRIOT_BARABOO_PROPERTY_ID,
      name: "Unit 509",
      monthlyRent: 0,
    });
    stores.occupants.set(opOccId, {
      id: opOccId,
      name: "Operator Pre-Assigned Worker",
      propertyId: PATRIOT_BARABOO_PROPERTY_ID,
      bedId: opBedId,
      moveInDate: "2025-09-30",
      status: "Active",
    });
    stores.beds.set(opBedId, {
      id: opBedId,
      propertyId: PATRIOT_BARABOO_PROPERTY_ID,
      roomId: opRoomId,
      bedNumber: 1,
      status: "Occupied",
      occupantId: opOccId,
    });

    await seedPatriotBarabooIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });

    // Operator's assignment was preserved.
    expect(stores.beds.get(opBedId)!["occupantId"]).toBe(opOccId);
    expect(stores.beds.get(opBedId)!["status"]).toBe("Occupied");
    // Roster occupant was still inserted (so they're tracked) but left
    // unassigned (bedId = null) — never point two occupants at one bed.
    const rosterOcc = stores.occupants.get(
      patriotBarabooOccupantId("509", 1),
    )!;
    expect(rosterOcc["name"]).toBe("Eladio Ramos Jr");
    expect(rosterOcc["bedId"]).toBeNull();
    // No phantom second bed was created at this slot either.
    const slot1Beds = Array.from(stores.beds.values()).filter(
      (b) =>
        b["propertyId"] === PATRIOT_BARABOO_PROPERTY_ID &&
        b["roomId"] === opRoomId &&
        b["bedNumber"] === 1,
    );
    expect(slot1Beds).toHaveLength(1);
    expect(slot1Beds[0]!["id"]).toBe(opBedId);
  });

  it("reuses an operator-created room for a unit instead of duplicating it", async () => {
    // Pre-seed customer + property + an operator-named room for unit 509.
    await seedPatriotBarabooIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });
    // Wipe seeded room/bed/occupant rows for unit 509 and replace with
    // an operator row using a different id but the same natural key.
    stores.rooms.delete(patriotBarabooRoomId("509"));
    for (let slot = 1; slot <= 4; slot++) {
      stores.beds.delete(patriotBarabooBedId("509", slot));
      stores.occupants.delete(patriotBarabooOccupantId("509", slot));
    }
    const opRoomId = "operator-room-509";
    stores.rooms.set(opRoomId, {
      id: opRoomId,
      propertyId: PATRIOT_BARABOO_PROPERTY_ID,
      name: "Unit 509",
      monthlyRent: 0,
    });

    const result = await seedPatriotBarabooIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });
    expect(result.roomsInserted).toBe(0);
    expect(result.bedsInserted).toBe(4);
    expect(result.occupantsInserted).toBe(4);
    // Operator's room is still the only Unit 509 row.
    const u509Rooms = Array.from(stores.rooms.values()).filter(
      (r) => r["name"] === "Unit 509",
    );
    expect(u509Rooms).toHaveLength(1);
    expect(u509Rooms[0]!["id"]).toBe(opRoomId);
    // New beds point at the operator's room id.
    for (let slot = 1; slot <= 4; slot++) {
      const bed = stores.beds.get(patriotBarabooBedId("509", slot))!;
      expect(bed["roomId"]).toBe(opRoomId);
    }
  });

  it("repoints the property from the KFI Staffing fallback to Milwaukee Valve once the end-client shows up, and deletes the unused fallback (Task #328)", async () => {
    // First boot: no Milwaukee Valve customer yet — falls back to
    // "KFI Staffing – Baraboo, WI".
    const first = await seedPatriotBarabooIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });
    expect(first.customerInserted).toBe(true);
    expect(first.repointedToEndClient).toBe(false);
    expect(first.fallbackCustomerDeleted).toBe(false);
    expect(
      stores.properties.get(PATRIOT_BARABOO_PROPERTY_ID)!["customerId"],
    ).toBe(PATRIOT_BARABOO_CUSTOMER_ID);

    // Master file lands and creates the real Milwaukee Valve customer.
    stores.customers.set("cust-milwaukee-valve", {
      id: "cust-milwaukee-valve",
      name: "Milwaukee Valve - Prairie du Sac, WI",
      contactName: "",
      email: "",
      phone: "",
      notes: "",
    });

    const second = await seedPatriotBarabooIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });
    expect(second.repointedToEndClient).toBe(true);
    expect(second.fallbackCustomerDeleted).toBe(true);
    expect(second.customerId).toBe("cust-milwaukee-valve");
    expect(stores.customers.has(PATRIOT_BARABOO_CUSTOMER_ID)).toBe(false);
    expect(
      stores.properties.get(PATRIOT_BARABOO_PROPERTY_ID)!["customerId"],
    ).toBe("cust-milwaukee-valve");
  });

  it("preserves an operator-chosen non-fallback customer even when Milwaukee Valve exists (Task #328)", async () => {
    stores.customers.set("operator-cust", {
      id: "operator-cust",
      name: "Operator Custom Client",
      contactName: "",
      email: "",
      phone: "",
      notes: "",
    });
    stores.customers.set("cust-milwaukee-valve", {
      id: "cust-milwaukee-valve",
      name: "Milwaukee Valve",
      contactName: "",
      email: "",
      phone: "",
      notes: "",
    });
    // Pre-create the property already attached to the operator's
    // customer so the seed sees an existing non-fallback attachment.
    stores.properties.set(PATRIOT_BARABOO_PROPERTY_ID, {
      id: PATRIOT_BARABOO_PROPERTY_ID,
      customerId: "operator-cust",
      name: "Patriot Baraboo",
      address: "509 8th St",
      city: "Baraboo",
      state: "WI",
      zip: "53913",
      totalBeds: 20,
      notes: "operator notes",
    });

    const result = await seedPatriotBarabooIfMissing({ logger: silentLogger, now: () => new Date("2026-06-01T00:00:00Z") });

    expect(result.repointedToEndClient).toBe(false);
    expect(result.customerId).toBe("operator-cust");
    expect(
      stores.properties.get(PATRIOT_BARABOO_PROPERTY_ID)!["customerId"],
    ).toBe("operator-cust");
    expect(stores.customers.has("operator-cust")).toBe(true);
    expect(stores.customers.has("cust-milwaukee-valve")).toBe(true);
  });
});
