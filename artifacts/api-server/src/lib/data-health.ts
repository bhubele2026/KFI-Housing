import { eq, gte } from "drizzle-orm";
import {
  db,
  leasesTable,
  propertiesTable,
  occupantsTable,
  bedsTable,
  payrollDeductionsTable,
  insuranceCertificatesTable,
} from "@workspace/db";

/**
 * Data-health / cleanup computations the assistant reasons over (Phase 7).
 *
 * A smart assistant on incomplete data is confidently wrong, so these
 * surface the known housing-data gaps — leases needing review, rent
 * anomalies, properties missing insurance, and the bed ↔ occupant ↔
 * deduction reconcile — so the operator can clear them conversationally.
 *
 * All of these are READ-only. Corrections route through the EXISTING
 * proposal-gated write tools (update_lease, assign_occupant_to_bed,
 * move_occupant_to_bed, etc.) — nothing here writes. Everything is
 * computed in-memory from small tables (~36 properties / ~500 people /
 * ~167 leases) using plain Drizzle selects rather than raw SQL, so it
 * stays portable and typecheck-safe.
 */

/** A monthly rent at/above this is almost always a data-entry/extraction
 *  error (a weekly or annual figure that landed in the monthly field). */
export const RENT_ANOMALY_THRESHOLD_USD = 10000;

async function loadProperties() {
  const props = await db
    .select({
      id: propertiesTable.id,
      name: propertiesTable.name,
      status: propertiesTable.status,
    })
    .from(propertiesTable);
  const nameById = new Map(props.map((p) => [p.id, p.name] as const));
  return { props, nameById };
}

export interface ReviewLease {
  id: string;
  propertyId: string;
  propertyName: string;
  unit: string;
  monthlyRent: number;
  weeklyCost: number;
  vendor: string;
  status: string;
}

/** Leases flagged `needsReview` (rent/dates came from a scanned or
 *  ambiguous source and an operator must confirm them). */
export async function listLeasesNeedingReview(): Promise<ReviewLease[]> {
  const { nameById } = await loadProperties();
  const rows = await db
    .select()
    .from(leasesTable)
    .where(eq(leasesTable.needsReview, true));
  return rows.map((l) => ({
    id: l.id,
    propertyId: l.propertyId,
    propertyName: nameById.get(l.propertyId) ?? "(unknown property)",
    unit: l.unit,
    monthlyRent: l.monthlyRent,
    weeklyCost: l.weeklyCost,
    vendor: l.vendor,
    status: l.status,
  }));
}

export interface AnomalyLease {
  id: string;
  propertyId: string;
  propertyName: string;
  unit: string;
  monthlyRent: number;
}

/** Leases whose monthlyRent is ≥ the anomaly threshold. */
export async function listRentAnomalies(): Promise<AnomalyLease[]> {
  const { nameById } = await loadProperties();
  const rows = await db
    .select()
    .from(leasesTable)
    .where(gte(leasesTable.monthlyRent, RENT_ANOMALY_THRESHOLD_USD));
  return rows.map((l) => ({
    id: l.id,
    propertyId: l.propertyId,
    propertyName: nameById.get(l.propertyId) ?? "(unknown property)",
    unit: l.unit,
    monthlyRent: l.monthlyRent,
  }));
}

export interface PropertyRef {
  id: string;
  name: string;
}

/** Active properties with NO insurance certificate on file. */
export async function listPropertiesMissingInsurance(): Promise<PropertyRef[]> {
  const { props } = await loadProperties();
  const certs = await db
    .select({ propertyId: insuranceCertificatesTable.propertyId })
    .from(insuranceCertificatesTable);
  const insured = new Set(certs.map((c) => c.propertyId));
  return props
    .filter((p) => p.status === "Active" && !insured.has(p.id))
    .map((p) => ({ id: p.id, name: p.name }));
}

export interface OccupancyReconcile {
  /** The most recent payroll week the reconcile is scoped to (or "" if
   *  there are no deductions yet). */
  latestPayWeekEndDate: string;
  /** People charged a housing deduction this week but not in a bed —
   *  the money-leak gap. */
  chargedNotPlaced: Array<{ occupantId: string; name: string }>;
  /** Active occupants in a bed but NOT being charged — the revenue gap. */
  placedNotCharged: Array<{
    occupantId: string;
    name: string;
    propertyId: string | null;
  }>;
  vacantBedCount: number;
}

/** Reconcile who's housed vs who's charged, for the latest payroll week.
 *  Compares the app's own records (beds ↔ occupants ↔ deductions). It does
 *  NOT compare against the external Housing Master spreadsheet — that was a
 *  one-time import, not a live feed. */
