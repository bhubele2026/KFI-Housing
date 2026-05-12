import { db } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  customersTable,
  propertiesTable,
  leasesTable,
  roomNightLogsTable,
  roomsTable,
  bedsTable,
  occupantsTable,
  utilitiesTable,
  otherCostsTable,
  insuranceCertificatesTable,
  propertyViolationsTable,
  schedulerStateTable,
  type InsertCustomerRow,
  type InsertPropertyRow,
  type InsertLeaseRow,
  type InsertBuildingRow,
  buildingsTable,
  type InsertRoomRow,
  type InsertBedRow,
  type InsertOccupantRow,
  type InsertUtilityRow,
  type InsertOtherCostRow,
  type InsertInsuranceCertificateRow,
  type InsertRoomNightLogRow,
} from "@workspace/db";
import { logger } from "./logger";
import { HOUSING_DEDUCTION_ROWS } from "./seed-housing-deductions";
import {
  normalizeOccupantRow,
  normalizeBedRow,
  normalizeUtilityRow,
} from "./db-row-normalizers";

// Re-exports of post-master-import seeds. Owning these from `seed.ts`
// keeps the boot-sequence integration point aligned with the rest of
// the seeding code: callers (`start.ts` / `index.ts`) only ever import
// from this module, and the boot ordering is documented here.
//
// Order on boot, after `seedIfEmpty()`:
//   1. seedAdientIfMissing       — task #271
//   2. seedPatriotBarabooIfMissing
//   3. seedAttachedLeasesIfMissing — task #287 (PDFs)
//   4. importMaster (#288)        — Housing_Lease_MASTER (when triggered)
//   5. seedRidgeMotorInnIfMissing — task #295 (Penda + Trienda shared
//                                   housing). Depends on Penda &
//                                   Trienda customers existing, which
//                                   come from #288. Skips with a
//                                   warning if they don't yet.
export { seedRidgeMotorInnIfMissing } from "./seed-ridge-motor-inn";

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
    lat: 30.2672,
    lng: -97.7431,
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
    lat: 30.2649,
    lng: -97.7185,
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
    lat: 32.7767,
    lng: -96.797,
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
    lat: 32.78,
    lng: -96.8005,
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
    lat: 29.7604,
    lng: -95.3698,
    furnishings: [
      "Single beds", "Mattresses", "Pillows", "Bedding & linens",
      "Refrigerator", "Stove / Range",
      "Cookware set", "Dinnerware",
      "Smoke detectors", "Fire extinguisher",
    ],
  },
];

// Source the synthetic occupant pool from the real payroll roster so a
// fresh seed mirrors production data: every seeded occupant gets a real
// name, the real customer in `company`, and the real `personId` in
// `employeeId`. This keeps Task #285's backfill / matcher invariants
// (no occupants with empty employeeId+company) holding from boot.
const PAYROLL_ROSTER = HOUSING_DEDUCTION_ROWS;

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
        // Default building per seeded property (Task #570). Mirrors
        // the deterministic id the migration uses so a fresh seed
        // and a backfilled DB land at the same building ids.
        buildingId: `bldg_${propertyId}_1`,
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
          const payroll = PAYROLL_ROSTER[nameIdx % PAYROLL_ROSTER.length];
          nameIdx++;
          const name = payroll.name;
          const firstName = name.split(" ")[0].toLowerCase();
          occupants.push({
            id: occupantId,
            name,
            email: `${firstName}@${propertyId}.worker.com`,
            phone: `512-555-${String(1000 + nameIdx).slice(-4)}`,
            bedId,
            propertyId,
            moveInDate: "2024-01-15",
            moveOutDate: null,
            status: "Active",
            chargePerBed: prop.chargePerBed ?? 0,
            billingFrequency: "Monthly",
            employeeId: payroll.personId,
            company: payroll.customer,
          });
        }
      }
    }
  }
  return { rooms, beds, occupants };
}

