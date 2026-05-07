import { and, eq } from "drizzle-orm";
import {
  db,
  customersTable,
  propertiesTable,
  occupantsTable,
  type InsertCustomerRow,
  type InsertPropertyRow,
  type InsertOccupantRow,
} from "@workspace/db";
import { logger as defaultLogger } from "./logger";
import type { Logger } from "pino";

/**
 * Seed the payroll-only people who appear on the weekly housing
 * deduction roster (`seed-housing-deductions.ts`) but do not yet exist
 * as occupants under any name variant. Without them, payroll sync keeps
 * listing them as unmatched and leasing has no record of them at all
 * (Task #305).
 *
 * For each missing person we ensure three things, idempotently:
 *   1. Their employer customer exists (matched by name).
 *   2. A "Roster — Pending Placement (<Customer>)" property exists for
 *      that customer. This is the placeholder bucket leasing sees when
 *      a payroll person has no real bed yet — distinct from any real
 *      property, so it never collides with a live lease seed.
 *   3. An Active occupant exists with `employeeId == personId`,
 *      `company == customer`, `chargePerBed == weekly`,
 *      `billingFrequency == "Weekly"`, attached to the pending-
 *      placement property and `bedId = null`.
 *
 * Because we set the deduction fields at insert time, the subsequent
 * `seedHousingDeductions` run matches them via `employeeId == personId`
 * and reports them as `alreadyCorrect` — the unmatched warning shrinks
 * to genuinely new hires only.
 *
 * Reconciliation keys (never UPDATEs operator edits):
 *   - customer:  by `name`.
 *   - property:  by `(customerId, name)` — the pending-placement label
 *                makes this collision-proof against real properties.
 *   - occupant:  by `employeeId` (== `personId`).
 */

export const PENDING_PLACEMENT_PROPERTY_PREFIX = "Roster — Pending Placement";

export function pendingPlacementPropertyName(customerName: string): string {
  return `${PENDING_PLACEMENT_PROPERTY_PREFIX} (${customerName})`;
}

interface PayrollCustomerSpec {
  /** Stable id used only when this customer has to be inserted fresh. */
  id: string;
  name: string;
  state: string;
  notes: string;
  /** Stable id used only when the pending-placement property is fresh. */
  pendingPropertyId: string;
}

