import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

// Regression coverage for task #128: every list page should swap a bare
// "no rows" message for the branded EmptyState block (icon + title +
// description + "Add ___" CTA) when its dataset is empty. We pin two
// pages here so a future refactor that drops EmptyState from either
// surface fails loudly instead of silently shipping a dead-looking demo.

vi.mock("@/components/layout/main-layout", () => ({
  MainLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("framer-motion", async () => {
  const { createMotionMock } = await import("@/test-utils/framer-motion-mock");
  return createMotionMock();
});

// Recharts uses ResizeObserver which jsdom doesn't ship — stub each chart
// primitive to a no-op div so the Finance / Dashboard pages mount cleanly.
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

// Radix portals (Dialog / HoverCard / DropdownMenu / Tooltip) don't play
// well with jsdom — none of these tests open them.
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

vi.mock("@/components/ui/hover-card", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return { HoverCard: Pass, HoverCardTrigger: Pass, HoverCardContent: () => null };
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

vi.mock("@/components/ui/tooltip", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Tooltip: Pass,
    TooltipTrigger: Pass,
    TooltipContent: () => null,
    TooltipProvider: Pass,
  };
});

// Minimal Select stub: renders nothing interactive but keeps the toolbar
// from crashing when it sees a Select tree.
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

// Empty data store — every list ought to fall straight into its empty
// state on first render.
const emptyState = {
  customers: [] as Array<Record<string, unknown>>,
  properties: [] as Array<Record<string, unknown>>,
  beds: [] as Array<Record<string, unknown>>,
  leases: [] as Array<Record<string, unknown>>,
  rooms: [] as Array<Record<string, unknown>>,
  occupants: [] as Array<Record<string, unknown>>,
  utilities: [] as Array<Record<string, unknown>>,
  isLoading: false,
  addCustomer: vi.fn(),
  addProperty: vi.fn(),
  addLease: vi.fn(),
  updateLease: vi.fn(),
  deleteLease: vi.fn(),
};

vi.mock("@/context/data-store", () => ({
  useData: () => emptyState,
}));

import Customers from "./customers";
import Properties from "./properties";
import Finance from "./finance";
import { CustomerScopeProvider } from "@/context/customer-scope";

function mount(node: ReactNode, container: HTMLDivElement) {
  let root: Root | null = null;
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  act(() => {
    root = createRoot(container);
    root.render(<CustomerScopeProvider>{node}</CustomerScopeProvider>);
  });
  return root!;
}

describe("Empty-state graphics on list pages", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
    window.history.replaceState({}, "", "/");
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

  it("Customers page renders the EmptyState with an Add Customer CTA when there are no customers", async () => {
    await act(async () => {
      root = mount(<Customers />, container);
    });

    const empty = container.querySelector('[data-testid="empty-customers-table"]');
    expect(empty).not.toBeNull();
    // Headline + description should be visible to users.
    expect(empty!.textContent).toContain("No customers yet");
    expect(empty!.textContent?.toLowerCase()).toContain("add your first customer");
    // The CTA button anchored inside the empty state is what makes the
    // page feel intentional instead of broken.
    const cta = container.querySelector('[data-testid="button-add-customer-empty"]');
    expect(cta).not.toBeNull();
    expect(cta!.textContent).toContain("Add Customer");
  });

  it("Properties page renders the EmptyState with an Add Property CTA when there are no properties", async () => {
    await act(async () => {
      root = mount(<Properties />, container);
    });

    const empty = container.querySelector('[data-testid="empty-properties-table"]');
    expect(empty).not.toBeNull();
    expect(empty!.textContent).toContain("No properties found");
    expect(empty!.textContent?.toLowerCase()).toContain("add your first property");
    const cta = container.querySelector('[data-testid="button-add-property-empty"]');
    expect(cta).not.toBeNull();
    expect(cta!.textContent).toContain("Add Property");
  });

  it("Finance page renders the EmptyState with an Add Property CTA when there are no properties", async () => {
    await act(async () => {
      root = mount(<Finance />, container);
    });

    const empty = container.querySelector('[data-testid="empty-finance-table"]');
    expect(empty).not.toBeNull();
    expect(empty!.textContent).toContain("No properties yet");
    const cta = container.querySelector('[data-testid="button-empty-finance-cta"]');
    expect(cta).not.toBeNull();
    expect(cta!.textContent).toContain("Add Property");
  });
});
