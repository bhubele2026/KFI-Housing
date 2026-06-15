import { and, eq, like } from "drizzle-orm";
import {
  db,
  customersTable,
  propertiesTable,
  leasesTable,
  type InsertCustomerRow,
  type InsertPropertyRow,
  type InsertLeaseRow,
} from "@workspace/db";
import { logger as defaultLogger } from "./logger";
import { computeLeaseStatus, todayIso } from "./lease-status";
import type { Logger } from "pino";

/**
 * Generic idempotent seeder for the remaining KFI housing properties
 * discovered in the June 2026 Outlook + SharePoint housing harvest that
 * did NOT already have a dedicated seed (Sunset Place got its own file;
 * Park Place, Prairie Hill/Patriot Baraboo, Greenock, Hickory Haven,
 * Kolbe/Wausau, the Ridge/Portage, Bloomfield, Siren, Webster,
 * Burnett-Hinckley, AutoZone/Yellow House, Chateau Knoll,
 * Adient/Versailles and Ridge Motor Inn are already seeded elsewhere).
 *
 * Each property is pure data in `HARVESTED_PROPERTIES` — to change a
 * rent, address, or unit later, edit the row and redeploy; the seeder
 * never UPDATEs an existing row, so operator edits in HousingOps always
 * win. Reconciliation matches the per-property seeds exactly: customer
 * by name LIKE 'KFI Staffing%' (or the real end-client when present),
 * property by (customerId, address, zip), lease by (propertyId,
 * startDate, endDate, "Unit N —" marker in notes).
 *
 * Units whose rent/terms could not be read from a (scanned) lease PDF
 * are seeded with `needsReview=true` and rent 0 so an operator can fill
 * them in — they still appear in the app as a real unit.
 */

interface HarvestedLeaseSpec {
  unit: string;
  startDate?: string;
  endDate?: string;
  /** null/omitted when the lease PDF was unreadable and rent is unknown. */
  monthlyRent?: number | null;
  securityDeposit?: number | null;
  /** "monthly" (default) or "room-night" for hotels/motels. */
  rateType?: "monthly" | "room-night";
  nightlyRate?: number | null;
  noticePeriodDays?: number | null;
  needsReview?: boolean;
  source?: string;
  note?: string;
}

interface HarvestedPropertySpec {
  /** stable slug used for deterministic ids. */
  key: string;
  client: string;
  /** end-client name LIKE pattern for repoint; "" to skip repoint. */
  endClientPattern: string;
  propertyName: string;
  propertyType: "Apartment" | "Town house" | "Motel";
  address: string;
  city: string;
  state: string;
  zip: string;
  vendor: string;
  weeklyCost?: number;
  landlordName?: string;
  landlordEmail?: string;
  landlordPhone?: string;
  paymentRecipient?: string;
  notes: string;
  leases: readonly HarvestedLeaseSpec[];
}

