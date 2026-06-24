# Harvest Apply — Status & Open Items

## ⚠️ OPEN — duplicate occupants from the 2026-06-23 reconcile seating (found 2026-06-24, left as-is per user)
The reconcile seating created a SECOND occupant for the two people who already had a
record matched by `employeeId`, instead of attaching the existing record to the bed:

| Person | emp | Pre-existing (unplaced) | Reconcile insert (seated) |
|---|---|---|---|
| Jayden Robertson | 2004690 | `occ-prop-burnett-hinckley-7th-st-se-jayden-robertson-1-1` (no bed) | `occ-recon-20260623-robertson` → bed `…hinckley-1-2` |
| Isidro Guerrero | 2005207 | `occ-prop-burnett-hinckley-7th-st-se-isidro-guerrero-10-1` (no bed) | `occ-recon-20260623-guerrero` → bed `…hinckley-10-2` |

Benson (2004757) and Laslie (no emp) did NOT collide — single record each, fine.

**Live symptoms:** dashboard "Charged, not placed: Jayden Robertson" (deduction matches the
bed-less pre-existing record by employeeId); occupancy count inflated by 2.
**Fix when ready:** delete the 2 pre-existing unplaced duplicates (deductions match by
employeeId, not occupant FK, so the seated record then carries the match). User chose to
LEAVE IT for now — do not delete without a fresh go-ahead.



## 🏁 FINAL ACCOUNTING (2026-06-23) — harvest lease-apply COMPLETE
Every lease fillable from available data is filled. The 10 remaining zero-economic-data leases on active properties are all un-fillable: **held by decision** (Bartlett El Paso, Red Roof Morehead), **stale** (Beau Chateau Dexter ×5, Orgill=Sikeston), or **no rate in any source** (Copa Parque, Holts Summit, Town Point — no lease folder, no master rate, no email rate). TB Rentals property address also corrected (Sikeston → 720 E Front St, Morehouse MO 63868). Confirmed already-seeded from the master (not empty, just `monthlyRent=0` + flagged needsReview): Express Inn ($60.50/nt), Chalie Wesley ($150.50/wk).


_Worked 2026-06-23. Live app is in PUBLIC_MODE so additive PATCH/POST writes go straight to the Replit DB via the API (no Clerk session). Never use bulk `/api/import` — it wipes data._

## ✅ APPLIED (live, verified)
| Lease | Filled | Source | Conf |
|---|---|---|---|
| `lease-sunset-place-u134` (Sunset Place, Neillsville WI) | rent $1,299, 2026-06-12 → 2027-03-31 | signed PDF "Unit 134 ADA" | high |
| `l-1779300521139-kpqu` (The Ridge motel, Portage WI) | rent $27,840/mo flat | merged Ridge record | high |
| `lease-tb-rentals-sikeston-utbd` (TB Rentals, Morehouse MO) | rent $7,800/mo, 2026-06-15 → 2026-12-14 | **OCR** of executed MO REALTORS commercial lease | high |
| `lease-comfort-suites-madison-utbd` (Comfort Suites Madison) | $75/night + tax, 2026-03-23 → 2027-12-31 | **OCR** of 2026 Rate Agreement (Radhe Hotels) | high |

Live leases missing rent OR start: **36 → 32** (2 lease-fixes + 2 OCR).

## 🔬 OCR session (browser route — SharePoint web viewer + vision)
**Method that works:** M365 connector can't OCR scanned PDFs (text-extraction only, no `downloadUrl`). But the files render in SharePoint's web viewer → drive Chrome to the file URL, screenshot pages, OCR with vision Read. Requires being logged into penda0.sharepoint.com in Chrome.
- ✅ **TB Rentals Sikeston** → filled (real signed lease; premises actually **720 E Front St, Morehouse MO 63868**, not Sikeston — property address may need correcting).
- ✅ **Comfort Suites Madison** → filled ($75/nt room-night).
- ⚠️ **Red Roof Morehead → HELD.** Its only folder file is `Reservation Summary - Red Roof Morehead.pdf`, but the supplier inside is **Days Inn by Wyndham Morehead** (170 Toms Drive) — a **2024 historical reservation log** (~$65/room-night for double-queen), NOT a Red Roof rate agreement. Supplier mismatch → needs your call: did ISC Morehead move Days Inn (2024) → Red Roof (current)? Don't fill Red Roof from Days Inn data.
- ⏭️ **College Towne Lansing** → already **Inactive** (closed; 2024 leases Expired). Skipped.
- ❌ **No lease folder exists** (nothing to OCR): Town Point Bardstown, Express Inn Hartselle, Holts Summit, Copa Parque Forest Park, Chalie Wesley Broken Bow, Burnett-Menomonie Houses.

