import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Switch, Route, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// React 18+ requires this flag to be truthy before any `act(...)` call
// will actually flush effects synchronously. Without it, `act` becomes
// a no-op shim, jsdom emits "The current testing environment is not
// configured to support act(...)" warnings, and effects from a prior
// test (the SDK loader's `setStatus("ready")`, the location-map's
// geocode effect, etc.) can leak into the next test's first render —
// which is exactly the failure mode the second and third tests in this
// file hit ("expected null not to be null" on the canvas lookup) when
// the file is run as part of the full suite. The component-level test
// at `src/components/property-location-map.test.tsx` already sets this
// flag at module scope; matching that convention here is the same
// fix, applied to the page-level file.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Pin down that the property-detail page actually integrates the
// shared-store-driven, tailored-copy error branch of PropertyLocationMap
// (Task #163, ported to the JS Maps SDK in Task #195). The
// component-level tests in `src/components/property-location-map.test.tsx`
// mount the component directly and prove the listener / lookup wiring
// inside the component. What they CAN'T prove is that the page still
// hosts that component on the Overview tab — a future refactor that
// swaps the Location card for a different one, or wraps it in a parent
// that intercepts the shared key-error store, would silently regress
// the operator-facing copy without breaking any existing test.
//
// These tests close that gap. They mount the full Property Detail page
// against a memory router, let the real PropertyLocationMap render,
// drive the shared Google Maps key-error store directly via
// `reportGoogleMapsKeyError(...)` (the same store the app's
// gm_authFailure callback and the embed-iframe postMessage listener
// fire through in production), and assert that the tailored line for
// the reported code is visible on the page (not the generic catch-all).
// Two codes are covered so the lookup-table integration is exercised
// with more than one entry.

const { toastMock, MockRoomInUseError } = vi.hoisted(() => {
  class MockRoomInUseError extends Error {
    constructor() {
      super("Cannot delete a room that still has beds.");
      this.name = "RoomInUseError";
    }
  }
  return { toastMock: vi.fn(), MockRoomInUseError };
});

vi.mock("@/components/layout/main-layout", () => ({
  MainLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

// Intentionally NOT mocking `@/components/property-location-map` — the
// whole point of this file is to exercise the real component as
// rendered by the page. Instead we mock the runtime-config hook it
// pulls from `@workspace/api-client-react` so the component
// synchronously resolves to a non-empty key and renders the SDK map
// branch (which is what subscribes to the shared key-error store).
// This sidesteps having to stand up a live `/api/config` fetch in
// every page-level test setup, while still letting the page's own
// `<PropertyLocationMap address=... />` code path run end-to-end.
vi.mock("@workspace/api-client-react", () => ({
  useGetRuntimeConfig: () => ({
    data: {
      googleMapsApiKey: "test-key-page-level",
      googleMapsMapId: "test-map-id-page-level",
    },
    isPending: false,
    isLoading: false,
    isError: false,
    isSuccess: true,
    error: null,
    status: "success",
    fetchStatus: "idle",
  }),
  getGetRuntimeConfigQueryKey: () => ["/api/config"] as const,
}));

vi.mock("framer-motion", async () => {
  const { createMotionMock } = await import("@/test-utils/framer-motion-mock");
  return createMotionMock();
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock, dismiss: vi.fn(), toasts: [] }),
}));

// Tabs mock — defaults to "overview" so the Location card (which lives
// at the top of the Overview TabsContent) renders without any clicks.
vi.mock("@/components/ui/tabs", () => {
  const TabsCtx = React.createContext<{
    value: string;
    setValue: (v: string) => void;
  }>({ value: "", setValue: () => {} });
  const Tabs = ({
    defaultValue,
    value: controlledValue,
    onValueChange,
    children,
    className,
  }: {
    defaultValue?: string;
    value?: string;
    onValueChange?: (v: string) => void;
    children?: ReactNode;
    className?: string;
  }) => {
    const [internalValue, setInternalValue] = React.useState<string>(
      controlledValue ?? defaultValue ?? "",
    );
    const value = controlledValue ?? internalValue;
    const setValue = (v: string) => {
      if (controlledValue === undefined) setInternalValue(v);
      onValueChange?.(v);
    };
    return (
      <TabsCtx.Provider value={{ value, setValue }}>
        <div className={className}>{children}</div>
      </TabsCtx.Provider>
    );
  };
  const TabsList = ({
    children,
    className,
  }: {
    children?: ReactNode;
    className?: string;
  }) => <div className={className}>{children}</div>;
  const TabsTrigger = ({
    value,
    children,
  }: {
    value: string;
    children?: ReactNode;
  }) => {
    const ctx = React.useContext(TabsCtx);
    return (
      <button
        type="button"
        data-testid={`tab-trigger-${value}`}
        onClick={() => ctx.setValue(value)}
      >
        {children}
      </button>
    );
  };
  const TabsContent = ({
    value,
    children,
    className,
  }: {
    value: string;
    children?: ReactNode;
    className?: string;
  }) => {
    const ctx = React.useContext(TabsCtx);
    if (ctx.value !== value) return null;
    return <div className={className}>{children}</div>;
  };
  return { Tabs, TabsList, TabsTrigger, TabsContent };
});

