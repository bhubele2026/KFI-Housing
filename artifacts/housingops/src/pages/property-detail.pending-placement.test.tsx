import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

// Task #322 regression: when an operator opens a synthetic
// "Roster — Pending Placement (<Customer>)" property, PropertyDetail
// must short-circuit the normal property page and render the focused
// PendingPlacementBoard so the per-occupant move-to-bed flow is the
// only thing on screen. The board itself is exercised separately
// below — we just need to prove the route renders it for a
// pending-placement bucket and skips the normal Beds/Tabs layout.

vi.mock("@/components/layout/main-layout", () => ({
  MainLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

// PropertyDetail calls useListRoomNightLogs() at the top of the
// component for the hotel-rate revenue estimate. The hook hits
// useQueryClient(), which throws under jsdom unless the test wraps
// the tree in a QueryClientProvider. Stub it out with a static empty
// dataset so this suite doesn't have to set up React Query just to
// exercise the pending-placement short-circuit.
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

const toast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast, dismiss: vi.fn(), toasts: [] }),
}));

const navigate = vi.fn();
vi.mock("wouter", () => ({
  useParams: () => ({ id: "pp1" }),
  useLocation: () => ["/properties/pp1", navigate] as const,
  Link: ({ children, ...rest }: { children: ReactNode } & Record<string, unknown>) => (
    <a {...rest}>{children}</a>
  ),
}));

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

// Minimal Select stub: render the trigger as a button that exposes the
// onValueChange via a hidden test handle, and render every SelectItem
// as a <button data-value=…> the test can click. This lets us drive
// the property/bed pickers under jsdom without Radix portals.
vi.mock("@/components/ui/select", () => {
  const SelectCtx = require("react").createContext<{
    onValueChange?: (v: string) => void;
  }>({});
  const Select = ({
    children,
    onValueChange,
  }: {
    children?: ReactNode;
    onValueChange?: (v: string) => void;
  }) => (
    <SelectCtx.Provider value={{ onValueChange }}>
      <div>{children}</div>
    </SelectCtx.Provider>
  );
  const SelectItem = ({
    children,
    value,
  }: {
    children?: ReactNode;
    value: string;
  }) => {
    const ctx = require("react").useContext(SelectCtx);
    return (
      <button
        type="button"
        data-value={value}
        data-testid={`select-item-${value}`}
        onClick={() => ctx.onValueChange?.(value)}
      >
        {children}
      </button>
    );
  };
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Select,
    SelectContent: Pass,
    SelectGroup: Pass,
    SelectItem,
    SelectLabel: Pass,
    SelectScrollDownButton: Pass,
    SelectScrollUpButton: Pass,
    SelectSeparator: Pass,
    SelectTrigger: Pass,
    SelectValue: Pass,
  };
});

const customers = [
  { id: "c1", name: "Acme Dairy" },
  { id: "c2", name: "Other" },
];

const pendingProperty = {
  id: "pp1",
  customerId: "c1",
  name: "Roster — Pending Placement (Acme Dairy)",
  address: "",
  city: "",
  state: "",
  zip: "",
  totalBeds: 0,
  monthlyRent: 0,
  chargePerBed: 0,
  status: "Active",
  furnishings: [] as string[],
  ratings: undefined,
};

const realProperty = {
  ...pendingProperty,
  id: "real1",
  name: "Maple Court",
  address: "1 Real St",
  city: "Austin",
  state: "TX",
  zip: "78701",
};

const pendingOccupant = {
  id: "occ-pending-1",
  propertyId: "pp1",
  bedId: null as string | null,
  name: "Jane Smith",
  employeeId: "EMP-1",
  company: "Acme Dairy",
  moveInDate: "",
  moveOutDate: null as string | null,
  status: "Active",
  chargePerBed: 125,
  billingFrequency: "Weekly",
  email: "",
  phone: "",
};

const vacantBed = {
  id: "bed-1",
  propertyId: "real1",
  bedNumber: 3,
  roomId: "room-1",
  status: "Vacant" as const,
  occupantId: null as string | null,
};

