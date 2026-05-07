import { pgTable, text, integer, doublePrecision, jsonb, boolean } from "drizzle-orm/pg-core";

/** Per-property subjective ratings, 0–5 whole-star scale. 0 = not rated. */
export interface PropertyRatings {
  landlord: number;
  cleanliness: number;
  amenities: number;
  occupants: number;
  location: number;
  valueForMoney: number;
}

const EMPTY_RATINGS: PropertyRatings = {
  landlord: 0,
  cleanliness: 0,
  amenities: 0,
  occupants: 0,
  location: 0,
  valueForMoney: 0,
};

export const propertiesTable = pgTable("properties", {
  id: text("id").primaryKey(),
  name: text("name").notNull().default(""),
  address: text("address").notNull().default(""),
  city: text("city").notNull().default(""),
  state: text("state").notNull().default(""),
  zip: text("zip").notNull().default(""),
  totalBeds: integer("total_beds").notNull().default(0),
  monthlyRent: doublePrecision("monthly_rent").notNull().default(0),
  chargePerBed: doublePrecision("charge_per_bed").notNull().default(0),
  status: text("status").notNull().default("Active"),
  landlordName: text("landlord_name").notNull().default(""),
  landlordEmail: text("landlord_email").notNull().default(""),
  landlordPhone: text("landlord_phone").notNull().default(""),
  paymentMethod: text("payment_method").notNull().default("ACH"),
  paymentRecipient: text("payment_recipient").notNull().default(""),
  paymentDueDay: integer("payment_due_day").notNull().default(1),
  rentFrequency: text("rent_frequency").notNull().default("Monthly"),
  paymentNotes: text("payment_notes").notNull().default(""),
  bankName: text("bank_name").notNull().default(""),
  bankRouting: text("bank_routing").notNull().default(""),
  bankAccount: text("bank_account").notNull().default(""),
  portalUrl: text("portal_url").notNull().default(""),
  notes: text("notes").notNull().default(""),
  furnishings: text("furnishings").array().notNull().default([]),
  customerId: text("customer_id").notNull().default(""),
  // Additional customers that also use this property. Empty for the
  // common single-tenant case; populated when a property is shared
  // (e.g. the Ridge Motor Inn used by both Penda and Trienda KFI
  // crews — task #295). The Properties page surfaces the property
  // under each customer in this list as well as `customerId`.
  sharedWithCustomerIds: text("shared_with_customer_ids")
    .array()
    .notNull()
    .default([]),
  ratings: jsonb("ratings")
    .$type<PropertyRatings>()
    .notNull()
    .default(EMPTY_RATINGS),
  // Cached geocoded coordinates so the portfolio map can render pins
  // instantly without re-geocoding on every load. Nullable so that
  // properties without a resolvable address can still be persisted; the
  // map falls back to live geocoding when these are absent.
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  // Whether the operator has confirmed the persisted lat/lng pinpoints
  // the property accurately. Coordinates produced by automatic
  // geocoding (server-side `resolveCoordsForSave`, or the legacy
  // front-end `onGeocoded` writeback) land here as `false` so the UI
  // can flag pins as approximate. The badge clears back to `false`
  // automatically whenever the address changes — a verified pin only
  // applies to the address it was verified against.
  coordsVerified: boolean("coords_verified").notNull().default(false),
  // Rent-free property (cleaning-fee-only): when true, the canonical
  // monthly rent is treated as $0 and the property's recurring cost
  // comes from the `other_costs` table instead. Suppresses the
  // "missing rent" review alert and swaps the Lease Rent stat / list
  // columns / finance roll-up for the other-costs total. See task #497.
  rentFree: boolean("rent_free").notNull().default(false),
  // Default termination / renewal notice period in days (Task #492).
  // Used as the seed value for new leases on this property and as the
  // fallback when a lease has no `noticePeriodDays` set. Nullable so
  // the operator can leave it blank — leases without a notice period
  // simply skip the "Notice deadline approaching" alerts.
  defaultNoticePeriodDays: integer("default_notice_period_days"),
  // Physical property classification (task #501): one of
  // "Town house", "Apartment", "Motel". Nullable because existing
  // properties were created before this field existed and operators
  // backfill it lazily — the UI hides the badge when null/blank
  // rather than guessing a default.
  propertyType: text("property_type"),
});

export type PropertyRow = typeof propertiesTable.$inferSelect;
export type InsertPropertyRow = typeof propertiesTable.$inferInsert;
