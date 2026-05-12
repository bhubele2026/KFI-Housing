import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act, isValidElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Switch, Route, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

// Integration test for the task #367 dashboard → /leases?needsDates=1
// deep-link. Mirrors the at-risk round-trip test (task #358) so a real
// click on the missing-dates CTA actually navigates to /leases under
// a single wouter Router. We then assert that /leases lands
// pre-filtered (chip visible, Select=NeedsDates) and that the rendered
// row count matches the dashboard tile's count — catching mismatches
// between the dashboard predicate and the leases-page `needsDates`
// filter.

vi.mock("@/components/layout/main-layout", () => ({
  MainLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("framer-motion", async () => {
  const { createMotionMock } = await import("@/test-utils/framer-motion-mock");
  return createMotionMock();
});

vi.mock("recharts", () => {
  const Stub = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    BarChart: Stub,
    Bar: Stub,
    XAxis: Stub,
    YAxis: Stub,
    CartesianGrid: Stub,
    Tooltip: Stub,
    Legend: Stub,
    ResponsiveContainer: Stub,
  };
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

vi.mock("@/components/ui/popover", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Popover: Pass,
    PopoverTrigger: Pass,
    PopoverContent: () => null,
  };
});

vi.mock("@/components/ui/accordion", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Accordion: Pass,
    AccordionItem: Pass,
    AccordionTrigger: Pass,
    AccordionContent: () => null,
  };
});

// Select mock: same shape as the at-risk integration test — preserves
// `data-current` so we can read the active filter from the DOM
// without a real Radix portal.
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
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  function Select({
    value,
    children,
  }: {
    value: string;
    onValueChange?: (v: string) => void;
    children?: ReactNode;
  }) {
    const testid = findTestId(children);
    return <div data-testid={testid ?? undefined} data-current={value} />;
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

vi.mock("@/components/add-lease-dialog", () => ({
  AddLeaseDialog: () => null,
}));
vi.mock("@/components/upload-lease-pdf-dialog", () => ({
  UploadLeasePdfDialog: () => null,
}));
vi.mock("@/components/import-master-leases-button", () => ({
  ImportMasterLeasesButton: () => null,
}));
vi.mock("@/components/last-auto-import-indicator", () => ({
  LastAutoImportIndicator: () => null,
}));
vi.mock("@/components/renew-lease-popover", () => ({
  RenewLeasePopover: ({ trigger }: { trigger?: ReactNode }) => <>{trigger}</>,
}));
vi.mock("@/components/assign-occupant-dialog", () => ({
  AssignOccupantDialog: () => null,
}));

vi.mock("@workspace/api-client-react", () => ({
  useListRoomNightLogs: () => ({ data: [] }),
  useListAllProjectedMoveIns: () => ({ data: [] }),
  getListAllProjectedMoveInsQueryKey: () => ["/projected-move-ins"],
  useListPropertyViolations: () => ({ data: [] }),
  useCreatePropertyViolation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
  useDeletePropertyViolation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
  getListPropertyViolationsQueryKey: () => [],
  useListUnplacedPayroll: () => ({
    data: { unmatched: [], lowConfidenceMatches: [] },
  }),
  getListUnplacedPayrollQueryKey: () => ["/payroll/unplaced"],
  useGetLastAutoMasterImport: () => ({ data: undefined, isLoading: false, isError: false }),
}));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>(
    "@tanstack/react-query",
  );
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  };
});

// Shared mock data store — both pages read from `useData` so they
// must agree on the same lease set for the round-trip count to match.
type State = {
  customers: Array<Record<string, unknown>>;
  properties: Array<Record<string, unknown>>;
  leases: Array<Record<string, unknown>>;
  rooms: Array<Record<string, unknown>>;
  beds: Array<Record<string, unknown>>;
  occupants: Array<Record<string, unknown>>;
  utilities: Array<Record<string, unknown>>;
  insuranceCertificates: Array<Record<string, unknown>>;
};

