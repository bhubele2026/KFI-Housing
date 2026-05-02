import { describe, expect, it, vi } from "vitest";
import {
  buildPushSchemaOptions,
  isProductionEnv,
  start,
  type StartDeps,
} from "./start";

function fakeLogger() {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  };
}

function makeDeps(overrides: Partial<StartDeps> = {}): StartDeps {
  return {
    pushSchemaIfNeeded: vi.fn().mockResolvedValue({
      applied: false,
      statements: [],
      warnings: [],
      hasDataLoss: false,
    }),
    seedIfEmpty: vi.fn().mockResolvedValue(undefined),
    cleanupLeaseDates: vi.fn().mockResolvedValue(0),
    listen: vi.fn().mockResolvedValue(undefined),
    notifySchemaDrift: vi.fn().mockResolvedValue(undefined),
    logger: fakeLogger(),
    env: { PORT: "3000" },
    exit: vi.fn() as unknown as (code: number) => never,
    ...overrides,
  };
}

describe("isProductionEnv", () => {
  it("is true only when NODE_ENV is exactly 'production'", () => {
    expect(isProductionEnv({ NODE_ENV: "production" })).toBe(true);
    expect(isProductionEnv({ NODE_ENV: "development" })).toBe(false);
    expect(isProductionEnv({ NODE_ENV: "" })).toBe(false);
    expect(isProductionEnv({})).toBe(false);
  });
});

describe("buildPushSchemaOptions", () => {
  it("sets checkOnly: true in production", () => {
    const opts = buildPushSchemaOptions(
      { NODE_ENV: "production" },
      fakeLogger(),
    );
    expect(opts.checkOnly).toBe(true);
  });

  it("sets checkOnly: false outside of production", () => {
    expect(
      buildPushSchemaOptions({ NODE_ENV: "development" }, fakeLogger())
        .checkOnly,
    ).toBe(false);
    expect(
      buildPushSchemaOptions({ NODE_ENV: "test" }, fakeLogger()).checkOnly,
    ).toBe(false);
    expect(buildPushSchemaOptions({}, fakeLogger()).checkOnly).toBe(false);
  });
});

