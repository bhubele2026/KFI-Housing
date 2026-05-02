import { describe, it, expect } from "vitest";
import React, { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { createMotionMock } from "./framer-motion-mock";

// Pin down the contract that the canonical framer-motion mock guarantees.
// If any of these break, the silent "tab snaps back to default mid-test"
// bug described in framer-motion-mock.tsx can reappear via copy-paste.

describe("createMotionMock", () => {
  it("returns the SAME component reference for repeated motion.<tag> accesses", () => {
    // The cache is the whole point of this helper. A fresh component per
    // access would make React unmount the entire <motion.tag> subtree on
    // every parent re-render, blowing away child useState (e.g. the Tabs
    // mock's active value) and silently flipping the page back to its
    // default tab mid-test.
    const { motion } = createMotionMock();
    expect(motion.div).toBe(motion.div);
    expect(motion.tr).toBe(motion.tr);
    expect(motion.section).toBe(motion.section);
  });

  it("returns a DIFFERENT component reference for different tags", () => {
    // Different tags must be different components — otherwise a
    // <motion.tr> would render as a <div> and break table layout.
    const { motion } = createMotionMock();
    expect(motion.div).not.toBe(motion.tr);
    expect(motion.section).not.toBe(motion.div);
  });

  it("renders the requested HTML tag and forwards non-motion props", async () => {
    const { motion } = createMotionMock();
    const Div = motion.div;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <Div data-testid="m" className="cls" id="x">
          hello
        </Div>,
      );
    });

    const el = container.querySelector('[data-testid="m"]');
    expect(el).not.toBeNull();
    expect(el?.tagName).toBe("DIV");
    expect(el?.getAttribute("class")).toBe("cls");
    expect(el?.getAttribute("id")).toBe("x");
    expect(el?.textContent).toBe("hello");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("strips animation-only props so React doesn't warn about unknown DOM attributes", async () => {
    const { motion } = createMotionMock();
    const Div = motion.div;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <Div
          data-testid="m"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          variants={{}}
          layout
          layoutId="hero"
          drag
          dragConstraints={{}}
          viewport={{ once: true }}
          onAnimationStart={() => {}}
          onAnimationComplete={() => {}}
          onUpdate={() => {}}
        >
          hi
        </Div>,
      );
    });

    const el = container.querySelector('[data-testid="m"]') as HTMLElement;
    expect(el).not.toBeNull();
    for (const attr of [
      "initial",
      "animate",
      "exit",
      "transition",
      "whilehover",
      "whiletap",
      "variants",
      "layout",
      "layoutid",
      "drag",
      "dragconstraints",
      "viewport",
    ]) {
      expect(el.hasAttribute(attr)).toBe(false);
    }

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("preserves child component state across parent re-renders (no unmount churn)", async () => {
    // Direct guard against the original silent regression. We render a
    // <motion.div> wrapping a child that owns local useState. A re-render
    // of the parent must NOT cause React to unmount/remount the child,
    // because that would reset the state to its initial value.
    const { motion } = createMotionMock();
    const Div = motion.div;

    let mounts = 0;
    function Counter() {
      const [n, setN] = React.useState(0);
      React.useEffect(() => {
        mounts += 1;
      }, []);
      return (
        <button
          type="button"
          data-testid="counter"
          data-mounts={String(mounts)}
          onClick={() => setN((x) => x + 1)}
        >
          {n}
        </button>
      );
    }

    function Parent({ token }: { token: number }) {
      // `token` exists so we can force the parent to re-render without
      // changing the Counter's props.
      return (
        <Div data-token={token}>
          <Counter />
        </Div>
      );
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<Parent token={1} />);
    });
    const beforeMounts = mounts;
    const btn = container.querySelector(
      '[data-testid="counter"]',
    ) as HTMLButtonElement;
    await act(async () => {
      btn.click();
      btn.click();
    });
    expect(btn.textContent).toBe("2");

    // Re-render with a new prop on the parent → must NOT remount Counter.
    await act(async () => {
      root.render(<Parent token={2} />);
    });
    const after = container.querySelector(
      '[data-testid="counter"]',
    ) as HTMLButtonElement;
    expect(after.textContent).toBe("2");
    expect(mounts).toBe(beforeMounts);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("AnimatePresence renders children as a passthrough", async () => {
    const { AnimatePresence } = createMotionMock();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const child: ReactNode = <span data-testid="child">x</span>;
    await act(async () => {
      root.render(<AnimatePresence>{child}</AnimatePresence>);
    });
    expect(container.querySelector('[data-testid="child"]')).not.toBeNull();
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
