# Lease Fixes from Source Documents

Fine-tooth review of KFI-Housing leases flagged MISSING RENT (monthlyRent = 0) or MISSING START/END DATES, cross-referenced against the signed leases and master spreadsheets on SharePoint (site **KFISImplementation**, folder *Housing Master File and Leases / Leases*) plus Outlook.

Generated 2026-06-17. Sources: signed lease PDFs per property folder, `Housing Lease MASTER.xlsx`, `HOUSING-TRANSPORTATION MASTER.xlsx`, `Housing Master File 2026.xlsx`, `Copy of Leasing List as of 5202025.xlsx`, motel invoices, and the implementation project plans.

**New rule applied:** a lease with no fixed end date in its document is month-to-month — `monthToMonth: true`, `endDate: null` is correct, not an error.

---

## RESOLVED

### Foote Hills Apartments – Grand Rapids, MI  (`prop-foote-hills-grand-rapids`)
Landlord Foote Hills Group, LLC; tenant KFI Staffing. Fixed-term leases (auto-continue M2M after the stated end). Rent from the "Moving In – General Information" block of each signed PDF.

| Unit | Rent | Start | End | M2M? | Source | Conf |
|------|-----:|-------|-----|:----:|--------|:----:|
| 103  | $2,200 | 2024-12-02 | 2025-11-30 | no | Lease - Unit 103 NEW.pdf | high |
| A02  | $1,625 | 2024-10-08 | 2025-11-30 | no | Lease - Unit A02 Executed.pdf | high |
| A10P | $1,550 | 2025-01-31 | 2026-02-28 | no | Lease - Unit A10P Executed.pdf | high |
| B03P | $1,625 | 2024-10-07 | 2025-10-31 | no | Lease - Unit B03P Executed.pdf | high |
| B05D | $1,525 | 2024-12-16 | 2025-12-31 | no | Lease - Unit B05D Executed.pdf | high |
| D06  | $1,525 | 2024-11-20 | 2025-11-30 | no | Lease - Unit D06 Executed.pdf | high |
| E02  | $1,625 | 2024-10-08 | 2025-10-31 | no | Lease - Unit E02 Executed.pdf | high |

(Unit 505DW already had $1,800 / 2025-01-03 → 2026-01-31 in the app — unchanged. Unit 902 unresolved — see below.)

### Sunset Place Apartments – Neillsville, WI  (`prop-sunset-place-neillsville`)
Landlord Lisenby Properties LLC. Executed lease PDFs are authoritative over the "with-Lanyard-fee" billed figures in the occupancy file.

| Unit | Rent | Start | End | M2M? | Source | Conf |
|------|-----:|-------|-----|:----:|--------|:----:|
| 132     | $1,259 | 2026-06-12 | 2026-11-30 | no | Sunset Place Lease - 132.pdf | high |
| 134 ADA | $1,299 | 2026-06-12 | 2027-03-31 | no | Lease Agreement - Sunset Place Apartments Unit 134 ADA.pdf | high |

### Independent Stave (Howard Dr) – Lebanon, MO  (`prop-independent-stave-howard-lebanon`)

| Unit | Rent | Start | End | M2M? | Source | Conf |
|------|-----:|-------|-----|:----:|--------|:----:|
| 743 | $2,400 | 2022-11-01 | 2023-10-31 | no | HOUSING-TRANSPORTATION MASTER.xlsx (GoForth Investments LLC) | low |

> Caveat: this is the **expired 2022-23 term**. `Copy of Leasing List as of 5202025.xlsx` marks unit 743 "Remove all" — the GoForth/Howard Dr housing was being wound down. Confirm whether renewed before applying; otherwise mark inactive rather than rent-filling. Weekly passthrough cost was $150/wk per associate.

### Burnett – Menomonie Houses  (`prop-burnett-menomonie-houses`)

| Unit | Rent | Start | End | M2M? | Source | Conf |
|------|-----:|-------|-----|:----:|--------|:----:|
| Houses (9 units) | $0 (basis $125/wk/assoc) | null | null | **yes** | Housing Master File 2026.xlsx | med |

> Burnett-Wilson crew housing, billed $125/week per associate (passthrough deduction). No signed fixed-term landlord lease on SharePoint; no property-level monthly landlord rent on file. Correctly month-to-month; leave monthlyRent 0 unless a landlord lease surfaces.

### Palace Motel – De Queen, AR  (`prop-palace-motel-de-queen`)

| Unit | Rent | Start | End | M2M? | Source | Conf |
|------|-----:|-------|-----|:----:|--------|:----:|
| Room (Gerard Derby) | $0 (basis $425/wk incl tax) | 2026-03-20 | 2026-04-03 | **yes** | PALACE MOTEL INVOICE - 260320_857-249 (2).pdf | high |

