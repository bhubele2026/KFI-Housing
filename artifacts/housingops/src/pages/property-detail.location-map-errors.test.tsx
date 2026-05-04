import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Switch, Route, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

// Pin down that the property-detail page actually integrates the
// postMessage-driven, tailored-copy error branch of PropertyLocationMap
// (Task #163). The component-level tests in
// `src/components/property-location-map.test.tsx` mount the component
// directly and prove the listener / lookup wiring inside the component.
// What they CAN'T prove is that the page still hosts that component on
// the Overview tab — a future refactor that swaps the Location card for
// a different one, or wraps it in a parent that strips the message
// source, would silently regress the operator-facing copy without
// breaking any existing test.
//
// These tests close that gap. They mount the full Property Detail page
// against a memory router, let the real PropertyLocationMap render,
// dispatch a Google Maps `postMessage` against the mounted iframe's
// contentWindow, and assert that the tailored line for the posted code
// is visible on the page (not the generic catch-all). Two codes are
// covered so the lookup-table integration is exercised with more than
// one entry.

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
// pulls from `@workspace/api-client-react` so the component synchronously
// resolves to a non-empty key and renders the embed iframe (which is
// what the postMessage listener subscribes to). This sidesteps having
// to stand up a QueryClientProvider + a fake `/api/config` fetch in
// every page-level test setup, while still letting the page's own
// `<PropertyLocationMap address=... />` code path run end-to-end.
vi.mock("@workspace/api-client-react", () => ({
  useGetRuntimeConfig: () => ({
    data: { googleMapsApiKey: "test-key-page-level" },
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
// embed branch (rather than its empty state).
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

function makeHarness(initialPath: string) {
  const memory = memoryLocation({ path: initialPath, record: true });
  function Harness() {
    return (
      <Router hook={memory.hook}>
        <Switch>
          <Route path="/properties/:id" component={PropertyDetail} />
        </Switch>
      </Router>
    );
  }
  return { memory, Harness };
}

// Mirror the helper in src/components/property-location-map.test.tsx —
// dispatch a `message` event whose source is the mounted iframe's own
// contentWindow. The component gates on `event.source === iframe.contentWindow`
// (its single provenance check), so anything else is ignored.
function fireGoogleMapsErrorMessage(
  iframe: HTMLIFrameElement,
  payload: unknown,
) {
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

describe("Property detail — Location map tailored key-error copy on Overview", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    toastMock.mockReset();
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
  });

  async function renderPage() {
    const { Harness } = makeHarness("/properties/p1");
    await act(async () => {
      root = createRoot(container);
      root.render(<Harness />);
    });
  }

  function get(testId: string): HTMLElement | null {
    return container.querySelector(
      `[data-testid="${testId}"]`,
    ) as HTMLElement | null;
  }

  it("swaps the embedded map for the tailored 'add this site to the key's HTTP referrer allowlist' copy when Google posts RefererNotAllowedMapError", async () => {
    await renderPage();

    // Sanity: the real PropertyLocationMap is mounted on Overview and
    // is in the embed branch (key resolved, address present), not in
    // the error / fallback / empty branches. If the page ever stops
    // hosting the component, or the component starts hiding behind
    // a different default branch, we want this test to fail loudly
    // before the postMessage step.
    expect(get("card-property-location")).not.toBeNull();
    const iframe = get(
      "property-location-map-iframe",
    ) as HTMLIFrameElement | null;
    expect(iframe).not.toBeNull();
    expect(get("property-location-map-error")).toBeNull();
    expect(get("property-location-fallback")).toBeNull();
    expect(get("property-location-empty")).toBeNull();

    await act(async () => {
      fireGoogleMapsErrorMessage(iframe!, {
        code: "RefererNotAllowedMapError",
      });
    });

    // Embed surface yields entirely to the dedicated error surface —
    // a regression that layered the warning over a still-mounted
    // iframe would still let Google's grey error tile show through.
    expect(get("property-location-map-iframe")).toBeNull();
    expect(get("property-location-map-link")).toBeNull();

    const panel = get("property-location-map-error");
    expect(panel).not.toBeNull();
    // The data-error-code attribute is the lookup hook — its value
    // proves the postMessage code reached the panel and was used
    // to pick the tailored copy (not the generic fallback).
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
    // if it were, the postMessage code would have been ignored and
    // we'd be back to the pre-Task-#163 behavior.
    expect(text).not.toContain(
      "Check that the Maps Embed API is enabled and that this domain is on the key's allowlist",
    );
  });

  it("shows the tailored 'over its daily Google Maps Embed quota' copy when Google posts OverQuotaMapError, exercising the lookup table with a second code", async () => {
    await renderPage();

    const iframe = get(
      "property-location-map-iframe",
    ) as HTMLIFrameElement | null;
    expect(iframe).not.toBeNull();
    expect(get("property-location-map-error")).toBeNull();

    await act(async () => {
      fireGoogleMapsErrorMessage(iframe!, { code: "OverQuotaMapError" });
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
