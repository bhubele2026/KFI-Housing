// We re-export only the runtime zod schema constants from `generated/api`.
//
// The orval-generated `generated/types/` directory contains TypeScript
// shapes that share identifiers with the schema constants (e.g. multipart
// bodies like `ImportLeasePdfBody`), which causes `export *` collisions.
// Consumers that need just the inferred TS shapes can use
// `z.infer<typeof Schema>` directly off the schema const, so we don't
// re-export the type-only files at all.
//
// Patched by lib/api-spec/scripts/patch-api-zod-index.mjs after orval runs.
export * from "./generated/api";
