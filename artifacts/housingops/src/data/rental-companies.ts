// Auto-generated from imports/rental-companies.json (June 2026 email harvest).
// Landlord / management / vendor contact cards. Refresh by re-running the harvest.
export interface RentalContact { name: string; role: string; email: string; phone: string; }
export interface RentalCompany {
  company: string; legalName: string; contacts: RentalContact[];
  mailingAddress: string; portalUrl: string; paymentInfo: string;
  propertiesServed: string[]; notes: string;
}
export const RENTAL_COMPANIES: RentalCompany[] = [
  {
    "company": "Lanyard",
    "legalName": "Lanyard (operating as \"Lanyard\"/Lanyard Stays; lanyardstays.com). No formal legal/incorporated entity name (LLC/Inc.) appears in the emails. Invoices are issued through Bill.com (BILL Operations, LLC, NMLS ID 1007645).",
    "contacts": [
      {
        "name": "Gabriela Paul",
        "role": "Lanyard contact (cc'd on lease correspondence)",
        "email": "gabriela@lanyardstays.com",
        "phone": ""
      },
      {
        "name": "Lanyard Accounts Team",
        "role": "Accounts / leasing inquiries; sender of lease-ready notices",
        "email": "accounts@lanyardstays.com",
        "phone": ""
      },
      {
        "name": "Lanyard Billing",
        "role": "Billing (listed on invoices)",
        "email": "billing@lanyardstays.com",
        "phone": ""
      },
      {
        "name": "Lanyard Accounts Receivable",
        "role": "AR / invoicing alias referenced in vendor context",
        "email": "accounts@lanyardstays.com",
        "phone": ""
      }
    ],
    "mailingAddress": "New York, NY 10016 (street line not shown in invoice email body; full street address would be on the attached invoice PDF). Billing contact email on invoice: billing@lanyardstays.com.",
    "portalUrl": "Payment: https://app02.us.bill.com (Bill.com \"Pay Invoice Electronically\" portal). Lease-signing portal: per-property login provided by Lanyard (no public base URL captured in email); for the Virginia Manor property the login email was virginiamanor1@lanyardstays.com with a password sent separately. Lanyard noted the portal login \"appears to be another Mike's Property\" style per-property credential.",
    "paymentInfo": "Paid via Bill.com. \"Pay Invoice Electronically\" link points to https://app02.us.bill.com. Invoice terms stated as \"Due upon receipt\" (some invoices show a later due date, e.g. net ~13 days to Jun 25). Late-fee policy: $150.00 late fee if not paid by the stated grace deadline (e.g. invoice due Jun 12 had a $150 late fee applying after end of day Jun 18 PT). Invoices are billed to \"KFI Staffing\" with AP email ap@... (KFI accounts payable). No ACH/check bank routing details were present in the email bodies; those would be on the attached invoice PDFs or in the Bill.com portal. Bill.com customer support: 866-989-BILL (2455).",
    "propertiesServed": [
      "Virginia Manor Apartments, McKeesport, PA - Unit 506 (Housing Request #UT7ZZU); current associate was in a hotel pending move-in"
    ],
    "notes": "Lanyard is a housing vendor/broker managing KFI properties; invoices arrive via Bill.com (invoice@hq.bill.com, account-services@inform.bill.com) and from accounts@lanyardstays.com. Recent invoices (#1110-1283 through 1110-1298) ranged roughly $2,733-$14,516, all billed to KFI Staffing (AP). KFI-side contacts handling Lanyard leases/payments: Dawn Whitmore (Director of Implementation and Delivery, DWhitmore@kfi.group), Brad Hubele (Controller, BHubele@kfi.group, 608-408-0912), Alex Cosby (ACosby@kfi.group), Linoshka Santana (LSantana@kfi.group). No phone number for Lanyard itself was found in any signature or body. For lease access, Lanyard issues per-property portal logins (email + separately-sent password) rather than a single tenant portal. Additional street address, bank/ACH and per-invoice line items are likely in the attached invoice PDFs, which were not opened."
  },
  {
    "company": "Centerspace",
    "legalName": "Centerspace (NYSE: CSR). Property branded \"Centerspace Homes\" / centerspacehomes.com. The Plymouth community is Park Place Apartments. Parent REIT is Centerspace (formerly Investors Real Estate Trust, IRET).",
    "contacts": [
      {
        "name": "John Erskine",
        "role": "Community Director, Park Place (Centerspace)",
        "email": "jerskine@centerspacehomes.com",
        "phone": "763.559.1332 (Park Place leasing office)"
      }
    ],
    "mailingAddress": "Park Place Apartments, 14550 34th Ave N, Plymouth, MN 55447 (Centerspace community / leasing office). KFI tenant buildings within Park Place: 14500, 14600, and 14605 34th Ave N, Plymouth, MN 55447.",
    "portalUrl": "centerspacehomes.com (no dedicated tenant payment-portal URL stated in the emails)",
    "paymentInfo": "No Centerspace rent ACH/check/portal/bank or late-fee terms are stated in the emails reviewed. Lease execution and lease-inquiry administration is handled through a third-party platform, Lanyard (accounts@lanyardstays.com; Lanyard, 27 East 28th Street, 8th Floor, New York, NY 10016) — leases are delivered/downloaded via emails.lanyardstays.com and inquiries go to accounts@lanyardstays.com. Rent is paid monthly per unit; example renewal rents starting Dec 2025 ran roughly $2,031-$2,095/unit (up ~$50/unit at renewal). Note: utilities (Xcel Energy electric) are tenant/occupant responsibility per unit and were NOT included in rent — Xcel: (800) 895-4999. The unrelated 'CSR-14150-0000127' payment/ACH thread is a vehicle-collision insurance claim handled by GPRS/Great Prairie Risk (Chris Pawl, c.pawl@gprs-inc.com), not Centerspace rent.",
    "propertiesServed": [
      "Park Place Apartments, Plymouth MN — KFI-leased units: 14500 34th Ave N (Apt 118, 218)",
      "14600 34th Ave N (Apt 127, 216, 315, 342)",
      "14605 34th Ave N (Apt 102, 201, 218)"
    ],
    "notes": "Centerspace is the landlord/property owner for Park Place Apartments in Plymouth, MN; primary contact in the emails is Community Director John Erskine (jerskine@centerspacehomes.com). Lease signing/renewal logistics for the KFI corporate-housing units run through the Lanyard platform (accounts@lanyardstays.com), which sends fully-executed lease packets. On the KFI side, Valerie Alderman (Office Manager, valderman@kfistaffing.com, 608-733-1051) manages these housing leases and tracks returned units; Evelyn Ruiz and Ruby Lunar (rlunar@kfistaffing.com) and Alex Cosby are also involved operationally. As of Nov 2025, KFI was returning/ending units 500-218 (pay through Nov 2025), 600-216 (through Nov 2025), and 605-102 (through Dec 2025), and renewing the rest for a year. Caution: 'Park Place Apartments in Delano, MN' appears in a Lanyard email header, but the property addresses are all Plymouth, MN 55447 — likely a Lanyard template error. The 26/27 Renewal Information emails (Kimberly.Zander@m3ins.com, M3 Insurance) are KFI workers-comp insurance, not Centerspace-related."
  },
  {
    "company": "Mick's Properties",
    "legalName": "Mick's Properties (a/k/a \"Mick's Property\"; underlying landlord/owner). Leasing, billing, and accounts are handled through Lanyard Stays (Lanyard) as the property manager/billing intermediary.",
    "contacts": [
      {
        "name": "Lanyard Accounts Team",
        "role": "Leasing / accounts (lease e-sign and lease delivery for the Mick's/Lanyard portfolio)",
        "email": "accounts@lanyardstays.com",
        "phone": ""
      },
      {
        "name": "Gabriela Paul",
        "role": "Lanyard (cc'd on lease/accounts correspondence)",
        "email": "gabriela@lanyardstays.com",
        "phone": ""
      },
      {
        "name": "Lanyard Billing Team / Joan Chen",
        "role": "Billing Specialist (invoice follow-ups, payment scheduling via Bill.com)",
        "email": "billing@lanyardstays.com",
        "phone": ""
      },
      {
        "name": "Lanyard (via Bill.com)",
        "role": "Invoice delivery / payment portal",
        "email": "account-services@inform.bill.com",
        "phone": "866-989-2455 (Bill.com customer support)"
      }
    ],
    "mailingAddress": "No direct mailing address for Mick's Properties appears in the emails. Payments are routed electronically through Lanyard via Bill.com (Bill.com payment processor address on invoices: BILL Operations, LLC, 6220 America Center Drive, San Jose, CA 95002). Greenock Manor units are in/around McKeesport, PA (Greenock Manor, Irwin/Elizabeth Township area per Samsara location data).",
    "portalUrl": "Bill.com payment portal: app02.us.bill.com (invoices delivered via account-services@inform.bill.com with a \"View & Pay Invoice\" link). Lanyard tenant/lease portal referenced at lanyardstays.com (lease e-sign links sent by accounts@lanyardstays.com).",
    "paymentInfo": "Payment is made electronically via Bill.com (no ACH bank routing/account numbers were disclosed in the emails — payment is scheduled inside the Bill.com portal). Invoices are issued by Lanyard. Example: Invoice 1110-1285 for $8,462.50, due Jun 25, 2026. Late-fee policy: a $150.00 late fee applies if not paid by end of day on the stated grace date (e.g., pay by Jul 1, 2026 PT to avoid the $150 late fee). Lanyard's billing team proactively follows up to ensure payment is scheduled in Bill.com \"to avoid any late fees from the property.\" Rent for Greenock Manor units billed monthly (e.g., $1,187.50/unit for 2025-26; was $1,118.75/unit in Sept 2025). Invoices sent to ap@kfistaffing.com.",
    "propertiesServed": [
      "Greenock Manor, McKeesport PA (Units 36, 48, 49 and others) — tenant: Stacey Oden per task context",
      "Virginia Manor Apartments, McKeesport PA (Unit 506) — noted as 'another Mike's/Mick's Property' in the same portfolio",
      "Mick's Property - Apollo, PA (per lease attachment 'Mick's Property - Apollo, PA - Lease.pdf')"
    ],
    "notes": "Mick's Properties is the named landlord, but all operational contact (leasing, invoices, payment, late fees) flows through Lanyard Stays (lanyardstays.com) and its Bill.com billing. No email signature gave a direct Mick's Properties phone, mailing address, bank/ACH details, or a named individual at Mick's — those would be in the lease PDFs (e.g., \"Mick's Property - Apollo, PA - Lease.pdf\", attached to the Jun 13, 2026 lease email) which were not parsed. KFI-side contacts handling this account: Dawn Whitmore (Director of Implementation and Delivery, DWhitmore@kfi.group), Brad Hubele (Controller, BHubele@kfi.group, 608-408-0912), Valerie Alderman (valderman@kfistaffing.com), and AP inbox ap@kfistaffing.com. Note ambiguity: emails also spell it \"Mike's Property\" — likely the same landlord. For exact bank/ACH terms and the legal entity name, open the lease PDF attachments."
  },
  {
    "company": "Lisenby Properties",
    "legalName": "Lisenby Properties LLC (entity named in the lease contract summary). The property/leasing is operated by Lanyard (Lanyard Stays) as property manager.",
    "contacts": [
      {
        "name": "Gabriela Paul",
        "role": "Lanyard (property manager) - Accounts / contact",
        "email": "gabriela@lanyardstays.com",
        "phone": ""
      },
      {
        "name": "Lynn",
        "role": "Lanyard - sender of next-steps/leasing emails (full name not given; likely same Accounts team)",
        "email": "accounts@lanyardstays.com",
        "phone": ""
      },
      {
        "name": "Lanyard Accounts Team",
        "role": "Landlord/manager accounts & billing (invoices, move-in costs, questions)",
        "email": "accounts@lanyardstays.com",
        "phone": ""
      },
      {
        "name": "Lisenby Properties LLC",
        "role": "Property owner entity (named in lease contract summary)",
        "email": "",
        "phone": "(715) 635-1749"
      }
    ],
    "mailingAddress": "Lisenby Properties LLC, PO Box 279, Spooner, WI 54801. Lanyard (manager) corporate address: 27 East 28th Street, 8th Floor, New York, NY 10016. Property location: Sunset Place Apartments, 216 Sunset Place, Neillsville, WI 54456.",
    "portalUrl": "AppFolio tenant/leasing portal (leases reviewed and e-signed in AppFolio; per-unit Sign Now links delivered via emails.lanyardstays.com). No single static portal URL given. Accounts contact: accounts@lanyardstays.com",
    "paymentInfo": "Payment is by invoice (e.g., Invoice #1110-1256 covered move-in costs/initial deposit). Keys/fobs are released only after the move-in invoice is paid and utilities are confirmed set up. Invoices and move-in cost details come from Lanyard's Accounts team (accounts@lanyardstays.com). No ACH/check/bank routing details, payment terms, or late-fee policy were stated in the emails reviewed.",
    "propertiesServed": [
      "Sunset Place Apartments, 216 Sunset Place, Neillsville, WI 54456 (KFI Thorp, WI location housing) - Housing Requests #D5CYJY and #A84VN0; units 221, 148, 215, 117, 134 ADA, with transfers into units 132 and 106"
    ],
    "notes": "Key distinction: emails are addressed from/about \"Lanyard\" (Lanyard Stays), which manages Sunset Place Apartments. \"Lisenby Properties LLC\" is the owner entity named in the Lease Contract Summary footer with PO Box 279, Spooner, WI 54801 and phone (715) 635-1749. The active correspondence and all leasing/billing contacts are Lanyard's: accounts@lanyardstays.com, Gabriela Paul (gabriela@lanyardstays.com), and a sender named \"Lynn.\" Per-unit leasing logins use sunset3/sunset4/sunset5@lanyardstays.com email addresses tied to specific units. Leases are e-signed via AppFolio. Other people in these threads (Dawn Whitmore - Director of Implementation and Delivery, Alex Cosby - Staff Accountant 608-397-9867, Brad Hubele, Linoshka Santana, Kristen Nelson) are all KFI employees, NOT the rental company. Electric utility for the property is Xcel Energy (800-895-4999), set up by KFI. Key fobs are picked up at Just Love Coffee Cafe (open 6:00 AM-6:00 PM Mon-Fri). No bank/ACH details or late-fee policy appeared in the emails reviewed; the only payment artifact is invoice-based move-in payments required before key release."
  },
  {
    "company": "Foote Hills",
    "legalName": "Foote Hills Group LLC (referred to in emails as \"Foote Hills\" / \"Foot Hills\" apartments, Grand Rapids MI; Roskam-affiliated)",
    "contacts": [
      {
        "name": "Lauren O'Connor",
        "role": "Sales Manager, Lanyard (lanyardstays.com) — Foote Hills billing intermediary",
        "email": "lauren@lanyardstays.com",
        "phone": ""
      },
      {
        "name": "Joan",
        "role": "Lanyard Billing Team (signs billing/refund-offer emails)",
        "email": "billing@lanyardstays.com",
        "phone": ""
      },
      {
        "name": "Nina Kleaveland",
        "role": "Lanyard (lanyardstays.com) contact coordinating with Foote Hills property director and collections agency",
        "email": "ninakleaveland@lanyardstays.com",
        "phone": ""
      },
      {
        "name": "Valerie Alderman",
        "role": "Office Manager, KFI Staffing (internal point of contact for Foote Hills housing)",
        "email": "valderman@kfistaffing.com",
        "phone": "608-733-1051 (mobile)"
      },
      {
        "name": "Evelyn Ruiz",
        "role": "KFI Staffing (cc'd on Foote Hills collections thread)",
        "email": "ERuiz@kfistaffing.com",
        "phone": ""
      },
      {
        "name": "David Stockwell",
        "role": "KFI Staffing (cc'd on Foote Hills collections thread)",
        "email": "DStockwell@kfistaffing.com",
        "phone": ""
      },
      {
        "name": "Brad Hubele",
        "role": "Controller, KFI Staffing (internal, handling collections/refund)",
        "email": "BHubele@kfistaffing.com",
        "phone": ""
      }
    ],
    "mailingAddress": "Not stated in emails (property located in Grand Rapids, MI)",
    "portalUrl": "Not stated. Billing/move-out statements are handled through Lanyard (corporate-housing intermediary); Lanyard sales contact offers a HubSpot scheduling link (meetings.hubspot.com) — not a tenant payment portal.",
    "paymentInfo": "No direct KFI-to-Foote Hills payment terms (ACH/check/bank/late-fee) are stated in the emails. Foote Hills' final billing / move-out statements are administered by Lanyard (lanyardstays.com) and a third-party collections agency that Foote Hills uses (they recently switched agencies). One past matter: a lease-break / move-out settlement was negotiated down via Lanyard. Detailed figures from the Oct 2025 offer: Lease Break Fee (incl. Lanyard fee) $34,884.90; deductions/credits for April invoice (-$17,932.83 paid), March utilities (-$450.87 paid), damages (-$1,253.16 paid), remarketing fee (-$16,378.16 paid), remarketing fee discount ($3,804.72), additional discount ($4,913.45); net Total Refund to KFI = $7,588.05, offer to accept by Oct 18, 2025 (KFI accepted). Caution flag: a collections agency in New York (called from 866-472-9771) contacted KFI about a $1,812 balance from Foote Hills; KFI's office manager warned it could be a scam and advised verifying directly with Foote Hills.",
    "propertiesServed": [
      "Foote Hills apartments, Grand Rapids, MI (KFI corporate/associate housing)"
    ],
    "notes": "Foote Hills is a Grand Rapids, MI apartment property (Roskam-affiliated) used for KFI associate/corporate housing. KFI does NOT appear to interact with Foote Hills directly for billing — all billing, move-out statements, and lease-break/refund negotiations flow through Lanyard (lanyardstays.com), a corporate-housing/booking intermediary, and through a third-party collections agency that Foote Hills uses for final billing (Foote Hills recently switched agencies). No Foote Hills employee/property-director name, email, phone, mailing address, or tenant payment portal was found in the emails — those interactions go via Lanyard. Source: thread \"Fw: Foot Hills Grand Rapids Collections\" (Sep–Nov 2025). Watch item: possible scam collections call from NY number 866-472-9771 re a $1,812 balance."
  },
  {
    "company": "Eureka Land Investments",
    "legalName": "Eureka Land Investments (Landlord on the Wisconsin Lease Agreement; signed \"Melissa Anderson for Eureka Land Investments\")",
    "contacts": [
      {
        "name": "Melissa Anderson",
        "role": "Landlord / primary billing & rent contact for Eureka Land Investments (signed the lease as Landlord; sends back-rent/lease correspondence)",
        "email": "anderson.melissa.b@gmail.com",
        "phone": "715-557-1794"
      },
      {
        "name": "Kyle Anderson",
        "role": "Maintenance / repair & property-issue contact for Eureka Land Investments",
        "email": "kyle.oscar.anderson@gmail.com",
        "phone": "715-557-1795"
      }
    ],
    "mailingAddress": "22743 Akermark Road, Grantsburg, Wisconsin 54840 (Landlord address per lease; rent payable to Landlord at this address)",
    "portalUrl": "",
    "paymentInfo": "Electronic payment only: direct deposit/ACH into Eureka Land Investments checking account (specific bank/routing/account numbers not stated in the emails or lease). Rent $4,000.00/month, due the 1st of each month. First month (8/29/25-8/31/25) pro-rated at $400.00. Security/damage deposit $4,000.00 (held in trust; returned within 21 days of vacating minus deductions). Late fee: flat $100.00 if rent not received within 7 days of due date. NSF/returned check fee: $50.00; after a returned check the Landlord may require cash/cashier's check/money order, and 3 returned checks in 12 months is just cause for eviction. Early termination: 60 days' written notice plus termination charge of $8,000.00 (or max allowable by law, whichever is less). Tenant pays all utilities directly to utility companies (separate gas and electric meters). Outstanding back-rent claim per Melissa Anderson (4/6/2026 email): Damage Deposit $4,000 + pro-rated Aug rent $400 + Sep 2025-Apr 2026 (8 mo x $4,000) $32,000 = $36,400 total owed. KFI housing-recovery (internal) deduction rate for this property: $86.00/week (\"Housing-132-Burnett G-Eureka Land Investments (Siren)\").",
    "propertiesServed": [
      "7112 Zielsdorf Drive, Webster, WI 54893 (multi-family / duplex home) — Burnett Dairy housing, customer code Housing-132-Burnett G"
    ],
    "notes": "Source: Outlook email \"Fw: Zielsdorf Drive Duplex Lease Agreement\" (Brad Hubele, 4/16/2026) forwarding Melissa Anderson's 4/6/2026 message to Brad (cc Kyle Anderson), plus the attached \"Zielsdorf Dr Lease Agreement 09Sep2025.pdf\". Lease executed 8/29/2025 (signed 9/11/2025); fixed term ends 8/31/2026, then auto-renews to month-to-month unless 45 days' written notice. Tenant of record on lease is KFI Staffing (tenant signatory Valerie/Valarie Alderman; KFI notice contact bjohnson@kfistaffing.com, 608-445-1848). This is the Burnett Dairy / Siren-Webster WI housing referenced in the task. No tenant/payment portal URL exists — payment is direct deposit to the landlord's checking account. Exact bank name, routing, and account numbers are NOT disclosed in the available emails/lease. Other emails matching the search were internal KFI cash-forecast and housing-cost-rate threads (no additional Eureka contact data)."
  },
  {
    "company": "Lokre",
    "legalName": "Lokre Companies (a/k/a \"The Lokre Companies\"); appears as landlord/property manager. Related entity referenced in context: Kolbe Apartments LLC.",
    "contacts": [
      {
        "name": "Lokre Companies (main office)",
        "role": "Property management / landlord",
        "email": "donotreply@onlineportal.appfolio.com (automated AppFolio portal; not monitored — use phone/website to reach a person)",
        "phone": "(715) 342-9200"
      }
    ],
    "mailingAddress": "Not stated in the emails. (Lokre Companies is based in Stevens Point, WI per the 715-342 area code; verify via lokrecompanies.com.)",
    "portalUrl": "AppFolio online tenant/payment portal: https://onlineportal.appfolio.com (Lokre's instance reached via url3704.onlineportal.appfolio.com); company site: lokrecompanies.com",
    "paymentInfo": "Payments run through the AppFolio Online Portal. KFI/Brad Hubele has an automatic (recurring) payment / autopay set up on the account. A 2026-05-28 notice stated the automatic payment was NOT processed because there was no outstanding balance at the time (i.e., autopay only charges when a balance is posted; charges may not post until later). No bank account details, check remittance address, payment terms, or late-fee policy were disclosed in these emails. To confirm a balance or manage autopay, use the AppFolio Online Portal. Note: these Lokre/AppFolio emails were being caught by KFI's Mimecast spam/hold filter (Postmaster on-hold notices on 5/27 and 5/28), so future portal/payment emails may need releasing.",
    "propertiesServed": [
      "Not specified in the emails. Context indicates the relationship concerns Kolbe Apartments LLC (manager), Wausau, WI (Schuette Metals)."
    ],
    "notes": "Source: automated AppFolio tenant-portal emails from 'Lokre Companies' <donotreply@onlineportal.appfolio.com> to bhubele@kfistaffing.com (subject 'Lokre Companies - Automatic Payment Not Processed', received 2026-05-28). No human signature, mailing address, bank, or late-fee terms appear in the available messages — only the portal, phone (715) 342-9200, and website lokrecompanies.com. Other 'Lokre' search hits were unrelated (Mimecast Postmaster on-hold notices and internal '13 Week Forecast'/'Cash flow' threads). Recommend logging into the AppFolio portal and/or calling Lokre for entity name, remittance details, and lease/late-fee terms."
  },
  {
    "company": "Service First Rentals",
    "legalName": "Lease was executed with \"TB Rentals\" as the landlord entity (per the fully executed lease file \"Lease KFI Staffing-TB Rentals.pdf\"). \"Service First Rentals\" appears to be the property-management / branding name used for the Beau Chateau and Dexter Grant properties in Dexter, MO. Booking, utilities/insurance onboarding, and invoicing are handled through \"Lanyard\" (lanyardstays.com), with payments processed via Bill.com. The deal was brokered by Brandon M. Sparks of SMG Realty (SMG MO). No formal LLC/Inc. legal name for \"Service First Rentals\" itself was stated in the emails.",
    "contacts": [
      {
        "name": "Brandon M. Sparks",
        "role": "Broker / agent, SMG Realty (SMG MO) - primary leasing contact who negotiated and sent the executed lease + landlord voided check",
        "email": "brandon@smgmo.com",
        "phone": ""
      },
      {
        "name": "Joan",
        "role": "Lanyard Accounts Team - handles utilities/insurance setup, key pick-up scheduling, move-in coordination",
        "email": "accounts@lanyardstays.com",
        "phone": ""
      },
      {
        "name": "Gabriela Paul",
        "role": "Lanyard (cc'd on move-in / utilities setup correspondence)",
        "email": "gabriela@lanyardstays.com",
        "phone": ""
      },
      {
        "name": "Yolonda",
        "role": "Landlord's cleaner / janitorial (monthly cleaning scheduled and billed with rent; last name and contact not provided)",
        "email": "",
        "phone": ""
      }
    ],
    "mailingAddress": "No dedicated billing/mailing address for Service First Rentals was stated. Property addresses served (Dexter, MO 63841): Beau Chateau - 501 W Fannetta St, Units 10, 11, 12, 16; and Dexter Grant Apartment - 15974 Co Rd 612, Unit A3. Key pick-up location given as 501 W. Fannetta St., Unit 10, Dexter, MO. Bill.com invoices are issued under \"Lanyard\" (Bill.com remittance, 6220 America Center Drive, San Jose, CA 95002 is Bill.com's address, not the landlord's).",
    "portalUrl": "Lanyard onboarding/upload portal (links via url3849.lanyardstays.com Upload buttons for COI/insurance). Invoice payment portal: Bill.com (app02.us.bill.com \"View & Pay Invoice\").",
    "paymentInfo": "Rent paid by recurring ACH each month (KFI confirmed it can set up a recurring ACH for the rent and fee). Landlord provided a voided check to initiate ACH on KFI's end (bank account/routing numbers are on the voided check + lease attachments, not in the email body). Monthly cleaning (Yolonda) to be ACH'd together with the rent. Lease/deposit terms discussed: security deposit = one month's rent. Pricing: ~$650/occupant/room on the 6-month lease; would drop to $600/occupant/room ($7,200/mo for 12 occupants) on a 12-month lease; doubling up four rooms = +$300/occupant ($1,200), bringing total to $8,400/mo on a 12-month lease (amounts exclude janitorial); additional $225 for a second coin-operated washer/dryer set. Separate invoices come via Lanyard through Bill.com (e.g., Invoice 1110-1293, $3,870.61, due Jun 25, 2026) - LATE FEE $150.00 if not paid by end of day Jul 1, 2026 PT. Bill.com customer support: 866-989-BILL (2455). Landlord requires KFI to carry insurance (min $100,000 liability) and to list the LL as additional insured (COI required).",
    "propertiesServed": [
      "Beau Chateau - 501 W Fannetta St, Unit 10, Dexter, MO 63841",
      "Beau Chateau - 501 W Fannetta St, Unit 11, Dexter, MO 63841",
      "Beau Chateau - 501 W Fannetta St, Unit 12, Dexter, MO 63841",
      "Beau Chateau - 501 W Fannetta St, Unit 16, Dexter, MO 63841",
      "Dexter Grant Apartment - 15974 Co Rd 612, Unit A3, Dexter, MO 63841"
    ],
    "notes": "\"Service First Rentals\" surfaces only as a co-branding label paired with \"Beau Chateau\" in Lanyard's move-in emails (\"move-in at Beau Chateau / Service First Rentals in Dexter, MO\"). The operational chain for KFI: leasing/broker = Brandon M. Sparks, SMG Realty / SMG MO (brandon@smgmo.com); landlord lease entity = TB Rentals; onboarding & billing platform = Lanyard (accounts@lanyardstays.com, lanyardstays.com) running payments through Bill.com. KFI internal owners on this account: Dawn Whitmore (Director of Implementation & Delivery, DWhitmore@kfi.group), Alex Cosby (utilities, ACosby@kfi.group), Brad Hubele (Controller, BHubele@kfi.group / AP ap@kfistaffing.com), Linoshka Santana (LSantana@kfi.group), Jill Mattson, Andrea Story, Kristen Nelson. Move-in date 6/15/2026; key pick-up by appointment only at 501 W. Fannetta St., Unit 10. Bank account/routing details are on the landlord's voided check and the lease PDF (attachments), not in the email text. Two Chevy Express 3500 vans in Dexter, MO were added to KFI's auto policy effective 5/18 (separate M3 Insurance / Tori Simes correspondence). Exact bank name, routing/account numbers, and a formal legal entity name for \"Service First Rentals\" could not be confirmed from email bodies/signatures - they would require opening the lease PDF and voided-check attachments."
  },
  {
    "company": "Ridge Motor Inn",
    "legalName": "Ridge Motor Inn (referred to as \"The Ridge Motor Inn\" / \"The Ridge\"). No separate registered LLC/entity name appears in the emails.",
    "contacts": [
      {
        "name": "Joe",
        "role": "On-site contact / front desk at the Ridge (handles room lists, balances, payment due notices)",
        "email": "ridgemotorinn@gmail.com",
        "phone": "608-742-5306"
      },
      {
        "name": "Philip (Phil) Patel",
        "role": "Owner",
        "email": "philippatel84@gmail.com",
        "phone": ""
      }
    ],
    "mailingAddress": "2900 New Pinery Road, Portage, WI 53901 (motel property address shown on invoices). Tel: (608) 742-5306",
    "portalUrl": "",
    "paymentInfo": "Payment by ACH. Phil Patel provided ACH banking info to KFI Finance (finance@kfistaffing.com) so payments could be processed; specific bank name/account not stated in the emails. A check had previously been mailed (~early May 2026) but was canceled in favor of ACH. Invoice terms shown as \"Due: Upon Receipt.\" No late-fee policy stated. Rent rate (per 5/19/2026 agreement with Phil): $58 per room per night for fewer than 10 rooms (prior deal was $53/night with a 10-room/20-bed minimum). As of 6/11/2026, monthly billing of $27,840/month for all rooms begins July 1, 2026; a catch-up total of $40,808 was owed to bring all rooms current to July 1.",
    "propertiesServed": [
      "Ridge Motor Inn, 2900 New Pinery Road, Portage, WI 53901 - rooms rented for KFI Staffing client housing (summer 2026). Rooms referenced: 205, 134, 149, 216, 215, 247, 122, 303, 232, 136, S207, S209, S211, S218, S219, S221"
    ],
    "notes": "No tenant/payment portal in use; billing is by emailed PDF invoices (Ridge Motor Inn invoice template) and email room lists. KFI bill-to address on invoices: KFI STAFFING, 4005 Felland Road, Madison, WI 53718. Key people on the KFI side: Kristen Nelson (KNelson@kfi.group / KNelson@kfistaffing.com) negotiated the rent agreement; Brad Hubele (BHubele@kfi.group / bhubele@kfistaffing.com) handles invoice payments; KFI Staffing Finance (finance@kfistaffing.com) holds the ACH info. \"Joe\" and \"Phil Patel\" both send from the shared ridgemotorinn@gmail.com / philippatel84@gmail.com addresses. Emails note 8 rooms were over a month behind on rent as of 5/19/2026. Outlook contains a longer thread (Invoices, payment, Payment due) if more detail is needed."
  },
  {
    "company": "Dunn Property Management",
    "legalName": "",
    "contacts": [],
    "mailingAddress": "",
    "portalUrl": "",
    "paymentInfo": "",
    "propertiesServed": [],
    "notes": "No emails from or about a rental/property management company called \"Dunn Property Management\" were found in the user's Outlook. Searches run: \"Dunn Property Management\", \"Dunn Property Versailles rent\", \"Dunn rental lease Eldon\", and \"Dunn\". The only matches for \"Dunn\" are unrelated: (1) a KFI Staffing employee named \"DUNN, TAYLOR\" appearing in an employee-history attachment, and (2) the street address \"100 Dunn Avenue South, Hinckley, MN\" inside Samsara driver-time reports. No correspondence references Versailles MO housing, Adient associate lodging, an Eldon MO leasing office, rent/lease terms, a tenant payment portal, or any property-management contact. No contact card could be built. If this vendor exists, the relationship may be handled outside this mailbox (e.g., phone, a different/shared mailbox, or accounting system) and could be searched there."
  },
  {
    "company": "Patriot Properties",
    "legalName": "Patriot Properties (landlord / property owner for the Milwaukee Valve units at 1850 W Pine St, Baraboo/West Baraboo, WI). Leasing and property management handled by Lanyard (Lanyard Stays). Note: emails do not state a full legal entity name for Patriot Properties; payment ledger shows it as \"Patriot Properti WEB PMTS\".",
    "contacts": [
      {
        "name": "Lanyard (Accounts)",
        "role": "Property management / leasing agent accounts (handles leases, key pickup, move-in requirements)",
        "email": "accounts@lanyardstays.com",
        "phone": ""
      },
      {
        "name": "Lauren O'Connor",
        "role": "Lanyard (property management contact, cc'd on lease/payment thread)",
        "email": "lauren@lanyardstays.com",
        "phone": ""
      },
      {
        "name": "Joan",
        "role": "Lanyard accounts representative (coordinated key pickup, utility/insurance/occupant requirements via accounts@lanyardstays.com)",
        "email": "accounts@lanyardstays.com",
        "phone": ""
      },
      {
        "name": "Valerie Alderman",
        "role": "KFI Office Manager (signed the leases, KFI-side point of contact)",
        "email": "VAlderman@kfistaffing.com",
        "phone": "608-733-1051"
      },
      {
        "name": "Alex Cosby",
        "role": "KFI Staff Accountant (paid security deposits / set up utilities)",
        "email": "acosby@kfistaffing.com",
        "phone": "608-397-9867"
      }
    ],
    "mailingAddress": "No billing/mailing address for Patriot Properties is stated in the emails. Leased property address: 1850 W Pine St, Baraboo, WI 53913 (located in the Village of West Baraboo). Tenant/lessee of record is KFI Staffing LLC, 4005 Felland Rd Ste. 104, Madison, WI 53718.",
    "portalUrl": "https://account.appfolio.com (AppFolio Online Portal — login provided by Lanyard/Patriot for viewing leases and making rent payments)",
    "paymentInfo": "Rent and security deposits are paid online via web payment (ACH), appearing on bank statements as \"Patriot Properti WEB PMTS\" with per-unit reference codes (e.g., L169KD, K169KD, J169KD, H169KD, G169KD). Leases viewed and payments made through the AppFolio online portal (account.appfolio.com). Security deposit = $1,675.00 per unit ($8,375.00 for 5 units). Pro-rated first rent (start 9/30/25) = $55.83 per unit. All 5 security deposits paid 9/18/2025 at $1,730.83 each. No bank routing/account, payment terms, or late-fee policy were stated in the emails. (Separately, the West Baraboo water/sewer utility bills via Payment Services Network, issued on the 1st and due the 25th — utility, not Patriot rent.)",
    "propertiesServed": [
      "1850 W Pine St, Baraboo, WI 53913 (Village of West Baraboo) - Milwaukee Valve associate housing",
      "Units 509, 510, 512, 811, 812 (5 units / leases signed 9/18/2025, occupancy start 9/30/2025)"
    ],
    "notes": "\"Patriot Properties\" is the landlord/property owner; \"Lanyard\" (Lanyard Stays, lanyardstays.com) is the property management/leasing company that interfaces with KFI on Patriot's behalf — all tenant communications (leases, key pickup, move-in requirements, occupant info, renters insurance, ID copies) came through Lanyard (accounts@lanyardstays.com, with Lauren O'Connor and \"Joan\"). No direct Patriot Properties employee name, phone, email, or office address appears in the emails; Patriot only appears as the payee on the ACH/web rent payments and as the named insured on a Certificate of Insurance (\"Patriot Properties_KFI Staffing LLC_2526 All Lines\"). Property is in the Village of West Baraboo (phone 608-356-2516 for the village; water/sewer set up with City/Village of West Baraboo). This housing serves KFI's Milwaukee Valve client. Key thread: \"Milwaukee Valve leases signed - need Sec Dep paid\" (Sep 18-30, 2025). Recommend pulling exact lease/payee details from the AppFolio portal or the lease PDFs, since Patriot's own legal entity name and remittance address are not spelled out in email.\""
  },
  {
    "company": "American Edge Real Estate",
    "legalName": "American Edge Real Estate Services, Inc.",
    "contacts": [
      {
        "name": "Tim",
        "role": "Primary contact / Property manager (lead on leasing, move-ins, payments)",
        "email": "tim@americanedge.com",
        "phone": "(715) 235-7999"
      },
      {
        "name": "Mike Sullivan",
        "role": "Office/leasing staff (handles early move-in agreements, key pickup)",
        "email": "mike@americanedge.com",
        "phone": "(715) 235-7999"
      },
      {
        "name": "Taylor Engan",
        "role": "Staff (CC'd on rent/security deposit thread)",
        "email": "taylor@americanedge.com",
        "phone": ""
      },
      {
        "name": "Melissa",
        "role": "Staff (CC'd on payment/move-in threads)",
        "email": "Melissa@americanedge.com",
        "phone": ""
      },
      {
        "name": "Alexis",
        "role": "Staff (CC'd on move-in threads)",
        "email": "alexis@americanedge.com",
        "phone": ""
      },
      {
        "name": "Shannon",
        "role": "Staff (CC'd on move-in threads)",
        "email": "shannon@americanedge.com",
        "phone": ""
      },
      {
        "name": "Christin",
        "role": "Staff (CC'd on move-in threads)",
        "email": "christin@americanedge.com",
        "phone": ""
      }
    ],
    "mailingAddress": "1402 8th Street, Menomonie, WI 54751 — Phone (715) 235-7999. Office hours Mon-Thu 8AM-5PM, Fri 8AM-12PM.",
    "portalUrl": "https://americanedgeapplications.securecafenet.com/residentservices/1402-8th-street/userlogin (RentCafe Resident Portal; powered by Yardi)",
    "paymentInfo": "Multiple methods accepted: (1) Check, cash, cashier's check, or money order payable to \"American Edge Real Estate Services, Inc.\"; (2) Online via RentCafe Resident Portal; (3) ACH — they can process a one-time ACH payment over the phone, KFI provides bank name, routing number, and account number. CARD/credit payments are NOT accepted. Terms: Rent is due on the 1st of the month and is considered LATE after the 5th. Security deposit + first month's (June) rent must be paid in full before keys are released. Confirmed payment example: $1,200.00 one-time online payment via RentCafe on 5/22/2026 from KFI Staffing LLC checking acct ending 0574 (Confirmation #600029057). Payment processing handled by Yardi as limited payment collection agent.",
    "propertiesServed": [
      "1402 8th Street, Menomonie, WI 54751 (Cady Cheese housing)",
      "602 12th Street, Menomonie, WI (additional KFI unit referenced)"
    ],
    "notes": "Property management company in Menomonie, WI. \"Tim\" is the de facto primary point of contact and signs most emails; full last name not stated in correspondence. Mike Sullivan (mike@americanedge.com) handles on-site key pickup and early move-in agreements. KFI contacts in the thread: Brad Hubele (Controller, BHubele@kfi.group), Dawn Whitmore (Director of Implementation and Delivery, DWhitmore@kfi.group / DWhitmore@kfistaffing.com), Linoshka Santana, Alex Cosby, Kristen Nelson. Automated portal/system emails come from American Edge Real Estate Services, Inc. <no-reply@rentcafe.com>. Process notes: a \"check-in rider\" must be completed and returned within 8 days of taking occupancy to document unit condition (used for security-deposit determination at lease end); maintenance requests via office, phone during business hours, or RentCafe. Separate KFI location at Thorp, WI (WB Manufacturing account, \"Sunset Place\") appears in adjacent emails but is NOT served by American Edge."
  }
]
;