export const HARVESTED_PROPERTIES: readonly HarvestedPropertySpec[] = [
  {
    key: "stonleigh-court-leavenworth",
    client: "Heatron",
    endClientPattern: "Heatron%",
    propertyName: "Stonleigh Court Apartments – Leavenworth, KS",
    propertyType: "Apartment",
    address: "1312 Stonleigh Court",
    city: "Leavenworth",
    state: "KS",
    zip: "66048",
    vendor: "Lanyard",
    landlordName: "Stonleigh Court Apartments",
    notes:
      "Heatron crew housing across Stonleigh Court / Miami St / Seneca St, Leavenworth KS. " +
      "Terms below are the 2024–25 leases on file; confirm current renewals (flagged needsReview). " +
      "Two units (1341 #A, 2019 Miami #B) had 30-day buyout notices terminating 2025-07-24.",
    leases: [
      { unit: "1312 Stonleigh Court #E", monthlyRent: 1208, startDate: "2024-09-27", endDate: "2025-09-30", noticePeriodDays: 30, needsReview: true },
      { unit: "1315 Stonleigh Court #D", monthlyRent: 1208, startDate: "2024-10-15", endDate: "2025-10-31", noticePeriodDays: 30, needsReview: true },
      { unit: "1341 Stonleigh Court #A", monthlyRent: 1154, startDate: "2024-10-15", endDate: "2025-10-31", noticePeriodDays: 30, needsReview: true, note: "30-day buyout, terminated 2025-07-24." },
      { unit: "1341 Stonleigh Court #C", monthlyRent: 1154, startDate: "2024-10-01", endDate: "2025-09-30", noticePeriodDays: 30, needsReview: true },
      { unit: "1340 Stonleigh Court #F", monthlyRent: 1099, startDate: "2024-12-11", endDate: "2025-12-31", noticePeriodDays: 30, needsReview: true },
      { unit: "2019 Miami St #B", monthlyRent: 1249, startDate: "2024-12-11", endDate: "2025-12-31", noticePeriodDays: 30, needsReview: true, note: "30-day buyout, terminated 2025-07-24." },
      { unit: "2015 Miami St #B", monthlyRent: 1249, startDate: "2024-11-27", endDate: "2025-11-30", noticePeriodDays: 30, needsReview: true },
      { unit: "2023 Seneca St #D", monthlyRent: 1249, startDate: "2024-11-27", endDate: "2025-11-30", noticePeriodDays: 30, needsReview: true },
    ],
  },
  {
    key: "foote-hills-grand-rapids",
    client: "Roskam",
    endClientPattern: "Roskam%",
    propertyName: "Foote Hills Apartments – Grand Rapids, MI",
    propertyType: "Town house",
    address: "4710 Wrightwind Dr SE",
    city: "Grand Rapids",
    state: "MI",
    zip: "49546",
    vendor: "Lanyard",
    landlordName: "Foote Hills Group, LLC",
    notes:
      "Roskam crew housing. Landlord Foote Hills Group, LLC (mailing 4630 Commonway Dr SE). " +
      "Only Unit 505DW lease was machine-readable; the other 8 units need rent entered (needsReview). " +
      "Utilities: DTE Energy (townhomes only).",
    leases: [
      { unit: "505DW", monthlyRent: 1800, startDate: "2025-01-03", endDate: "2026-01-31", noticePeriodDays: 60, needsReview: true, note: "Confirm renewal — term ended 2026-01-31." },
      { unit: "103", needsReview: true }, { unit: "902", needsReview: true },
      { unit: "A02", needsReview: true }, { unit: "A10P", needsReview: true },
      { unit: "B05D", needsReview: true }, { unit: "D06", needsReview: true },
      { unit: "E02", needsReview: true }, { unit: "B03P", needsReview: true },
    ],
  },
  {
    key: "college-towne-lansing",
    client: "Adient",
    endClientPattern: "Adient%",
    propertyName: "College Towne Apartments – Lansing, MI",
    propertyType: "Apartment",
    address: "College Towne Apartments",
    city: "Lansing",
    state: "MI",
    zip: "",
    vendor: "Lanyard",
    notes:
      "Adient crew housing. All 4 lease PDFs are scanned/image-only — rent/deposit/term need manual entry (needsReview). Executed ~2024-07-17.",
    leases: [
      { unit: "1122", startDate: "2024-07-17", needsReview: true },
      { unit: "1212", startDate: "2024-07-17", needsReview: true },
      { unit: "1214", startDate: "2024-07-17", needsReview: true },
      { unit: "1222", needsReview: true },
    ],
  },
  {
    key: "cady-1402-8th-menomonie",
    client: "Cady Cheese",
    endClientPattern: "Cady Cheese%",
    propertyName: "1402 8th Street – Menomonie, WI",
    propertyType: "Apartment",
    address: "1402 8th Street",
    city: "Menomonie",
    state: "WI",
    zip: "54751",
    vendor: "American Eagle",
    landlordName: "MA Properties (mgr American Edge Real Estate Services)",
    notes:
      "Cady Cheese crew housing. Corporate lease (KFI Staffing); does not auto-renew. 28-day notice.",
    leases: [
      { unit: "1402 8th Street", monthlyRent: 1200, securityDeposit: 1200, startDate: "2026-06-01", endDate: "2027-05-21", noticePeriodDays: 28 },
    ],
  },
  {
    key: "beau-chateau-dexter",
    client: "Orgill",
    endClientPattern: "Orgill%",
    propertyName: "Beau Chateau (Service First Rentals) – Dexter, MO",
    propertyType: "Apartment",
    address: "501 W Fannetta St",
    city: "Dexter",
    state: "MO",
    zip: "63841",
    vendor: "Lanyard",
    landlordName: "Brandon Sparks (SMG MO) / Service First Rentals",
    landlordEmail: "brandon@smgmo.com",
    notes:
      "Orgill crew housing, Housing Request #FR4R5Z. AMBIGUITY: email says Dexter MO (501 W Fannetta); " +
      "SharePoint Orgill folders say Sikeston MO — confirm which is current. Rents in scanned leases (needsReview). " +
      "Min $100k liability insurance required. Electric via Ameren Missouri. Grant Apt A3 is a different street address.",
    leases: [
      { unit: "10", startDate: "2026-06-16", needsReview: true, note: "Move-in 6/16 (some sources say 6/15)." },
      { unit: "11", startDate: "2026-06-15", needsReview: true },
      { unit: "12", startDate: "2026-06-15", needsReview: true },
      { unit: "16", startDate: "2026-06-15", needsReview: true },
      { unit: "Grant Apt A3 (15974 Co Rd 612)", startDate: "2026-06-15", needsReview: true, note: "Different address — may be its own property." },
    ],
  },
  {
    key: "tb-rentals-sikeston",
    client: "Orgill",
    endClientPattern: "Orgill%",
    propertyName: "TB Rentals LLC – Sikeston, MO",
    propertyType: "Apartment",
    address: "TB Rentals LLC",
    city: "Sikeston",
    state: "MO",
    zip: "",
    vendor: "TB Rentals LLC",
    landlordName: "TB Rentals LLC",
    notes: "Orgill crew housing. Lease PDF scanned/unreadable — all terms need manual entry (needsReview).",
    leases: [{ unit: "TBD", needsReview: true }],
  },
  {
    key: "bartlett-el-paso",
    client: "International Wire",
    endClientPattern: "International Wire%",
    propertyName: "The Bartlett Apartment Homes – El Paso, TX",
    propertyType: "Apartment",
    address: "330 Bartlett Dr",
    city: "El Paso",
    state: "TX",
    zip: "79912",
    vendor: "Lanyard",
    notes:
      "International Wire crew housing, Housing Request #9V4DOO. PENDING — no executed lease yet (folder had only a BGC letter); lease/move-in/utilities not issued as of June 2026.",
    leases: [{ unit: "TBD", needsReview: true, note: "Pending — lease not issued yet (#9V4DOO)." }],
  },
  {
    key: "independent-stave-howard-lebanon",
    client: "Independent Stave",
    endClientPattern: "Independent Stave%",
    propertyName: "Independent Stave Housing (Howard Dr) – Lebanon, MO",
    propertyType: "Apartment",
    address: "Howard Dr",
    city: "Lebanon",
    state: "MO",
    zip: "65536",
    vendor: "",
    weeklyCost: 150,
    notes:
      "Independent Stave crew housing ($150/wk). Units 743–819 on Howard Dr/Ave. Rents need manual entry (needsReview). " +
      "GoForth Investments LLC (743 Howard Ave) overlaps unit 743 — likely same cluster/landlord.",
    leases: [
      { unit: "819", needsReview: true }, { unit: "817", needsReview: true },
      { unit: "815", needsReview: true }, { unit: "813", needsReview: true },
      { unit: "749", needsReview: true }, { unit: "747", needsReview: true },
      { unit: "745", needsReview: true }, { unit: "743", needsReview: true },
    ],
  },
  {
    key: "las-palmas-arlington",
    client: "(Arlington, TX)",
    endClientPattern: "",
    propertyName: "Las Palmas – Arlington, TX",
    propertyType: "Apartment",
    address: "E Sanford St",
    city: "Arlington",
    state: "TX",
    zip: "76011",
    vendor: "",
    notes: "Master-file property; 4 units on E Sanford St. Rents need manual entry (needsReview).",
    leases: [
      { unit: "Unit 1", needsReview: true }, { unit: "Unit 2", needsReview: true },
      { unit: "Unit 3", needsReview: true }, { unit: "Unit 4", needsReview: true },
    ],
  },
  {
    key: "town-point-bardstown",
    client: "(Bardstown, KY)",
    endClientPattern: "",
    propertyName: "Town Point Apartments – Bardstown, KY",
    propertyType: "Apartment",
    address: "111 E Obryan Ave",
    city: "Bardstown",
    state: "KY",
    zip: "40004",
    vendor: "",
    notes: "Master-file property. Rent per bed ~$71. Confirm units/rent (needsReview).",
    leases: [{ unit: "Unit", needsReview: true }],
  },
  {
    key: "holts-summit",
    client: "(Holts Summit, MO)",
    endClientPattern: "",
    propertyName: "Holts Summit – Holts Summit, MO",
    propertyType: "Apartment",
    address: "150 City Plaza",
    city: "Holts Summit",
    state: "MO",
    zip: "",
    vendor: "",
    notes: "Master-file property; large room roster (~37), rent per person ~$25. Confirm active + terms (needsReview).",
    leases: [{ unit: "Rooms (37)", needsReview: true }],
  },
  {
    key: "burnett-menomonie-houses",
    client: "Burnett-Wilson",
    endClientPattern: "",
    propertyName: "Burnett – Menomonie Houses",
    propertyType: "Apartment",
    address: "1721 Plaza Drive",
    city: "Menomonie",
    state: "WI",
    zip: "54751",
    vendor: "",
    weeklyCost: 125,
    notes: "Burnett-Wilson crew housing ($125/wk); ~9 units. Distinct from Cady Cheese 1402 8th St. Rents need manual entry (needsReview).",
    leases: [{ unit: "Houses (9 units)", needsReview: true }],
  },
  {
    key: "palace-motel-de-queen",
    client: "Bell Lumber",
    endClientPattern: "Bell Lumber%",
    propertyName: "Palace Motel – De Queen, AR",
    propertyType: "Motel",
    address: "607 W Collin Raye Dr",
    city: "De Queen",
    state: "AR",
    zip: "71832",
    vendor: "Palace Motel",
    landlordName: "Palace Motel",
    notes: "Bell Lumber crew housing (motel). NO PETS / NO REFUNDS; advance payment. Invoice 260320_857-249.",
    leases: [
      { unit: "Room (Gerard Derby)", rateType: "room-night", nightlyRate: 53.91, startDate: "2026-03-20", endDate: "2026-04-03", note: "14 nights." },
    ],
  },
  {
    key: "chalie-wesley-broken-bow",
    client: "Bell Lumber",
    endClientPattern: "Bell Lumber%",
    propertyName: "Chalie Wesley Motor Lodge – Broken Bow, OK",
    propertyType: "Motel",
    address: "302 N Park Dr",
    city: "Broken Bow",
    state: "OK",
    zip: "74728",
    vendor: "",
    weeklyCost: 150.5,
    notes: "Bell Lumber crew housing (motel), ~$460/wk per room, lease start 2025-07-06. Confirm room count/rate (needsReview).",
    leases: [{ unit: "Rooms (5)", rateType: "room-night", startDate: "2025-07-06", needsReview: true }],
  },
  {
    key: "red-roof-morehead",
    client: "Independent Stave (ISKY)",
    endClientPattern: "Independent Stave%",
    propertyName: "Red Roof Inn – Morehead, KY",
    propertyType: "Motel",
    address: "Red Roof Inn Morehead",
    city: "Morehead",
    state: "KY",
    zip: "",
    vendor: "Lanyard",
    notes: "Independent Stave (ISKY) crew housing (motel). Reservation summary PDF unreadable — nightly rate/dates need manual entry (needsReview). May relate to the Days Inn Morehead record.",
    leases: [{ unit: "TBD", rateType: "room-night", needsReview: true }],
  },
  {
    key: "days-inn-morehead",
    client: "(Morehead, KY)",
    endClientPattern: "",
    propertyName: "Days Inn – Morehead, KY",
    propertyType: "Motel",
    address: "170 Toms Dr",
    city: "Morehead",
    state: "KY",
    zip: "40351",
    vendor: "",
    notes: "Master-file motel ($65/room/night), lease start 2024-05-14. May be superseded by Red Roof Morehead (ISKY) — confirm which is current (needsReview).",
    leases: [{ unit: "Rooms (4)", rateType: "room-night", nightlyRate: 65, startDate: "2024-05-14", needsReview: true }],
  },
  {
    key: "express-inn-hartselle",
    client: "(Hartselle, AL)",
    endClientPattern: "",
    propertyName: "Express Inn & Suites – Hartselle, AL",
    propertyType: "Motel",
    address: "1601 Hwy 31 SW",
    city: "Hartselle",
    state: "AL",
    zip: "35640",
    vendor: "",
    notes: "Master-file motel ($60.50/night), ~6 rooms. Confirm dates/occupants (needsReview).",
    leases: [{ unit: "Rooms (6)", rateType: "room-night", nightlyRate: 60.5, needsReview: true }],
  },
  {
    key: "comfort-suites-madison",
    client: "KFI Staffing",
    endClientPattern: "",
    propertyName: "Comfort Suites – Madison, WI",
    propertyType: "Motel",
    address: "Comfort Suites Madison",
    city: "Madison",
    state: "WI",
    zip: "",
    vendor: "",
    notes: "KFI Staffing motel housing. Agreement PDF scanned/unreadable — room/rate need manual entry (needsReview).",
    leases: [{ unit: "TBD", rateType: "room-night", needsReview: true }],
  },
];

