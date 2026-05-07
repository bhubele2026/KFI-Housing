import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Switch, Route, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

// ── Mocks ───────────────────────────────────────────────────────────────
//
// We strip out non-essential rendering layers (MainLayout, framer-motion
// animation props, toast hook) so the tests can focus on routing and the
// data flow into the customer-detail page.

vi.mock("@/components/layout/main-layout", () => ({
  MainLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

// framer-motion's `motion.<tag>` is replaced with a plain HTML element of
// the same tag, with the animation-only props stripped. This preserves
// table semantics (motion.tr → tr) so querying `tbody tr` still works.
// The shared mock caches one component per tag (see
// src/test-utils/framer-motion-mock.tsx) — without that cache, React
// would unmount/remount the entire <motion.tr> subtree on every parent
// re-render and silently destroy any child useState.
vi.mock("framer-motion", async () => {
  const { createMotionMock } = await import("@/test-utils/framer-motion-mock");
  return createMotionMock();
});

// Customers page calls `useToast()` even on read-only renders.
vi.mock("@/hooks/use-toast", () => {
  const toast = vi.fn();
  return {
    useToast: () => ({ toast, dismiss: vi.fn(), toasts: [] }),
    toast,
  };
});

// recharts' ResponsiveContainer needs ResizeObserver, which jsdom does not
// provide. A global polyfill is installed in src/test-setup.ts,
// so this file no longer needs to mock recharts.

// ── Mock data ───────────────────────────────────────────────────────────
//
// Hand-picked numbers chosen so the per-customer roll-ups (beds, occupied,
// monthly revenue, property count) are easy to read off in the assertions:
//
//   c1 "Acme Co"   — 2 properties (p1, p2), 6 beds total, 4 occupied,
//                    revenue = 600 + 500 + 700 + 800 = $2,600/mo
//   c2 "Globex"    — 1 property  (p3),       2 beds total, 2 occupied,
//                    revenue = 400 + 400     = $800/mo
//   c3 "Empty Co"  — 0 properties, 0 beds, $0 revenue
//
// Inactive occupants and occupants without a propertyId must be excluded
// from revenue, matching the behavior of the real customer-detail page.

const baseProperty = {
  address: "123 Main St",
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

const mockData = {
  customers: [
    { id: "c1", name: "Acme Co", contactName: "Dana Rivera", email: "dana@acme.test", phone: "555-0100", notes: "VIP customer." },
    { id: "c2", name: "Globex", contactName: "", email: "", phone: "", notes: "" },
    { id: "c3", name: "Empty Co", contactName: "Jamie", email: "jamie@empty.test", phone: "", notes: "" },
    { id: "c4", name: "Penda", contactName: "", email: "", phone: "", notes: "" },
  ],
  properties: [
    { ...baseProperty, id: "p1", customerId: "c1", name: "Maple House", city: "Austin", state: "TX" },
    { ...baseProperty, id: "p2", customerId: "c1", name: "Oak House",   city: "Dallas", state: "TX" },
    { ...baseProperty, id: "p3", customerId: "c2", name: "Pine Lodge",  city: "Los Angeles", state: "CA" },
    // Shared-housing property (task #295/#311). Primary customer is
    // c4 (Penda), but c1 is listed in `sharedWithCustomerIds` so it
    // must surface on c1's detail page too — without polluting c2's
    // page, which is asserted independently below.
    {
      ...baseProperty,
      id: "p4",
      customerId: "c4",
      sharedWithCustomerIds: ["c1"],
      name: "Ridge Motor Inn",
      city: "Baraboo",
      state: "WI",
    },
  ],
  beds: [
    // p1: 4 beds, 3 occupied
    { id: "b1", propertyId: "p1", bedNumber: 1, room: "R1", status: "Occupied" as const, occupantId: "o1" },
    { id: "b2", propertyId: "p1", bedNumber: 2, room: "R1", status: "Occupied" as const, occupantId: "o2" },
    { id: "b3", propertyId: "p1", bedNumber: 3, room: "R2", status: "Occupied" as const, occupantId: "o3" },
    { id: "b4", propertyId: "p1", bedNumber: 4, room: "R2", status: "Vacant"   as const, occupantId: null },
    // p2: 2 beds, 1 occupied
    { id: "b5", propertyId: "p2", bedNumber: 1, room: "R1", status: "Occupied" as const, occupantId: "o4" },
    { id: "b6", propertyId: "p2", bedNumber: 2, room: "R1", status: "Vacant"   as const, occupantId: null },
    // p3: 2 beds, 2 occupied
    { id: "b7", propertyId: "p3", bedNumber: 1, room: "R1", status: "Occupied" as const, occupantId: "o5" },
    { id: "b8", propertyId: "p3", bedNumber: 2, room: "R1", status: "Occupied" as const, occupantId: "o6" },
  ],
  occupants: [
    { ...baseOccupant, id: "o1", bedId: "b1", propertyId: "p1", status: "Active" as const, chargePerBed: 600, billingFrequency: "Monthly" as const },
    { ...baseOccupant, id: "o2", bedId: "b2", propertyId: "p1", status: "Active" as const, chargePerBed: 500, billingFrequency: "Monthly" as const },
    { ...baseOccupant, id: "o3", bedId: "b3", propertyId: "p1", status: "Active" as const, chargePerBed: 700, billingFrequency: "Monthly" as const },
    { ...baseOccupant, id: "o4", bedId: "b5", propertyId: "p2", status: "Active" as const, chargePerBed: 800, billingFrequency: "Monthly" as const },
    { ...baseOccupant, id: "o5", bedId: "b7", propertyId: "p3", status: "Active" as const, chargePerBed: 400, billingFrequency: "Monthly" as const },
    { ...baseOccupant, id: "o6", bedId: "b8", propertyId: "p3", status: "Active" as const, chargePerBed: 400, billingFrequency: "Monthly" as const },
    // Former occupant — must NOT contribute to revenue.
    { ...baseOccupant, id: "o7", bedId: null, propertyId: "p1", status: "Former" as const, chargePerBed: 9999, billingFrequency: "Monthly" as const },
  ],
  leases: [
    // Active, customer-responsible: counts toward c1's customer-paid rent.
    {
      id: "L1", propertyId: "p1", customerId: "c1", monthlyRent: 1200,
      status: "Active", customerResponsibleForRent: true, rateType: "monthly",
      startDate: "2025-01-01", endDate: "2025-12-31", securityDeposit: 0, notes: "",
    },
    // Active, customer-responsible on p2 (also c1): adds $1,500.
    {
      id: "L2", propertyId: "p2", customerId: "c1", monthlyRent: 1500,
      status: "Active", customerResponsibleForRent: true, rateType: "monthly",
      startDate: "2025-02-01", endDate: "2025-12-31", securityDeposit: 0, notes: "",
    },
    // Active but occupant-paid — must NOT count.
    {
      id: "L3", propertyId: "p1", customerId: "c1", monthlyRent: 9999,
      status: "Active", customerResponsibleForRent: false, rateType: "monthly",
      startDate: "2025-01-01", endDate: "2025-12-31", securityDeposit: 0, notes: "",
    },
    // Expired customer-responsible — must NOT count.
    {
      id: "L4", propertyId: "p2", customerId: "c1", monthlyRent: 9999,
      status: "Expired", customerResponsibleForRent: true, rateType: "monthly",
      startDate: "2024-01-01", endDate: "2024-12-31", securityDeposit: 0, notes: "",
    },
    // Belongs to c2 — must NOT show on c1's page.
    {
      id: "L5", propertyId: "p3", customerId: "c2", monthlyRent: 750,
      status: "Active", customerResponsibleForRent: true, rateType: "monthly",
      startDate: "2025-03-01", endDate: "2025-12-31", securityDeposit: 0, notes: "",
    },
    // Customer-responsible hotel-rate lease for c1: appears in the
    // drill-down list (with a "—" amount + Hotel rate badge) but is
    // intentionally excluded from the $ total because room-night rent
    // depends on logged usage, not a fixed monthly amount.
    {
      id: "L6", propertyId: "p1", customerId: "c1", monthlyRent: 0,
      status: "Active", customerResponsibleForRent: true, rateType: "room-night",
      nightlyRate: 120, startDate: "2025-04-01", endDate: "2025-12-31",
      securityDeposit: 0, notes: "",
    },
  ],
  utilities: [],
  isLoading: false,
  addCustomer: vi.fn(),
  updateCustomer: vi.fn(),
  deleteCustomer: vi.fn(),
};

vi.mock("@/context/data-store", () => {
  // Defined inside the factory because vi.mock is hoisted to the top of
  // the file — anything outside the factory is not yet initialized when
  // it runs.
  class MockCustomerInUseError extends Error {}
  return {
    useData: () => mockData,
    CustomerInUseError: MockCustomerInUseError,
  };
});

// Imports MUST come after the mocks above so the components pick them up.
import Customers from "./customers";
import CustomerDetail from "./customer-detail";
import { TooltipProvider } from "@/components/ui/tooltip";

// ── Test harness ────────────────────────────────────────────────────────

function makeRouter(initialPath: string) {
  const memory = memoryLocation({ path: initialPath, record: true });
  function Harness() {
    return (
      <TooltipProvider>
        <Router hook={memory.hook}>
          <Switch>
            <Route path="/customers" component={Customers} />
            <Route path="/customers/:id" component={CustomerDetail} />
          </Switch>
        </Router>
      </TooltipProvider>
    );
  }
  return { memory, Harness };
}

function currentPath(memory: ReturnType<typeof memoryLocation>): string {
  // With record:true, the memory location keeps a history array. Newest
  // entry is the current path.
  const history = (memory as unknown as { history?: string[] }).history;
  if (!history || history.length === 0) return "/";
  return history[history.length - 1];
}

describe("Customer detail page", () => {
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

  async function renderAt(initialPath: string) {
    const { memory, Harness } = makeRouter(initialPath);
    await act(async () => {
      root = createRoot(container);
      root.render(<Harness />);
    });
    return memory;
  }

  function byTestId(id: string): HTMLElement | null {
    return container.querySelector(`[data-testid="${id}"]`);
  }

  function requireTestId(id: string): HTMLElement {
    const el = byTestId(id);
    if (!el) throw new Error(`Could not find [data-testid="${id}"]`);
    return el;
  }

  async function clickEl(el: HTMLElement) {
    await act(async () => {
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
  }

  // ── Navigation from /customers ──────────────────────────────────────

  it("clicking the customer name on /customers navigates to /customers/:id", async () => {
    const memory = await renderAt("/customers");

    // Sanity: we're rendering the Customers list, not the detail page yet.
    expect(byTestId("customer-detail-name")).toBeNull();
    expect(byTestId("link-customer-name-c1")).not.toBeNull();

    await clickEl(requireTestId("link-customer-name-c1"));

    expect(currentPath(memory)).toBe("/customers/c1");
    // The Switch should have swapped to CustomerDetail for c1.
    expect(requireTestId("customer-detail-name").textContent).toBe("Acme Co");
  });

  it("clicking the View action navigates to /customers/:id", async () => {
    const memory = await renderAt("/customers");

    expect(byTestId("button-view-customer-c2")).not.toBeNull();
    await clickEl(requireTestId("button-view-customer-c2"));

    expect(currentPath(memory)).toBe("/customers/c2");
    expect(requireTestId("customer-detail-name").textContent).toBe("Globex");
  });

  // ── Detail-page rendering ───────────────────────────────────────────

  it("renders contact info, four stat cards, and the property list", async () => {
    await renderAt("/customers/c1");

    // Contact info block — name, email, phone, notes all surfaced.
    const contactCard = requireTestId("card-customer-contact");
    expect(contactCard).not.toBeNull();
    expect(requireTestId("contact-name").textContent).toContain("Dana Rivera");
    expect(requireTestId("contact-email").textContent).toContain("dana@acme.test");
    expect(requireTestId("contact-phone").textContent).toContain("555-0100");
    expect(requireTestId("contact-notes").textContent).toContain("VIP customer.");

    // All four summary stat cards rendered.
    expect(byTestId("stat-properties")).not.toBeNull();
    expect(byTestId("stat-beds")).not.toBeNull();
    expect(byTestId("stat-occupancy")).not.toBeNull();
    expect(byTestId("stat-revenue")).not.toBeNull();

    // Properties list card with one row per property.
    expect(byTestId("card-customer-properties")).not.toBeNull();
    expect(byTestId("row-customer-property-p1")).not.toBeNull();
    expect(byTestId("row-customer-property-p2")).not.toBeNull();
    // c1 does NOT own p3 (and p3 isn't shared with c1), so that row
    // must be absent on c1's page.
    expect(byTestId("row-customer-property-p3")).toBeNull();
    // p4 is primarily owned by c2 but shared with c1 via
    // sharedWithCustomerIds — it should surface on c1's page (task #339).
    expect(byTestId("row-customer-property-p4")).not.toBeNull();
    expect(byTestId("empty-properties")).toBeNull();
  });

  it("shows the empty-properties state for a customer with no properties", async () => {
    await renderAt("/customers/c3");

    // Detail page still renders for a real-but-empty customer; only the
    // properties table swaps to the empty state.
    expect(requireTestId("customer-detail-name").textContent).toBe("Empty Co");
    expect(byTestId("card-customer-properties")).not.toBeNull();
    expect(byTestId("empty-properties")).not.toBeNull();
  });

  // ── Totals consistency between list and detail ──────────────────────

  it("Beds / Occupancy / Monthly Revenue totals match the per-customer totals on /customers", async () => {
    // Step 1: read the per-customer totals as displayed on /customers.
    await renderAt("/customers");

    const listBedsC1 = requireTestId("cell-customer-beds-c1").textContent ?? "";
    const listRevC1  = requireTestId("cell-customer-revenue-c1").textContent ?? "";
    // The cell renders e.g. "4/6" + "67%" stacked. Both pieces must show.
    expect(listBedsC1).toMatch(/4\s*\/\s*6/);
    expect(listBedsC1).toMatch(/67%/);
    expect(listRevC1).toContain("$2,600");

    const listBedsC2 = requireTestId("cell-customer-beds-c2").textContent ?? "";
    const listRevC2  = requireTestId("cell-customer-revenue-c2").textContent ?? "";
    expect(listBedsC2).toMatch(/2\s*\/\s*2/);
    expect(listBedsC2).toMatch(/100%/);
    expect(listRevC2).toContain("$800");

    // Step 2: navigate to c1's detail page and assert the same numbers.
    await clickEl(requireTestId("button-view-customer-c1"));
    expect(requireTestId("customer-detail-name").textContent).toBe("Acme Co");

    // 3 properties → "Properties" card shows 3 (p1 + p2 owned, p4
    // shared from c2 via sharedWithCustomerIds — task #339).
    expect(requireTestId("stat-properties").textContent).toContain("3");
    // Beds card shows "4/6" — same occupied/total as the list cell.
    expect(requireTestId("stat-beds").textContent).toMatch(/4\s*\/\s*6/);
    // Occupancy card shows 67%, matching the list's 67%.
    expect(requireTestId("stat-occupancy").textContent).toContain("67%");
    // Revenue card shows $2,600, matching the list's $2,600.
    expect(requireTestId("stat-revenue").textContent).toContain("$2,600");
  });

  it("totals on c2's detail page match c2's row totals on /customers", async () => {
    // Independent verification with a different customer to catch any
    // accidental hard-coding to the first customer.
    await renderAt("/customers");
    const listBedsC2 = requireTestId("cell-customer-beds-c2").textContent ?? "";
    const listRevC2  = requireTestId("cell-customer-revenue-c2").textContent ?? "";

    await clickEl(requireTestId("link-customer-name-c2"));

    expect(requireTestId("customer-detail-name").textContent).toBe("Globex");
    expect(requireTestId("stat-properties").textContent).toContain("1");
    expect(requireTestId("stat-beds").textContent).toMatch(/2\s*\/\s*2/);
    expect(requireTestId("stat-occupancy").textContent).toContain("100%");
    expect(requireTestId("stat-revenue").textContent).toContain("$800");

    // Cross-check: the strings the list shows for c2 are the same numbers
    // we just asserted on the detail page.
    expect(listBedsC2).toContain("2/2");
    expect(listRevC2).toContain("$800");
  });

  // ── Customer-paid rent roll-up ─────────────────────────────────────

  it("sums monthly rent for Active, customer-responsible leases and lists each one", async () => {
    await renderAt("/customers/c1");

    // Card present, total = 1200 + 1500 = $2,700. The hotel-rate lease L6
    // is intentionally excluded from the $ total even though it is shown
    // in the list below.
    const card = requireTestId("card-customer-paid-rent");
    expect(card).not.toBeNull();
    expect(requireTestId("stat-customer-paid-rent").textContent).toContain("$2,700");

    // Drill-down list: L1, L2, and L6 (hotel-rate). L3 (occupant-paid),
    // L4 (expired), and L5 (c2) must not appear on c1's page.
    const list = requireTestId("list-customer-paid-leases");
    const items = list.querySelectorAll("li");
    expect(items.length).toBe(3);

    const l2 = requireTestId("link-customer-paid-lease-L2");
    const l1 = requireTestId("link-customer-paid-lease-L1");
    const l6 = requireTestId("link-customer-paid-lease-L6");
    expect(l2.getAttribute("href")).toBe("/leases/L2");
    expect(l1.getAttribute("href")).toBe("/leases/L1");
    expect(l6.getAttribute("href")).toBe("/leases/L6");
    // Sorted desc by monthly rent: L2 ($1,500), L1 ($1,200), then L6 ($0).
    expect(items[0].contains(l2)).toBe(true);
    expect(items[1].contains(l1)).toBe(true);
    expect(items[2].contains(l6)).toBe(true);
    expect(l2.textContent).toContain("$1,500");
    expect(l1.textContent).toContain("$1,200");
    // Hotel-rate row shows the badge and a "—" amount instead of $/mo.
    expect(l6.textContent).toContain("Hotel rate");
    expect(l6.textContent).not.toContain("$");

    // Excluded leases must not surface in any form.
    expect(byTestId("link-customer-paid-lease-L3")).toBeNull();
    expect(byTestId("link-customer-paid-lease-L4")).toBeNull();
    expect(byTestId("link-customer-paid-lease-L5")).toBeNull();
    expect(byTestId("empty-customer-paid-leases")).toBeNull();
  });

  it("shows the empty state when no Active customer-responsible leases exist", async () => {
    // c3 has no properties / leases.
    await renderAt("/customers/c3");
    expect(requireTestId("stat-customer-paid-rent").textContent).toContain("—");
    expect(requireTestId("empty-customer-paid-leases")).not.toBeNull();
    expect(byTestId("list-customer-paid-leases")).toBeNull();
  });

  // ── Shared-housing properties (task #339) ───────────────────────────

  it("surfaces a shared-housing property on every customer's detail page (task #339)", async () => {
    // p4 is primarily owned by c4 (Penda) but shared with c1 (Acme) via
    // `sharedWithCustomerIds`. Both customers should see Ridge Motor
    // Inn in their property table; c2, which is unrelated to p4,
    // should not.
    await renderAt("/customers/c1");
    expect(byTestId("row-customer-property-p4")).not.toBeNull();

    // Re-render the harness at c4's page — primary owner sees it too.
    if (root) {
      const r = root;
      await act(async () => {
        r.unmount();
      });
      root = null;
    }
    await renderAt("/customers/c4");
    expect(byTestId("row-customer-property-p4")).not.toBeNull();

    if (root) {
      const r = root;
      await act(async () => {
        r.unmount();
      });
      root = null;
    }
    // c2 is unrelated to p4 — Ridge Motor Inn must NOT appear on its page.
    await renderAt("/customers/c2");
    expect(byTestId("row-customer-property-p4")).toBeNull();
  });

  // ── Bad-id state ─────────────────────────────────────────────────────

  it("visiting /customers/<bad-id> shows the 'Customer not found' state with a back link", async () => {
    await renderAt("/customers/does-not-exist");

    // Not-found surface present, real detail surface absent.
    const notFound = requireTestId("customer-detail-not-found");
    expect(notFound.textContent).toContain("Customer not found");
    expect(byTestId("customer-detail-name")).toBeNull();
    expect(byTestId("card-customer-contact")).toBeNull();
    expect(byTestId("card-customer-properties")).toBeNull();

    // Back link is rendered as a wouter <Link href="/customers"> wrapping
    // a Button labeled "Back to Customers". Verify both: the anchor's
    // href and the visible label.
    const anchor = notFound.querySelector('a[href="/customers"]');
    expect(anchor).not.toBeNull();
    expect(anchor?.textContent).toContain("Back to Customers");
  });
});
