# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## Artifacts

- **artifacts/api-server** — Express API server. Owns CRUD endpoints for HousingOps (`/api/customers`, `/api/properties`, `/api/leases`, `/api/beds`, `/api/occupants`, `/api/utilities`) plus `/api/healthz`. `DELETE /api/customers/:id` returns 409 if any property still references the customer. Seeds Postgres with sample housing data on first start (`src/lib/seed.ts`) — 3 customers each owning 1–2 of the 5 sample properties. On every startup it also runs `seedHousingDeductions()` (`src/lib/seed-housing-deductions.ts`), which idempotently applies weekly deductions from the `EE_Housing_Deduciton_by_Customer` payroll export (rows are embedded in the file as `HOUSING_DEDUCTION_ROWS`). It matches existing occupants by `employeeId == personId`, then `(name, company)` case-insensitive, then unique-name-only as a last resort; it never inserts new occupants — unmatched rows are warn-logged for reconciliation.
- **artifacts/housingops** — React + Vite app branded as **HousingOps**. Reads/writes housing data via the API using react-query hooks generated from `lib/api-spec/openapi.yaml`. The shared data store (`src/context/data-store.tsx`) wraps the generated hooks and applies optimistic cache updates so UI stays snappy. Customers are first-class: dedicated `/customers` page, every property requires a `customerId`, and Properties / Leases / Property Detail / Dashboard all surface the owning customer (Properties supports `?customer=<id>` URL filter and a sortable Customer column). Internal localStorage keys and the JSON export format literal still use the `housingops` prefix to avoid breaking existing user data.
  - **Google Maps key (runtime)**: Both the Property detail Location card and the portfolio map (`/properties` map view) fetch their Google Maps API key from the api-server's `GET /api/config` endpoint on mount and cache it via react-query (shared query key, so the second consumer to mount gets the cached response instantly). To rotate the key, set `GOOGLE_MAPS_API_KEY` on **api-server** and restart only `artifacts/api-server: API Server` — the housingops web workflow does not need a restart and no rebuild is needed. When the env var is unset / blank, the endpoint returns `null`; the Location card falls back to an "Open in Google Maps" link and the portfolio map shows a friendly setup note that points at the api-server secret. Use a Google Maps API key restricted to the project's domains.
  - **Google Maps Map ID (runtime)**: The portfolio map's branded vector style is also delivered via `GET /api/config` — set `GOOGLE_MAPS_MAP_ID` on **api-server** to a Map ID provisioned in the team's Google Cloud Console (custom palette + reduced POI clutter) and restart only the api-server to roll a new style across the app; no web rebuild needed. When the env var is unset or whitespace-only, the endpoint returns `null` and the portfolio map falls back to Google's built-in `DEMO_MAP_ID`, which renders an unstyled map but still lets `AdvancedMarkerElement` attach pins so a fresh dev workspace is never blank.
  - **Production fast-fail on missing key (Task #191)**: when `NODE_ENV=production`, `start()` in `artifacts/api-server/src/start.ts` checks for the same trimmed-canonical-OR-trimmed-legacy condition the route reads, and if neither is set it logs an error naming BOTH `GOOGLE_MAPS_API_KEY` and `VITE_GOOGLE_MAPS_API_KEY` and exits 1 *before* `listen()`. Combined with the `production.health.startup` probe at `/api/healthz` in `artifacts/api-server/.replit-artifact/artifact.toml`, this means the new revision never responds and Replit's autoscale system refuses to promote the bad build over the previous good one — the missing secret is caught in CI before it actually reaches production users. Local dev is intentionally unaffected: dev still goes through the post-listen WARN (`warnIfGoogleMapsKeyMissing`), so workflows still start and surface the issue non-fatally. There are also two operator scripts under `scripts/`: `pnpm --filter @workspace/scripts run check:deploy-env` (env-var presence check, no HTTP — useful as a manual pre-publish guard) and `pnpm --filter @workspace/scripts run check:deployed-config <deploy-url>` (hits `<deploy-url>/api/config` against a live deploy and asserts a non-empty `googleMapsApiKey`, with the same dual-env-var failure messaging).
  - **Live key/Map ID rotation in already-open tabs**: `useRuntimeConfigQuery` (`src/hooks/use-runtime-config.ts`) wraps the `/api/config` query for both map components and configures a periodic background refetch (every `RUNTIME_CONFIG_REFETCH_INTERVAL_MS` ≈ 60s) plus refetch-on-window-focus and refetch-on-reconnect. So after an operator restarts the api-server with new env vars, every open browser tab picks up the rotated values within the bounded window without a hard refresh: the property-detail iframe re-renders with the new key in its `src`, the portfolio map re-creates its `google.maps.Map` with the new Map ID, and `loadMapsApi` in `portfolio-map.tsx` detects a key change vs. its `loadedApiKey` tracker and tears down the old `<script data-housingops-maps>` + `window.google` / `window.__housingopsMapsLoader` so the SDK re-loads against the new key (the JS SDK binds its key in the `<script>` URL at load time, so without that tear-down a rotated key would only take effect on a real page reload). `staleTime` is half the refetch interval so back-to-back mounts share the cached response without ever masking a rotation that's already due to land.
- **artifacts/mockup-sandbox** — Design canvas for component previews.

Data persistence: HousingOps used to persist via browser localStorage. It now uses the api-server + Postgres so edits are shared across devices/browsers.

Portfolio map geocoding: properties carry optional `lat`/`lng` columns. The portfolio map renders pins from the stored coordinates with no Geocoder round-trip; only properties without cached coords fall back to the live Google Geocoder, and those resolved coordinates are persisted server-side via `updateProperty` so subsequent visits paint instantly. Editing a property's address/city/state/zip without simultaneously writing lat/lng resets the cached coords to `null` so the next map view re-geocodes against the updated address.

## Gotchas

- **Production schema drift is non-fatal (warn-and-continue).** `artifacts/api-server/src/start.ts` used to `exit(1)` whenever the Drizzle source-of-truth schema and the prod DB disagreed on anything — including cosmetic `SET DEFAULT` diffs that don't affect runtime behavior (defaults are also expressed in the schema via `.default(...)`). That blocked publishes with no in-app remediation path on this platform. The startup now logs a loud `warn`, fires the `SCHEMA_DRIFT_WEBHOOK_URL` chat notification (capped at 3s so a hung webhook can't block startup), and continues serving. **Real errors (DB unreachable, non-drift exceptions) still `exit(1)`** so bad revisions don't promote. Drift detection is message-based via `isSchemaDriftError`. Apply pending statements through the Replit publish flow's schema sync (or contact Replit support) when convenient — they will not auto-apply.
