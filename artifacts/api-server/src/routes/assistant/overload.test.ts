import { describe, expect, it } from "vitest";
import { isOverloadedError } from "./index";

describe("isOverloadedError", () => {
  it("matches a 529 status from the Anthropic SDK", () => {
    expect(isOverloadedError({ status: 529, message: "Overloaded" })).toBe(true);
  });

  it("matches the nested overloaded_error body shape", () => {
    expect(
      isOverloadedError({
        error: { error: { type: "overloaded_error", message: "Overloaded" } },
      }),
    ).toBe(true);
  });

  it("matches an /overloaded/i message regardless of casing", () => {
    expect(isOverloadedError(new Error("API is OVERLOADED right now"))).toBe(
      true,
    );
  });

  it("does not match a generic transport / network error", () => {
    expect(isOverloadedError(new Error("network down"))).toBe(false);
  });

  it("does not match null / undefined / empty", () => {
    expect(isOverloadedError(null)).toBe(false);
    expect(isOverloadedError(undefined)).toBe(false);
    expect(isOverloadedError({})).toBe(false);
  });
});