## 🟢 DECISIONS RESOLVED (2026-06-23)
1. **Independent Stave Howard #743 + property** → **marked inactive.** Leases only support Active/Expired/Upcoming, so set lease status = **Expired**, cleared `needsReview`, added a note. Did NOT fill stale rent. **Whole property `prop-independent-stave-howard-lebanon` set status = Inactive** (covers the 7 defunct sibling units 745-819) with a wind-down note.
2. **Virginia Manor Apartments** (1300 Virginia Ave Apt 506, Elizabeth Twp/McKeesport PA, Lanyard #UT7ZZU; West Penn elec 100168176640, Peoples Gas 200021023086, Comcast) → **HOLD.** Not created. Its 3 utilities stay un-imported.
3. **Past-due / disputed AP invoices** (Prairie Hill 1110-1286, Sunset 1110-1292, disputed Hickory Haven 1110-1241 $4,647) → **HOLD.** No action.

## ⛔ NOT auto-applicable (need source data / human review)
- **33 remaining gap leases** (College Towne 4, Las Palmas 4, Independent Stave 745-819, the motels, Copa Parque, etc.) — harvest has **no confirmed rent/dates**; these are the scanned-PDF / `needsReview` properties. Need **OCR of the scanned lease PDFs** on SharePoint to fill.
- **Bed-occupancy reconcile** — INVESTIGATED TO CONCLUSION 2026-06-23 (joined reconcile vs live beds/rooms/occupants/roster). **Cannot be auto-applied; this is the correct finding, not a failure.** Of 42 app-missing rows:
  - **38 are CONFLICTS or STALE, must NOT be written** (would overwrite the app's current, more-recent occupancy): e.g. Greenock **Apt 45** master says the 3 Garcias but the app already has Lucas Young / Gage / Richard Fuller in those beds; **The Ridge / 2900 New Pinery** (21) is a newer master snapshot with different rooms/people; **Wausau 108** (6) is a 6/12/2026 group different from the app's 3 occupants; **Bloomfield** (6) grid is blank/misaligned (beds not mappable).
  - **Only 4 sit in a unit that has a vacant app bed:** Jayden Robertson (Burnett Hinckley 404-304, roster 2004690 ✓), Francisco Benson (Hickory Haven Apt 6, roster 2004757 ✓), Isidro Guerrero (Burnett Hinckley 406-205, name-only), Dustin Laslie (Hickory Haven Apt 11, name-only).
  - **Even those 4 are blocked:** `POST /occupants` requires a `moveInDate`, and NO source has one — master occupancy grid is names-only, roster/active is just 9 deduction-holders with no dates. Won't fabricate move-in dates for real people in a housing/payroll system.
  - **RESOLVED 2026-06-23 (user: add all 4 + flag conflicts):** Created & seated **4 occupants** additively (POST /occupants then PATCH bed to attach) — Francisco Benson (Hickory Haven Apt 6, roster 2004757), Jayden Robertson (Burnett Hinckley 404-304, roster 2004690), Isidro Guerrero (Burnett Hinckley 406-205, name-only), Dustin Laslie (Hickory Haven Apt 11, name-only). All verified round-trip (beds now Occupied). **Move-in date = 2026-06-23 placeholder** (no real date exists — occupants have no notes field, so the estimate is recorded here: these 4 move-in dates need verifying). Occupants now 130 (was 126).
  - **38 conflict/stale rows NOT written** → documented bed-by-bed in **`imports/bed-occupancy-CONFLICTS.md`** (MASTER name vs APP current occupant per unit) for your per-property review. The app is generally more current; the master is the stale side.

## ✅ Decisions captured (do not re-ask)
Orgill → **Sikeston** current (Beau Chateau Dexter stale — don't fill its 5 empties). Hickory Haven → **Active**. Two Ridge motels → **one property** (Madison docs merged into Portage). Conley GA + El Paso Bartlett → **Hold** (leave Bartlett empty stub). Keep **lease rent** over Bill.com markup. **Exclude SJPI** (KFI's own office, not housing).

## Utilities harvest result
8 of 10 harvested utilities were **already live** (prior import: Park Place Xcel, Prairie Hill Spectrum, Burnett-Siren Polk+Propane, Sunset Xcel, Cady landlord-billed) or stale (Beau Chateau Dexter). The remaining 3 belong to Virginia Manor (item #2 above). **0 net new applied.**
