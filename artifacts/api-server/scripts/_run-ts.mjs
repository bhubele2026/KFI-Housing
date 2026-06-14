import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";

globalThis.require = createRequire(import.meta.url);
const artifactDir = path.dirname(fileURLToPath(import.meta.url));
const entry = path.resolve(artifactDir, "..", process.argv[2]);
const outDir = path.resolve(artifactDir, "../dist/_tmp");
const base = path.basename(process.argv[2]).replace(/\.ts$/, ".mjs");
const out = path.join(outDir, base);

await esbuild({
  entryPoints: [entry],
  platform: "node",
  bundle: true,
  format: "esm",
  outdir: outDir,
  outExtension: { ".js": ".mjs" },
  logLevel: "error",
  external: ["*.node", "pg-native", "drizzle-kit", "drizzle-kit/api", "@electric-sql/pglite"],
  plugins: [esbuildPluginPino({ transports: ["pino-pretty"] })],
  banner: {
    js: `import { createRequire as __cr } from 'node:module';
import __p from 'node:path';
import __u from 'node:url';
globalThis.require = __cr(import.meta.url);
globalThis.__filename = __u.fileURLToPath(import.meta.url);
globalThis.__dirname = __p.dirname(globalThis.__filename);`,
  },
});

await import(out);
