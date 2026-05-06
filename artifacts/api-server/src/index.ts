import { pushSchemaIfNeeded } from "@workspace/db";
import app from "./app";
import { logger } from "./lib/logger";
import { postSchemaDriftNotification } from "./lib/notify-schema-drift";
import { seedIfEmpty } from "./lib/seed";
import { seedAdientIfMissing } from "./lib/seed-adient";
import { seedAttachedLeasesIfMissing } from "./lib/seed-attached-leases";
import { backfillOccupantMoveInDates } from "./lib/backfill-occupant-move-in";
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