// Tooltips, dialogs, popovers, selects — not relevant to the Location
// card's error branch. Reduce them to passthroughs / null portals so
// jsdom doesn't choke on Radix's portal machinery.
vi.mock("@/components/ui/tooltip", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Tooltip: Pass,
    TooltipTrigger: Pass,
    TooltipContent: () => null,
    TooltipProvider: Pass,
  };
});

vi.mock("@/components/ui/dialog", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Dialog: Pass,
    DialogTrigger: Pass,
    DialogContent: () => null,
    DialogHeader: Pass,
    DialogTitle: Pass,
    DialogDescription: Pass,
    DialogFooter: Pass,
    DialogClose: Pass,
    DialogPortal: Pass,
    DialogOverlay: () => null,
  };
});

vi.mock("@/components/ui/popover", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return { Popover: Pass, PopoverTrigger: Pass, PopoverContent: () => null };
});

vi.mock("@/components/ui/select", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Select: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    SelectContent: Pass,
    SelectGroup: Pass,
    SelectItem: Pass,
    SelectLabel: Pass,
    SelectScrollDownButton: Pass,
    SelectScrollUpButton: Pass,
    SelectSeparator: Pass,
    SelectTrigger: Pass,
    SelectValue: Pass,
  };
});

// ── Mock data store ─────────────────────────────────────────────────────
// One property with a real address so PropertyLocationMap renders the
// SDK map branch (rather than its empty state).
const seededProperty = {
  id: "p1",
  customerId: "c1",
  name: "Maple",
  address: "400 Cedar Blvd",
  city: "Phoenix",
  state: "AZ",
  zip: "85001",
  totalBeds: 0,
  monthlyRent: 0,
  chargePerBed: 0,
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
  furnishings: [] as string[],
};

const storeState = {
  customers: [{ id: "c1", name: "Acme", contactName: "", email: "", phone: "", notes: "" }],
  properties: [seededProperty],
  leases: [] as Array<Record<string, unknown>>,
  rooms: [] as Array<Record<string, unknown>>,
  beds: [] as Array<Record<string, unknown>>,
  occupants: [] as Array<Record<string, unknown>>,
  utilities: [] as Array<Record<string, unknown>>,
  isLoading: false,
  addRoom: vi.fn(),
  updateRoom: vi.fn(),
  deleteRoom: vi.fn(),
  addBed: vi.fn(),
  deleteBed: vi.fn(),
  updateBed: vi.fn(),
  updateProperty: vi.fn(),
  updateLease: vi.fn(),
  addLease: vi.fn(),
  deleteLease: vi.fn(),
  updateOccupant: vi.fn(),
  addOccupant: vi.fn(),
  updateUtility: vi.fn(),
  addUtility: vi.fn(),
  deleteUtility: vi.fn(),
};

vi.mock("@/context/data-store", () => ({
  useData: () => storeState,
  RoomInUseError: MockRoomInUseError,
}));

// Imports that consume the mocks above MUST come after vi.mock calls.
import PropertyDetail from "./property-detail";
import {
  reportGoogleMapsKeyError,
  __resetGoogleMapsKeyErrorForTest,
} from "@/hooks/use-google-maps-key-error";
import { __resetGoogleMapsSdkForTest } from "@/lib/google-maps-sdk";

