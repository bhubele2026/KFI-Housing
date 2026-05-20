import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["./src/test-setup.ts"],
    // Task #632: the full suite was crossing 115s in CI. Switching from
    // the default forks pool (one fresh node process per test file) to
    // threads keeps the same per-file isolation guarantees but skips
    // the worker-process startup tax that dominated the wall clock —
    // most files only run a few hundred ms of actual test code on top
    // of ~1s of import/setup. `isolate: true` (the default) is left in
    // place; turning it off broke ~300 tests that quietly relied on
    // fresh module state between files (`vi.mock` factories, i18n
    // singletons, the Clerk auth wrapper).
    pool: "threads",
  },
});
