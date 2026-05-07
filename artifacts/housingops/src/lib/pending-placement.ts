/**
 * Synthetic "Roster — Pending Placement (<Customer>)" properties hold the
 * payroll-only people who appear on the weekly housing-deduction roster
 * but haven't been placed in a real bed yet. They are seeded server-side
 * by `seedPayrollOccupantsIfMissing` (Task #305) and the property page
 * renders a focused board (Task #322) so operators can move each person
 * into a real property + bed without leaving the page.
 *
 * The prefix MUST stay byte-identical to the api-server constant of the
 * same name (`artifacts/api-server/src/lib/seed-payroll-occupants.ts`).
 */
export const PENDING_PLACEMENT_PROPERTY_PREFIX = "Roster — Pending Placement";

export function isPendingPlacementProperty(name: string | null | undefined): boolean {
  if (!name) return false;
  return name.startsWith(PENDING_PLACEMENT_PROPERTY_PREFIX);
}
