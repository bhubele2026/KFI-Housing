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

  // Documents the route's current contract for blank-date rows
  // (e.g. master-import rows from `import-master-leases.ts`). The
  // `deriveLeaseStatus` helper falls back to the stored status when
  // either term date is blank — see `lib/lease-status.test.ts` for
  // the unit-level coverage of that fallback. At the route boundary
  // however, `ListLeasesResponse` (generated from the openapi
  // `LeaseDate` schema) requires `^\d{4}-\d{2}-\d{2}$`, so a
  // blank-date row cannot currently round-trip through GET /leases.
  // We assert that current behavior here so any future loosening of
  // the response schema (which would surface the wrapper's
  // blank-date branch) trips this test and forces the symmetric
  // route-level "falls back to stored" assertion to be added.
  it("currently 500s when a blank-date row is in the table — the response schema rejects it before the wrapper's fallback can ship the stored status to the client", async () => {
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
    expect(res.status).toBe(500);
  });
});
