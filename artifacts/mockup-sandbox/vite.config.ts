import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { mockupPreviewPlugin } from "./mockupPreviewPlugin";

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
// bundle. In Replit, secrets like VITE_GOOGLE_MAPS_API_KEY live in the
// workflow's shell environment, not in a committed .env file, so we
// have to bridge them ourselves. Enumerate every VITE_* key from
// process.env at config-evaluation time and inline them into
// import.meta.env via Vite's `define`. Done generically so the next
// VITE_* variable the app reads "just works" — no per-key plumbing.
const viteEnvDefines: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) {
  if (!key.startsWith("VITE_")) continue;
  viteEnvDefines[`import.meta.env.${key}`] = JSON.stringify(value ?? "");
}

export default defineConfig({
  base: basePath,
  define: viteEnvDefines,
  plugins: [
    mockupPreviewPlugin(),
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
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist"),
    emptyOutDir: true,
  },
  server: {
    port,
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
