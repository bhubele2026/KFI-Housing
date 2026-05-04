import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PropertyLocationMap } from "./property-location-map";

// These tests pin down the four render branches of the property location
// card — full embed (address + key), graceful fallback (address but no
// key), loading placeholder (config still in flight), and empty state
// (no address) — plus the exact Google Maps URLs the card hands off to.
// A regression in any of these would either break the embed iframe,
// drop the operator's one-click jump to maps, or paint a misleading
// "set up your key" warning over a working map.
//
// The component fetches its Google Maps API key from the api-server's
// `/api/config` endpoint at runtime so the key can be rotated without a
// web rebuild (Task #154). To keep these tests fast and offline, every
// test passes `apiKey` explicitly — the component skips the network
// call when `apiKey` is provided. The dedicated runtime-config branch
// (loading + cached fetch) is exercised separately at the bottom with
// `globalThis.fetch` mocked.

describe("PropertyLocationMap", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(async () => {
    if (root) {
      const r = root;
      await act(async () => {
        r.unmount();
      });
      root = null;
    }
    container.remove();
  });

  function makeWrapper() {
    // Per-test client so cached `/api/config` responses can't bleed
    // across tests. Retries off so a deliberately-failing fetch surfaces
    // immediately instead of being papered over.
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, refetchOnWindowFocus: false, gcTime: 0 },
      },
    });
    function Wrapper({ children }: { children: React.ReactNode }) {
      return (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
    }
    return Wrapper;
  }

  async function render(node: React.ReactElement) {
    const Wrapper = makeWrapper();
    await act(async () => {
      root = createRoot(container);
      root.render(<Wrapper>{node}</Wrapper>);
    });
  }

  function get(testId: string): HTMLElement | null {
    return container.querySelector(
      `[data-testid="${testId}"]`,
    ) as HTMLElement | null;
  }

  it("renders the embedded map, search/directions URLs, and address block when an address and key are present", async () => {
    await render(
      <PropertyLocationMap
        address="100 Oak Way"
        city="Austin"
        state="TX"
        zip="78701"
        apiKey="test-key-abc"
      />,
    );

    const iframe = get("property-location-map-iframe") as HTMLIFrameElement | null;
    expect(iframe).not.toBeNull();
    // Embed URL must include the key and the URL-encoded full address.
    // Spaces become +; commas become %2C in encodeURIComponent.
    const expectedQuery = encodeURIComponent("100 Oak Way, Austin, TX 78701");
    expect(iframe!.src).toContain("https://www.google.com/maps/embed/v1/place");
    expect(iframe!.src).toContain(`key=${encodeURIComponent("test-key-abc")}`);
    expect(iframe!.src).toContain(`q=${expectedQuery}`);

    // The whole map area is wrapped in an anchor that opens the address
    // in a new tab via Google Maps Search.
    const mapLink = get("property-location-map-link") as HTMLAnchorElement | null;
    expect(mapLink).not.toBeNull();
    expect(mapLink!.href).toBe(
      `https://www.google.com/maps/search/?api=1&query=${expectedQuery}`,
    );
    expect(mapLink!.target).toBe("_blank");
    expect(mapLink!.rel).toContain("noopener");

    // Directions affordance opens the same address in directions mode.
    const dir = get("property-location-directions-link") as HTMLAnchorElement | null;
    expect(dir).not.toBeNull();
    expect(dir!.href).toBe(
      `https://www.google.com/maps/dir/?api=1&destination=${expectedQuery}`,
    );
    expect(dir!.target).toBe("_blank");

    // Address block: street on first line, "city, state zip" on second.
    const addr = get("property-location-address");
    expect(addr).not.toBeNull();
    expect(addr!.textContent).toContain("100 Oak Way");
    expect(addr!.textContent).toContain("Austin, TX 78701");

    // The fallback / empty-state / loading surfaces must NOT be visible
    // alongside a working embed — they each represent a different
    // render branch.
    expect(get("property-location-fallback")).toBeNull();
    expect(get("property-location-empty")).toBeNull();
    expect(get("property-location-map-loading")).toBeNull();
  });

  it("falls back to a plain 'Open in Google Maps' link with a setup note when the API key is missing", async () => {
    await render(
      <PropertyLocationMap
        address="200 Maple Dr"
        city="Dallas"
        state="TX"
        zip="75201"
        apiKey=""
      />,
    );

    // No iframe, no map-link anchor, and no loading placeholder — the
    // embed branch is off and the config wasn't fetched at all.
    expect(get("property-location-map-iframe")).toBeNull();
    expect(get("property-location-map-link")).toBeNull();
    expect(get("property-location-map-loading")).toBeNull();

    const fallback = get("property-location-fallback");
    expect(fallback).not.toBeNull();
    // Inline note tells the operator the embed is hidden because no
    // server-side key is configured. The copy is intentionally
    // operator-facing — it must not name the old build-time env var
    // (`VITE_GOOGLE_MAPS_API_KEY`) since rotating that would mislead
    // them now that the key lives on the api-server.
    expect(fallback!.textContent?.toLowerCase()).toContain(
      "google maps api key",
    );
    expect(fallback!.textContent).not.toContain("VITE_GOOGLE_MAPS_API_KEY");

    // Plain link still gives the operator a one-click jump to Google Maps.
    const link = get("property-location-fallback-link") as HTMLAnchorElement | null;
    expect(link).not.toBeNull();
    const expectedQuery = encodeURIComponent("200 Maple Dr, Dallas, TX 75201");
    expect(link!.href).toBe(
      `https://www.google.com/maps/search/?api=1&query=${expectedQuery}`,
    );
    expect(link!.target).toBe("_blank");

    // Address block + Directions link still render even without the embed.
    expect(get("property-location-address")?.textContent).toContain(
      "200 Maple Dr",
    );
    const dir = get("property-location-directions-link") as HTMLAnchorElement | null;
    expect(dir).not.toBeNull();
    expect(dir!.href).toContain("destination=" + expectedQuery);

    // Empty state must NOT be visible — we DO have an address.
    expect(get("property-location-empty")).toBeNull();
  });

  it("treats an explicit `null` apiKey the same as an empty string (server says no key configured)", async () => {
    // The runtime config endpoint returns `googleMapsApiKey: null` when
    // the operator hasn't set the secret. The component normalizes that
    // to the friendly fallback branch, same as `""`.
    await render(
      <PropertyLocationMap
        address="300 Pine St"
        city="Houston"
        state="TX"
        zip="77001"
        apiKey={null}
      />,
    );

    expect(get("property-location-map-iframe")).toBeNull();
    expect(get("property-location-map-loading")).toBeNull();
    expect(get("property-location-fallback")).not.toBeNull();
  });

  it("never leaks a literal 'undefined' into the iframe src when the key is missing", async () => {
    // Defends against a regression anywhere in the key pipeline (the
    // runtime /api/config fetch, the build-time portfolio-map env
    // forwarding, or any future source) that could mis-stringify a
    // missing key as the bare identifier `undefined`. Even then the
    // component must pick the dashed-fallback branch instead of
    // emitting an iframe whose src is literally
    // `…/place?key=undefined&q=…` — which would render a broken Google
    // error tile and look like the embed is "almost working".
    await render(
      <PropertyLocationMap
        address="300 Pine St"
        city="Seattle"
        state="WA"
        zip="98101"
        apiKey=""
      />,
    );

    // No iframe is rendered at all in the fallback branch.
    expect(get("property-location-map-iframe")).toBeNull();
    // And nothing on the rendered page should contain the substring
    // "key=undefined" — that would be the smoking gun for a bad
    // key stringification anywhere upstream of the component.
    expect(container.innerHTML).not.toContain("key=undefined");
  });

  it("renders a friendly empty state instead of a broken/blank map when every address field is empty", async () => {
    await render(
      <PropertyLocationMap
        address=""
        city=""
        state=""
        zip=""
        apiKey="test-key-abc"
      />,
    );

    const empty = get("property-location-empty");
    expect(empty).not.toBeNull();
    expect(empty!.textContent?.toLowerCase()).toContain(
      "add an address",
    );

    // None of the active branches should render alongside the empty state.
    expect(get("property-location-map-iframe")).toBeNull();
    expect(get("property-location-map-link")).toBeNull();
    expect(get("property-location-fallback")).toBeNull();
    expect(get("property-location-map-loading")).toBeNull();
    expect(get("property-location-directions-link")).toBeNull();
    expect(get("property-location-address")).toBeNull();
  });

  it("treats whitespace-only address fields as empty and shows the empty state", async () => {
    // Defends against a regression that .length-checked the raw strings
    // instead of trimming — an operator who typed only spaces would
    // otherwise see a broken iframe pointed at "%20%20%20".
    await render(
      <PropertyLocationMap
        address="   "
        city=" "
        state=""
        zip="  "
        apiKey="test-key-abc"
      />,
    );

    expect(get("property-location-empty")).not.toBeNull();
    expect(get("property-location-map-iframe")).toBeNull();
  });

  it("URL-encodes special characters in the address so the search/embed URLs stay valid", async () => {
    // An address with `&`, `#`, and a unit number — characters that
    // would break the search URL if interpolated raw. encodeURIComponent
    // turns `&`→`%26`, `#`→`%23`, ` `→`%20`, `,`→`%2C`.
    await render(
      <PropertyLocationMap
        address="100 R&D Way #5"
        city="San José"
        state="CA"
        zip="95110"
        apiKey="test-key-abc"
      />,
    );

    const expectedQuery = encodeURIComponent(
      "100 R&D Way #5, San José, CA 95110",
    );
    const link = get("property-location-map-link") as HTMLAnchorElement | null;
    expect(link).not.toBeNull();
    expect(link!.href).toBe(
      `https://www.google.com/maps/search/?api=1&query=${expectedQuery}`,
    );
    // Raw special chars must NOT appear in the URL — only their encoded
    // forms — otherwise the URL would be malformed.
    expect(link!.href).not.toContain(" ");
    expect(link!.href).not.toContain("#");
  });

  it("renders only the parts of the address the user has filled in (street present, city/state/zip blank)", async () => {
    // Partial-address case: street only, no city/state/zip yet. The
    // card should still embed and link with whatever is filled in
    // rather than waiting for a fully-formatted address.
    await render(
      <PropertyLocationMap
        address="500 Elm Rd"
        city=""
        state=""
        zip=""
        apiKey="test-key-abc"
      />,
    );

    const expectedQuery = encodeURIComponent("500 Elm Rd");
    const link = get("property-location-map-link") as HTMLAnchorElement | null;
    expect(link).not.toBeNull();
    expect(link!.href).toBe(
      `https://www.google.com/maps/search/?api=1&query=${expectedQuery}`,
    );

    const addr = get("property-location-address");
    expect(addr).not.toBeNull();
    expect(addr!.textContent).toContain("500 Elm Rd");
    // No empty "," from the missing city/state/zip line.
    expect(addr!.textContent).not.toContain(", ,");
  });
});

