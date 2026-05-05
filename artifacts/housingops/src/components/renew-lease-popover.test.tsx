import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, isValidElement, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

type ToastCall = {
  title?: ReactNode;
  description?: ReactNode;
  variant?: string;
  duration?: number;
  action?: ReactElement<{ onClick?: () => void; altText?: string; children?: ReactNode }>;
};

const toastCalls: ToastCall[] = [];

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toasts: [],
    toast: (arg: ToastCall) => {
      toastCalls.push(arg);
      return { id: "x", dismiss: () => {}, update: () => {} };
    },
    dismiss: () => {},
  }),
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <div data-testid="popover">{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <div data-testid="popover-trigger">{children}</div>,
  PopoverContent: ({ children }: { children: ReactNode }) => <div data-testid="popover-content">{children}</div>,
}));

vi.mock("@/components/ui/toast", () => ({
  ToastAction: ({
    children,
    onClick,
    altText,
  }: {
    children?: ReactNode;
    onClick?: () => void;
    altText?: string;
  }) => (
    <button data-testid="toast-action" data-alt-text={altText} onClick={onClick}>
      {children}
    </button>
  ),
}));

import { RenewLeasePopover } from "./renew-lease-popover";
import type { Lease } from "@/data/mockData";

type LeaseStatus = Lease["status"];

