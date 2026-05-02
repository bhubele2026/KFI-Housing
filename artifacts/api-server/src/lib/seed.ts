import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  customersTable,
  propertiesTable,
  leasesTable,
  roomsTable,
  bedsTable,
  occupantsTable,
  utilitiesTable,
  type InsertCustomerRow,
  type InsertPropertyRow,
  type InsertLeaseRow,
  type InsertRoomRow,
  type InsertBedRow,
  type InsertOccupantRow,
  type InsertUtilityRow,
} from "@workspace/db";
import { logger } from "./logger";
import { normalizeLeaseDates } from "./normalize-lease-dates";

const SEED_CUSTOMERS: InsertCustomerRow[] = [
  {
    id: "c1",
    name: "Acme Energy",
    contactName: "Dana Rivera",
    email: "dana.rivera@acme-energy.com",
    phone: "512-555-1100",
    notes: "Long-term oilfield crews. Net-15 invoicing.",
  },
  {
    id: "c2",
    name: "Frontier Tech",
    contactName: "Marcus Lee",
    email: "marcus.lee@frontiertech.io",
    phone: "214-555-1200",
    notes: "Rotating consultants and engineers. Prefers monthly billing.",
  },
  {
    id: "c3",
    name: "Sunrise Logistics",
    contactName: "Hannah Park",
    email: "hannah.park@sunriselogistics.com",
    phone: "713-555-1300",
    notes: "Seasonal warehouse staff. Flexible occupancy needed.",
  },
];

