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

  // React 18 attaches event listeners at the root container rather
  // than on individual elements, and for non-bubbling events like
  // `error` on an iframe a plain `dispatchEvent(new Event("error"))`
  // does NOT reach React's handler in jsdom. To simulate the iframe
  // failing to load, we instead read the React props that React
  // stores on the DOM node (`__reactProps$<key>`) and invoke the
  // `onError` handler directly. This still verifies the wiring —
  // if `onError={...}` is removed from the iframe in the component,
  // this lookup returns undefined and the test fails.
  function fireReactOnError(el: Element) {
    const propsKey = Object.keys(el).find((k) =>
      k.startsWith("__reactProps$"),
    );
    if (!propsKey) {
      throw new Error("React props not found on element");
    }
    const props = (el as unknown as Record<string, unknown>)[propsKey] as
      | { onError?: (e: unknown) => void }
      | undefined;
    if (!props || typeof props.onError !== "function") {
      throw new Error(
        "iframe is missing an onError handler — the in-card error " +
          "branch can't be triggered without it.",
      );
    }
    props.onError({ type: "error" });
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

  it("renders the troubleshooting message inline with the embed (always visible, not gated on detection)", async () => {
    // Why this test exists: the iframe `onError` handler only fires
    // when the iframe element itself fails (network blocked, CSP
    // refused, malformed URL). Google's Embed API renders its
    // `RefererNotAllowedMapError` / `ApiNotActivatedMapError` /
    // `InvalidKeyMapError` / quota-exhausted screens as Google content
    // *inside* the iframe, which is cross-origin from the host page —
    // browsers don't expose those to the parent's onError. So for the
    // most common real-world failures the dedicated error branch
    // (`property-location-map-error`) will not trigger.
    //
    // To make the requested operator-facing message reliably visible
    // in those cases, the troubleshooting copy is rendered
    // unconditionally below the embed in the success branch — not
    // hidden behind a click or a flaky detection heuristic. When
    // Google shows its grey error tile inside the iframe, the
    // operator sees the plain-English fix list right next to it.
    // This test pins down (a) the message is present whenever the
    // embed is, (b) the visible copy lists the exact two key-side
    // fixes (Maps Embed API / allowlist), and (c) it never appears
    // in branches where it would be misleading (loading, empty,
    // missing-key, error — covered by the dedicated test below).
    await render(
      <PropertyLocationMap
        address="100 Oak Way"
        city="Austin"
        state="TX"
        zip="78701"
        apiKey="test-key-abc"
      />,
    );

    const note = get("property-location-map-troubleshoot");
    expect(note).not.toBeNull();

    const text = get("property-location-map-troubleshoot-text");
    expect(text).not.toBeNull();
    // Crucially, the message must be visible immediately — no <details>
    // wrapper, no `hidden` attribute, no required user interaction.
    // This is what distinguishes "shown when Google rejects the key"
    // from "discoverable when Google rejects the key".
    expect(note!.closest("details")).toBeNull();
    expect(note!.hasAttribute("hidden")).toBe(false);

    const copy = (text!.textContent ?? "").toLowerCase();
    expect(copy).toContain("google");
    expect(copy).toContain("api key");
    expect(copy).toContain("maps embed api");
    expect(copy).toContain("allowlist");
  });

  it("uses the same troubleshooting copy in the inline note and the error branch (no drift)", async () => {
    // Both surfaces describe the same operator-side fix. If they ever
    // drift, we'd be telling operators two different stories about
    // the same key problem. The implementation sources both from a
    // shared constant; this test pins down the shared substring so
    // the two surfaces can't accidentally diverge.
    const SHARED_FIX_LINE =
      "Google rejected this Maps API key. Check that the Maps Embed " +
      "API is enabled and that this domain is on the key's allowlist.";

    await render(
      <PropertyLocationMap
        address="100 Oak Way"
        city="Austin"
        state="TX"
        zip="78701"
        apiKey="test-key-abc"
      />,
    );
    const inlineCopy =
      get("property-location-map-troubleshoot-text")?.textContent ?? "";
    expect(inlineCopy).toContain(SHARED_FIX_LINE);

    // Re-render in the error state in a fresh tree to read its copy.
    await act(async () => {
      root!.unmount();
      root = null;
    });
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
    await act(async () => {
      fireReactOnError(iframe!);
    });
    const errorPanel = get("property-location-map-error");
    expect(errorPanel).not.toBeNull();
    expect(errorPanel!.textContent).toContain(SHARED_FIX_LINE);
  });

  it("does not render the troubleshooting disclosure in the loading, empty, missing-key, or error branches", async () => {
    // The disclosure is only meaningful when the embed is actually
    // mounted. In the empty/missing-key states there's no iframe to
    // troubleshoot; in the loading state we don't yet know whether
    // the key is configured; and in the error state the same copy
    // is already visible, so showing the collapsible disclosure on
    // top of it would be redundant noise.
    await render(
      <PropertyLocationMap
        address=""
        city=""
        state=""
        zip=""
        apiKey="test-key-abc"
      />,
    );
    expect(get("property-location-map-troubleshoot")).toBeNull();

    await act(async () => {
      root!.unmount();
      root = null;
    });
    await render(
      <PropertyLocationMap
        address="200 Maple Dr"
        city="Dallas"
        state="TX"
        zip="75201"
        apiKey=""
      />,
    );
    expect(get("property-location-map-troubleshoot")).toBeNull();

    await act(async () => {
      root!.unmount();
      root = null;
    });
    await render(
      <PropertyLocationMap
        address="400 Cedar Blvd"
        city="Phoenix"
        state="AZ"
        zip="85001"
        apiKey="some-key"
      />,
    );
    const iframe = get("property-location-map-iframe") as HTMLIFrameElement | null;
    expect(iframe).not.toBeNull();
    await act(async () => {
      fireReactOnError(iframe!);
    });
    expect(get("property-location-map-error")).not.toBeNull();
    expect(get("property-location-map-troubleshoot")).toBeNull();
  });

  it("swaps the embed for an in-card error message when Google rejects the iframe (bad key, allowlist, etc.)", async () => {
    // Embed renders normally first — Google's grey "this page can't
    // load Google Maps correctly" tile inside our card looks like the
    // embed is "almost working" and gives the operator no clue what to
    // fix on their key (RefererNotAllowedMapError,
    // ApiNotActivatedMapError, InvalidKeyMapError, quota, …). We hook
    // the iframe's `onError` so we can replace that with a plain-
    // English message above the address while keeping the one-click
    // jump to Google Maps + Directions intact.
    await render(
      <PropertyLocationMap
        address="400 Cedar Blvd"
        city="Phoenix"
        state="AZ"
        zip="85001"
        apiKey="bad-or-restricted-key"
      />,
    );

    const iframe = get("property-location-map-iframe") as HTMLIFrameElement | null;
    expect(iframe).not.toBeNull();
    // Sanity: not in the error branch yet — the embed is still mounted
    // and the dedicated error surface hasn't appeared.
    expect(get("property-location-map-error")).toBeNull();

    // Simulate the iframe failing to load by invoking React's
    // onError prop directly (see fireReactOnError comment for why).
    await act(async () => {
      fireReactOnError(iframe!);
    });

    // Iframe (and its enclosing map-link wrapper) is gone — the embed
    // branch yields to the error branch entirely instead of layering
    // the warning on top of a broken Google tile.
    expect(get("property-location-map-iframe")).toBeNull();
    expect(get("property-location-map-link")).toBeNull();

    // The new in-card message is operator-facing and names the
    // concrete things to check on the key.
    const err = get("property-location-map-error");
    expect(err).not.toBeNull();
    const text = err!.textContent ?? "";
    expect(text.toLowerCase()).toContain("google");
    expect(text.toLowerCase()).toContain("api key");
    // Calls out the two most common operator-side fixes by name so the
    // copy isn't a vague "something went wrong".
    expect(text.toLowerCase()).toContain("maps embed api");
    expect(text.toLowerCase()).toContain("allowlist");

    // The "Open in Google Maps" jump that used to live on the embed
    // wrapper must still be reachable from the error branch — that's
    // the operator's one-click escape hatch and the task explicitly
    // requires it to keep working.
    const errLink = get("property-location-map-error-link") as HTMLAnchorElement | null;
    expect(errLink).not.toBeNull();
    const expectedQuery = encodeURIComponent("400 Cedar Blvd, Phoenix, AZ 85001");
    expect(errLink!.href).toBe(
      `https://www.google.com/maps/search/?api=1&query=${expectedQuery}`,
    );
    expect(errLink!.target).toBe("_blank");
    expect(errLink!.rel).toContain("noopener");

    // Directions link — rendered below the map area — must also still
    // work in the error state.
    const dir = get("property-location-directions-link") as HTMLAnchorElement | null;
    expect(dir).not.toBeNull();
    expect(dir!.href).toBe(
      `https://www.google.com/maps/dir/?api=1&destination=${expectedQuery}`,
    );

    // Address block stays put so the operator still sees what address
    // failed to render.
    const addr = get("property-location-address");
    expect(addr).not.toBeNull();
    expect(addr!.textContent).toContain("400 Cedar Blvd");
    expect(addr!.textContent).toContain("Phoenix, AZ 85001");

    // The empty-address and missing-key branches must not be reused
    // for this case — they say different (and misleading) things.
    expect(get("property-location-empty")).toBeNull();
    expect(get("property-location-fallback")).toBeNull();
  });

  it("does not show the iframe-rejected error before the iframe has actually failed", async () => {
    // Defends the happy path: the error branch must only appear after
    // the iframe fires `error` — not on first render. Otherwise every
    // map would flash the "Google rejected this key" warning even
    // when the key is fine.
    await render(
      <PropertyLocationMap
        address="100 Oak Way"
        city="Austin"
        state="TX"
        zip="78701"
        apiKey="test-key-abc"
      />,
    );

    expect(get("property-location-map-iframe")).not.toBeNull();
    expect(get("property-location-map-error")).toBeNull();
    expect(get("property-location-map-error-link")).toBeNull();
  });

  it("does not render the iframe-rejected error in the missing-key fallback branch", async () => {
    // The missing-key branch and the rejected-key branch are
    // different stories ("set your key" vs "your key was refused").
    // They must not be conflated — only the friendly fallback should
    // appear when no key is configured at all.
    await render(
      <PropertyLocationMap
        address="200 Maple Dr"
        city="Dallas"
        state="TX"
        zip="75201"
        apiKey=""
      />,
    );

    expect(get("property-location-fallback")).not.toBeNull();
    expect(get("property-location-map-error")).toBeNull();
    expect(get("property-location-map-error-link")).toBeNull();
  });

  it("re-attempts the embed (clears the error state) when the address changes after a previous failure", async () => {
    // Sticky error state would be a UX trap: rotate the key or fix
    // the address and the card would still claim Google rejected it.
    // The component resets `mapStatus` whenever the embed URL
    // changes, so a fresh address gets a fresh attempt.
    const Wrapper = makeWrapper();
    await act(async () => {
      root = createRoot(container);
      root.render(
        <Wrapper>
          <PropertyLocationMap
            address="400 Cedar Blvd"
            city="Phoenix"
            state="AZ"
            zip="85001"
            apiKey="some-key"
          />
        </Wrapper>,
      );
    });

    const iframe = get("property-location-map-iframe") as HTMLIFrameElement | null;
    expect(iframe).not.toBeNull();
    await act(async () => {
      fireReactOnError(iframe!);
    });
    expect(get("property-location-map-error")).not.toBeNull();

    // Re-render with a different address — same key. The new embed
    // URL must trigger a fresh attempt rather than staying stuck on
    // the rejected-key copy.
    await act(async () => {
      root!.render(
        <Wrapper>
          <PropertyLocationMap
            address="500 Birch Ln"
            city="Phoenix"
            state="AZ"
            zip="85002"
            apiKey="some-key"
          />
        </Wrapper>,
      );
    });

    expect(get("property-location-map-error")).toBeNull();
    expect(get("property-location-map-iframe")).not.toBeNull();
  });

  // -------------------------------------------------------------------
  // postMessage-based key-error detection (Task #163)
  //
  // Google's Embed iframe loads successfully and then renders a tiny
  // grey error tile inside itself for the most common key-rejection
  // failures (RefererNotAllowedMapError, ApiNotActivatedMapError,
  // InvalidKeyMapError, OverQuotaMapError, …). The iframe `error`
  // event does NOT fire in those cases, so the tests above (which
  // exercise the iframe-onError path) would never trigger this code
  // path. Google publishes the actual failure code as a `postMessage`
  // from the embed iframe back to the parent window; the component
  // subscribes to that and switches to a *tailored* error message that
  // names the concrete fix on the operator's Google Cloud Console.
  // The tests below cover that wiring end-to-end:
  //   - happy path: each known code yields the matching tailored copy
  //   - shape tolerance: the listener accepts both bare-string and
  //     `{code: "…"}` payloads (Google has shipped both)
  //   - provenance: messages from any other window are ignored — the
  //     listener gates on event.source === iframe.contentWindow
  //   - link integrity: Open in Google Maps + Directions still work
  //   - reset: rotating the embed URL clears the error state
  // -------------------------------------------------------------------

  function fireGoogleMapsErrorMessage(
    iframe: HTMLIFrameElement,
    payload: unknown,
  ) {
    // jsdom fires every iframe up with its own contentWindow; we use
    // that as the message source so the component's source-equality
    // check (which is how it tells "this came from our embed" apart
    // from "this came from anywhere else on the page") accepts it.
    if (!iframe.contentWindow) {
      throw new Error(
        "iframe.contentWindow is null — jsdom should have created one",
      );
    }
    const event = new MessageEvent("message", {
      data: payload,
      source: iframe.contentWindow,
      origin: "https://www.google.com",
    });
    window.dispatchEvent(event);
  }

  // Mirrors `Object.keys(MAPS_ERROR_MESSAGES)` in the component. Used by
  // the unknown-code tests below to assert their picked codes really
  // aren't in the lookup table — guards against someone "fixing" those
  // tests by adding the synthetic code to the table and turning a
  // genuine unknown-code test into a tailored-code test by mistake.
  const KNOWN_KEY_ERROR_CODES: ReadonlyArray<string> = [
    "RefererNotAllowedMapError",
    "ApiNotActivatedMapError",
    "InvalidKeyMapError",
    "MissingKeyMapError",
    "ExpiredKeyMapError",
    "OverQuotaMapError",
    "RequestDeniedMapError",
    "DeletedApiProjectMapError",
    "RetiredVersionMapError",
  ];

  const TAILORED_CASES: ReadonlyArray<{
    code: string;
    mustInclude: ReadonlyArray<string>;
  }> = [
    {
      code: "RefererNotAllowedMapError",
      mustInclude: ["this domain", "referrer allowlist"],
    },
    {
      code: "ApiNotActivatedMapError",
      mustInclude: ["maps embed api isn't enabled"],
    },
    {
      code: "InvalidKeyMapError",
      mustInclude: ["invalid"],
    },
    {
      code: "OverQuotaMapError",
      mustInclude: ["over its daily", "quota"],
    },
    {
      code: "ExpiredKeyMapError",
      mustInclude: ["expired"],
    },
    {
      code: "RequestDeniedMapError",
      mustInclude: ["denied", "api restrictions"],
    },
  ];

  for (const { code, mustInclude } of TAILORED_CASES) {
    it(`shows a tailored error message when Google posts ${code}`, async () => {
      await render(
        <PropertyLocationMap
          address="400 Cedar Blvd"
          city="Phoenix"
          state="AZ"
          zip="85001"
          apiKey="key-under-test"
        />,
      );

      const iframe = get(
        "property-location-map-iframe",
      ) as HTMLIFrameElement | null;
      expect(iframe).not.toBeNull();
      // Sanity: still in the success branch — no error has been
      // detected yet, so swapping in the dedicated error surface here
      // would be a false positive.
      expect(get("property-location-map-error")).toBeNull();

      await act(async () => {
        fireGoogleMapsErrorMessage(iframe!, { code });
      });

      // The success branch is gone (iframe + its wrapping anchor
      // unmount) and the dedicated error surface has taken over.
      expect(get("property-location-map-iframe")).toBeNull();
      expect(get("property-location-map-link")).toBeNull();

      const panel = get("property-location-map-error");
      expect(panel).not.toBeNull();
      // Pin down the exact code on the rendered panel so a future
      // refactor can't quietly route every code through the generic
      // copy. This is the hook that proves the lookup ran.
      expect(panel!.getAttribute("data-error-code")).toBe(code);

      const text = (
        get("property-location-map-error-text")?.textContent ?? ""
      ).toLowerCase();
      for (const phrase of mustInclude) {
        expect(text).toContain(phrase);
      }

      // The tailored message must NOT be the generic catch-all line.
      // If it were, the postMessage code would have been ignored and
      // we'd be back to the pre-Task-#163 behavior of telling every
      // operator the same vague story regardless of which key
      // problem they actually have.
      const GENERIC = "google rejected this maps api key";
      // "InvalidKeyMapError" and the generic line both contain the
      // word "rejected", so we use the full unique generic phrase
      // here — no tailored line repeats it verbatim.
      expect(text).not.toContain(
        "google rejected this maps api key. check that the maps embed api",
      );
      // Cross-check: the generic constant *would* match if it slipped
      // through. This guards against the assertion above being
      // accidentally weakened.
      expect(GENERIC.length).toBeGreaterThan(0);

      // The "Open in Google Maps" jump must still be reachable from
      // the error branch — the task explicitly requires it to keep
      // working in every error case.
      const errLink = get(
        "property-location-map-error-link",
      ) as HTMLAnchorElement | null;
      expect(errLink).not.toBeNull();
      const expectedQuery = encodeURIComponent(
        "400 Cedar Blvd, Phoenix, AZ 85001",
      );
      expect(errLink!.href).toBe(
        `https://www.google.com/maps/search/?api=1&query=${expectedQuery}`,
      );
      expect(errLink!.target).toBe("_blank");
      expect(errLink!.rel).toContain("noopener");

      // Directions link is rendered alongside the address block and
      // must also remain reachable in the error state.
      const dir = get(
        "property-location-directions-link",
      ) as HTMLAnchorElement | null;
      expect(dir).not.toBeNull();
      expect(dir!.href).toBe(
        `https://www.google.com/maps/dir/?api=1&destination=${expectedQuery}`,
      );
    });
  }

  it("surfaces an unknown `*MapError` code verbatim alongside the generic fix line, instead of silently ignoring it", async () => {
    // Defends against the silent-failure mode this branch was created
    // to fix: when Google ships a new error code (or renames an
    // existing one) that isn't in MAPS_ERROR_MESSAGES, the listener
    // used to drop it on the floor — the operator stared at Google's
    // grey error tile inside the embed with no in-app explanation,
    // and a support ticket couldn't even name which code Google sent.
    //
    // The component must instead detect any payload that looks like a
    // Maps error code (the `*MapError` shape) and switch to the
    // dedicated error panel showing the raw code alongside the
    // generic fix line. We pick a code that is intentionally NOT in
    // the lookup table so this test would catch a regression where
    // someone "fixed" the test by adding the code to the table.
    const unknownCode = "TotallyMadeUpFutureMapError";
    expect(KNOWN_KEY_ERROR_CODES).not.toContain(unknownCode);

    await render(
      <PropertyLocationMap
        address="400 Cedar Blvd"
        city="Phoenix"
        state="AZ"
        zip="85001"
        apiKey="key-under-test"
      />,
    );
    const iframe = get(
      "property-location-map-iframe",
    ) as HTMLIFrameElement | null;
    expect(iframe).not.toBeNull();

    await act(async () => {
      fireGoogleMapsErrorMessage(iframe!, { code: unknownCode });
    });

    // The success branch yields entirely to the dedicated error
    // surface — same as the tailored-code cases. Layering a warning
    // over a still-mounted iframe would let Google's grey tile show
    // through.
    expect(get("property-location-map-iframe")).toBeNull();
    expect(get("property-location-map-link")).toBeNull();

    const panel = get("property-location-map-error");
    expect(panel).not.toBeNull();
    // The raw code is exposed both as a stable testing hook on the
    // panel and verbatim in the visible copy — the support-ticket
    // value of the new branch hinges on the operator being able to
    // read the actual string Google sent.
    expect(panel!.getAttribute("data-error-code")).toBe(unknownCode);
    const text = get("property-location-map-error-text")?.textContent ?? "";
    expect(text).toContain(unknownCode);
    expect(text.toLowerCase()).toContain("google reported");
    // Generic fix line still appears so the operator has somewhere to
    // start even before we ship a tailored message for this code.
    expect(text).toContain(
      "Check that the Maps Embed API is enabled and that this domain is on the key's allowlist",
    );

    // The escape-hatch links must remain intact — same contract as
    // the tailored-code branch.
    const errLink = get(
      "property-location-map-error-link",
    ) as HTMLAnchorElement | null;
    expect(errLink).not.toBeNull();
    const expectedQuery = encodeURIComponent(
      "400 Cedar Blvd, Phoenix, AZ 85001",
    );
    expect(errLink!.href).toBe(
      `https://www.google.com/maps/search/?api=1&query=${expectedQuery}`,
    );
  });

  it("recognizes a bare-string unknown `*MapError` payload too (not just `{code: ...}` objects)", async () => {
    // Belt-and-braces for the loose detector: Google has shipped error
    // payloads as bare strings in the past, so an unrecognized code
    // arriving as a plain string must also be picked up — otherwise
    // the loose detection would only half-cover the regression case
    // it's meant to fix.
    const unknownCode = "BrandNewUnknownMapError";
    expect(KNOWN_KEY_ERROR_CODES).not.toContain(unknownCode);

    await render(
      <PropertyLocationMap
        address="400 Cedar Blvd"
        city="Phoenix"
        state="AZ"
        zip="85001"
        apiKey="key-under-test"
      />,
    );
    const iframe = get(
      "property-location-map-iframe",
    ) as HTMLIFrameElement | null;
    expect(iframe).not.toBeNull();

    await act(async () => {
      fireGoogleMapsErrorMessage(iframe!, unknownCode);
    });

    const panel = get("property-location-map-error");
    expect(panel).not.toBeNull();
    expect(panel!.getAttribute("data-error-code")).toBe(unknownCode);
    const text = get("property-location-map-error-text")?.textContent ?? "";
    expect(text).toContain(unknownCode);
  });

  it("accepts a bare-string postMessage payload, not just `{code: ...}` objects", async () => {
    // Google has shipped the error in different shapes across versions
    // of the Embed API — sometimes a structured object, sometimes a
    // plain string. The extractor must tolerate both so we're not
    // fragile to either one disappearing.
    await render(
      <PropertyLocationMap
        address="400 Cedar Blvd"
        city="Phoenix"
        state="AZ"
        zip="85001"
        apiKey="key-under-test"
      />,
    );
    const iframe = get(
      "property-location-map-iframe",
    ) as HTMLIFrameElement | null;
    expect(iframe).not.toBeNull();

    await act(async () => {
      fireGoogleMapsErrorMessage(iframe!, "RefererNotAllowedMapError");
    });

    const panel = get("property-location-map-error");
    expect(panel).not.toBeNull();
    expect(panel!.getAttribute("data-error-code")).toBe(
      "RefererNotAllowedMapError",
    );
  });

  it("ignores postMessage events whose source is not our iframe", async () => {
    // Provenance check: any frame on the page can fire a postMessage
    // at the parent window. The component must accept the code only
    // when the message is from *our* iframe — otherwise an unrelated
    // embed (a YouTube iframe, an ad, the page itself) could spoof
    // an error code and put a working map into the error branch.
    await render(
      <PropertyLocationMap
        address="400 Cedar Blvd"
        city="Phoenix"
        state="AZ"
        zip="85001"
        apiKey="key-under-test"
      />,
    );
    const iframe = get(
      "property-location-map-iframe",
    ) as HTMLIFrameElement | null;
    expect(iframe).not.toBeNull();

    // Stand up a sibling iframe and post the error code from *that*
    // iframe's contentWindow. The component must ignore it because
    // the source is not its own iframe.contentWindow.
    const decoy = document.createElement("iframe");
    document.body.appendChild(decoy);
    try {
      await act(async () => {
        const event = new MessageEvent("message", {
          data: { code: "RefererNotAllowedMapError" },
          source: decoy.contentWindow,
          origin: "https://www.google.com",
        });
        window.dispatchEvent(event);
      });

      // Still in the success branch — the message was ignored.
      expect(get("property-location-map-iframe")).not.toBeNull();
      expect(get("property-location-map-error")).toBeNull();

      // Also: a message from the parent window itself must be
      // ignored for the same reason.
      await act(async () => {
        const event = new MessageEvent("message", {
          data: { code: "RefererNotAllowedMapError" },
          source: window,
          origin: window.location.origin,
        });
        window.dispatchEvent(event);
      });
      expect(get("property-location-map-iframe")).not.toBeNull();
      expect(get("property-location-map-error")).toBeNull();
    } finally {
      decoy.remove();
    }
  });

  it("ignores postMessage payloads that don't carry a known Google Maps error code", async () => {
    // Defends against false positives from chatty third-party scripts
    // that just happen to share the page (analytics, ad SDKs, etc.)
    // and post unrelated messages from inside the same iframe (which
    // shouldn't happen, but the noise floor matters either way).
    await render(
      <PropertyLocationMap
        address="400 Cedar Blvd"
        city="Phoenix"
        state="AZ"
        zip="85001"
        apiKey="key-under-test"
      />,
    );
    const iframe = get(
      "property-location-map-iframe",
    ) as HTMLIFrameElement | null;
    expect(iframe).not.toBeNull();

    for (const noise of [
      "hello world",
      { type: "ANALYTICS_PING", visitors: 3 },
      { code: "SomeUnrelatedThing" },
      42,
      null,
    ]) {
      await act(async () => {
        fireGoogleMapsErrorMessage(iframe!, noise);
      });
    }

    expect(get("property-location-map-iframe")).not.toBeNull();
    expect(get("property-location-map-error")).toBeNull();
  });

  it("clears the postMessage-reported error when the embed URL changes", async () => {
    // Sticky error state would be a UX trap: if the operator fixes
    // the key (or just navigates to a different property) the card
    // would still be claiming Google rejected it. Resetting on
    // embedUrl change gives the new attempt a fresh start.
    const Wrapper = makeWrapper();
    await act(async () => {
      root = createRoot(container);
      root.render(
        <Wrapper>
          <PropertyLocationMap
            address="400 Cedar Blvd"
            city="Phoenix"
            state="AZ"
            zip="85001"
            apiKey="key-under-test"
          />
        </Wrapper>,
      );
    });

    const iframe = get(
      "property-location-map-iframe",
    ) as HTMLIFrameElement | null;
    expect(iframe).not.toBeNull();
    await act(async () => {
      fireGoogleMapsErrorMessage(iframe!, {
        code: "RefererNotAllowedMapError",
      });
    });
    expect(get("property-location-map-error")).not.toBeNull();

    await act(async () => {
      root!.render(
        <Wrapper>
          <PropertyLocationMap
            address="500 Birch Ln"
            city="Phoenix"
            state="AZ"
            zip="85002"
            apiKey="key-under-test"
          />
        </Wrapper>,
      );
    });

    expect(get("property-location-map-error")).toBeNull();
    expect(get("property-location-map-iframe")).not.toBeNull();
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