function propertyId(spec: HarvestedPropertySpec): string {
  return `prop-${spec.key}`;
}
function leaseId(spec: HarvestedPropertySpec, unit: string): string {
  const slug = unit.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `lease-${spec.key}-u${slug}`;
}
function unitMarker(unit: string): string {
  return `Unit ${unit} —`;
}
function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const UNASSIGNED_CUSTOMER = "Unassigned — needs customer";

/**
 * The real customer (staffing client) this property's workers serve. Hotels
 * with no clear client (spec.client like "(City, ST)") group under one
 * "Unassigned" customer so they're visible and an operator can re-attach them.
 */
function clientDisplayName(spec: HarvestedPropertySpec): string {
  return spec.client.trim().startsWith("(") ? UNASSIGNED_CUSTOMER : spec.client.trim();
}
function clientCustomerId(spec: HarvestedPropertySpec): string {
  return `cust-${slug(clientDisplayName(spec))}`;
}

function buildCustomerRow(spec: HarvestedPropertySpec): InsertCustomerRow {
  return {
    id: clientCustomerId(spec),
    name: clientDisplayName(spec),
    contactName: "",
    email: "",
    phone: "",
    notes: `Staffing customer ${clientDisplayName(spec)} — workers housed at ${spec.propertyName}. Created from the June 2026 housing harvest; fill in contact details. Vendor: ${spec.vendor || "—"}.`,
  };
}