const SEED_PROPERTIES: InsertPropertyRow[] = [
  {
    id: "p1",
    customerId: "c1",
    name: "Oakwood Estates",
    address: "100 Oak Way",
    city: "Austin",
    state: "TX",
    zip: "78701",
    totalBeds: 10,
    monthlyRent: 4800,
    chargePerBed: 800,
    status: "Active",
    landlordName: "James Harrington",
    landlordEmail: "j.harrington@realty.com",
    landlordPhone: "512-555-0101",
    paymentMethod: "ACH",
    paymentRecipient: "Harrington Properties LLC",
    paymentDueDay: 1,
    paymentNotes:
      "Auto-pay set up via bank. Confirmation email sent to billing@housingops.com.",
    bankName: "First National Bank",
    bankRouting: "021000021",
    bankAccount: "4400123456",
    portalUrl: "",
    notes: "Property manager prefers email contact. Parking included.",
    furnishings: [
      "Queen beds", "Mattresses", "Mattress protectors", "Pillows", "Bedding & linens",
      "Nightstands", "Dressers", "Desk", "Desk chair",
      "Sofa / Couch", "Coffee table", "Area rug",
      "Refrigerator", "Stove / Range", "Microwave", "Dishwasher", "Coffee maker",
      "Cookware set", "Dinnerware", "Utensils & cutlery",
      "Dining table", "Dining chairs",
      "Towels", "Shower curtain", "Hair dryer",
      "Washing machine", "Dryer",
      "Central A/C", "Central heating", "Smart thermostat",
      "Wi-Fi", "Smart TV", "Streaming device",
      "Smoke detectors", "Carbon monoxide detectors", "Fire extinguisher",
      "Gym / Fitness center", "Swimming pool", "Parking",
      "Vacuum cleaner",
    ],
    ratings: { landlord: 5, cleanliness: 4, amenities: 5, occupants: 4, location: 4, valueForMoney: 3 },
  },
  {
    id: "p2",
    customerId: "c2",
    name: "Maple Lofts",
    address: "200 Maple Dr",
    city: "Austin",
    state: "TX",
    zip: "78702",
    totalBeds: 12,
    monthlyRent: 5400,
    chargePerBed: 750,
    status: "Active",
    landlordName: "Sandra Kim",
    landlordEmail: "sandra.kim@maplerealty.com",
    landlordPhone: "512-555-0202",
    paymentMethod: "Online Portal",
    paymentRecipient: "Maple Realty Group",
    paymentDueDay: 5,
    paymentNotes: "Login to portal by 5th of each month. Late fee after 10th.",
    bankName: "",
    bankRouting: "",
    bankAccount: "",
    portalUrl: "https://portal.maplerealty.com",
    notes: "Utilities included in lease except internet.",
    furnishings: [
      "Single beds", "Bunk beds", "Mattresses", "Pillows", "Bedding & linens",
      "Nightstands", "Wardrobes / Closets",
      "Sofa / Couch", "Coffee table", "Floor lamps",
      "Refrigerator", "Stove / Range", "Microwave", "Coffee maker", "Toaster",
      "Cookware set", "Dinnerware", "Utensils & cutlery", "Trash can",
      "Dining table", "Dining chairs",
      "Towels", "Shower curtain", "Bath mat",
      "Washing machine", "Dryer", "Iron", "Ironing board",
      "Window A/C units", "Central heating", "Ceiling fans",
      "Wi-Fi", "Smart TV",
      "Smoke detectors", "Fire extinguisher",
      "Parking", "Garage", "Elevator",
      "Vacuum cleaner", "Cleaning supplies",
    ],
    ratings: { landlord: 4, cleanliness: 3, amenities: 4, occupants: 3, location: 5, valueForMoney: 4 },
  },
  {
    id: "p3",
    customerId: "c3",
    name: "Pine View",
    address: "300 Pine St",
    city: "Dallas",
    state: "TX",
    zip: "75201",
    totalBeds: 8,
    monthlyRent: 3600,
    chargePerBed: 900,
    status: "Active",
    landlordName: "Robert Tran",
    landlordEmail: "rtran@pinehomes.net",
    landlordPhone: "214-555-0303",
    paymentMethod: "Check",
    paymentRecipient: "Pine Homes Inc",
    paymentDueDay: 1,
    paymentNotes:
      "Mail check to PO Box 4401, Dallas TX 75201. Make out to Pine Homes Inc.",
    bankName: "",
    bankRouting: "",
    bankAccount: "",
    portalUrl: "",
    notes: "Requires 30-day notice before move-out of any occupant.",
    furnishings: [
      "Single beds", "Mattresses", "Pillows", "Bedding & linens",
      "Nightstands", "Dressers",
      "Sofa / Couch", "Coffee table",
      "Refrigerator", "Stove / Range", "Microwave",
      "Cookware set", "Dinnerware", "Utensils & cutlery", "Trash can",
      "Dining table", "Dining chairs",
      "Towels", "Shower curtain",
      "Washing machine", "Dryer",
      "Window A/C units", "Central heating",
      "Wi-Fi",
      "Smoke detectors", "Fire extinguisher",
      "Parking",
    ],
  },
  {
    id: "p4",
    customerId: "c2",
    name: "Cedar Ridge",
    address: "400 Cedar Ln",
    city: "Dallas",
    state: "TX",
    zip: "75202",
    totalBeds: 15,
    monthlyRent: 7500,
    chargePerBed: 700,
    status: "Active",
    landlordName: "Lisa Moreno",
    landlordEmail: "lisa@cedarprops.com",
    landlordPhone: "214-555-0404",
    paymentMethod: "Wire",
    paymentRecipient: "Cedar Properties LLC",
    paymentDueDay: 3,
    paymentNotes: "Wire transfer by 3rd. Include property ID P4 in memo.",
    bankName: "Chase Bank",
    bankRouting: "021000021",
    bankAccount: "9900556677",
    portalUrl: "",
    notes: "Best rate in portfolio. Lease up for renewal Dec 2025.",
    furnishings: [
      "Queen beds", "King beds", "Mattresses", "Mattress protectors", "Pillows", "Bedding & linens",
      "Nightstands", "Dressers", "Wardrobes / Closets", "Desk", "Desk chair", "Reading lamps",
      "Sofa / Couch", "Loveseat", "Armchairs", "Coffee table", "End tables", "Area rug", "Curtains / Blinds",
      "Refrigerator", "Freezer", "Stove / Range", "Oven", "Microwave", "Dishwasher",
      "Coffee maker", "Toaster", "Kettle", "Cookware set", "Dinnerware", "Utensils & cutlery", "Trash can",
      "Dining table", "Dining chairs", "Bar stools",
      "Towels", "Shower curtain", "Bath mat", "Hair dryer",
      "Washing machine", "Dryer", "Iron", "Ironing board",
      "Central A/C", "Central heating", "Ceiling fans", "Smart thermostat",
      "Wi-Fi", "Smart TV", "Streaming device", "Sound system",
      "Smoke detectors", "Carbon monoxide detectors", "Fire extinguisher", "First aid kit", "Security system", "Smart locks",
      "Patio furniture", "Grill / BBQ", "Yard / Garden",
      "Gym / Fitness center", "Swimming pool", "Game room", "Parking", "Garage", "Bike storage",
      "Vacuum cleaner", "Mop", "Broom", "Cleaning supplies",
    ],
    ratings: { landlord: 5, cleanliness: 5, amenities: 4, occupants: 4, location: 3, valueForMoney: 5 },
  },
  {
    id: "p5",
    customerId: "c3",
    name: "Elm Court",
    address: "500 Elm Rd",
    city: "Houston",
    state: "TX",
    zip: "77001",
    totalBeds: 6,
    monthlyRent: 3000,
    chargePerBed: 1000,
    status: "Inactive",
    landlordName: "Tom Walters",
    landlordEmail: "tom.walters@elmcourt.com",
    landlordPhone: "713-555-0505",
    paymentMethod: "ACH",
    paymentRecipient: "Elm Court Properties",
    paymentDueDay: 1,
    paymentNotes: "On hold — property temporarily inactive.",
    bankName: "Wells Fargo",
    bankRouting: "121000248",
    bankAccount: "1122334455",
    portalUrl: "",
    notes: "Currently inactive. Renovation underway. Expected reopening Q3 2025.",
    furnishings: [
      "Single beds", "Mattresses", "Pillows", "Bedding & linens",
      "Refrigerator", "Stove / Range",
      "Cookware set", "Dinnerware",
      "Smoke detectors", "Fire extinguisher",
    ],
  },
];

