export type Customer = { id: string; name: string; shortName: string };

export type Property = {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  customerId: string;
  status: "Active" | "Inactive";
  totalBeds: number;
  occupied: number;
  vacant: number;
  rentPerBed: number;
  electricPerBed: number;
  totalRent: number;
  rating: number;
  ratings: {
    landlord: number;
    cleanliness: number;
    amenities: number;
    occupants: number;
    location: number;
    valueForMoney: number;
  };
  leaseEndDays: number | null;
  thumbnailHue: number;
  trend: number[];
};

export type Lease = {
  id: string;
  propertyName: string;
  customer: string;
  startDate: string;
  endDate: string;
  monthlyRent: number;
  status: "Active" | "Pending" | "Expiring" | "Needs review";
  daysToEnd: number | null;
};

export type Occupant = {
  id: string;
  name: string;
  employer: string;
  bed: string;
  property: string;
  moveIn: string;
  shift: "Day" | "Night" | "Swing";
};

export type PayrollRow = {
  id: string;
  employee: string;
  employer: string;
  week: string;
  hours: number;
  rate: number;
  charge: number;
  matched: boolean;
};

export type MoveInRow = {
  id: string;
  occupant: string;
  property: string;
  bed: string;
  date: string;
  daysAway: number;
  shift: "Day" | "Night" | "Swing";
};

export const customers: Customer[] = [
  { id: "c1", name: "Atlas Logistics", shortName: "Atlas" },
  { id: "c2", name: "North Star Foods", shortName: "North Star" },
  { id: "c3", name: "Cedar Manufacturing", shortName: "Cedar Mfg" },
  { id: "c4", name: "Harbor Freight Co.", shortName: "Harbor" },
];

export const properties: Property[] = [
  {
    id: "p1",
    name: "Magnolia Court",
    address: "412 Magnolia St",
    city: "Mobile",
    state: "AL",
    customerId: "c1",
    status: "Active",
    totalBeds: 12,
    occupied: 11,
    vacant: 1,
    rentPerBed: 285,
    electricPerBed: 42,
    totalRent: 3420,
    rating: 4.6,
    ratings: { landlord: 5, cleanliness: 4, amenities: 5, occupants: 4, location: 5, valueForMoney: 5 },
    leaseEndDays: 124,
    thumbnailHue: 216,
    trend: [8, 9, 10, 10, 11, 11, 11],
  },
  {
    id: "p2",
    name: "Riverside House",
    address: "88 Riverbend Dr",
    city: "Mobile",
    state: "AL",
    customerId: "c1",
    status: "Active",
    totalBeds: 8,
    occupied: 6,
    vacant: 2,
    rentPerBed: 312,
    electricPerBed: 38,
    totalRent: 2496,
    rating: 4.1,
    ratings: { landlord: 4, cleanliness: 4, amenities: 4, occupants: 4, location: 5, valueForMoney: 4 },
    leaseEndDays: 38,
    thumbnailHue: 200,
    trend: [7, 7, 7, 6, 6, 6, 6],
  },
  {
    id: "p3",
    name: "Oak Ridge",
    address: "1240 Oak Ridge Rd",
    city: "Theodore",
    state: "AL",
    customerId: "c2",
    status: "Active",
    totalBeds: 16,
    occupied: 16,
    vacant: 0,
    rentPerBed: 268,
    electricPerBed: 45,
    totalRent: 4288,
    rating: 4.9,
    ratings: { landlord: 5, cleanliness: 5, amenities: 5, occupants: 5, location: 4, valueForMoney: 5 },
    leaseEndDays: 256,
    thumbnailHue: 180,
    trend: [12, 13, 14, 15, 16, 16, 16],
  },
  {
    id: "p4",
    name: "Spring Hollow",
    address: "203 Spring Hollow Ln",
    city: "Saraland",
    state: "AL",
    customerId: "c2",
    status: "Active",
    totalBeds: 10,
    occupied: 7,
    vacant: 3,
    rentPerBed: 295,
    electricPerBed: 40,
    totalRent: 2950,
    rating: 3.8,
    ratings: { landlord: 4, cleanliness: 3, amenities: 4, occupants: 4, location: 4, valueForMoney: 4 },
    leaseEndDays: 14,
    thumbnailHue: 217,
    trend: [9, 8, 8, 7, 7, 7, 7],
  },
  {
    id: "p5",
    name: "Birchwood Annex",
    address: "55 Birchwood Ave",
    city: "Mobile",
    state: "AL",
    customerId: "c3",
    status: "Active",
    totalBeds: 6,
    occupied: 5,
    vacant: 1,
    rentPerBed: 330,
    electricPerBed: 36,
    totalRent: 1980,
    rating: 4.3,
    ratings: { landlord: 4, cleanliness: 5, amenities: 4, occupants: 4, location: 5, valueForMoney: 4 },
    leaseEndDays: 72,
    thumbnailHue: 195,
    trend: [4, 5, 5, 5, 5, 5, 5],
  },
  {
    id: "p6",
    name: "Pinecrest Lodge",
    address: "910 Pinecrest Pkwy",
    city: "Daphne",
    state: "AL",
    customerId: "c3",
    status: "Inactive",
    totalBeds: 14,
    occupied: 0,
    vacant: 14,
    rentPerBed: 0,
    electricPerBed: 0,
    totalRent: 0,
    rating: 3.5,
    ratings: { landlord: 3, cleanliness: 4, amenities: 3, occupants: 0, location: 4, valueForMoney: 3 },
    leaseEndDays: null,
    thumbnailHue: 210,
    trend: [10, 8, 6, 4, 2, 0, 0],
  },
  {
    id: "p7",
    name: "Harbor Point",
    address: "1 Harbor Point Dr",
    city: "Bayou La Batre",
    state: "AL",
    customerId: "c4",
    status: "Active",
    totalBeds: 9,
    occupied: 8,
    vacant: 1,
    rentPerBed: 305,
    electricPerBed: 41,
    totalRent: 2745,
    rating: 4.4,
    ratings: { landlord: 4, cleanliness: 5, amenities: 4, occupants: 4, location: 5, valueForMoney: 4 },
    leaseEndDays: 196,
    thumbnailHue: 188,
    trend: [6, 7, 7, 8, 8, 8, 8],
  },
];

