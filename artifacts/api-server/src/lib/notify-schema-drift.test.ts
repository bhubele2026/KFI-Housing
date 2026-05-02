import { describe, expect, it, vi } from "vitest";
import {
  buildSchemaDriftPayload,
  isSchemaDriftError,
  postSchemaDriftNotification,
} from "./notify-schema-drift";

describe("isSchemaDriftError", () => {
  it("matches the error thrown by pushSchemaIfNeeded in checkOnly mode", () => {
    expect(
      isSchemaDriftError(new Error("Schema is out of date: 2 pending")),
    ).toBe(true);
  });

  it("does not match unrelated errors", () => {
    expect(isSchemaDriftError(new Error("ECONNREFUSED"))).toBe(false);
    expect(isSchemaDriftError(new Error("seed failed"))).toBe(false);
    expect(isSchemaDriftError("Schema is out of date")).toBe(false);
    expect(isSchemaDriftError(undefined)).toBe(false);
  });
});

describe("buildSchemaDriftPayload", () => {
  it("includes the fix command in the payload text", () => {
    const payload = buildSchemaDriftPayload("Schema is out of date: 1 pending");
    expect(payload.text).toContain("pnpm --filter @workspace/db run push");
    expect(payload.text).toContain("Schema is out of date: 1 pending");
  });
});

describe("postSchemaDriftNotification", () => {
  it("POSTs JSON to the webhook URL", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("ok", { status: 200 }));

    await postSchemaDriftNotification(
      {
        webhookUrl: "https://hooks.example.com/T/B/X",
        message: "Schema is out of date: 1 pending",
      },
      { fetch: fetchMock },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://hooks.example.com/T/B/X");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({
      "Content-Type": "application/json",
    });
    expect(typeof init?.body).toBe("string");
    const body = JSON.parse(init?.body as string);
    expect(body.text).toContain("pnpm --filter @workspace/db run push");
  });

  it("throws when the webhook returns a non-2xx response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("nope", { status: 500 }));

    await expect(
      postSchemaDriftNotification(
        {
          webhookUrl: "https://hooks.example.com/T/B/X",
          message: "Schema is out of date: 1 pending",
        },
        { fetch: fetchMock },
      ),
    ).rejects.toThrow(/HTTP 500/);
  });
});
