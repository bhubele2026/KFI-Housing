import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("@/components/layout/main-layout", () => ({
  MainLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/layout/page-header", () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

// Radix AlertDialog uses portals + focus traps that don't behave in jsdom;
// swap it for a transparent passthrough that respects `open` so the
// confirm/cancel buttons inside are clickable in tests.
// The cancel button needs to call the parent dialog's onOpenChange(false)
// — that's how the real Radix primitive closes itself. We thread the
// callback from AlertDialog to AlertDialogCancel via module-level state
// so the mock matches the real close behavior closely enough for the
// "cancel closes the dialog" assertion.
let currentOnOpenChange: ((open: boolean) => void) | undefined;

vi.mock("@/components/ui/alert-dialog", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  function AlertDialog({
    open,
    onOpenChange,
    children,
  }: {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    children?: ReactNode;
  }) {
    currentOnOpenChange = onOpenChange;
    if (!open) return null;
    return <div data-testid="confirm-remove-dialog">{children}</div>;
  }
  return {
    AlertDialog,
    AlertDialogTrigger: Pass,
    AlertDialogContent: ({ children, ...rest }: { children?: ReactNode } & Record<string, unknown>) => (
      <div {...rest}>{children}</div>
    ),
    AlertDialogHeader: Pass,
    AlertDialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
    AlertDialogDescription: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
    AlertDialogFooter: Pass,
    AlertDialogAction: ({ children, onClick, ...rest }: { children?: ReactNode; onClick?: () => void } & Record<string, unknown>) => (
      <button data-testid="confirm-remove-btn" onClick={onClick} {...rest}>
        {children}
      </button>
    ),
    AlertDialogCancel: ({ children, onClick, ...rest }: { children?: ReactNode; onClick?: () => void } & Record<string, unknown>) => (
      <button
        data-testid="cancel-remove-btn"
        onClick={() => {
          onClick?.();
          currentOnOpenChange?.(false);
        }}
        {...rest}
      >
        {children}
      </button>
    ),
    AlertDialogPortal: Pass,
    AlertDialogOverlay: () => null,
  };
});

const toastMock = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock, dismiss: vi.fn(), toasts: [] }),
}));

type Recipient = { id: string; email: string };
const listState: { data: Recipient[] | undefined; isLoading: boolean } = {
  data: [],
  isLoading: false,
};

type CreateOpts = {
  onSuccess?: () => void;
  onError?: (err: unknown) => void;
};
type DeleteOpts = {
  onSuccess?: () => void;
  onError?: (err: unknown) => void;
};

const createMutateMock = vi.fn<
  (vars: { data: { email: string } }, opts?: CreateOpts) => void
>();
const deleteMutateMock = vi.fn<
  (vars: { id: string }, opts?: DeleteOpts) => void
>();

const createState = { isPending: false };
const deleteState = { isPending: false };

const invalidateQueriesMock = vi.fn();

vi.mock("@workspace/api-client-react", () => ({
  useListDigestRecipients: () => ({
    data: listState.data,
    isLoading: listState.isLoading,
  }),
  useCreateDigestRecipient: () => ({
    mutate: createMutateMock,
    isPending: createState.isPending,
  }),
  useDeleteDigestRecipient: () => ({
    mutate: deleteMutateMock,
    isPending: deleteState.isPending,
  }),
  getListDigestRecipientsQueryKey: () => ["/digest-recipients"],
}));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>(
    "@tanstack/react-query",
  );
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: invalidateQueriesMock }),
  };
});

