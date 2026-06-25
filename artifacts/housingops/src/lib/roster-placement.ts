// Single source of truth for the roster "placed" count, so the nav tile and
// the Roster page header never disagree.
//
// A roster PERSON (from the active-roster API, keyed by personId) is "placed"
// when their personId matches a non-Former app occupant who holds a bed.
// personId === occupant.employeeId. When the same employee has more than one
// occupant record, the bed-holding one wins (mirrors the Roster page's
// `occByEmp`). The denominator is the number of roster people, NOT the number
// of app occupants — counting "all occupants in a bed" (a different set that
// includes people not on the active roster) is the bug this replaces.

export interface RosterPersonLike {
  personId: string;
}

/** Count how many active-roster people are placed in a bed. */
export function countPlacedRoster(
  people: readonly RosterPersonLike[],
  occupants: readonly Record<string, unknown>[],
): { total: number; placed: number; unplaced: number } {
  // employeeId -> does this employee hold a bed (preferring a bed-placed row).
  const bedByEmp = new Map<string, boolean>();
  for (const o of occupants) {
    if ((o.status as string) === "Former") continue;
    const emp = (o.employeeId as string) || "";
    if (!emp) continue;
    const hasBed = !!((o.bedId as string) || "");
    const prev = bedByEmp.get(emp);
    if (prev === undefined || (hasBed && !prev)) bedByEmp.set(emp, hasBed);
  }

  let placed = 0;
  for (const p of people) {
    if (bedByEmp.get(p.personId)) placed++;
  }
  const total = people.length;
  return { total, placed, unplaced: total - placed };
}