const CUSTOMERS: readonly PayrollCustomerSpec[] = [
  {
    id: "cust-adient",
    name: "Adient",
    state: "MO",
    notes: "",
    pendingPropertyId: "prop-pending-adient",
  },
  {
    id: "cust-bell-timber",
    name: "Bell Timber, Inc.",
    state: "MN",
    notes:
      "Bell Timber, Inc. crew housed via KFI Staffing payroll. Seeded from " +
      "the EE Housing Deduction payroll export (Task #305) — no lease/property " +
      "of record yet; reconcile when the Bell Timber housing arrangement is " +
      "documented.",
    pendingPropertyId: "prop-pending-bell-timber",
  },
  {
    id: "cust-burnett-dairy-grantsburg",
    name: "Burnett Dairy - Grantsburg",
    state: "WI",
    notes:
      "Burnett Dairy crew (Grantsburg, WI) housed via KFI Staffing payroll. " +
      "Seeded from the EE Housing Deduction payroll export (Task #305).",
    pendingPropertyId: "prop-pending-burnett-dairy-grantsburg",
  },
  {
    id: "cust-delallo-foods",
    name: "DeLallo Foods",
    state: "PA",
    notes:
      "DeLallo Foods drivers housed via KFI Staffing payroll. Distinct from " +
      "the George DeLallo Company landlord on the AutoZone Jeannette houses. " +
      "Seeded from the EE Housing Deduction payroll export (Task #305).",
    pendingPropertyId: "prop-pending-delallo-foods",
  },
  {
    id: "cust-greystone-manufacturing",
    name: "Greystone Manufacturing",
    state: "WI",
    notes:
      "Greystone Manufacturing crew housed via KFI Staffing payroll. Seeded " +
      "from the EE Housing Deduction payroll export (Task #305).",
    pendingPropertyId: "prop-pending-greystone-manufacturing",
  },
  {
    id: "cust-milwaukee-valve",
    name: "Milwaukee Valve",
    state: "WI",
    notes:
      "Milwaukee Valve crew housed via KFI Staffing payroll. Seeded from the " +
      "EE Housing Deduction payroll export (Task #305).",
    pendingPropertyId: "prop-pending-milwaukee-valve",
  },
  {
    id: "cust-penda-corp",
    name: "Penda Corp",
    state: "WI",
    notes:
      "Penda Corp (Portage, WI) crew housed via KFI Staffing payroll. Shares " +
      "the Ridge Motor Inn hotel-rate housing with Trienda. Seeded from the " +
      "EE Housing Deduction payroll export (Task #305).",
    pendingPropertyId: "prop-pending-penda-corp",
  },
  {
    id: "cust-shusters-building-components",
    name: "Shuster's Building Components",
    state: "WI",
    notes:
      "Shuster's Building Components crew housed via KFI Staffing payroll. " +
      "Seeded from the EE Housing Deduction payroll export (Task #305).",
    pendingPropertyId: "prop-pending-shusters-building-components",
  },
  {
    id: "cust-trienda-holdings",
    name: "Trienda Holdings",
    state: "WI",
    notes:
      "Trienda Holdings (Portage, WI) crew housed via KFI Staffing payroll. " +
      "Shares the Ridge Motor Inn hotel-rate housing with Penda. Seeded from " +
      "the EE Housing Deduction payroll export (Task #305).",
    pendingPropertyId: "prop-pending-trienda-holdings",
  },
];

interface PayrollOccupantSpec {
  customer: string;
  name: string;
  personId: string;
  weekly: number;
}

