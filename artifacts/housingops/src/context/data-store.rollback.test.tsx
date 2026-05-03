import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Tell React we're in a real act() environment so effects flush deterministically.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { DataProvider, useData } from "./data-store";

// We don't care about toast rendering here — just that the calls don't blow up.
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn(), dismiss: vi.fn(), toasts: [] }),
}));

// ─── In-memory backend with switchable failure modes ────────────────────
// Same shape as the persistence test's backend, plus a `fail` flag the test
// flips to make the next PATCH/DELETE return a 500. That's the trigger for
// the captureRollback handler to restore the snapshot it took before the
// optimistic patch.

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
  // When true, any non-GET request returns 500 without mutating state.
  fail: { value: boolean };
  // When true, any GET request returns 500 (without changing state). Used
  // by the rollback tests to prove the cache was reverted by the snapshot
  // restore in onError — not by an onSettled-driven refetch repopulating
  // from the server. (A failed refetch leaves the cache at whatever value
  // it held, so a reverted UI can only be the work of the snapshot restore.)
  failGets: { value: boolean };
  // Counts of completed (non-hanging) responses, by method. Lets tests
  // assert no GET ever completed during the rollback window.
  completed: { GET: number; PATCH: number; POST: number; DELETE: number };
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
      {
        id: "prop-2",
        customerId: "cust-1",
        name: "Oak Cottage",
        address: "2 Oak Ave",
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
      },
    ],
    leases: [],
    rooms: [],
    beds: [],
    occupants: [],
    utilities: [],
  };
  const fail = { value: false };
  const failGets = { value: false };
  const completed = { GET: 0, PATCH: 0, POST: 0, DELETE: 0 };

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    const method = (init?.method ?? "GET").toUpperCase();
    const m = /^\/api\/([^/]+)(?:\/([^/?]+))?/.exec(path);
    if (!m) {
      return new Response(JSON.stringify({ error: "not found" }), {
        status: 404, headers: { "content-type": "application/json" },
      });
    }
    const endpoint = m[1] as EndpointName;
    const id = m[2];
    if (!ENDPOINTS.includes(endpoint)) {
      return new Response(JSON.stringify({ error: "unknown endpoint" }), {
        status: 404, headers: { "content-type": "application/json" },
      });
    }
    const list = state[endpoint];

    const finish = (resp: Response, key: keyof typeof completed) => {
      completed[key] += 1;
      return resp;
    };

    if (method === "GET" && !id) {
      // Failing GETs (used by rollback tests) leave the cache untouched —
      // a refetch can't repopulate from the server, so the only way the
      // UI can revert to the pre-patch value is via the snapshot restore.
      if (failGets.value) {
        return finish(
          new Response(JSON.stringify({ error: "boom" }), {
            status: 500, headers: { "content-type": "application/json" },
          }),
          "GET",
        );
      }
      return finish(
        new Response(JSON.stringify(list), {
          status: 200, headers: { "content-type": "application/json" },
        }),
        "GET",
      );
    }

    // Simulated server failure: return 500 without touching state. The data
    // store's captureRollback handler should restore the snapshot it took
    // before the optimistic patch.
    if (fail.value && method !== "GET") {
      return finish(
        new Response(JSON.stringify({ error: "boom" }), {
          status: 500, headers: { "content-type": "application/json" },
        }),
        method as "PATCH" | "POST" | "DELETE",
      );
    }

    if (method === "POST" && !id) {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      list.push(body);
      return finish(
        new Response(JSON.stringify(body), {
          status: 201, headers: { "content-type": "application/json" },
        }),
        "POST",
      );
    }
    if (method === "PATCH" && id) {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const idx = list.findIndex((r) => r.id === id);
      if (idx === -1) {
        return new Response(JSON.stringify({ error: "not found" }), {
          status: 404, headers: { "content-type": "application/json" },
        });
      }
      list[idx] = { ...list[idx], ...body };
      return finish(
        new Response(JSON.stringify(list[idx]), {
          status: 200, headers: { "content-type": "application/json" },
        }),
        "PATCH",
      );
    }
    if (method === "DELETE" && id) {
      const idx = list.findIndex((r) => r.id === id);
      if (idx !== -1) list.splice(idx, 1);
      return finish(new Response(null, { status: 204 }), "DELETE");
    }

    return new Response(JSON.stringify({ error: "method not allowed" }), {
      status: 405, headers: { "content-type": "application/json" },
    });
  };

  return { state, fail, failGets, completed, fetch: vi.fn(fetchImpl) };
}

// ─── Test harness component ─────────────────────────────────────────────

function TestHarness() {
  const { properties, isLoading, updateProperty, deleteProperty } = useData();
  if (isLoading) return <div data-testid="loading">loading</div>;
  return (
    <div>
      <div data-testid="property-count">{properties.length}</div>
      {properties.map((p) => (
        <div key={p.id} data-testid={`property-row-${p.id}`}>
          <span data-testid={`property-name-${p.id}`}>{p.name}</span>
        </div>
      ))}
      <button
        data-testid="rename-prop-1"
        onClick={() => updateProperty("prop-1", { name: "Maple House (Renamed)" })}
      >
        rename
      </button>
      <button
        data-testid="delete-prop-2"
        onClick={() => deleteProperty("prop-2")}
      >
        delete
      </button>
    </div>
  );
}

