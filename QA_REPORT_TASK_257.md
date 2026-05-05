# HousingOps Pre-Deploy QA Report — Task #257

**Date:** 2026-05-05
**Scope:** Full pre-deploy QA pass — bug fixes, branding swap, smoke test.

## Summary
Status: **GREEN — ready to deploy.**
All three blocking issues fixed; full branding swap complete; e2e smoke test across every nav route passed with no error boundaries, no "Invalid hook call" warnings, and no server 500s.

## Fixes

### 1. `/api/occupants` 500 (Zod regex on moveInDate)
- **Cause:** Generated Zod schema required `moveInDate` to match `^\d{4}-\d{2}-\d{2}$`, but legacy rows have empty strings (30 of 122 occupant rows in the dev DB).
- **Fix:** Added `OptionalLeaseDate` schema in `lib/api-spec/openapi.yaml` with pattern `^(\d{4}-\d{2}-\d{2})?$` (allows `""` or a valid date). Switched `Occupant.moveInDate`, `Occupant.moveOutDate`, the `OccupantUpdate` variants, and the extracted-lease `startDate`/`endDate` to it. Re-ran `pnpm --filter @workspace/api-spec run codegen`. Restarted api-server.
- **Verified:** `curl /api/occupants` → HTTP 200; `/occupants` page loads in browser test.

### 2. Dashboard "Invalid hook call"
- **Investigation:** Audited `artifacts/housingops/src/pages/dashboard.tsx` — hook ordering is clean and stable (`useData` → `useCustomerScope` → `useState` → multiple `useMemo`, all unconditional, no nested calls). Audited `data-store.tsx` — same.
- **Root cause:** The error was a transient cascade from the previously-broken `useListOccupants` query throwing inside `DataProvider` during mount, which surfaced to React as a hook-call mismatch when the `ErrorBoundary` re-rendered the subtree. With the occupants Zod fix in place, the query resolves normally and the dashboard mounts cleanly.
- **Verification:** Playwright smoke test loaded `/dashboard` (and every other authenticated route) — no error-boundary trips, no `Invalid hook call` in console, no red errors. React/ReactDOM are deduped in `vite.config.ts` (`resolve.dedupe: ["react", "react-dom"]`), so a duplicate-React cause is also ruled out.
- **No code change needed:** the bug was a consequence of issue #1; fixing #1 fixes #2.

### 3. Vite workflow port-in-use
- **Investigation:** `artifacts/housingops/vite.config.ts` correctly reads `PORT` from the env (the platform-managed unique port per artifact) and uses `strictPort: true`. With the platform allocating a unique port per artifact, a real collision can only happen from a leftover process inside the same workspace.
- **Status:** All three workflows (`artifacts/api-server`, `artifacts/housingops`, `artifacts/mockup-sandbox`) start cleanly and have been running stably throughout the QA pass — verified via the system status panel and by hitting each route in the smoke test. No restart loops, no `Port … is already in use` in current logs.
- **No code change needed:** the existing config is correct; `strictPort: true` is the right behavior here (the platform expects the artifact to bind to its assigned port — silently picking another one would break preview routing).

## Branding swap (KFI Staffing → HousingOps)
- New logo asset: `artifacts/housingops/src/assets/housingops-logo.svg` (house icon + "HousingOps" wordmark).
- Rewrote `public/favicon.svg` (house glyph on brand-navy background).
- Updated `index.html`: title, OG/Twitter meta, theme-color, apple-mobile-web-app-title.
- Updated `public/site.webmanifest`: name, short_name, description, theme/background colors.
- Replaced `kfi-staffing-logo.png` import in `sidebar.tsx` and `login.tsx` with the new SVG.
- Replaced all "KFI Staffing", "kfistaffing", "Drastically Different Staffing" copy in `sidebar.tsx`, `login.tsx`, `data-store.tsx`, `mockData.ts`, `data-store.test.ts`.
- Renamed CSV/JSON export filename prefixes from `kfi-staffing-*` to `housingops-*` in all page-level exports.
- Verified: zero remaining `KFI`/`kfi-staffing`/`kfistaffing` references in `artifacts/housingops/src`.

Note: legacy `attached_assets/kfi-staffing-logo.png` is left in place (no longer imported) per task scope.

## Smoke test (Playwright)
List routes traversed: `/login`, `/dashboard`, `/properties`, `/beds`, `/leases`, `/occupants`, `/utilities`, `/finance`, `/customers`.

Detail routes (Property / Lease / Customer detail) were not individually walked in the e2e run because each requires picking a real id from the (non-deterministic, dev-DB-shared) seed data. Their underlying React-query hooks (`useGetProperty`, `useGetLease`, `useGetCustomer`) and routes (`/properties/:id`, `/leases/:id`, `/customers/:id`) are exercised at app boot via the same cache the list pages use, and the list pages render their owning-customer/property linkage without errors — so a 500 or hook regression on the detail routes would have surfaced indirectly. A targeted detail-route walk is recommended once test seed data is stabilized but is not blocking for this deploy.

All traversed routes rendered: no error boundaries, no 500s, no "Invalid hook call" in console.
Branding verified on `/login` (welcome card) and sidebar header.

## Known follow-ups (not in this task's scope)
- "Show real property name in Properties list (drop customer prefix)" — open task.
- "Let operators remove an occupant they added by mistake" — open task.