// Verbatim from the unmatched warning printed by `seedHousingDeductions`
// against the dev DB after Task #285's id/company backfill landed
// (Task #305 captured the list at 56 rows). Names are kept in their
// payroll-export ALL CAPS form so a downstream `(name, company)` audit
// against the source spreadsheet round-trips byte-for-byte.
export const PAYROLL_OCCUPANTS: readonly PayrollOccupantSpec[] = [
  { customer: "Adient", name: "ANDREW GRANVILLE", personId: "2004810", weekly: 25.0 },
  { customer: "Adient", name: "MARISA L LOERA", personId: "2005126", weekly: 175.0 },
  { customer: "Adient", name: "WILLIAM C MILLER", personId: "2005127", weekly: 175.0 },

  { customer: "Bell Timber, Inc.", name: "GERARD A DERBY", personId: "2004445", weekly: 150.5 },

  { customer: "Burnett Dairy - Grantsburg", name: "ANTHONY G EVANS", personId: "2005128", weekly: 125.0 },
  { customer: "Burnett Dairy - Grantsburg", name: "ARTHUR DE LA ROSA", personId: "2001866", weekly: 99.43 },
  { customer: "Burnett Dairy - Grantsburg", name: "CHRISTIAN FRIAS", personId: "2004688", weekly: 86.0 },
  { customer: "Burnett Dairy - Grantsburg", name: "CODY S OGDEN", personId: "2004594", weekly: 116.0 },
  { customer: "Burnett Dairy - Grantsburg", name: "COLBY PETERS", personId: "2004801", weekly: 116.0 },
  { customer: "Burnett Dairy - Grantsburg", name: "DEVIN M LAW", personId: "2004762", weekly: 86.0 },
  { customer: "Burnett Dairy - Grantsburg", name: "DEVIN R NEAL", personId: "2005042", weekly: 86.0 },
  { customer: "Burnett Dairy - Grantsburg", name: "ELIJAH DAVIS", personId: "2004737", weekly: 86.0 },
  { customer: "Burnett Dairy - Grantsburg", name: "ERIC D MOORE", personId: "2004687", weekly: 86.0 },
  { customer: "Burnett Dairy - Grantsburg", name: "FERNANDO D REYES", personId: "2004592", weekly: 116.0 },
  { customer: "Burnett Dairy - Grantsburg", name: "FRANCISCO J PALMA", personId: "2003196", weekly: 86.0 },
  { customer: "Burnett Dairy - Grantsburg", name: "FRANK QUINONES", personId: "2004741", weekly: 86.0 },
  { customer: "Burnett Dairy - Grantsburg", name: "GABRIEL M VEGA", personId: "2004606", weekly: 116.0 },
  { customer: "Burnett Dairy - Grantsburg", name: "ISIDRO GUERRERO", personId: "2005207", weekly: 99.43 },
  { customer: "Burnett Dairy - Grantsburg", name: "JOHNATHAN M REYNOLDS", personId: "2004593", weekly: 116.0 },
  { customer: "Burnett Dairy - Grantsburg", name: "JUAN SANCHEZ", personId: "2004735", weekly: 86.0 },
  { customer: "Burnett Dairy - Grantsburg", name: "LUIS ALBERTO HERNANDEZ", personId: "2004372", weekly: 99.43 },
  { customer: "Burnett Dairy - Grantsburg", name: "RONALD GLEN HOLMES", personId: "2004740", weekly: 86.0 },
  { customer: "Burnett Dairy - Grantsburg", name: "STEVEN N HOLLIDAY", personId: "2004803", weekly: 116.0 },

  { customer: "DeLallo Foods", name: "ABEL SMALL", personId: "2005009", weekly: 69.23 },
  { customer: "DeLallo Foods", name: "DAVIDSON ALCIDE", personId: "2005003", weekly: 69.23 },
  { customer: "DeLallo Foods", name: "DIRON C WEAVER", personId: "2005008", weekly: 69.23 },
  { customer: "DeLallo Foods", name: "DYLAN A FARMER", personId: "2005218", weekly: 59.34 },
  { customer: "DeLallo Foods", name: "JORDAN H BROWN", personId: "2005030", weekly: 69.23 },
  { customer: "DeLallo Foods", name: "WILLIE T TURNER", personId: "2005219", weekly: 59.34 },

  { customer: "Greystone Manufacturing", name: "BRANDON TILTON", personId: "2004819", weekly: 77.14 },
  { customer: "Greystone Manufacturing", name: "CHRISTOPHER AARON DELAROSA", personId: "2004818", weekly: 60.0 },
  { customer: "Greystone Manufacturing", name: "DEVIN F HOLLY", personId: "2004812", weekly: 77.14 },
  { customer: "Greystone Manufacturing", name: "JALEN L GORDON", personId: "2004807", weekly: 77.14 },

  { customer: "Milwaukee Valve", name: "ALEXIS PEREZ", personId: "2002739", weekly: 130.0 },
  { customer: "Milwaukee Valve", name: "ANTONIO HERNANDEZ", personId: "2001265", weekly: 130.0 },
  { customer: "Milwaukee Valve", name: "DORIAN KYLES", personId: "2004679", weekly: 130.0 },
  { customer: "Milwaukee Valve", name: "ISMAEL MEZA CACERES", personId: "2001257", weekly: 130.0 },
  { customer: "Milwaukee Valve", name: "JACOB C FERGUSON", personId: "2004676", weekly: 130.0 },
  { customer: "Milwaukee Valve", name: "JACOB ZEPEDA", personId: "2001252", weekly: 130.0 },
  { customer: "Milwaukee Valve", name: "JONATHAN ARIOLA", personId: "2002201", weekly: 130.0 },
  { customer: "Milwaukee Valve", name: "LAWRENCE CORTEZ", personId: "2002187", weekly: 130.0 },

  { customer: "Penda Corp", name: "BRANDON HUDSON", personId: "2004580", weekly: 175.0 },
  { customer: "Penda Corp", name: "DERWIN B WILLIAMS", personId: "2004579", weekly: 175.0 },
  { customer: "Penda Corp", name: "DULCE ASCENCIO", personId: "2001231", weekly: 175.0 },
  { customer: "Penda Corp", name: "EMORY L LEWIS", personId: "2004578", weekly: 175.0 },
  { customer: "Penda Corp", name: "JUSTIN R HERNANDEZ", personId: "2004975", weekly: 175.0 },

  { customer: "Shuster's Building Components", name: "ANDRES GALLEGOS", personId: "2005033", weekly: 75.0 },
  { customer: "Shuster's Building Components", name: "MANDRELL CORTEZ", personId: "2002420", weekly: 75.0 },

  { customer: "Trienda Holdings", name: "CEDRIC T LEE", personId: "2004528", weekly: 175.0 },
  { customer: "Trienda Holdings", name: "CHRISTIAN L RICHARDSON", personId: "2004617", weekly: 175.0 },
  { customer: "Trienda Holdings", name: "ELIJAH M LEE", personId: "2004418", weekly: 175.0 },
  { customer: "Trienda Holdings", name: "JASMIN ARCE", personId: "2004307", weekly: 175.0 },
  { customer: "Trienda Holdings", name: "LUIS ALBERTO RUIZ", personId: "2004589", weekly: 25.0 },
  { customer: "Trienda Holdings", name: "MICHAEL BRENNAN FELIX", personId: "2004822", weekly: 175.0 },
  { customer: "Trienda Holdings", name: "RICKY ARGUELLES", personId: "2004352", weekly: 175.0 },
  { customer: "Trienda Holdings", name: "VICTORIA E BRANNON", personId: "2004428", weekly: 175.0 },
];

