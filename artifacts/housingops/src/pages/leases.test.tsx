import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act, isValidElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Switch, Route, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

// These tests pin down two behaviors of the global Leases page that are easy
// to break together because they share state:
//
//   1. Every property in the active customer scope shows up as a row — real
//      lease rows where they exist, and a clearly-marked "No lease yet"
//      placeholder row for properties without one. Placeholders are UI-only
//      (never persisted), so a regression that filtered them out would silently
//      hide the workflow this whole feature exists to enable.
//
//   2. The placeholder's "Create lease" CTA opens the AddLeaseDialog with the
//      property preselected and locked. We capture the rendered AddLeaseDialog's
//      props with a spy so we can assert on the controlled-open + locked
//      propertyId combination directly, even though the real Radix Dialog
//      portal can't render in jsdom.

vi.mock("@/components/layout/main-layout", () => ({
  MainLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

// framer-motion's motion.<tag> becomes a plain element of the same tag,
// preserving table semantics so `tbody tr` queries still resolve.
vi.mock("framer-motion", async () => {
  const { createMotionMock } = await import("@/test-utils/framer-motion-mock");
  return createMotionMock();
});

const toastMock = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock, dismiss: vi.fn(), toasts: [] }),
}));

// Replace dialog/popover portals with passthroughs so the page renders
// without crashing — none of the assertions inspect dialog content.
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
  return {
    Popover: Pass,
    PopoverTrigger: Pass,
    PopoverContent: () => null,
  };
});

// Select mock — same shape used by the other Leases-area tests. Keeps the
// status / customer filters renderable without a real Radix portal, and
// preserves the on-screen "current value" so the placeholder count assertions
// stay deterministic.
vi.mock("@/components/ui/select", () => {
  function findTestId(node: unknown): string | null {
    if (node == null || typeof node === "string" || typeof node === "number") return null;
    if (Array.isArray(node)) {
      for (const c of node) {
        const id = findTestId(c);
        if (id) return id;
      }
      return null;
    }
    if (typeof node === "object" && isValidElement(node)) {
      const props = (node as { props: Record<string, unknown> }).props ?? {};
      if (typeof props["data-testid"] === "string") return props["data-testid"] as string;
      if ("children" in props) return findTestId(props.children);
    }
    return null;
  }
  function collectItems(
    node: unknown,
    out: Array<{ value: string; label: string }>,
  ) {
    if (node == null) return;
    if (Array.isArray(node)) {
      node.forEach((c) => collectItems(c, out));
      return;
    }
    if (typeof node === "object" && isValidElement(node)) {
      const props = (node as { props: Record<string, unknown> }).props ?? {};
      const v = props.value;
      const ch = props.children;
      if (typeof v === "string" && (typeof ch === "string" || typeof ch === "number")) {
        out.push({ value: v, label: String(ch) });
      }
      if ("children" in props) collectItems(ch, out);
    }
  }
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  function Select({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange?: (v: string) => void;
    children?: ReactNode;
  }) {
    const testid = findTestId(children);
    const items: Array<{ value: string; label: string }> = [];
    collectItems(children, items);
    return (
      <div data-testid={testid ?? undefined} data-current={value}>
        {items.map((it) => (
          <button
            key={it.value}
            type="button"
            data-select-item={it.value}
            onClick={() => onValueChange?.(it.value)}
          >
            {it.label}
          </button>
        ))}
      </div>
    );
  }
  const Item = ({ value, children }: { value: string; children?: ReactNode }) => (
    <span data-value={value}>{children}</span>
  );
  return {
    Select,
    SelectContent: Pass,
    SelectGroup: Pass,
    SelectItem: Item,
    SelectLabel: Pass,
    SelectScrollDownButton: Pass,
    SelectScrollUpButton: Pass,
    SelectSeparator: Pass,
    SelectTrigger: Pass,
    SelectValue: Pass,
  };
});

