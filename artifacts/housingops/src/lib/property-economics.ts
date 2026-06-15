import {
  sumActiveRent,
  type Property,
  type Lease,
  type Occupant,
  type Utility,
} from "@/data/mockData";

/**
 * Per-property unit economics: what a property costs each month, how many
 * beds it has, how many sit empty, what we *should* charge per bed to break
 * even, what we actually collect, and the monthly money lost to (a) vacant
 * beds and (b) occupants charged below the break-even per-bed number.
 *
 * The whole point (per the operator): "if the rent is stupid high, and we
 * have vacant beds, and deductions that are too damn low — we need to know."
 *
 * Beds are operator-owned and often unknown — when `property.totalBeds` is 0
 * the row is flagged `bedsKnown=false` and per-bed math is withheld (no
 * misleading $0 or Infinity) until someone fills the bed count in.
 */

const MONTHS_PER_WEEK = 52 / 12;
const MONTHS_PER_BIWEEK = 26 / 12;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Normalize an occupant's housing charge to a monthly figure. */
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
  recoveryMonthly: number;
  vacancyLoss: number;
  underchargeLoss: number;
  monthlyLoss: number;
  /** true when at least one active occupant has no charge on file (so undercharge is understated). */
  chargeDataMissing: boolean;
}

export interface EconomicsSummary {
  totalMonthlyCost: number;
  totalRecovery: number;
  totalMonthlyLoss: number;
  totalBeds: number;
  totalOccupied: number;
  totalVacant: number;
  propertiesLosing: number;
  bedsUnknownCount: number;
}

export function computePropertyEconomics(
  properties: readonly Property[],
  leases: readonly Lease[],
  occupants: readonly Occupant[],
  utilities: readonly Utility[],
): { rows: EconomicsRow[]; summary: EconomicsSummary } {
  const rows = properties.map((p): EconomicsRow => {
    const activeRent = sumActiveRent(leases, p.id);
    const monthlyRent = activeRent > 0 ? activeRent : p.monthlyRent || 0;
    const monthlyUtilities = utilities.reduce(
      (s, u) => (u.propertyId === p.id ? s + (u.monthlyCost || 0) : s),
      0,
    );
    const monthlyCost = round2(monthlyRent + monthlyUtilities);

    const beds = p.totalBeds || 0;
    const bedsKnown = beds > 0;

    const activeOcc = occupants.filter(
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

    const vacancyLoss =
      recommendedPerBed != null ? round2(vacant * recommendedPerBed) : 0;
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
      vacancyLoss,
      underchargeLoss,
      monthlyLoss,
      chargeDataMissing: activeOcc.length > charged.length,
    };
  });

  rows.sort((a, b) => b.monthlyLoss - a.monthlyLoss);

  const summary = rows.reduce<EconomicsSummary>(
    (s, r) => ({
      totalMonthlyCost: round2(s.totalMonthlyCost + r.monthlyCost),
      totalRecovery: round2(s.totalRecovery + r.recoveryMonthly),
      totalMonthlyLoss: round2(s.totalMonthlyLoss + r.monthlyLoss),
      totalBeds: s.totalBeds + r.beds,
      totalOccupied: s.totalOccupied + r.occupied,
      totalVacant: s.totalVacant + r.vacant,
      propertiesLosing: s.propertiesLosing + (r.monthlyLoss > 0 ? 1 : 0),
      bedsUnknownCount: s.bedsUnknownCount + (r.bedsKnown ? 0 : 1),
    }),
    {
      totalMonthlyCost: 0,
      totalRecovery: 0,
      totalMonthlyLoss: 0,
      totalBeds: 0,
      totalOccupied: 0,
      totalVacant: 0,
      propertiesLosing: 0,
      bedsUnknownCount: 0,
    },
  );

  return { rows, summary };
}
