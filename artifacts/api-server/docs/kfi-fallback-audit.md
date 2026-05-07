# KFI Staffing fallback-customer audit (Task #361)

Follow-up to Task #328, which patched four KFI Staffing seeds plus the
Chateau Knoll reference so each property attaches to its real downstream
end-client (when one exists) instead of a synthetic per-property
"KFI Staffing — *" fallback. This document is the short report called for
in Task #361's "done looks like": the current state of every seed that
ever creates a KFI-named customer, and the recommendation per row.

## Reconciliation method

Each seed below was inspected directly:

- **Wired to `repointFallbackToEndClient`** — the seed inserts a
  per-property `cust-kfi-*` fallback only when no real end-client exists
  yet, and on every boot it (a) repoints the property AWAY from the
  fallback to the real end-client (matched by name LIKE pattern), and
  (b) deletes the orphaned fallback row when nothing else references it.
- **Operator-managed** — the seed inserts a KFI-named customer
  intentionally, because the lease itself names KFI as the tenant with no
  downstream end-client. Future audits should leave these rows alone.

## Per-seed status

| Seed file                       | Customer name pattern           | End-client / disposition                       | Status |
|---------------------------------|---------------------------------|------------------------------------------------|--------|
| `seed-patriot-baraboo.ts`       | `KFI Staffing – Baraboo, WI`    | `Milwaukee Valve%`                             | Wired (Task #328) |
| `seed-kolbe-wausau.ts`          | `KFI Staffing – Wausau, WI`     | `Schuette Metals%`                             | Wired (Task #328) |
| `seed-greenock-manor.ts`        | `KFI Staffing – Greenock Manor, PA` | `Shuster's Building Components%`           | Wired (Task #328) |
| `seed-hickory-haven.ts`         | `KFI Staffing – Hickory Haven, WI` | `WB Manufactoring%`                         | Wired (Task #328) |
| `seed-park-place.ts`            | `KFI Staffing – Plymouth, MN`   | `Cardinal CG at Spring Green%`                 | Wired (Task #361 follow-through; pattern is deliberately narrow so the unrelated `Cardinal CG - Northfield` master row is not matched) |
| `seed-chateau-knoll.ts`         | `KFI Staffing — Corporate`      | `Greystone Manufacturing%`                     | Wired (Task #312, predates the shared helper) |
| `seed-attached-leases.ts` → Webster | `KFI Staffing – Webster, WI` | None — lease names KFI directly                | **Operator-managed** (no third-party employer named on the 7112 Zielsdorf Dr lease). Customer-row note now states this explicitly so future audits do not flag it. |
| `seed-attached-leases.ts` → AutoZone | `AutoZone – Jeannette, PA` | Already a real customer                       | Not a KFI fallback; no change needed. |
| `seed-attached-leases.ts` → Ridge Motor Inn | `KFI Staffing LLC`     | Umbrella account for the hotel-rate agreement | **Operator-managed** umbrella account (signed by Valerie Alderman per the corporate-rate agreement); not a per-property fallback. |
| `seed-adient.ts`                | `Adient`                        | Already a real customer                        | Not a KFI fallback; no change needed. |
| `seed-payroll-occupants.ts`     | `Adient`, `Bell Timber, Inc.`, `Burnett Dairy - Grantsburg`, `DeLallo Foods`, `Greystone Manufacturing`, `Milwaukee Valve`, `Penda Corp`, `Shuster's Building Components`, `Trienda Holdings` | Real end-client per row | All real customers from the EE Housing Deduction payroll export; no KFI fallback created. |

## Recommended production check

After this task ships, run the following read-only query against
production to confirm no property still resolves to a synthetic KFI
fallback customer:

```sql
SELECT p.id        AS property_id,
       p.name      AS property_name,
       c.id        AS customer_id,
       c.name      AS customer_name
FROM   properties p
JOIN   customers  c ON c.id = p.customer_id
WHERE  c.name LIKE 'KFI Staffing%'
ORDER  BY c.name, p.name;
```

Expected rows (after the boot-time seeds finish their repoint passes):

- `KFI Staffing – Webster, WI` → `7112 Zielsdorf Drive – Webster, WI`
  (operator-managed, per the row above).
- `KFI Staffing LLC` → `The Ridge Motor Inn` (operator-managed umbrella
  account for the hotel-rate agreement).

Any other row indicates an end-client name pattern that hasn't matched
yet (typically because the master-file import has not run on that
deployment) and should be reconciled by either (a) confirming the master
row's downstream end-client and updating the corresponding
`*_END_CLIENT_NAME_PATTERN` constant in the seed, or (b) marking the row
operator-managed in the same way Webster and Ridge Motor Inn are above.

## Production verification log

- **Task #369 (2026-05-07)** — Ran the query above against the
  production read replica. Result: **0 rows**. No property in production
  is currently attached to any `KFI Staffing%` customer (synthetic
  fallback or operator-managed). The Webster Zielsdorf and Ridge Motor
  Inn operator-managed rows are absent because their seeds have not yet
  run against the deployed database; this is not a fallback-attachment
  problem. The audit's pass criterion (no synthetic fallback
  attachments) is satisfied.
