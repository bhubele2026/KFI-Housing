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
    listen: vi.fn().mockResolvedValue(undefined),
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
});
