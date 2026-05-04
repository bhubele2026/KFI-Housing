import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act, isValidElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import {
  __resetGoogleMapsSdkForTest,
  formatGeocodeAddress,
  primeGeocodeCache,
} from "@/lib/google-maps-sdk";
import {
  useGeocodeFailureToasts,
  __resetGeocodeFailureToastsForTest,
} from "./use-geocode-failure-toasts";

// Tests pin down Task #212: the first time an address transitions to
// "rejected" in the shared in-session geocode cache, exactly one toast
// fires and it deep-links to the matching property's detail page.
// Re-rejections of the same address stay silent so the rollup-badge
// counter (which already grows live) is the only signal for repeats.

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// Capture toast calls without running the full Toast portal — we don't
// need to render the toast, only assert the contract our hook hands to
// `toast()` (title, description, action element shape).
const toastMock = vi.fn();
vi.mock("./use-toast", () => ({
  useToast: () => ({ toast: toastMock, dismiss: vi.fn(), toasts: [] }),
}));

interface AddressableProperty {
  id: string;
  address: string;
  city: string;
  state: string;
  zip: string;
}

function baseProp(over: Partial<AddressableProperty> & { id: string }): AddressableProperty {
  return {
    address: "123 Main St",
    city: "Austin",
    state: "TX",
    zip: "78701",
    ...over,
  };
}

// Probe component — mounts the hook with a configurable properties
// list. Defining it once at module scope keeps every test driving the
// same exact wiring instead of accidentally diverging on details like
// how `properties` is memoized.
function Probe({ properties }: { properties: ReadonlyArray<AddressableProperty> }) {
  useGeocodeFailureToasts(properties);
  return null;
}

interface CapturedToast {
  variant?: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
}

function lastToast(): CapturedToast | undefined {
  const calls = toastMock.mock.calls;
  if (calls.length === 0) return undefined;
  return calls[calls.length - 1][0] as CapturedToast;
}

function actionHrefOf(t: CapturedToast | undefined): string {
  if (!t?.action || !isValidElement(t.action)) return "";
  // The action is a ToastAction wrapping a wouter Link. The Link's
  // `href` prop is the deep-link target. Walk the element tree
  // (`children` of the action) instead of rendering, so we don't need
  // a full Toast provider to assert the link target.
  const actionEl = t.action as ReactElement<{ children?: unknown }>;
  const child = actionEl.props.children;
  if (!isValidElement(child)) return "";
  const linkEl = child as ReactElement<{ href?: string }>;
  return linkEl.props.href ?? "";
}

function actionAltOf(t: CapturedToast | undefined): string {
  if (!t?.action || !isValidElement(t.action)) return "";
  const actionEl = t.action as ReactElement<{ altText?: string }>;
  return actionEl.props.altText ?? "";
}

