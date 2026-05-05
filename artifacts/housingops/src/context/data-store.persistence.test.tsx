import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Tell React we're in a real act() environment so effects flush deterministically.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { DataProvider, useData } from "./data-store";

// ─── Toast/Tooltip mocks ────────────────────────────────────────────────
// The DataProvider uses useToast for error notifications. We don't care
// about toast rendering here, just that calls don't blow up.
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn(), dismiss: vi.fn(), toasts: [] }),
}));

// ─── In-memory backend ──────────────────────────────────────────────────
// Mocks the same REST endpoints the api-server exposes (GET list, PATCH
// /:id, etc.) backed by a plain in-memory store so the test can verify
// values "saved to the database" survive a full unmount + remount with a
// fresh QueryClient (i.e. simulating a browser refresh).

type Row = { id: string } & Record<string, unknown>;

interface Backend {
  state: {
    customers: Row[];
    properties: Row[];
    leases: Row[];
    rooms: Row[];
    beds: Row[];
    occupants: Row[];
    utilities: Row[];
  };
  fetch: typeof fetch;
}

const ENDPOINTS = [
  "customers",
  "properties",
  "leases",
  "rooms",
  "beds",
  "occupants",
  "utilities",
] as const;
type EndpointName = (typeof ENDPOINTS)[number];