export const leases: Lease[] = [
  { id: "l1", propertyName: "Magnolia Court", customer: "Atlas Logistics", startDate: "2025-09-01", endDate: "2026-08-31", monthlyRent: 3420, status: "Active", daysToEnd: 124 },
  { id: "l2", propertyName: "Riverside House", customer: "Atlas Logistics", startDate: "2025-06-15", endDate: "2026-06-14", monthlyRent: 2496, status: "Expiring", daysToEnd: 38 },
  { id: "l3", propertyName: "Oak Ridge", customer: "North Star Foods", startDate: "2025-11-01", endDate: "2026-10-31", monthlyRent: 4288, status: "Active", daysToEnd: 256 },
  { id: "l4", propertyName: "Spring Hollow", customer: "North Star Foods", startDate: "2025-08-01", endDate: "2026-05-31", monthlyRent: 2950, status: "Expiring", daysToEnd: 14 },
  { id: "l5", propertyName: "Birchwood Annex", customer: "Cedar Manufacturing", startDate: "2025-10-15", endDate: "2026-07-14", monthlyRent: 1980, status: "Active", daysToEnd: 72 },
  { id: "l6", propertyName: "Harbor Point", customer: "Harbor Freight Co.", startDate: "2025-12-01", endDate: "2026-11-30", monthlyRent: 2745, status: "Active", daysToEnd: 196 },
  { id: "l7", propertyName: "Pinecrest Lodge", customer: "Cedar Manufacturing", startDate: "2025-07-01", endDate: "2026-06-30", monthlyRent: 0, status: "Needs review", daysToEnd: null },
];

export const projectedMoveIns: MoveInRow[] = [
  { id: "m1", occupant: "Marcus Greene", property: "Magnolia Court", bed: "MG-04B", date: "2026-05-22", daysAway: 2, shift: "Day" },
  { id: "m2", occupant: "Aisha Patel", property: "Oak Ridge", bed: "OR-11A", date: "2026-05-23", daysAway: 3, shift: "Night" },
  { id: "m3", occupant: "Diego Romero", property: "Spring Hollow", bed: "SH-02C", date: "2026-05-24", daysAway: 4, shift: "Day" },
  { id: "m4", occupant: "Lina Okafor", property: "Riverside House", bed: "RH-06B", date: "2026-05-25", daysAway: 5, shift: "Swing" },
  { id: "m5", occupant: "Tariq Jamal", property: "Harbor Point", bed: "HP-08A", date: "2026-05-26", daysAway: 6, shift: "Day" },
];

