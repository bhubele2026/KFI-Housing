import type { Bed, Occupant } from "@/data/mockData";

/**
 * Shift coverage for a hot-bed pair (Task #506).
 *
 * Two beds in a bedroom share the room across non-overlapping shifts.
 * The canonical "fully covered" pair is `Days` + `Nights`; any two
 * different non-empty shift values also count as covered (different
 * times = no conflict). Two of the same shift value = double-booked
 * (rose); a single shift with the partner unset = half-covered (amber);
 * neither set = empty (muted).
 */
export type PairCoverage = {
  letter: string;
  pairLabel: string;
  bedNumbers: [number, number];
  shifts: Array<string | null>;
  /** Pair is the canonical Days+Nights combo. */
  isCanonical: boolean;
  /** Both slots filled with two different shifts. */
  isFullyCovered: boolean;
  /** Both slots filled with the same shift value. */
  hasDuplicate: boolean;
  /** Exactly one slot has a shift set. */
  isHalfCovered: boolean;
  /** Neither slot has a shift set. */
  isEmpty: boolean;
};

const CANONICAL_A = "Days";
const CANONICAL_B = "Nights";

export function computeShiftPairs(
  beds: Bed[],
  occupants: Occupant[],
): PairCoverage[] {
  const sorted = [...beds].sort((a, b) => a.bedNumber - b.bedNumber);
  const pairs: PairCoverage[] = [];
  for (let i = 0; i + 1 < sorted.length; i += 2) {
    const left = sorted[i];
    const right = sorted[i + 1];
    const leftOcc = occupants.find(o => o.bedId === left.id && o.status === "Active");
    const rightOcc = occupants.find(o => o.bedId === right.id && o.status === "Active");
    const shifts: Array<string | null> = [
      leftOcc?.shift ?? null,
      rightOcc?.shift ?? null,
    ];
    const filled = shifts.filter((s): s is string => !!s);
    const isEmpty = filled.length === 0;
    const isHalfCovered = filled.length === 1;
    const hasDuplicate = filled.length === 2 && shifts[0] === shifts[1];
    const isFullyCovered = filled.length === 2 && shifts[0] !== shifts[1];
    const isCanonical =
      isFullyCovered &&
      ((shifts[0] === CANONICAL_A && shifts[1] === CANONICAL_B) ||
        (shifts[0] === CANONICAL_B && shifts[1] === CANONICAL_A));
    pairs.push({
      letter: String.fromCharCode(65 + i / 2),
      pairLabel: `Bedroom ${String.fromCharCode(65 + i / 2)}`,
      bedNumbers: [left.bedNumber, right.bedNumber],
      shifts,
      isCanonical,
      isFullyCovered,
      hasDuplicate,
      isHalfCovered,
      isEmpty,
    });
  }
  return pairs;
}

export function roomHasAnyShift(beds: Bed[], occupants: Occupant[]): boolean {
  return beds.some(b => {
    const occ = occupants.find(o => o.bedId === b.id && o.status === "Active");
    return occ?.shift != null;
  });
}

/**
 * Build the human-facing status sentence for a coverage pair (Task #506).
 *
 * Examples:
 *   - Days + Nights (canonical) → "Days + Nights"
 *   - Days + Overnights → "Days + Overnights"
 *   - Days only, partner unset → "Days only — needs Nights" (canonical
 *     partner suggested when a canonical half is set; otherwise just
 *     "<shift> only")
 *   - Days + Days (duplicate) → "Two Days shifts — double-booked"
 *   - Empty → "No shifts set"
 */
export function pairStatusLabel(pair: PairCoverage): string {
  if (pair.hasDuplicate) {
    return `Two ${pair.shifts[0]} shifts — double-booked`;
  }
  if (pair.isEmpty) return "No shifts set";
  if (pair.isHalfCovered) {
    const have = pair.shifts.find((s): s is string => !!s)!;
    if (have === CANONICAL_A) return `${have} only — needs ${CANONICAL_B}`;
    if (have === CANONICAL_B) return `${have} only — needs ${CANONICAL_A}`;
    return `${have} only`;
  }
  // Fully covered (canonical or otherwise) — show both shifts joined.
  return `${pair.shifts[0]} + ${pair.shifts[1]}`;
}
