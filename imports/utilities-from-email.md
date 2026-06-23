# Utility Accounts Harvested from Email — KFI Worker Housing

**Source:** Outlook mailbox bhubele@kfistaffing.com (Microsoft 365 connector)
**Harvested:** 2026-06-17
**Matched against:** live property/customer lists at https://kfi-housing.replit.app/api/properties and /api/customers
**Scope:** Review report only — nothing was imported or modified in the app.

Searches run (multiple): utility/electric/account number, Xcel Energy, Alliant Energy, WE Energies, Ameren, DTE Energy, Spectrum, Comcast/Xfinity, service address, welcome/new account/deposit, plus property-city threads. KFI's utility setup is largely coordinated by Alex Cosby (Staff Accountant) and routed through the Lanyard housing platform (accounts@lanyardstays.com); most "utility" emails are setup/confirmation threads, not bills, so monthly amounts and deposits are generally not stated.

---

## Sunset Place Apartments — Neillsville, WI  (WB Manufacturing)
`prop-sunset-place-neillsville`

| Type | Provider | Account # | Service address / units | Start | Source email |
|---|---|---|---|---|---|
| Electric | Xcel Energy (800-895-4999) | (not in email) | 216 Sunset Place, Units 148, 221 → transferring to 132 & 106, Neillsville WI 54456 | 2026-05-28 | "RE: Your Move-In Instructions … #D5CYJY in Neillsville, WI", 2026-06-08, ACosby@kfi.group |

Electric is in KFI's name. Xcel confirmation #s: **Unit 132 = 04547646**, **Unit 106 = 04547679**. Units 221→132 (6/12/2026) and 148→106 (7/8/2026) are mid-transfer; stop service on old units after each transfer. Keys not released until utilities are on. Match: **high**.

## Park Place Apartments — Plymouth, MN  (Landscape Structures)
`prop-park-place-plymouth`

| Type | Provider | Account # | Service address / units | Start | Source email |
|---|---|---|---|---|---|
| Electric | Xcel Energy (800-895-4999) | per-unit (not in email) | 14500 / 14600 / 14605 34th Ave N, Plymouth MN 55447 — units incl. 118, 218, 127, 216, 315, 342, 102, 201; disconnect on 605-102 | — | "Re: Park Place - 605-102 - Past Due Electric Bill (Xcel Energy) - Disconnected Power", 2025-09-10, BHubele@kfistaffing.com |

Each occupied apartment carries its own Xcel meter/account in KFI's name, on autopay. Sept 2025 one unit (605-102) was disconnected for a past-due balance (~$1k) and paid by phone. Tenants on electric heat. Match: **high**.

## Siren – 7666 South Shore Drive  (Burnett Dairy)
`prop-burnett-siren-7666-south-shore`

| Type | Provider | Account # | Service address | Start | Source email |
|---|---|---|---|---|---|
| Electric | Polk-Burnett Electric Coop ("Polk") | (not in email) | 7666 South Shore Drive, Siren WI 54872 | — | "Re: Siren House", 2025-11-06, BHubele@kfistaffing.com |
| Heat (Propane/LP) | Burnett Dairy (fill); tank owned by landlord (Kyle/Brent Johnson) | (account set up w/ Burnett Dairy) | 7666 South Shore Drive, Siren WI 54872 | 2025-11 | "Re: Siren House", 2025-11-14, BHubele@kfistaffing.com |

Heat is propane: KFI set up a fill account with Burnett Dairy; landlord owns the tank. Existing 100lb tanks can't be filled by the local truck (min 120lb), so a larger tank may be needed (~$500 placement fee). Match: **high**.

## Prairie Hill Village — Baraboo, WI  (Milwaukee Valve)
`prop-prairie-hill-village`

| Type | Provider | Account # | Service address | Start | Source email |
|---|---|---|---|---|---|
| Internet / WiFi | Spectrum | (not in email) | 1850 W Pine St, Baraboo WI 53913 | 2025-10 | "Re: FW: Milwaukee Valve leases signed - need Sec Dep paid", 2025-10-06, accounts@lanyardstays.com |

Apartments are wired for Spectrum; Lanyard confirmed WiFi is **not** included in rent — KFI sets up service and pays Spectrum directly. Match: **high**.

## 1402 8th Street — Menomonie, WI  (Cady Cheese)
`prop-cady-1402-8th-menomonie`

| Type | Provider | Account # | Service address | Start | Source email |
|---|---|---|---|---|---|
| All utilities (landlord-provided) | MA Properties / American Edge Real Estate Services (landlord-billed) | n/a | 1402 8th Street, Menomonie WI 54751 | 2026-05 | "CADY CHEESE HOUSING LEASE - Fw: Lease Agreement", 2026-05-15, DWhitmore@kfistaffing.com |

Executed lease indicates utilities are included/billed by the landlord — no separate KFI utility account. Informational. Match: **medium**.

