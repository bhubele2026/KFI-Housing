import { Router, type IRouter } from "express";
import { db, occupantsTable, propertiesTable, customersTable } from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Overhaul refinement #6 — command bar (⌘K). One query over occupants,
// properties, customers. Direct-fetch; case-insensitive substring, capped ~20.
// ---------------------------------------------------------------------------
router.get("/search", async (req, res): Promise<void> => {
  try {
    const q = (typeof req.query.q === "string" ? req.query.q : "").trim().toLowerCase();
    if (!q) {
      res.json({ results: [] });
      return;
    }
    const [occs, props, custs] = await Promise.all([
      db.select({ id: occupantsTable.id, name: occupantsTable.name, propertyId: occupantsTable.propertyId }).from(occupantsTable),
      db.select({ id: propertiesTable.id, name: propertiesTable.name, city: propertiesTable.city }).from(propertiesTable),
      db.select({ id: customersTable.id, name: customersTable.name }).from(customersTable),
    ]);

    const results: { type: string; id: string; label: string; href: string }[] = [];
    for (const c of custs) {
      if ((c.name ?? "").toLowerCase().includes(q)) {
        results.push({ type: "customer", id: c.id, label: c.name, href: `/customers/${c.id}` });
      }
    }
    for (const p of props) {
      if (`${p.name} ${p.city ?? ""}`.toLowerCase().includes(q)) {
        results.push({ type: "property", id: p.id, label: p.name, href: `/properties/${p.id}` });
      }
    }
    for (const o of occs) {
      if ((o.name ?? "").toLowerCase().includes(q)) {
        results.push({ type: "occupant", id: o.id, label: o.name, href: `/occupants/${o.id}` });
      }
    }
    res.json({ results: results.slice(0, 20) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ err: message }, "search failed");
    res.json({ results: [] });
  }
});

export default router;