describe("start", () => {
  it("validates PORT before doing any DB work", async () => {
    const pushSchemaIfNeeded = vi.fn();
    const seedIfEmpty = vi.fn();
    const listen = vi.fn();

    await expect(
      start(
        makeDeps({
          pushSchemaIfNeeded,
          seedIfEmpty,
          listen,
          env: { NODE_ENV: "production" },
        }),
      ),
    ).rejects.toThrow(/PORT/);

    expect(pushSchemaIfNeeded).not.toHaveBeenCalled();
    expect(seedIfEmpty).not.toHaveBeenCalled();
    expect(listen).not.toHaveBeenCalled();
  });


  it("passes checkOnly: true to pushSchemaIfNeeded when NODE_ENV=production", async () => {
    const pushSchemaIfNeeded = vi.fn().mockResolvedValue({
      applied: false,
      statements: [],
      warnings: [],
      hasDataLoss: false,
    });

    await start(
      makeDeps({
        pushSchemaIfNeeded,
        env: { NODE_ENV: "production", PORT: "3000" },
      }),
    );

    expect(pushSchemaIfNeeded).toHaveBeenCalledTimes(1);
    const calledWith = pushSchemaIfNeeded.mock.calls[0]?.[0];
    expect(calledWith?.checkOnly).toBe(true);
  });

  it("passes checkOnly: false to pushSchemaIfNeeded outside of production", async () => {
    const pushSchemaIfNeeded = vi.fn().mockResolvedValue({
      applied: false,
      statements: [],
      warnings: [],
      hasDataLoss: false,
    });

    await start(
      makeDeps({
        pushSchemaIfNeeded,
        env: { NODE_ENV: "development", PORT: "3000" },
      }),
    );

    const calledWith = pushSchemaIfNeeded.mock.calls[0]?.[0];
    expect(calledWith?.checkOnly).toBe(false);
  });

  it("runs cleanupLeaseDates after seeding and before listening", async () => {
    const calls: string[] = [];
    const seedIfEmpty = vi.fn(async () => {
      calls.push("seed");
    });
    const cleanupLeaseDates = vi.fn(async () => {
      calls.push("cleanup");
      return 0;
    });
    const listen = vi.fn(async () => {
      calls.push("listen");
    });

    await start(
      makeDeps({
        seedIfEmpty,
        cleanupLeaseDates,
        listen,
        env: { NODE_ENV: "development", PORT: "3000" },
      }),
    );

    expect(cleanupLeaseDates).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["seed", "cleanup", "listen"]);
  });

  it("still listens when cleanupLeaseDates throws (logs and continues)", async () => {
    const cleanupLeaseDates = vi
      .fn()
      .mockRejectedValue(new Error("UPDATE failed"));
    const listen = vi.fn().mockResolvedValue(undefined);
    const logger = fakeLogger();

    await start(
      makeDeps({
        cleanupLeaseDates,
        listen,
        logger,
        env: { NODE_ENV: "development", PORT: "3000" },
      }),
    );

    expect(listen).toHaveBeenCalledTimes(1);
    const errorCalls = logger.error.mock.calls;
    expect(
      errorCalls.some(([, message]) =>
        /normalize lease dates/.test(String(message)),
      ),
    ).toBe(true);
  });

  it("exits with a production-specific error message when schema is out of date", async () => {
    const pushSchemaIfNeeded = vi
      .fn()
      .mockRejectedValue(new Error("Schema is out of date: 2 pending"));
    const logger = fakeLogger();
    const exit = vi.fn() as unknown as (code: number) => never;
    const seedIfEmpty = vi.fn();
    const listen = vi.fn();

    await start(
      makeDeps({
        pushSchemaIfNeeded,
        logger,
        exit,
        seedIfEmpty,
        listen,
        env: { NODE_ENV: "production", PORT: "3000" },
      }),
    );

    expect(exit).toHaveBeenCalledWith(1);
    expect(seedIfEmpty).not.toHaveBeenCalled();
    expect(listen).not.toHaveBeenCalled();

    const errorCalls = logger.error.mock.calls;
    expect(
      errorCalls.some(([, message]) =>
        /pnpm --filter @workspace\/db run push/.test(String(message)),
      ),
    ).toBe(true);
  });

  it("notifies the chat webhook when production schema drift is detected", async () => {
    const pushSchemaIfNeeded = vi
      .fn()
      .mockRejectedValue(
        new Error("Schema is out of date: 3 pending statement(s) detected."),
      );
    const notifySchemaDrift = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn() as unknown as (code: number) => never;

    await start(
      makeDeps({
        pushSchemaIfNeeded,
        notifySchemaDrift,
        exit,
        env: {
          NODE_ENV: "production",
          PORT: "3000",
          SCHEMA_DRIFT_WEBHOOK_URL: "https://hooks.example.com/T/B/X",
        },
      }),
    );

    expect(notifySchemaDrift).toHaveBeenCalledTimes(1);
    expect(notifySchemaDrift).toHaveBeenCalledWith({
      webhookUrl: "https://hooks.example.com/T/B/X",
      message: "Schema is out of date: 3 pending statement(s) detected.",
    });
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("does not notify when SCHEMA_DRIFT_WEBHOOK_URL is unset", async () => {
    const pushSchemaIfNeeded = vi
      .fn()
      .mockRejectedValue(new Error("Schema is out of date: 1 pending"));
    const notifySchemaDrift = vi.fn();
    const logger = fakeLogger();

    await start(
      makeDeps({
        pushSchemaIfNeeded,
        notifySchemaDrift,
        logger,
        env: { NODE_ENV: "production", PORT: "3000" },
      }),
    );

    expect(notifySchemaDrift).not.toHaveBeenCalled();
    const warnCalls = logger.warn.mock.calls;
    expect(
      warnCalls.some(([msg]) =>
        /SCHEMA_DRIFT_WEBHOOK_URL/.test(String(msg)),
      ),
    ).toBe(true);
  });

  it("does not notify outside of production even with a webhook configured", async () => {
    const pushSchemaIfNeeded = vi
      .fn()
      .mockRejectedValue(new Error("Schema is out of date: 1 pending"));
    const notifySchemaDrift = vi.fn();

    await start(
      makeDeps({
        pushSchemaIfNeeded,
        notifySchemaDrift,
        env: {
          NODE_ENV: "development",
          PORT: "3000",
          SCHEMA_DRIFT_WEBHOOK_URL: "https://hooks.example.com/T/B/X",
        },
      }),
    );

    expect(notifySchemaDrift).not.toHaveBeenCalled();
  });

  it("does not notify when production startup fails for a non-drift reason", async () => {
    const pushSchemaIfNeeded = vi
      .fn()
      .mockRejectedValue(new Error("ECONNREFUSED: cannot reach database"));
    const notifySchemaDrift = vi.fn();

    await start(
      makeDeps({
        pushSchemaIfNeeded,
        notifySchemaDrift,
        env: {
          NODE_ENV: "production",
          PORT: "3000",
          SCHEMA_DRIFT_WEBHOOK_URL: "https://hooks.example.com/T/B/X",
        },
      }),
    );

    expect(notifySchemaDrift).not.toHaveBeenCalled();
  });

  it("still exits cleanly if the chat webhook itself fails", async () => {
    const pushSchemaIfNeeded = vi
      .fn()
      .mockRejectedValue(new Error("Schema is out of date: 1 pending"));
    const notifySchemaDrift = vi
      .fn()
      .mockRejectedValue(new Error("webhook 500"));
    const logger = fakeLogger();
    const exit = vi.fn() as unknown as (code: number) => never;

    await start(
      makeDeps({
        pushSchemaIfNeeded,
        notifySchemaDrift,
        logger,
        exit,
        env: {
          NODE_ENV: "production",
          PORT: "3000",
          SCHEMA_DRIFT_WEBHOOK_URL: "https://hooks.example.com/T/B/X",
        },
      }),
    );

    expect(exit).toHaveBeenCalledWith(1);
    const errorCalls = logger.error.mock.calls;
    expect(
      errorCalls.some(([, message]) =>
        /Failed to send schema drift chat notification/.test(String(message)),
      ),
    ).toBe(true);
  });
});
