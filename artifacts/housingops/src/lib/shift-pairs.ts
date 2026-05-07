import type { Bed, Occupant } from "@/data/mockData";

export type PairCoverage = {
  letter: string;
  pairLabel: string;
  bedNumbers: [number, number];
  shifts: Array<"1st" | "2nd" | null>;
  hasFirst: boolean;
  hasSecond: boolean;
  hasDuplicate: boolean;
  isFullyCovered: boolean;
  isEmpty: boolean;
};

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
    const shifts: Array<"1st" | "2nd" | null> = [
      leftOcc?.shift ?? null,
      rightOcc?.shift ?? null,
    ];
    const hasFirst = shifts.includes("1st");
    const hasSecond = shifts.includes("2nd");
    const hasDuplicate =
      (shifts[0] !== null && shifts[0] === shifts[1]);
    const isEmpty = shifts.every(s => s === null);
    pairs.push({
      letter: String.fromCharCode(65 + i / 2),
      pairLabel: `Bedroom ${String.fromCharCode(65 + i / 2)}`,
      bedNumbers: [left.bedNumber, right.bedNumber],
      shifts,
      hasFirst,
      hasSecond,
      hasDuplicate,
      isFullyCovered: hasFirst && hasSecond && !hasDuplicate,
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
