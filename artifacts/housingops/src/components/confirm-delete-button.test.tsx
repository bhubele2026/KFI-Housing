import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ConfirmDeleteButton } from "./confirm-delete-button";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function findInPortal(testId: string): HTMLElement | null {
  return document.querySelector(`[data-testid="${testId}"]`);
}

describe("ConfirmDeleteButton", () => {
  it("does not call onConfirm when the user cancels", () => {
    const onConfirm = vi.fn();

    act(() => {
      root.render(
        <ConfirmDeleteButton
          title="Delete this row?"
          description="Cannot be undone."
          onConfirm={onConfirm}
          testId="dialog-test"
          trigger={<button data-testid="trigger">Delete</button>}
        />,
      );
    });

    // Open the dialog.
    act(() => {
      (container.querySelector('[data-testid="trigger"]') as HTMLButtonElement).click();
    });

    expect(findInPortal("dialog-test")).toBeTruthy();

    // Cancel.
    act(() => {
      (findInPortal("button-confirm-delete-cancel") as HTMLButtonElement).click();
    });

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("calls onConfirm exactly once when the user confirms", () => {
    const onConfirm = vi.fn();

    act(() => {
      root.render(
        <ConfirmDeleteButton
          title="Delete this row?"
          description="Cannot be undone."
          onConfirm={onConfirm}
          testId="dialog-test-2"
          trigger={<button data-testid="trigger-2">Delete</button>}
        />,
      );
    });

    act(() => {
      (container.querySelector('[data-testid="trigger-2"]') as HTMLButtonElement).click();
    });

    act(() => {
      (findInPortal("button-confirm-delete-confirm") as HTMLButtonElement).click();
    });

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
