import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./client", () => ({
  db: {},
  pool: {},
}));

const pushSchemaMock = vi.fn();

vi.mock("drizzle-kit/api", () => ({
  pushSchema: (...args: unknown[]) => pushSchemaMock(...args),
}));

import { pushSchemaIfNeeded } from "./migrate";

const applyMock = vi.fn();

beforeEach(() => {
  pushSchemaMock.mockReset();
  applyMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("pushSchemaIfNeeded with checkOnly: true", () => {
  it("returns applied: false and never calls apply() when schema is up to date", async () => {
    pushSchemaMock.mockResolvedValueOnce({
      hasDataLoss: false,
      warnings: [],
      statementsToExecute: [],
      apply: applyMock,
    });

    const log = vi.fn();
    const result = await pushSchemaIfNeeded({ checkOnly: true, log });

    expect(result).toEqual({
      applied: false,
      statements: [],
      warnings: [],
      hasDataLoss: false,
    });
    expect(applyMock).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("Schema is up to date.");
  });

  it("throws and never calls apply() when there are pending statements", async () => {
    const pending = [
      'ALTER TABLE "properties" ADD COLUMN "rating" integer',
      'CREATE INDEX "properties_rating_idx" ON "properties" ("rating")',
    ];
    pushSchemaMock.mockResolvedValueOnce({
      hasDataLoss: false,
      warnings: ["heads up"],
      statementsToExecute: pending,
      apply: applyMock,
    });

    const log = vi.fn();

    await expect(
      pushSchemaIfNeeded({ checkOnly: true, log }),
    ).rejects.toThrow(/pnpm --filter @workspace\/db run push/);

    expect(applyMock).not.toHaveBeenCalled();

    const messages = log.mock.calls.map(([message]) => message as string);
    expect(
      messages.some((message) =>
        /pnpm --filter @workspace\/db run push/.test(message),
      ),
    ).toBe(true);
    expect(
      messages.some((message) => /Refusing to auto-apply/.test(message)),
    ).toBe(true);
  });

  it("still throws in checkOnly mode even when the diff would cause data loss", async () => {
    pushSchemaMock.mockResolvedValueOnce({
      hasDataLoss: true,
      warnings: [],
      statementsToExecute: ['ALTER TABLE "properties" DROP COLUMN "legacy"'],
      apply: applyMock,
    });

    await expect(
      pushSchemaIfNeeded({ checkOnly: true, log: () => {} }),
    ).rejects.toThrow(/pnpm --filter @workspace\/db run push/);

    expect(applyMock).not.toHaveBeenCalled();
  });
});

describe("pushSchemaIfNeeded without checkOnly", () => {
  it("invokes apply() when there are pending statements and no data loss", async () => {
    pushSchemaMock.mockResolvedValueOnce({
      hasDataLoss: false,
      warnings: [],
      statementsToExecute: ['ALTER TABLE "properties" ADD COLUMN "rating" integer'],
      apply: applyMock,
    });
    applyMock.mockResolvedValueOnce(undefined);

    const result = await pushSchemaIfNeeded({ log: () => {} });

    expect(applyMock).toHaveBeenCalledTimes(1);
    expect(result.applied).toBe(true);
  });
});