import Settings from "./settings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Settings — digest recipients UI", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    listState.data = [];
    listState.isLoading = false;
    createState.isPending = false;
    deleteState.isPending = false;
    toastMock.mockReset();
    createMutateMock.mockReset();
    deleteMutateMock.mockReset();
    invalidateQueriesMock.mockReset();
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

  async function render() {
    await act(async () => {
      root = createRoot(container);
      root.render(<Settings />);
    });
  }

  function byTestId(id: string): HTMLElement | null {
    return container.querySelector(`[data-testid="${id}"]`);
  }

  function requireTestId(id: string): HTMLElement {
    const el = byTestId(id);
    if (!el) throw new Error(`Could not find [data-testid="${id}"]`);
    return el;
  }

  function getRows(): HTMLElement[] {
    return Array.from(
      container.querySelectorAll('[data-testid="digest-recipient-row"]'),
    );
  }

  async function setEmail(value: string) {
    const input = requireTestId("digest-email-input") as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function clickAdd() {
    const btn = requireTestId("digest-add-btn") as HTMLButtonElement;
    await act(async () => {
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  it("shows the empty state when no recipients are configured", async () => {
    listState.data = [];
    await render();

    expect(container.textContent).toContain("No recipients configured yet");
    expect(getRows()).toHaveLength(0);
    // Add button is disabled until the user types something.
    const addBtn = requireTestId("digest-add-btn") as HTMLButtonElement;
    expect(addBtn.disabled).toBe(true);
  });

  it("renders configured recipients in a table and hides the empty state", async () => {
    listState.data = [
      { id: "r1", email: "alice@example.com" },
      { id: "r2", email: "bob@example.com" },
    ];
    await render();

    expect(container.textContent).not.toContain("No recipients configured yet");
    const rows = getRows();
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("alice@example.com");
    expect(rows[1].textContent).toContain("bob@example.com");
  });

  it("adds a recipient: calls the create hook, clears the input, invalidates the list, and toasts", async () => {
    listState.data = [];
    await render();

    await setEmail("  NewOp@Example.com  ");
    await clickAdd();

    expect(createMutateMock).toHaveBeenCalledTimes(1);
    const [vars, opts] = createMutateMock.mock.calls[0];
    // Email is trimmed and lowercased before being sent.
    expect(vars).toEqual({ data: { email: "newop@example.com" } });

    // Drive the success callback the way the mutation would.
    await act(async () => {
      opts?.onSuccess?.();
    });

    const input = requireTestId("digest-email-input") as HTMLInputElement;
    expect(input.value).toBe("");
    expect(invalidateQueriesMock).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ description: "newop@example.com" }),
    );
  });

  it("rejects malformed email addresses with a destructive toast and never calls the API", async () => {
    listState.data = [];
    await render();

    await setEmail("not-an-email");
    await clickAdd();

    expect(createMutateMock).not.toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "destructive" }),
    );
    // Input is NOT cleared on validation failure so the user can fix it.
    const input = requireTestId("digest-email-input") as HTMLInputElement;
    expect(input.value).toBe("not-an-email");
  });

  it("surfaces the duplicate-email error from the server with a friendly message", async () => {
    listState.data = [{ id: "r1", email: "dup@example.com" }];
    await render();

    await setEmail("dup@example.com");
    await clickAdd();

    expect(createMutateMock).toHaveBeenCalledTimes(1);
    const [, opts] = createMutateMock.mock.calls[0];

    // Server responded 409 — drive the error callback the way orval would.
    await act(async () => {
      opts?.onError?.(new Error("Request failed with status code 409"));
    });

    expect(toastMock).toHaveBeenCalledTimes(1);
    const call = toastMock.mock.calls[0]?.[0] as {
      variant?: string;
      description?: string;
    };
    expect(call.variant).toBe("destructive");
    // The component swaps the raw 409 message for the duplicate copy.
    expect(call.description).not.toMatch(/409/);
    expect(call.description ?? "").not.toBe("");
  });

  it("removing a recipient asks for confirmation, then calls the delete hook on confirm", async () => {
    listState.data = [
      { id: "r1", email: "alice@example.com" },
      { id: "r2", email: "bob@example.com" },
    ];
    await render();

    // Confirmation dialog is hidden until the trash icon is clicked.
    expect(byTestId("confirm-remove-dialog")).toBeNull();

    const removeButtons = container.querySelectorAll(
      '[data-testid="digest-remove-btn"]',
    );
    expect(removeButtons).toHaveLength(2);

    await act(async () => {
      (removeButtons[1] as HTMLButtonElement).dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    const dialog = requireTestId("confirm-remove-dialog");
    // The dialog names the recipient being removed so operators don't
    // mis-click on a busy table.
    expect(dialog.textContent).toContain("bob@example.com");
    expect(deleteMutateMock).not.toHaveBeenCalled();

    const confirmBtn = requireTestId("confirm-remove-btn") as HTMLButtonElement;
    await act(async () => {
      confirmBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(deleteMutateMock).toHaveBeenCalledTimes(1);
    expect(deleteMutateMock.mock.calls[0][0]).toEqual({ id: "r2" });

    // Drive the success callback: list is invalidated, toast is shown,
    // and the dialog closes.
    const [, opts] = deleteMutateMock.mock.calls[0];
    await act(async () => {
      opts?.onSuccess?.();
    });

    expect(invalidateQueriesMock).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(byTestId("confirm-remove-dialog")).toBeNull();
  });

  it("cancelling the confirmation dialog leaves the recipient in place", async () => {
    listState.data = [{ id: "r1", email: "alice@example.com" }];
    await render();

    const removeBtn = requireTestId("digest-remove-btn") as HTMLButtonElement;
    await act(async () => {
      removeBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(byTestId("confirm-remove-dialog")).not.toBeNull();

    const cancelBtn = requireTestId("cancel-remove-btn") as HTMLButtonElement;
    await act(async () => {
      cancelBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // Cancel must close the dialog without calling the delete hook.
    expect(deleteMutateMock).not.toHaveBeenCalled();
    expect(byTestId("confirm-remove-dialog")).toBeNull();
  });
});
