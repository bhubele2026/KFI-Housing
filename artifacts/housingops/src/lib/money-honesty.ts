// Money honesty — the single source of truth for whether a net figure is shown
// as a real signed number, as "syncing", or as "no one housed yet". The
// portfolio reads "bankrupt" only because rent is set while deductions are
// still syncing (or nobody is housed yet). A net is the TRUTH only when people
// are housed AND their deductions are mostly synced.
//
// Use `netDisplay(...)` (a.k.a. getNetDisplay) for EVERY net/spread figure:
// dashboard, customer list, customer detail, property list, property detail,
// and the bed board. One function, one decision — never a red −$ that's really
// just incomplete collections or an empty property.

export interface NetInput {
  /** Monthly collected (housing deductions rolled up for the scope). */
  collected: number;
  /** Monthly rent the company is responsible for. */
  rent: number;
  /** Monthly utilities / other costs, if the scope tracks them. */
  utilities?: number;
  /** Active occupants placed in a bed in scope. Preferred signal. */
  housed?: number;
  /** Back-compat alias for {@link housed}. */
  occupants?: number;
  /** Housed people not yet Zenople-linked (no payroll match). */
  notInPayroll?: number;
  /** Housed people whose deduction is $0/wk (synced but not charged). */
  zeroDeduction?: number;
}

export type NetDisplay =
  | { kind: "net"; value: number }
  | { kind: "syncing"; cost: number; label: string }
  | { kind: "none"; cost: number; label: string };

/** Collected/cost ratio below which a shortfall reads as "still syncing"
 *  rather than a real loss (in this model a synced scope collects ≈ its rent,
 *  so a big gap is almost always unsynced deductions, not a true loss). */
const COVERAGE_FLOOR = 0.85;

/**
 * Decide how a scope's net should render:
 *  - `none`    — nobody housed yet → never a red −$ (just rent on the books).
 *  - `syncing` — people housed but ≥80% aren't collecting yet (not-in-payroll
 *                or $0 deduction), or nothing has been collected → not a loss.
 *  - `net`     — a genuine signed number (people housed + deductions synced).
 */
export function netDisplay({
  collected,
  rent,
  utilities = 0,
  housed,
  occupants,
  notInPayroll = 0,
  zeroDeduction = 0,
}: NetInput): NetDisplay {
  const cost = rent + utilities;
  const people = housed ?? occupants ?? 0;

  // Nobody housed → there is nothing to collect; rent alone is not a "loss".
  if (people <= 0) {
    return { kind: "none", cost, label: "no one housed yet" };
  }

  const unsynced = Math.max(notInPayroll, zeroDeduction);
  const shortfall = collected < cost; // would render as a red negative
  const coverage = cost > 0 ? collected / cost : 1;
  // A negative spread is "still syncing" (NOT a real loss) when the gap is
  // explained by deductions that haven't landed: nothing collected at all; OR
  // a shortfall while some housed people are not-in-payroll / at $0; OR a
  // shortfall where collected sits far below rent (collected ≪ rent). A real
  // red number only shows when people are housed AND collections are basically
  // complete (coverage near rent, nobody outstanding) yet still below cost.
  const mostlyUnsynced =
    cost > 0 &&
    (collected === 0 ||
      (shortfall && (unsynced > 0 || coverage < COVERAGE_FLOOR)));
  if (mostlyUnsynced) {
    return { kind: "syncing", cost, label: "rent set · syncing" };
  }

  return { kind: "net", value: collected - cost };
}

/** Alias — the brief's preferred name for the same single shared function. */
export const getNetDisplay = netDisplay;

/** Convenience: is this scope's net safe to show as a hard signed number? */
export function netIsReal(input: NetInput): boolean {
  return netDisplay(input).kind === "net";
}
