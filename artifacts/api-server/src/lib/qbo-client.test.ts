import { describe, expect, it, vi } from "vitest";
import { createQboClient } from "./qbo-client";

function mockTokenResponse() {
  return {
    ok: true,
    status: 200,
    text: () => Promise.resolve(""),
    json: () =>
      Promise.resolve({
        access_token: "ACCESS_NEW",
        refresh_token: "REFRESH_NEW",
        expires_in: 3600,
        x_refresh_token_expires_in: 8_726_400,
        token_type: "bearer",
      }),
  } as unknown as Response;
}

function mockQueryResponse(payload: unknown = { QueryResponse: {} }) {
  return {
    ok: true,
    status: 200,
    text: () => Promise.resolve(""),
    json: () => Promise.resolve(payload),
  } as unknown as Response;
}

describe("createQboClient access-token refresh", () => {
  const config = {
    clientId: "id",
    clientSecret: "secret",
    environment: "sandbox" as const,
    redirectUri: "https://example.test/cb",
  };

  it("refreshes when the access token is within 5 minutes of expiry and persists the new pair", async () => {
    const persistTokens = vi.fn(async () => {});
    const fetchImpl = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/oauth2/v1/tokens/bearer")) {
        expect(init?.method).toBe("POST");
        const body = String(init?.body ?? "");
        expect(body).toContain("grant_type=refresh_token");
        expect(body).toContain("refresh_token=REFRESH_OLD");
        return mockTokenResponse();
      }
      // Subsequent /query call must use the freshly refreshed token.
      expect(
        (init?.headers as Record<string, string>)?.["Authorization"],
      ).toBe("Bearer ACCESS_NEW");
      return mockQueryResponse({ QueryResponse: { Invoice: [] } });
    });

    const client = createQboClient({
      config,
      connection: {
        realmId: "r1",
        accessToken: "ACCESS_OLD",
        // Already expired → forces a refresh on the first request.
        accessTokenExpiresAt: new Date(Date.now() - 1000),
        refreshToken: "REFRESH_OLD",
      },
      persistTokens,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await client.query("SELECT * FROM Invoice");

    // Token refresh fired exactly once, query fired once.
    const refreshCalls = fetchImpl.mock.calls.filter((c) =>
      String(c[0]).includes("tokens/bearer"),
    );
    expect(refreshCalls).toHaveLength(1);
    expect(persistTokens).toHaveBeenCalledTimes(1);
    expect(client.getTokens().accessToken).toBe("ACCESS_NEW");
  });

  it("does NOT refresh when the current token has > 5 minutes of life left", async () => {
    const persistTokens = vi.fn(async () => {});
    const fetchImpl = vi.fn(async () => mockQueryResponse({ QueryResponse: {} }));
    const client = createQboClient({
      config,
      connection: {
        realmId: "r1",
        accessToken: "ACCESS_FRESH",
        accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
        refreshToken: "REFRESH_FRESH",
      },
      persistTokens,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await client.query("SELECT * FROM Customer");
    expect(persistTokens).not.toHaveBeenCalled();
    expect(
      fetchImpl.mock.calls.some((c: unknown[]) =>
        String(c[0]).includes("tokens/bearer"),
      ),
    ).toBe(false);
  });

  it("surfaces refresh failures so the operator is asked to reconnect", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      text: () => Promise.resolve("invalid_grant"),
      json: () => Promise.resolve({}),
    } as unknown as Response));
    const client = createQboClient({
      config,
      connection: {
        realmId: "r1",
        accessToken: "ACCESS_OLD",
        accessTokenExpiresAt: new Date(Date.now() - 1000),
        refreshToken: "REFRESH_DEAD",
      },
      persistTokens: async () => {},
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(client.query("SELECT * FROM Invoice")).rejects.toThrow(
      /QBO token refresh failed/,
    );
  });
});
