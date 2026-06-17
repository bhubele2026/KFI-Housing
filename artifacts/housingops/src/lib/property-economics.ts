import {
  sumActiveRent,
  type Property,
  type Lease,
  type Occupant,
  type Utility,
} from "@/data/mockData";

/**
 * Per-property RENT RECOVERY economics — the question the app exists to
 * answer: are we recovering the rent we pay out, from the staff we house?
 *
 *   rent_cost      = active lease monthly rent (what KFI pays the landlord)
 *   rent_recovered = ACTUAL housing payroll deductions for people whose bed
 *                    rolls up to this property, in the selected month
 *   recovery_gap   = rent_cost − rent_recovered   (+ = housing loss)
 *
 * recovered is the SUM OF ACTUAL DEDUCTIONS (payroll_deductions rows),
 * NOT expected occupant charges — that's the whole point: expected ≠ what
 * actually got withheld. A gap is split into the two leak types so it can
 * be explained: vacancy loss (empty beds) vs collection loss (occupied
 * beds whose people aren't actually being deducted enough).
 *
 * Beds are operator-owned and often unknown — when `property.totalBeds` is
 * 0 the row is flagged `bedsKnown=false` and per-bed math is withheld.
 */

const MONTHS_PER_WEEK = 52 / 12;
const MONTHS_PER_BIWEEK = 26 / 12;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Normalize an occupant's EXPECTED housing charge to a monthly figure. */
export function occupantMonthlyCharge(o: Pick<Occupant, "chargePerBed" | "billingFrequency">): number {
  const c = o.chargePerBed || 0;
  switch (o.billingFrequency) {
    case "Weekly":
      return c * MONTHS_PER_WEEK;
    case "Biweekly":
      return c * MONTHS_PER_BIWEEK;
    default:
      return c; // Monthly
  }
}

/** Minimal shape of a payroll-deduction row (from useListPayrollDeductions). */
export interface DeductionLite {
  propertyId: string;
  occupantId: string;
  payWeekEndDate: string; // YYYY-MM-DD (Saturday end-date)
  weeklyAmount: number;
}

const monthOf = (ymd: string | undefined): string => (ymd ? ymd.slice(0, 7) : "");

export interface EconomicsRow {
  propertyId: string;
  customerId: string;
  name: string;
  propertyType: string;
  monthlyRent: number;
  monthlyUtilities: number;
  monthlyCost: number;
  beds: number;
  bedsKnown: boolean;
  occupied: number;
  vacant: number;
  /** monthlyCost / beds — the break-even charge per bed. null when beds unknown. */
  recommendedPerBed: number | null;
  /** average monthly charge across occupants who have a charge on file. null when none. */
  avgChargePerBed: number | null;
  /** EXPECTED recovery (Σ occupant charges) — kept for the per-bed view. */
  recoveryMonthly: number;
  // ── Actual recovery (the spec's headline) ───────────────────────────
  /** ACTUAL Σ payroll deductions for this property in the selected month. */
  recoveredMonthly: number;
  /** rent_cost − rent_recovered. + = under-recovering (housing loss). */
  recoveryGap: number;
  /** recovered / cost, as a %. null when cost is 0. */
  recoveryRate: number | null;
  /** occupied / beds, as a %. null when beds unknown. */
  occupancyRate: number | null;
  /** gap attributable to empty beds (vacant × break-even per bed). */
  vacancyLoss: number;
  /** gap attributable to placed people not being deducted their expected charge. */
  collectionLoss: number;
  underchargeLoss: number;
  monthlyLoss: number;
  /** true when at least one active occupant has no charge on file. */
  chargeDataMissing: boolean;
}

