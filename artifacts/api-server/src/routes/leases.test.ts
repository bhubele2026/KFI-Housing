import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { AddressInfo } from "node:net";
import http from "node:http";
import express, { type Express } from "express";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
// The route imports `@workspace/db`, which throws at import time when
// DATABASE_URL is unset. We mock with a tiny in-memory store so the
// `withDerivedStatus` wrapper added in task #309 can be exercised
// end-to-end against a real Express app — the user-visible contract is
// "GET /leases re-derives status from term dates against today, so a
// row stored as Active with a past end date comes back as Expired
// without any re-import".

interface LeaseRow {
  id: string;
  propertyId: string;
  startDate: string;
  endDate: string;
  monthlyRent: number;
  securityDeposit: number;
  status: "Active" | "Expired" | "Upcoming";
  notes: string;
  clauses: string;
  buyoutAvailable: boolean;
  buyoutCost: number | null;
  weeklyCost: number;
  vendor: string;
  needsReview: boolean;
  rateType: "monthly" | "room-night";
  nightlyRate: number;
  guaranteedRooms: number;
  monthlyRoomNightMin: number;
  longStayTaxExempt: boolean;
  customerId: string;
  customerResponsibleForRent: boolean;
  utilitiesIncludedInRent: boolean;
}

const store = new Map<string, LeaseRow>();

function makeFakeDb() {
  return {
    select: () => ({
      from: (_t: unknown) => ({
        orderBy: () => Array.from(store.values()),
      }),
    }),
    insert: (_t: unknown) => ({
      values: (vals: Partial<LeaseRow>) => ({
        returning: () => {
          const row = { ...vals } as LeaseRow;
          store.set(row.id, row);
          return [row];
        },
      }),
    }),
    update: (_t: unknown) => ({
      set: (vals: Partial<LeaseRow>) => ({
        where: (predicate: { id: string }) => ({
          returning: () => {
            const existing = store.get(predicate.id);
            if (!existing) return [];
            const merged = { ...existing, ...vals };
            store.set(predicate.id, merged);
            return [merged];
          },
        }),
      }),
    }),
    delete: (_t: unknown) => ({
      where: (predicate: { id: string }) => {
        store.delete(predicate.id);
      },
    }),
  };
}

const fakeDb = makeFakeDb();

vi.mock("drizzle-orm", () => ({
  eq: (_col: unknown, value: string) => ({ id: value }),
}));

vi.mock("@workspace/db", () => ({
  db: fakeDb,
  leasesTable: { __table: "leases" },
}));

const leasesRouter = (await import("./leases")).default;

function makeLease(overrides: Partial<LeaseRow> = {}): LeaseRow {
  return {
    id: "l-1",
    propertyId: "p-1",
    startDate: "2025-01-01",
    endDate: "2026-12-31",
    monthlyRent: 1200,
    securityDeposit: 0,
    status: "Active",
    notes: "",
    clauses: "",
    buyoutAvailable: false,
    buyoutCost: null,
    weeklyCost: 0,
    vendor: "",
    needsReview: false,
    rateType: "monthly",
    nightlyRate: 0,
    guaranteedRooms: 0,
    monthlyRoomNightMin: 0,
    longStayTaxExempt: false,
    customerId: "",
    customerResponsibleForRent: false,
    utilitiesIncludedInRent: false,
    ...overrides,
  };
}

