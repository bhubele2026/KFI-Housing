import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

// These tests pin down the Customers listing's sort behavior. The sort
// logic lives in the `filtered` memo on customers.tsx and combines three
// moving parts that are all easy to break by accident:
//   • The per-customer roll-ups in `statsByCustomer` (property count,
//     occupancy %, monthly revenue).
//   • The `valueOf` helper that picks the metric for the active column
//     and returns `null` for occupancy when a customer has zero beds.
//   • The `cycleSort` helper's tri-state cycle: unsorted → asc → desc →
//     unsorted (insertion order restored).
//
// We render the real page against a mocked data store and read row order
// from the rendered <tbody>, so a regression in any of those three layers
// — including the "no beds → push to bottom" rule — fails here loudly
// instead of slipping into production.

vi.mock("@/components/layout/main-layout", () => ({
  MainLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

// Cached motion mock — see properties.test.tsx for why a naïve Proxy
// breaks subtree state across re-renders.
vi.mock("framer-motion", async () => {
  const { createMotionMock } = await import("@/test-utils/framer-motion-mock");
  return createMotionMock();
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn(), dismiss: vi.fn(), toasts: [] }),
}));

// Radix portals + tooltips don't render meaningfully in jsdom and the
// sort tests never open them. Replace with passthroughs / no-ops.
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
// The fixture is hand-tuned so every column has a clear ranking AND at
// least one "missing" customer:
//
//   c1 Alpha → 1 property, 4 beds, 2 occupied (50%), $1,000/mo
//   c2 Beta  → 3 properties, 10 beds, 8 occupied (80%), $3,000/mo
//   c3 Gamma → 2 properties, 10 beds, 3 occupied (30%), $500/mo
//   c4 Delta → 1 property, 0 beds, $0/mo (no occupancy %, no revenue)
//   c5 Echo  → 0 properties (no beds, no revenue)
//
// Insertion order is c1, c2, c3, c4, c5 — that's the order we expect
// when sort is cleared back to "unsorted".
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
  // Active occupant on a property contributes its monthly charge to that
  // property's revenue. We use Monthly so toMonthlyCharge is identity.
  const occ = (id: string, propertyId: string, charge: number) => ({
    id, propertyId, name: id, status: "Active",
    chargePerBed: charge, billingFrequency: "Monthly",
  });

  // 4 beds on p1 (2 occupied) → 50%; revenue $1000.
  const p1Beds = [
    bed("p1-b1", "p1", true), bed("p1-b2", "p1", true),
    bed("p1-b3", "p1", false), bed("p1-b4", "p1", false),
  ];
  // c2 Beta: p2 (5 beds, 4 occ), p3 (5 beds, 4 occ), p4 (no beds).
  // Total 10 beds / 8 occupied = 80%; revenue $1500 + $1500 = $3000.
  const p2Beds = [
    bed("p2-b1", "p2", true), bed("p2-b2", "p2", true),
    bed("p2-b3", "p2", true), bed("p2-b4", "p2", true),
    bed("p2-b5", "p2", false),
  ];
  const p3Beds = [
    bed("p3-b1", "p3", true), bed("p3-b2", "p3", true),
    bed("p3-b3", "p3", true), bed("p3-b4", "p3", true),
    bed("p3-b5", "p3", false),
  ];
  // c3 Gamma: p5 (5 beds, 2 occ), p6 (5 beds, 1 occ).
  // Total 10 / 3 = 30%; revenue $300 + $200 = $500.
  const p5Beds = [
    bed("p5-b1", "p5", true), bed("p5-b2", "p5", true),
    bed("p5-b3", "p5", false), bed("p5-b4", "p5", false),
    bed("p5-b5", "p5", false),
  ];
  const p6Beds = [
    bed("p6-b1", "p6", true), bed("p6-b2", "p6", false),
    bed("p6-b3", "p6", false), bed("p6-b4", "p6", false),
    bed("p6-b5", "p6", false),
  ];

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
      property("p2", "c2"), property("p3", "c2"), property("p4", "c2"),
      property("p5", "c3"), property("p6", "c3"),
      property("p7", "c4"), // c4 has a property but no beds at all.
      // c5 has no properties at all.
    ],
    beds: [...p1Beds, ...p2Beds, ...p3Beds, ...p5Beds, ...p6Beds],
    occupants: [
      occ("o1", "p1", 1000),
      occ("o2", "p2", 1500),
      occ("o3", "p3", 1500),
      occ("o4", "p5", 300),
      occ("o5", "p6", 200),
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
  // The page imports this class for its delete error branch. The sort
  // tests never trigger it, but the named import has to resolve.
  CustomerInUseError: class CustomerInUseError extends Error {},
}));

// Imports that consume the mocks above MUST come after vi.mock calls.
import Customers from "./customers";