function makeState(): State {
  return {
    customers: [
      { id: "c1", name: "Acme Co", contactName: "", email: "", phone: "", notes: "" },
    ],
    properties: [
      {
        id: "p1",
        customerId: "c1",
        name: "Mainstreet",
        address: "1 Main St",
        city: "Austin",
        state: "TX",
        zip: "78701",
        totalBeds: 1,
        monthlyRent: 1000,
        chargePerBed: 0,
        status: "Active",
        ratings: {},
        paymentNotes: "",
        notes: "",
        furnishings: [],
      },
    ],
    leases: [
      // Three leases that match the dashboard's missing-dates predicate
      // (`!l.startDate || !l.endDate`) and that /leases?needsDates=1
      // should show. Mix of statuses + which date is blank to make sure
      // the page filter and dashboard predicate agree on all variants
      // (blank end, blank start, both blank).
      {
        id: "lD1",
        propertyId: "p1",
        startDate: "2025-01-01",
        endDate: "",
        monthlyRent: 1000,
        securityDeposit: 0,
        status: "Active",
        notes: "",
        clauses: "",
        buyoutAvailable: false,
        buyoutCost: null,
      },
      {
        id: "lD2",
        propertyId: "p1",
        startDate: "",
        endDate: "2026-12-31",
        monthlyRent: 1000,
        securityDeposit: 0,
        status: "Upcoming",
        notes: "",
        clauses: "",
        buyoutAvailable: false,
        buyoutCost: null,
      },
      {
        id: "lD3",
        propertyId: "p1",
        startDate: "",
        endDate: "",
        monthlyRent: 0,
        securityDeposit: 0,
        status: "Expired",
        notes: "",
        clauses: "",
        buyoutAvailable: false,
        buyoutCost: null,
      },
      // A fully-dated Active lease — must be in the data so we can
      // prove it's filtered out post-navigation (its row exists on
      // the unfiltered /leases but not on /leases?needsDates=1).
      {
        id: "lF1",
        propertyId: "p1",
        startDate: "2025-01-01",
        endDate: "2026-12-31",
        monthlyRent: 1000,
        securityDeposit: 0,
        status: "Active",
        notes: "",
        clauses: "",
        buyoutAvailable: false,
        buyoutCost: null,
      },
    ],
    rooms: [],
    beds: [],
    occupants: [],
    utilities: [],
    insuranceCertificates: [],
  };
}

let state: State = makeState();

vi.mock("@/context/data-store", () => ({
  useData: () => ({
    ...state,
    isLoading: false,
    addLease: vi.fn(),
    updateLease: vi.fn(),
    deleteLease: vi.fn(),
    addOccupant: vi.fn(),
    updateBed: vi.fn(),
    updateOccupant: vi.fn(),
  }),
  RoomInUseError: class RoomInUseError extends Error {},
}));

import Dashboard from "./dashboard";
import Leases from "./leases";
import { CustomerScopeProvider } from "@/context/customer-scope";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Dashboard missing-dates CTA → /leases?needsDates=1 round-trip", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    state = makeState();
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

  it("clicking the dashboard CTA navigates to /leases with the missing-dates filter active and the same row count as the dashboard tile", async () => {
    const memory = memoryLocation({ path: "/dashboard", record: true });
    function Harness() {
      return (
        <CustomerScopeProvider>
          <Router hook={memory.hook}>
            <Switch>
              <Route path="/dashboard" component={Dashboard} />
              <Route path="/leases" component={Leases} />
            </Switch>
          </Router>
        </CustomerScopeProvider>
      );
    }

    await act(async () => {
      root = createRoot(container);
      root.render(<Harness />);
    });

    // Dashboard tile renders with a count of 3 (lD1 blank end, lD2
    // blank start, lD3 both blank). Capturing the count up-front lets
    // us assert row parity below.
    const dashboardCount = container.querySelector(
      '[data-testid="text-needs-review-leases-needs-dates-count"]',
    )?.textContent;
    expect(dashboardCount).toBe("3");

    const cta = container.querySelector(
      'a[data-testid="button-needs-review-leases-needs-dates-cta"]',
    ) as HTMLAnchorElement | null;
    expect(cta).not.toBeNull();
    expect(cta!.getAttribute("href")).toBe("/leases?needsDates=1");

    // Real click — wouter intercepts and navigates via the memory hook,
    // which is what we're proving end-to-end.
    await act(async () => {
      cta!.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
      );
    });

    // Router landed on the deep-link URL.
    expect(memory.history[memory.history.length - 1]).toBe("/leases?needsDates=1");

    // The chip explaining the narrowed list is visible on first paint
    // of /leases — without the URL→state sync this would be missing.
    expect(
      container.querySelector('[data-testid="badge-needs-dates-filter"]'),
    ).not.toBeNull();

    // The needs-dates Select reflects the URL state.
    expect(
      container
        .querySelector('[data-testid="select-needs-dates-filter"]')
        ?.getAttribute("data-current"),
    ).toBe("NeedsDates");

    // Row parity: the rendered missing-dates lease rows match the
    // dashboard tile's count exactly. This is the contract the task
    // brief calls out — the dashboard count and the filtered table
    // must agree.
    const needsDatesRows = Array.from(
      container.querySelectorAll('[data-testid^="row-lease-"]'),
    ).filter((el) => {
      const id = el.getAttribute("data-testid") ?? "";
      // Exclude placeholder rows defensively — the needs-dates filter
      // suppresses them anyway, so any present here would be a regression.
      return !id.startsWith("row-lease-placeholder-");
    });
    expect(needsDatesRows).toHaveLength(Number(dashboardCount));

    // And specifically: the missing-dates leases are present, the
    // fully-dated one is gone.
    expect(
      container.querySelector('[data-testid="row-lease-lD1"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="row-lease-lD2"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="row-lease-lD3"]'),
    ).not.toBeNull();
    expect(container.querySelector('[data-testid="row-lease-lF1"]')).toBeNull();
  });
});
