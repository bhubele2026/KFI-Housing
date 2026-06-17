// Import harvested utility accounts (from imports/utilities-from-email.json)
// into each property's Utilities. Only the HIGH/MEDIUM-confidence,
// property-matched records are embedded here; the low-confidence ones
// (the "Virginia Manor" 1300 Virginia Ave electric/gas/cable and the
// Ameren-Orgill electric — both with an unresolved property mapping) are
// deliberately left out for manual review.
//
// Additive + idempotent: each row has a deterministic natural key
// (propertyId + type + company); we only INSERT rows whose key isn't
// already present, never update or delete. Non-fatal; gated under
// FORCE_HARVEST_SEED. Setup emails rarely state a dollar amount, so
// monthlyCost is 0 — these capture provider/account/type for tracking.

import { db, utilitiesTable, propertiesTable, type InsertUtilityRow } from "@workspace/db";
import { logger as defaultLogger } from "./logger";
import type { Logger } from "pino";

// `type` must be one of the app's UTILITY_TYPES enum
// (Electric|Gas|Propane|Water|Garbage|Internet|Other).
export interface UtilitySeed {
  propertyId: string;
  type: "Electric" | "Gas" | "Propane" | "Water" | "Garbage" | "Internet" | "Other";
  company: string;
  accountNumber: string;
  notes: string;
}

export const UTILITIES_FROM_EMAIL: readonly UtilitySeed[] = [
  {
    propertyId: "prop-sunset-place-neillsville",
    type: "Electric",
    company: "Xcel Energy",
    accountNumber: "",
    notes:
      "Electric in KFI's name (Xcel). Per-unit confirmations: Unit 132 = 04547646, Unit 106 = 04547679. Source: ACosby move-in email 2026-06-08.",
  },
  {
    propertyId: "prop-park-place-plymouth",
    type: "Electric",
    company: "Xcel Energy",
    accountNumber: "",
    notes:
      "Per-unit Xcel electric accounts in KFI's name, on autopay; tenants on electric heat. Xcel phone 800-895-4999. Account numbers not in source email.",
  },
  {
    propertyId: "prop-burnett-siren-7666-south-shore",
    type: "Electric",
    company: "Polk-Burnett Electric Cooperative",
    accountNumber: "",
    notes: "Siren house electricity via Polk-Burnett. Confirmed Nov 2025.",
  },
  {
    propertyId: "prop-burnett-siren-7666-south-shore",
    type: "Propane",
    company: "Burnett Dairy (propane fill)",
    accountNumber: "",
    notes:
      "Heat is propane. KFI account with Burnett Dairy to fill the tank; landlord (Kyle Johnson) owns the tank. Recurring refill cost, not metered.",
  },
  {
    propertyId: "prop-prairie-hill-village",
    type: "Internet",
    company: "Spectrum",
    accountNumber: "",
    notes:
      "Spectrum internet/WiFi — NOT included in rent (per Lanyard); KFI pays Spectrum directly. Set up Oct 2025.",
  },
  {
    propertyId: "prop-cady-1402-8th-menomonie",
    type: "Other",
    company: "Landlord-billed (MA Properties / American Edge)",
    accountNumber: "",
    notes:
      "Per the executed Cady Cheese lease (May 2026), utilities are included/landlord-billed — no separate KFI account. Informational only.",
  },
];

/** Natural key for idempotency — collapses to property + type + company. */
export function utilityKey(propertyId: string, type: string, company: string): string {
  return `${propertyId}|${type.trim().toLowerCase()}|${company.trim().toLowerCase()}`;
}

function deterministicId(u: UtilitySeed): string {
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `util-${u.propertyId}-${slug(u.type)}-${slug(u.company)}`;
}

/**
 * Pure planner: given the natural keys of utilities already on file and
 * the set of known property ids, return the utility rows to insert
 * (skipping any whose key already exists or whose property is absent).
 * Deterministic, side-effect free — the unit-tested core.
 */
export function planUtilityInserts(
  existingKeys: Set<string>,
  knownPropertyIds: Set<string>,
  data: readonly UtilitySeed[] = UTILITIES_FROM_EMAIL,
): InsertUtilityRow[] {
  const out: InsertUtilityRow[] = [];
  const seen = new Set(existingKeys);
  for (const u of data) {
    if (!knownPropertyIds.has(u.propertyId)) continue;
    const key = utilityKey(u.propertyId, u.type, u.company);
    if (seen.has(key)) continue;
    seen.add(key); // guard against dupes within the embedded list itself
    out.push({
      id: deterministicId(u),
      propertyId: u.propertyId,
      type: u.type,
      company: u.company,
      monthlyCost: 0,
      accountNumber: u.accountNumber,
      notes: u.notes,
    });
  }
  return out;
}

export async function seedUtilitiesFromEmailIfMissing(
  log: Logger = defaultLogger,
): Promise<{ utilitiesCreated: number }> {
  const existing = await db
    .select({
      propertyId: utilitiesTable.propertyId,
      type: utilitiesTable.type,
      company: utilitiesTable.company,
    })
    .from(utilitiesTable);
  const existingKeys = new Set(existing.map((u) => utilityKey(u.propertyId, u.type, u.company)));

  const props = await db.select({ id: propertiesTable.id }).from(propertiesTable);
  const knownPropertyIds = new Set(props.map((p) => p.id));

  const rows = planUtilityInserts(existingKeys, knownPropertyIds);
  if (rows.length > 0) {
    await db.insert(utilitiesTable).values(rows);
    log.info({ utilitiesCreated: rows.length }, "seed-utilities-from-email: inserted utility accounts");
  }
  return { utilitiesCreated: rows.length };
}