describe("Customers listing — sort behavior", () => {
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

  function rowOrder(): string[] {
    const rows = Array.from(
      container.querySelectorAll<HTMLElement>('[data-testid^="row-customer-"]'),
    );
    return rows.map((r) => {
      const id = r.getAttribute("data-testid") ?? "";
      return id.replace("row-customer-", "");
    });
  }

  async function clickSort(testid: string) {
    const btn = container.querySelector<HTMLButtonElement>(
      `[data-testid="${testid}"]`,
    );
    if (!btn) throw new Error(`${testid} not found`);
    await act(async () => {
      btn.click();
    });
  }

  it("renders rows in insertion order before any sort is applied", async () => {
    // Baseline — without a click on any header, the page should preserve
    // the data-store's natural order. If this ever changes (e.g. someone
    // adds a default sort), every other test below would also need to
    // change, so locking it down separately makes the failure obvious.
    await renderPage();
    expect(rowOrder()).toEqual(["c1", "c2", "c3", "c4", "c5"]);
  });

  it("sorts by property count ascending then descending", async () => {
    // Counts: c1=1, c2=3, c3=2, c4=1, c5=0. The sort is stable so c1
    // and c4 (both 1) stay in their original relative order.
    await renderPage();
    await clickSort("button-sort-properties");
    expect(rowOrder()).toEqual(["c5", "c1", "c4", "c3", "c2"]);
    await clickSort("button-sort-properties");
    expect(rowOrder()).toEqual(["c2", "c3", "c1", "c4", "c5"]);
  });

  it("sorts by occupancy and pushes no-bed customers to the bottom in both directions", async () => {
    // Occupancy %: c1=50, c2=80, c3=30, c4=null (totalBeds=0), c5=null.
    // The "missing" rule means c4 and c5 always sit at the bottom — the
    // primary regression this test exists to catch (e.g. someone changing
    // `valueOf` to return 0 instead of null, which would put no-bed
    // customers at the TOP in ascending order).
    await renderPage();
    await clickSort("button-sort-occupancy");
    let order = rowOrder();
    expect(order.slice(0, 3)).toEqual(["c3", "c1", "c2"]);
    expect(new Set(order.slice(3))).toEqual(new Set(["c4", "c5"]));

    await clickSort("button-sort-occupancy");
    order = rowOrder();
    expect(order.slice(0, 3)).toEqual(["c2", "c1", "c3"]);
    expect(new Set(order.slice(3))).toEqual(new Set(["c4", "c5"]));
  });

  it("sorts by monthly revenue and pushes $0 customers to the bottom in both directions", async () => {
    // Revenue: c1=$1000, c2=$3000, c3=$500, c4=$0, c5=$0. The "missing"
    // rule (mirroring occupancy) means $0 customers always sit at the
    // bottom — guards against a regression where someone strips the
    // null-coercion in `valueOf` and lets c4/c5 jump to the top of the
    // ascending list.
    await renderPage();
    await clickSort("button-sort-revenue");
    let order = rowOrder();
    expect(order.slice(0, 3)).toEqual(["c3", "c1", "c2"]);
    expect(new Set(order.slice(3))).toEqual(new Set(["c4", "c5"]));

    await clickSort("button-sort-revenue");
    order = rowOrder();
    expect(order.slice(0, 3)).toEqual(["c2", "c1", "c3"]);
    expect(new Set(order.slice(3))).toEqual(new Set(["c4", "c5"]));
  });

  it("cycles tri-state on a single column: asc → desc → unsorted", async () => {
    // Third click on the same column clears the sort and the page should
    // fall back to the data-store's insertion order. A regression that
    // skipped the "unsorted" state (e.g. asc ↔ desc toggle) would leave
    // c2 on top here instead of c1.
    await renderPage();
    await clickSort("button-sort-revenue"); // asc — c3 ($500) is the smallest non-zero
    expect(rowOrder()[0]).toBe("c3");
    await clickSort("button-sort-revenue"); // desc — c2 ($3000) tops the list
    expect(rowOrder()[0]).toBe("c2");
    await clickSort("button-sort-revenue"); // unsorted — back to insertion order
    expect(rowOrder()).toEqual(["c1", "c2", "c3", "c4", "c5"]);
  });

  it("switching to a different column restarts at ascending", async () => {
    // After a desc sort on revenue, clicking Properties should jump to
    // ascending on the new column rather than carrying over the previous
    // direction. This also indirectly verifies that the active column
    // state is updated alongside the direction.
    await renderPage();
    await clickSort("button-sort-revenue"); // asc
    await clickSort("button-sort-revenue"); // desc
    await clickSort("button-sort-properties"); // should be asc on properties
    expect(rowOrder()).toEqual(["c5", "c1", "c4", "c3", "c2"]);
  });
});
