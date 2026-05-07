import { and, eq, like } from "drizzle-orm";
import {
  db,
  customersTable,
  propertiesTable,
  leasesTable,
  type InsertPropertyRow,
  type InsertLeaseRow,
} from "@workspace/db";
import { logger as defaultLogger } from "./logger";
import type { Logger } from "pino";
import { normalizeCustomerName } from "./master-lease-parser";
import { normalizePropertyRow, normalizeLeaseRow } from "./db-row-normalizers";

export const RIDGE_PROPERTY_ID = "prop-ridge-motor-inn-portage";
export const ridgeLeaseId = (slug: "penda" | "trienda"): string =>
  `lease-ridge-motor-inn-${slug}`;

const RIDGE_TITLE = "Ridge Motor Inn";
const RIDGE_TITLE_NORM = "ridge motor inn";
const RIDGE_CITY = "Portage";
const RIDGE_STATE = "WI";
const RIDGE_ADDRESS_PLACEHOLDER = "Ridge Motor Inn, Portage, WI";
const RIDGE_TOTAL_BEDS = 40;
const RIDGE_TOTAL_ROOMS = 20;
const RIDGE_SOURCE_FILE = "penda_y_trienda_housing_ridge_1778107826283.xlsx";
const RIDGE_SOURCE_MARKER = "Ridge Motor Inn — penda_y_trienda_housing_ridge";

const PENDA_KEY = "penda";
const TRIENDA_KEY = "trienda";

interface CustomerLookup {
  id: string;
  name: string;
}

/**
 * Normalize a property title for fuzzy match: lowercase, strip
 * punctuation, collapse whitespace, AND strip a leading "the " so
 * "The Ridge Motor Inn" (used by the attached-PDFs seed) matches the
 * canonical "Ridge Motor Inn" title from the master spreadsheet.
 */
function normalizeTitle(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^the /, "");
}

function buildPropertyRow(
  id: string,
  customerId: string,
  sharedWithCustomerIds: string[],
  sharedWithLabel: string | null,
): InsertPropertyRow {
  const sharedNote = sharedWithLabel
    ? ` Also leased to: ${sharedWithLabel}.`
    : "";
  return {
    id,
    customerId,
    sharedWithCustomerIds,
    name: RIDGE_TITLE,
    address: RIDGE_ADDRESS_PLACEHOLDER,
    city: RIDGE_CITY,
    state: RIDGE_STATE,
    zip: "",
    totalBeds: RIDGE_TOTAL_BEDS,
    monthlyRent: 0,
    chargePerBed: 0,
    status: "Active",
    landlordName: "",
    landlordEmail: "",
    landlordPhone: "",
    paymentMethod: "",
    paymentRecipient: "",
    paymentDueDay: 1,
    paymentNotes: "",
    bankName: "",
    bankRouting: "",
    bankAccount: "",
    portalUrl: "",
    notes:
      `Shared housing — ${RIDGE_TOTAL_ROOMS} rooms × 2 beds = ${RIDGE_TOTAL_BEDS} beds. ` +
      `Used by both Penda and Trienda KFI crews.${sharedNote} ` +
      `Source: ${RIDGE_SOURCE_FILE}. ` +
      `Street address not in source — needs review.`,
    furnishings: [],
  };
}

function buildLeaseRow(
  id: string,
  propertyId: string,
  customerId: string,
  customerLabel: "Penda" | "Trienda",
): InsertLeaseRow {
  return {
    id,
    propertyId,
    customerId,
    startDate: "",
    endDate: "",
    monthlyRent: 0,
    securityDeposit: 0,
    status: "Active",
    notes:
      `${customerLabel} lease — Shared housing — Ridge Motor Inn, Portage WI. ` +
      `Source: ${RIDGE_SOURCE_FILE}. ` +
      `Rent and term not in source — needs review. ` +
      `[${RIDGE_SOURCE_MARKER}:${customerLabel.toLowerCase()}]`,
    clauses: "",
    buyoutAvailable: false,
    buyoutCost: null,
    weeklyCost: 0,
    vendor: "",
    needsReview: true,
  };
}

export interface SeedRidgeMotorInnResult {
  customersMatched: number;
  propertyCreated: boolean;
  propertyUpdated: boolean;
  leasesCreated: number;
  leasesSkipped: number;
}

export interface SeedRidgeMotorInnDeps {
  db: typeof db;
  logger: Pick<Logger, "info" | "warn">;
}

