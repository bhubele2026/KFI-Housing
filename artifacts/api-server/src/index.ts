import { pushSchemaIfNeeded } from "@workspace/db";
import app from "./app";
import { logger } from "./lib/logger";
import { postSchemaDriftNotification } from "./lib/notify-schema-drift";
import { seedIfEmpty } from "./lib/seed";
import { start } from "./start";

void start({
  pushSchemaIfNeeded,
  seedIfEmpty,
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
