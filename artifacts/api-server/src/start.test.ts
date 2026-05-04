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
        // Maps key set so we don't hit the Task #191 fast-fail
        // before pushSchema gets called.
        env: {
          NODE_ENV: "production",
          PORT: "3000",
          GOOGLE_MAPS_API_KEY: "live-key",
        },
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
        // GOOGLE_MAPS_API_KEY is set so this test exercises the
        // schema-out-of-date path rather than the Task #191
        // missing-key fast-fail (which runs before pushSchema).
        env: {
          NODE_ENV: "production",
          PORT: "3000",
          GOOGLE_MAPS_API_KEY: "live-key",
        },
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
          // See sibling test — sets the maps key so this scenario
          // reaches the schema-drift webhook path instead of the
          // Task #191 missing-key fast-fail.
          GOOGLE_MAPS_API_KEY: "live-key",
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
        env: {
          NODE_ENV: "production",
          PORT: "3000",
          // Set so the test reaches the schema path rather than the
          // Task #191 missing-key fast-fail.
          GOOGLE_MAPS_API_KEY: "live-key",
        },
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
          // Same as sibling tests — maps key set so the test exercises
          // the non-drift schema-failure path, not the Task #191
          // fast-fail.
          GOOGLE_MAPS_API_KEY: "live-key",
        },
      }),
    );

    expect(notifySchemaDrift).not.toHaveBeenCalled();
  });

  it("exits 1 in production when neither GOOGLE_MAPS_API_KEY nor VITE_GOOGLE_MAPS_API_KEY is set, BEFORE listening or touching the DB", async () => {
    // Task #191: closing the third loop on the silent-failure mode.
    // In production we *cannot* afford to start the server with the
    // key missing — the deploy would land and the only signal would
    // be the dashed map fallback. By exiting 1 before `listen()`,
    // the new revision never responds to the autoscale startup
    // health check, so Replit's deployment system will not promote
    // the bad build over the previous good one. The check therefore
    // catches the regression in CI before it reaches production.
    const pushSchemaIfNeeded = vi.fn();
    const seedIfEmpty = vi.fn();
    const listen = vi.fn();
    const logger = fakeLogger();
    const exit = vi.fn() as unknown as (code: number) => never;

    await start(
      makeDeps({
        pushSchemaIfNeeded,
        seedIfEmpty,
        listen,
        logger,
        exit,
        env: { NODE_ENV: "production", PORT: "3000" },
      }),
    );

    expect(exit).toHaveBeenCalledWith(1);
    // The whole point of fast-failing here is to short-circuit
    // before we touch anything — DB, seed, or the network listener.
    expect(pushSchemaIfNeeded).not.toHaveBeenCalled();
    expect(seedIfEmpty).not.toHaveBeenCalled();
    expect(listen).not.toHaveBeenCalled();

    const errorMsg = logger.error.mock.calls
      .map(([msg]) => String(msg))
      .find((m) => /GOOGLE_MAPS_API_KEY/.test(m));
    expect(errorMsg).toBeDefined();
    // The failure message must name BOTH env var names so an
    // operator looking at the deploy log knows exactly which two
    // secrets to check.
    expect(errorMsg).toContain("GOOGLE_MAPS_API_KEY");
    expect(errorMsg).toContain("VITE_GOOGLE_MAPS_API_KEY");
  });

  it("exits 1 in production when both env vars are present but whitespace-only", async () => {
    // Mirrors the route's `trim` semantics so the production
    // fast-fail agrees with what `/api/config` would have returned.
    // Without this, an operator who pasted spaces into the secret
    // would see a "boots fine" deploy but a `googleMapsApiKey: null`
    // response — exactly the silent-failure mismatch this task is
    // closing.
    const listen = vi.fn();
    const exit = vi.fn() as unknown as (code: number) => never;
    const logger = fakeLogger();

    await start(
      makeDeps({
        listen,
        exit,
        logger,
        env: {
          NODE_ENV: "production",
          PORT: "3000",
          GOOGLE_MAPS_API_KEY: "   ",
          VITE_GOOGLE_MAPS_API_KEY: "  ",
        },
      }),
    );

    expect(exit).toHaveBeenCalledWith(1);
    expect(listen).not.toHaveBeenCalled();
  });

  it("does NOT fast-fail in production when GOOGLE_MAPS_API_KEY is set", async () => {
    const listen = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn() as unknown as (code: number) => never;

    await start(
      makeDeps({
        listen,
        exit,
        env: {
          NODE_ENV: "production",
          PORT: "3000",
          GOOGLE_MAPS_API_KEY: "live-key",
        },
      }),
    );

    expect(exit).not.toHaveBeenCalled();
    expect(listen).toHaveBeenCalledTimes(1);
  });

  it("does NOT fast-fail in production when only the legacy VITE_GOOGLE_MAPS_API_KEY is set", async () => {
    // The /api/config route falls back to the legacy name (Task
    // #187), so an operator still pinned to the legacy secret must
    // not be killed by this fast-fail — otherwise the fast-fail
    // would itself become a regression.
    const listen = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn() as unknown as (code: number) => never;

    await start(
      makeDeps({
        listen,
        exit,
        env: {
          NODE_ENV: "production",
          PORT: "3000",
          VITE_GOOGLE_MAPS_API_KEY: "legacy-key",
        },
      }),
    );

    expect(exit).not.toHaveBeenCalled();
    expect(listen).toHaveBeenCalledTimes(1);
  });

  it("does NOT fast-fail outside of production even when neither env var is set", async () => {
    // Local dev keeps the existing post-listen WARN (Task #187) so
    // workflows still start and the operator gets a non-fatal
    // signal. The task explicitly requires local dev to be
    // unaffected.
    const listen = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn() as unknown as (code: number) => never;

    await start(
      makeDeps({
        listen,
        exit,
        env: { NODE_ENV: "development", PORT: "3000" },
      }),
    );

    expect(exit).not.toHaveBeenCalled();
    expect(listen).toHaveBeenCalledTimes(1);
  });

  it("warns at startup when neither GOOGLE_MAPS_API_KEY nor VITE_GOOGLE_MAPS_API_KEY is set", async () => {
    // Without this warning, a missing key produces an entirely
    // silent failure mode — `/api/config` returns
    // `{"googleMapsApiKey": null, ...}` and the frontend renders its
    // dashed "API key isn't configured" fallback, but nothing in the
    // workflow logs points at the real cause. The user has been
    // burned by this loop three times in a row (Task #187), so the
    // boot WARN is the loud canary that ends the loop.
    const logger = fakeLogger();

    await start(
      makeDeps({
        logger,
        env: { NODE_ENV: "development", PORT: "3000" },
      }),
    );

    const warnCalls = logger.warn.mock.calls.map(([msg]) => String(msg));
    const mapsWarn = warnCalls.find((m) =>
      /GOOGLE_MAPS_API_KEY/.test(m),
    );
    expect(mapsWarn).toBeDefined();
    // Both env var names must appear so the operator who set the
    // legacy name knows the api-server now also accepts it.
    expect(mapsWarn).toContain("GOOGLE_MAPS_API_KEY");
    expect(mapsWarn).toContain("VITE_GOOGLE_MAPS_API_KEY");
  });

  it("does NOT warn at startup when GOOGLE_MAPS_API_KEY is set", async () => {
    const logger = fakeLogger();

    await start(
      makeDeps({
        logger,
        env: {
          NODE_ENV: "development",
          PORT: "3000",
          GOOGLE_MAPS_API_KEY: "live-key",
        },
      }),
    );

    const mapsWarn = logger.warn.mock.calls
      .map(([msg]) => String(msg))
      .find((m) => /GOOGLE_MAPS_API_KEY/.test(m));
    expect(mapsWarn).toBeUndefined();
  });

  it("does NOT warn at startup when only the legacy VITE_GOOGLE_MAPS_API_KEY is set", async () => {
    // The /api/config route falls back to the legacy name, so an
    // operator who set only the legacy secret is still fine — no
    // warning needed.
    const logger = fakeLogger();

    await start(
      makeDeps({
        logger,
        env: {
          NODE_ENV: "development",
          PORT: "3000",
          VITE_GOOGLE_MAPS_API_KEY: "legacy-key",
        },
      }),
    );

    const mapsWarn = logger.warn.mock.calls
      .map(([msg]) => String(msg))
      .find((m) => /GOOGLE_MAPS_API_KEY/.test(m));
    expect(mapsWarn).toBeUndefined();
  });

  it("treats whitespace-only env vars as unset for the startup warning", async () => {
    // Mirrors the route's `trim` behavior so the boot warning agrees
    // with what `/api/config` actually returns. Without this, an
    // operator who pasted spaces into the secret would get a "value
    // looks set" boot but a `googleMapsApiKey: null` response, which
    // is exactly the silent-failure mismatch this task is closing.
    const logger = fakeLogger();

    await start(
      makeDeps({
        logger,
        env: {
          NODE_ENV: "development",
          PORT: "3000",
          GOOGLE_MAPS_API_KEY: "   ",
          VITE_GOOGLE_MAPS_API_KEY: "  ",
        },
      }),
    );

    const mapsWarn = logger.warn.mock.calls
      .map(([msg]) => String(msg))
      .find((m) => /GOOGLE_MAPS_API_KEY/.test(m));
    expect(mapsWarn).toBeDefined();
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
          // See sibling tests — maps key set so this exercises the
          // chat-webhook-failure path, not the Task #191 fast-fail.
          GOOGLE_MAPS_API_KEY: "live-key",
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