const NAMES = [
  "Marcus Johnson", "Priya Sharma", "Tyler Brooks", "Ana Reyes", "Devon Carter",
  "Lena Okafor", "James Wu", "Sofia Diaz", "Elijah Grant", "Mei Lin",
  "Noah Barnes", "Aisha Patel", "Carlos Mendes", "Zoe Fischer", "Dante Mills",
  "Ingrid Sorensen", "Kwame Asante", "Ruby Chen", "Micah Torres", "Nadia Kovacs",
  "Felix Martin", "Camille Dubois", "Jerome Hayes", "Leila Hassan", "Bryce Coleman",
  "Yuki Tanaka", "Amara Ndiaye", "Owen Russell", "Paloma Vega", "Isaac King",
  "Rania Ahmed", "Connor Walsh", "Fatima Ouedraogo", "Patrick Adeyemi", "Eva Novak",
];
const COMPANIES = ["Staffco Inc", "BuildRight LLC", "TalentBridge", "ForceWorks", "NexaStaff"];

interface RoomLayout {
  /** Position-based room id within the property (1..n). */
  index: number;
  name: string;
  sqft: number;
  bathrooms: number;
  monthlyRent: number;
  /** How many beds live in this room. */
  beds: number;
}

interface PropertyLayout {
  propertyId: string;
  occupied: number;
  rooms: RoomLayout[];
}

