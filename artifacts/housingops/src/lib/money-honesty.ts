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

/** Fraction of housed people who must be unsynced before we hide the net. */
const SYNCING_THRESHOLD = 0.8;

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

  // "Mostly unsynced": nothing collected at all, or ≥80% of the housed are
  // either not-in-payroll or sitting at a $0 deduction. Use max() (not sum) so
  // the two overlapping signals don't double-count past 100%.
  const unsynced = Math.max(notInPayroll, zeroDeduction);
  const mostlyUnsynced = collected === 0 || unsynced >= SYNCING_THRESHOLD * people;
  if (mostlyUnsynced && cost > 0) {
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
