import { describe, it, expect } from "vitest";
import { computeOverallRating, EMPTY_RATINGS } from "./mockData";

describe("computeOverallRating", () => {
  it("returns null when nothing is rated (all zeros)", () => {
    expect(computeOverallRating(EMPTY_RATINGS)).toBeNull();
  });

  it("excludes zero (not-yet-rated) categories from the average", () => {
    // Rated values: 4 and 2 → average 3. The four zeros should be ignored
    // rather than dragging the average down to 1.
    const result = computeOverallRating({
      landlord: 4,
      cleanliness: 0,
      amenities: 2,
      occupants: 0,
      location: 0,
      valueForMoney: 0,
    });
    expect(result).toBe(3);
  });

  it("computes a simple average when every category is rated", () => {
    // (5 + 4 + 5 + 4 + 4 + 3) / 6 = 4.166… → rounded to 4.2
    const result = computeOverallRating({
      landlord: 5,
      cleanliness: 4,
      amenities: 5,
      occupants: 4,
      location: 4,
      valueForMoney: 3,
    });
    expect(result).toBe(4.2);
  });

  it("rounds the result to one decimal place", () => {
    // (4 + 4 + 4 + 5 + 5 + 5) / 6 = 4.5 exactly
    expect(
      computeOverallRating({
        landlord: 4,
        cleanliness: 4,
        amenities: 4,
        occupants: 5,
        location: 5,
        valueForMoney: 5,
      }),
    ).toBe(4.5);

    // (5 + 4 + 4 + 4 + 4 + 4) / 6 = 4.166… → rounded to 4.2
    expect(
      computeOverallRating({
        landlord: 5,
        cleanliness: 4,
        amenities: 4,
        occupants: 4,
        location: 4,
        valueForMoney: 4,
      }),
    ).toBe(4.2);

    // Single rated category of 3 → 3.0 (no rounding noise)
    expect(
      computeOverallRating({
        landlord: 3,
        cleanliness: 0,
        amenities: 0,
        occupants: 0,
        location: 0,
        valueForMoney: 0,
      }),
    ).toBe(3);
  });

  it("returns null for null input", () => {
    expect(computeOverallRating(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(computeOverallRating(undefined)).toBeNull();
  });
});