const PROPERTY_LAYOUTS: PropertyLayout[] = [
  {
    propertyId: "p1",
    occupied: 8,
    rooms: [
      { index: 1, name: "Master Suite",  sqft: 220, bathrooms: 1,   monthlyRent: 1200, beds: 2 },
      { index: 2, name: "Bedroom 2",     sqft: 160, bathrooms: 0.5, monthlyRent: 950,  beds: 2 },
      { index: 3, name: "Bedroom 3",     sqft: 150, bathrooms: 0.5, monthlyRent: 900,  beds: 2 },
      { index: 4, name: "Bedroom 4",     sqft: 140, bathrooms: 0,   monthlyRent: 850,  beds: 2 },
      { index: 5, name: "Loft",          sqft: 180, bathrooms: 0,   monthlyRent: 900,  beds: 2 },
    ],
  },
  {
    propertyId: "p2",
    occupied: 10,
    rooms: [
      { index: 1, name: "Bunk Room A",   sqft: 200, bathrooms: 1,   monthlyRent: 1050, beds: 2 },
      { index: 2, name: "Bunk Room B",   sqft: 200, bathrooms: 1,   monthlyRent: 1050, beds: 2 },
      { index: 3, name: "Bunk Room C",   sqft: 180, bathrooms: 0.5, monthlyRent: 950,  beds: 2 },
      { index: 4, name: "Bunk Room D",   sqft: 180, bathrooms: 0.5, monthlyRent: 950,  beds: 2 },
      { index: 5, name: "Bunk Room E",   sqft: 160, bathrooms: 0,   monthlyRent: 850,  beds: 2 },
      { index: 6, name: "Bunk Room F",   sqft: 160, bathrooms: 0,   monthlyRent: 850,  beds: 2 },
    ],
  },
  {
    propertyId: "p3",
    occupied: 6,
    rooms: [
      { index: 1, name: "Bedroom 1",     sqft: 170, bathrooms: 1,   monthlyRent: 1100, beds: 2 },
      { index: 2, name: "Bedroom 2",     sqft: 150, bathrooms: 0.5, monthlyRent: 950,  beds: 2 },
      { index: 3, name: "Bedroom 3",     sqft: 150, bathrooms: 0,   monthlyRent: 900,  beds: 2 },
      { index: 4, name: "Bedroom 4",     sqft: 140, bathrooms: 0,   monthlyRent: 850,  beds: 2 },
    ],
  },
  {
    propertyId: "p4",
    occupied: 12,
    rooms: [
      { index: 1, name: "Suite A",       sqft: 280, bathrooms: 1,   monthlyRent: 1500, beds: 3 },
      { index: 2, name: "Suite B",       sqft: 280, bathrooms: 1,   monthlyRent: 1500, beds: 3 },
      { index: 3, name: "Bunk Room C",   sqft: 220, bathrooms: 0.5, monthlyRent: 1200, beds: 3 },
      { index: 4, name: "Bunk Room D",   sqft: 220, bathrooms: 0.5, monthlyRent: 1200, beds: 3 },
      { index: 5, name: "Loft",          sqft: 200, bathrooms: 0,   monthlyRent: 1100, beds: 3 },
    ],
  },
  {
    propertyId: "p5",
    occupied: 0,
    rooms: [
      { index: 1, name: "Bedroom 1",     sqft: 160, bathrooms: 1,   monthlyRent: 950,  beds: 2 },
      { index: 2, name: "Bedroom 2",     sqft: 150, bathrooms: 0.5, monthlyRent: 900,  beds: 2 },
      { index: 3, name: "Bedroom 3",     sqft: 150, bathrooms: 0,   monthlyRent: 850,  beds: 2 },
    ],
  },
];

