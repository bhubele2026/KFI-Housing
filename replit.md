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

- **artifacts/api-server** — Express API server. Owns CRUD endpoints for HousingOps (`/api/properties`, `/api/leases`, `/api/beds`, `/api/occupants`, `/api/utilities`) plus `/api/healthz`. Seeds Postgres with sample housing data on first start (`src/lib/seed.ts`).
- **artifacts/housingops** — React + Vite app. Reads/writes housing data via the API using react-query hooks generated from `lib/api-spec/openapi.yaml`. The shared data store (`src/context/data-store.tsx`) wraps the generated hooks and applies optimistic cache updates so UI stays snappy.
- **artifacts/mockup-sandbox** — Design canvas for component previews.

Data persistence: HousingOps used to persist via browser localStorage. It now uses the api-server + Postgres so edits are shared across devices/browsers.