// ---------------------------------------------------------------------------
// Runtime-config branch (Task #154): the component fetches the Google Maps
// key from `/api/config` when no `apiKey` prop is provided. These tests
// exercise that flow with a mocked global fetch so we can assert the
// loading placeholder, the eventual embed, and the friendly fallback when
// the server reports no key — all without spinning up a real server.
// ---------------------------------------------------------------------------

describe("PropertyLocationMap runtime config", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    originalFetch = globalThis.fetch;
  });

  afterEach(async () => {
    if (root) {
      const r = root;
      await act(async () => {
        r.unmount();
      });
      root = null;
    }
    container.remove();
    globalThis.fetch = originalFetch;
  });

  function makeWrapper() {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, refetchOnWindowFocus: false, gcTime: 0 },
      },
    });
    function Wrapper({ children }: { children: React.ReactNode }) {
      return (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
    }
    return Wrapper;
  }

  function get(testId: string): HTMLElement | null {
    return container.querySelector(
      `[data-testid="${testId}"]`,
    ) as HTMLElement | null;
  }

  // React Query schedules its observer notifications via `setTimeout`
  // and `queueMicrotask`, so a fixed-count microtask drain is not
  // reliable: the query state can flip *after* we asserted. Instead
  // we poll a predicate, yielding to both microtasks and macrotasks
  // inside `act()` between checks. This mirrors the semantics of
  // `@testing-library/react`'s `waitFor` without taking that
  // dependency on these tests.
  async function waitFor(
    predicate: () => boolean,
    { timeoutMs = 1000, intervalMs = 5 }: { timeoutMs?: number; intervalMs?: number } = {},
  ): Promise<void> {
    const start = Date.now();
    let lastError: unknown = null;
    while (Date.now() - start < timeoutMs) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, intervalMs));
      });
      try {
        if (predicate()) return;
      } catch (err) {
        lastError = err;
      }
    }
    if (lastError) throw lastError;
    throw new Error(
      `waitFor: predicate did not become true within ${timeoutMs}ms`,
    );
  }

  it("shows a neutral loading placeholder while /api/config is in flight, then swaps in the embed once the key arrives", async () => {
    let resolveFetch: ((value: Response) => void) | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const Wrapper = makeWrapper();
    await act(async () => {
      root = createRoot(container);
      root.render(
        <Wrapper>
          <PropertyLocationMap
            address="100 Oak Way"
            city="Austin"
            state="TX"
            zip="78701"
          />
        </Wrapper>,
      );
    });

    // Loading state: neutral placeholder, no scary "set up your key"
    // copy, and crucially no iframe yet (the key is unknown).
    expect(get("property-location-map-loading")).not.toBeNull();
    expect(get("property-location-map-iframe")).toBeNull();
    expect(get("property-location-fallback")).toBeNull();

    // The component must have hit the runtime config endpoint exactly
    // once. Asserting on the URL guards against a future refactor that
    // accidentally points at the wrong path.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCall = fetchMock.mock.calls[0] as unknown as [
      RequestInfo | URL,
      ...unknown[],
    ];
    const requestedUrl = String(firstCall[0]);
    expect(requestedUrl).toContain("/api/config");

    // Resolve the fetch with a server-provided key.
    await act(async () => {
      resolveFetch!(
        new Response(JSON.stringify({ googleMapsApiKey: "rotated-key-xyz" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    });

    // Wait for react-query's onSuccess + the resulting React re-render
    // to flush. We poll on the iframe rather than guessing how many
    // microtasks the chain takes.
    await waitFor(() => get("property-location-map-iframe") !== null);

    // Loading placeholder is gone, embed is live with the new key.
    expect(get("property-location-map-loading")).toBeNull();
    const iframe = get("property-location-map-iframe") as HTMLIFrameElement | null;
    expect(iframe).not.toBeNull();
    expect(iframe!.src).toContain("key=rotated-key-xyz");
  });

  it("renders the friendly fallback (not the loading placeholder) when /api/config reports no key configured", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ googleMapsApiKey: null }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const Wrapper = makeWrapper();
    await act(async () => {
      root = createRoot(container);
      root.render(
        <Wrapper>
          <PropertyLocationMap
            address="200 Maple Dr"
            city="Dallas"
            state="TX"
            zip="75201"
          />
        </Wrapper>,
      );
    });

    // Wait for the query to settle (success with null key) and the
    // fallback to render. Polling avoids races with react-query's
    // setTimeout-scheduled notifications.
    await waitFor(() => get("property-location-fallback") !== null);

    expect(get("property-location-map-loading")).toBeNull();
    expect(get("property-location-map-iframe")).toBeNull();
    const fallback = get("property-location-fallback");
    expect(fallback).not.toBeNull();
    // Operator-facing copy — must not refer to the retired
    // build-time env var.
    expect(fallback!.textContent).not.toContain("VITE_GOOGLE_MAPS_API_KEY");
  });

  it("does not call /api/config at all when the address is empty (empty state owns the render)", async () => {
    const fetchMock = vi.fn() as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    const Wrapper = makeWrapper();
    await act(async () => {
      root = createRoot(container);
      root.render(
        <Wrapper>
          <PropertyLocationMap address="" city="" state="" zip="" />
        </Wrapper>,
      );
    });
    // Give react-query a moment in case the `enabled: false` guard
    // were ever to regress and fire a request anyway.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(get("property-location-empty")).not.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