const updateOccupant = vi.fn();
const updateBed = vi.fn();
const deleteProperty = vi.fn();

vi.mock("@/context/data-store", () => ({
  useData: () => ({
    customers,
    properties: [pendingProperty, realProperty],
    leases: [],
    rooms: [{ id: "room-1", propertyId: "real1", name: "Bedroom 1", sqft: 0, bathrooms: 0, monthlyRent: 0 }],
    beds: [vacantBed],
    occupants: [pendingOccupant],
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
    updateBed,
    updateOccupant,
    addOccupant: vi.fn(),
    deleteOccupant: vi.fn(),
    updateUtility: vi.fn(),
    addUtility: vi.fn(),
    deleteUtility: vi.fn(),
    addInsuranceCertificate: vi.fn(),
    updateInsuranceCertificate: vi.fn(),
    deleteInsuranceCertificate: vi.fn(),
    deleteProperty,
    dataIssues: [],
  }),
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

describe("PropertyDetail — pending-placement bucket", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    updateOccupant.mockReset();
    updateBed.mockReset();
    deleteProperty.mockReset();
    navigate.mockReset();
    toast.mockReset();
    window.history.replaceState({}, "", "/properties/pp1");
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

  it("renders the focused board (and skips the normal Tabs layout) for a pending-placement property", async () => {
    await act(async () => {
      root = mount(<PropertyDetail />, container);
    });

    expect(
      container.querySelector('[data-testid="property-detail-pending-placement"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="pending-placement-board"]'),
    ).not.toBeNull();
    // Pending occupant row is on screen.
    expect(
      container.querySelector(
        `[data-testid="pending-placement-row-${pendingOccupant.id}"]`,
      ),
    ).not.toBeNull();
    expect(
      container.querySelector(`[data-testid="pending-name-${pendingOccupant.id}"]`)
        ?.textContent,
    ).toContain("Jane Smith");
  });

  it("moves the existing occupant (no addOccupant) and auto-deletes the empty bucket on the last move", async () => {
    await act(async () => {
      root = mount(<PropertyDetail />, container);
    });

    // Pick the real property + the only vacant bed via the stubbed Select.
    const propertyOption = container.querySelector(
      '[data-testid="select-item-real1"]',
    ) as HTMLButtonElement | null;
    expect(propertyOption).not.toBeNull();
    await act(async () => {
      propertyOption!.click();
    });

    const bedOption = container.querySelector(
      '[data-testid="select-item-bed-1"]',
    ) as HTMLButtonElement | null;
    expect(bedOption).not.toBeNull();
    await act(async () => {
      bedOption!.click();
    });

    const moveBtn = container.querySelector(
      `[data-testid="pending-move-button-${pendingOccupant.id}"]`,
    ) as HTMLButtonElement | null;
    expect(moveBtn).not.toBeNull();
    expect(moveBtn!.disabled).toBe(false);
    await act(async () => {
      moveBtn!.click();
    });

    // The EXISTING occupant gets patched with the new propertyId/bedId
    // and a real moveInDate. We must NOT see a brand-new occupant id —
    // any duplicate insert would orphan the pending row.
    expect(updateOccupant).toHaveBeenCalledTimes(1);
    const [movedId, patch] = updateOccupant.mock.calls[0];
    expect(movedId).toBe(pendingOccupant.id);
    expect(patch.propertyId).toBe("real1");
    expect(patch.bedId).toBe("bed-1");
    expect(typeof patch.moveInDate).toBe("string");
    expect(patch.moveInDate.length).toBeGreaterThan(0);

    expect(updateBed).toHaveBeenCalledWith("bed-1", {
      status: "Occupied",
      occupantId: pendingOccupant.id,
    });

    // Last pending occupant moved → bucket auto-deleted and operator
    // routed back to /properties.
    expect(deleteProperty).toHaveBeenCalledWith("pp1");
    expect(navigate).toHaveBeenCalledWith("/properties");
  });
});
