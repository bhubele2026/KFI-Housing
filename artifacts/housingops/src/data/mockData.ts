import { z } from "zod";

export const PropertySchema = z.object({
  id: z.string(),
  name: z.string(),
  address: z.string(),
  city: z.string(),
  state: z.string(),
  totalBeds: z.number(),
  monthlyRent: z.number(),
  status: z.enum(["Active", "Inactive"]),
});
export type Property = z.infer<typeof PropertySchema>;

export const LeaseSchema = z.object({
  id: z.string(),
  propertyId: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  monthlyRent: z.number(),
  status: z.enum(["Active", "Expired", "Upcoming"]),
});
export type Lease = z.infer<typeof LeaseSchema>;

export const BedSchema = z.object({
  id: z.string(),
  propertyId: z.string(),
  bedNumber: z.number(),
  status: z.enum(["Occupied", "Vacant"]),
  occupantId: z.string().nullable(),
});
export type Bed = z.infer<typeof BedSchema>;

export const OccupantSchema = z.object({
  id: z.string(),
  name: z.string(),
  bedId: z.string().nullable(),
  propertyId: z.string().nullable(),
  moveInDate: z.string(),
  moveOutDate: z.string().nullable(),
  status: z.enum(["Active", "Former"]),
  chargePerBed: z.number(),
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
  total: z.number(),
});
export type Utility = z.infer<typeof UtilitySchema>;

export const MOCK_PROPERTIES: Property[] = [
  { id: "p1", name: "Oakwood Estates", address: "100 Oak Way", city: "Austin", state: "TX", totalBeds: 10, monthlyRent: 800, status: "Active" },
  { id: "p2", name: "Maple Lofts", address: "200 Maple Dr", city: "Austin", state: "TX", totalBeds: 12, monthlyRent: 750, status: "Active" },
  { id: "p3", name: "Pine View", address: "300 Pine St", city: "Dallas", state: "TX", totalBeds: 8, monthlyRent: 900, status: "Active" },
  { id: "p4", name: "Cedar Ridge", address: "400 Cedar Ln", city: "Dallas", state: "TX", totalBeds: 15, monthlyRent: 700, status: "Active" },
  { id: "p5", name: "Elm Court", address: "500 Elm Rd", city: "Houston", state: "TX", totalBeds: 6, monthlyRent: 1000, status: "Inactive" },
];

export const MOCK_LEASES: Lease[] = [
  { id: "l1", propertyId: "p1", startDate: "2023-01-01", endDate: "2024-12-31", monthlyRent: 8000, status: "Active" },
  { id: "l2", propertyId: "p2", startDate: "2023-06-01", endDate: "2024-05-31", monthlyRent: 9000, status: "Active" },
  { id: "l3", propertyId: "p3", startDate: "2022-01-01", endDate: "2023-12-31", monthlyRent: 7200, status: "Expired" },
  { id: "l4", propertyId: "p4", startDate: "2024-01-01", endDate: "2025-12-31", monthlyRent: 10500, status: "Active" },
];

export const MOCK_BEDS: Bed[] = Array.from({ length: 51 }).map((_, i) => {
  let propertyId = "p1";
  if (i >= 10 && i < 22) propertyId = "p2";
  else if (i >= 22 && i < 30) propertyId = "p3";
  else if (i >= 30 && i < 45) propertyId = "p4";
  else if (i >= 45) propertyId = "p5";

  const isOccupied = i % 3 !== 0;
  return {
    id: `b${i + 1}`,
    propertyId,
    bedNumber: (i % 15) + 1,
    status: isOccupied ? "Occupied" : "Vacant",
    occupantId: isOccupied ? `o${i + 1}` : null,
  };
});

export const MOCK_OCCUPANTS: Occupant[] = MOCK_BEDS.filter(b => b.occupantId).map((b, i) => ({
  id: b.occupantId!,
  name: `Worker ${i + 1}`,
  bedId: b.id,
  propertyId: b.propertyId,
  moveInDate: "2023-05-01",
  moveOutDate: null,
  status: "Active",
  chargePerBed: MOCK_PROPERTIES.find(p => p.id === b.propertyId)?.monthlyRent ?? 800,
}));

export const MOCK_UTILITIES: Utility[] = MOCK_PROPERTIES.flatMap(p => 
  [1, 2, 3].map(month => ({
    id: `u-${p.id}-${month}`,
    propertyId: p.id,
    month,
    year: 2024,
    electric: 150 + Math.random() * 100,
    gas: 50 + Math.random() * 50,
    water: 80 + Math.random() * 40,
    internet: 100,
    total: 380 + Math.random() * 190,
  }))
);
