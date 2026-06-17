# KFI Housing — Import Review (generated 2026-06-14)

Consolidated from **3 sources**, de-duplicated and reconciled:
1. **June 2026 Outlook email** sweep (leases, rent invoices, hotel bills, utilities)
2. **SharePoint master spreadsheets** — `Housing Lease MASTER.xlsx`, `Housing Master File 2026.xlsx` (occupancy), `HOUSING-TRANSPORTATION MASTER.xlsx`
3. **24 per-property lease folders** — the actual signed lease PDFs

**Files in this folder**
| File | What |
|---|---|
| `housing-import-consolidated.json` | The merged, app-schema property/lease data → for import |
| `HOUSING-IMPORT-REVIEW.md` | This readable summary |
| `email-harvest-2026-06.json` | Raw email-sweep output |
| `sharepoint-harvest.json` | Raw SharePoint master + folder records |

## Totals
- **36 properties** (incl. **9 hotels/motels**), **113 units/rooms**
- **62 units have confirmed rent** from signed leases; **59 flagged `needsReview`** (scanned PDF, missing field, or conflicting sources)
- **10 Lanyard Bill.com invoices** to reconcile, **1 non-housing** item excluded (SJPI office lease), **2 pending** (Conley GA, El Paso Bartlett)

## Properties with confirmed lease terms (ready to import)
| Property | Client | City, ST | Type | Units (w/ rent) | Rent range | $/wk |
|---|---|---|---|---|---|---|
| Park Place Apartments | LSI | Plymouth, MN | Apt | 9 | $1,726–2,235 | 125 | *(already seeded)* |
| Prairie Hill Village (1850 W Pine) | Milwaukee Valve | Baraboo, WI | Apt | 5 | $1,675 | 130 |
| Chateau Knoll | Greystone | Bettendorf, IA | Apt | 6 | $1,500–1,735 | 98 |
| Greenock Manor | Shuster's/DeLallo | McKeesport, PA | Apt | 4 | $895–950 | — |
| Bloomfield Gardens | Int'l Wire | Rome, NY | Apt | 3 of 7 | $897–997 | 80 |
| Sunset Place | WB Mfg | Neillsville, WI | Apt | 5 of 7 | $939–1,309 | 115 |
| Hickory Haven ⚠️vacating | WB Mfg | Gilman, WI | Apt | 4 | $900–1,075 | 103 |
| Foote Hills | Roskam | Grand Rapids, MI | Townhouse | 1 of 9 | $1,800 | — |
| Stonleigh Court | Heatron | Leavenworth, KS | Apt | 8 | $1,099–1,249 | — |
| 308 Fairgrounds (Dunn) | Adient | Versailles, MO | Apt | 7 | $1,000 | — |
| Kolbe Apartments | Schutte Metals | Wausau, WI | Apt | 2 of 3 | $1,410–1,849 | — |
| 1402 8th Street | Cady Cheese | Menomonie, WI | Apt | 1 | $1,200 | — |
| Yellow House | DeLallo | Jeannette, PA | Apt | 1 (house) | $2,400 | 69 |
| Eureka – Webster | Burnett Dairy | Webster, WI | Apt | 1 (home) | $4,000 | — |
| The Ridge / Ridge Motor Inn | Penda/Trienda | Portage, WI | **Motel** | flat | **$27,840/mo all rooms (Jul 1)** | 175 |
| Palace Motel | Bell Lumber | De Queen, AR | **Motel** | 1 room | $53.91/nt | — |
| Econo Lodge | Adient | Jefferson City, MO | **Motel** | 6 rooms | $65/nt | 175 |

## Properties needing manual follow-up (scanned PDFs / missing data)
Willow Winds (Hinckley MN), College Towne (Lansing MI), Eureka–Siren, TB Rentals (Sikeston), Beau Chateau/Dexter, Red Roof Morehead, Comfort Suites Madison, The Ridge Motor Inn–Madison, Auto Zone House, Independent Stave–Howard Dr, Bell Lumber/Chalie Wesley, Days Inn, Express Inn & Suites, Las Palmas, Town Point, Holts Summit, MSK Investments, Burnett–Menomonie houses.

## ⚠️ Things for YOU to decide / confirm
1. **Bill.com vs lease rent** — invoice amounts (e.g. Prairie Hill $1,970.59) are higher than lease base rent ($1,675) because they bundle fees + Lanyard markup. I kept the **lease** figure and noted the invoice. Don't want them double-counted.
2. **2 past-due invoices**: 1110-1286 (Prairie Hill) & 1110-1292 (Sunset Place). Plus **disputed** Hickory Haven 1110-1241 ($4,647) — pay or not?
3. **Hickory Haven** — tenants vacated ~6/6 (safety). Mark property Inactive?
4. **Orgill = Dexter or Sikeston?** Email says Dexter MO (501 W Fannetta); SharePoint folders say Sikeston (Beau Chateau + TB Rentals). Which is current?
5. **Two "Ridge" motels** — Portage (active, occupancy roster) vs a Madison folder (scanned). Same property or two?
6. **Split-out addresses** — Greenock Apt 45 (918 Zimmer Hill Rd) and Beau Chateau Grant A3 (15974 Co Rd 612) sit under another property but have their own street address.
7. **SJPI** — excluded as KFI's own office lease, not worker housing. Agree?
8. **Pending**: Conley GA (#3QRIW1) and El Paso Bartlett (#9V4DOO) have no executed lease yet — import as "Upcoming" or hold?

## Next step
Nothing has been written to the app yet. On your OK, I'll import these **additively** (one-by-one POST — never the bulk `/api/import`, which wipes data), starting with the 17 confirmed-rent properties, leaving Park Place as-is.
