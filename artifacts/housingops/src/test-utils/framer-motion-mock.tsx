import React, { type ReactNode } from "react";

// Canonical jsdom test mock for `framer-motion`.
//
// Background — the bug this helper exists to prevent
// ────────────────────────────────────────────────────
// `framer-motion` exposes `motion` as an object you index by tag name
// (`motion.div`, `motion.tr`, etc.) to get an animated wrapper around the
// underlying DOM element. Tests typically mock this with a Proxy so any
// `motion.<tag>` access yields a passthrough component that strips
// animation-only props.
//
// A naïve Proxy that synthesizes a *fresh* function component on every
// `get` returns a NEW component reference per render. React keys subtree
// identity by component reference, so an enclosing re-render — e.g.
// flipping a tab, picking a Select option — causes React to unmount and
// remount the entire `<motion.div>` subtree. That destroys local state
// inside any mock that uses `useState` (notably the Tabs mock used across
// these tests), silently flipping the page back to its default tab and
// turning real assertion failures into confusing "element not found"
// noise.
//
// `createMotionMock()` caches one component per tag in a Map, so repeated
// `motion.div` accesses return the *same* function reference and React
// preserves subtree state across re-renders.
//
// The companion regression test in `framer-motion-mock.test.tsx` pins
// down the cache contract so a future copy-paste can't reintroduce the
// bug.

const motionPropKeys = new Set([
  "initial",
  "animate",
  "exit",
  "transition",
  "whileHover",
  "whileTap",
  "whileFocus",
  "whileDrag",
  "whileInView",
  "variants",
  "layout",
  "layoutId",
  "drag",
  "dragConstraints",
  "onAnimationStart",
  "onAnimationComplete",
  "onUpdate",
  "viewport",
]);

export function createMotionMock(): {
  motion: Record<string, React.ComponentType<Record<string, unknown> & { children?: ReactNode }>>;
  AnimatePresence: React.ComponentType<{ children?: ReactNode }>;
} {
  const cache = new Map<
    string,
    React.ComponentType<Record<string, unknown> & { children?: ReactNode }>
  >();
  const motion = new Proxy(
    {} as Record<
      string,
      React.ComponentType<Record<string, unknown> & { children?: ReactNode }>
    >,
    {
      get: (_target, tag: string) => {
        const cached = cache.get(tag);
        if (cached) return cached;
        const Component = ({
          children,
          ...rest
        }: Record<string, unknown> & { children?: ReactNode }) => {
          const dom: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(rest)) {
            if (!motionPropKeys.has(k)) dom[k] = v;
          }
          return React.createElement(tag, dom, children);
        };
        cache.set(tag, Component);
        return Component;
      },
    },
  );
  const AnimatePresence = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return { motion, AnimatePresence };
}
