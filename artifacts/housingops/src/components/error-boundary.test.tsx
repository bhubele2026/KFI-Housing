import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ErrorBoundary } from "./error-boundary";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  // React logs the caught error to console.error in dev mode; silence it
  // to keep test output readable.
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  consoleErrorSpy.mockRestore();
});

function Boom({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error("boom-msg");
  return <div data-testid="boom-ok">all good</div>;
}

describe("ErrorBoundary", () => {
  it("renders the fallback when a child throws and shows the error message", () => {
    act(() => {
      root.render(
        <ErrorBoundary>
          <Boom shouldThrow />
        </ErrorBoundary>,
      );
    });

    const fallback = container.querySelector('[data-testid="error-boundary-fallback"]');
    expect(fallback).toBeTruthy();
    expect(container.querySelector('[data-testid="error-boundary-message"]')?.textContent).toBe("boom-msg");
  });

  it("recovers when the user clicks Try again and the underlying issue is resolved", () => {
    // ErrorBoundary's `children` prop is captured at parent render time —
    // after the boundary catches, we have to re-render the parent with
    // the fixed prop so the next render of `children` doesn't re-throw.
    let shouldThrow = true;
    const Harness = () => (
      <ErrorBoundary>
        <Boom shouldThrow={shouldThrow} />
      </ErrorBoundary>
    );

    act(() => root.render(<Harness />));
    expect(container.querySelector('[data-testid="error-boundary-fallback"]')).toBeTruthy();

    // Fix the underlying issue, re-render the parent (so the boundary's
    // children prop reflects the fix), then click Try again.
    shouldThrow = false;
    act(() => root.render(<Harness />));
    act(() => {
      (container.querySelector('[data-testid="button-error-boundary-retry"]') as HTMLButtonElement).click();
    });

    expect(container.querySelector('[data-testid="boom-ok"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="error-boundary-fallback"]')).toBeFalsy();
  });
});
