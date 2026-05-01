import { z } from "zod";

export const PropertySchema = z.object({
  id: z.string(),
  name: z.string(),
  address: z.string(),
  city: z.string(),
  state: z.string(),
  zip: z.string(),
  totalBeds: z.number(),
  monthlyRent: z.number(),
  chargePerBed: z.number(),
  status: z.enum(["Active", "Inactive"]),
  landlordName: z.string(),
  landlordEmail: z.string(),
  landlordPhone: z.string(),
  paymentMethod: z.enum(["ACH", "Check", "Wire", "Online Portal", "Money Order"]),
  paymentRecipient: z.string(),
  paymentDueDay: z.number(),
  paymentNotes: z.string(),
  bankName: z.string(),
  bankRouting: z.string(),
  bankAccount: z.string(),
  portalUrl: z.string(),
  notes: z.string(),
});
export type Property = z.infer<typeof PropertySchema>;

export const LeaseSchema = z.object({
  id: z.string(),
  propertyId: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  monthlyRent: z.number(),
  securityDeposit: z.number(),
  status: z.enum(["Active", "Expired", "Upcoming"]),
  notes: z.string(),
});
export type Lease = z.infer<typeof LeaseSchema>;

export const BedSchema = z.object({
  id: z.string(),
  propertyId: z.string(),
  bedNumber: z.number(),
  room: z.string(),
  status: z.enum(["Occupied", "Vacant"]),
  occupantId: z.string().nullable(),
});
export type Bed = z.infer<typeof BedSchema>;

export const OccupantSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  phone: z.string(),
  bedId: z.string().nullable(),
  propertyId: z.string().nullable(),
  moveInDate: z.string(),
  moveOutDate: z.string().nullable(),
  status: z.enum(["Active", "Former"]),
  chargePerBed: z.number(),
  employeeId: z.string(),
  company: z.string(),
});
export type Occupant = z.infer<typeof OccupantSchema>;

export const UtilitySchema = z.object({
  id: z.string(),
  propertyId: z.string(),
  month: z.number(),
  year: z.number(),
  electric: z.number(),
  gas: z.number(),
  water: z.number(),
  internet: z.number(),
  trash: z.number(),
  other: z.number(),
  total: z.number(),
});
export type Utility = z.infer<typeof UtilitySchema>;

export const MOCK_PROPERTIES: Property[] = [
  {
    id: "p1",
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
    paymentNotes: "Auto-pay set up via bank. Confirmation email sent to billing@housingops.com.",
    bankName: "First National Bank",
    bankRouting: "021000021",
    bankAccount: "4400123456",
    portalUrl: "",
    notes: "Property manager prefers email contact. Parking included.",
  },
  {
    id: "p2",
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
  },
  {
    id: "p3",
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
    paymentNotes: "Mail check to PO Box 4401, Dallas TX 75201. Make out to Pine Homes Inc.",
    bankName: "",
    bankRouting: "",
    bankAccount: "",
    portalUrl: "",
    notes: "Requires 30-day notice before move-out of any occupant.",
  },
  {
    id: "p4",
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
  },
  {
    id: "p5",
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
  },
];

const names = [
  "Marcus Johnson", "Priya Sharma", "Tyler Brooks", "Ana Reyes", "Devon Carter",
  "Lena Okafor", "James Wu", "Sofia Diaz", "Elijah Grant", "Mei Lin",
  "Noah Barnes", "Aisha Patel", "Carlos Mendes", "Zoe Fischer", "Dante Mills",
  "Ingrid Sorensen", "Kwame Asante", "Ruby Chen", "Micah Torres", "Nadia Kovacs",
  "Felix Martin", "Camille Dubois", "Jerome Hayes", "Leila Hassan", "Bryce Coleman",
  "Yuki Tanaka", "Amara Ndiaye", "Owen Russell", "Paloma Vega", "Isaac King",
  "Rania Ahmed", "Connor Walsh", "Fatima Ouedraogo", "Patrick Adeyemi", "Eva Novak",
];

const companies = ["Staffco Inc", "BuildRight LLC", "TalentBridge", "ForceWorks", "NexaStaff"];

