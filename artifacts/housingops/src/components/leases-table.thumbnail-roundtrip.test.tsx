import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Switch, Route, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

import { LeasesTable } from "./leases-table";
import type { Lease, Property } from "@/data/mockData";

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

vi.mock("@/components/renew-lease-popover", () => ({
  RenewLeasePopover: ({ trigger }: { trigger?: ReactNode }) => <>{trigger}</>,
}));

vi.mock("@/hooks/use-unsaved-changes-prompt", () => ({
  useUnsavedChangesPrompt: () => ({ bypassNextNavigation: vi.fn() }),
}));

vi.mock("@/components/ui/popover", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return { Popover: Pass, PopoverTrigger: Pass, PopoverContent: () => null };
});

vi.mock("@/components/ui/select", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Select: Pass, SelectContent: Pass, SelectGroup: Pass,
    SelectItem: Pass, SelectLabel: Pass, SelectScrollDownButton: Pass,
    SelectScrollUpButton: Pass, SelectSeparator: Pass,
    SelectTrigger: Pass, SelectValue: Pass,
  };
});

vi.mock("@/components/ui/switch", () => ({
  Switch: (props: Record<string, unknown>) => <button type="button" {...props} />,
}));

vi.mock("@/components/ui/alert-dialog", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    AlertDialog: Pass, AlertDialogAction: Pass, AlertDialogCancel: Pass,
    AlertDialogContent: Pass, AlertDialogDescription: Pass,
    AlertDialogFooter: Pass, AlertDialogHeader: Pass,
    AlertDialogTitle: Pass, AlertDialogTrigger: Pass,
    AlertDialogPortal: Pass, AlertDialogOverlay: () => null,
  };
});

const dataState: {
  leases: Lease[];
  properties: Property[];
  customers: Array<{ id: string; name: string }>;
} = { leases: [], properties: [], customers: [] };

vi.mock("@/context/data-store", () => ({
  useData: () => ({
    leases: dataState.leases,
    properties: dataState.properties,
    customers: dataState.customers,
    rooms: [],
    beds: [],
    occupants: [],
    utilities: [],
    isLoading: false,
    updateLease: vi.fn(),
    addLease: vi.fn(),
    deleteLease: vi.fn(),
  }),
}));

import LeaseDetail from "@/pages/lease-detail";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const property: Property = {
  id: "p1",
  customerId: "c1",
  name: "Maple",
  address: "1 Maple Way",
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
  rentFrequency: "Monthly",
} as unknown as Property;

const leaseWithPdf: Lease = {
  id: "l-with-pdf",
  propertyId: "p1",
  startDate: "2025-01-01",
  endDate: "2025-12-31",
  monthlyRent: 1200,
  securityDeposit: 1200,
  status: "Active",
  notes:
    "KFI Staffing LLC. Source: Yellow_House-_6454_Us-30,_Jeannette,_PA_15644_-_2026_KFI_STAFF_1778107208478.pdf",
  clauses: "",
  buyoutAvailable: false,
  buyoutCost: null,
  weeklyCost: 0,
  vendor: "",
  needsReview: false,
} as unknown as Lease;

