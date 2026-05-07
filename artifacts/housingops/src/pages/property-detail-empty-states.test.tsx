import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

// Regression coverage for task #132: each per-property tab on the
// Property Detail page should fall through to the branded EmptyState
// block (icon + headline + Add CTA) instead of bare em-dashes when its
// dataset is empty. Pinning the Utilities tab here is the simplest
// proof — a future refactor that drops EmptyState from any per-property
// tab fails this test loudly instead of silently shipping a dead-
// looking demo.

vi.mock("@/components/layout/main-layout", () => ({
  MainLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

// PropertyLocationMap fetches the Google Maps key from the api-server's
// `/api/config` endpoint via react-query (Task #154). These tests don't
// stand up a QueryClientProvider, so render it as a benign placeholder.
vi.mock("@workspace/api-client-react", () => ({
  useListRoomNightLogs: () => ({ data: [] }),
}));

vi.mock("@/components/property-location-map", () => ({
  PropertyLocationMap: () => <div data-testid="mock-property-location-map" />,
}));

vi.mock("framer-motion", async () => {
  const { createMotionMock } = await import("@/test-utils/framer-motion-mock");
  return createMotionMock();
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn(), dismiss: vi.fn(), toasts: [] }),
}));

// Wouter — pin the URL params + location so PropertyDetail mounts
// against a known property and lands on the Utilities tab on first
// render.
vi.mock("wouter", () => ({
  useParams: () => ({ id: "p1" }),
  useLocation: () => ["/properties/p1", vi.fn()] as const,
  Link: ({ children, ...rest }: { children: ReactNode } & Record<string, unknown>) => (
    <a {...rest}>{children}</a>
  ),
}));

// Radix portals (Dialog / Popover / Tooltip) don't play nicely with
// jsdom and aren't relevant to verifying the EmptyState render.
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

vi.mock("@/components/ui/tooltip", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Tooltip: Pass,
    TooltipTrigger: Pass,
    TooltipContent: () => null,
    TooltipProvider: Pass,
  };
});

// Minimal Select stub so the toolbar Selects don't crash under jsdom.
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

// One property, everything else empty — every per-property tab should
// land on its EmptyState.
const seededProperty = {
  id: "p1",
  customerId: "c1",
  name: "Test Property",
  address: "123 Test St",
  city: "Austin",
  state: "TX",
  zip: "78701",
  type: "House",
  paymentMethod: "Bank Transfer",
  bankName: "",
  bankRouting: "",
  bankAccount: "",
  portalUrl: "",
  paymentNotes: "",
  notes: "",
  furnishings: [] as string[],
  ratings: undefined,
};

const emptyState = {
  customers: [{ id: "c1", name: "Acme" }],
  properties: [seededProperty],
  beds: [],
  leases: [],
  rooms: [],
  occupants: [],
  utilities: [],
  insuranceCertificates: [],
  isLoading: false,
  updateProperty: vi.fn(),
  updateLease: vi.fn(),
  addLease: vi.fn(),
  deleteLease: vi.fn(),
  addRoom: vi.fn(),
  updateRoom: vi.fn(),
  deleteRoom: vi.fn(),
  addBed: vi.fn(),
  deleteBed: vi.fn(),
  updateBed: vi.fn(),
  updateOccupant: vi.fn(),
  addOccupant: vi.fn(),
  updateUtility: vi.fn(),
  addUtility: vi.fn(),
  deleteUtility: vi.fn(),
  addInsuranceCertificate: vi.fn(),
  updateInsuranceCertificate: vi.fn(),
  deleteInsuranceCertificate: vi.fn(),
};

vi.mock("@/context/data-store", () => ({
  useData: () => emptyState,
  RoomInUseError: class RoomInUseError extends Error {},
}));

import PropertyDetail from "./property-detail";

function mount(node: ReactNode, container: HTMLDivElement) {
  let root: Root | null = null;
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  act(() => {
    root = createRoot(container);
    root.render(node);
  });
  return root!;
}

describe("Empty-state graphics on per-property tabs", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
    // Land directly on the Utilities tab — PropertyDetail reads the
    // initial active tab from window.location's `?tab=` query string.
    window.history.replaceState({}, "", "/properties/p1?tab=utilities");
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

  it("Utilities tab renders the EmptyState with an Add Service CTA when the property has no utilities", async () => {
    await act(async () => {
      root = mount(<PropertyDetail />, container);
    });

    const empty = container.querySelector(
      '[data-testid="empty-property-utilities"]',
    );
    expect(empty).not.toBeNull();
    expect(empty!.textContent).toContain("No utility services yet");
    const cta = container.querySelector(
      '[data-testid="button-add-utility-empty"]',
    );
    expect(cta).not.toBeNull();
    expect(cta!.textContent).toContain("Add Service");
  });

  // Regression coverage for task #134: the Furnishings tab should
  // render the same branded EmptyState block when a property has no
  // furnishings selected yet, hinting operators at the category
  // checklists below.
  it("Furnishings tab renders the EmptyState when the property has no furnishings selected", async () => {
    window.history.replaceState({}, "", "/properties/p1?tab=furnishings");

    await act(async () => {
      root = mount(<PropertyDetail />, container);
    });

    const empty = container.querySelector(
      '[data-testid="empty-property-furnishings"]',
    );
    expect(empty).not.toBeNull();
    expect(empty!.textContent).toContain("No furnishings selected yet");
    expect(empty!.textContent).toContain("category checklists");
  });

  // Second branch from task #134 (regression coverage added in task
  // #136): when the user types a search query that doesn't match
  // anything, the same branded Sofa-icon EmptyState replaces the old
  // plain-text "No furnishings match …" line. Seed the property with at
  // least one furnishing so the no-furnishings-yet EmptyState is *not*
  // the thing under test — only the search-empty branch should fire.
  it("Furnishings tab renders the search EmptyState when the filter eliminates all categories", async () => {
    window.history.replaceState({}, "", "/properties/p1?tab=furnishings");
    seededProperty.furnishings = ["Queen Bed"];

    try {
      await act(async () => {
        root = mount(<PropertyDetail />, container);
      });

      const searchInput = container.querySelector(
        '[data-testid="furnishings-search"]',
      ) as HTMLInputElement | null;
      expect(searchInput).not.toBeNull();

      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value",
        )!.set!;
        setter.call(searchInput, "zzz-no-such-furnishing");
        searchInput!.dispatchEvent(new Event("input", { bubbles: true }));
      });

      const empty = container.querySelector(
        '[data-testid="empty-property-furnishings-search"]',
      );
      expect(empty).not.toBeNull();
      expect(empty!.textContent).toContain("No furnishings match");
      expect(empty!.textContent).toContain("zzz-no-such-furnishing");
      // Sofa-icon EmptyState block — lucide renders an <svg> with a
      // `lucide-sofa` class so a future swap to the bare text line
      // fails this test loudly.
      expect(empty!.querySelector("svg.lucide-sofa")).not.toBeNull();

      // And the no-furnishings-yet EmptyState must *not* render, since
      // the property has a furnishing selected — this guards against
      // accidentally collapsing both branches into one.
      expect(
        container.querySelector('[data-testid="empty-property-furnishings"]'),
      ).toBeNull();
    } finally {
      seededProperty.furnishings = [];
    }
  });
});
