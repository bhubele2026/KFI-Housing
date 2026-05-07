import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("@/components/layout/main-layout", () => ({
  MainLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("framer-motion", async () => {
  const { createMotionMock } = await import("@/test-utils/framer-motion-mock");
  return createMotionMock();
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn(), dismiss: vi.fn(), toasts: [] }),
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

vi.mock("@/components/ui/alert-dialog", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    AlertDialog: Pass,
    AlertDialogTrigger: Pass,
    AlertDialogContent: () => null,
    AlertDialogHeader: Pass,
    AlertDialogTitle: Pass,
    AlertDialogDescription: Pass,
    AlertDialogFooter: Pass,
    AlertDialogAction: Pass,
    AlertDialogCancel: Pass,
  };
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

vi.mock("@/components/ui/dropdown-menu", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    DropdownMenu: Pass,
    DropdownMenuTrigger: Pass,
    DropdownMenuContent: ({ children }: { children?: ReactNode }) => <>{children}</>,
    DropdownMenuItem: Pass,
    DropdownMenuLabel: Pass,
    DropdownMenuSeparator: Pass,
  };
});

const baseProperty = {
  address: "123 Main St",
  city: "Somewhere",
  state: "TX",
  zip: "00000",
  totalBeds: 0,
  monthlyRent: 0,
  chargePerBed: 0,
  status: "Active" as const,
  landlordName: "",
  landlordEmail: "",
  landlordPhone: "",
  paymentMethod: "ACH" as const,
  paymentRecipient: "",
  paymentDueDay: 1,
  paymentNotes: "",
  bankName: "",
  bankRouting: "",
  bankAccount: "",
  portalUrl: "",
  notes: "",
  furnishings: [],
};

const baseOccupant = {
  name: "",
  email: "",
  phone: "",
  moveInDate: "2025-01-01",
  moveOutDate: null,
  employeeId: "",
  company: "",
};

type State = {
  customers: Array<Record<string, unknown>>;
  properties: Array<Record<string, unknown>>;
  beds: Array<Record<string, unknown>>;
  occupants: Array<Record<string, unknown>>;
  leases: Array<Record<string, unknown>>;
};

function makeState(): State {
  return {
    customers: [
      { id: "c1", name: "Acme Co", contactName: "", email: "", phone: "", notes: "", state: "TX" },
      { id: "c2", name: "Globex", contactName: "", email: "", phone: "", notes: "", state: "TX" },
      { id: "c3", name: "Penda", contactName: "", email: "", phone: "", notes: "", state: "WI" },
    ],
    properties: [
      { ...baseProperty, id: "p1", customerId: "c1", name: "Maple House" },
      { ...baseProperty, id: "p2", customerId: "c2", name: "Pine Lodge" },
      {
        ...baseProperty,
        id: "p3",
        customerId: "c3",
        sharedWithCustomerIds: ["c1"],
        name: "Ridge Motor Inn",
        state: "WI",
      },
    ],
    beds: [
      { id: "b1", propertyId: "p1", bedNumber: 1, room: "R1", status: "Occupied", occupantId: "o1" },
      { id: "b2", propertyId: "p1", bedNumber: 2, room: "R1", status: "Vacant", occupantId: null },
      { id: "b3", propertyId: "p2", bedNumber: 1, room: "R1", status: "Occupied", occupantId: "o2" },
      { id: "b4", propertyId: "p3", bedNumber: 1, room: "R1", status: "Occupied", occupantId: "o3" },
      { id: "b5", propertyId: "p3", bedNumber: 2, room: "R1", status: "Occupied", occupantId: "o4" },
    ],
    occupants: [
      { ...baseOccupant, id: "o1", bedId: "b1", propertyId: "p1", status: "Active", chargePerBed: 600, billingFrequency: "Monthly" },
      { ...baseOccupant, id: "o2", bedId: "b3", propertyId: "p2", status: "Active", chargePerBed: 400, billingFrequency: "Monthly" },
      { ...baseOccupant, id: "o3", bedId: "b4", propertyId: "p3", status: "Active", chargePerBed: 500, billingFrequency: "Monthly" },
      { ...baseOccupant, id: "o4", bedId: "b5", propertyId: "p3", status: "Active", chargePerBed: 500, billingFrequency: "Monthly" },
    ],
    leases: [],
  };
}

let state: State = makeState();

vi.mock("@/context/data-store", () => ({
  useData: () => ({
    ...state,
    isLoading: false,
    addCustomer: vi.fn(),
    updateCustomer: vi.fn(),
    deleteCustomer: vi.fn(),
  }),
  CustomerInUseError: class extends Error {},
}));

import Customers from "./customers";

describe("Customers list shared-housing roll-up", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    state = makeState();
    window.history.replaceState({}, "", "/customers");
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

  async function renderPage() {
    await act(async () => {
      root = createRoot(container);
      root.render(<Customers />);
    });
  }

  function get(testId: string): HTMLElement | null {
    return container.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;
  }

  it("includes shared-housing properties in a customer's beds and revenue totals (task #390)", async () => {
    await renderPage();

    const c1Beds = get("cell-customer-beds-c1");
    expect(c1Beds).not.toBeNull();
    expect(c1Beds!.textContent).toContain("3");
    expect(c1Beds!.textContent).toContain("4");

    const c1Revenue = get("cell-customer-revenue-c1");
    expect(c1Revenue).not.toBeNull();
    expect(c1Revenue!.textContent).toContain("1,600");

    const c3Beds = get("cell-customer-beds-c3");
    expect(c3Beds).not.toBeNull();
    expect(c3Beds!.textContent).toContain("2");

    const c3Revenue = get("cell-customer-revenue-c3");
    expect(c3Revenue).not.toBeNull();
    expect(c3Revenue!.textContent).toContain("1,000");

    const c2Beds = get("cell-customer-beds-c2");
    expect(c2Beds).not.toBeNull();
    expect(c2Beds!.textContent).toContain("1");

    const c2Revenue = get("cell-customer-revenue-c2");
    expect(c2Revenue).not.toBeNull();
    expect(c2Revenue!.textContent).toContain("400");
  });

  it("counts the shared property toward the customer's property count", async () => {
    await renderPage();

    const c1Props = get("link-customer-properties-c1");
    expect(c1Props).not.toBeNull();
    expect(c1Props!.textContent).toContain("2");

    const c3Props = get("link-customer-properties-c3");
    expect(c3Props).not.toBeNull();
    expect(c3Props!.textContent).toContain("1");
  });
});
