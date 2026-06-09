---
name: HousingOps schema auto-push & frontend data-fetch split
description: How DB tables get created and the two ways the web app talks to the API — guides where to add new persistence/UI without manual migrations or codegen.
---

# Adding DB tables

Adding a new table is: create `lib/db/src/schema/<name>.ts`, then `export * from "./<name>"` in `lib/db/src/schema/index.ts`. The api-server runs `pushSchemaIfNeeded` (drizzle push) at boot and on merge, so the table + indexes are created automatically on the next restart — there are NO hand-written migration files for ordinary additive changes.

**Why:** Confirmed by adding the `activity_log` table; boot logs printed the generated `CREATE TABLE`/`CREATE INDEX` and "Schema changes applied." No migration step was needed.
**How to apply:** For additive schema, just add+export the file and restart the API Server. Reserve manual migration shims (see `lib/db/src/migrations/`) only for destructive/renaming changes that drizzle push would misread as drops.

# Frontend → API: two patterns

The web app (`artifacts/housingops`) talks to the API two ways:
1. Generated client + hooks from `@workspace/api-client-react` (OpenAPI codegen) — used by digest recipients, etc.
2. Manual `customFetch<T>("/api/...")` from the same package, wrapped in TanStack Query — used by Team and QuickBooks settings.

**Why:** `customFetch` already handles base-path prefixing + Clerk auth, so a new read-only feature can skip OpenAPI codegen entirely by using pattern (2).
**How to apply:** If you don't need typed generated hooks, mirror `team-settings.tsx`: `useQuery({ queryFn: () => customFetch<T>("/api/...") })`. Only run codegen when you want the generated client surface.