describe("GET /leases — dynamic status derivation (task #309 / #327)", () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app: Express = express();
    app.use(express.json());
    app.use("/api", leasesRouter);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  beforeEach(() => {
    store.clear();
    // Pin "today" so the assertions don't drift with the calendar.
    // 2026-05-06 matches the date used in the unit-level
    // lease-status.test.ts so the two suites stay in sync.
    // Only fake `Date` — not the timer queue — so the in-process
    // HTTP fetch (which uses real timers internally) keeps working.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-05-06T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns status=Expired for a lease stored as Active whose end date is in the past (the user-visible contract of task #309)", async () => {
    store.set(
      "l-past",
      makeLease({
        id: "l-past",
        startDate: "2024-12-01",
        endDate: "2025-11-30",
        status: "Active",
      }),
    );

    const res = await fetch(`${baseUrl}/api/leases`);
    expect(res.status).toBe(200);
    const rows = (await res.json()) as LeaseRow[];
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("l-past");
    expect(rows[0].status).toBe("Expired");
    // Underlying row is unchanged — the derivation is read-side only.
    expect(store.get("l-past")?.status).toBe("Active");
  });

  it("returns status=Upcoming for a lease whose start date is still in the future", async () => {
    store.set(
      "l-future",
      makeLease({
        id: "l-future",
        startDate: "2026-06-01",
        endDate: "2026-12-31",
        status: "Active",
      }),
    );

    const res = await fetch(`${baseUrl}/api/leases`);
    expect(res.status).toBe(200);
    const rows = (await res.json()) as LeaseRow[];
    expect(rows[0].status).toBe("Upcoming");
    expect(store.get("l-future")?.status).toBe("Active");
  });

  // Blank-date rows (e.g. master-import rows awaiting triage from
  // `import-master-leases.ts` and the Ridge Motor Inn seed) must
  // round-trip through GET /leases without 500ing. The openapi
  // `Lease` schema was loosened in task #359 to allow blank term
  // dates via `OptionalLeaseDate`, so the `deriveLeaseStatus`
  // wrapper's blank-date branch can finally reach the client — it
  // falls back to the stored status since there's no calendar to
  // compare against.
  it("returns blank-date rows with their stored status preserved (task #359)", async () => {
    store.set(
      "l-blank",
      makeLease({
        id: "l-blank",
        startDate: "",
        endDate: "",
        status: "Upcoming",
      }),
    );

    const res = await fetch(`${baseUrl}/api/leases`);
    expect(res.status).toBe(200);
    const rows = (await res.json()) as LeaseRow[];
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("l-blank");
    expect(rows[0].startDate).toBe("");
    expect(rows[0].endDate).toBe("");
    expect(rows[0].status).toBe("Upcoming");
    expect(store.get("l-blank")?.status).toBe("Upcoming");
  });

  // Task #364 — datetime-style dates that slipped past the import
  // boundary (e.g. `"2026-05-31 00:00:00"` from a date-typed XLSX
  // cell, or `"2026-05-31T00:00:00.000Z"` from a JS Date toString)
  // must be normalized down to YYYY-MM-DD by the route so they
  // don't 500 the entire list. One bad row used to poison
  // `ListLeasesResponse.parse(...)` and blank the Customers /
  // Leases / Dashboard pages.
  it.each([
    ["space + time", "2026-05-31 00:00:00", "2027-05-31 00:00:00"],
    ["T + time + Z", "2026-05-31T00:00:00.000Z", "2027-05-31T00:00:00.000Z"],
    ["T + time, no zone", "2026-05-31T00:00:00", "2027-05-31T00:00:00"],
  ])(
    "normalizes datetime-style %s strings to YYYY-MM-DD on the way out (task #364)",
    async (_label, badStart, badEnd) => {
      store.set(
        "l-dt",
        makeLease({
          id: "l-dt",
          startDate: badStart,
          endDate: badEnd,
          status: "Active",
        }),
      );
      // Plus a clean row so we also prove the bad row no longer
      // poisons the rest of the array.
      store.set(
        "l-clean",
        makeLease({
          id: "l-clean",
          startDate: "2025-01-01",
          endDate: "2026-12-31",
        }),
      );

      const res = await fetch(`${baseUrl}/api/leases`);
      expect(res.status).toBe(200);
      const rows = (await res.json()) as LeaseRow[];
      const dt = rows.find((r) => r.id === "l-dt");
      const clean = rows.find((r) => r.id === "l-clean");
      expect(dt?.startDate).toBe("2026-05-31");
      expect(dt?.endDate).toBe("2027-05-31");
      expect(clean?.id).toBe("l-clean");
    },
  );

  // Task #376 — per-row safeParse pass-through. When a row has a field
  // that fails Zod validation entirely (e.g. monthlyRent is null
  // instead of a number, which happens when PostgreSQL stores NaN and
  // JSON.stringify serialises it as null), the route must still return
  // 200 and include the malformed row in the response so the frontend's
  // safeParseList can drop it and show the data-issues banner.
  it("passes through a row with null monthlyRent (Zod-invalid) alongside clean rows (task #376)", async () => {
    store.set(
      "l-bad",
      makeLease({
        id: "l-bad",
        monthlyRent: null as unknown as number,
      }),
    );
    store.set("l-clean", makeLease({ id: "l-clean" }));

    const res = await fetch(`${baseUrl}/api/leases`);
    expect(res.status).toBe(200);
    const rows = (await res.json()) as LeaseRow[];
    expect(rows).toHaveLength(2);
    const ids = rows.map((r) => r.id).sort();
    expect(ids).toEqual(["l-bad", "l-clean"]);
    const bad = rows.find((r) => r.id === "l-bad")!;
    expect(bad.monthlyRent).toBeNull();
  });

  // Task #365 — single normalizer at the DB ↔ API boundary. A lease
  // row that somehow landed in the DB with an off-list `status` or
  // `rateType` (legacy import, hand-edited row, future enum value
  // rolled back) must not 500 the entire list. The normalizer
  // coerces it to a safe default so the rest of the array still
  // round-trips through `ListLeasesResponse.parse`.
  it.each([
    ["off-list status", { status: "pending" as unknown as LeaseRow["status"] }],
    [
      "off-list rateType",
      { rateType: "annual" as unknown as LeaseRow["rateType"] },
    ],
  ])(
    "GET /leases stays 200 when a row has an %s, alongside clean rows (task #365)",
    async (_label, badShape) => {
      store.set("l-bad", makeLease({ id: "l-bad", ...badShape }));
      store.set("l-clean", makeLease({ id: "l-clean" }));

      const res = await fetch(`${baseUrl}/api/leases`);
      expect(res.status).toBe(200);
      const rows = (await res.json()) as LeaseRow[];
      expect(rows.map((r) => r.id).sort()).toEqual(["l-bad", "l-clean"]);
      const bad = rows.find((r) => r.id === "l-bad")!;
      // Coerced to canonical defaults — not the bad value.
      expect(["Active", "Expired", "Upcoming"]).toContain(bad.status);
      expect(["monthly", "room-night"]).toContain(bad.rateType);
    },
  );
});