export const unplacedPayroll: PayrollRow[] = [
  { id: "u1", employee: "R. Coleman", employer: "Atlas Logistics", week: "May 16", hours: 44, rate: 22.5, charge: 990, matched: false },
  { id: "u2", employee: "S. Nguyen", employer: "North Star Foods", week: "May 16", hours: 40, rate: 24.0, charge: 960, matched: false },
  { id: "u3", employee: "K. Bishara", employer: "Cedar Mfg.", week: "May 16", hours: 38, rate: 21.0, charge: 798, matched: false },
  { id: "u4", employee: "J. Pemberton", employer: "Atlas Logistics", week: "May 16", hours: 41, rate: 22.5, charge: 922, matched: true },
];

export const occupants: Occupant[] = [
  { id: "o1", name: "Marcus Greene", employer: "Atlas Logistics", bed: "MG-04B", property: "Magnolia Court", moveIn: "2026-05-22", shift: "Day" },
  { id: "o2", name: "Aisha Patel", employer: "North Star Foods", bed: "OR-11A", property: "Oak Ridge", moveIn: "2026-05-23", shift: "Night" },
  { id: "o3", name: "Diego Romero", employer: "North Star Foods", bed: "SH-02C", property: "Spring Hollow", moveIn: "2026-05-24", shift: "Day" },
  { id: "o4", name: "Lina Okafor", employer: "Atlas Logistics", bed: "RH-06B", property: "Riverside House", moveIn: "2026-05-25", shift: "Swing" },
  { id: "o5", name: "Tariq Jamal", employer: "Harbor Freight Co.", bed: "HP-08A", property: "Harbor Point", moveIn: "2026-05-26", shift: "Day" },
  { id: "o6", name: "Yuki Tanaka", employer: "Cedar Manufacturing", bed: "BA-03A", property: "Birchwood Annex", moveIn: "2026-04-18", shift: "Day" },
];

export const kpis = {
  activeProperties: 6,
  totalBeds: 75,
  occupied: 53,
  occupancyPct: 70.7,
  monthlyRent: 17_879,
  monthlyElectric: 2_843,
  expiringSoon: 2,
  needsReview: 1,
  occupantsCount: occupants.length,
  payrollUnmatched: 3,
};

export const navItems = [
  { id: "dashboard", label: "Dashboard", icon: "LayoutDashboard" },
  { id: "customers", label: "Customers", icon: "Briefcase" },
  { id: "properties", label: "Properties", icon: "Home", active: true },
  { id: "leases", label: "Leases", icon: "KeyRound" },
  { id: "beds", label: "Beds", icon: "BedDouble" },
  { id: "occupants", label: "Occupants", icon: "Users" },
  { id: "utilities", label: "Utilities", icon: "Zap" },
  { id: "finance", label: "Finance", icon: "DollarSign" },
  { id: "insurance", label: "Insurance", icon: "ShieldCheck" },
  { id: "settings", label: "Settings", icon: "Settings" },
];

export const tokens = {
  primary: "217 71% 21%",
  sidebar: "216 62% 22%",
  sidebarBorder: "216 50% 30%",
  sidebarPrimary: "217 75% 55%",
  chart1: "217 71% 21%",
  chart2: "217 75% 45%",
  chart3: "200 80% 42%",
  chart4: "180 55% 38%",
  chart5: "217 40% 65%",
};

export const propertyDetail = {
  property: properties[0],
  customer: customers[0],
  beds: [
    { id: "b1", label: "MG-01A", occupant: "Carlos Reyes", rate: 285, status: "Occupied" },
    { id: "b2", label: "MG-01B", occupant: "Trevor Hill", rate: 285, status: "Occupied" },
    { id: "b3", label: "MG-02A", occupant: "Mike Sandoval", rate: 285, status: "Occupied" },
    { id: "b4", label: "MG-02B", occupant: null, rate: 285, status: "Vacant" },
    { id: "b5", label: "MG-03A", occupant: "Daniel Kim", rate: 285, status: "Occupied" },
    { id: "b6", label: "MG-03B", occupant: "James Park", rate: 285, status: "Occupied" },
    { id: "b7", label: "MG-04A", occupant: "Marcus Greene", rate: 285, status: "Pending" },
    { id: "b8", label: "MG-04B", occupant: "Eli Vasquez", rate: 285, status: "Occupied" },
  ],
  finance: {
    monthlyRent: 3420,
    monthlyElectric: 504,
    perBedRent: 285,
    perBedElectric: 42,
    last6: [3120, 3260, 3120, 3260, 3260, 3420],
  },
  ratings: properties[0].ratings,
  tabs: ["Overview", "Beds", "Leases", "Finance", "Utilities", "Notes"],
};
