import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

// ─────────────────────────────────────────────────────────────────────────────
// Save-time geocode warning toast (Task #228)
// ─────────────────────────────────────────────────────────────────────────────
// When the API responds to POST /properties with `geocodeStatus:
// "no_result"` (typo'd address that Google couldn't pinpoint), the
// Properties page must surface a non-blocking destructive toast so the
// operator can fix the typo immediately instead of finding it days
// later in the missing-address side panel. The "ok" and "skipped"
// branches must stay silent — only the success "Property added" toast
// fires there.

vi.mock("@/components/layout/main-layout", () => ({
  MainLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("framer-motion", async () => {
  const { createMotionMock } = await import("@/test-utils/framer-motion-mock");
  return createMotionMock();
});

vi.mock("@workspace/api-client-react", () => ({
  useGetRuntimeConfig: () => ({
    data: { googleMapsApiKey: "test-key", googleMapsMapId: "test-map-id" },
    isPending: false,
    isLoading: false,
    isError: false,
    isSuccess: true,
    error: null,
    status: "success",
    fetchStatus: "idle",
  }),
  getGetRuntimeConfigQueryKey: () => ["/api/config"] as const,
}));

const toastMock = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock, dismiss: vi.fn(), toasts: [] }),
}));

// Pass-through Dialog so DialogContent actually renders the form (the
// other Properties test files mock this to null because they don't
// drive the dialog). Without this we can't reach the Save button.
vi.mock("@/components/ui/dialog", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Dialog: Pass,
    DialogTrigger: Pass,
    DialogContent: Pass,
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

// Minimal Select mock that captures every onValueChange handler keyed
// by the SelectTrigger's data-testid, so the test can drive the
// "Choose a customer" dropdown without rendering Radix internals.
const selectHandlers = new Map<string, (v: string) => void>();
vi.mock("@/components/ui/select", () => {
  function findTestId(node: unknown): string | null {
    if (node == null || typeof node === "string" || typeof node === "number")
      return null;
    if (Array.isArray(node)) {
      for (const child of node) {
        const id = findTestId(child);
        if (id) return id;
      }
      return null;
    }
    if (typeof node === "object" && "props" in (node as Record<string, unknown>)) {
      const props = (node as { props: Record<string, unknown> }).props ?? {};
      if (typeof props["data-testid"] === "string") {
        return props["data-testid"] as string;
      }
      if ("children" in props) return findTestId(props.children);
    }
    return null;
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
    if (testid && onValueChange) selectHandlers.set(testid, onValueChange);
    return <div data-current={value}>{children}</div>;
  }
  return {
    Select,
    SelectContent: Pass,
    SelectGroup: Pass,
    SelectItem: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
    SelectLabel: Pass,
    SelectScrollDownButton: Pass,
    SelectScrollUpButton: Pass,
    SelectSeparator: Pass,
    SelectTrigger: Pass,
    SelectValue: Pass,
  };
});

const addPropertyMock =
  vi.fn<
    (p: Record<string, unknown>) => Promise<Record<string, unknown>>
  >();

const baseState = {
  customers: [
    { id: "c1", name: "Acme Co", contactName: "", email: "", phone: "", notes: "" },
  ],
  properties: [] as Record<string, unknown>[],
  beds: [] as Record<string, unknown>[],
  leases: [] as Record<string, unknown>[],
  rooms: [] as Record<string, unknown>[],
};

vi.mock("@/context/data-store", () => ({
  useData: () => ({
    ...baseState,
    isLoading: false,
    addProperty: addPropertyMock,
    addCustomer: vi.fn(),
    updateProperty: vi.fn(),
  }),
}));

import Properties from "./properties";
import { CustomerScopeProvider } from "@/context/customer-scope";

function PropertiesUnderTest() {
  return (
    <CustomerScopeProvider>
      <Properties />
    </CustomerScopeProvider>
  );
}

describe("Properties — save-time geocode warning toast", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    toastMock.mockReset();
    addPropertyMock.mockReset();
    selectHandlers.clear();
    window.sessionStorage.clear();
    window.localStorage.clear();
    window.history.replaceState({}, "", "/properties");
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
      root.render(<PropertiesUnderTest />);
    });
  }

  function findByTestId(testid: string): HTMLElement {
    const el = container.querySelector(`[data-testid="${testid}"]`);
    if (!el) throw new Error(`testid=${testid} not found`);
    return el as HTMLElement;
  }

  // Drives the Add Property dialog through to a save click. The form
  // renders inline (Dialog is mocked as a pass-through) so we can flip
  // `addOpen` by clicking the Add Property button, fill the required
  // fields, and click Save — exactly the path an operator takes.
  function setInputValue(input: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  async function openDialogFillAndSave(over: { name?: string } = {}) {
    await act(async () => {
      findByTestId("button-add-property").click();
    });
    // Pick the only customer ("c1") through the captured Select
    // handler — handleSaveProperty refuses to save without one.
    const pickCustomer = selectHandlers.get("select-property-customer");
    if (!pickCustomer) throw new Error("customer Select handler not captured");
    await act(async () => {
      pickCustomer("c1");
    });
    const nameInput = findByTestId("input-property-name") as HTMLInputElement;
    await act(async () => {
      setInputValue(nameInput, over.name ?? "Maple Court");
    });
    await act(async () => {
      findByTestId("button-save-property").click();
    });
    // Let the awaited addProperty promise resolve so the save-time
    // geocode toast (Task #228) gets a chance to fire.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("fires a destructive 'Couldn't locate address' toast when the API returns geocodeStatus=no_result", async () => {
    addPropertyMock.mockResolvedValueOnce({
      id: "p-new",
      name: "Maple Court",
      geocodeStatus: "no_result",
    });

    await renderPage();
    await openDialogFillAndSave({ name: "Maple Court" });

    expect(addPropertyMock).toHaveBeenCalledTimes(1);
    // The success "Property added" toast fires first; the warning
    // toast fires after. Find the warning explicitly so the
    // assertion doesn't depend on call order.
    const warning = toastMock.mock.calls.find(
      (call) =>
        (call[0] as { title?: string } | undefined)?.title ===
        "Couldn't locate address",
    );
    expect(warning).toBeTruthy();
    expect((warning?.[0] as { variant?: string }).variant).toBe("destructive");
    expect((warning?.[0] as { description?: string }).description).toContain(
      "Maple Court",
    );
  });

  it("does NOT fire the warning toast when geocodeStatus=ok", async () => {
    addPropertyMock.mockResolvedValueOnce({
      id: "p-new",
      name: "Maple Court",
      geocodeStatus: "ok",
    });

    await renderPage();
    await openDialogFillAndSave({ name: "Maple Court" });

    const warning = toastMock.mock.calls.find(
      (call) =>
        (call[0] as { title?: string } | undefined)?.title ===
        "Couldn't locate address",
    );
    expect(warning).toBeUndefined();
    // The save still announces success.
    const success = toastMock.mock.calls.find(
      (call) =>
        (call[0] as { title?: string } | undefined)?.title === "Property added",
    );
    expect(success).toBeTruthy();
  });

  it("does NOT fire the warning toast when geocodeStatus=skipped (blank address path)", async () => {
    addPropertyMock.mockResolvedValueOnce({
      id: "p-new",
      name: "Maple Court",
      geocodeStatus: "skipped",
    });

    await renderPage();
    await openDialogFillAndSave({ name: "Maple Court" });

    const warning = toastMock.mock.calls.find(
      (call) =>
        (call[0] as { title?: string } | undefined)?.title ===
        "Couldn't locate address",
    );
    expect(warning).toBeUndefined();
  });

  it("does NOT fire the warning toast when the API response omits geocodeStatus entirely (older deployments)", async () => {
    addPropertyMock.mockResolvedValueOnce({
      id: "p-new",
      name: "Maple Court",
    });

    await renderPage();
    await openDialogFillAndSave({ name: "Maple Court" });

    const warning = toastMock.mock.calls.find(
      (call) =>
        (call[0] as { title?: string } | undefined)?.title ===
        "Couldn't locate address",
    );
    expect(warning).toBeUndefined();
  });
});
