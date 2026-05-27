import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    "BASE_PATH environment variable is required but was not provided.",
  );
}

// Vite only auto-loads VITE_* variables from .env files in envDir; it
// does NOT forward shell-level process.env.VITE_* into the browser
// bundle. In Replit, build-time secrets live in the workflow's shell
// environment, not in a committed .env file, so we have to bridge
// them ourselves. Enumerate every VITE_* key from process.env at
// config-evaluation time and inline them into import.meta.env via
// Vite's `define`. Done generically so the next VITE_* variable the
// app reads "just works" — no per-key plumbing. (Google Maps secrets
// no longer live here — they're fetched at runtime from the
// api-server's `GET /api/config` endpoint so they can be rotated
// without a web rebuild; see replit.md.)
const viteEnvDefines: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) {
  if (!key.startsWith("VITE_")) continue;
  viteEnvDefines[`import.meta.env.${key}`] = JSON.stringify(value ?? "");
}

export default defineConfig({
  base: basePath,
  define: viteEnvDefines,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    // NOTE: do NOT re-introduce a custom `rollupOptions.output.manualChunks`
    // splitter here without verifying the production build in a real
    // browser. A previous splitter (commit 7c42efb) put recharts/d3 in a
    // `charts` chunk and react/react-dom/scheduler/react-is in a `react`
    // chunk; that created a Temporal Dead Zone cycle between the two
    // chunks ("ReferenceError: Cannot access 'A' before initialization"
    // out of charts-*.js) that rendered the entire app as a blank white
    // page in production while leaving dev untouched. Vite's default
    // chunking is fine — leave it alone.
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