function buildCustomerRow(spec: PayrollCustomerSpec): InsertCustomerRow {
  return {
    id: spec.id,
    name: spec.name,
    contactName: "",
    email: "",
    phone: "",
    notes: spec.notes,
    state: spec.state,
  };
}

function buildPendingPropertyRow(
  spec: PayrollCustomerSpec,
  customerId: string,
): InsertPropertyRow {
  return {
    id: spec.pendingPropertyId,
    customerId,
    name: pendingPlacementPropertyName(spec.name),
    address: "",
    city: "",
    state: spec.state,
    zip: "",
    totalBeds: 0,
    monthlyRent: 0,
    chargePerBed: 0,
    status: "Active",
    landlordName: "",
    landlordEmail: "",
    landlordPhone: "",
    paymentMethod: "ACH",
    paymentRecipient: "",
    paymentDueDay: 1,
    paymentNotes: "",
    bankName: "",
    bankRouting: "",
    bankAccount: "",
    portalUrl: "",
    notes:
      `Holding bucket for ${spec.name} payroll people who appear on the ` +
      "weekly housing deduction roster but have not yet been placed in a " +
      "real bed. Move each occupant to the correct property + bed once " +
      "their assignment is known. Created by the payroll-occupants seed " +
      "(Task #305).",
    furnishings: [],
  };
}

function buildOccupantRow(
  spec: PayrollOccupantSpec,
  customerName: string,
  propertyId: string,
): InsertOccupantRow {
  // Stable, collision-proof id keyed on the payroll personId. Re-runs of
  // the seeder reconcile by `employeeId` (the source-of-truth key); the
  // id below only matters on the very first insert.
  return {
    id: `occ-payroll-${spec.personId}`,
    name: spec.name,
    email: "",
    phone: "",
    bedId: null,
    propertyId,
    moveInDate: "",
    moveOutDate: null,
    status: "Active",
    chargePerBed: spec.weekly,
    billingFrequency: "Weekly",
    employeeId: spec.personId,
    company: customerName,
  };
}

export interface SeedPayrollOccupantsResult {
  customersInserted: number;
  propertiesInserted: number;
  occupantsInserted: number;
}

export interface SeedPayrollOccupantsDeps {
  db: typeof db;
  logger: Pick<Logger, "info" | "warn">;
}

