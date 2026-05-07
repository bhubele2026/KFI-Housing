import { pushSchemaIfNeeded, db, leasesTable, propertiesTable } from "@workspace/db";
import app from "./app";
import { logger } from "./lib/logger";
import { postSchemaDriftNotification } from "./lib/notify-schema-drift";
import { seedIfEmpty } from "./lib/seed";
import { seedAdientIfMissing } from "./lib/seed-adient";
import { seedAttachedLeasesIfMissing } from "./lib/seed-attached-leases";
import { seedChateauKnollIfMissing } from "./lib/seed-chateau-knoll";
import { seedGreenockManorIfMissing } from "./lib/seed-greenock-manor";
import { seedKolbeWausauIfMissing } from "./lib/seed-kolbe-wausau";
import { seedPatriotBarabooIfMissing } from "./lib/seed-patriot-baraboo";
import { seedHickoryHavenIfMissing } from "./lib/seed-hickory-haven";
import { seedParkPlaceIfMissing } from "./lib/seed-park-place";
// Re-exported from `./lib/seed` so the boot-sequence integration point
// for post-master-import seeds (#295 and friends) lives next to the
// other seed entry points.
import { seedRidgeMotorInnIfMissing } from "./lib/seed";
import { backfillOccupantMoveInDates } from "./lib/backfill-occupant-move-in";
import { backfillOccupantPayrollIds } from "./lib/backfill-occupant-payroll-ids";
import { seedHousingDeductions } from "./lib/seed-housing-deductions";
import { importDefaultMasterLeasesIfMissing } from "./lib/import-master-leases";
import { seedPayrollOccupantsIfMissing } from "./lib/seed-payroll-occupants";
import { start } from "./start";

void start({
  pushSchemaIfNeeded,
  seedIfEmpty,
  backfillOccupantMoveInDates: async () => {
    await backfillOccupantMoveInDates();
  },
  seedAdientIfMissing: async () => {
    await seedAdientIfMissing();
  },
  importDefaultMasterLeasesIfMissing: async () => {
    await importDefaultMasterLeasesIfMissing();
  },
  seedPatriotBarabooIfMissing: async () => {
    await seedPatriotBarabooIfMissing();
  },
  backfillOccupantPayrollIds: async () => {
    await backfillOccupantPayrollIds();
  },
  seedHickoryHavenIfMissing: async () => {
    await seedHickoryHavenIfMissing();
  },
  seedGreenockManorIfMissing: async () => {
    await seedGreenockManorIfMissing();
  },
  seedParkPlaceIfMissing: async () => {
    await seedParkPlaceIfMissing();
  },
  seedKolbeWausauIfMissing: async () => {
    await seedKolbeWausauIfMissing();
  },
  seedPayrollOccupantsIfMissing: async () => {
    await seedPayrollOccupantsIfMissing();
  },
  seedHousingDeductions: async () => {
    await seedHousingDeductions();
  },
  seedAttachedLeasesIfMissing: async () => {
    await seedAttachedLeasesIfMissing();
  },
  seedChateauKnollIfMissing: async () => {
    await seedChateauKnollIfMissing();
  },
  seedRidgeMotorInnIfMissing: async () => {
    await seedRidgeMotorInnIfMissing();
  },
  listen: (port) =>
    new Promise<void>((resolve, reject) => {
      app.listen(port, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    }),
  notifySchemaDrift: ({ webhookUrl, message }) =>
    postSchemaDriftNotification({ webhookUrl, message }),
  loadLeasesForDigest: async () => {
    const rows = await db.select().from(leasesTable);
    return rows.map((r) => ({
      id: r.id,
      propertyId: r.propertyId,
      startDate: r.startDate,
      endDate: r.endDate,
      status: r.status,
      vendor: r.vendor,
    }));
  },
  loadPropertiesForDigest: async () => {
    const rows = await db.select().from(propertiesTable);
    return rows.map((r) => ({ id: r.id, name: r.name }));
  },
  digestFetch: globalThis.fetch,
  logger,
  env: process.env,
  exit: (code) => process.exit(code),
});
