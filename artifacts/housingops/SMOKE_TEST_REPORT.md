# HousingOps Broad Smoke Test — Report

**Date:** 2026-05-03
**Scope:** Pages render, navigation, customer scoping, basic CRUD persistence, import/export round-trip, perceived performance.
**Out of scope:** Deep business-logic correctness, mobile/responsive, load testing.

## Summary
Overall: **PASS** with one persistence gap and a minor UX nit.

## Part A — Page renders

| Page | Result |
|---|---|
| /login | PASS |
| /dashboard | PASS |
| /customers | PASS |
| /customers/:id | PASS |
| /properties | PASS |
| /properties/:id — Overview tab | PASS |
| /properties/:id — Leases tab | PASS |
| /properties/:id — Beds tab | PASS |
| /properties/:id — Furnishings tab | PASS |
| /properties/:id — Utilities tab | PASS |
| /properties/:id — Finance tab | PASS |
| /leases | PASS |
| /leases/:id | PASS |
| /beds | PASS |
| /occupants | PASS |
| /utilities | PASS |
| /finance | PASS |

No error boundaries triggered, no broken images, no app-runtime console errors observed in the browser (only Vite dev/HMR connect messages).

## Part B — Navigation & customer scoping
- Sidebar nav links all worked.
- Selecting a specific customer (Acme Energy) correctly scoped /properties, /leases, and /beds; sidebar showed the "Filtered by customer" chip.
- Clearing the scope via the X restored the full list.
- Cross-page links (property → lease, lease → occupant/bed) navigated correctly.
- **PASS.**

## Part C — Create / edit persistence
- Add property "SmokeProp_1777838343848" → appeared and **persisted across reload**. PASS.
- Add lease on that property (today → +1 yr, rent $1,000) → appeared and persisted. PASS.
- Add bed → appeared and persisted. PASS.
- Inline-edit room sqft → 221, blur → **persisted across reload**. PASS.
- **Customer Notes save-on-blur**: after editing and reloading, the field showed the prior text instead of the new note. **FAIL — persistence not confirmed.**
  - Repro: open any /customers/:id, edit the Notes textarea, click outside to blur, reload the page. Expected: new text. Actual: original text reappears.
  - This may be the same underlying issue tracked by the existing tasks "Don't lose typed Notes when leaving the page mid-edit" and "Cover the rest of the data store so other edits can't silently stop saving" — flagging here for visibility, no new follow-up filed.

## Part D — Import / Export round-trip
1. Export → JSON file downloaded successfully (toast confirmed counts).
2. Reset to sample data → SmokeProp gone, demo data restored. PASS.
3. Import (Replace mode) using the exported file → toast "Data imported"; SmokeProp_1777838343848 reappeared. PASS.
4. Final reset to sample data → app left in clean seeded state. PASS.

## Part E — Performance
- All primary pages felt interactive within ~1s on the seeded dataset.
- Tab switching on Property Detail, customer scope toggling, and sidebar nav were snappy with no visible jank.
- **All snappy** — nothing flagged as slow.

## Console errors
None from app code during the run. Only Vite dev/HMR connect informational messages.

## Minor UX note
- Lease-create date inputs needed ISO-format text to be accepted cleanly during entry. Not blocking — the form completed successfully.