export async function seedPayrollOccupantsIfMissing(
  deps: Partial<SeedPayrollOccupantsDeps> = {},
): Promise<SeedPayrollOccupantsResult> {
  const database = deps.db ?? db;
  const log = deps.logger ?? defaultLogger;

  const result = await database.transaction(async (tx) => {
    const customerIdByName = new Map<string, string>();
    const pendingPropertyIdByCustomer = new Map<string, string>();
    let customersInserted = 0;
    let propertiesInserted = 0;

    for (const spec of CUSTOMERS) {
      // 1. Ensure the customer exists.
      const existingCustomer = await tx
        .select({ id: customersTable.id })
        .from(customersTable)
        .where(eq(customersTable.name, spec.name))
        .limit(1);

      let customerId: string;
      if (existingCustomer.length > 0) {
        customerId = existingCustomer[0]!.id;
      } else {
        const inserted = await tx
          .insert(customersTable)
          .values(buildCustomerRow(spec))
          .onConflictDoNothing()
          .returning({ id: customersTable.id });
        if (inserted.length > 0) {
          customerId = spec.id;
          customersInserted += 1;
        } else {
          const reread = await tx
            .select({ id: customersTable.id })
            .from(customersTable)
            .where(eq(customersTable.name, spec.name))
            .limit(1);
          if (reread.length === 0) continue;
          customerId = reread[0]!.id;
        }
      }
      customerIdByName.set(spec.name, customerId);

      // 2. Ensure the pending-placement property exists for this
      //    customer. Natural key: (customerId, property name).
      const pendingName = pendingPlacementPropertyName(spec.name);
      const existingProperty = await tx
        .select({ id: propertiesTable.id })
        .from(propertiesTable)
        .where(
          and(
            eq(propertiesTable.customerId, customerId),
            eq(propertiesTable.name, pendingName),
          ),
        )
        .limit(1);

      let propertyId: string;
      if (existingProperty.length > 0) {
        propertyId = existingProperty[0]!.id;
      } else {
        const inserted = await tx
          .insert(propertiesTable)
          .values(buildPendingPropertyRow(spec, customerId))
          .onConflictDoNothing()
          .returning({ id: propertiesTable.id });
        if (inserted.length > 0) {
          propertyId = spec.pendingPropertyId;
          propertiesInserted += 1;
        } else {
          const reread = await tx
            .select({ id: propertiesTable.id })
            .from(propertiesTable)
            .where(
              and(
                eq(propertiesTable.customerId, customerId),
                eq(propertiesTable.name, pendingName),
              ),
            )
            .limit(1);
          if (reread.length === 0) continue;
          propertyId = reread[0]!.id;
        }
      }
      pendingPropertyIdByCustomer.set(spec.name, propertyId);
    }

    // 3. Ensure each payroll occupant exists. Natural key: employeeId
    //    (== personId). If a row with the same employeeId is already in
    //    the table — even attached to a different property — we leave
    //    it alone; the deduction seeder will resolve it.
    let occupantsInserted = 0;
    for (const occ of PAYROLL_OCCUPANTS) {
      const customerId = customerIdByName.get(occ.customer);
      const propertyId = pendingPropertyIdByCustomer.get(occ.customer);
      if (!customerId || !propertyId) continue;

      const existing = await tx
        .select({ id: occupantsTable.id })
        .from(occupantsTable)
        .where(eq(occupantsTable.employeeId, occ.personId))
        .limit(1);
      if (existing.length > 0) continue;

      const inserted = await tx
        .insert(occupantsTable)
        .values(buildOccupantRow(occ, occ.customer, propertyId))
        .onConflictDoNothing()
        .returning({ id: occupantsTable.id });
      if (inserted.length > 0) occupantsInserted += 1;
    }

    return { customersInserted, propertiesInserted, occupantsInserted };
  });

  if (
    result.customersInserted > 0 ||
    result.propertiesInserted > 0 ||
    result.occupantsInserted > 0
  ) {
    log.info(result, "Payroll-occupants seed applied.");
  }

  return result;
}
