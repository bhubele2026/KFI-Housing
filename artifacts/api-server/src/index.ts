import { pushSchemaIfNeeded } from "@workspace/db";
import app from "./app";
import { logger } from "./lib/logger";
import { seedIfEmpty } from "./lib/seed";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const isProduction = process.env["NODE_ENV"] === "production";

async function start(): Promise<void> {
  try {
    await pushSchemaIfNeeded({
      checkOnly: isProduction,
      log: (message, extra) => {
        if (extra) {
          logger.info(extra, message);
        } else {
          logger.info(message);
        }
      },
    });
  } catch (err) {
    if (isProduction) {
      logger.error(
        { err },
        "Database schema is out of date in production — run `pnpm --filter @workspace/db run push` to apply pending changes",
      );
    } else {
      logger.error({ err }, "Failed to apply database schema changes");
    }
    process.exit(1);
  }

  try {
    await seedIfEmpty();
  } catch (err) {
    logger.error({ err }, "Failed to seed database");
    process.exit(1);
  }

  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
  });
}

void start();