// Capture every AddLeaseDialog prop set the page renders so we can assert on
// the controlled-open + locked-propertyId combination triggered by the
// placeholder row's "Create lease" CTA. The mock renders nothing visible so
// the rest of the page DOM stays free of dialog noise.
type AddLeaseDialogPropsCapture = {
  propertyId?: string;
  open?: boolean;
};
const addLeaseDialogPropsLog: AddLeaseDialogPropsCapture[] = [];
vi.mock("@/components/add-lease-dialog", () => ({
  AddLeaseDialog: (props: AddLeaseDialogPropsCapture) => {
    addLeaseDialogPropsLog.push({
      propertyId: props.propertyId,
      open: props.open,
    });
    return null;
  },
}));

vi.mock("@/components/upload-lease-pdf-dialog", () => ({
  UploadLeasePdfDialog: () => null,
}));

vi.mock("@/components/renew-lease-popover", () => ({
  RenewLeasePopover: ({ trigger }: { trigger?: ReactNode }) => <>{trigger}</>,
}));

// ── Mock data store ─────────────────────────────────────────────────────
type State = {
  customers: Array<Record<string, unknown>>;
  properties: Array<Record<string, unknown>>;
  leases: Array<Record<string, unknown>>;
  rooms: Array<Record<string, unknown>>;
  beds: Array<Record<string, unknown>>;
  occupants: Array<Record<string, unknown>>;
  utilities: Array<Record<string, unknown>>;
};

function baseProperty(over: Record<string, unknown>): Record<string, unknown> {
  return {
    address: "123 Main St",
    city: "Austin",
    state: "TX",
    zip: "78701",
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
    furnishings: [],
    ratings: undefined,
    ...over,
  };
}

// Three properties chosen so the placeholder logic has every interesting
// shape on screen at once:
//   p1 → has an Active lease       (real row)
//   p2 → has no leases              (placeholder row)
//   p3 → has no leases              (placeholder row, second one)
function makeFreshState(): State {
  return {
    customers: [
      { id: "c1", name: "Acme Co", contactName: "", email: "", phone: "", notes: "" },
    ],
    properties: [
      baseProperty({ id: "p1", customerId: "c1", name: "Maple", address: "1 Maple Way" }),
      baseProperty({ id: "p2", customerId: "c1", name: "Oak",   address: "2 Oak Ln" }),
      baseProperty({ id: "p3", customerId: "c1", name: "Pine",  address: "3 Pine Rd" }),
    ],
    leases: [
      {
        id: "l1",
        propertyId: "p1",
        startDate: "2025-01-01",
        endDate: "2026-01-01",
        monthlyRent: 1500,
        securityDeposit: 0,
        status: "Active",
        notes: "",
      },
    ],
    rooms: [],
    beds: [],
    occupants: [],
    utilities: [],
  };
}

let state: State = makeFreshState();

const storeMocks = {
  addLease: vi.fn(),
  updateLease: vi.fn(),
  deleteLease: vi.fn(),
};

vi.mock("@/context/data-store", () => ({
  useData: () => ({
    ...state,
    isLoading: false,
    ...storeMocks,
  }),
  RoomInUseError: class RoomInUseError extends Error {},
}));

// Use the real customer-scope context — it reads from sessionStorage which is
// available in jsdom and defaults to ALL_CUSTOMERS, so no extra setup needed.

// Imports that consume the mocks above MUST come after vi.mock calls.
import Leases from "./leases";
import { CustomerScopeProvider } from "@/context/customer-scope";

// Vitest's React-19 act helper looks for this global; without it the page
// hits an "act(...) is not configured" warning that hides real failures.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeHarness(initialPath: string) {
  const memory = memoryLocation({ path: initialPath, record: true });
  function Harness() {
    return (
      <CustomerScopeProvider>
        <Router hook={memory.hook}>
          <Switch>
            <Route path="/leases" component={Leases} />
          </Switch>
        </Router>
      </CustomerScopeProvider>
    );
  }
  return { memory, Harness };
}

