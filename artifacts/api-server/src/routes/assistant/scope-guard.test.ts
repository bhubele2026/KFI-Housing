import { describe, expect, it } from "vitest";
import { evaluateWriteScope } from "./tools";

describe("evaluateWriteScope", () => {
  describe("no effective scope (no dropdown, no page focus)", () => {
    it("allows any write — back-compat with no-focus + 'All'", () => {
      expect(
        evaluateWriteScope("cust-1", {
          scopeCustomerId: null,
          focusCustomerId: null,
        }),
      ).toEqual({ ok: true });
    });

    it("allows even an unknown-owner write (no scope to enforce)", () => {
      expect(
        evaluateWriteScope(null, {
          scopeCustomerId: null,
          focusCustomerId: null,
        }),
      ).toEqual({ ok: true });
    });
  });

  describe("dropdown scope only (existing behavior preserved)", () => {
    it("allows a write that matches the active scope", () => {
      expect(
        evaluateWriteScope("cust-1", {
          scopeCustomerId: "cust-1",
          focusCustomerId: null,
        }),
      ).toEqual({ ok: true });
    });

    it("refuses a write targeting a different customer", () => {
      const result = evaluateWriteScope("cust-2", {
        scopeCustomerId: "cust-1",
        focusCustomerId: null,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toContain("cust-2");
        expect(result.reason).toContain("cust-1");
        expect(result.reason).toContain("active customer scope");
      }
    });

    it("fails closed when ownership cannot be proven", () => {
      const result = evaluateWriteScope(null, {
        scopeCustomerId: "cust-1",
        focusCustomerId: null,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toContain("could not prove");
      }
    });
  });

  describe("page focus only (dropdown is 'All')", () => {
    it("allows a write that matches the focus customer — the regression scenario", () => {
      // Operator is on the Burnett Hinckley property page (customer
      // cust-burnett) with dropdown on "All". An update_bed call whose
      // implied owner resolves to cust-burnett MUST be allowed —
      // previously this refused and asked the operator to switch the
      // dropdown.
      expect(
        evaluateWriteScope("cust-burnett", {
          scopeCustomerId: null,
          focusCustomerId: "cust-burnett",
        }),
      ).toEqual({ ok: true });
    });

    it("refuses a write targeting a different customer than the focus", () => {
      const result = evaluateWriteScope("cust-other", {
        scopeCustomerId: null,
        focusCustomerId: "cust-burnett",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toContain("cust-other");
        expect(result.reason).toContain("cust-burnett");
        expect(result.reason).toContain("current page belongs to");
      }
    });

    it("fails closed when ownership cannot be proven under page focus", () => {
      const result = evaluateWriteScope(null, {
        scopeCustomerId: null,
        focusCustomerId: "cust-burnett",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toContain("could not prove");
        expect(result.reason).toContain("cust-burnett");
      }
    });
  });

  describe("both dropdown scope and page focus set", () => {
    it("allows when the write matches the dropdown scope (scope wins as effective)", () => {
      expect(
        evaluateWriteScope("cust-1", {
          scopeCustomerId: "cust-1",
          focusCustomerId: "cust-1",
        }),
      ).toEqual({ ok: true });
    });

    it("refuses when the write matches only the focus (dropdown is the binding scope)", () => {
      // Operator deliberately scoped the dropdown to cust-1 but
      // navigated to a cust-2 page — the dropdown still wins.
      const result = evaluateWriteScope("cust-2", {
        scopeCustomerId: "cust-1",
        focusCustomerId: "cust-2",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toContain("cust-2");
        // Mentions both scopes so the operator can see why.
        expect(result.reason).toContain("cust-1");
        expect(result.reason).toContain("page");
      }
    });
  });

  describe("phase tagging", () => {
    it("prefixes 'Refused on confirm' when phase=confirm", () => {
      const result = evaluateWriteScope(
        "cust-2",
        { scopeCustomerId: "cust-1", focusCustomerId: null },
        { phase: "confirm" },
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason.startsWith("Refused on confirm:")).toBe(true);
      }
    });

    it("prefixes 'Refused' (no 'on confirm') by default", () => {
      const result = evaluateWriteScope("cust-2", {
        scopeCustomerId: "cust-1",
        focusCustomerId: null,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason.startsWith("Refused:")).toBe(true);
      }
    });
  });
});