export interface EconomicsSummary {
  totalMonthlyCost: number;
  totalRecovery: number;
  // Actual-recovery rollups
  totalRentCost: number;
  totalRecovered: number;
  totalRecoveryGap: number;
  blendedRecoveryRate: number | null;
  totalVacancyLoss: number;
  totalCollectionLoss: number;
  /** distinct people with a deduction this month whose occupant isn't placed in a bed — dollars that can't be attributed to a property. */
  chargedNotPlacedCount: number;
  totalMonthlyLoss: number;
  totalBeds: number;
  totalOccupied: number;
  totalVacant: number;
  propertiesLosing: number;
  bedsUnknownCount: number;
  /** the month (YYYY-MM) the recovery figures are scoped to ("" if none). */
  periodMonth: string;
}

export function computePropertyEconomics(
  properties: readonly Property[],
  leases: readonly Lease[],
  occupants: readonly Occupant[],
  utilities: readonly Utility[],
  deductions: readonly DeductionLite[] = [],
  periodMonth?: string,
): { rows: EconomicsRow[]; summary: EconomicsSummary } {
  const safeProps = (properties ?? []).filter(
    (p) => (p.status ?? "Active") !== "Inactive",
  );
  const safeLeases = leases ?? [];
  const safeOccupants = occupants ?? [];
  const safeUtilities = utilities ?? [];
  const safeDeductions = deductions ?? [];

  // Default the period to the most recent month present in the deductions.
  const period =
    periodMonth ||
    safeDeductions.reduce((max, d) => {
      const m = monthOf(d.payWeekEndDate);
      return m > max ? m : max;
    }, "");

  // Pre-roll actual deductions for the period: by property and by occupant.
  const recoveredByProperty = new Map<string, number>();
  const recoveredByOccupant = new Map<string, number>();
  for (const d of safeDeductions) {
    if (period && monthOf(d.payWeekEndDate) !== period) continue;
    const amt = d.weeklyAmount || 0;
    if (d.propertyId)
      recoveredByProperty.set(d.propertyId, (recoveredByProperty.get(d.propertyId) ?? 0) + amt);
    if (d.occupantId)
      recoveredByOccupant.set(d.occupantId, (recoveredByOccupant.get(d.occupantId) ?? 0) + amt);
  }

  // "Charged but not placed": people with a deduction this month whose
  // occupant has no bed/property — their dollars can't be attributed.
  const occById = new Map<string, Occupant>();
  for (const o of safeOccupants) occById.set(o.id, o);
  const chargedNotPlaced = new Set<string>();
  for (const occId of recoveredByOccupant.keys()) {
    const o = occById.get(occId);
    if (!o || !o.bedId || !o.propertyId) chargedNotPlaced.add(occId);
  }

  const rows = safeProps.map((p): EconomicsRow => {
    const activeRent = sumActiveRent(safeLeases, p.id);
    const monthlyRent = activeRent > 0 ? activeRent : p.monthlyRent || 0;
    const monthlyUtilities = safeUtilities.reduce(
      (s, u) => (u.propertyId === p.id ? s + (u.monthlyCost || 0) : s),
      0,
    );
    const monthlyCost = round2(monthlyRent + monthlyUtilities);

    const beds = p.totalBeds || 0;
    const bedsKnown = beds > 0;

    const activeOcc = safeOccupants.filter(
      (o) => o.propertyId === p.id && o.status === "Active" && !o.moveOutDate,
    );
    const occupied = bedsKnown
      ? Math.min(activeOcc.length, beds)
      : activeOcc.length;
    const vacant = bedsKnown ? Math.max(0, beds - occupied) : 0;

    const recommendedPerBed = bedsKnown ? round2(monthlyCost / beds) : null;

    const charged = activeOcc.filter((o) => (o.chargePerBed || 0) > 0);
    const recoveryMonthly = round2(
      activeOcc.reduce((s, o) => s + occupantMonthlyCharge(o), 0),
    );
    const avgChargePerBed =
      charged.length > 0
        ? round2(
            charged.reduce((s, o) => s + occupantMonthlyCharge(o), 0) /
              charged.length,
          )
        : null;

    // Actual recovery from real deductions, scoped to the period.
    const recoveredMonthly = round2(recoveredByProperty.get(p.id) ?? 0);
    const recoveryGap = round2(monthlyRent - recoveredMonthly);
    const recoveryRate =
      monthlyRent > 0 ? round2((recoveredMonthly / monthlyRent) * 100) : null;
    const occupancyRate = bedsKnown ? round2((occupied / beds) * 100) : null;

    // Leak split. Vacancy loss = empty beds × break-even. Collection loss =
    // placed people whose ACTUAL deduction falls short of their expected
    // monthly charge (the dollars we should be withholding but aren't).
    const vacancyLoss =
      recommendedPerBed != null ? round2(vacant * recommendedPerBed) : 0;
    const collectionLoss = round2(
      activeOcc
        .filter((o) => o.bedId)
        .reduce((s, o) => {
          const expected = occupantMonthlyCharge(o);
          const actual = recoveredByOccupant.get(o.id) ?? 0;
          return s + Math.max(0, expected - actual);
        }, 0),
    );

    const underchargeLoss =
      recommendedPerBed != null
        ? round2(
            charged.reduce(
              (s, o) =>
                s + Math.max(0, recommendedPerBed - occupantMonthlyCharge(o)),
              0,
            ),
          )
        : 0;
    const monthlyLoss = round2(vacancyLoss + underchargeLoss);

    return {
      propertyId: p.id,
      customerId: p.customerId,
      name: p.name || p.id,
      propertyType: p.propertyType ?? "",
      monthlyRent: round2(monthlyRent),
      monthlyUtilities: round2(monthlyUtilities),
      monthlyCost,
      beds,
      bedsKnown,
      occupied,
      vacant,
      recommendedPerBed,
      avgChargePerBed,
      recoveryMonthly,
      recoveredMonthly,
      recoveryGap,
      recoveryRate,
      occupancyRate,
      vacancyLoss,
      collectionLoss,
      underchargeLoss,
      monthlyLoss,
      chargeDataMissing: activeOcc.length > charged.length,
    };
  });

  // Headline ordering: biggest recovery gap first.
  rows.sort((a, b) => b.recoveryGap - a.recoveryGap);

  const base: EconomicsSummary = {
    totalMonthlyCost: 0,
    totalRecovery: 0,
    totalRentCost: 0,
    totalRecovered: 0,
    totalRecoveryGap: 0,
    blendedRecoveryRate: null,
    totalVacancyLoss: 0,
    totalCollectionLoss: 0,
    chargedNotPlacedCount: chargedNotPlaced.size,
    totalMonthlyLoss: 0,
    totalBeds: 0,
    totalOccupied: 0,
    totalVacant: 0,
    propertiesLosing: 0,
    bedsUnknownCount: 0,
    periodMonth: period,
  };

  const summary = rows.reduce<EconomicsSummary>(
    (s, r) => ({
      ...s,
      totalMonthlyCost: round2(s.totalMonthlyCost + r.monthlyCost),
      totalRecovery: round2(s.totalRecovery + r.recoveryMonthly),
      totalRentCost: round2(s.totalRentCost + r.monthlyRent),
      totalRecovered: round2(s.totalRecovered + r.recoveredMonthly),
      totalVacancyLoss: round2(s.totalVacancyLoss + r.vacancyLoss),
      totalCollectionLoss: round2(s.totalCollectionLoss + r.collectionLoss),
      totalMonthlyLoss: round2(s.totalMonthlyLoss + r.monthlyLoss),
      totalBeds: s.totalBeds + r.beds,
      totalOccupied: s.totalOccupied + r.occupied,
      totalVacant: s.totalVacant + r.vacant,
      propertiesLosing: s.propertiesLosing + (r.recoveryGap > 0 ? 1 : 0),
      bedsUnknownCount: s.bedsUnknownCount + (r.bedsKnown ? 0 : 1),
    }),
    base,
  );
  summary.totalRecoveryGap = round2(summary.totalRentCost - summary.totalRecovered);
  summary.blendedRecoveryRate =
    summary.totalRentCost > 0
      ? round2((summary.totalRecovered / summary.totalRentCost) * 100)
      : null;

  return { rows, summary };
}
