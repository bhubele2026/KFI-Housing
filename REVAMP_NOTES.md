# HousingOps Revamp — Working Notes & Progress Ledger

Driven by `HousingOps_Master_Build_Brief.md` (in `~/Downloads/`). This file is the
running record of what shipped per stage, the acceptance check, and the Replit /
human follow-ups. Updated as each stage lands.

## Environment reality (matters for every stage)
- **No local Node/pnpm** → `typecheck`/tests/`build`/codegen/`db push` all run **on Replit**, not locally. Code is authored + pushed; Replit verifies.
- Git remote is **`origin`** (not `github`): `github.com/bhubele2026/KFI-Housing`, branch `main`.
- Live site **kfi-housing.replit.app is an autoscale Deployment** — only updates on **Deploy ▸ Redeploy**, not Run.
- Frontend `artifacts/housingops` is a **separate Vite app**; deploy `build` runs `typecheck` first, so any TS error keeps the OLD bundle live. Read new OpenAPI fields **cast-safe** until codegen regenerates the client.
- App runs in **PUBLIC_MODE** in prod (curl PATCH/POST writes as admin; never bulk `/api/import`).

## Pre-existing baseline issue (fix before trusting "green")
- Build was RED on `GetVersionResponse` — committed codegen in `lib/api-zod/src/generated` is stale (predates the `/version` endpoint). **Fix = run codegen on Replit** (`pnpm --filter @workspace/api-spec run codegen`) then Redeploy. Durable fix: commit fresh codegen so a `git reset --hard` doesn't re-break it.

## Nav / route snapshot (BEFORE revamp — captured 2026-06-24)
Top nav (`components/layout/top-nav.tsx`): **Dashboard · Customers · Roster · Economics · Accounting · Finance** + Review (icon) + Settings (icon).

Routes (`App.tsx`): `/` → /customers (or last route); `/dashboard`; `/customers`, `/customers/:id`, `/customers/:id/beds`; `/properties`, `/properties/:id`, `/properties/:id/buildings/:buildingId`; `/leases`(+ `/snoozed`,`/new`,`/:id`); `/beds`; `/occupants`, `/occupants/:id`; `/utilities`; `/finance`; `/economics`; `/accounting`; `/rental-companies`; `/roster`; `/reconciliation`; `/qbo/mapping-rules`; `/insurance`; `/review`; `/settings`; `/assistant/changelog`; `/transport/*` → redirect /customers.

Stage 6 target nav: **Dashboard · Clients · Properties · Roster · Money** (Economics/Accounting/Finance tuck under Money; Reconciliation/Insurance/QBO reachable but not top-level).

---

## Stage progress

### Stage 0 — Foundation & safety ✅ (authored)
- **Design tokens (warm operations palette)** added additively to `index.css` `@theme` + `:root` + `.dark`: `ink, surface, panel, line, brand, brand-warm, ok, warn, risk` (+ `*-foreground`, `*-soft` tints). Existing shadcn tokens untouched → existing pages look/behave identically; the full re-skin is Stage 6.
- **Component kit** (`components/kit/`, barrel `index.ts`): new `StatusDot`, `DeductionBadge` (+ `zenopleStatusToDot`), `MoneyTile` (+ `buildPropertyMoneyStats`), `DataTable` (generic sortable/filterable/zebra/tabular), `PrintView` (+ global `@media print` rules). Re-exports existing `EmptyState`/`EmptyStateRow`; `BedGrid` = existing `PropertyBedTable`.
- **Feature flag** `lib/flags.ts` → `BOARD_VIEW_ENABLED` (VITE_BOARD_VIEW; on in dev, off in prod till Stage 7).
- **Schema deltas (additive, Stage 3b/5 prep)** authored now to batch one codegen/push: `occupants.{shiftTime, zenoplePersonId, zenopleStatus, zenopleCheckedAt}`, `vehicles.color`; 3 idempotent migrations registered in `lib/db/src/migrate.ts`.
- **Acceptance:** `pnpm run build` green + app identical → verify on Replit. Kit renders (no consumer yet wired, so zero behavior change).
- **Replit follow-up:** none beyond the standard pull + (later) codegen for the openapi deltas + `db push` for migrations.

### Stage 1 — Property Board ⭐ — (pending)
### Stage 2 — Data backfill — (pending; prod write gated)
### Stage 3 — Deductions everywhere + Zenople matching — (pending)
### Stage 4 — Money view — (pending)
### Stage 5 — Remaining board modules — (pending)
### Stage 6 — Nav + design rollout — (pending)
### Stage 7 — Retire the spreadsheet — (pending)

---

## Open human decisions (flagged, code handles via needsReview)
1. Roster col-A code (86/125) — meaning? (client code? Zenople id?)
2. The 37 app-only people — moved out or spelled differently?
3. 5 who-lives-where conflicts (Greenock 45/49, the Ridge).
4. Orgill = Dexter or Sikeston? Two "Ridge" motels = one property or two?
5. Process: declare the app source-of-truth and stop updating spreadsheets.

## Companion files
- `~/Downloads/KFI_HousingOps_Audit.xlsx` ✅, `~/Downloads/missing_from_app.csv` ✅, brief ✅.
- `KFI_HousingOps_Name_Reconciliation.xlsx` ❌ NOT on disk — needed for the 89-matched/37-app-only routing + conflict list (Stage 2/4). Appendix A's 102 names suffice for the Stage 2 import.