function buildRoomsBedsAndOccupants(): {
  rooms: InsertRoomRow[];
  beds: InsertBedRow[];
  occupants: InsertOccupantRow[];
} {
  const rooms: InsertRoomRow[] = [];
  const beds: InsertBedRow[] = [];
  const occupants: InsertOccupantRow[] = [];
  let nameIdx = 0;

  for (const { propertyId, occupied, rooms: roomDefs } of PROPERTY_LAYOUTS) {
    const prop = SEED_PROPERTIES.find((p) => p.id === propertyId)!;

    let bedCounter = 0;
    for (const roomDef of roomDefs) {
      const roomId = `r_${propertyId}_${roomDef.index}`;
      rooms.push({
        id: roomId,
        propertyId,
        name: roomDef.name,
        sqft: roomDef.sqft,
        bathrooms: roomDef.bathrooms,
        monthlyRent: roomDef.monthlyRent,
      });

      for (let i = 0; i < roomDef.beds; i++) {
        bedCounter += 1;
        const bedNumber = bedCounter;
        const isOccupied = bedNumber <= occupied;
        const bedId = `b_${propertyId}_${bedNumber}`;
        const occupantId = isOccupied ? `o_${propertyId}_${bedNumber}` : null;

        beds.push({
          id: bedId,
          propertyId,
          bedNumber,
          roomId,
          status: isOccupied ? "Occupied" : "Vacant",
          occupantId,
        });

        if (isOccupied && occupantId) {
          const name = NAMES[nameIdx % NAMES.length];
          nameIdx++;
          occupants.push({
            id: occupantId,
            name,
            email: `${name.split(" ")[0].toLowerCase()}@${propertyId}.worker.com`,
            phone: `512-555-${String(1000 + nameIdx).slice(-4)}`,
            bedId,
            propertyId,
            moveInDate: "2024-01-15",
            moveOutDate: null,
            status: "Active",
            chargePerBed: prop.chargePerBed ?? 0,
            billingFrequency: "Monthly",
            employeeId: `EMP-${String(1000 + nameIdx).slice(-4)}`,
            company: COMPANIES[nameIdx % COMPANIES.length],
          });
        }
      }
    }
  }
  return { rooms, beds, occupants };
}

const SEED_LEASES: InsertLeaseRow[] = [
  { id: "l1", propertyId: "p1", startDate: "2024-01-01", endDate: "2025-12-31", monthlyRent: 4800, securityDeposit: 9600, status: "Active",   notes: "2-year term. Auto-renews with 60-day notice." },
  { id: "l2", propertyId: "p2", startDate: "2024-06-01", endDate: "2025-05-31", monthlyRent: 5400, securityDeposit: 10800, status: "Active",  notes: "Utilities included except internet." },
  { id: "l3", propertyId: "p3", startDate: "2022-01-01", endDate: "2023-12-31", monthlyRent: 3600, securityDeposit: 7200, status: "Expired",  notes: "Expired. In renegotiation for renewal." },
  { id: "l4", propertyId: "p3", startDate: "2024-03-01", endDate: "2026-02-28", monthlyRent: 3800, securityDeposit: 7600, status: "Active",   notes: "Renewed at slightly higher rate." },
  { id: "l5", propertyId: "p4", startDate: "2024-01-01", endDate: "2025-12-31", monthlyRent: 7500, securityDeposit: 15000, status: "Active",  notes: "Best rate secured. Locked in 2 years." },
  { id: "l6", propertyId: "p5", startDate: "2025-09-01", endDate: "2026-08-31", monthlyRent: 3000, securityDeposit: 6000, status: "Upcoming", notes: "Lease signed for reopening post-renovation." },
];