const SEED_LEASES: InsertLeaseRow[] = [
  {
    id: "l1", propertyId: "p1", startDate: "2024-01-01", endDate: "2025-12-31",
    monthlyRent: 4800, securityDeposit: 9600, status: "Active",
    notes: "2-year term. Auto-renews with 60-day notice.",
    clauses:
      "Tenant responsible for lawn care. No smoking inside. Pet deposit $500 per pet.",
    buyoutAvailable: true,
    buyoutCost: 9600,
  },
  {
    id: "l2", propertyId: "p2", startDate: "2024-06-01", endDate: "2025-05-31",
    monthlyRent: 5400, securityDeposit: 10800, status: "Active",
    notes: "Utilities included except internet.",
    clauses: "All utilities except internet are included. Quiet hours after 10pm.",
    buyoutAvailable: false,
    buyoutCost: null,
  },
  {
    id: "l3", propertyId: "p3", startDate: "2022-01-01", endDate: "2023-12-31",
    monthlyRent: 3600, securityDeposit: 7200, status: "Expired",
    notes: "Expired. In renegotiation for renewal.",
    clauses: "",
    buyoutAvailable: false,
    buyoutCost: null,
  },
  {
    id: "l4", propertyId: "p3", startDate: "2024-03-01", endDate: "2026-02-28",
    monthlyRent: 3800, securityDeposit: 7600, status: "Active",
    notes: "Renewed at slightly higher rate.",
    clauses: "Annual rent escalator capped at 3%. 30-day move-out notice.",
    buyoutAvailable: true,
    buyoutCost: 7600,
  },
  {
    id: "l5", propertyId: "p4", startDate: "2024-01-01", endDate: "2025-12-31",
    monthlyRent: 7500, securityDeposit: 15000, status: "Active",
    notes: "Best rate secured. Locked in 2 years.",
    clauses:
      "Two-year lock; right of first refusal on adjacent unit. Landlord covers HVAC service.",
    buyoutAvailable: false,
    buyoutCost: null,
  },
  {
    id: "l6", propertyId: "p5", startDate: "2025-09-01", endDate: "2026-08-31",
    monthlyRent: 3000, securityDeposit: 6000, status: "Upcoming",
    notes: "Lease signed for reopening post-renovation.",
    clauses: "Effective on certificate-of-occupancy issuance.",
    buyoutAvailable: true,
    buyoutCost: 4500,
  },
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
  // Buildings under each property (Task #570). Optional so callers
  // built before the buildings rollout keep compiling — treated as
  // `[]` when missing, and the migration's per-property default
  // building backfill provides a safety net at boot.
  buildings?: InsertBuildingRow[];
  leases: InsertLeaseRow[];
  rooms: InsertRoomRow[];
  beds: InsertBedRow[];
  occupants: InsertOccupantRow[];
  utilities: InsertUtilityRow[];
  // Optional so callers built before task #321 (and older v1/v2 backups
  // routed through `replaceAllData`) keep compiling. Treated as `[]`
  // when missing.
  roomNightLogs?: InsertRoomNightLogRow[];
  // Optional so callers built before task #333 (insurance-certificates
  // resource) keep compiling. Treated as `[]` when missing.
  insuranceCertificates?: InsertInsuranceCertificateRow[];
  // Optional so callers built before task #497 (rent-free / other
  // costs) keep compiling. Treated as `[]` when missing.
  otherCosts?: InsertOtherCostRow[];
}

/**
 * Marker row id stored in `scheduler_state` to record that an operator
 * has deliberately wiped the database (Task #486). When this row is
 * present with a non-empty `lastSentKey`, the boot-time auto-seeders
 * skip so an intentionally empty DB stays empty across restarts.
 *
 * The `scheduler_state` table is reused (rather than introducing a
 * new bookkeeping table) because it already exists for similar
 * "remember a small fact across boots" use cases (room-night reminder,
 * insurance-expiry reminder).
 */
export const AUTO_SEED_DISABLED_MARKER_ID = "auto-seed-disabled";

/**
 * Returns true when the auto-seed-disabled marker is present, meaning
 * an operator ran the wipe-only entry point and the boot sequence
 * should not refill the database with sample / Adient / Chateau Knoll
 * / payroll-occupant / master-file data on the next restart.
 */
