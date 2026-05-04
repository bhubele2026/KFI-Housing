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

- **artifacts/api-server** — Express API server. Owns CRUD endpoints for KFI Staffing (`/api/customers`, `/api/properties`, `/api/leases`, `/api/beds`, `/api/occupants`, `/api/utilities`) plus `/api/healthz`. `DELETE /api/customers/:id` returns 409 if any property still references the customer. Seeds Postgres with sample housing data on first start (`src/lib/seed.ts`) — 3 customers each owning 1–2 of the 5 sample properties.
- **artifacts/housingops** — React + Vite app branded as **KFI Staffing** (formerly HousingOps). Reads/writes housing data via the API using react-query hooks generated from `lib/api-spec/openapi.yaml`. The shared data store (`src/context/data-store.tsx`) wraps the generated hooks and applies optimistic cache updates so UI stays snappy. Customers are first-class: dedicated `/customers` page, every property requires a `customerId`, and Properties / Leases / Property Detail / Dashboard all surface the owning customer (Properties supports `?customer=<id>` URL filter and a sortable Customer column). Internal localStorage keys and the JSON export format literal still use the `housingops` prefix to avoid breaking existing user data.
  - **Google Maps key (runtime)**: The Property detail Location card fetches its Google Maps Embed API key from the api-server's `GET /api/config` endpoint on mount and caches it via react-query. To rotate the key, set `GOOGLE_MAPS_API_KEY` on **api-server** and restart only `artifacts/api-server: API Server` — the housingops web workflow does not need a restart and no rebuild is needed. When the env var is unset / blank, the endpoint returns `null` and the card falls back to an "Open in Google Maps" link. Use a Google Maps Embed API key restricted to the project's domains. (The portfolio-map view still reads the legacy `VITE_GOOGLE_MAPS_API_KEY` build-time var; migrating that to the runtime endpoint is a separate task.)
- **artifacts/mockup-sandbox** — Design canvas for component previews.

Data persistence: KFI Staffing used to persist via browser localStorage. It now uses the api-server + Postgres so edits are shared across devices/browsers.
