import { pushSchemaIfNeeded } from "@workspace/db";
import app from "./app";
import { logger } from "./lib/logger";
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
  logger,
  env: process.env,
  exit: (code) => process.exit(code),
});