const SEED_UTILITIES: InsertUtilityRow[] = [
  { id: "u-p1-elec", propertyId: "p1", type: "Electric", company: "Austin Energy",         monthlyCost: 220, accountNumber: "AE-110234",  notes: "Avg based on last 6 months" },
  { id: "u-p1-gas",  propertyId: "p1", type: "Gas",      company: "Atmos Energy",          monthlyCost: 85,  accountNumber: "AT-559812",  notes: "" },
  { id: "u-p1-water",propertyId: "p1", type: "Water",    company: "Austin Water",          monthlyCost: 95,  accountNumber: "AW-334410",  notes: "" },
  { id: "u-p1-garb", propertyId: "p1", type: "Garbage",  company: "Republic Services",     monthlyCost: 45,  accountNumber: "RS-00192",   notes: "Pickup every Tuesday" },
  { id: "u-p1-inet", propertyId: "p1", type: "Internet", company: "AT&T Fiber",            monthlyCost: 99,  accountNumber: "ATT-8821100",notes: "1Gbps plan" },

  { id: "u-p2-elec", propertyId: "p2", type: "Electric", company: "Austin Energy",         monthlyCost: 260, accountNumber: "AE-220345",  notes: "" },
  { id: "u-p2-gas",  propertyId: "p2", type: "Gas",      company: "Atmos Energy",          monthlyCost: 90,  accountNumber: "AT-661023",  notes: "" },
  { id: "u-p2-water",propertyId: "p2", type: "Water",    company: "Austin Water",          monthlyCost: 110, accountNumber: "AW-441520",  notes: "Included in lease — tracking only" },
  { id: "u-p2-garb", propertyId: "p2", type: "Garbage",  company: "Republic Services",     monthlyCost: 45,  accountNumber: "RS-00193",   notes: "" },

  { id: "u-p3-elec", propertyId: "p3", type: "Electric", company: "Oncor / TXU",           monthlyCost: 190, accountNumber: "TXU-773410", notes: "" },
  { id: "u-p3-prop", propertyId: "p3", type: "Propane",  company: "AmeriGas",              monthlyCost: 130, accountNumber: "AG-44512",   notes: "Tank refill ~monthly in winter" },
  { id: "u-p3-water",propertyId: "p3", type: "Water",    company: "Dallas Water",          monthlyCost: 80,  accountNumber: "DW-002211",  notes: "" },
  { id: "u-p3-garb", propertyId: "p3", type: "Garbage",  company: "Waste Management",      monthlyCost: 50,  accountNumber: "WM-55301",   notes: "" },
  { id: "u-p3-inet", propertyId: "p3", type: "Internet", company: "Spectrum",              monthlyCost: 89,  accountNumber: "SP-221004",  notes: "" },

  { id: "u-p4-elec", propertyId: "p4", type: "Electric", company: "Oncor / TXU",           monthlyCost: 340, accountNumber: "TXU-884521", notes: "" },
  { id: "u-p4-gas",  propertyId: "p4", type: "Gas",      company: "Atmos Energy",          monthlyCost: 120, accountNumber: "AT-772134",  notes: "" },
  { id: "u-p4-water",propertyId: "p4", type: "Water",    company: "Dallas Water",          monthlyCost: 145, accountNumber: "DW-003312",  notes: "" },
  { id: "u-p4-garb", propertyId: "p4", type: "Garbage",  company: "Waste Management",      monthlyCost: 65,  accountNumber: "WM-55302",   notes: "Two bins, picked up Wednesday" },
  { id: "u-p4-inet", propertyId: "p4", type: "Internet", company: "Spectrum",              monthlyCost: 89,  accountNumber: "SP-221005",  notes: "" },

  { id: "u-p5-elec", propertyId: "p5", type: "Electric", company: "CenterPoint",           monthlyCost: 160, accountNumber: "CP-990011",  notes: "Property inactive — minimal draw" },
  { id: "u-p5-prop", propertyId: "p5", type: "Propane",  company: "Ferrellgas",            monthlyCost: 95,  accountNumber: "FG-112233",  notes: "" },
  { id: "u-p5-water",propertyId: "p5", type: "Water",    company: "Houston Water",         monthlyCost: 70,  accountNumber: "HW-445600",  notes: "" },
  { id: "u-p5-garb", propertyId: "p5", type: "Garbage",  company: "Republic Services",     monthlyCost: 45,  accountNumber: "RS-00194",   notes: "" },
];

interface DataBundle {
  customers: InsertCustomerRow[];
  properties: InsertPropertyRow[];
  leases: InsertLeaseRow[];
  rooms: InsertRoomRow[];
  beds: InsertBedRow[];
  occupants: InsertOccupantRow[];
  utilities: InsertUtilityRow[];
}

async function wipeAll(): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(bedsTable);
    await tx.delete(occupantsTable);
    await tx.delete(leasesTable);
    await tx.delete(utilitiesTable);
    await tx.delete(roomsTable);
    await tx.delete(propertiesTable);
    await tx.delete(customersTable);
  });
}

