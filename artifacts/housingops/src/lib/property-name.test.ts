import { describe, it, expect } from "vitest";
import { formatPropertyName, shortPropertyName } from "./property-name";

describe("formatPropertyName", () => {
  it("splits on em-dash and title-cases all-caps secondary", () => {
    expect(formatPropertyName("Burnett — SIREN")).toEqual({
      primary: "Burnett",
      secondary: "Siren",
    });
  });

  it("splits on hyphen with surrounding spaces", () => {
    expect(formatPropertyName("Burnett - WEBSTER")).toEqual({
      primary: "Burnett",
      secondary: "Webster",
    });
  });

  it("extracts trailing parentheses as secondary", () => {
    expect(formatPropertyName("Prairie Hill Village (Baraboo, WI)")).toEqual({
      primary: "Prairie Hill Village",
      secondary: "Baraboo, WI",
    });
  });

  it("preserves short all-caps acronyms in secondary", () => {
    expect(formatPropertyName("Northgate — USA LLC")).toEqual({
      primary: "Northgate",
      secondary: "USA LLC",
    });
  });

  it("returns just the primary when there is no delimiter", () => {
    expect(formatPropertyName("Schuette")).toEqual({
      primary: "Schuette",
      secondary: null,
    });
  });

  it("handles null and empty input safely", () => {
    expect(formatPropertyName(null)).toEqual({ primary: "", secondary: null });
    expect(formatPropertyName("")).toEqual({ primary: "", secondary: null });
    expect(formatPropertyName("   ")).toEqual({ primary: "", secondary: null });
  });

  it("does not strip internal hyphens that are part of a word", () => {
    expect(formatPropertyName("North-West Manor")).toEqual({
      primary: "North-West Manor",
      secondary: null,
    });
  });

  it("preserves mixed-case secondaries as-is", () => {
    expect(formatPropertyName("Acme — Phase Two")).toEqual({
      primary: "Acme",
      secondary: "Phase Two",
    });
  });
});

describe("formatPropertyName with customerName", () => {
  it("strips the customer prefix when the leading segment matches (case-insensitive)", () => {
    expect(
      formatPropertyName("Burnett — WEBSTER", { customerName: "burnett" }),
    ).toEqual({ primary: "Webster", secondary: null });
  });

  it("strips the customer prefix from a parenthesised secondary too", () => {
    expect(
      formatPropertyName("InterWire (Bloomfield Gardens)", {
        customerName: "InterWire",
      }),
    ).toEqual({ primary: "Bloomfield Gardens", secondary: null });
  });

  it("trims surrounding whitespace on the customer name before comparing", () => {
    expect(
      formatPropertyName("Burnett — WEBSTER", { customerName: "  Burnett  " }),
    ).toEqual({ primary: "Webster", secondary: null });
  });

  it("leaves the formatted result alone when the leading segment doesn't match the customer", () => {
    expect(
      formatPropertyName("Prairie Hill Village (Baraboo, WI)", {
        customerName: "MV",
      }),
    ).toEqual({ primary: "Prairie Hill Village", secondary: "Baraboo, WI" });
  });

  it("does nothing when there is no secondary segment (single-word name)", () => {
    expect(formatPropertyName("DeLallo", { customerName: "DeLallo" })).toEqual({
      primary: "DeLallo",
      secondary: null,
    });
  });

  it("does nothing when the customer name is missing or blank", () => {
    expect(
      formatPropertyName("Burnett — WEBSTER", { customerName: undefined }),
    ).toEqual({ primary: "Burnett", secondary: "Webster" });
    expect(
      formatPropertyName("Burnett — WEBSTER", { customerName: null }),
    ).toEqual({ primary: "Burnett", secondary: "Webster" });
    expect(
      formatPropertyName("Burnett — WEBSTER", { customerName: "   " }),
    ).toEqual({ primary: "Burnett", secondary: "Webster" });
  });
});

describe("shortPropertyName", () => {
  it("joins primary and secondary with a bullet", () => {
    expect(shortPropertyName("Burnett — SIREN")).toBe("Burnett • Siren");
  });

  it("returns just the primary when there is no secondary", () => {
    expect(shortPropertyName("Schuette")).toBe("Schuette");
  });
});