function buildPropertyRow(spec: HarvestedPropertySpec, custId: string): InsertPropertyRow {
  const totalMonthly = spec.leases.reduce((s, l) => s + (l.monthlyRent ?? 0), 0);
  return {
    id: propertyId(spec),
    customerId: custId,
    name: spec.propertyName,
    address: spec.address,
    city: spec.city,
    state: spec.state,
    zip: spec.zip,
    totalBeds: 0,
    monthlyRent: totalMonthly,
    chargePerBed: 0,
    status: "Active",
    propertyType: spec.propertyType,
    landlordName: spec.landlordName ?? "",
    landlordEmail: spec.landlordEmail ?? "",
    landlordPhone: spec.landlordPhone ?? "",
    paymentMethod: "",
    paymentRecipient: spec.paymentRecipient ?? spec.landlordName ?? "",
    paymentDueDay: 1,
    paymentNotes: "",
    bankName: "",
    bankRouting: "",
    bankAccount: "",
    portalUrl: "",
    notes: spec.notes,
    furnishings: [],
  };
}

function buildLeaseRow(
  spec: HarvestedPropertySpec,
  lease: HarvestedLeaseSpec,
  today: string,
): InsertLeaseRow {
  const isRoomNight = lease.rateType === "room-night";
  const needsReview = lease.needsReview ?? lease.monthlyRent == null;
  const start = lease.startDate ?? "";
  const end = lease.endDate ?? "";
  const status =
    needsReview && !start ? "Upcoming" : computeLeaseStatus(start, end, today);
  const rentNote =
    lease.monthlyRent != null
      ? `$${lease.monthlyRent.toFixed(2)}/mo.`
      : isRoomNight && lease.nightlyRate != null
        ? `$${lease.nightlyRate.toFixed(2)}/night.`
        : "Rate unknown — needs manual entry.";
  return {
    id: leaseId(spec, lease.unit),
    propertyId: propertyId(spec),
    unit: lease.unit,
    startDate: start,
    endDate: end,
    monthlyRent: lease.monthlyRent ?? 0,
    securityDeposit: lease.securityDeposit ?? 0,
    status,
    rateType: isRoomNight ? "room-night" : "monthly",
    nightlyRate: lease.nightlyRate ?? 0,
    weeklyCost: spec.weeklyCost ?? 0,
    vendor: spec.vendor,
    needsReview,
    noticePeriodDays: lease.noticePeriodDays ?? null,
    notes:
      `${unitMarker(lease.unit)} ${spec.client} — ${rentNote}` +
      `${lease.note ? ` ${lease.note}` : ""}` +
      `${lease.source ? ` Source: ${lease.source}` : ""}`,
    clauses: "",
    buyoutAvailable: false,
    buyoutCost: null,
  };
}

