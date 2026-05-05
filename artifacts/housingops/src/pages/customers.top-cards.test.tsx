import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

// These tests pin down which customer the two summary cards on the
// Customers page surface ("highest occupancy", "highest monthly
// revenue"). The picker logic lives in the `topCustomers` memo on
// customers.tsx and has subtle rules that are easy to regress when the
// stats roll-up changes:
//   • Only customers with at least one bed qualify for the occupancy
//     card — a customer with 0/0 beds must never appear.
//   • Only customers with > $0 monthly revenue qualify for the revenue
//     card.
//   • Occupancy ties are broken by higher monthly revenue, so two
//     customers at 80% are not interchangeable.
//
// We render the real page against a mocked data store (same pattern as
// customers.sort.test.tsx) so any regression in the roll-up *or* the
// picker fails here loudly rather than silently swapping the surfaced
// customer in production.

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
    AlertDialogPortal: Pass,
    AlertDialogOverlay: () => null,
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
    DropdownMenuContent: () => null,
    DropdownMenuItem: Pass,
    DropdownMenuLabel: Pass,
    DropdownMenuSeparator: Pass,
  };
});

// ── Mock data store ──────────────────────────────────────────────────
//
// The fixture is hand-tuned so each card has a clear winner AND we
// exercise every rule in the picker:
//
//   c1 Alpha → 10 beds, 8 occupied (80%), $1,000/mo
//   c2 Beta  → 10 beds, 8 occupied (80%), $2,000/mo  ← occupancy tie
//                                                       with Alpha,
//                                                       wins on revenue
//   c3 Gamma → 10 beds, 5 occupied (50%), $5,000/mo  ← top revenue
//   c4 Delta → 0 beds (no beds at all), $0/mo        ← never picked
//   c5 Echo  → 4 beds, 0 occupied (0%), $0/mo        ← has beds but
//                                                       no revenue —
//                                                       never picked
//                                                       for revenue
//
// Expected: top-occupancy = Beta, top-revenue = Gamma.
type State = {
  customers: Array<Record<string, unknown>>;
  properties: Array<Record<string, unknown>>;
  beds: Array<Record<string, unknown>>;
  occupants: Array<Record<string, unknown>>;
};

function makeFreshState(): State {
  const customer = (id: string, name: string) => ({
    id, name, contactName: "", email: "", phone: "", notes: "",
  });
  const property = (id: string, customerId: string) => ({
    id, customerId, name: id, address: "1 Main", city: "Austin", state: "TX",
    zip: "78701", totalBeds: 0, monthlyRent: 0, chargePerBed: 0,
    status: "Active", landlordName: "", landlordEmail: "", landlordPhone: "",
    paymentMethod: "ACH", paymentRecipient: "", paymentDueDay: 1,
    paymentNotes: "", bankName: "", bankRouting: "", bankAccount: "",
    portalUrl: "", notes: "", furnishings: [], ratings: undefined,
  });
  const bed = (id: string, propertyId: string, occupied: boolean) => ({
    id, propertyId, label: id, status: occupied ? "Occupied" : "Vacant",
  });
  const occ = (id: string, propertyId: string, charge: number) => ({
    id, propertyId, name: id, status: "Active",
    chargePerBed: charge, billingFrequency: "Monthly",
  });

  // Helper: build N beds for a property with `occupied` of them occupied.
  const beds = (propertyId: string, total: number, occupied: number) =>
    Array.from({ length: total }, (_, i) =>
      bed(`${propertyId}-b${i + 1}`, propertyId, i < occupied),
    );

  return {
    customers: [
      customer("c1", "Alpha"),
      customer("c2", "Beta"),
      customer("c3", "Gamma"),
      customer("c4", "Delta"),
      customer("c5", "Echo"),
    ],
    properties: [
      property("p1", "c1"),
      property("p2", "c2"),
      property("p3", "c3"),
      property("p4", "c4"), // Delta owns a property but it has no beds.
      property("p5", "c5"),
    ],
    beds: [
      ...beds("p1", 10, 8),
      ...beds("p2", 10, 8),
      ...beds("p3", 10, 5),
      // p4 (Delta) intentionally has no beds.
      ...beds("p5", 4, 0),
    ],
    occupants: [
      occ("o1", "p1", 1000),
      occ("o2", "p2", 2000),
      occ("o3", "p3", 5000),
      // Delta and Echo have no active occupants → $0 revenue.
    ],
  };
}

let state: State = makeFreshState();

const storeMocks = {
  addCustomer: vi.fn(),
  updateCustomer: vi.fn(),
  deleteCustomer: vi.fn(),
};

vi.mock("@/context/data-store", () => ({
  useData: () => ({
    ...state,
    isLoading: false,
    ...storeMocks,
  }),
  CustomerInUseError: class CustomerInUseError extends Error {},
}));

// Imports that consume the mocks above MUST come after vi.mock calls.
import Customers from "./customers";