---

## Unmatched / needs review

### 1300 Virginia Ave, Apt 506 — McKeesport / Elizabeth, PA 15135 ("Virginia Manor Apartments")  (Shuster's Building Components)
Tentatively matched to `prop-shusters-900-seneca-mckeesport` — **but the address is different** (Greenock Manor is 900 Seneca Ct; this is 1300 Virginia Ave). Housing Request **#UT7ZZU**, set up via Lanyard in June 2026. Likely a NEW unit/property under Shuster's — confirm whether to attach here or create a new property. The source emails label the city inconsistently as both "Elizabeth, PA 15135" and "McKeesport, PA 15135," and the street as both "Virginia Ave" and "Virginia Street," all for Apt/Unit 506.

| Type | Provider | Account # | Confirmation # | Start | Source |
|---|---|---|---|---|---|
| Electric | West Penn Power (FirstEnergy) — 1-800-686-0021 | **100168176640** | **830979004** | 2026-06-15 | "Set up your utilities… #UT7ZZU", 2026-06-15, ACosby@kfi.group |
| Natural Gas | Peoples Gas — 1-800-764-0111 | **200021023086** | — | 2026-06-16 | same thread, 2026-06-16, ACosby@kfi.group |
| Internet / Cable | Comcast / Xfinity (contact Corey Schildkamp, 412-639-413 — phone truncated in source) | (none in email) | — | not confirmed set up | same thread, 2026-06-15 |

Electric & gas confirmed started; internet not confirmed. Match confidence: **low** (address mapping).

### Ameren Missouri electric — Orgill MO housing (property unconfirmed)
An "Your Ameren Online Registration Is Complete" email arrived 2026-06-12 to **finance@kfistaffing.com**. Ameren Missouri serves the Orgill MO housing (Beau Chateau / Dexter `prop-beau-chateau-dexter`, and/or TB Rentals / Sikeston `prop-tb-rentals-sikeston`) per existing property notes. The registration email contained **no account number or service address**, so the specific property could not be confirmed. Tentatively tagged to `prop-beau-chateau-dexter` / customer Orgill. Match confidence: **low**.

---

## Properties with NO utility info found in email
No utility accounts surfaced for the remaining properties, most often because the landlord bills utilities, the property is a motel (utilities in nightly rate), or it is pre-lease/inactive:

- The Ridge Motor Inn – Portage WI (Trienda)
- The Bartlett – El Paso TX (International Wire) — pre-lease (note: a *new* 6/17/2026 "Reserve at Sandstone Ranch, El Paso TX" utility-setup request just appeared but has no account details yet)
- Burnett Hinckley 7th St SE, Burnett Menomonie Houses, Webster 7112 Zielsdorf (Burnett Dairy / Burnett-Wilson)
- Chalie Wesley Motor Lodge – Broken Bow OK & Palace Motel – De Queen AR (Bell Lumber) — motels
- College Towne – Lansing MI (Adient), Comfort Suites – Madison WI (KFI), Copa Parque – Forest Park GA (Tindall, pre-lease)
- Days Inn / Red Roof – Morehead KY (Independent Stave) — motels
- DeLallo AutoZone & Yellow House – Jeannette PA (tenant pays all utilities per lease)
- Express Inn – Hartselle AL, Holts Summit MO, Town Point – Bardstown KY, Las Palmas – Arlington TX (master-file / unassigned)
- Foote Hills – Grand Rapids MI (Roskam) — property notes cite DTE Energy on townhomes, but no DTE email found
- Hickory Haven – Gilman WI (WB Mfg), Independent Stave Howard Dr – Lebanon MO, Stonleigh Court – Leavenworth KS (Heatron)
- Greenock Manor 900 Seneca Ct – McKeesport PA (Shuster's) — see the 1300 Virginia Ave entry above (likely related/new)
- Schuette 1331 & 1341 S 8th Ave – Wausau WI, E. Bloomfield St – Rome NY (Int'l Wire; Red Brick units include heat & water per lease)

---

## Summary
- **Utilities found:** 10 records across **6 properties** (+ 1 unconfirmed Ameren/Orgill).
- **Matched (high/medium):** 6 records → 4 properties (Sunset Place, Park Place, Siren ×2, Prairie Hill Village, Cady Cheese).
- **Low-confidence / needs review:** 4 records → 1300 Virginia Ave (electric, gas, internet) under Shuster's, + Ameren/Orgill electric.
- **Providers seen:** Xcel Energy (electric, MN & WI), Polk-Burnett + Burnett Dairy propane (Siren), Spectrum (Baraboo internet), West Penn Power (PA electric), Peoples Gas (PA gas), Comcast/Xfinity (PA internet), Ameren Missouri (Orgill MO electric).
- **Connectivity:** Microsoft 365 connector and the live KFI-Housing API were both reachable; all data above came from live sources.
