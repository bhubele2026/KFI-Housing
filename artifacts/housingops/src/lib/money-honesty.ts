// Phase 11 — money honesty. The portfolio reads "bankrupt" (−$86k, clients at
// −$14k) only because rent is set while collected deductions are still syncing.
// A net is the truth ONLY when collected is real for that scope. When a scope
// has people + rent but no collected yet, the deductions are still syncing —
// surface that, never a giant red −$rent that reads as fact.
//
// Use `netDisplay(...)` for any net/spread figure on the customer, property,
// properties, and customer-overview surfaces. The Dashboard money-this-period
// is LOCKED — do not route it through here.

export interface NetInput {
  /** Monthly collected (housing deductions rolled up for the scope). */
  collected: number;
  /** Monthly rent the company is responsible for. */
  rent: number;
  /** Monthly utilities / other costs, if the scope tracks them. */
  utilities?: number;
  /** Active occupants in scope — distinguishes "empty" from "not-yet-synced". */
  occupants?: number;
}

export type NetDisplay =
  | { kind: "net"; value: number }
  | { kind: "syncing"; cost: number; label: string };

/**
 * Returns either a real net (when collected is present) or a "syncing" state
 * (when rent/cost is set, people are housed, but nothing has been collected
 * yet — so a raw `collected − rent` would be a misleading negative).
 */
export function netDisplay({
  collected,
  rent,
  utilities = 0,
  occupants = 0,
}: NetInput): NetDisplay {
  const cost = rent + utilities;
  const hasCollected = collected > 0;
  // People housed + a real cost on the books but $0 collected → not a loss,
  // the deductions just haven't landed yet.
  if (!hasCollected && cost > 0 && occupants > 0) {
    return { kind: "syncing", cost, label: "Collecting · rent set" };
  }
  return { kind: "net", value: collected - cost };
}

/** Convenience: is this scope's net safe to show as a hard number? */
export function netIsReal(input: NetInput): boolean {
  return netDisplay(input).kind === "net";
}
