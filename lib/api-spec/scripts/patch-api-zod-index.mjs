#!/usr/bin/env node
/**
 * Orval emits a `lib/api-zod/src/index.ts` barrel file that re-exports both
 * the generated zod schemas (`generated/api`) and the generated TS shapes
 * (`generated/types/`). Multipart-body operations like
 * `POST /leases/import-pdf` produce a schema constant AND a TS type with the
 * same identifier (e.g. `ImportLeasePdfBody`), and `export *` from both
 * collides at type-check time.
 *
 * The TS shapes aren't actually consumed anywhere in the workspace —
 * downstream code uses `z.infer<typeof Schema>` off the schema constant —
 * so we drop the type-only re-export to keep the package compiling.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const indexPath = path.resolve(__dirname, "..", "..", "api-zod", "src", "index.ts");

const PATCHED = `// We re-export only the runtime zod schema constants from \`generated/api\`.
//
// The orval-generated \`generated/types/\` directory contains TypeScript
// shapes that share identifiers with the schema constants (e.g. multipart
// bodies like \`ImportLeasePdfBody\`), which causes \`export *\` collisions.
// Consumers that need just the inferred TS shapes can use
// \`z.infer<typeof Schema>\` directly off the schema const, so we don't
// re-export the type-only files at all.
//
// Patched by lib/api-spec/scripts/patch-api-zod-index.mjs after orval runs.
export * from "./generated/api";
`;

const current = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, "utf8") : "";
if (current === PATCHED) {
  process.exit(0);
}

fs.writeFileSync(indexPath, PATCHED, "utf8");
console.log(`patched ${path.relative(process.cwd(), indexPath)}`);