export async function isAutoSeedDisabled(
  database: typeof db = db,
): Promise<boolean> {
  const rows = await database
    .select({ lastSentKey: schedulerStateTable.lastSentKey })
    .from(schedulerStateTable)
    .where(eq(schedulerStateTable.id, AUTO_SEED_DISABLED_MARKER_ID))
    .limit(1);
  if (rows.length === 0) return false;
  return (rows[0]?.lastSentKey ?? "") !== "";
}

async function setAutoSeedDisabledMarker(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
): Promise<void> {
  const wipedAt = new Date().toISOString();
  await tx
    .insert(schedulerStateTable)
    .values({ id: AUTO_SEED_DISABLED_MARKER_ID, lastSentKey: wipedAt })
    .onConflictDoUpdate({
      target: schedulerStateTable.id,
      set: { lastSentKey: wipedAt },
    });
}

async function clearAutoSeedDisabledMarker(): Promise<void> {
  await db
    .delete(schedulerStateTable)
    .where(eq(schedulerStateTable.id, AUTO_SEED_DISABLED_MARKER_ID));
}

// Single source of truth for the business-table wipe order. Both
// `wipeAll()` (legacy wipe+reseed) and `wipeAllOnly()` (Task #486
// wipe-only entry point) compose this so the wipe set never drifts
// between the two paths.
async function wipeAllInTx(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
): Promise<void> {
  await tx.delete(bedsTable);
  await tx.delete(occupantsTable);
  // Room-night logs reference leases by id — wipe before leases so a
  // future FK doesn't trip on cascade order. Today the column is a
  // plain `text` reference, but ordering future-proofs the wipe.
  await tx.delete(roomNightLogsTable);
  await tx.delete(leasesTable);
  await tx.delete(utilitiesTable);
  // Per-property recurring non-rent costs (Task #497). Wiped before
  // properties so a future FK on `property_id` would already see its
  // parent rows gone in the right order.
  await tx.delete(otherCostsTable);
  // Insurance certificates reference properties (and optionally
  // leases) by id — wipe before properties so a future FK doesn't
  // trip on cascade order.
  await tx.delete(insuranceCertificatesTable);
  // Property violations reference properties (and optionally
  // occupants) by id — wipe before properties so a future FK
  // doesn't trip on cascade order (Task #499).
  await tx.delete(propertyViolationsTable);
  await tx.delete(roomsTable);
  // Buildings reference properties by id; wipe before properties so
  // a future FK doesn't trip on cascade order (Task #570).
  await tx.delete(buildingsTable);
  await tx.delete(propertiesTable);
  await tx.delete(customersTable);
}

async function wipeAll(): Promise<void> {
  await db.transaction(async (tx) => {
    await wipeAllInTx(tx);
  });
}

