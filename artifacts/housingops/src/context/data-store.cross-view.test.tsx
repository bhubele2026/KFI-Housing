import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { DataProvider, useData } from "./data-store";

// Toast is invoked on errors; we don't care about UI here.
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn(), dismiss: vi.fn(), toasts: [] }),
}));

// ───────────────────────────────────────────────────────────────────────
// What we're proving
//
// The Property Detail "Leases" tab and the global /leases page both render
// off the same `useData()` context. The shared LeasesTable component is
// drilled with the same `leases` array from the store, so any mutation
// (update, add, delete) on one surface MUST be visible on the other on the
// very next render — there is no separate per-view cache.
//
// We mount two consumer components inside ONE DataProvider, simulating two
// open views, and assert that mutations performed via one consumer are
// observed by the other.
// ───────────────────────────────────────────────────────────────────────

type Row = { id: string } & Record<string, unknown>;

interface Backend {
  state: {
    customers: Row[];
    properties: Row[];
    leases: Row[];
    beds: Row[];
    occupants: Row[];
    utilities: Row[];
  };
  fetch: typeof fetch;
}

const ENDPOINTS = ["customers", "properties", "leases", "beds", "occupants", "utilities"] as const;
type EndpointName = (typeof ENDPOINTS)[number];

function makeBackend(): Backend {
  const state: Backend["state"] = {
    customers: [
      { id: "cust-1", name: "Acme Co", contactName: "", email: "", phone: "", notes: "" },
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
    beds: [],
    occupants: [],
    utilities: [],
  };

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    const method = (init?.method ?? "GET").toUpperCase();
    const m = /^\/api\/([^/]+)(?:\/([^/?]+))?/.exec(path);
    if (!m) {
      return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    }
    const endpoint = m[1] as EndpointName;
    const id = m[2];
    if (!ENDPOINTS.includes(endpoint)) {
      return new Response(JSON.stringify({ error: "unknown endpoint" }), { status: 404 });
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
      if (idx === -1) return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
      list[idx] = { ...list[idx], ...body };
      return new Response(JSON.stringify(list[idx]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (method === "DELETE" && id) {
      const idx = list.findIndex((r) => r.id === id);
      if (idx !== -1) list.splice(idx, 1);
      return new Response(null, { status: 204 });
    }
    return new Response(JSON.stringify({ error: "method not allowed" }), { status: 405 });
  };

  return { state, fetch: vi.fn(fetchImpl) };
}

// Two consumer components that simulate the two surfaces.
// Each renders a div with the lease's status, end date, and rent so the
// test can read them via querySelector.

function PropertyDetailConsumer() {
  const { leases, isLoading } = useData();
  if (isLoading) return <div data-testid="pd-loading">loading</div>;
  // The property-detail Leases tab filters by propertyId.
  const ours = leases.filter((l) => l.propertyId === "prop-1");
  return (
    <div data-testid="pd-view">
      {ours.map((l) => (
        <div key={l.id} data-testid={`pd-lease-${l.id}`}>
          <span data-testid={`pd-lease-${l.id}-status`}>{l.status}</span>
          <span data-testid={`pd-lease-${l.id}-rent`}>{l.monthlyRent}</span>
        </div>
      ))}
      <div data-testid="pd-count">{ours.length}</div>
    </div>
  );
}

function GlobalLeasesConsumer() {
  const { leases, addLease, updateLease, isLoading } = useData();
  if (isLoading) return <div data-testid="gl-loading">loading</div>;
  return (
    <div data-testid="gl-view">
      {leases.map((l) => (
        <div key={l.id} data-testid={`gl-lease-${l.id}`}>
          <span data-testid={`gl-lease-${l.id}-status`}>{l.status}</span>
          <span data-testid={`gl-lease-${l.id}-rent`}>{l.monthlyRent}</span>
        </div>
      ))}
      <div data-testid="gl-count">{leases.length}</div>
      <button
        data-testid="gl-flip-status"
        onClick={() => updateLease("lease-1", { status: "Upcoming" })}
      >
        flip
      </button>
      <button
        data-testid="gl-add"
        onClick={() =>
          addLease({
            id: "lease-2",
            propertyId: "prop-1",
            startDate: "2026-01-01",
            endDate: "2026-12-31",
            monthlyRent: 7777,
            securityDeposit: 7777,
            status: "Upcoming",
            notes: "added from global page",
            clauses: "",
            includedItems: [],
            buyoutAvailable: false,
            buyoutCost: null,
          })
        }
      >
        add
      </button>
    </div>
  );
}

function mount(container: HTMLDivElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRoot(container);
  root.render(
    <QueryClientProvider client={client}>
      <DataProvider>
        <PropertyDetailConsumer />
        <GlobalLeasesConsumer />
      </DataProvider>
    </QueryClientProvider>,
  );
  return { root, client };
}

async function waitFor(check: () => boolean, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (check()) return;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
  throw new Error("Timed out waiting for condition");
}

function text(container: HTMLElement, testid: string): string {
  const el = container.querySelector(`[data-testid="${testid}"]`);
  if (!el) throw new Error(`Missing element ${testid}`);
  return el.textContent ?? "";
}

function click(container: HTMLElement, testid: string) {
  const el = container.querySelector(`[data-testid="${testid}"]`) as HTMLButtonElement | null;
  if (!el) throw new Error(`Missing button ${testid}`);
  el.click();
}

describe("cross-view consistency: property detail + global leases share one store", () => {
  let container: HTMLDivElement;
  let mounted: { root: Root; client: QueryClient } | null = null;
  let backend: Backend;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    backend = makeBackend();
    originalFetch = globalThis.fetch;
    globalThis.fetch = backend.fetch;
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(async () => {
    if (mounted) {
      const r = mounted.root;
      await act(async () => {
        r.unmount();
      });
      mounted = null;
    }
    container.remove();
    globalThis.fetch = originalFetch;
  });

  it("a status change made on the global view shows up on the property detail view", async () => {
    await act(async () => {
      mounted = mount(container);
    });

    // Wait for both consumers to load.
    await waitFor(() => container.querySelector('[data-testid="gl-view"]') !== null);
    await waitFor(() => container.querySelector('[data-testid="pd-view"]') !== null);

    expect(text(container, "pd-lease-lease-1-status")).toBe("Active");
    expect(text(container, "gl-lease-lease-1-status")).toBe("Active");

    // Flip via the global view.
    await act(async () => {
      click(container, "gl-flip-status");
    });

    // Both views update on the next render — same store, same lease array.
    await waitFor(
      () => text(container, "gl-lease-lease-1-status") === "Upcoming",
    );
    expect(text(container, "pd-lease-lease-1-status")).toBe("Upcoming");
  });

  it("a lease added on the global view shows up on the property detail view", async () => {
    await act(async () => {
      mounted = mount(container);
    });

    await waitFor(() => container.querySelector('[data-testid="gl-view"]') !== null);
    await waitFor(() => container.querySelector('[data-testid="pd-view"]') !== null);

    expect(text(container, "gl-count")).toBe("1");
    expect(text(container, "pd-count")).toBe("1");

    await act(async () => {
      click(container, "gl-add");
    });

    await waitFor(() => text(container, "gl-count") === "2");
    expect(text(container, "pd-count")).toBe("2");
    expect(text(container, "pd-lease-lease-2-rent")).toBe("7777");
  });
});
