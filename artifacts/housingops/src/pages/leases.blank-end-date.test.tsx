import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Switch, Route, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// What this test pins down (task #374)
// ─────────────────────────────────────
// Some leases legitimately ship with a blank endDate (master imports,
// month-to-month tenancies, the Ridge Motor Inn seed from task #359).
// Before the fix, the leases page would mount, call parseYMD("") via
// getRenewalInfo / formatYMDPretty, throw "Invalid lease date", and
// trip the page error boundary — blanking the entire table.
//
// This test renders the real Leases page with one Active lease whose
// endDate is "" and asserts:
//   1. The page does NOT throw on mount.
//   2. The lease row is present in the table (the bug used to drop it
//      along with every other row).
//
// The strict parseYMD contract (loud throw on non-blank malformed
// input) is covered separately by the data-store and lease-dates unit
// tests; this test only proves the blank-aware UI path is wired up.

vi.mock("@workspace/api-client-react", () => {
  const BLANK_END_LEASES_PAYLOAD: unknown[] = [
    {
      id: "lease-blank-end",
      propertyId: "prop-1",
      startDate: "2026-01-01",
      endDate: "",
      monthlyRent: 1500,
      securityDeposit: 1500,
      status: "Active",
      notes: "",
    },
  ];
  const PROPERTIES_PAYLOAD = [
    {
      id: "prop-1",
      customerId: "cust-1",
      name: "Maple House",
      address: "1 Main St",
      city: "Springfield",
      state: "IL",
      zip: "62701",
      totalBeds: 4,
      monthlyRent: 1500,
      chargePerBed: 500,
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
    },
  ];
  const CUSTOMERS_PAYLOAD = [
    { id: "cust-1", name: "Acme Co", contactName: "", email: "", phone: "", notes: "" },
  ];
  const listHook = (data: unknown) =>
    () => ({ data, isLoading: false, isError: false, error: null });
  const emptyMutation = () =>
    () => ({ mutate: vi.fn(), mutateAsync: vi.fn().mockResolvedValue(undefined) });
  const emptyQueryKey = (path: string) => () => [path] as const;
  return {
    useListCustomers: listHook(CUSTOMERS_PAYLOAD),
    useListProperties: listHook(PROPERTIES_PAYLOAD),
    useListLeases: listHook(BLANK_END_LEASES_PAYLOAD),
    useListRooms: listHook([]),
    useListBeds: listHook([]),
    useListOccupants: listHook([]),
    useListUtilities: listHook([]),
    useListRoomNightLogs: listHook([]),
    useListPropertyViolations: listHook([]),
    useCreatePropertyViolation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
    useDeletePropertyViolation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
    getListPropertyViolationsQueryKey: () => [],
    getListCustomersQueryKey: emptyQueryKey("/api/customers"),
    getListPropertiesQueryKey: emptyQueryKey("/api/properties"),
    getListLeasesQueryKey: emptyQueryKey("/api/leases"),
    getListRoomsQueryKey: emptyQueryKey("/api/rooms"),
    getListBedsQueryKey: emptyQueryKey("/api/beds"),
    getListOccupantsQueryKey: emptyQueryKey("/api/occupants"),
    getListUtilitiesQueryKey: emptyQueryKey("/api/utilities"),
    getListRoomNightLogsQueryKey: emptyQueryKey("/api/room-night-logs"),
    useCreateCustomer: emptyMutation(),
    useUpdateCustomer: emptyMutation(),
    useDeleteCustomer: emptyMutation(),
    useCreateProperty: emptyMutation(),
    useUpdateProperty: emptyMutation(),
    useDeleteProperty: emptyMutation(),
    useCreateLease: emptyMutation(),
    useUpdateLease: emptyMutation(),
    useDeleteLease: emptyMutation(),
    useCreateRoom: emptyMutation(),
    useUpdateRoom: emptyMutation(),
    useDeleteRoom: emptyMutation(),
    useCreateBed: emptyMutation(),
    useUpdateBed: emptyMutation(),
    useDeleteBed: emptyMutation(),
    useCreateOccupant: emptyMutation(),
    useUpdateOccupant: emptyMutation(),
    useDeleteOccupant: emptyMutation(),
    useCreateUtility: emptyMutation(),
    useUpdateUtility: emptyMutation(),
    useDeleteUtility: emptyMutation(),
    useResetToSampleData: emptyMutation(),
    useImportData: emptyMutation(),
    useGetLastAutoMasterImport: () => ({ data: undefined, isLoading: false, isError: false }),
    useImportMasterLeases: emptyMutation(),
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn(), dismiss: vi.fn(), toasts: [] }),
}));

vi.mock("framer-motion", async () => {
  const { createMotionMock } = await import("@/test-utils/framer-motion-mock");
  return createMotionMock();
});

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

vi.mock("@/components/ui/select", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  function Select({ value, children }: { value?: string; children?: ReactNode }) {
    return <div data-current={value}>{children}</div>;
  }
  return {
    Select,
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

vi.mock("@/components/ui/accordion", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Accordion: Pass,
    AccordionItem: Pass,
    AccordionTrigger: Pass,
    AccordionContent: Pass,
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

vi.mock("@/components/upload-lease-pdf-dialog", () => ({
  UploadLeasePdfDialog: () => null,
}));
vi.mock("@/components/import-master-leases-button", () => ({
  ImportMasterLeasesButton: () => null,
}));
vi.mock("@/components/last-auto-import-indicator", () => ({
  LastAutoImportIndicator: () => null,
}));
vi.mock("@/components/add-lease-dialog", () => ({
  AddLeaseDialog: () => null,
}));
// We DON'T mock renew-lease-popover here — task #374's other half is
// "the popover doesn't crash on mount with a blank currentEndDate."
// Letting the real component render proves it.

// Imports that depend on the mocks above MUST come after the vi.mock calls.
import Leases from "./leases";
import { DataProvider } from "@/context/data-store";
import { CustomerScopeProvider } from "@/context/customer-scope";
import { AuthProvider } from "@/hooks/use-auth";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Leases page — blank endDate (task #374)", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    window.localStorage.setItem("housingops_auth", "true");
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
    window.localStorage.clear();
  });

  it("renders the leases table without throwing when an Active lease has a blank endDate", async () => {
    const memory = memoryLocation({ path: "/leases", record: true });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    function Harness() {
      return (
        <QueryClientProvider client={client}>
          <AuthProvider>
            <DataProvider>
              <CustomerScopeProvider>
                <Router hook={memory.hook}>
                  <Switch>
                    <Route path="/leases" component={Leases} />
                  </Switch>
                </Router>
              </CustomerScopeProvider>
            </DataProvider>
          </AuthProvider>
        </QueryClientProvider>
      );
    }

    // The real assertion is "this await does not reject": before the
    // fix, parseYMD("") would throw inside getRenewalInfo on first
    // render and React would surface that rejection here.
    await act(async () => {
      root = createRoot(container);
      root.render(<Harness />);
    });

    // Confirm we actually rendered the page (and didn't quietly fall
    // back to the error boundary): the lease row should be on screen.
    const row = container.querySelector(
      '[data-testid="row-lease-lease-blank-end"]',
    );
    expect(row).not.toBeNull();
  });
});
