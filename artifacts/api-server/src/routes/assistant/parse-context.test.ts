import { describe, expect, it } from "vitest";
import type { Request } from "express";
import { parseAssistantContext } from "./index";

function mockReq(headerValue: string | undefined, userId = "user-test"): Request {
  return {
    headers: {
      "x-assistant-context": headerValue,
      "x-user-id": userId,
    },
  } as unknown as Request;
}

describe("parseAssistantContext", () => {
  describe("'no scope selected' sentinel", () => {
    it("treats wire value 'All' (client ALL_CUSTOMERS constant) as no scope", () => {
      const ctx = parseAssistantContext(
        mockReq(JSON.stringify({ customerId: "All" })),
      );
      expect(ctx.customerScopeId).toBeNull();
    });

    it("treats wire value 'ALL' (server-canonical) as no scope", () => {
      const ctx = parseAssistantContext(
        mockReq(JSON.stringify({ customerId: "ALL" })),
      );
      expect(ctx.customerScopeId).toBeNull();
    });

    it("treats wire value 'all' (any-case) as no scope", () => {
      const ctx = parseAssistantContext(
        mockReq(JSON.stringify({ customerId: "all" })),
      );
      expect(ctx.customerScopeId).toBeNull();
    });
  });

  describe("real customer id", () => {
    it("passes through a real customer id unchanged", () => {
      const ctx = parseAssistantContext(
        mockReq(JSON.stringify({ customerId: "cust-burnett-dairy-grantsburg" })),
      );
      expect(ctx.customerScopeId).toBe("cust-burnett-dairy-grantsburg");
    });
  });

  describe("missing / malformed header", () => {
    it("returns null scope when the header is absent", () => {
      const ctx = parseAssistantContext(mockReq(undefined));
      expect(ctx.customerScopeId).toBeNull();
      expect(ctx.focus).toBeNull();
    });

    it("returns null scope when the header is not JSON", () => {
      const ctx = parseAssistantContext(mockReq("not-json"));
      expect(ctx.customerScopeId).toBeNull();
    });

    it("returns null scope when customerId is missing from the payload", () => {
      const ctx = parseAssistantContext(mockReq(JSON.stringify({})));
      expect(ctx.customerScopeId).toBeNull();
    });
  });

  describe("focus payload", () => {
    it("parses a property focus", () => {
      const ctx = parseAssistantContext(
        mockReq(
          JSON.stringify({
            customerId: "All",
            focus: { entityType: "property", entityId: "prop-xyz" },
          }),
        ),
      );
      expect(ctx.focus).toEqual({ entityType: "property", entityId: "prop-xyz" });
      expect(ctx.focusCustomerId).toBeNull();
    });

    it("ignores unknown entity types", () => {
      const ctx = parseAssistantContext(
        mockReq(
          JSON.stringify({
            customerId: "All",
            focus: { entityType: "spaceship", entityId: "x" },
          }),
        ),
      );
      expect(ctx.focus).toBeNull();
    });
  });
});
