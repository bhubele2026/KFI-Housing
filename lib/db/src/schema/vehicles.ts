import {
  pgTable,
  text,
  integer,
  doublePrecision,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Transportation fleet (KFI vans). The first-class entity of the
 * Transportation section, mirroring how `properties` anchors the Housing
 * section. A van points at the client it serves (`customerId` → customers),
 * the housing location it is based at (`propertyId` → properties), and its
 * driver (`driverOccupantId` → occupants — drivers are modelled as occupants,
 * who already carry the `kfisAuthorizedToDrive` flag; a local non-resident
 * driver is an occupant without a bed).
 *
 * Riders (which associates a van transports), fuel-card charges, maintenance
 * records, and vehicle leases live in their own tables and reference
 * `vehicles.id`; they are built out in follow-up tasks. The denormalised
 * `associatesTransported` count here is a quick-capture figure for the list
 * views until the rider roster table lands.
 */
export const vehiclesTable = pgTable("vehicles", {
  id: text("id").primaryKey(),

  // --- Identifiers ---
  vin: text("vin").notNull().default(""),
  plate: text("plate").notNull().default(""),
  // State the plate is registered in (e.g. "WI"). Empty when unknown.
  plateState: text("plate_state").notNull().default(""),
  year: integer("year"),
  make: text("make").notNull().default(""),
  model: text("model").notNull().default(""),
  // Passenger capacity (number of seats). Compared against
  // `associatesTransported` to surface idle / under-utilised vans.
  seats: integer("seats").notNull().default(0),
  // Internal "Merchant Unit #" used by the team to reference the van.
  merchantUnit: text("merchant_unit").notNull().default(""),
  // Current book value in dollars.
  bookValue: doublePrecision("book_value").notNull().default(0),

  // --- Ownership ---
  // One of "owned" | "leased" | "rented". "owned" implies no recurring
  // monthlyCost. Plain text (not an enum) so a new arrangement can be added
  // without a destructive migration; normalised at the API boundary.
  ownership: text("ownership").notNull().default("owned"),
  // Monthly lease / rent cost in dollars. 0 when owned outright. The full
  // lease agreement (lessor, term, deductions) lives in `vehicle_leases`
  // once that table is built; this is the quick roll-up figure.
  monthlyCost: doublePrecision("monthly_cost").notNull().default(0),

  // --- Ties (reuse Housing entities) ---
  // Client this van serves. "" = unassigned / available. Mirrors
  // properties.customerId so the per-client list view can roll vans up.
  customerId: text("customer_id").notNull().default(""),
  // Housing location the van is based at / parked. Null when the van is
  // sitting somewhere that is not one of our properties (see
  // currentLocationNote). Gives the "tie to housing unit(s)" visibility.
  propertyId: text("property_id"),
  // Driver of the van, modelled as an occupant. Null when no driver is
  // currently assigned. occupants already carry kfisAuthorizedToDrive and,
  // when housed, a bedId/propertyId — so this single link answers "who
  // drives" and "which bed/unit the driver resides in".
  driverOccupantId: text("driver_occupant_id"),

  // --- Status / utilization ---
  // Operational status. One of:
  //   "In use"          — actively transporting for an assigned client.
  //   "Available"       — not assigned to a client; available for use.
  //   "In shop"         — at the repair shop / out for service.
  //   "Out of service"  — not driveable / retired.
  // The "Available" + a non-WI location is the case the team most wants to
  // see (idle van sitting at a client site that should come back to WI).
  status: text("status").notNull().default("Available"),
  // Convenience flag paired with status="In shop" for quick filtering.
  inShop: boolean("in_shop").notNull().default(false),
  // Free-text description of repairs needed / pending.
  repairsNeeded: text("repairs_needed").notNull().default(""),
  // The state the van is *supposed* to home-base to (the team's goal is WI).
  homeBaseState: text("home_base_state").notNull().default("WI"),
  // Where the van is physically sitting right now when it is not at a known
  // property (e.g. "Parked at Schuette Metals — Schofield WI"). Powers the
  // "NOT IN USE, sitting at a client site, available" visibility ask.
  currentLocationNote: text("current_location_note").notNull().default(""),
  // Quick-capture count of associates currently transported in this van.
  // Superseded by the rider roster table's live count once that ships, but
  // kept for the at-a-glance list figures.
  associatesTransported: integer("associates_transported")
    .notNull()
    .default(0),

  // --- Compliance / registration ---
  // Registration / plate expiration date (ISO yyyy-mm-dd string, matching
  // the date columns elsewhere in the schema). Feeds the same expiry-alert
  // pipeline used for lease + insurance-cert expirations. Empty when unknown.
  registrationExpires: text("registration_expires").notNull().default(""),
  // Last recorded odometer reading (miles). Null when not tracked.
  odometer: integer("odometer"),

  notes: text("notes").notNull().default(""),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

export type VehicleRow = typeof vehiclesTable.$inferSelect;
export type InsertVehicleRow = typeof vehiclesTable.$inferInsert;