const leaseWithoutPdf: Lease = {
  ...leaseWithPdf,
  id: "l-no-pdf",
  notes: "Plain notes, no source PDF stamped here.",
};

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  originalFetch = globalThis.fetch;
  fetchMock = vi.fn();
  (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;
  dataState.leases = [leaseWithPdf, leaseWithoutPdf];
  dataState.properties = [property];
  dataState.customers = [{ id: "c1", name: "Acme" }];
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
  (globalThis as unknown as { fetch: typeof globalThis.fetch }).fetch = originalFetch;
});

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("PDF thumbnail → lease detail round-trip (Task #384)", () => {
  it("thumbnail click navigates to lease detail with ?focus=preview, which auto-expands the Source PDF Preview card", async () => {
    fetchMock.mockResolvedValue({ ok: true } as Response);

    const memory = memoryLocation({ path: "/leases", record: true });
    act(() => {
      root = createRoot(container);
      root.render(
        <Router hook={memory.hook}>
          <Switch>
            <Route path="/leases">
              <LeasesTable
                leases={[leaseWithPdf]}
                properties={[property]}
                onDelete={() => {}}
                originPath="/leases"
              />
            </Route>
            <Route path="/leases/:id" component={LeaseDetail} />
          </Switch>
        </Router>,
      );
    });

    const thumbnailLink = container.querySelector(
      `[data-testid="link-lease-source-thumbnail-${leaseWithPdf.id}"]`,
    ) as HTMLAnchorElement | null;
    expect(thumbnailLink).not.toBeNull();

    const href = thumbnailLink!.getAttribute("href") ?? "";
    expect(href).toContain(`/leases/${leaseWithPdf.id}`);
    expect(href).toContain("focus=preview");

    act(() => {
      thumbnailLink!.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
      );
    });

    const lastNav = memory.history[memory.history.length - 1];
    expect(lastNav).toContain(`/leases/${leaseWithPdf.id}`);
    expect(lastNav).toContain("focus=preview");

    const previewCard = container.querySelector(
      '[data-testid="card-lease-source-pdf-preview"]',
    );
    expect(previewCard).not.toBeNull();

    const toggle = container.querySelector(
      '[data-testid="button-toggle-source-pdf-preview"]',
    ) as HTMLButtonElement;
    expect(toggle).not.toBeNull();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    await flushPromises();

    expect(
      container.querySelector('[data-testid="iframe-source-pdf"]'),
    ).not.toBeNull();
  });

  it("thumbnail click → lease detail shows fallback when the source PDF is missing from disk", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 } as Response);

    const memory = memoryLocation({ path: "/leases", record: true });
    act(() => {
      root = createRoot(container);
      root.render(
        <Router hook={memory.hook}>
          <Switch>
            <Route path="/leases">
              <LeasesTable
                leases={[leaseWithPdf]}
                properties={[property]}
                onDelete={() => {}}
                originPath="/leases"
              />
            </Route>
            <Route path="/leases/:id" component={LeaseDetail} />
          </Switch>
        </Router>,
      );
    });

    const thumbnailLink = container.querySelector(
      `[data-testid="link-lease-source-thumbnail-${leaseWithPdf.id}"]`,
    ) as HTMLAnchorElement;
    act(() => {
      thumbnailLink.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
      );
    });

    const toggle = container.querySelector(
      '[data-testid="button-toggle-source-pdf-preview"]',
    ) as HTMLButtonElement;
    expect(toggle).not.toBeNull();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    await flushPromises();

    expect(
      container.querySelector('[data-testid="text-source-pdf-missing"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="iframe-source-pdf"]'),
    ).toBeNull();
  });

  it("lease without a source PDF renders no thumbnail and the detail page has no preview card", () => {
    const memory = memoryLocation({ path: "/leases", record: true });
    act(() => {
      root = createRoot(container);
      root.render(
        <Router hook={memory.hook}>
          <Switch>
            <Route path="/leases">
              <LeasesTable
                leases={[leaseWithoutPdf]}
                properties={[property]}
                onDelete={() => {}}
                originPath="/leases"
              />
            </Route>
            <Route path="/leases/:id" component={LeaseDetail} />
          </Switch>
        </Router>,
      );
    });

    expect(
      container.querySelector(
        `[data-testid="link-lease-source-thumbnail-${leaseWithoutPdf.id}"]`,
      ),
    ).toBeNull();

    const row = container.querySelector(
      `[data-testid="row-lease-${leaseWithoutPdf.id}"]`,
    ) as HTMLTableRowElement;
    act(() => {
      row.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
      );
    });

    expect(
      container.querySelector('[data-testid="card-lease-source-pdf-preview"]'),
    ).toBeNull();
  });
});
