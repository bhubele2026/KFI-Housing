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
// DATABASE_URL is unset (same setup as the leases-import-pdf test).
// We mock the DB with a tiny in-memory store so the geocode-on-save
// behavior can be exercised end-to-end against a real Express app
// without a Postgres dependency.

interface PropertyRow {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  totalBeds: number;
  monthlyRent: number;
  chargePerBed: number;
  status: "Active" | "Inactive";
  landlordName: string;
  landlordEmail: string;
  landlordPhone: string;
  paymentMethod:
    | ""
    | "ACH"
    | "Check"
    | "Wire"
    | "Online Portal"
    | "Money Order"
    | "Invoice";
  paymentRecipient: string;
  paymentDueDay: number;
  rentFrequency?: "Weekly" | "Bi-Weekly" | "Monthly";
  paymentNotes: string;
  bankName: string;
  bankRouting: string;
  bankAccount: string;
  portalUrl: string;
  notes: string;
  furnishings: string[];
  customerId: string;
  ratings: {
    landlord: number;
    cleanliness: number;
    amenities: number;
    occupants: number;
    location: number;
    valueForMoney: number;
  };
  lat: number | null;
  lng: number | null;
  coordsVerified: boolean;
}

const store = new Map<string, PropertyRow>();
const EMPTY_RATINGS = {
  landlord: 0,
  cleanliness: 0,
  amenities: 0,
  occupants: 0,
  location: 0,
  valueForMoney: 0,
};