async function insertBundle(bundle: DataBundle): Promise<void> {
  // Defensive normalization: any imported / seeded lease may carry a stray
  // time component on its dates (e.g. "2026-05-31 00:00:00"). Strip it here
  // so the renewal calculator on the frontend never sees a malformed value.
  const normalizedLeases = bundle.leases.map((lease) =>
    normalizeLeaseDates(lease),
  );
  await db.transaction(async (tx) => {
    if (bundle.customers.length > 0) await tx.insert(customersTable).values(bundle.customers);
    if (bundle.properties.length > 0) await tx.insert(propertiesTable).values(bundle.properties);
    if (normalizedLeases.length > 0) await tx.insert(leasesTable).values(normalizedLeases);
    if (bundle.rooms.length > 0) await tx.insert(roomsTable).values(bundle.rooms);
    if (bundle.occupants.length > 0) await tx.insert(occupantsTable).values(bundle.occupants);
    if (bundle.beds.length > 0) await tx.insert(bedsTable).values(bundle.beds);
    if (bundle.utilities.length > 0) await tx.insert(utilitiesTable).values(bundle.utilities);
  });
}

/**
 * Strip any stray time component from existing `start_date` / `end_date`
 * values in the leases table.
 *
 * Earlier versions of the spreadsheet importer stored dates with a trailing
 * `" 00:00:00"` (or similar) suffix. Those rows render as "NaN days left"
 * and silently disappear from the Renewal Alerts panel. This is a one-shot,
 * idempotent cleanup that runs at startup; once every row is normalized the
 * UPDATE matches zero rows and is effectively a no-op.
 *
 * Returns the number of rows that were actually rewritten so callers can
 * log a meaningful summary.
 */
export async function cleanupLeaseDates(): Promise<number> {
  const result = await db.execute<{ id: string }>(sql`
    UPDATE leases
    SET
      start_date = split_part(split_part(start_date, ' ', 1), 'T', 1),
      end_date = split_part(split_part(end_date, ' ', 1), 'T', 1)
    WHERE start_date ~ '[ T]' OR end_date ~ '[ T]'
    RETURNING id
  `);
  const rows = (result as unknown as { rows?: Array<{ id: string }> }).rows;
  const count = Array.isArray(rows) ? rows.length : 0;
  if (count > 0) {
    logger.info({ count }, "Normalized lease date column(s) to YYYY-MM-DD");
  }
  return count;
}

function buildSeedBundle(): DataBundle {
  const { rooms, beds, occupants } = buildRoomsBedsAndOccupants();
  return {
    customers: SEED_CUSTOMERS,
    properties: SEED_PROPERTIES,
    leases: SEED_LEASES,
    rooms,
    beds,
    occupants,
    utilities: SEED_UTILITIES,
  };
}

export async function seedIfEmpty(): Promise<void> {
  const existing = await db.select({ id: propertiesTable.id }).from(propertiesTable).limit(1);
  if (existing.length > 0) {
    logger.info("Database already seeded; skipping seed.");
    return;
  }

  logger.info("Seeding database with sample housing data…");
  const bundle = buildSeedBundle();
  await insertBundle(bundle);
  logger.info(
    {
      customers: bundle.customers.length,
      properties: bundle.properties.length,
      leases: bundle.leases.length,
      rooms: bundle.rooms.length,
      beds: bundle.beds.length,
      occupants: bundle.occupants.length,
      utilities: bundle.utilities.length,
    },
    "Seed complete.",
  );
}

export async function resetToSampleData(): Promise<void> {
  logger.info("Resetting database to sample data…");
  await wipeAll();
  const bundle = buildSeedBundle();
  await insertBundle(bundle);
  logger.info("Reset complete.");
}

export async function replaceAllData(bundle: DataBundle): Promise<void> {
  logger.info(
    {
      customers: bundle.customers.length,
      properties: bundle.properties.length,
      leases: bundle.leases.length,
      rooms: bundle.rooms.length,
      beds: bundle.beds.length,
      occupants: bundle.occupants.length,
      utilities: bundle.utilities.length,
    },
    "Replacing all data with imported bundle…",
  );
  await wipeAll();
  await insertBundle(bundle);
  logger.info("Import complete.");
}