// ── Tests ───────────────────────────────────────────────────────────────
describe("Leases page — placeholder rows for properties without a lease", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    state = makeFreshState();
    Object.values(storeMocks).forEach((m) => m.mockReset());
    toastMock.mockReset();
    addLeaseDialogPropsLog.length = 0;
    // Make sure the customer-scope context starts at "All Customers" so the
    // placeholder query covers every property.
    sessionStorage.clear();
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
    const { Harness } = makeHarness("/leases");
    await act(async () => {
      root = createRoot(container);
      root.render(<Harness />);
    });
  }

  it("renders one placeholder row for every property that has no lease, alongside the real lease rows", async () => {
    // Three properties total: one with a real lease (p1) and two without
    // (p2, p3). The page should show one row of each kind in the table —
    // a regression that filtered out placeholders would only show p1.
    await renderPage();

    // Real lease row is present.
    expect(
      container.querySelector('[data-testid="row-lease-l1"]'),
    ).not.toBeNull();

    // Both placeholder rows are present, identifiable by per-property testid.
    const placeholderP2 = container.querySelector(
      '[data-testid="row-lease-placeholder-p2"]',
    );
    const placeholderP3 = container.querySelector(
      '[data-testid="row-lease-placeholder-p3"]',
    );
    expect(placeholderP2).not.toBeNull();
    expect(placeholderP3).not.toBeNull();

    // The placeholder for p2 carries the property's name, address, and the
    // "No lease yet" status pill — without the name the operator wouldn't
    // know which property the row is for.
    expect(placeholderP2!.textContent).toContain("Oak");
    expect(placeholderP2!.textContent).toContain("2 Oak Ln");
    expect(placeholderP2!.textContent).toContain("No lease yet");

    // The footer count line tells the operator how many properties still
    // need a lease — distinct from the existing "X of Y leases" count.
    expect(
      container.querySelector('[data-testid="text-placeholder-count"]')?.textContent,
    ).toContain("2");
  });

  it("does NOT render placeholder rows for properties that already have at least one lease", async () => {
    // p1 has an Active lease, so no placeholder should ever exist for it
    // even though only one lease is on file. A regression that dedupes
    // by status (instead of by "any lease") would render a placeholder
    // here and double the page's row count.
    await renderPage();

    expect(
      container.querySelector('[data-testid="row-lease-placeholder-p1"]'),
    ).toBeNull();
  });

  it("clicking the placeholder's Create lease CTA opens AddLeaseDialog with the property locked", async () => {
    // Initially the controlled AddLeaseDialog is not rendered (only the
    // page-header and PDF-fallback instances are mounted, neither of which
    // pre-binds a propertyId).
    await renderPage();

    const beforeBindings = addLeaseDialogPropsLog.filter(
      (p) => p.propertyId !== undefined && p.open === true,
    );
    expect(beforeBindings).toHaveLength(0);

    // Click "Create lease" on the p2 placeholder row.
    const cta = container.querySelector(
      '[data-testid="button-create-lease-placeholder-p2"]',
    ) as HTMLButtonElement | null;
    expect(cta).not.toBeNull();
    await act(async () => {
      cta!.click();
    });

    // The placeholder click should mount a new AddLeaseDialog instance with
    // open=true AND propertyId pinned to p2. That's the "locked property"
    // contract — the dialog won't show a property picker for this case.
    const lockedRender = addLeaseDialogPropsLog.find(
      (p) => p.propertyId === "p2" && p.open === true,
    );
    expect(lockedRender).toBeDefined();

    // Sanity: no other property got accidentally bound at the same time.
    const otherLocked = addLeaseDialogPropsLog.find(
      (p) =>
        p.open === true &&
        typeof p.propertyId === "string" &&
        p.propertyId !== "p2",
    );
    expect(otherLocked).toBeUndefined();
  });
});
