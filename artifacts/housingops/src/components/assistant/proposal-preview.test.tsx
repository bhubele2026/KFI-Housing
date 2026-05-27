import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderPreview, stripInternalFields } from "./proposal-preview";

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

function render(node: React.ReactNode) {
  act(() => {
    root.render(<>{node}</>);
  });
}

describe("stripInternalFields", () => {
  it("removes keys ending in Missing and starting with _ at any depth", () => {
    const cleaned = stripInternalFields({
      keep: 1,
      monthlyCostMissing: true,
      _private: "x",
      nested: {
        keep2: 2,
        somethingMissing: false,
        _hidden: "h",
        inner: { _x: 1, ok: "y" },
      },
      arr: [{ ok: 1, fooMissing: true }],
    });
    expect(cleaned).toEqual({
      keep: 1,
      nested: { keep2: 2, inner: { ok: "y" } },
      arr: [{ ok: 1 }],
    });
  });
});

describe("renderPreview", () => {
  it("bulk_create_utilities renders header + table and shows — for blanks; hides Missing flags", () => {
    render(
      renderPreview("bulk_create_utilities", {
        propertyId: "prop_123",
        count: 2,
        items: [
          { type: "Water", company: "Acme", monthlyCost: 50, accountNumber: "", notes: "", monthlyCostMissing: false },
          { type: "Garbage", company: "", monthlyCost: null, accountNumber: "", notes: "monthly", monthlyCostMissing: true },
        ],
      }),
    );
    const text = container.textContent ?? "";
    expect(text).toContain("Add 2 utilities to prop_123");
    expect(text).toContain("Water");
    expect(text).toContain("Acme");
    expect(text).toContain("50");
    expect(text).toContain("Garbage");
    expect(text).toContain("monthly");
    expect(text).toContain("—");
    expect(text).not.toContain("Missing");
    expect(text).not.toContain("monthlyCostMissing");
  });

  it("bulk_update_leases shows stale-id marker when before is null", () => {
    render(
      renderPreview("bulk_update_leases", {
        count: 1,
        changes: [
          { id: "lease_404", before: null, after: { monthlyRent: 1200 } },
        ],
      }),
    );
    const text = container.textContent ?? "";
    expect(text).toContain("Update 1 lease");
    expect(text).toContain("lease_404");
    expect(text).toContain("monthlyRent");
    expect(text).toContain("1200");
    expect(text).toContain("(not found — id may be stale)");
  });

  it("unknown tool renders a collapsed details fallback hiding the JSON", () => {
    render(renderPreview("some_unknown_tool", { foo: "bar", _hidden: "x" }));
    const details = container.querySelector("details");
    expect(details).not.toBeNull();
    expect(details?.hasAttribute("open")).toBe(false);
    const summary = container.querySelector("summary");
    expect(summary?.textContent).toMatch(/show raw preview/i);
    // Content is in the DOM but the <details> is closed, so visually hidden.
    expect(container.textContent ?? "").toContain("foo");
    expect(container.textContent ?? "").not.toContain("_hidden");
  });
});