describe("Customers page — top occupancy / top revenue cards", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    state = makeFreshState();
    Object.values(storeMocks).forEach((m) => m.mockReset());
    window.sessionStorage.clear();
    window.localStorage.clear();
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

  function cardText(testid: string): string {
    const card = container.querySelector<HTMLElement>(
      `[data-testid="${testid}"]`,
    );
    if (!card) throw new Error(`${testid} not found`);
    return card.textContent ?? "";
  }

  it("surfaces the customer with the highest occupancy %", async () => {
    // Gamma is at 50%, Alpha and Beta are tied at 80%. Beta wins the
    // tie via higher monthly revenue ($2k > $1k) — see next test for
    // the explicit tie-break assertion.
    await renderPage();
    const text = cardText("card-top-occupancy");
    expect(text).toContain("Beta");
    expect(text).not.toContain("Gamma");
    expect(text).not.toContain("Alpha");
  });

  it("breaks an occupancy tie by picking the customer with higher monthly revenue", async () => {
    // Alpha and Beta both have 8/10 beds occupied. The picker must
    // pick Beta because $2,000/mo > $1,000/mo. A regression that drops
    // the revenue tie-break would surface Alpha (first seen at 80%)
    // instead — this test exists specifically to catch that.
    await renderPage();
    const text = cardText("card-top-occupancy");
    expect(text).toContain("Beta");
    expect(text).not.toContain("Alpha");
  });

  it("surfaces the customer with the highest monthly revenue", async () => {
    // Revenues: Alpha $1k, Beta $2k, Gamma $5k. Gamma wins despite
    // having the lowest occupancy %.
    await renderPage();
    const text = cardText("card-top-revenue");
    expect(text).toContain("Gamma");
    expect(text).toContain("$5,000");
    expect(text).not.toContain("Beta");
    expect(text).not.toContain("Alpha");
  });

  it("never picks a customer with zero beds for the occupancy card", async () => {
    // Delta has totalBeds=0. If `topCustomers` lost the
    // `s.totalBeds > 0` guard it would treat Delta's 0% as a real
    // datapoint and could surface it on an empty portfolio. Guard
    // against that here.
    await renderPage();
    const text = cardText("card-top-occupancy");
    expect(text).not.toContain("Delta");
  });

  it("never picks a customer with zero revenue for the revenue card", async () => {
    // Delta has $0 revenue (no beds), Echo has $0 revenue (beds but
    // no active occupants). Neither should ever be the "top revenue"
    // pick — this guards against a regression that drops the
    // `s.monthlyRevenue > 0` filter.
    await renderPage();
    const text = cardText("card-top-revenue");
    expect(text).not.toContain("Delta");
    expect(text).not.toContain("Echo");
  });

  it("hides the occupancy card entirely when no customer has any beds", async () => {
    // Strongest form of the "zero beds → never picked" rule: with
    // *every* customer at totalBeds=0, the picker must return null
    // for topOccupancy and the surrounding guard hides the whole
    // cards row. A regression that treated 0/0 as a real 0% datapoint
    // would surface the first customer here at "0%" instead.
    state = {
      customers: [
        { id: "c1", name: "Alpha", contactName: "", email: "", phone: "", notes: "" },
        { id: "c2", name: "Beta",  contactName: "", email: "", phone: "", notes: "" },
      ],
      properties: [],
      beds: [],
      occupants: [],
    };
    await renderPage();
    expect(container.querySelector('[data-testid="card-top-occupancy"]')).toBeNull();
    expect(container.querySelector('[data-testid="card-top-revenue"]')).toBeNull();
  });

  it("shows the empty-state fallback on the revenue card when no customer has any revenue", async () => {
    // Beds exist but no active occupants → every customer has $0
    // monthly revenue. The occupancy card should surface Alpha (50%),
    // and the revenue card must fall back to its "No revenue yet"
    // empty state rather than picking a $0 customer as a winner.
    state = {
      customers: [
        { id: "c1", name: "Alpha", contactName: "", email: "", phone: "", notes: "" },
      ],
      properties: [
        {
          id: "p1", customerId: "c1", name: "p1", address: "1 Main", city: "Austin",
          state: "TX", zip: "78701", totalBeds: 0, monthlyRent: 0, chargePerBed: 0,
          status: "Active", landlordName: "", landlordEmail: "", landlordPhone: "",
          paymentMethod: "ACH", paymentRecipient: "", paymentDueDay: 1,
          paymentNotes: "", bankName: "", bankRouting: "", bankAccount: "",
          portalUrl: "", notes: "", furnishings: [], ratings: undefined,
        },
      ],
      beds: [
        { id: "p1-b1", propertyId: "p1", label: "p1-b1", status: "Occupied" },
        { id: "p1-b2", propertyId: "p1", label: "p1-b2", status: "Vacant" },
      ],
      occupants: [], // Nobody is actively billed → $0 revenue.
    };
    await renderPage();
    const occCard = container.querySelector<HTMLElement>('[data-testid="card-top-occupancy"]');
    expect(occCard).not.toBeNull();
    expect(occCard?.textContent ?? "").toContain("Alpha");
    const revCard = container.querySelector<HTMLElement>('[data-testid="card-top-revenue"]');
    expect(revCard).not.toBeNull();
    const revText = revCard?.textContent ?? "";
    expect(revText).toContain("No revenue yet");
    expect(revText).not.toContain("Alpha");
  });
});