> Short motel stay (14 nights = $850 total). No monthly rent applies; leave monthlyRent 0. Dates confirmed, already match the app.

---

## UNRESOLVED

These could not be resolved from the source documents. Cause noted for each.

### Image-only / scanned lease PDFs (need OCR or manual viewing)
| Property | Unit(s) | What's known | Blocker |
|----------|---------|--------------|---------|
| Foote Hills – Grand Rapids, MI | 902 | — | Lease PDF is a scanned image, no extractable text (3.3 MB). |
| College Towne – Lansing, MI | 1122, 1212, 1214, 1222 | Execution date ~2024-07-17 (PandaDoc cert); master weekly cost $175/wk | All 4 lease PDFs are 25-page image-only scans; only the signature cert has text. Reservation Summary also image-only. |
| Beau Chateau (Orgill) – Dexter/Sikeston, MO | 10, 11, 12, 16, Grant Apt A3 | Plan shows shared lease start 2026-06-18, one row end 2026-02-15 (low conf); cost cap $175/wk | Only doc is `ORGILL HOUSING SCREENSHOTS ... 6.3.26.docx` (image screenshots, no text). No per-unit signed lease PDFs. Per-unit monthly rent not recorded anywhere readable. |
| TB Rentals LLC (Orgill) – Sikeston, MO | — | 720 E Front St, Morehouse MO; contact Brandon Sparks | `Lease KFI Staffing-TB Rentals.pdf` is a 17 MB scanned image, no extractable text. |

### No source document found
| Property | Unit(s) | Note |
|----------|---------|------|
| Independent Stave (Howard Dr) – Lebanon, MO | 745, 747, 749, 813, 815, 817, 819 | No signed lease PDFs and no spreadsheet rows; only unit 743 (GoForth) is documented. The 743 lease appears to cover 6 beds as one lease. These unit numbers may be defunct / never separately leased. |
| Chalie Wesley Motor Lodge – Broken Bow, OK | Rooms (5) | No lease folder in the Leases directory; only a blank Client Info Sheet under Bell Lumber. No email hits. Carry-over note only: ~$460/wk per room, start 2025-07-06, motel → M2M. |

### Pre-lease / not yet executed (correctly blank — no fix needed yet)
| Property | Status |
|----------|--------|
| The Bartlett – El Paso, TX (`prop-bartlett-el-paso`) | Application stage; folder had only a BGC letter, no executed lease (per app note). |
| Copa Parque – Forest Park, GA (`prop-copa-parque-tindall`) | Application stage; lease not issued. |

### Master-file motels / properties with unreadable agreement docs (manual entry)
These were already flagged `needsReview` in the app and the source PDFs are scanned/unreadable; no new data extracted:
- Comfort Suites – Madison, WI — agreement PDF scanned/unreadable.
- Days Inn – Morehead, KY — master-file motel ($65/room/night), may be superseded by Red Roof Morehead.
- Red Roof Inn – Morehead, KY (ISKY) — reservation summary PDF unreadable.
- Express Inn & Suites – Hartselle, AL — master-file motel ($60.50/night), ~6 rooms.
- Holts Summit, MO — master-file, ~37 rooms, ~$25/person; confirm active.
- Las Palmas – Arlington, TX (Inactive) — 4 units, rents need manual entry.

### Tail leases not retrievable (tooling limit — see flags)
The `/api/leases` payload (167 leases) exceeds the WebFetch content cap, so leases for these properties could not be read via the public API and were not in the truncated `/api/properties` either:
**Triple T Ranches, Valley View – Mason City, Value Place Extended Stay – Cedar Rapids, Waverly Oaks, Western Hills.**
Re-run with a direct DB/JSON export (or a paginated API) to audit these.

---

## FLAGS for re-run
1. **WebFetch truncation.** `/api/leases` (167 leases) and `/api/properties` are both truncated by the WebFetch content cap. The 5 tail properties above were unreadable. Provide a smaller/paginated endpoint or a raw JSON file to fully audit.
2. **Outlook delegated access.** `outlook_email_search` against `bhubele@kfistaffing.com` and the signed-in mailbox returned empty in two subagents — could not corroborate rents/dates from email (Chalie Wesley, Beau Chateau). May be a missing Mail.Read.Shared delegation; confirm the correct mailbox.
3. **OCR needed** for the image-only leases (Foote Hills 902, all College Towne, Beau Chateau screenshots, TB Rentals) to recover rent/term.
4. **Independent Stave 743** rent is the expired 2022-23 term and is marked "Remove all" — decide renew vs. mark inactive before applying.