function mount(container: HTMLDivElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const root = createRoot(container);
  root.render(
    <QueryClientProvider client={client}>
      <DataProvider>
        <TestHarness />
      </DataProvider>
    </QueryClientProvider>,
  );
  return { root, client };
}

async function waitFor(check: () => boolean, opts: { timeoutMs?: number } = {}) {
  const { timeoutMs = 5000 } = opts;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    let ok = false;
    try { ok = check(); } catch { ok = false; }
    if (ok) return;
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  }
  throw new Error("Timed out waiting for condition");
}

function getText(container: HTMLElement, testid: string): string {
  const el = container.querySelector(`[data-testid="${testid}"]`);
  if (!el) throw new Error(`Missing element ${testid}`);
  return el.textContent ?? "";
}

function clickButton(container: HTMLElement, testid: string) {
  const el = container.querySelector(`[data-testid="${testid}"]`) as HTMLButtonElement | null;
  if (!el) throw new Error(`Missing button ${testid}`);
  el.click();
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe("data store: optimistic-rollback safety net", () => {
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

  it("update mutation success path: optimistic value remains after the PATCH lands", async () => {
    await act(async () => { mounted = mount(container); });
    await waitFor(() => getText(container, "property-name-prop-1") === "Maple House");

    await act(async () => { clickButton(container, "rename-prop-1"); });

    // Optimistic update is visible immediately and survives the refetch.
    await waitFor(
      () => getText(container, "property-name-prop-1") === "Maple House (Renamed)",
    );
    await waitFor(
      () => (backend.state.properties.find((p) => p.id === "prop-1")?.name as string) ===
        "Maple House (Renamed)",
    );
    // Give onSettled's invalidate-driven refetch time to land and re-assert.
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(getText(container, "property-name-prop-1")).toBe("Maple House (Renamed)");
  });

  it("update mutation failure path: cache is rolled back to the pre-patch snapshot", async () => {
    await act(async () => { mounted = mount(container); });
    await waitFor(() => getText(container, "property-name-prop-1") === "Maple House");

    // Make any post-failure GET refetch return 500 — a failed refetch
    // can't repopulate the cache from the server, so the only thing that
    // can revert the optimistic patch is captureRollback's snapshot
    // restore. A broken rollback (snapshot restore removed, only the
    // onSettled invalidate left) would leave "Renamed" sitting in the
    // cache, and the assertions below would fail.
    backend.fail.value = true;
    backend.failGets.value = true;
    const patchesBefore = backend.completed.PATCH;

    await act(async () => { clickButton(container, "rename-prop-1"); });

    // The failed PATCH must trigger the snapshot restore, reverting the row.
    // Failed GETs can't repopulate the cache from the server, so the only
    // path that can produce the "Maple House" value is captureRollback's
    // snapshot restore.
    await waitFor(() => getText(container, "property-name-prop-1") === "Maple House");

    // Server state untouched (PATCH returned 500 without writing).
    expect(backend.state.properties.find((p) => p.id === "prop-1")?.name).toBe(
      "Maple House",
    );

    // Sanity: the PATCH actually fired and round-tripped (so we really
    // did exercise the failure path, not just observe a no-op).
    expect(backend.completed.PATCH).toBe(patchesBefore + 1);
  });

  it("delete mutation success path: row is removed and stays removed after refetch", async () => {
    await act(async () => { mounted = mount(container); });
    await waitFor(() => getText(container, "property-count") === "2");

    await act(async () => { clickButton(container, "delete-prop-2"); });

    await waitFor(() => getText(container, "property-count") === "1");
    await waitFor(
      () => backend.state.properties.find((p) => p.id === "prop-2") === undefined,
    );
    // After onSettled's refetch, the row is still gone.
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(getText(container, "property-count")).toBe("1");
    expect(container.querySelector('[data-testid="property-row-prop-2"]')).toBeNull();
  });

  it("delete mutation failure path: row reappears via snapshot restore (not refetch)", async () => {
    await act(async () => { mounted = mount(container); });
    await waitFor(() => getText(container, "property-count") === "2");

    // Same isolation trick as the update-failure test: failed GETs can't
    // repopulate the cache, so the only thing that can put the row back
    // after the optimistic remove is captureRollback's snapshot restore.
    backend.fail.value = true;
    backend.failGets.value = true;
    const deletesBefore = backend.completed.DELETE;

    await act(async () => { clickButton(container, "delete-prop-2"); });

    // The failed DELETE must restore the snapshot, putting the row back.
    // The server never deleted it (DELETE returned 500 without writing),
    // and any post-failure refetch also returned 500, so a refetch can't
    // be responsible for the row reappearing.
    await waitFor(() => getText(container, "property-count") === "2");
    expect(backend.state.properties.find((p) => p.id === "prop-2")).toBeDefined();
    expect(container.querySelector('[data-testid="property-row-prop-2"]')).not.toBeNull();
    expect(getText(container, "property-name-prop-2")).toBe("Oak Cottage");

    // Sanity: the DELETE actually fired and round-tripped (so we really
    // did exercise the failure path, not just observe a no-op).
    expect(backend.completed.DELETE).toBe(deletesBefore + 1);
  });
});