export interface SeedHarvestedResult {
  propertiesInserted: number;
  leasesInserted: number;
  customersInserted: number;
  repointed: number;
}

export interface SeedHarvestedDeps {
  db: typeof db;
  logger: Pick<Logger, "info" | "warn">;
  now: () => Date;
}

async function applyOne(
  database: typeof db,
  spec: HarvestedPropertySpec,
  today: string,
): Promise<{ customerInserted: boolean; propertyInserted: boolean; leasesInserted: number; repointed: boolean }> {
  return database.transaction(async (tx) => {
    // Customer: attach to the REAL staffing client. Reuse an existing match
    // (by end-client pattern when known, else by client name); otherwise
    // CREATE the real customer so the property is never stranded on a generic
    // fallback. Hotels with no clear client land on one "Unassigned" customer.
    let custId: string;
    let customerInserted = false;
    const pattern =
      spec.endClientPattern.length > 0
        ? spec.endClientPattern
        : `${clientDisplayName(spec)}%`;
    const existingCust = await tx
      .select({ id: customersTable.id })
      .from(customersTable)
      .where(like(customersTable.name, pattern))
      .limit(1);
    if (existingCust.length > 0) {
      custId = existingCust[0]!.id;
    } else {
      custId = clientCustomerId(spec);
      const ins = await tx
        .insert(customersTable)
        .values(buildCustomerRow(spec))
        .onConflictDoNothing()
        .returning({ id: customersTable.id });
      customerInserted = ins.length > 0;
      if (!customerInserted) {
        const re = await tx
          .select({ id: customersTable.id })
          .from(customersTable)
          .where(eq(customersTable.id, clientCustomerId(spec)))
          .limit(1);
        if (re.length > 0) custId = re[0]!.id;
      }
    }

    // Property by (customerId, address, zip).
    let propId: string;
    let propertyInserted = false;
    const existingProp = await tx
      .select({ id: propertiesTable.id })
      .from(propertiesTable)
      .where(
        and(
          eq(propertiesTable.customerId, custId),
          eq(propertiesTable.address, spec.address),
          eq(propertiesTable.zip, spec.zip),
        ),
      )
      .limit(1);
    if (existingProp.length > 0) {
      propId = existingProp[0]!.id;
    } else {
      propId = propertyId(spec);
      const ins = await tx
        .insert(propertiesTable)
        .values(buildPropertyRow(spec, custId))
        .onConflictDoNothing()
        .returning({ id: propertiesTable.id });
      propertyInserted = ins.length > 0;
      if (!propertyInserted) {
        const re = await tx
          .select({ id: propertiesTable.id })
          .from(propertiesTable)
          .where(
            and(
              eq(propertiesTable.customerId, custId),
              eq(propertiesTable.address, spec.address),
              eq(propertiesTable.zip, spec.zip),
            ),
          )
          .limit(1);
        if (re.length > 0) propId = re[0]!.id;
      }
    }

    let leasesInserted = 0;
    for (const lease of spec.leases) {
      const start = lease.startDate ?? "";
      const end = lease.endDate ?? "";
      const existing = await tx
        .select({ id: leasesTable.id })
        .from(leasesTable)
        .where(
          and(
            eq(leasesTable.propertyId, propId),
            eq(leasesTable.startDate, start),
            eq(leasesTable.endDate, end),
            like(leasesTable.notes, `%${unitMarker(lease.unit)}%`),
          ),
        )
        .limit(1);
      if (existing.length > 0) continue;
      const ins = await tx
        .insert(leasesTable)
        .values(buildLeaseRow(spec, lease, today))
        .onConflictDoNothing()
        .returning({ id: leasesTable.id });
      if (ins.length > 0) leasesInserted += 1;
    }

    return { customerInserted, propertyInserted, leasesInserted, repointed: false };
  });
}

export async function seedHarvestedPropertiesIfMissing(
  deps: Partial<SeedHarvestedDeps> = {},
): Promise<SeedHarvestedResult> {
  const database = deps.db ?? db;
  const log = deps.logger ?? defaultLogger;
  const today = todayIso((deps.now ?? (() => new Date()))());

  const totals: SeedHarvestedResult = {
    propertiesInserted: 0,
    leasesInserted: 0,
    customersInserted: 0,
    repointed: 0,
  };

  for (const spec of HARVESTED_PROPERTIES) {
    try {
      const r = await applyOne(database, spec, today);
      if (r.customerInserted) totals.customersInserted += 1;
      if (r.propertyInserted) totals.propertiesInserted += 1;
      totals.leasesInserted += r.leasesInserted;
      if (r.repointed) totals.repointed += 1;
    } catch (err) {
      log.warn({ err, property: spec.propertyName }, "Failed to seed harvested property — continuing");
    }
  }

  if (
    totals.propertiesInserted > 0 ||
    totals.leasesInserted > 0 ||
    totals.customersInserted > 0 ||
    totals.repointed > 0
  ) {
    log.info(totals, "Harvested properties seed applied.");
  }
  return totals;
}
