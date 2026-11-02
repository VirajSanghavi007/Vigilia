import { describe, expect, it } from "vitest";
import { formatCompactCurrency, formatDelta, initials, percentOf, riskBand } from "../../src/lib/format";
import { deltaTone } from "../../src/components/Kpis";

describe("formatCompactCurrency", () => {
  it("formats billions, millions and plain values", () => {
    expect(formatCompactCurrency(2_480_000_000)).toBe("$2.48B");
    expect(formatCompactCurrency(1_240_000)).toBe("$1.24M");
    expect(formatCompactCurrency(74_980)).toBe("$74,980");
  });
  it("uses the exact thresholds", () => {
    expect(formatCompactCurrency(1e9)).toBe("$1.00B");
    expect(formatCompactCurrency(1e6)).toBe("$1.00M");
    expect(formatCompactCurrency(999_999)).toBe("$999,999");
  });
  it("keeps the sign on negatives", () => {
    expect(formatCompactCurrency(-3_500_000)).toBe("-$3.50M");
    expect(formatCompactCurrency(-12)).toBe("-$12");
  });
});

describe("formatDelta", () => {
  it("signs positive, negative and zero values", () => {
    expect(formatDelta(8.2)).toBe("+8.2%");
    expect(formatDelta(-3.1)).toBe("-3.1%");
    expect(formatDelta(0)).toBe("0.0%");
  });
  it("supports a points unit", () => {
    expect(formatDelta(-2, " pts")).toBe("-2.0 pts");
  });
});

describe("riskBand", () => {
  it.each([
    [100, "critical"], [90, "critical"], [89, "high"], [75, "high"],
    [74, "medium"], [50, "medium"], [49, "low"], [0, "low"],
  ])("score %i is %s", (score, band) => {
    expect(riskBand(score)).toBe(band);
  });
});

describe("percentOf", () => {
  it("computes one-decimal percentages", () => {
    expect(percentOf(486, 1591)).toBe("30.5%");
    expect(percentOf(1, 3)).toBe("33.3%");
  });
  it("returns 0.0% for a zero or negative total", () => {
    expect(percentOf(5, 0)).toBe("0.0%");
    expect(percentOf(5, -1)).toBe("0.0%");
  });
});

describe("initials", () => {
  it("takes first letters of the first two words", () => {
    expect(initials("Orion Trading FZE")).toBe("OT");
    expect(initials("  amina   patel ")).toBe("AP");
  });
  it("uses two letters of a single word and handles empty input", () => {
    expect(initials("rosa")).toBe("RO");
    expect(initials("   ")).toBe("");
  });
});

describe("deltaTone", () => {
  it("is good when the move matches the metric's direction", () => {
    expect(deltaTone({ delta: 8.2, higherIsBetter: true })).toBe("good");
    expect(deltaTone({ delta: -3.1, higherIsBetter: false })).toBe("good");
  });
  it("is bad when the move goes the wrong way", () => {
    expect(deltaTone({ delta: 18.4, higherIsBetter: false })).toBe("bad");
    expect(deltaTone({ delta: -1, higherIsBetter: true })).toBe("bad");
  });
  it("treats zero as an increase", () => {
    expect(deltaTone({ delta: 0, higherIsBetter: true })).toBe("good");
  });
});
