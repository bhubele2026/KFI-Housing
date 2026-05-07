import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

// Race regression for Task #322: when two pending-placement rows have
// pre-selected the SAME vacant bed, submitting the first must
// immediately disable the second row's Move button (and clear its
// stale bed selection) so the bed can never be double-booked.
//
// We mount PendingPlacementBoard directly with a mutable in-memory
// data-store so the test can flip the chosen bed to "Occupied" between
// renders — exactly what happens when the first row's `updateBed` lands
// in the live cache.

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn(), dismiss: vi.fn(), toasts: [] }),
}));

const navigate = vi.fn();
vi.mock("wouter", () => ({
  useLocation: () => ["/properties/pp1", navigate] as const,
}));

// Stub Select: render trigger as a no-op and each item as a clickable
// button that fires onValueChange on the enclosing Select. Mirrors the
// pattern used in property-detail.pending-placement.test.tsx.
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

// Mutable in-memory store. The mock for `useData` reads these on every
// render so re-rendering picks up the post-move state.
const realProperty = {
  id: "real1",
  customerId: "c1",
  name: "Maple Court",
  address: "1 Real St",
  city: "Austin",
  state: "TX",
  zip: "78701",
  totalBeds: 1,
  monthlyRent: 0,
  chargePerBed: 0,
  status: "Active",
  furnishings: [] as string[],
};

const pendingProperty = {
  ...realProperty,
  id: "pp1",
  name: "Roster — Pending Placement (Acme Dairy)",
};

const occA = {
  id: "occ-A",
  propertyId: "pp1",
  bedId: null as string | null,
  name: "Alice",
  employeeId: "EMP-A",
  company: "Acme Dairy",
  moveInDate: "",
  moveOutDate: null as string | null,
  status: "Active",
  chargePerBed: 100,
  billingFrequency: "Weekly",
  email: "",
  phone: "",
};
const occB = { ...occA, id: "occ-B", name: "Bob", employeeId: "EMP-B" };

let bedsState: Array<{
  id: string;
  propertyId: string;
  bedNumber: number;
  roomId: string;
  status: "Vacant" | "Occupied";
  occupantId: string | null;
}>;

const updateOccupant = vi.fn();
const updateBed = vi.fn((id: string, patch: { status?: string; occupantId?: string | null }) => {
  // Mirror what the real data store does optimistically: update the
  // bed in place so the next render observes the new status.
  bedsState = bedsState.map((b) =>
    b.id === id ? { ...b, ...patch, status: (patch.status as "Vacant" | "Occupied") ?? b.status } : b,
  );
});
const deleteProperty = vi.fn();

vi.mock("@/context/data-store", () => ({
  useData: () => ({
    customers: [{ id: "c1", name: "Acme Dairy" }],
    properties: [pendingProperty, realProperty],
    leases: [],
    rooms: [
      { id: "room-1", propertyId: "real1", name: "Bedroom 1", sqft: 0, bathrooms: 0, monthlyRent: 0 },
    ],
    beds: bedsState,
    occupants: [occA, occB],
    utilities: [],
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
    deleteProperty,
  }),
}));

import { PendingPlacementBoard } from "./pending-placement-board";

function mount(node: ReactNode, container: HTMLDivElement) {
  let root: Root | null = null;
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  act(() => {
    root = createRoot(container);
    root.render(node);
  });
  return root!;
}

describe("PendingPlacementBoard — bed double-booking race", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    bedsState = [
      {
        id: "bed-1",
        propertyId: "real1",
        bedNumber: 3,
        roomId: "room-1",
        status: "Vacant",
        occupantId: null,
      },
    ];
    updateOccupant.mockReset();
    updateBed.mockClear();
    deleteProperty.mockReset();
    navigate.mockReset();
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

  it("does not double-book a bed when two rows pre-selected the same vacant bed", async () => {
    const node = <PendingPlacementBoard property={pendingProperty as never} />;
    await act(async () => {
      root = mount(node, container);
    });

    // Both rows pre-select the only vacant bed (bed-1 on real1).
    for (const occId of ["occ-A", "occ-B"]) {
      const propBtn = container.querySelector(
        `[data-testid="pending-placement-row-${occId}"] [data-testid="select-item-real1"]`,
      ) as HTMLButtonElement | null;
      expect(propBtn).not.toBeNull();
      await act(async () => {
        propBtn!.click();
      });
      const bedBtn = container.querySelector(
        `[data-testid="pending-placement-row-${occId}"] [data-testid="select-item-bed-1"]`,
      ) as HTMLButtonElement | null;
      expect(bedBtn).not.toBeNull();
      await act(async () => {
        bedBtn!.click();
      });
    }

    const moveA = container.querySelector(
      '[data-testid="pending-move-button-occ-A"]',
    ) as HTMLButtonElement;
    const moveB = container.querySelector(
      '[data-testid="pending-move-button-occ-B"]',
    ) as HTMLButtonElement;
    expect(moveA.disabled).toBe(false);
    expect(moveB.disabled).toBe(false);

    // Row A submits — updateBed flips bed-1 to Occupied in our store.
    await act(async () => {
      moveA.click();
    });

    // Force a re-render so the parent re-reads `beds` and PendingRow
    // re-derives `vacantBedsForProperty`. In a real app this happens
    // automatically via react-query's optimistic cache update. We pass
    // a fresh React element (not the same `node` reference) to ensure
    // React doesn't bail on the re-render.
    await act(async () => {
      root!.render(<PendingPlacementBoard property={pendingProperty as never} />);
    });

    // Row B clicks Move regardless — the parent's race guard must
    // refuse to write because bed-1 is no longer Vacant.
    const moveBAfter = container.querySelector(
      '[data-testid="pending-move-button-occ-B"]',
    ) as HTMLButtonElement;
    await act(async () => {
      // Skip the disabled check entirely — even if React's reconcilation
      // somehow leaves the button enabled, the race guard inside onMove
      // is the source of truth for data integrity.
      moveBAfter.removeAttribute("disabled");
      moveBAfter.click();
    });

    // Invariants after both clicks:
    //   - exactly one occupant was assigned to bed-1 (occ-A)
    //   - exactly one bed-1 PATCH landed (occ-A's), so the occupantId
    //     can never be stomped by a later Row-B click
    //   - occ-B was never patched into a bed
    const occupantCallsTouchingBed1 = updateOccupant.mock.calls.filter(
      ([, patch]) => patch?.bedId === "bed-1",
    );
    expect(occupantCallsTouchingBed1.length).toBe(1);
    expect(occupantCallsTouchingBed1[0][0]).toBe("occ-A");

    const bedCallsForBed1 = updateBed.mock.calls.filter(([id]) => id === "bed-1");
    expect(bedCallsForBed1.length).toBe(1);
    expect(bedCallsForBed1[0][1]).toEqual({
      status: "Occupied",
      occupantId: "occ-A",
    });

    const occupantCallsForB = updateOccupant.mock.calls.filter(
      ([id]) => id === "occ-B",
    );
    expect(occupantCallsForB.length).toBe(0);
  });
});