async function insertBundle(bundle: DataBundle): Promise<void> {
  // The API boundary enforces a strict `^\d{4}-\d{2}-\d{2}$` regex on
  // lease `startDate` / `endDate` (see `lib/api-spec/openapi.yaml` ->
  // `LeaseDate`), the hard-coded SEED_LEASES below already use that
  // format, and the frontend `parseYMD` (in `lib/lease-dates.ts`) throws
  // loudly on anything else — there is no longer a quiet path that
  // could land a malformed date in this column, so we no longer
  // pre-normalize on insert.
  await db.transaction(async (tx) => {
    if (bundle.customers.length > 0) await tx.insert(customersTable).values(bundle.customers);
    if (bundle.properties.length > 0) await tx.insert(propertiesTable).values(bundle.properties);
    const buildings = bundle.buildings ?? [];
    if (buildings.length > 0) await tx.insert(buildingsTable).values(buildings);
    if (bundle.leases.length > 0) await tx.insert(leasesTable).values(bundle.leases);
    if (bundle.rooms.length > 0) await tx.insert(roomsTable).values(bundle.rooms);
    // Defence-in-depth: run bulk-imported occupant/bed/utility rows
    // through the boundary normalizer (Task #417) so a stray off-list
    // status / billingFrequency / utility type in a future bundle is
    // coerced to the canonical contract before it lands in the DB,
    // matching the API write paths.
    if (bundle.occupants.length > 0) {
      await tx
        .insert(occupantsTable)
        .values(bundle.occupants.map((r) => normalizeOccupantRow(r)));
    }
    if (bundle.beds.length > 0) {
      await tx
        .insert(bedsTable)
        .values(bundle.beds.map((r) => normalizeBedRow(r)));
    }
    if (bundle.utilities.length > 0) {
      await tx
        .insert(utilitiesTable)
        .values(bundle.utilities.map((r) => normalizeUtilityRow(r)));
    }
    // Inserted after leases so a future FK on `lease_id` would already
    // see its parent rows (today the column is a plain `text` ref).
    const logs = bundle.roomNightLogs ?? [];
    if (logs.length > 0) await tx.insert(roomNightLogsTable).values(logs);
    // Inserted after properties + leases for the same FK-friendliness
    // reason. Optional on legacy bundles.
    const certs = bundle.insuranceCertificates ?? [];
    if (certs.length > 0) await tx.insert(insuranceCertificatesTable).values(certs);
    // Inserted after properties for FK-friendliness (the column is a
    // plain `text` ref today; ordering future-proofs the insert).
    const otherCosts = bundle.otherCosts ?? [];
    if (otherCosts.length > 0) await tx.insert(otherCostsTable).values(otherCosts);
  });
}

function buildSeedBundle(): DataBundle {
  const { rooms, beds, occupants } = buildRoomsBedsAndOccupants();
  // One default building per seeded property, mirroring the
  // migration's backfill output so existing DB rows and a fresh seed
  // produce the same building ids (Task #570).
  const buildings: InsertBuildingRow[] = SEED_PROPERTIES.map((p) => ({
    id: `bldg_${p.id}_1`,
    propertyId: p.id,
    name: "Main building",
    address: p.address ?? "",
    city: p.city ?? "",
    state: p.state ?? "",
    zip: p.zip ?? "",
    notes: "",
  }));
  return {
    customers: SEED_CUSTOMERS,
    properties: SEED_PROPERTIES,
    buildings,
    leases: SEED_LEASES,
    rooms,
    beds,
    occupants,
    utilities: SEED_UTILITIES,
    roomNightLogs: [],
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
  // Clear the wipe marker so the next boot's auto-seeders run again.
  // Keeping the existing `POST /reset` semantics — wipe AND reseed —
  // means tests that already rely on it must come back to a populated,
  // self-healing state, not a permanently disabled one.
  await clearAutoSeedDisabledMarker();
  logger.info("Reset complete.");
}

/**
 * Wipe-only entry point (Task #486). Clears every business table the
 * app maintains (customers, properties, leases, utilities, beds,
 * occupants, rooms, room-night logs, insurance certificates) WITHOUT
 * reseeding sample data afterwards, and persists a marker in
 * `scheduler_state` so the boot-time auto-seeders skip on subsequent
 * restarts. Use this when an operator wants to start over and re-import
 * data customer by customer.
 *
 * Schema, migrations, scheduler state (other than the marker), digest
 * recipients, and the last-boot master-import bookkeeping row are
 * deliberately left alone — only row data on the business tables is
 * removed.
 */
export async function wipeAllOnly(): Promise<void> {
  logger.info("Wiping all business data (no reseed)…");
  await db.transaction(async (tx) => {
    await wipeAllInTx(tx);
    await setAutoSeedDisabledMarker(tx);
  });
  logger.info("Wipe complete; auto-seed disabled until the next reset.");
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
      roomNightLogs: bundle.roomNightLogs?.length ?? 0,
      insuranceCertificates: bundle.insuranceCertificates?.length ?? 0,
      otherCosts: bundle.otherCosts?.length ?? 0,
    },
    "Replacing all data with imported bundle…",
  );
  await wipeAll();
  await insertBundle(bundle);
  logger.info("Import complete.");
}
