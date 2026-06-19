import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Task #646 — assistant write tools must run through the same Express
// route handlers a human operator hits, so route-level validations
// (cleaning workflow guard #500, lease status derivation, payment-method
// coercion, etc.) fire even when the LLM is the one calling.
//
// Before this refactor `update_bed` and friends did a direct
// `db.update(bedsTable)`, skipping the cleaning-workflow guard. This
// suite stubs the DB + api-zod and asserts the guard now fires through
// the assistant tool path.
// ---------------------------------------------------------------------------

interface BedRow {
  id: string;
  propertyId: string;
  roomId: string;
  bedNumber: number;
  status: string;
  cleaningStatus: string;
  occupantId: string | null;
}

const bedStore = new Map<string, BedRow>();

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- self-referential test stub (transaction passes itself); `any` breaks the TS7022 inference cycle
const fakeDb: any = {
  select: () => ({
    from: (_t: unknown) => ({
      orderBy: () => Array.from(bedStore.values()),
      where: (predicate: { id?: string }) => {
        if (predicate?.id) {
          const row = bedStore.get(predicate.id);
          return row ? [row] : [];
        }
        return Array.from(bedStore.values());
      },
    }),
  }),
  insert: (_t: unknown) => ({
    values: (vals: BedRow) => ({
      returning: () => {
        bedStore.set(vals.id, { ...vals });
        return [bedStore.get(vals.id)];
      },
    }),
  }),
  update: (_t: unknown) => ({
    set: (vals: Partial<BedRow>) => ({
      where: (predicate: { id: string }) => ({
        returning: () => {
          const existing = bedStore.get(predicate.id);
          if (!existing) return [];
          const merged = { ...existing, ...vals } as BedRow;
          bedStore.set(predicate.id, merged);
          return [merged];
        },
      }),
    }),
  }),
  delete: () => ({ where: () => undefined }),
  transaction: async (cb: (tx: typeof fakeDb) => unknown) => cb(fakeDb),
};

vi.mock("drizzle-orm", () => ({
  eq: (col: { name?: string }, value: string) =>
    col?.name === "id" || !col?.name ? { id: value } : { [col.name!]: value },
  and: (...args: unknown[]) => args,
  or: (...args: unknown[]) => args,
  ilike: (_c: unknown, v: unknown) => ({ ilike: v }),
  ne: (_c: unknown, v: unknown) => ({ ne: v }),
}));

vi.mock("@workspace/db", () => ({
  db: fakeDb,
  bedsTable: {
    name: "id",
    id: { name: "id" },
    cleaningStatus: { name: "cleaningStatus" },
    status: { name: "status" },
    occupantId: { name: "occupantId" },
    roomId: { name: "roomId" },
    propertyId: { name: "propertyId" },
  },
  propertiesTable: { name: "id", id: { name: "id" } },
  buildingsTable: { name: "id", id: { name: "id" } },
  roomsTable: { name: "id", id: { name: "id" } },
  occupantsTable: { name: "id", id: { name: "id" } },
  leasesTable: { name: "id", id: { name: "id" } },
  utilitiesTable: { name: "id", id: { name: "id" } },
  insuranceCertificatesTable: { name: "id", id: { name: "id" } },
  customersTable: { name: "id", id: { name: "id" } },
  payrollDeductionsTable: { name: "id", id: { name: "id" } },
}));

// Stub geocoder so properties POST/PATCH dispatch wouldn't reach out
// even if a future test exercises it.
vi.mock("../../lib/geocode-property", () => ({
  formatPropertyAddress: (r: { address?: string }) => r.address ?? "",
  getGeocoder: () => ({ geocode: async () => null }),
  __setGeocoderForTest: () => undefined,
}));

const { TOOLS } = await import("./tools");

function tool(name: string) {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} not registered`);
  return t;
}

// Minimal ToolCtx for execute(input, ctx). update_bed routes through the
// HTTP handler and doesn't read ctx, but the signature requires it.
const ctx = { userId: "test-user" };

beforeEach(() => {
  bedStore.clear();
});

describe("Task #646 — assistant write tools route through the HTTP handlers", () => {
  it("update_bed refuses to flip a not-ready bed to Occupied (cleaning workflow guard #500 fires through dispatch)", async () => {
    bedStore.set("bed-1", {
      id: "bed-1",
      propertyId: "p1",
      roomId: "r1",
      bedNumber: 1,
      status: "Vacant",
      cleaningStatus: "needs_cleaning",
      occupantId: null,
    });

    await expect(
      tool("update_bed").execute({
        id: "bed-1",
        status: "Occupied",
        occupantId: "o-new",
      }, ctx),
    ).rejects.toThrow(/cleaning workflow/i);

    // Importantly, the bed wasn't mutated — direct db.update would
    // have flipped it silently.
    const persisted = bedStore.get("bed-1")!;
    expect(persisted.status).toBe("Vacant");
    expect(persisted.occupantId).toBeNull();
  });

  it("update_bed succeeds when the bed is ready, and a Vacant patch auto-stamps needs_cleaning", async () => {
    bedStore.set("bed-ready", {
      id: "bed-ready",
      propertyId: "p1",
      roomId: "r1",
      bedNumber: 2,
      status: "Vacant",
      cleaningStatus: "ready",
      occupantId: null,
    });
    bedStore.set("bed-occupied", {
      id: "bed-occupied",
      propertyId: "p1",
      roomId: "r1",
      bedNumber: 3,
      status: "Occupied",
      cleaningStatus: "occupied",
      occupantId: "o-1",
    });

    const occupied = (await tool("update_bed").execute({
      id: "bed-ready",
      status: "Occupied",
      occupantId: "o-1",
      cleaningStatus: "occupied",
    }, ctx)) as { bed: BedRow };
    expect(occupied.bed.status).toBe("Occupied");
    expect(occupied.bed.occupantId).toBe("o-1");

    // PATCH that flips to Vacant without naming cleaningStatus should
    // get the route's auto-needs_cleaning default — proves we routed
    // through the handler, not raw db.update.
    const vacated = (await tool("update_bed").execute({
      id: "bed-occupied",
      status: "Vacant",
      occupantId: null,
    }, ctx)) as { bed: BedRow };
    expect(vacated.bed.status).toBe("Vacant");
    expect(vacated.bed.cleaningStatus).toBe("needs_cleaning");
  });
});
