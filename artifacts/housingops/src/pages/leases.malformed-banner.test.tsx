import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Switch, Route, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// What this test pins down
// ─────────────────────────
// data-store.test.tsx already covers the row-by-row parser. This test
// covers the rest of the chain end-to-end so the user-visible behaviour
// can't regress silently:
//
//   1. The leases list response is a mixed payload (one good lease row +
//      one malformed row).
//   2. The real DataProvider parses the payload row-by-row, drops the bad
//      row, and surfaces it via `dataIssues`.
//   3. The real MainLayout renders the inline `banner-data-issues` notice
//      with the dropped count.
//   4. The good lease row still renders on the leases page — a single bad
//      row never blanks the table.

// ── Mock all api-client-react hooks the data-store and leases page touch.
// We keep the data-store REAL (that's the code under test) and inject the
// raw list payloads via the list-hook return values; safeParseList runs on
// `query.data`, so handing it our mixed array exercises the same code path
// the network response would.
//
// vi.mock is hoisted above any top-level `const`s, so the payloads have to
// be inlined inside the factory rather than referenced from an outer scope.
vi.mock("@workspace/api-client-react", () => {
  const MIXED_LEASES_PAYLOAD: unknown[] = [
    {
      id: "lease-good",
      propertyId: "prop-1",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      monthlyRent: 1500,
      securityDeposit: 1500,
      status: "Active",
      notes: "",
    },
    // Malformed: monthlyRent must be a number — Zod will reject this row.
    // The good row above must still appear on the page; the banner must
    // surface "1 leases hidden".
    {
      id: "lease-bad",
      propertyId: "prop-1",
      startDate: "2026-02-01",
      endDate: "2026-12-31",
      monthlyRent: "oops",
      securityDeposit: 0,
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
    useListLeases: listHook(MIXED_LEASES_PAYLOAD),
    useListRooms: listHook([]),
    useListBeds: listHook([]),
    useListOccupants: listHook([]),
    useListUtilities: listHook([]),
    useListRoomNightLogs: listHook([]),
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

// Toast is invoked on errors; nothing in this test asserts toast content.
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn(), dismiss: vi.fn(), toasts: [] }),
}));

// framer-motion's motion.<tag> becomes a plain element of the same tag,
// preserving table semantics so `tbody tr` queries still resolve.
vi.mock("framer-motion", async () => {
  const { createMotionMock } = await import("@/test-utils/framer-motion-mock");
  return createMotionMock();
});

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

// Minimal Select stub: we only need the trigger + currently-selected value
// to render. The page reads `value` to drive its filters; nothing in this
// test changes the filters so we don't need the items.
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

// Accordion stub — the leases page renders one when in the (unused-here)
// by-customer view; a passthrough is enough.
vi.mock("@/components/ui/accordion", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Accordion: Pass,
    AccordionItem: Pass,
    AccordionTrigger: Pass,
    AccordionContent: Pass,
  };
});

// Tooltip portals fight with jsdom; we don't assert on tooltip content
// here so a passthrough keeps the sidebar / page action area renderable.
vi.mock("@/components/ui/tooltip", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Tooltip: Pass,
    TooltipTrigger: Pass,
    TooltipContent: () => null,
    TooltipProvider: Pass,
  };
});

// Heavy action-area components that issue their own queries / mutations.
// They're not under test here, and stubbing them avoids dragging another
// QueryClientProvider-bound mutation tree into this scope.
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
vi.mock("@/components/renew-lease-popover", () => ({
  RenewLeasePopover: ({ trigger }: { trigger?: ReactNode }) => <>{trigger}</>,
}));

// Imports that depend on the mocks above MUST come after the vi.mock calls.
import Leases from "./leases";
import { DataProvider } from "@/context/data-store";
import { CustomerScopeProvider } from "@/context/customer-scope";
import { AuthProvider } from "@/hooks/use-auth";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Leases page — malformed-row banner end-to-end", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Auth is read synchronously from localStorage on first render —
    // setting this before mount stops MainLayout from redirecting to /login.
    window.localStorage.setItem("housingops_auth", "true");
    sessionStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    // safeParseList logs a warning per dropped row; silence it so the test
    // output stays focused on the assertions.
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
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
    warnSpy.mockRestore();
  });

  it("renders the banner-data-issues notice with the dropped count AND keeps the good lease row visible", async () => {
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

    await act(async () => {
      root = createRoot(container);
      root.render(<Harness />);
    });

    // The banner is rendered by MainLayout from the data-store's
    // `dataIssues` array. With one malformed lease row in the payload
    // it should read "1 leases hidden — see console for details."
    const banner = container.querySelector('[data-testid="banner-data-issues"]');
    expect(banner).not.toBeNull();
    expect(banner!.textContent).toContain("1 leases");
    expect(banner!.textContent).toContain("hidden");

    // The good lease row must still be on the page — a single bad row
    // never blanks the leases table.
    const goodRow = container.querySelector('[data-testid="row-lease-lease-good"]');
    expect(goodRow).not.toBeNull();

    // And the dropped row must NOT have leaked through as a row.
    const badRow = container.querySelector('[data-testid="row-lease-lease-bad"]');
    expect(badRow).toBeNull();

    // safeParseList warns once per dropped row — confirms the parser
    // actually ran (and that we exercised the data-store path, not
    // some accidental empty-state).
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