describe("useGeocodeFailureToasts", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    toastMock.mockReset();
    __resetGoogleMapsSdkForTest();
    __resetGeocodeFailureToastsForTest();
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
    __resetGoogleMapsSdkForTest();
    __resetGeocodeFailureToastsForTest();
  });

  async function mount(properties: ReadonlyArray<AddressableProperty>) {
    await act(async () => {
      root = createRoot(container);
      root.render(<Probe properties={properties} />);
    });
  }

  it("stays silent in a healthy session with no failures", async () => {
    await mount([baseProp({ id: "p1" })]);
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("fires a toast the first time an address is rejected", async () => {
    const p1 = baseProp({
      id: "p1",
      address: "999 Nonexistent Way",
      city: "Nowhere",
      state: "ZZ",
      zip: "00000",
    });
    await mount([p1]);

    const addr = formatGeocodeAddress(p1);
    await act(async () => {
      primeGeocodeCache(addr, null);
    });

    expect(toastMock).toHaveBeenCalledTimes(1);
    const t = lastToast();
    expect(t?.variant).toBe("destructive");
    expect(t?.title).toBe("Address Google can't pinpoint");
    // The description must include the actual rejected address so
    // operators glancing at the toast immediately know which property
    // is broken — not a generic "an address" message.
    expect(String(t?.description)).toContain(addr);
    expect(String(t?.description)).toContain("fix it on the property page");
  });

  it("links the toast action straight to the matching property's detail page", async () => {
    const p1 = baseProp({ id: "prop-42" });
    await mount([p1]);

    await act(async () => {
      primeGeocodeCache(formatGeocodeAddress(p1), null);
    });

    expect(toastMock).toHaveBeenCalledTimes(1);
    const t = lastToast();
    expect(actionHrefOf(t)).toBe("/properties/prop-42");
    // altText is required on Radix ToastAction for screen readers.
    expect(actionAltOf(t)).toContain(formatGeocodeAddress(p1));
  });

  it("does NOT toast a repeat failure for an address it already toasted", async () => {
    const p1 = baseProp({ id: "p1" });
    await mount([p1]);
    const addr = formatGeocodeAddress(p1);

    await act(async () => {
      primeGeocodeCache(addr, null);
    });
    expect(toastMock).toHaveBeenCalledTimes(1);

    // Re-priming the SAME address as `null` after the cache held a
    // value re-emits to subscribers — but the dedupe guard must keep
    // the toast queue from growing. The badge's running count is the
    // single source of truth for repeats.
    await act(async () => {
      primeGeocodeCache(addr, { lat: 1, lng: 2 });
    });
    await act(async () => {
      primeGeocodeCache(addr, null);
    });
    expect(toastMock).toHaveBeenCalledTimes(1);
  });

  it("fires one toast per distinct rejected address", async () => {
    const p1 = baseProp({ id: "p1", address: "100 First St" });
    const p2 = baseProp({ id: "p2", address: "200 Second Ave" });
    const p3 = baseProp({ id: "p3", address: "300 Third Blvd" });
    await mount([p1, p2, p3]);

    await act(async () => {
      primeGeocodeCache(formatGeocodeAddress(p1), null);
    });
    await act(async () => {
      primeGeocodeCache(formatGeocodeAddress(p2), null);
    });
    await act(async () => {
      primeGeocodeCache(formatGeocodeAddress(p3), null);
    });

    expect(toastMock).toHaveBeenCalledTimes(3);
    const hrefs = toastMock.mock.calls.map((call) =>
      actionHrefOf(call[0] as CapturedToast),
    );
    expect(hrefs.sort()).toEqual([
      "/properties/p1",
      "/properties/p2",
      "/properties/p3",
    ]);
  });

  it("omits the action button when no current property matches the failed address", async () => {
    // The cache can hold a failure for a string that no current
    // property still uses (e.g. the operator already edited the
    // property's address but the stale cache entry hasn't been
    // invalidated). Rather than render a dead link to /properties/
    // undefined, the action is omitted entirely.
    await mount([baseProp({ id: "p1", address: "1 New Street" })]);

    await act(async () => {
      primeGeocodeCache("999 Stale Address, Nowhere, ZZ 00000", null);
    });

    expect(toastMock).toHaveBeenCalledTimes(1);
    const t = lastToast();
    expect(t?.action).toBeUndefined();
    expect(String(t?.description)).toContain("999 Stale Address");
  });

  it("toasts pre-existing failures observed before mount", async () => {
    // A sibling Maps surface (e.g. a property-detail Location card
    // mounted before the global shell) could record a failure into
    // the shared cache before this hook subscribes. The operator
    // hasn't seen anything yet, so the toast should still fire on
    // the first mount that has a chance to render it.
    const p1 = baseProp({ id: "p1" });
    primeGeocodeCache(formatGeocodeAddress(p1), null);

    await mount([p1]);

    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(actionHrefOf(lastToast())).toBe("/properties/p1");
  });

  it("survives a remount without re-toasting addresses already announced", async () => {
    // The dedupe set lives at module scope so a brief unmount/remount
    // (e.g. the auth gate flipping shells) doesn't replay every
    // outstanding failure as a fresh toast — the operator already saw
    // those, and the badge picks up where it left off.
    const p1 = baseProp({ id: "p1" });
    await mount([p1]);

    await act(async () => {
      primeGeocodeCache(formatGeocodeAddress(p1), null);
    });
    expect(toastMock).toHaveBeenCalledTimes(1);

    // Unmount and remount with the same failure still in the cache.
    if (root) {
      const r = root;
      await act(async () => {
        r.unmount();
      });
      root = null;
    }
    await mount([p1]);

    expect(toastMock).toHaveBeenCalledTimes(1);
  });
});