// Install a minimal fake Google Maps SDK so PropertyLocationMap's load
// effect resolves synchronously into the canvas branch instead of
// trying to fetch the real Google script tag from jsdom (which would
// either hang or noisily fail). We also prime
// `window.__housingopsMapsLoader` to a resolved promise so the loader
// short-circuits even if the ready-class detection in `loadMapsApi`
// regresses. The fake is intentionally tiny — these page-level tests
// only need the canvas to exist long enough to be replaced by the
// error panel; they don't drive markers or geocoding.
function installFakeGoogleMaps() {
  class FakeMap {
    constructor(_el: HTMLElement, _options: Record<string, unknown>) {}
    setCenter() {}
    setZoom() {}
    fitBounds() {}
    addListener() {}
  }
  class FakeAdvancedMarkerElement {
    map: unknown | null = null;
    constructor(opts: { map: unknown }) {
      this.map = opts.map ?? null;
    }
    addEventListener() {}
  }
  class FakeInfoWindow {
    setContent() {}
    open() {}
    close() {}
    addListener() {}
  }
  class FakeGeocoder {
    geocode() {
      // No-op — these tests don't drive geocoding.
    }
  }
  class FakeBounds {
    extend() {}
    getCenter() {
      return { lat: () => 0, lng: () => 0 };
    }
  }
  const w = window as unknown as {
    google?: { maps?: unknown };
    __housingopsMapsLoader?: Promise<void>;
  };
  w.google = {
    maps: {
      Map: FakeMap,
      marker: { AdvancedMarkerElement: FakeAdvancedMarkerElement },
      Geocoder: FakeGeocoder,
      LatLngBounds: FakeBounds,
      InfoWindow: FakeInfoWindow,
    },
  };
  w.__housingopsMapsLoader = Promise.resolve();
}

function uninstallFakeGoogleMaps() {
  const w = window as unknown as {
    google?: unknown;
    __housingopsMapsLoader?: unknown;
  };
  delete w.google;
  delete w.__housingopsMapsLoader;
}

function makeHarness(initialPath: string) {
  const memory = memoryLocation({ path: initialPath, record: true });
  // PropertyLocationMap renders the Re-check-key affordance from
  // Task #181, which calls `useQueryClient()` even though this file
  // mocks `useGetRuntimeConfig` to return a synchronous fixture (no
  // real query). Without a QueryClientProvider in the tree the hook
  // throws on mount. The client itself is never used here — the
  // mocked config short-circuits the runtime fetch — so a bare
  // default-options client is enough.
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, gcTime: 0 },
    },
  });
  function Harness() {
    return (
      <QueryClientProvider client={queryClient}>
        <Router hook={memory.hook}>
          <Switch>
            <Route path="/properties/:id" component={PropertyDetail} />
          </Switch>
        </Router>
      </QueryClientProvider>
    );
  }
  return { memory, Harness };
}

