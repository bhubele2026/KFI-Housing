import { pushSchemaIfNeeded } from "@workspace/db";
import app from "./app";
import { logger } from "./lib/logger";
import { postSchemaDriftNotification } from "./lib/notify-schema-drift";
import { seedIfEmpty } from "./lib/seed";
import { seedAdientIfMissing } from "./lib/seed-adient";
import { seedAttachedLeasesIfMissing } from "./lib/seed-attached-leases";
import { seedGreenockManorIfMissing } from "./lib/seed-greenock-manor";
import { seedKolbeWausauIfMissing } from "./lib/seed-kolbe-wausau";
import { seedPatriotBarabooIfMissing } from "./lib/seed-patriot-baraboo";
import { seedHickoryHavenIfMissing } from "./lib/seed-hickory-haven";
import { seedParkPlaceIfMissing } from "./lib/seed-park-place";
import { backfillOccupantMoveInDates } from "./lib/backfill-occupant-move-in";
import { backfillOccupantPayrollIds } from "./lib/backfill-occupant-payroll-ids";
import { seedHousingDeductions } from "./lib/seed-housing-deductions";
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
  seedHousingDeductions: async () => {
    await seedHousingDeductions();
  },
  seedAttachedLeasesIfMissing: async () => {
    await seedAttachedLeasesIfMissing();
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
  logger,
  env: process.env,
  exit: (code) => process.exit(code),
});