/**
 * Idempotently seed the Ridge Motor Inn (Portage, WI) shared-housing
 * property and one active lease per KFI customer (Penda and Trienda).
 *
 * Match keys (re-runs are no-ops):
 *  - Customer: normalized name (`penda` / `trienda`) — never INSERTs.
 *  - Property: case-insensitive title `"ridge motor inn"` (with a
 *    leading `the ` stripped, so the attached-PDFs seed's
 *    "The Ridge Motor Inn" row matches) + (city, state).
 *  - Lease: (propertyId, source-file marker in notes) per customer.
 *
 * If either Penda or Trienda is missing, the lease for that customer
 * is skipped with a warning rather than creating a partial customer.
 *
 * When a Ridge Motor Inn property already exists (created by an
 * operator or by the attached-PDFs seed under a different primary
 * customer), this seed REUSES that row and ATTACHES the missing
 * customers to its `sharedWithCustomerIds` so the property surfaces
 * under both Penda and Trienda on the Properties page. The existing
 * row's primary `customerId`, address, and notes are left untouched.
 */
export async function seedRidgeMotorInnIfMissing(
  deps: Partial<SeedRidgeMotorInnDeps> = {},
): Promise<SeedRidgeMotorInnResult> {
  const database = deps.db ?? db;
  const log = deps.logger ?? defaultLogger;

  const result = await database.transaction(async (tx) => {
    // --- Locate Penda & Trienda by normalized name; never INSERT. ---
    const allCustomers = await tx
      .select({ id: customersTable.id, name: customersTable.name })
      .from(customersTable);

    const findCustomer = (key: string): CustomerLookup | null => {
      for (const c of allCustomers as CustomerLookup[]) {
        if (normalizeCustomerName(c.name) === key) return c;
      }
      return null;
    };
    const penda = findCustomer(PENDA_KEY);
    const trienda = findCustomer(TRIENDA_KEY);

    // --- Pre-flight match decision logging ---
    log.info(
      {
        pendaCustomerId: penda?.id ?? null,
        pendaCustomerName: penda?.name ?? null,
        triendaCustomerId: trienda?.id ?? null,
        triendaCustomerName: trienda?.name ?? null,
      },
      "Ridge Motor Inn seed: pre-flight customer match",
    );

    if (!penda) {
      log.warn(
        "Ridge Motor Inn seed: skipping Penda lease — customer not found, run master import first",
      );
    }
    if (!trienda) {
      log.warn(
        "Ridge Motor Inn seed: skipping Trienda lease — customer not found, run master import first",
      );
    }

    const customersMatched = (penda ? 1 : 0) + (trienda ? 1 : 0);
    if (!penda && !trienda) {
      return {
        customersMatched: 0,
        propertyCreated: false,
        propertyUpdated: false,
        leasesCreated: 0,
        leasesSkipped: 2,
      };
    }

    // --- Locate or plan the Ridge Motor Inn property ---
    // Case-insensitive title (with optional leading "the ") + (city, state).
    const allProperties = await tx
      .select({
        id: propertiesTable.id,
        name: propertiesTable.name,
        city: propertiesTable.city,
        state: propertiesTable.state,
        customerId: propertiesTable.customerId,
        sharedWithCustomerIds: propertiesTable.sharedWithCustomerIds,
      })
      .from(propertiesTable);

    const matchedProperty = (
      allProperties as Array<{
        id: string;
        name: string;
        city: string;
        state: string;
        customerId: string;
        sharedWithCustomerIds: string[] | null;
      }>
    ).find(
      (p) =>
        normalizeTitle(p.name) === RIDGE_TITLE_NORM &&
        p.city.trim().toLowerCase() === RIDGE_CITY.toLowerCase() &&
        p.state.trim().toUpperCase() === RIDGE_STATE,
    );

    const primaryCustomer = penda ?? trienda!;
    const allMatchedIds = [penda?.id, trienda?.id].filter(
      (v): v is string => typeof v === "string",
    );

    log.info(
      {
        decision: matchedProperty ? "reuse-existing" : "insert-new",
        existingPropertyId: matchedProperty?.id ?? null,
        existingPrimaryCustomerId: matchedProperty?.customerId ?? null,
        existingSharedWith: matchedProperty?.sharedWithCustomerIds ?? null,
        plannedPropertyId: matchedProperty?.id ?? RIDGE_PROPERTY_ID,
        plannedPrimaryCustomerId: primaryCustomer.id,
      },
      "Ridge Motor Inn seed: pre-flight property match",
    );

    let propertyId: string;
    let propertyCreated = false;
    let propertyUpdated = false;
    if (matchedProperty) {
      propertyId = matchedProperty.id;
      // Compute additions to sharedWithCustomerIds: every matched
      // customer that isn't already either the primary customerId or
      // already in the existing sharedWithCustomerIds list.
      const existingShared = new Set(
        matchedProperty.sharedWithCustomerIds ?? [],
      );
      const additions: string[] = [];
      for (const cid of allMatchedIds) {
        if (cid === matchedProperty.customerId) continue;
        if (existingShared.has(cid)) continue;
        additions.push(cid);
      }
      if (additions.length > 0) {
        const merged = Array.from(new Set([...existingShared, ...additions]));
        await tx
          .update(propertiesTable)
          .set(normalizePropertyRow({ sharedWithCustomerIds: merged }))
          .where(eq(propertiesTable.id, propertyId));
        propertyUpdated = true;
        log.info(
          {
            propertyId,
            addedSharedCustomerIds: additions,
            mergedSharedCustomerIds: merged,
          },
          "Ridge Motor Inn seed: attached additional customers to existing shared property",
        );
      }
    } else {
      propertyId = RIDGE_PROPERTY_ID;
      const sharedIds = allMatchedIds.filter((id) => id !== primaryCustomer.id);
      const sharedLabel =
        penda && trienda
          ? primaryCustomer.id === penda.id
            ? "Trienda"
            : "Penda"
          : null;
      const inserted = await tx
        .insert(propertiesTable)
        .values(
          normalizePropertyRow(
            buildPropertyRow(
              propertyId,
              primaryCustomer.id,
              sharedIds,
              sharedLabel,
            ),
          ),
        )
        .onConflictDoNothing()
        .returning({ id: propertiesTable.id });
      propertyCreated = inserted.length > 0;
      if (!propertyCreated) {
        // Race: another writer beat us — re-read.
        const reread = await tx
          .select({ id: propertiesTable.id, name: propertiesTable.name })
          .from(propertiesTable)
          .where(eq(propertiesTable.id, RIDGE_PROPERTY_ID))
          .limit(1);
        if (reread.length > 0) propertyId = reread[0]!.id;
      }
    }

    // --- Upsert one lease per matched customer ---
    let leasesCreated = 0;
    let leasesSkipped = 0;

    const leaseSpecs: Array<{
      label: "Penda" | "Trienda";
      slug: "penda" | "trienda";
      customer: CustomerLookup | null;
    }> = [
      { label: "Penda", slug: "penda", customer: penda },
      { label: "Trienda", slug: "trienda", customer: trienda },
    ];

    // Pre-flight per-lease decision.
    const leasePlan: Array<{
      label: string;
      customerId: string | null;
      decision: "create" | "skip-existing" | "skip-no-customer";
    }> = [];
    for (const spec of leaseSpecs) {
      if (!spec.customer) {
        leasePlan.push({
          label: spec.label,
          customerId: null,
          decision: "skip-no-customer",
        });
        continue;
      }
      const leaseMarker = `[${RIDGE_SOURCE_MARKER}:${spec.slug}]`;
      const existing = await tx
        .select({ id: leasesTable.id })
        .from(leasesTable)
        .where(
          and(
            eq(leasesTable.propertyId, propertyId),
            like(leasesTable.notes, `%${leaseMarker}%`),
          ),
        )
        .limit(1);
      leasePlan.push({
        label: spec.label,
        customerId: spec.customer.id,
        decision: existing.length > 0 ? "skip-existing" : "create",
      });
    }
    log.info(
      { propertyId, leasePlan },
      "Ridge Motor Inn seed: pre-flight lease decisions",
    );

    for (const spec of leaseSpecs) {
      if (!spec.customer) continue;
      const plan = leasePlan.find((p) => p.label === spec.label);
      if (plan?.decision === "skip-existing") {
        leasesSkipped += 1;
        log.info(
          { propertyId, customerId: spec.customer.id, label: spec.label },
          "Ridge Motor Inn seed: lease already present, skipping",
        );
        continue;
      }
      const inserted = await tx
        .insert(leasesTable)
        .values(
          normalizeLeaseRow(
            buildLeaseRow(
              ridgeLeaseId(spec.slug),
              propertyId,
              spec.customer.id,
              spec.label,
            ),
          ),
        )
        .onConflictDoNothing()
        .returning({ id: leasesTable.id });
      if (inserted.length > 0) {
        leasesCreated += 1;
        log.info(
          { propertyId, customerId: spec.customer.id, label: spec.label },
          "Ridge Motor Inn seed: lease created",
        );
      } else {
        leasesSkipped += 1;
      }
    }

    return {
      customersMatched,
      propertyCreated,
      propertyUpdated,
      leasesCreated,
      leasesSkipped,
    };
  });

  log.info(
    `Ridge Motor Inn seed: customers matched=${result.customersMatched}, ` +
      `property created=${result.propertyCreated}, ` +
      `property updated=${result.propertyUpdated}, ` +
      `leases created=${result.leasesCreated}, ` +
      `leases skipped=${result.leasesSkipped}`,
  );
  return result;
}
