import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

// Regression coverage for Task #608: the per-property "Add Lease" button on
// the Property Detail page now opens the unified upload-or-manual dialog
// (UploadLeasePdfDialog) with the property pre-locked. There was no test
// exercising that wiring, so a refactor that re-introduced the old plain
// AddLeaseDialog (or dropped the locked-property header / "Enter manually"
// shortcut) would silently regress the operator's primary entry point for
// adding a lease from a property's Leases tab.

vi.mock("@/components/layout/main-layout", () => ({
  MainLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@workspace/api-client-react", () => ({
  useListRoomNightLogs: () => ({ data: [] }),
  useListPropertyViolations: () => ({ data: [] }),
  useCreatePropertyViolation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
  useDeletePropertyViolation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
  getListPropertyViolationsQueryKey: () => [],
  useListProjectedMoveIns: () => ({ data: [] }),
  useCreateProjectedMoveIn: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
  useUpdateProjectedMoveIn: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
  useDeleteProjectedMoveIn: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
  useConvertProjectedMoveIn: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
  getListProjectedMoveInsQueryKey: () => [],
  getListBedsQueryKey: () => [],
  getListOccupantsQueryKey: () => [],
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

vi.mock("wouter", () => ({
  useParams: () => ({ id: "p1" }),
  useLocation: () => ["/properties/p1", vi.fn()] as const,
  useSearch: () => "",
  Link: ({ children, ...rest }: { children: ReactNode } & Record<string, unknown>) => (
    <a {...rest}>{children}</a>
  ),
}));

// Popover / Tooltip portals get in the way under jsdom and aren't
// relevant to verifying the dialog open path.
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

// Select stub — passthrough children so the leases-tab toolbar renders
// under jsdom without Radix portals. (The unified dialog has no Select on
// its "pick" stage, so this stub doesn't affect the assertions below.)
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

const seededProperty = {
  id: "p1",
  customerId: "c1",
  name: "Maple House",
  address: "1 Maple Way",
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

const state = {
  customers: [{ id: "c1", name: "Acme" }],
  properties: [seededProperty],
  beds: [],
  leases: [],
  rooms: [],
  occupants: [],
  utilities: [],
  insuranceCertificates: [],
  buildings: [],
  otherCosts: [],
  isLoading: false,
  updateProperty: vi.fn(),
  updateLease: vi.fn(),
  addLease: vi.fn(() => Promise.resolve()),
  deleteLease: vi.fn(),
  addRoom: vi.fn(),
  updateRoom: vi.fn(),
  deleteRoom: vi.fn(),
  addBed: vi.fn(),
  deleteBed: vi.fn(),
  updateBed: vi.fn(),
  updateOccupant: vi.fn(),
  addOccupant: vi.fn(),
  deleteOccupant: vi.fn(),
  updateUtility: vi.fn(),
  addUtility: vi.fn(),
  deleteUtility: vi.fn(),
  addInsuranceCertificate: vi.fn(),
  updateInsuranceCertificate: vi.fn(),
  deleteInsuranceCertificate: vi.fn(),
  addProperty: vi.fn(),
  addCustomer: vi.fn(),
  dataIssues: [],
};

vi.mock("@/context/data-store", () => ({
  useData: () => state,
  RoomInUseError: class RoomInUseError extends Error {},
}));

import PropertyDetail from "./property-detail";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Property Detail — Add Lease opens the unified upload-or-manual dialog", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
    window.history.replaceState({}, "", "/properties/p1?tab=leases");
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
    // Radix Dialog portals into document.body — clean up any stray nodes
    // so a leaked dialog from one test can't fool the next assertion.
    document
      .querySelectorAll('[role="dialog"], [data-radix-portal]')
      .forEach((el) => el.remove());
  });

  it("clicking 'Add Lease' on the Leases tab opens the unified dialog with the property locked and a 'manual entry' shortcut", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    await act(async () => {
      root = createRoot(container);
      root.render(
        <QueryClientProvider client={queryClient}>
          <PropertyDetail />
        </QueryClientProvider>,
      );
    });

    const trigger = container.querySelector(
      '[data-testid="button-add-lease"]',
    ) as HTMLButtonElement | null;
    expect(trigger).not.toBeNull();

    await act(async () => {
      trigger!.click();
    });

    // Radix Dialog renders the content into document.body via a portal.
    // Locked-property hint identifies that the dialog opened in the
    // Task #608 locked branch, pinned to Maple House — a regression that
    // dropped the lock (or swapped back in the old AddLeaseDialog) would
    // miss this node entirely.
    const hint = document.body.querySelector(
      '[data-testid="text-pdf-locked-property-hint"]',
    );
    expect(hint).not.toBeNull();
    expect(hint!.textContent).toContain("Maple House");

    // The "Enter the lease details manually" link is the unified dialog's
    // bypass for operators who don't have a PDF — its presence is the
    // single thing that lets this dialog fully replace the old manual
    // Add Lease flow on the property page.
    const manualButton = document.body.querySelector(
      '[data-testid="button-enter-lease-manually"]',
    );
    expect(manualButton).not.toBeNull();
    expect(manualButton!.textContent).toContain("Enter the lease details manually");

    // And the dropzone — the PDF entry point — must still render alongside
    // it, so both paths are reachable from the same dialog.
    expect(
      document.body.querySelector('[data-testid="dropzone-lease-pdfs"]'),
    ).not.toBeNull();
  });
});
