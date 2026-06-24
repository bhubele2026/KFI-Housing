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

### Stage 1 — Property Board ⭐ ✅ (commit 7de18d0)
- `<PropertyBoard>` (components/property-board/property-board.tsx): warm header + Capacity·Occupied·Available + MoneyTile + existing PropertyBedTable. Added a "Board" tab to property-detail.tsx, default landing when BOARD_VIEW_ENABLED. Counts match existing stat cards. Cast-safe.

### Stage 2 — Data backfill — ✅ DRY-RUN only (commit 22bbb22); prod write GATED
- imports/_stage2_dryrun.py + imports/stage2-backfill-dryrun.md. 102 reconciled vs 130 live occupants (name-dup guard): **44 single-property safe · 33 cluster (need master unit) · 12 property-not-live (Chateau Knoll ×11, Econo Lodge ×1) · 13 decision-blocked (El Paso Bartlett ×4, Orgill ×9) · 0 dups.** Rent backfill (24 props) + the actual occupant POSTs NOT done (needs SharePoint OCR + sign-off + the open decisions).

### Stage 3 — Deductions + Zenople matching
- **3a backend ✅ (commit 57af1d3):** lib/occupant-deduction.ts (getOccupantDeduction/Batch, no N+1) + GET /occupants attaches read-only `deduction` + openapi Occupant/Vehicle deltas. Surfaces after Replit codegen + db push.
- **3a frontend** — IN PROGRESS (badge on occupants/bed-grid/roster/customer roll-up).
- **3c/3d/3e backend** — IN PROGRESS (zenople status writing in sync; POST /api/zenople/match/suggest AI route; GET unlinked tray endpoint).
- **3d/3e backend confirm route ✅ (5cbb205):** POST /api/zenople/match/confirm (action confirm/mark_not/reject) — the only manual link-status write path.
- **3e frontend ✅ (3196bea):** pages/zenople-review.tsx review queue (unlinked list → AI suggest → Confirm/Reject/Mark) + top-nav payroll-gaps count badge + /zenople-review route.

### Stage 4 — Money view ✅ (d647aab)
- dashboard "Not in payroll yet" strip + "Money leaks" card (each one-click into the fix); property-board money tile split collected-vs-at-risk; customer-detail recovery split; finance portfolio MoneyTile. Skipped (noted): charge≠client-expected (needs Stage 2 weekly cost), unmapped-QBO count.

### Stage 5 — Board modules ✅ (this commit)
- components/property-board/: BoardSection, ShiftCoverage, ContactRoster (DataTable + CSV in sheet col order), VehiclesPanel (reuses useListVehicles/Riders, color cast-safe). Reused existing ProjectedMoveInsSection for the move-in/out ledger (Record move-out = PATCH Former; Promote = convert route). Board wrapped in PrintView (Print/Export). Backend write-paths for shiftTime/color: openapi only (2488b87), normalizers pass through.
- **col-A roster code (86/125): FLAGGED not guessed** — not on the occupant schema; needs the open decision + optional client_code column.
- Skipped (noted): day/night rider split (needs vehicle_ride_overrides), inline roster-cell edit (links through to occupant edit).

### Stage 6 — Nav + design rollout ✅ partial (637ed95)
- Nav collapsed to Dashboard·Clients·Properties·Roster·Money (Money = dropdown over Finance/Economics/Accounting). Label pass via i18n en.json VALUES only.
- **DEFERRED polish (noted):** full DataTable rollout across every list page; sweeping hardcoded non-i18n page strings; the warm re-skin of legacy pages beyond the Board. High-risk-blind / mechanical; recommend after a green Replit typecheck.

### Stage 7 — Retire the spreadsheet — manual sign-off (not code)
- Side-by-side check on 2 properties + cheat-sheet + flip VITE_BOARD_VIEW on in prod. Needs a human; the cheat-sheet (where-did-my-column-go) is a quick follow-up.

## Replit follow-ups accumulated (run once, batched)
1. `pnpm --filter @workspace/api-spec run codegen` — REQUIRED (openapi gained Occupant.deduction/zenople fields + Vehicle.color + Stage 3d/e routes). Also fixes the pre-existing GetVersionResponse red build.
2. `pnpm --filter @workspace/db run push` — applies the 3 additive migrations (occupant zenople/shift_time, vehicle color).
3. `pnpm run typecheck` + package tests (the per-phase gate I can't run locally).
4. Deploy ▸ Redeploy; hard-refresh.
5. VITE_BOARD_VIEW is on in dev by default; set it on in prod when ready to show the Board on the live site.

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