// Minimal Drizzle-shaped fluent builder. Only models the call chains
// the route actually uses: select-from-where, insert-values-returning,
// update-set-where-returning, delete-where, select-from-orderBy.
function makeFakeDb() {
  return {
    select: () => ({
      from: (_t: unknown) => {
        const builder = {
          orderBy: () => Array.from(store.values()),
          where: (predicate: { id: string }) => {
            const row = store.get(predicate.id);
            return row ? [row] : [];
          },
        };
        return builder;
      },
    }),
    insert: (_t: unknown) => ({
      values: (vals: Partial<PropertyRow>) => ({
        returning: () => {
          const row: PropertyRow = {
            ratings: EMPTY_RATINGS,
            furnishings: [],
            lat: null,
            lng: null,
            ...vals,
          } as PropertyRow;
          store.set(row.id, row);
          return [row];
        },
      }),
    }),
    update: (_t: unknown) => ({
      set: (vals: Partial<PropertyRow>) => ({
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

// `eq(propertiesTable.id, id)` is what the route calls. Our fake
// `where` reads the predicate's `id` property directly, so eq just
// returns `{ id }`.
vi.mock("drizzle-orm", () => ({
  eq: (_col: unknown, value: string) => ({ id: value }),
}));

vi.mock("@workspace/db", () => ({
  db: fakeDb,
  propertiesTable: { __table: "properties" },
}));

const propertiesRouter = (await import("./properties")).default;
const { __setGeocoderForTest } = await import("../lib/geocode-property");

describe("properties route — server-side geocoding (Task #152)", () => {
  let server: http.Server;
  let baseUrl: string;
  const geocodeMock = vi.fn<(addr: string) => Promise<{ lat: number; lng: number } | null>>();

  beforeAll(async () => {
    const app: Express = express();
    app.use(express.json());
    app.use("/api", propertiesRouter);
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
    geocodeMock.mockReset();
    __setGeocoderForTest({ geocode: (addr: string) => geocodeMock(addr) });
  });

  afterEach(() => {
    __setGeocoderForTest(null);
  });

  function makeCreateBody(overrides: Partial<PropertyRow> = {}): PropertyRow {
    return {
      id: "p-new",
      name: "Maple Court",
      address: "123 Main St",
      city: "Austin",
      state: "TX",
      zip: "78701",
      totalBeds: 4,
      monthlyRent: 2400,
      chargePerBed: 600,
      status: "Active",
      landlordName: "",
      landlordEmail: "",
      landlordPhone: "",
      paymentMethod: "ACH",
      paymentRecipient: "",
      paymentDueDay: 1,
      paymentNotes: "",
      bankName: "",
      bankRouting: "",
      bankAccount: "",
      portalUrl: "",
      notes: "",
      furnishings: [],
      customerId: "c1",
      ratings: EMPTY_RATINGS,
      lat: null,
      lng: null,
      coordsVerified: false,
      ...overrides,
    };
  }

  it("POST /properties geocodes the composed address before responding so first map view is instant", async () => {
    geocodeMock.mockResolvedValueOnce({ lat: 30.2672, lng: -97.7431 });

    const body = makeCreateBody();
    const res = await fetch(`${baseUrl}/api/properties`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(201);
    const persisted = (await res.json()) as PropertyRow;
    expect(persisted.lat).toBe(30.2672);
    expect(persisted.lng).toBe(-97.7431);
    // Same composed address as the front-end's `fullAddress` helper
    // produces — keeping the two formatters in sync means a property
    // the server geocoded against "123 Main St, Austin, TX 78701" is
    // also what the front-end fallback would send if it ever ran.
    expect(geocodeMock).toHaveBeenCalledWith(
      "123 Main St, Austin, TX 78701",
    );
    // And the row is what GET /properties would now return — no
    // future viewer pays the round-trip.
    expect(store.get("p-new")?.lat).toBe(30.2672);
  });

  it("POST /properties persists null coords when the geocoder has no result (typo'd address) but still saves the row", async () => {
    geocodeMock.mockResolvedValueOnce(null);

    const res = await fetch(`${baseUrl}/api/properties`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(makeCreateBody({ id: "p-typo", address: "asdfgh" })),
    });
    expect(res.status).toBe(201);
    const persisted = (await res.json()) as PropertyRow;
    expect(persisted.lat).toBeNull();
    expect(persisted.lng).toBeNull();
    // Row is still in the store so the missing-address side panel
    // can surface it.
    expect(store.has("p-typo")).toBe(true);
  });

  it("POST /properties skips the geocode round-trip when the address is wholly blank", async () => {
    const res = await fetch(`${baseUrl}/api/properties`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        makeCreateBody({
          id: "p-blank",
          address: "",
          city: "",
          state: "",
          zip: "",
        }),
      ),
    });
    expect(res.status).toBe(201);
    expect(geocodeMock).not.toHaveBeenCalled();
    const persisted = (await res.json()) as PropertyRow;
    expect(persisted.lat).toBeNull();
    expect(persisted.lng).toBeNull();
  });

  it("POST /properties honours explicit lat/lng in the body without re-geocoding (idempotent for the front-end safety-net write-back)", async () => {
    const res = await fetch(`${baseUrl}/api/properties`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        makeCreateBody({ id: "p-explicit", lat: 1.23, lng: 4.56 }),
      ),
    });
    expect(res.status).toBe(201);
    expect(geocodeMock).not.toHaveBeenCalled();
    const persisted = (await res.json()) as PropertyRow;
    expect(persisted.lat).toBe(1.23);
    expect(persisted.lng).toBe(4.56);
  });

  it("PATCH /properties/:id re-geocodes when an address field changes and overwrites stored coords", async () => {
    // Seed an existing row with stale coords pointing at the old
    // address — exactly the situation an operator hits when they
    // correct a typo.
    store.set("p1", {
      ...makeCreateBody({ id: "p1", lat: 30.2672, lng: -97.7431 }),
    });
    geocodeMock.mockResolvedValueOnce({ lat: 32.7767, lng: -96.797 });

    const res = await fetch(`${baseUrl}/api/properties/p1`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ city: "Dallas", zip: "75201" }),
    });
    expect(res.status).toBe(200);
    const persisted = (await res.json()) as PropertyRow;
    // Body fields override, missing fields fall through to stored.
    expect(geocodeMock).toHaveBeenCalledWith(
      "123 Main St, Dallas, TX 75201",
    );
    expect(persisted.lat).toBe(32.7767);
    expect(persisted.lng).toBe(-96.797);
  });

  it("PATCH /properties/:id clears lat/lng when the new address fails to geocode (so a stale pin can't outlive a typo'd edit)", async () => {
    store.set("p2", {
      ...makeCreateBody({ id: "p2", lat: 30.2672, lng: -97.7431 }),
    });
    geocodeMock.mockResolvedValueOnce(null);

    const res = await fetch(`${baseUrl}/api/properties/p2`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: "asdfgh nonsense" }),
    });
    expect(res.status).toBe(200);
    const persisted = (await res.json()) as PropertyRow;
    expect(persisted.lat).toBeNull();
    expect(persisted.lng).toBeNull();
  });

  it("PATCH /properties/:id does NOT geocode when no address field is in the body (a pure ratings/status edit shouldn't burn a Google call)", async () => {
    store.set("p3", {
      ...makeCreateBody({ id: "p3", lat: 30.2672, lng: -97.7431 }),
    });

    const res = await fetch(`${baseUrl}/api/properties/p3`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "Inactive" }),
    });
    expect(res.status).toBe(200);
    expect(geocodeMock).not.toHaveBeenCalled();
    // Stored coords survive untouched.
    const persisted = (await res.json()) as PropertyRow;
    expect(persisted.lat).toBe(30.2672);
    expect(persisted.lng).toBe(-97.7431);
  });

  it("PATCH /properties/:id with explicit lat/lng (the front-end onGeocoded write-back path) skips the geocode and persists the supplied coords", async () => {
    store.set("p4", { ...makeCreateBody({ id: "p4" }) });

    const res = await fetch(`${baseUrl}/api/properties/p4`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat: 9.99, lng: -8.88 }),
    });
    expect(res.status).toBe(200);
    expect(geocodeMock).not.toHaveBeenCalled();
    const persisted = (await res.json()) as PropertyRow;
    expect(persisted.lat).toBe(9.99);
    expect(persisted.lng).toBe(-8.88);
  });

  // -------------------------------------------------------------------------
  // Task #153 — `coordsVerified` trust column
  // -------------------------------------------------------------------------
  // The column lets the UI render an "Approximate location" badge for
  // auto-geocoded pins and a "Verified location" badge once an operator
  // confirms the pin pinpoints the property. The invariants exercised
  // below are the contract the front-end depends on: any time the
  // server re-geocodes, trust resets to false; explicit lat/lng
  // honors any explicit `coordsVerified` value the front-end sent;
  // and a pure metadata edit can flip the badge without touching the
  // pin.

  it("POST /properties resets coordsVerified to false on auto-geocoded pins (operator hasn't confirmed yet)", async () => {
    geocodeMock.mockResolvedValueOnce({ lat: 30.2672, lng: -97.7431 });
    const res = await fetch(`${baseUrl}/api/properties`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(makeCreateBody({ id: "p-cv1", coordsVerified: true })),
    });
    expect(res.status).toBe(201);
    const persisted = (await res.json()) as PropertyRow;
    // Even though the body claimed verified=true, the route forces
    // false because the coords came from the geocoder, not the user.
    expect(persisted.coordsVerified).toBe(false);
  });

  it("POST /properties honors coordsVerified=true alongside explicit lat/lng (e.g. trusted import)", async () => {
    const res = await fetch(`${baseUrl}/api/properties`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        makeCreateBody({
          id: "p-cv2",
          lat: 1.23,
          lng: 4.56,
          coordsVerified: true,
        }),
      ),
    });
    expect(res.status).toBe(201);
    const persisted = (await res.json()) as PropertyRow;
    expect(persisted.coordsVerified).toBe(true);
  });

  it("PATCH /properties/:id resets coordsVerified to false when an address re-geocode runs (pin moved, trust gone)", async () => {
    store.set("p-cv3", {
      ...makeCreateBody({
        id: "p-cv3",
        lat: 30.2672,
        lng: -97.7431,
        coordsVerified: true,
      }),
    });
    geocodeMock.mockResolvedValueOnce({ lat: 32.7767, lng: -96.797 });

    const res = await fetch(`${baseUrl}/api/properties/p-cv3`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ city: "Dallas", zip: "75201" }),
    });
    expect(res.status).toBe(200);
    const persisted = (await res.json()) as PropertyRow;
    expect(persisted.coordsVerified).toBe(false);
  });

  it("PATCH /properties/:id with only coordsVerified=true (operator marks pin verified) skips the geocoder and persists the flag", async () => {
    store.set("p-cv4", {
      ...makeCreateBody({
        id: "p-cv4",
        lat: 30.2672,
        lng: -97.7431,
        coordsVerified: false,
      }),
    });
    const res = await fetch(`${baseUrl}/api/properties/p-cv4`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ coordsVerified: true }),
    });
    expect(res.status).toBe(200);
    expect(geocodeMock).not.toHaveBeenCalled();
    const persisted = (await res.json()) as PropertyRow;
    expect(persisted.coordsVerified).toBe(true);
    // Pin coords untouched.
    expect(persisted.lat).toBe(30.2672);
    expect(persisted.lng).toBe(-97.7431);
  });

  // -------------------------------------------------------------------------
  // Task #227 — backfill route
  // -------------------------------------------------------------------------
  // POST /properties/backfill-coords walks every row, geocodes any
  // null-coord rows whose composed address is non-blank, and persists
  // the result. The contract the front-end (and operators running it
  // again) depend on: idempotent, leaves blank-address and
  // already-coord rows alone, and surfaces a per-bucket summary so the
  // caller can tell how many rows are still missing pins.
  describe("POST /properties/backfill-coords (Task #227)", () => {
    it("geocodes only rows with null coords and a non-blank address, leaving the rest alone", async () => {
      // Has coords already — must not be re-geocoded (would burn a
      // Google call and could clobber a verified pin with an
      // unverified one).
      store.set("p-already", {
        ...makeCreateBody({
          id: "p-already",
          lat: 30.2672,
          lng: -97.7431,
          coordsVerified: true,
        }),
      });
      // Null coords + non-blank address — the target case.
      store.set("p-needs", {
        ...makeCreateBody({ id: "p-needs", lat: null, lng: null }),
      });
      // Null coords + entirely blank address — nothing to geocode,
      // must stay null.
      store.set("p-blank", {
        ...makeCreateBody({
          id: "p-blank",
          address: "",
          city: "",
          state: "",
          zip: "",
          lat: null,
          lng: null,
        }),
      });
      // Null coords + address the geocoder can't resolve — must
      // stay null so the next run (after the typo is fixed) can pick
      // it up.
      store.set("p-typo", {
        ...makeCreateBody({
          id: "p-typo",
          address: "asdfgh",
          lat: null,
          lng: null,
        }),
      });

      // One resolution for p-needs; p-typo gets ZERO_RESULTS.
      geocodeMock.mockImplementation(async (addr) => {
        if (addr === "123 Main St, Austin, TX 78701") {
          return { lat: 30.2672, lng: -97.7431 };
        }
        return null;
      });

      const res = await fetch(`${baseUrl}/api/properties/backfill-coords`, {
        method: "POST",
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        scanned: 4,
        updated: 1,
        alreadyHadCoords: 1,
        noAddress: 1,
        stillMissing: 1,
      });

      // p-needs got the resolved coords with verified=false.
      expect(store.get("p-needs")?.lat).toBe(30.2672);
      expect(store.get("p-needs")?.lng).toBe(-97.7431);
      expect(store.get("p-needs")?.coordsVerified).toBe(false);

      // p-already untouched — verified flag preserved, no extra
      // geocoder call.
      expect(store.get("p-already")?.lat).toBe(30.2672);
      expect(store.get("p-already")?.coordsVerified).toBe(true);

      // p-blank still null, p-typo still null.
      expect(store.get("p-blank")?.lat).toBeNull();
      expect(store.get("p-typo")?.lat).toBeNull();

      // Geocoder only called for the two rows with addresses to try.
      expect(geocodeMock).toHaveBeenCalledTimes(2);
    });

    it("is idempotent — a second run only touches rows that became resolvable since the first", async () => {
      store.set("p-needs", {
        ...makeCreateBody({ id: "p-needs", lat: null, lng: null }),
      });

      geocodeMock.mockResolvedValue({ lat: 30.2672, lng: -97.7431 });

      const first = await fetch(`${baseUrl}/api/properties/backfill-coords`, {
        method: "POST",
      });
      expect(first.status).toBe(200);
      expect(((await first.json()) as { updated: number }).updated).toBe(1);
      expect(geocodeMock).toHaveBeenCalledTimes(1);

      // Second run with the same store: row already has coords now,
      // so no geocoder call and updated=0. This is the property the
      // caller relies on for safe re-runs (admin button or cron).
      geocodeMock.mockClear();
      const second = await fetch(`${baseUrl}/api/properties/backfill-coords`, {
        method: "POST",
      });
      expect(second.status).toBe(200);
      expect(await second.json()).toEqual({
        scanned: 1,
        updated: 0,
        alreadyHadCoords: 1,
        noAddress: 0,
        stillMissing: 0,
      });
      expect(geocodeMock).not.toHaveBeenCalled();
    });

    it("returns a zero-everything summary when there are no properties to scan", async () => {
      const res = await fetch(`${baseUrl}/api/properties/backfill-coords`, {
        method: "POST",
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        scanned: 0,
        updated: 0,
        alreadyHadCoords: 0,
        noAddress: 0,
        stillMissing: 0,
      });
      expect(geocodeMock).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Task #228 — `geocodeStatus` save-time outcome flag
  // -------------------------------------------------------------------------
  // The flag rides on the POST/PATCH response (not persisted, not
  // returned by GET /properties) so the front-end can show a non-
  // blocking warning toast at save time when an address couldn't be
  // located. Operators previously only discovered the failure days
  // later via the missing-address side panel.

  it("POST /properties returns geocodeStatus=ok when the geocoder resolves the address", async () => {
    geocodeMock.mockResolvedValueOnce({ lat: 30.2672, lng: -97.7431 });
    const res = await fetch(`${baseUrl}/api/properties`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(makeCreateBody({ id: "p-gs1" })),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as PropertyRow & { geocodeStatus: string };
    expect(body.geocodeStatus).toBe("ok");
  });

  it("POST /properties returns geocodeStatus=no_result on a typo'd address (operator gets a save-time warning)", async () => {
    geocodeMock.mockResolvedValueOnce(null);
    const res = await fetch(`${baseUrl}/api/properties`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        makeCreateBody({ id: "p-gs2", address: "asdfgh nonsense" }),
      ),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as PropertyRow & { geocodeStatus: string };
    expect(body.geocodeStatus).toBe("no_result");
    // Row still saves with null coords — the warning is advisory, not blocking.
    expect(body.lat).toBeNull();
    expect(body.lng).toBeNull();
  });

  it("POST /properties returns geocodeStatus=skipped when the address is wholly blank (no round-trip happened)", async () => {
    const res = await fetch(`${baseUrl}/api/properties`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        makeCreateBody({
          id: "p-gs3",
          address: "",
          city: "",
          state: "",
          zip: "",
        }),
      ),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as PropertyRow & { geocodeStatus: string };
    expect(body.geocodeStatus).toBe("skipped");
    expect(geocodeMock).not.toHaveBeenCalled();
  });

  it("POST /properties returns geocodeStatus=ok when explicit lat/lng are supplied (no warning even though the geocoder didn't run)", async () => {
    const res = await fetch(`${baseUrl}/api/properties`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        makeCreateBody({ id: "p-gs4", lat: 1.23, lng: 4.56 }),
      ),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as PropertyRow & { geocodeStatus: string };
    expect(body.geocodeStatus).toBe("ok");
    expect(geocodeMock).not.toHaveBeenCalled();
  });

  it("PATCH /properties/:id returns geocodeStatus=no_result when an address edit fails to geocode", async () => {
    store.set("p-gs5", { ...makeCreateBody({ id: "p-gs5" }) });
    geocodeMock.mockResolvedValueOnce(null);
    const res = await fetch(`${baseUrl}/api/properties/p-gs5`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: "asdfgh nonsense" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as PropertyRow & { geocodeStatus: string };
    expect(body.geocodeStatus).toBe("no_result");
  });

  it("PATCH /properties/:id returns geocodeStatus=skipped when no address field is in the body", async () => {
    store.set("p-gs6", { ...makeCreateBody({ id: "p-gs6" }) });
    const res = await fetch(`${baseUrl}/api/properties/p-gs6`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "Inactive" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as PropertyRow & { geocodeStatus: string };
    expect(body.geocodeStatus).toBe("skipped");
  });

  it("PATCH /properties/:id returns geocodeStatus=ok on a successful re-geocode", async () => {
    store.set("p-gs7", { ...makeCreateBody({ id: "p-gs7" }) });
    geocodeMock.mockResolvedValueOnce({ lat: 32.7767, lng: -96.797 });
    const res = await fetch(`${baseUrl}/api/properties/p-gs7`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ city: "Dallas", zip: "75201" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as PropertyRow & { geocodeStatus: string };
    expect(body.geocodeStatus).toBe("ok");
  });

  it("PATCH /properties/:id returns geocodeStatus=ok when explicit lat/lng are supplied (front-end onGeocoded write-back)", async () => {
    store.set("p-gs8", { ...makeCreateBody({ id: "p-gs8" }) });
    const res = await fetch(`${baseUrl}/api/properties/p-gs8`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat: 9.99, lng: -8.88 }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as PropertyRow & { geocodeStatus: string };
    expect(body.geocodeStatus).toBe("ok");
  });

  it("PATCH /properties/:id returns 404 when the row doesn't exist (and never calls the geocoder)", async () => {
    const res = await fetch(`${baseUrl}/api/properties/missing`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ city: "Dallas" }),
    });
    expect(res.status).toBe(404);
    expect(geocodeMock).not.toHaveBeenCalled();
  });

  // Task #364 — legacy / triage rows whose paymentMethod is the
  // empty string (Ridge Motor Inn, Chateau Knoll seeds) or
  // "Invoice" (the hotel-corporate-rate seed) used to 500 the
  // entire GET /properties response because zod's enum check
  // poisoned the whole array. The widened OpenAPI enum now lets
  // them round-trip so the Customers page renders all rows.
  it.each([
    ["blank legacy paymentMethod", ""] as const,
    ['"Invoice" hotel-corporate-rate paymentMethod', "Invoice"] as const,
  ])(
    "GET /properties returns rows whose paymentMethod is %s without dropping any other rows (task #364)",
    async (_label, value) => {
      store.set("p-clean", { ...makeCreateBody({ id: "p-clean" }) });
      store.set("p-legacy", {
        ...makeCreateBody({
          id: "p-legacy",
          paymentMethod: value as PropertyRow["paymentMethod"],
        }),
      });

      const res = await fetch(`${baseUrl}/api/properties`);
      expect(res.status).toBe(200);
      const rows = (await res.json()) as PropertyRow[];
      const ids = rows.map((r) => r.id).sort();
      expect(ids).toEqual(["p-clean", "p-legacy"]);
      const legacy = rows.find((r) => r.id === "p-legacy");
      expect(legacy?.paymentMethod).toBe(value);
    },
  );

  // Task #365 — single normalizer at the DB ↔ API boundary. A
  // property row whose `status`, `rentFrequency`, or `paymentMethod`
  // is off-list (e.g. legacy "Pending" status, "Annually" frequency,
  // free-form "Cash" payment label) must not 500 GET /properties.
  // The normalizer coerces it to the canonical default so the rest
  // of the array still round-trips through `ListPropertiesResponse.parse`.
  it.each([
    [
      "off-list status",
      { status: "Pending" as unknown as PropertyRow["status"] },
    ],
    [
      "off-list rentFrequency",
      {
        rentFrequency: "Annually" as unknown as PropertyRow["rentFrequency"],
      },
    ],
    [
      "off-list paymentMethod",
      {
        paymentMethod: "Cash" as unknown as PropertyRow["paymentMethod"],
      },
    ],
  ])(
    "GET /properties stays 200 when a row has an %s, alongside clean rows (task #365)",
    async (_label, badShape) => {
      store.set("p-clean", { ...makeCreateBody({ id: "p-clean" }) });
      store.set("p-bad", { ...makeCreateBody({ id: "p-bad" }), ...badShape });

      const res = await fetch(`${baseUrl}/api/properties`);
      expect(res.status).toBe(200);
      const rows = (await res.json()) as PropertyRow[];
      expect(rows.map((r) => r.id).sort()).toEqual(["p-bad", "p-clean"]);
      const bad = rows.find((r) => r.id === "p-bad")!;
      expect(["Active", "Inactive"]).toContain(bad.status);
      if (bad.rentFrequency !== undefined) {
        expect(["Weekly", "Bi-Weekly", "Monthly"]).toContain(bad.rentFrequency);
      }
      expect([
        "",
        "ACH",
        "Check",
        "Wire",
        "Online Portal",
        "Money Order",
        "Invoice",
      ]).toContain(bad.paymentMethod);
    },
  );
});