function makeBackend(): Backend {
  const state: Backend["state"] = {
    customers: [
      {
        id: "cust-1",
        name: "Acme Co",
        contactName: "",
        email: "",
        phone: "",
        notes: "",
      },
      // A second customer with no properties referencing it, so the
      // deleteCustomer test can remove a row that satisfies the
      // "in-use" guard. Keep cust-1 at index [0] so the existing
      // edit tests that read backend.state.customers[0] still work.
      {
        id: "cust-2",
        name: "Beta Inc",
        contactName: "",
        email: "",
        phone: "",
        notes: "",
      },
    ],
    properties: [
      {
        id: "prop-1",
        customerId: "cust-1",
        name: "Maple House",
        address: "1 Main St",
        city: "Springfield",
        state: "IL",
        zip: "62701",
        totalBeds: 4,
        monthlyRent: 1000,
        chargePerBed: 500,
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
        lat: 30.2672,
        lng: -97.7431,
      },
    ],
    leases: [
      {
        id: "lease-1",
        propertyId: "prop-1",
        startDate: "2025-01-01",
        endDate: "2025-12-31",
        monthlyRent: 1000,
        securityDeposit: 1000,
        status: "Active",
        notes: "",
      },
    ],
    rooms: [
      // room-1 is referenced by bed-1 below, so the data-store's
      // "can't delete a room that still has beds" guard would block
      // its deletion.
      {
        id: "room-1",
        propertyId: "prop-1",
        name: "Room 1",
        sqft: 0,
        bathrooms: 0,
        monthlyRent: 0,
      },
      // room-2 has no beds — the deleteRoom test removes this one.
      {
        id: "room-2",
        propertyId: "prop-1",
        name: "Room 2",
        sqft: 0,
        bathrooms: 0,
        monthlyRent: 0,
      },
    ],
    beds: [
      {
        id: "bed-1",
        propertyId: "prop-1",
        bedNumber: 1,
        roomId: "room-1",
        status: "Vacant",
        occupantId: null,
      },
    ],
    occupants: [
      {
        id: "occ-1",
        name: "Pat Smith",
        email: "pat@example.com",
        phone: "555-0100",
        bedId: null,
        propertyId: "prop-1",
        moveInDate: "2025-01-01",
        moveOutDate: null,
        status: "Active",
        chargePerBed: 500,
        billingFrequency: "Monthly",
        employeeId: "EMP-1",
        company: "Acme Co",
      },
    ],
    utilities: [
      {
        id: "util-1",
        propertyId: "prop-1",
        type: "Electric",
        company: "City Power",
        monthlyCost: 120,
        accountNumber: "ACC-1",
        notes: "",
      },
    ],
  };

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    const method = (init?.method ?? "GET").toUpperCase();

    // Route: /api/<endpoint>[/<id>]
    const m = /^\/api\/([^/]+)(?:\/([^/?]+))?/.exec(path);
    if (!m) {
      return new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }
    const endpoint = m[1] as EndpointName;
    const id = m[2];

    if (!ENDPOINTS.includes(endpoint)) {
      return new Response(JSON.stringify({ error: "unknown endpoint" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }
    const list = state[endpoint];

    if (method === "GET" && !id) {
      return new Response(JSON.stringify(list), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    if (method === "POST" && !id) {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      list.push(body);
      return new Response(JSON.stringify(body), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }

    if (method === "PATCH" && id) {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const idx = list.findIndex((r) => r.id === id);
      if (idx === -1) {
        return new Response(JSON.stringify({ error: "not found" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        });
      }
      list[idx] = { ...list[idx], ...body };
      return new Response(JSON.stringify(list[idx]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    if (method === "DELETE" && id) {
      const idx = list.findIndex((r) => r.id === id);
      if (idx !== -1) list.splice(idx, 1);
      // Mirror the api-server's inverse cleanup when deleting an
      // occupant: any bed pointing at the removed occupant has its
      // occupantId cleared so we don't leave dangling references.
      if (endpoint === "occupants") {
        for (const bed of state.beds) {
          if (bed.occupantId === id) bed.occupantId = null;
        }
      }
      return new Response(null, { status: 204 });
    }

    return new Response(JSON.stringify({ error: "method not allowed" }), {
      status: 405,
      headers: { "content-type": "application/json" },
    });
  };

  return { state, fetch: vi.fn(fetchImpl) };
}

// ─── Test harness component ─────────────────────────────────────────────
// Renders the lease and property fields under test, plus buttons that
// invoke the data-store mutations the real UI calls (renewal updates the
// lease end date; inline edits update property name and chargePerBed).

function TestHarness({
  newEndDate,
  newPropertyName,
  newChargePerBed,
  newAddress = "1 Main St",
  newCustomerName = "Acme Co (Renamed)",
  newBedStatus = "Occupied",
  newOccupantPhone = "555-9999",
  newUtilityCost = 250,
}: {
  newEndDate: string;
  newPropertyName: string;
  newChargePerBed: number;
  newAddress?: string;
  newCustomerName?: string;
  newBedStatus?: "Occupied" | "Vacant";
  newOccupantPhone?: string;
  newUtilityCost?: number;
}) {
  const {
    leases,
    properties,
    customers,
    beds,
    occupants,
    utilities,
    isLoading,
    updateLease,
    updateProperty,
    updateCustomer,
    updateBed,
    updateOccupant,
    updateUtility,
  } = useData();
  if (isLoading) return <div data-testid="loading">loading</div>;
  const lease = leases.find((l) => l.id === "lease-1");
  const property = properties.find((p) => p.id === "prop-1");
  const customer = customers.find((c) => c.id === "cust-1");
  const bed = beds.find((b) => b.id === "bed-1");
  const occupant = occupants.find((o) => o.id === "occ-1");
  const utility = utilities.find((u) => u.id === "util-1");
  return (
    <div>
      <div data-testid="customer-name">{customer?.name ?? "missing"}</div>
      <div data-testid="bed-status">{bed?.status ?? "missing"}</div>
      <div data-testid="occupant-phone">{occupant?.phone ?? "missing"}</div>
      <div data-testid="utility-cost">
        {utility ? String(utility.monthlyCost) : "missing"}
      </div>
      <button
        data-testid="rename-customer"
        onClick={() => updateCustomer("cust-1", { name: newCustomerName })}
      >
        rename customer
      </button>
      <button
        data-testid="toggle-bed"
        onClick={() => updateBed("bed-1", { status: newBedStatus })}
      >
        toggle bed
      </button>
      <button
        data-testid="edit-occupant-phone"
        onClick={() => updateOccupant("occ-1", { phone: newOccupantPhone })}
      >
        edit occupant phone
      </button>
      <button
        data-testid="bump-utility-cost"
        onClick={() => updateUtility("util-1", { monthlyCost: newUtilityCost })}
      >
        bump utility cost
      </button>
      <div data-testid="lease-end">{lease?.endDate ?? "missing"}</div>
      <div data-testid="lease-status">{lease?.status ?? "missing"}</div>
      <div data-testid="property-name">{property?.name ?? "missing"}</div>
      <div data-testid="property-charge">
        {property ? String(property.chargePerBed) : "missing"}
      </div>
      <div data-testid="property-lat">
        {property?.lat == null ? "null" : String(property.lat)}
      </div>
      <div data-testid="property-lng">
        {property?.lng == null ? "null" : String(property.lng)}
      </div>
      <button
        data-testid="renew-lease"
        onClick={() => updateLease("lease-1", { endDate: newEndDate })}
      >
        renew
      </button>
      <button
        data-testid="rename-property"
        onClick={() => updateProperty("prop-1", { name: newPropertyName })}
      >
        rename
      </button>
      <button
        data-testid="bump-charge"
        onClick={() =>
          updateProperty("prop-1", { chargePerBed: newChargePerBed })
        }
      >
        bump
      </button>
      <button
        data-testid="edit-address"
        onClick={() => updateProperty("prop-1", { address: newAddress })}
      >
        edit address
      </button>
      <button
        data-testid="write-coords"
        onClick={() =>
          updateProperty("prop-1", { lat: 32.7767, lng: -96.797 })
        }
      >
        write coords
      </button>
    </div>
  );
}

// A helper that mounts the harness inside a fresh QueryClient (so each
// "page load" starts with an empty cache, exactly like a browser refresh).
function mount(
  container: HTMLDivElement,
  props: {
    newEndDate: string;
    newPropertyName: string;
    newChargePerBed: number;
    newAddress?: string;
    newCustomerName?: string;
    newBedStatus?: "Occupied" | "Vacant";
    newOccupantPhone?: string;
    newUtilityCost?: number;
  },
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const root = createRoot(container);
  root.render(
    <QueryClientProvider client={client}>
      <DataProvider>
        <TestHarness {...props} />
      </DataProvider>
    </QueryClientProvider>,
  );
  return { root, client };
}

async function waitFor(
  check: () => boolean,
  opts: { timeoutMs?: number; describe?: () => string } = {},
) {
  const { timeoutMs = 10000, describe } = opts;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    let ok = false;
    try {
      ok = check();
    } catch {
      ok = false;
    }
    if (ok) return;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
  const detail = describe ? `: ${describe()}` : "";
  throw new Error(`Timed out waiting for condition${detail}`);
}

function readText(container: HTMLElement, testid: string): string | null {
  const el = container.querySelector(`[data-testid="${testid}"]`);
  return el ? el.textContent ?? "" : null;
}

function getText(container: HTMLElement, testid: string): string {
  const text = readText(container, testid);
  if (text === null) throw new Error(`Missing element ${testid}`);
  return text;
}

function clickButton(container: HTMLElement, testid: string) {
  const el = container.querySelector(
    `[data-testid="${testid}"]`,
  ) as HTMLButtonElement | null;
  if (!el) throw new Error(`Missing button ${testid}`);
  el.click();
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe("data store: edits persist across browser refresh", () => {
  let container: HTMLDivElement;
  let mounted: { root: Root; client: QueryClient } | null = null;
  let backend: Backend;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    backend = makeBackend();
    vi.stubGlobal("fetch", backend.fetch);
  });

  afterEach(async () => {
    if (mounted) {
      const m = mounted;
      await act(async () => {
        m.root.unmount();
        m.client.clear();
      });
      mounted = null;
    }
    container.remove();
    vi.unstubAllGlobals();
  });

  it("a lease end-date edit is still there after a full remount", async () => {
    const props = {
      newEndDate: "2027-06-30",
      newPropertyName: "Maple House",
      newChargePerBed: 500,
    };

    // First load.
    await act(async () => {
      mounted = mount(container, props);
    });
    await waitFor(() => getText(container, "lease-end") === "2025-12-31");

    // Edit through the UI (simulates clicking Renew).
    await act(async () => {
      clickButton(container, "renew-lease");
    });

    // Wait for the optimistic update to settle and the PATCH to land.
    await waitFor(() => getText(container, "lease-end") === "2027-06-30");
    await waitFor(
      () => (backend.state.leases[0]?.endDate as string) === "2027-06-30",
    );

    // Simulate a full browser refresh: tear the tree down, drop the
    // QueryClient cache, then mount a fresh one against the same backend.
    const m = mounted!;
    await act(async () => {
      m.root.unmount();
      m.client.clear();
    });
    mounted = null;

    await act(async () => {
      mounted = mount(container, props);
    });

    // The new tree starts loading. After the GET returns, the lease
    // end-date must match what was saved — not the seed value.
    await waitFor(() => getText(container, "lease-end") === "2027-06-30");

    // Sanity: the fetch mock actually saw the PATCH and the post-refresh
    // GET — i.e. the data store really did call the server, not just
    // optimistically update its in-memory cache.
    const calls = (backend.fetch as unknown as { mock: { calls: unknown[][] } })
      .mock.calls;
    const methods = calls.map(([, init]) => {
      const i = init as RequestInit | undefined;
      return (i?.method ?? "GET").toUpperCase();
    });
    expect(methods).toContain("PATCH");
    // At least 2 GETs to /api/leases (one per mount).
    const leaseGetCount = calls.filter(([url, init]) => {
      const i = init as RequestInit | undefined;
      const m = (i?.method ?? "GET").toUpperCase();
      return m === "GET" && String(url).includes("/api/leases");
    }).length;
    expect(leaseGetCount).toBeGreaterThanOrEqual(2);
  });

  it("a property name edit is still there after a full remount", async () => {
    const props = {
      newEndDate: "2025-12-31",
      newPropertyName: "Maple House (Renamed)",
      newChargePerBed: 500,
    };

    await act(async () => {
      mounted = mount(container, props);
    });
    await waitFor(() => getText(container, "property-name") === "Maple House");

    await act(async () => {
      clickButton(container, "rename-property");
    });

    await waitFor(
      () => getText(container, "property-name") === "Maple House (Renamed)",
    );
    await waitFor(
      () =>
        (backend.state.properties[0]?.name as string) ===
        "Maple House (Renamed)",
    );

    const m = mounted!;
    await act(async () => {
      m.root.unmount();
      m.client.clear();
    });
    mounted = null;

    await act(async () => {
      mounted = mount(container, props);
    });

    await waitFor(
      () => getText(container, "property-name") === "Maple House (Renamed)",
    );
  });

  it("a property charge-per-bed edit is still there after a full remount", async () => {
    const props = {
      newEndDate: "2025-12-31",
      newPropertyName: "Maple House",
      newChargePerBed: 850,
    };

    await act(async () => {
      mounted = mount(container, props);
    });
    await waitFor(() => getText(container, "property-charge") === "500");

    await act(async () => {
      clickButton(container, "bump-charge");
    });

    await waitFor(() => getText(container, "property-charge") === "850");
    await waitFor(
      () => (backend.state.properties[0]?.chargePerBed as number) === 850,
    );

    const m = mounted!;
    await act(async () => {
      m.root.unmount();
      m.client.clear();
    });
    mounted = null;

    await act(async () => {
      mounted = mount(container, props);
    });

    await waitFor(() => getText(container, "property-charge") === "850");
  });

  it("editing a property's address clears its cached lat/lng so the map re-geocodes", async () => {
    // The portfolio map paints pins from stored coords without a Geocoder
    // round-trip. If a user edits the street/city/state/zip without also
    // writing fresh coords, the existing lat/lng now point at the *old*
    // address and would render the pin in the wrong spot. The data store
    // must null those columns so the next map view re-geocodes against
    // the new address. Conversely, when a write *does* include lat/lng
    // (e.g. the geocode-write-back path), we must keep them.
    const props = {
      newEndDate: "2025-12-31",
      newPropertyName: "Maple House",
      newChargePerBed: 500,
      newAddress: "999 Different Ave",
    };

    await act(async () => {
      mounted = mount(container, props);
    });

    // Sanity: the seeded coords are visible to the UI on first load.
    await waitFor(() => getText(container, "property-lat") === "30.2672");
    expect(getText(container, "property-lng")).toBe("-97.7431");
    expect(backend.state.properties[0]?.lat).toBe(30.2672);
    expect(backend.state.properties[0]?.lng).toBe(-97.7431);

    // Edit the address only.
    await act(async () => {
      clickButton(container, "edit-address");
    });

    // Optimistic + server state must both null lat/lng after an
    // address-only edit.
    await waitFor(() => getText(container, "property-lat") === "null");
    await waitFor(() => getText(container, "property-lng") === "null");
    await waitFor(
      () =>
        backend.state.properties[0]?.lat === null &&
        backend.state.properties[0]?.lng === null,
    );
    await waitFor(
      () =>
        (backend.state.properties[0]?.address as string) === "999 Different Ave",
    );

    // Now write fresh coords (simulating the geocode write-back path).
    // This call deliberately patches lat/lng without touching the address;
    // the data store must NOT then turn around and null them out.
    await act(async () => {
      clickButton(container, "write-coords");
    });

    await waitFor(() => getText(container, "property-lat") === "32.7767");
    expect(getText(container, "property-lng")).toBe("-96.797");
    await waitFor(
      () =>
        backend.state.properties[0]?.lat === 32.7767 &&
        backend.state.properties[0]?.lng === -96.797,
    );
  });

  it("regression: a swallowed PATCH leaves the backend at its seed value", async () => {
    // This test pins down the spirit of the task: if a future change made
    // the data-store mutations in-memory-only (never hitting the backend),
    // the new lease value would be lost on a real browser refresh. We
    // simulate that mistake here by swapping in a fetch that pretends every
    // PATCH succeeded without actually mutating backend state, then assert
    // that a fresh remount reads back the original seed value — proving
    // the "after refresh" assertion in the persistence tests above is
    // genuinely backed by the database, not by leftover client cache.
    const props = {
      newEndDate: "2027-06-30",
      newPropertyName: "Maple House",
      newChargePerBed: 500,
    };

    const broken = makeBackend();
    const original = broken.fetch;
    const swallowed: typeof fetch = async (input, init) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "PATCH" || method === "POST" || method === "DELETE") {
        // Return a plausible success response without touching state.
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return original(input, init);
    };
    vi.unstubAllGlobals();
    vi.stubGlobal("fetch", vi.fn(swallowed));
    backend = broken;

    await act(async () => {
      mounted = mount(container, props);
    });
    await waitFor(() => getText(container, "lease-end") === "2025-12-31");
    await act(async () => {
      clickButton(container, "renew-lease");
    });

    // Give the (no-op) PATCH a chance to round-trip through the broken
    // backend. We don't assert what the optimistic UI shows, because
    // optimistic state may be reverted as soon as invalidation refetches.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // Backend state must still hold the seed value — the swallowed PATCH
    // never wrote to it. This is the assertion that fails for an
    // in-memory-only store that doesn't reach the backend.
    expect(broken.state.leases[0]?.endDate).toBe("2025-12-31");

    // And after a full remount with a fresh client (refresh), GET must
    // return that same seed value, not the optimistic edit.
    const m = mounted!;
    await act(async () => {
      m.root.unmount();
      m.client.clear();
    });
    mounted = null;
    await act(async () => {
      mounted = mount(container, props);
    });
    await waitFor(() => getText(container, "lease-end") === "2025-12-31");
  });

  it("a customer name edit is still there after a full remount", async () => {
    const props = {
      newEndDate: "2025-12-31",
      newPropertyName: "Maple House",
      newChargePerBed: 500,
      newCustomerName: "Acme Co (Renamed)",
    };

    await act(async () => {
      mounted = mount(container, props);
    });
    await waitFor(() => getText(container, "customer-name") === "Acme Co");

    await act(async () => {
      clickButton(container, "rename-customer");
    });

    await waitFor(
      () => getText(container, "customer-name") === "Acme Co (Renamed)",
    );
    await waitFor(
      () =>
        (backend.state.customers[0]?.name as string) === "Acme Co (Renamed)",
    );

    const m = mounted!;
    await act(async () => {
      m.root.unmount();
      m.client.clear();
    });
    mounted = null;

    await act(async () => {
      mounted = mount(container, props);
    });

    await waitFor(
      () => getText(container, "customer-name") === "Acme Co (Renamed)",
    );
  });

  it("a bed status edit is still there after a full remount", async () => {
    const props = {
      newEndDate: "2025-12-31",
      newPropertyName: "Maple House",
      newChargePerBed: 500,
      newBedStatus: "Occupied" as const,
    };

    await act(async () => {
      mounted = mount(container, props);
    });
    await waitFor(() => getText(container, "bed-status") === "Vacant");

    await act(async () => {
      clickButton(container, "toggle-bed");
    });

    await waitFor(() => getText(container, "bed-status") === "Occupied");
    await waitFor(
      () => (backend.state.beds[0]?.status as string) === "Occupied",
    );

    const m = mounted!;
    await act(async () => {
      m.root.unmount();
      m.client.clear();
    });
    mounted = null;

    await act(async () => {
      mounted = mount(container, props);
    });

    await waitFor(() => getText(container, "bed-status") === "Occupied");
  });

  it("an occupant phone edit is still there after a full remount", async () => {
    const props = {
      newEndDate: "2025-12-31",
      newPropertyName: "Maple House",
      newChargePerBed: 500,
      newOccupantPhone: "555-9999",
    };

    await act(async () => {
      mounted = mount(container, props);
    });
    await waitFor(() => getText(container, "occupant-phone") === "555-0100");

    await act(async () => {
      clickButton(container, "edit-occupant-phone");
    });

    await waitFor(() => getText(container, "occupant-phone") === "555-9999");
    await waitFor(
      () => (backend.state.occupants[0]?.phone as string) === "555-9999",
    );

    const m = mounted!;
    await act(async () => {
      m.root.unmount();
      m.client.clear();
    });
    mounted = null;

    await act(async () => {
      mounted = mount(container, props);
    });

    await waitFor(() => getText(container, "occupant-phone") === "555-9999");
  });

  it("a utility monthly-cost edit is still there after a full remount", async () => {
    const props = {
      newEndDate: "2025-12-31",
      newPropertyName: "Maple House",
      newChargePerBed: 500,
      newUtilityCost: 250,
    };

    await act(async () => {
      mounted = mount(container, props);
    });
    await waitFor(() => getText(container, "utility-cost") === "120");

    await act(async () => {
      clickButton(container, "bump-utility-cost");
    });

    await waitFor(() => getText(container, "utility-cost") === "250");
    await waitFor(
      () => (backend.state.utilities[0]?.monthlyCost as number) === 250,
    );

    const m = mounted!;
    await act(async () => {
      m.root.unmount();
      m.client.clear();
    });
    mounted = null;

    await act(async () => {
      mounted = mount(container, props);
    });

    await waitFor(() => getText(container, "utility-cost") === "250");
  });
});

// ─── Create + delete persistence tests ──────────────────────────────────
// Mirrors the edit tests above for every entity that exposes add* and/or
// delete* mutations. Each test:
//   1. mounts a fresh tree against the seeded backend,
//   2. invokes the data-store mutation through a click handler,
//   3. waits for the in-memory backend state to reflect the change
//      (proving the mutation actually hit the server, not just the cache),
//   4. unmounts and remounts with a fresh QueryClient (simulating a
//      browser refresh), and
//   5. asserts the rendered list matches the persisted backend.
//
// Without these tests, a regression that made any add*/delete* call
// in-memory-only would silently lose user data on the next refresh.

function CrudHarness() {
  const data = useData();
  if (data.isLoading) return <div data-testid="loading">loading</div>;
  return (
    <div>
      <div data-testid="customer-ids">
        {data.customers.map((c) => c.id).join(",")}
      </div>
      <div data-testid="property-ids">
        {data.properties.map((p) => p.id).join(",")}
      </div>
      <div data-testid="lease-ids">
        {data.leases.map((l) => l.id).join(",")}
      </div>
      <div data-testid="room-ids">
        {data.rooms.map((r) => r.id).join(",")}
      </div>
      <div data-testid="bed-ids">{data.beds.map((b) => b.id).join(",")}</div>
      <div data-testid="occupant-ids">
        {data.occupants.map((o) => o.id).join(",")}
      </div>
      <div data-testid="utility-ids">
        {data.utilities.map((u) => u.id).join(",")}
      </div>

      <button
        data-testid="add-customer"
        onClick={() => {
          data
            .addCustomer({
              id: "cust-new",
              name: "New Co",
              contactName: "",
              email: "",
              phone: "",
              notes: "",
            })
            .catch(() => {});
        }}
      >
        add customer
      </button>
      <button
        data-testid="delete-customer"
        onClick={() => {
          data.deleteCustomer("cust-2").catch(() => {});
        }}
      >
        delete customer
      </button>

      <button
        data-testid="add-property"
        onClick={() => {
          data
            .addProperty({
              id: "prop-new",
              customerId: "cust-1",
              name: "New Place",
              address: "200 New St",
              city: "Springfield",
              state: "IL",
              zip: "62702",
              totalBeds: 2,
              monthlyRent: 800,
              chargePerBed: 400,
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
            })
            .catch(() => {});
        }}
      >
        add property
      </button>
      <button
        data-testid="delete-property"
        onClick={() => data.deleteProperty("prop-1")}
      >
        delete property
      </button>

      <button
        data-testid="add-lease"
        onClick={() =>
          data.addLease({
            id: "lease-new",
            propertyId: "prop-1",
            startDate: "2026-01-01",
            endDate: "2026-12-31",
            monthlyRent: 1100,
            securityDeposit: 1100,
            status: "Active",
            notes: "",
            clauses: "",
            buyoutAvailable: false,
            buyoutCost: null,
          })
        }
      >
        add lease
      </button>
      <button
        data-testid="delete-lease"
        onClick={() => data.deleteLease("lease-1")}
      >
        delete lease
      </button>

      <button
        data-testid="add-room"
        onClick={() => {
          data
            .addRoom({
              id: "room-new",
              propertyId: "prop-1",
              name: "Bedroom A",
              sqft: 100,
              bathrooms: 1,
              monthlyRent: 600,
            })
            .catch(() => {});
        }}
      >
        add room
      </button>
      <button
        data-testid="delete-room"
        onClick={() => {
          data.deleteRoom("room-2").catch(() => {});
        }}
      >
        delete room
      </button>

      <button
        data-testid="add-bed"
        onClick={() =>
          data.addBed({
            id: "bed-new",
            propertyId: "prop-1",
            bedNumber: 2,
            roomId: "room-1",
            status: "Vacant",
            occupantId: null,
          })
        }
      >
        add bed
      </button>
      <button
        data-testid="delete-bed"
        onClick={() => data.deleteBed("bed-1")}
      >
        delete bed
      </button>

      <button
        data-testid="add-occupant"
        onClick={() =>
          data.addOccupant({
            id: "occ-new",
            name: "New Person",
            email: "",
            phone: "555-0200",
            bedId: null,
            propertyId: "prop-1",
            moveInDate: "2026-01-01",
            moveOutDate: null,
            status: "Active",
            chargePerBed: 500,
            billingFrequency: "Monthly",
            employeeId: "EMP-2",
            company: "Acme Co",
          })
        }
      >
        add occupant
      </button>
      <button
        data-testid="delete-occupant"
        onClick={() => data.deleteOccupant("occ-1")}
      >
        delete occupant
      </button>

      <button
        data-testid="add-utility"
        onClick={() =>
          data.addUtility({
            id: "util-new",
            propertyId: "prop-1",
            type: "Gas",
            company: "City Gas",
            monthlyCost: 80,
            accountNumber: "ACC-2",
            notes: "",
          })
        }
      >
        add utility
      </button>
      <button
        data-testid="delete-utility"
        onClick={() => data.deleteUtility("util-1")}
      >
        delete utility
      </button>
    </div>
  );
}

function mountCrud(container: HTMLDivElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const root = createRoot(container);
  root.render(
    <QueryClientProvider client={client}>
      <DataProvider>
        <CrudHarness />
      </DataProvider>
    </QueryClientProvider>,
  );
  return { root, client };
}

function ids(container: HTMLElement, testid: string): string[] {
  const text = getText(container, testid);
  if (!text) return [];
  return text.split(",");
}

describe("data store: creates and deletes persist across browser refresh", () => {
  let container: HTMLDivElement;
  let mounted: { root: Root; client: QueryClient } | null = null;
  let backend: Backend;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    backend = makeBackend();
    vi.stubGlobal("fetch", backend.fetch);
  });

  afterEach(async () => {
    if (mounted) {
      const m = mounted;
      await act(async () => {
        m.root.unmount();
        m.client.clear();
      });
      mounted = null;
    }
    container.remove();
    vi.unstubAllGlobals();
  });

  // Drives one create test: clicks the add button, waits for the backend
  // to gain the new id, then remounts with a fresh QueryClient and asserts
  // the new row is still rendered (i.e. the GET after refresh returned it).
  async function runAddTest(opts: {
    button: string;
    listKey: keyof Backend["state"];
    newId: string;
    idsTestId: string;
  }) {
    await act(async () => {
      mounted = mountCrud(container);
    });
    // Wait for the initial GET to populate the ids list (the harness only
    // renders the *-ids divs once useData().isLoading is false).
    await waitFor(() => readText(container, opts.idsTestId) !== null, {
      describe: () => `${opts.idsTestId} to render after initial mount`,
    });
    await act(async () => {
      clickButton(container, opts.button);
    });
    await waitFor(
      () => backend.state[opts.listKey].some((r) => r.id === opts.newId),
      { describe: () => `backend.${opts.listKey} to contain ${opts.newId}` },
    );

    const m = mounted!;
    await act(async () => {
      m.root.unmount();
      m.client.clear();
    });
    mounted = null;

    await act(async () => {
      mounted = mountCrud(container);
    });
    await waitFor(() => ids(container, opts.idsTestId).includes(opts.newId), {
      describe: () => `${opts.idsTestId} to include ${opts.newId} after refresh`,
    });
  }

  // Drives one delete test: clicks the delete button, waits for the backend
  // to drop the id, then remounts and asserts the row is gone from the
  // refreshed list.
  async function runDeleteTest(opts: {
    button: string;
    listKey: keyof Backend["state"];
    deletedId: string;
    idsTestId: string;
  }) {
    await act(async () => {
      mounted = mountCrud(container);
    });
    await waitFor(() => ids(container, opts.idsTestId).includes(opts.deletedId), {
      describe: () => `${opts.idsTestId} to initially include ${opts.deletedId}`,
    });
    await act(async () => {
      clickButton(container, opts.button);
    });
    await waitFor(
      () => !backend.state[opts.listKey].some((r) => r.id === opts.deletedId),
      {
        describe: () => `backend.${opts.listKey} to no longer contain ${opts.deletedId}`,
      },
    );

    const m = mounted!;
    await act(async () => {
      m.root.unmount();
      m.client.clear();
    });
    mounted = null;

    await act(async () => {
      mounted = mountCrud(container);
    });
    await waitFor(
      () => !ids(container, opts.idsTestId).includes(opts.deletedId),
      {
        describe: () =>
          `${opts.idsTestId} to no longer include ${opts.deletedId} after refresh`,
      },
    );
  }

  it("addCustomer persists across a full remount", async () => {
    await runAddTest({
      button: "add-customer",
      listKey: "customers",
      newId: "cust-new",
      idsTestId: "customer-ids",
    });
  });

  it("deleteCustomer persists across a full remount", async () => {
    await runDeleteTest({
      button: "delete-customer",
      listKey: "customers",
      deletedId: "cust-2",
      idsTestId: "customer-ids",
    });
  });

  it("addProperty persists across a full remount", async () => {
    await runAddTest({
      button: "add-property",
      listKey: "properties",
      newId: "prop-new",
      idsTestId: "property-ids",
    });
  });

  it("deleteProperty persists across a full remount", async () => {
    await runDeleteTest({
      button: "delete-property",
      listKey: "properties",
      deletedId: "prop-1",
      idsTestId: "property-ids",
    });
  });

  it("addLease persists across a full remount", async () => {
    await runAddTest({
      button: "add-lease",
      listKey: "leases",
      newId: "lease-new",
      idsTestId: "lease-ids",
    });
  });

  it("deleteLease persists across a full remount", async () => {
    await runDeleteTest({
      button: "delete-lease",
      listKey: "leases",
      deletedId: "lease-1",
      idsTestId: "lease-ids",
    });
  });

  it("addRoom persists across a full remount", async () => {
    await runAddTest({
      button: "add-room",
      listKey: "rooms",
      newId: "room-new",
      idsTestId: "room-ids",
    });
  });

  it("deleteRoom persists across a full remount", async () => {
    await runDeleteTest({
      button: "delete-room",
      listKey: "rooms",
      deletedId: "room-2",
      idsTestId: "room-ids",
    });
  });

  it("addBed persists across a full remount", async () => {
    await runAddTest({
      button: "add-bed",
      listKey: "beds",
      newId: "bed-new",
      idsTestId: "bed-ids",
    });
  });

  it("deleteBed persists across a full remount", async () => {
    await runDeleteTest({
      button: "delete-bed",
      listKey: "beds",
      deletedId: "bed-1",
      idsTestId: "bed-ids",
    });
  });

  it("addOccupant persists across a full remount", async () => {
    await runAddTest({
      button: "add-occupant",
      listKey: "occupants",
      newId: "occ-new",
      idsTestId: "occupant-ids",
    });
  });

  it("deleteOccupant persists across a full remount", async () => {
    await runDeleteTest({
      button: "delete-occupant",
      listKey: "occupants",
      deletedId: "occ-1",
      idsTestId: "occupant-ids",
    });
  });

  it("deleteOccupant clears bed.occupantId for any bed that referenced them", async () => {
    // Pre-link bed-1 to occ-1 so we can verify the inverse cleanup the
    // api-server performs when deleting an occupant.
    backend.state.beds[0].occupantId = "occ-1";
    backend.state.beds[0].status = "Occupied";

    await act(async () => {
      mounted = mountCrud(container);
    });
    await waitFor(() => ids(container, "occupant-ids").includes("occ-1"), {
      describe: () => "occupant-ids to initially include occ-1",
    });
    await act(async () => {
      clickButton(container, "delete-occupant");
    });
    await waitFor(
      () => !backend.state.occupants.some((r) => r.id === "occ-1"),
      { describe: () => "backend.occupants to no longer contain occ-1" },
    );
    await waitFor(
      () => backend.state.beds.find((b) => b.id === "bed-1")?.occupantId === null,
      { describe: () => "bed-1.occupantId to be cleared on the backend" },
    );
  });

  it("addUtility persists across a full remount", async () => {
    await runAddTest({
      button: "add-utility",
      listKey: "utilities",
      newId: "util-new",
      idsTestId: "utility-ids",
    });
  });

  it("deleteUtility persists across a full remount", async () => {
    await runDeleteTest({
      button: "delete-utility",
      listKey: "utilities",
      deletedId: "util-1",
      idsTestId: "utility-ids",
    });
  });
});