export async function reconcileOccupancy(): Promise<OccupancyReconcile> {
  const [occupants, deductions, beds] = await Promise.all([
    db.select().from(occupantsTable),
    db.select().from(payrollDeductionsTable),
    db.select().from(bedsTable),
  ]);

  const latestPayWeekEndDate = deductions.reduce(
    (max, d) => (d.payWeekEndDate > max ? d.payWeekEndDate : max),
    "",
  );
  const occById = new Map(occupants.map((o) => [o.id, o] as const));
  const chargedThisWeek = deductions.filter(
    (d) => d.payWeekEndDate === latestPayWeekEndDate,
  );
  const chargedOccupantIds = new Set(chargedThisWeek.map((d) => d.occupantId));

  const chargedNotPlaced = [...chargedOccupantIds]
    .filter((id) => {
      const o = occById.get(id);
      return !o || !o.bedId;
    })
    .map((id) => ({
      occupantId: id,
      name:
        occById.get(id)?.name ??
        chargedThisWeek.find((d) => d.occupantId === id)?.nameSnapshot ??
        "(unknown)",
    }));

  const placedNotCharged = occupants
    .filter(
      (o) => o.status === "Active" && !!o.bedId && !chargedOccupantIds.has(o.id),
    )
    .map((o) => ({
      occupantId: o.id,
      name: o.name,
      propertyId: o.propertyId,
    }));

  const vacantBedCount = beds.filter(
    (b) => !b.occupantId || b.status === "Vacant",
  ).length;

  return {
    latestPayWeekEndDate,
    chargedNotPlaced,
    placedNotCharged,
    vacantBedCount,
  };
}

export interface DataHealth {
  counts: {
    leasesNeedingReview: number;
    rentAnomalies: number;
    propertiesMissingInsurance: number;
    chargedNotPlaced: number;
    placedNotCharged: number;
    vacantBeds: number;
    propertiesWithNoBeds: number;
  };
  propertiesWithNoBeds: PropertyRef[];
  headline: string;
}

/** The "is my housing data trustworthy?" answer — counts of every open
 *  data-quality gap plus a plain-English headline. */
export async function computeDataHealth(): Promise<DataHealth> {
  const { props } = await loadProperties();
  const [review, anomalies, missingInsurance, recon, bedRows] =
    await Promise.all([
      listLeasesNeedingReview(),
      listRentAnomalies(),
      listPropertiesMissingInsurance(),
      reconcileOccupancy(),
      db.select({ propertyId: bedsTable.propertyId }).from(bedsTable),
    ]);

  const propsWithBeds = new Set(bedRows.map((b) => b.propertyId));
  const propertiesWithNoBeds = props
    .filter((p) => p.status === "Active" && !propsWithBeds.has(p.id))
    .map((p) => ({ id: p.id, name: p.name }));

  const counts = {
    leasesNeedingReview: review.length,
    rentAnomalies: anomalies.length,
    propertiesMissingInsurance: missingInsurance.length,
    chargedNotPlaced: recon.chargedNotPlaced.length,
    placedNotCharged: recon.placedNotCharged.length,
    vacantBeds: recon.vacantBedCount,
    propertiesWithNoBeds: propertiesWithNoBeds.length,
  };

  // Issues the operator should act on (vacant beds / placed-not-charged are
  // reported but not counted as "errors" here — they're operational, not
  // data-entry gaps).
  const actionable =
    counts.leasesNeedingReview +
    counts.rentAnomalies +
    counts.propertiesMissingInsurance +
    counts.chargedNotPlaced +
    counts.propertiesWithNoBeds;

  const parts = [
    counts.leasesNeedingReview &&
      `${counts.leasesNeedingReview} lease${counts.leasesNeedingReview === 1 ? "" : "s"} to review`,
    counts.rentAnomalies &&
      `${counts.rentAnomalies} rent anomal${counts.rentAnomalies === 1 ? "y" : "ies"} (≥ $10k/mo)`,
    counts.chargedNotPlaced &&
      `${counts.chargedNotPlaced} person${counts.chargedNotPlaced === 1 ? "" : "s"} charged but not in a bed`,
    counts.propertiesMissingInsurance &&
      `${counts.propertiesMissingInsurance} propert${counts.propertiesMissingInsurance === 1 ? "y" : "ies"} missing insurance`,
    counts.propertiesWithNoBeds &&
      `${counts.propertiesWithNoBeds} active propert${counts.propertiesWithNoBeds === 1 ? "y" : "ies"} with no beds set up`,
  ].filter(Boolean);

  const headline =
    actionable === 0
      ? "Housing data looks clean — no open review items, rent anomalies, unplaced charges, or properties missing beds/insurance."
      : `${actionable} data item${actionable === 1 ? "" : "s"} need attention: ${parts.join(", ")}.`;

  return { counts, propertiesWithNoBeds, headline };
}