describe("RenewLeasePopover renew + Undo", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    toastCalls.length = 0;
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

  async function renderPopover(props: {
    currentEndDate: string;
    currentStatus: LeaseStatus;
    onRenew: (newEndDate: string, newStatus: LeaseStatus) => void;
  }) {
    await act(async () => {
      root = createRoot(container);
      root.render(
        <RenewLeasePopover
          currentEndDate={props.currentEndDate}
          currentStatus={props.currentStatus}
          propertyName="Maple"
          onRenew={props.onRenew}
          trigger={<button>Renew</button>}
        />,
      );
    });
  }

  function findButtonByText(text: string): HTMLButtonElement {
    const buttons = Array.from(container.querySelectorAll("button"));
    const btn = buttons.find((b) => b.textContent?.includes(text));
    if (!btn) throw new Error(`Could not find button with text containing "${text}"`);
    return btn as HTMLButtonElement;
  }

  function getCustomDateInput(): HTMLInputElement {
    const input = container.querySelector('input[type="date"]') as HTMLInputElement | null;
    if (!input) throw new Error("Could not find custom date input");
    return input;
  }

  function getApplyCustomButton(): HTMLButtonElement {
    const btn = container.querySelector(
      'button[aria-label="Apply custom date"]',
    ) as HTMLButtonElement | null;
    if (!btn) throw new Error("Could not find Apply custom date button");
    return btn;
  }

  async function setReactInputValue(input: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    if (!setter) throw new Error("Could not get HTMLInputElement value setter");
    await act(async () => {
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  function getLastToast(): ToastCall {
    if (toastCalls.length === 0) throw new Error("No toast calls recorded");
    return toastCalls[toastCalls.length - 1];
  }

  it("clicking +1 year renews to the +1y date and Undo restores the original end date and status", async () => {
    const onRenew = vi.fn();
    await renderPopover({
      currentEndDate: "2026-01-15",
      currentStatus: "Active",
      onRenew,
    });

    await act(async () => {
      findButtonByText("+1 year").click();
    });

    expect(onRenew).toHaveBeenCalledTimes(1);
    expect(onRenew).toHaveBeenNthCalledWith(1, "2027-01-15", "Active");

    const success = getLastToast();
    expect(success.title).toBe("Lease renewed");
    expect(success.action).toBeTruthy();
    expect(isValidElement(success.action)).toBe(true);
    expect(success.action?.props.altText).toBe("Undo lease renewal");

    await act(async () => {
      success.action?.props.onClick?.();
    });

    expect(onRenew).toHaveBeenCalledTimes(2);
    expect(onRenew).toHaveBeenNthCalledWith(2, "2026-01-15", "Active");

    const undone = getLastToast();
    expect(undone.title).toBe("Renewal undone");
    expect(undone.action).toBeUndefined();
  });

  it("clicking +6 months renews to the +6mo date and Undo restores the original end date and status", async () => {
    const onRenew = vi.fn();
    await renderPopover({
      currentEndDate: "2026-01-15",
      currentStatus: "Active",
      onRenew,
    });

    await act(async () => {
      findButtonByText("+6 months").click();
    });

    expect(onRenew).toHaveBeenCalledTimes(1);
    expect(onRenew).toHaveBeenNthCalledWith(1, "2026-07-15", "Active");

    const success = getLastToast();
    expect(success.title).toBe("Lease renewed");
    expect(success.action).toBeTruthy();
    expect(success.action?.props.altText).toBe("Undo lease renewal");

    await act(async () => {
      success.action?.props.onClick?.();
    });

    expect(onRenew).toHaveBeenCalledTimes(2);
    expect(onRenew).toHaveBeenNthCalledWith(2, "2026-01-15", "Active");
  });

  it("renewing from Expired flips to Active, and Undo restores the original Expired status", async () => {
    const onRenew = vi.fn();
    await renderPopover({
      currentEndDate: "2026-01-15",
      currentStatus: "Expired",
      onRenew,
    });

    await act(async () => {
      findButtonByText("+1 year").click();
    });

    expect(onRenew).toHaveBeenNthCalledWith(1, "2027-01-15", "Active");

    const success = getLastToast();
    expect(success.action).toBeTruthy();

    await act(async () => {
      success.action?.props.onClick?.();
    });

    expect(onRenew).toHaveBeenCalledTimes(2);
    expect(onRenew).toHaveBeenNthCalledWith(2, "2026-01-15", "Expired");
  });

  it("custom-date apply path: renews to the typed date and Undo restores the original end date and status", async () => {
    const onRenew = vi.fn();
    await renderPopover({
      currentEndDate: "2026-01-15",
      currentStatus: "Active",
      onRenew,
    });

    await setReactInputValue(getCustomDateInput(), "2026-09-30");

    await act(async () => {
      getApplyCustomButton().click();
    });

    expect(onRenew).toHaveBeenCalledTimes(1);
    expect(onRenew).toHaveBeenNthCalledWith(1, "2026-09-30", "Active");

    const success = getLastToast();
    expect(success.title).toBe("Lease renewed");
    expect(success.action).toBeTruthy();
    expect(success.action?.props.altText).toBe("Undo lease renewal");

    await act(async () => {
      success.action?.props.onClick?.();
    });

    expect(onRenew).toHaveBeenCalledTimes(2);
    expect(onRenew).toHaveBeenNthCalledWith(2, "2026-01-15", "Active");

    const undone = getLastToast();
    expect(undone.title).toBe("Renewal undone");
  });

  it("end-of-month start in a non-leap year: +1 year and +6 months pass through correctly formatted target dates to onRenew", async () => {
    const onRenew = vi.fn();
    await renderPopover({
      currentEndDate: "2025-01-31",
      currentStatus: "Active",
      onRenew,
    });

    await act(async () => {
      findButtonByText("+1 year").click();
    });

    expect(onRenew).toHaveBeenCalledTimes(1);
    expect(onRenew).toHaveBeenNthCalledWith(1, "2026-01-31", "Active");

    await renderPopover({
      currentEndDate: "2025-01-31",
      currentStatus: "Active",
      onRenew,
    });

    await act(async () => {
      findButtonByText("+6 months").click();
    });

    expect(onRenew).toHaveBeenCalledTimes(2);
    expect(onRenew).toHaveBeenNthCalledWith(2, "2025-07-31", "Active");
  });

  it("end-of-month start in a leap year: +1 year and +6 months pass through correctly formatted target dates to onRenew", async () => {
    const onRenew = vi.fn();
    await renderPopover({
      currentEndDate: "2024-01-31",
      currentStatus: "Active",
      onRenew,
    });

    await act(async () => {
      findButtonByText("+1 year").click();
    });

    expect(onRenew).toHaveBeenCalledTimes(1);
    expect(onRenew).toHaveBeenNthCalledWith(1, "2025-01-31", "Active");

    await renderPopover({
      currentEndDate: "2024-01-31",
      currentStatus: "Active",
      onRenew,
    });

    await act(async () => {
      findButtonByText("+6 months").click();
    });

    expect(onRenew).toHaveBeenCalledTimes(2);
    expect(onRenew).toHaveBeenNthCalledWith(2, "2024-07-31", "Active");
  });

  it("end-of-month start that requires clamping: +6 months from Aug 31 clamps to Feb 28 in a non-leap target year", async () => {
    const onRenew = vi.fn();
    await renderPopover({
      currentEndDate: "2025-08-31",
      currentStatus: "Active",
      onRenew,
    });

    await act(async () => {
      findButtonByText("+6 months").click();
    });

    expect(onRenew).toHaveBeenCalledTimes(1);
    expect(onRenew).toHaveBeenNthCalledWith(1, "2026-02-28", "Active");

    await act(async () => {
      findButtonByText("+1 year").click();
    });

    expect(onRenew).toHaveBeenCalledTimes(2);
    expect(onRenew).toHaveBeenNthCalledWith(2, "2026-08-31", "Active");
  });

  it("end-of-month start that requires clamping: +6 months from Aug 31 clamps to Feb 29 in a leap target year", async () => {
    const onRenew = vi.fn();
    await renderPopover({
      currentEndDate: "2023-08-31",
      currentStatus: "Active",
      onRenew,
    });

    await act(async () => {
      findButtonByText("+6 months").click();
    });

    expect(onRenew).toHaveBeenCalledTimes(1);
    expect(onRenew).toHaveBeenNthCalledWith(1, "2024-02-29", "Active");

    await act(async () => {
      findButtonByText("+1 year").click();
    });

    expect(onRenew).toHaveBeenCalledTimes(2);
    expect(onRenew).toHaveBeenNthCalledWith(2, "2024-08-31", "Active");
  });

  it("does not call onRenew and does not show an Undo action when the new end date is not after the current end date", async () => {
    const onRenew = vi.fn();
    await renderPopover({
      currentEndDate: "2026-01-15",
      currentStatus: "Active",
      onRenew,
    });

    await setReactInputValue(getCustomDateInput(), "2026-01-15");

    await act(async () => {
      getApplyCustomButton().click();
    });

    expect(onRenew).not.toHaveBeenCalled();
    const last = getLastToast();
    expect(last.title).toBe("Invalid date");
    expect(last.action).toBeUndefined();
  });
});
