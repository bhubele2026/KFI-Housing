import { Router, type IRouter } from "express";
import { db, occupantsTable, bedsTable, propertiesTable } from "@workspace/db";
import { getOccupantDeductionsBatch } from "../lib/occupant-deduction";
import { logger } from "../lib/logger";

const router: IRouter = Router();

interface AttentionItem {
  kind: string;
  label: string;
  dollarsAtRisk: number;
  fixHref: string;
}

const MONTHLY_FROM_WEEKLY = 52 / 12;

// ---------------------------------------------------------------------------
// Overhaul refinement #1 — the unified "needs attention" leak inbox. Merges
// every money leak, sorted by dollars at risk, each with a one-click fixHref.
// Direct-fetch; degrades to [] on failure.
// ---------------------------------------------------------------------------
router.get("/attention", async (_req, res): Promise<void> => {
  try {
    const occs = await db
      .select({
        id: occupantsTable.id,
        name: occupantsTable.name,
        status: occupantsTable.status,
        bedId: occupantsTable.bedId,
        propertyId: occupantsTable.propertyId,
        zenopleStatus: occupantsTable.zenopleStatus,
      })
      .from(occupantsTable);
    const props = await db
      .select({
        id: propertiesTable.id,
        name: propertiesTable.name,
        monthlyRent: propertiesTable.monthlyRent,
        status: propertiesTable.status,
      })
      .from(propertiesTable);
    const beds = await db
      .select({ id: bedsTable.id, propertyId: bedsTable.propertyId, occupantId: bedsTable.occupantId, status: bedsTable.status })
      .from(bedsTable);

    const ded = await getOccupantDeductionsBatch(occs.map((o) => o.id)).catch(
      () => new Map<string, { weeklyAmount: number }>(),
    );
    const weeklyOf = (id: string) => ded.get(id)?.weeklyAmount ?? 0;

    const items: AttentionItem[] = [];
    const placedByProp = new Map<string, number>();
    for (const o of occs) {
      if (o.status === "Active" && o.bedId) {
        placedByProp.set(o.propertyId ?? "", (placedByProp.get(o.propertyId ?? "") ?? 0) + 1);
      }
    }
    const rentShare = (propertyId: string | null) => {
      const p = props.find((x) => x.id === propertyId);
      if (!p) return 0;
      const occupied = placedByProp.get(p.id) ?? 0;
      return occupied > 0 ? (p.monthlyRent ?? 0) / occupied : p.monthlyRent ?? 0;
    };

    // Person-level leaks.
    for (const o of occs) {
      if (o.status === "Active" && o.bedId && weeklyOf(o.id) <= 0) {
        items.push({
          kind: "zero_charge_in_bed",
          label: `${o.name} is in a bed with no deduction`,
          dollarsAtRisk: Math.round(rentShare(o.propertyId)),
          fixHref: `/occupants/${o.id}`,
        });
      }
      if (o.status === "Active" && o.bedId && o.zenopleStatus !== "linked") {
        items.push({
          kind: "not_in_payroll",
          label: `${o.name} is housed but not linked to payroll`,
          dollarsAtRisk: Math.round(rentShare(o.propertyId)),
          fixHref: `/zenople-review`,
        });
      }
      if (o.status === "Former" && weeklyOf(o.id) > 0) {
        items.push({
          kind: "former_still_charged",
          label: `${o.name} moved out but still has a deduction`,
          dollarsAtRisk: Math.round(weeklyOf(o.id) * MONTHLY_FROM_WEEKLY),
          fixHref: `/occupants/${o.id}`,
        });
      }
    }

    // Property-level leaks.
    for (const p of props) {
      if (p.status !== "Active") continue;
      const occupied = placedByProp.get(p.id) ?? 0;
      if ((p.monthlyRent ?? 0) > 0 && occupied === 0) {
        items.push({
          kind: "rent_no_occupants",
          label: `${p.name}: paying rent with nobody housed`,
          dollarsAtRisk: Math.round(p.monthlyRent ?? 0),
          fixHref: `/properties/${p.id}`,
        });
      }
      if ((p.monthlyRent ?? 0) === 0 && occupied > 0) {
        items.push({
          kind: "occupants_no_rent",
          label: `${p.name}: ${occupied} housed but $0 rent recorded`,
          dollarsAtRisk: 0,
          fixHref: `/properties/${p.id}`,
        });
      }
    }

    items.sort((a, b) => b.dollarsAtRisk - a.dollarsAtRisk);
    const totalAtRisk = items.reduce((s, i) => s + i.dollarsAtRisk, 0);
    res.json({ count: items.length, totalAtRisk, items });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ err: message }, "attention inbox failed");
    res.json({ count: 0, totalAtRisk: 0, items: [] });
  }
});

export default router;