export const MOCK_BEDS: Bed[] = [
  ...Array.from({ length: 10 }, (_, i) => ({ id: `b_p1_${i + 1}`, propertyId: "p1", bedNumber: i + 1, room: `Room ${Math.ceil((i + 1) / 2)}`, status: (i < 8 ? "Occupied" : "Vacant") as "Occupied" | "Vacant", occupantId: i < 8 ? `o_p1_${i + 1}` : null })),
  ...Array.from({ length: 12 }, (_, i) => ({ id: `b_p2_${i + 1}`, propertyId: "p2", bedNumber: i + 1, room: `Room ${Math.ceil((i + 1) / 2)}`, status: (i < 10 ? "Occupied" : "Vacant") as "Occupied" | "Vacant", occupantId: i < 10 ? `o_p2_${i + 1}` : null })),
  ...Array.from({ length: 8 }, (_, i) => ({ id: `b_p3_${i + 1}`, propertyId: "p3", bedNumber: i + 1, room: `Room ${Math.ceil((i + 1) / 2)}`, status: (i < 6 ? "Occupied" : "Vacant") as "Occupied" | "Vacant", occupantId: i < 6 ? `o_p3_${i + 1}` : null })),
  ...Array.from({ length: 15 }, (_, i) => ({ id: `b_p4_${i + 1}`, propertyId: "p4", bedNumber: i + 1, room: `Room ${Math.ceil((i + 1) / 3)}`, status: (i < 12 ? "Occupied" : "Vacant") as "Occupied" | "Vacant", occupantId: i < 12 ? `o_p4_${i + 1}` : null })),
  ...Array.from({ length: 6 }, (_, i) => ({ id: `b_p5_${i + 1}`, propertyId: "p5", bedNumber: i + 1, room: `Room ${Math.ceil((i + 1) / 2)}`, status: "Vacant" as "Vacant", occupantId: null })),
];

let nameIdx = 0;
export const MOCK_OCCUPANTS: Occupant[] = MOCK_BEDS
  .filter(b => b.occupantId)
  .map((b) => {
    const prop = MOCK_PROPERTIES.find(p => p.id === b.propertyId)!;
    const name = names[nameIdx % names.length];
    nameIdx++;
    return {
      id: b.occupantId!,
      name,
      email: `${name.split(" ")[0].toLowerCase()}@${prop.id}.worker.com`,
      phone: `512-555-${String(1000 + nameIdx).slice(-4)}`,
      bedId: b.id,
      propertyId: b.propertyId,
      moveInDate: "2024-01-15",
      moveOutDate: null,
      status: "Active" as const,
      chargePerBed: prop.chargePerBed,
      employeeId: `EMP-${String(1000 + nameIdx).slice(-4)}`,
      company: companies[nameIdx % companies.length],
    };
  });

const round2 = (n: number) => Math.round(n * 100) / 100;

export const MOCK_LEASES: Lease[] = [
  { id: "l1", propertyId: "p1", startDate: "2024-01-01", endDate: "2025-12-31", monthlyRent: 4800, securityDeposit: 9600, status: "Active", notes: "2-year term. Auto-renews with 60-day notice." },
  { id: "l2", propertyId: "p2", startDate: "2024-06-01", endDate: "2025-05-31", monthlyRent: 5400, securityDeposit: 10800, status: "Active", notes: "Utilities included except internet." },
  { id: "l3", propertyId: "p3", startDate: "2022-01-01", endDate: "2023-12-31", monthlyRent: 3600, securityDeposit: 7200, status: "Expired", notes: "Expired. In renegotiation for renewal." },
  { id: "l4", propertyId: "p3", startDate: "2024-03-01", endDate: "2026-02-28", monthlyRent: 3800, securityDeposit: 7600, status: "Active", notes: "Renewed at slightly higher rate." },
  { id: "l5", propertyId: "p4", startDate: "2024-01-01", endDate: "2025-12-31", monthlyRent: 7500, securityDeposit: 15000, status: "Active", notes: "Best rate secured. Locked in 2 years." },
  { id: "l6", propertyId: "p5", startDate: "2025-09-01", endDate: "2026-08-31", monthlyRent: 3000, securityDeposit: 6000, status: "Upcoming", notes: "Lease signed for reopening post-renovation." },
];

export const MOCK_UTILITIES: Utility[] = MOCK_PROPERTIES.flatMap(p =>
  [1, 2, 3, 4].map(month => {
    const electric = round2(120 + Math.random() * 180);
    const gas = round2(40 + Math.random() * 60);
    const water = round2(60 + Math.random() * 50);
    const internet = 99.99;
    const trash = 45;
    const other = round2(Math.random() * 50);
    return {
      id: `u-${p.id}-2024-${month}`,
      propertyId: p.id,
      month,
      year: 2024,
      electric,
      gas,
      water,
      internet,
      trash,
      other,
      total: round2(electric + gas + water + internet + trash + other),
    };
  })
);