describe("Property detail — Location map tailored key-error copy on Overview", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    toastMock.mockReset();
    // Reset the module-level Google Maps key-error store between
    // tests in this file. The shared store is process-wide (so cross-
    // surface error coordination works in production); without an
    // explicit reset, the first test's `RefererNotAllowedMapError`
    // would persist into later tests and immediately steal the canvas
    // out of the SDK branch — a pre-existing latent bleed exposed
    // once a single test in the file flips the store.
    __resetGoogleMapsKeyErrorForTest();
    __resetGoogleMapsSdkForTest();
    installFakeGoogleMaps();
    container = document.createElement("div");
    document.body.appendChild(container);
    // Ensure the page lands on the Overview tab — the page reads the
    // initial active tab from `?tab=` and Overview is the default.
    window.history.replaceState({}, "", "/properties/p1");
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
    uninstallFakeGoogleMaps();
    __resetGoogleMapsSdkForTest();
    __resetGoogleMapsKeyErrorForTest();
  });

  async function renderPage() {
    const { Harness } = makeHarness("/properties/p1");
    await act(async () => {
      root = createRoot(container);
      root.render(<Harness />);
    });
    // Drain a microtask + macrotask cycle so the SDK loader's
    // resolved-promise.then callback commits `setStatus("ready")`
    // before the test starts asserting on the canvas being mounted.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }

  function get(testId: string): HTMLElement | null {
    return container.querySelector(
      `[data-testid="${testId}"]`,
    ) as HTMLElement | null;
  }

  it("swaps the embedded map for the tailored 'add this site to the key's HTTP referrer allowlist' copy when the shared store reports RefererNotAllowedMapError", async () => {
    await renderPage();

    // Sanity: the real PropertyLocationMap is mounted on Overview and
    // is in the SDK canvas branch (key resolved, address present), not
    // in the error / fallback / empty branches. If the page ever stops
    // hosting the component, or the component starts hiding behind
    // a different default branch, we want this test to fail loudly
    // before the key-error step.
    expect(get("card-property-location")).not.toBeNull();
    expect(get("property-location-map-canvas")).not.toBeNull();
    expect(get("property-location-map-error")).toBeNull();
    expect(get("property-location-fallback")).toBeNull();
    expect(get("property-location-empty")).toBeNull();

    await act(async () => {
      reportGoogleMapsKeyError("RefererNotAllowedMapError");
    });

    // SDK canvas yields entirely to the dedicated error surface —
    // a regression that layered the warning over a still-mounted
    // canvas would still let Google's grey error tile show through.
    expect(get("property-location-map-canvas")).toBeNull();
    expect(get("property-location-map-link")).toBeNull();

    const panel = get("property-location-map-error");
    expect(panel).not.toBeNull();
    // The data-error-code attribute is the lookup hook — its value
    // proves the reported code reached the panel and was used to
    // pick the tailored copy (not the generic fallback).
    expect(panel!.getAttribute("data-error-code")).toBe(
      "RefererNotAllowedMapError",
    );

    // The visible operator-facing copy must name the concrete fix from
    // the task: add this site to the key's HTTP referrer allowlist.
    const text = (
      get("property-location-map-error-text")?.textContent ?? ""
    );
    expect(text).toContain(
      "Add this site to the key's HTTP referrer allowlist",
    );
    // And it must NOT be the generic "Google rejected this Maps API
    // key. Check that the Maps Embed API is enabled…" catch-all line —
    // if it were, the reported code would have been ignored and we'd
    // be back to the pre-Task-#163 behavior.
    expect(text).not.toContain(
      "Check that the Maps Embed API is enabled and that this domain is on the key's allowlist",
    );
  });

  it("shows the raw code verbatim alongside the generic fix line when the shared store reports a code we don't recognize (e.g. a newly-introduced or renamed *MapError)", async () => {
    // Pin down the page-level integration of the unknown-code branch.
    // Without this the page could silently regress (e.g. swap the
    // Location card for a wrapper that ate the unknown code) and the
    // operator would be back to staring at an unexplained blank
    // canvas. Picking a code that obviously isn't in
    // MAPS_ERROR_MESSAGES guarantees the assertion is exercising the
    // unknown-code path and not a tailored line that happens to
    // mention the same word.
    const unknownCode = "BrandNewSurpriseMapError";
    await renderPage();

    expect(get("property-location-map-canvas")).not.toBeNull();
    expect(get("property-location-map-error")).toBeNull();

    await act(async () => {
      reportGoogleMapsKeyError(unknownCode);
    });

    const panel = get("property-location-map-error");
    expect(panel).not.toBeNull();
    // The lookup hook still records the exact code reported, so a
    // support ticket can quote it verbatim.
    expect(panel!.getAttribute("data-error-code")).toBe(unknownCode);

    const text = (
      get("property-location-map-error-text")?.textContent ?? ""
    );
    // Visible copy names the actual code reported plus the generic
    // fix line — that's the whole point of the unknown-code branch.
    expect(text).toContain(unknownCode);
    expect(text).toContain("Google reported");
    expect(text).toContain(
      "Check that the Maps Embed API is enabled and that this domain is on the key's allowlist",
    );
  });

  it("shows the tailored 'over its daily Google Maps Embed quota' copy when the shared store reports OverQuotaMapError, exercising the lookup table with a second code", async () => {
    await renderPage();

    expect(get("property-location-map-canvas")).not.toBeNull();
    expect(get("property-location-map-error")).toBeNull();

    await act(async () => {
      reportGoogleMapsKeyError("OverQuotaMapError");
    });

    const panel = get("property-location-map-error");
    expect(panel).not.toBeNull();
    expect(panel!.getAttribute("data-error-code")).toBe("OverQuotaMapError");

    const text = (
      get("property-location-map-error-text")?.textContent ?? ""
    );
    // The OverQuotaMapError tailored line in MAPS_ERROR_MESSAGES reads:
    //   "This Maps API key is over its daily Google Maps Embed quota.
    //    Raise the quota in Google Cloud Console or wait for it to reset."
    // Pin the substrings that name the actual fix on the operator's
    // Google Cloud Console — they're what makes the message tailored
    // rather than generic.
    expect(text).toContain("over its daily Google Maps Embed quota");
    expect(text).toContain("Raise the quota in Google Cloud Console");

    // Cross-check: the RefererNotAllowedMapError copy must NOT appear
    // here — that would mean the lookup table collapsed both codes to
    // the same line, defeating the purpose of having a table.
    expect(text).not.toContain("HTTP referrer allowlist");
  });
});
