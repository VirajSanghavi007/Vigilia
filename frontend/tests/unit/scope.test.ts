import { describe, expect, it } from "vitest";
import type { Alert, Case, QueueAlert } from "../../src/data/types";
import {
  DEFAULT_SCOPE, RANGES, TODAY, dayOf, extraCount, inScope, isDefaultScope, jurisdictionOf, rangeOf,
  scopeOfAlert, scopeOfCase, scopeOfQueueAlert, trendInRange, unitOf, type Scope, type Scoped,
} from "../../src/lib/scope";

const item: Scoped = { day: 24, unit: "Retail banking", jurisdiction: "GH", typology: "Structuring / smurfing", score: 80 };
const scope = (s: Partial<Scope>): Scope => ({ ...DEFAULT_SCOPE, ...s });

describe("rangeOf", () => {
  it("finds each range by id", () => {
    for (const r of RANGES) expect(rangeOf(r.id)).toBe(r);
  });
  it("falls back to month to date for an unknown id", () => {
    expect(rangeOf("bogus" as Scope["range"])).toBe(RANGES[0]);
  });
});

describe("unitOf", () => {
  it.each([
    ["GH · Individual", "Retail banking"], ["PA · individual", "Retail banking"],
    ["AE · MSB", "Payments & remittance"], ["AE · msb", "Payments & remittance"],
    ["AE · Corporate", "Corporate banking"], ["Corporate", "Corporate banking"],
    // "msb" inside a word is not a money-service business.
    ["AE · Msbank", "Corporate banking"],
  ])("%s is %s", (entity, unit) => {
    expect(unitOf(entity)).toBe(unit);
  });
});

describe("jurisdictionOf", () => {
  it("reads the two-letter prefix", () => {
    expect(jurisdictionOf("AE · Corporate")).toBe("AE");
    expect(jurisdictionOf("GB · 6 min ago")).toBe("GB");
  });
  it("is empty without a prefix", () => {
    expect(jurisdictionOf("Corporate")).toBe("");
    expect(jurisdictionOf("ae · Corporate")).toBe("");
    expect(jurisdictionOf("AEX · Corporate")).toBe("");
    expect(jurisdictionOf("x AE · Corporate")).toBe("");
  });
});

describe("dayOf", () => {
  it("reads the day of September", () => {
    expect(dayOf("Sep 28, 09:42")).toBe(28);
    expect(dayOf("Opened Sep 4")).toBe(4);
    expect(dayOf("Sep 01")).toBe(1);
  });
  it("treats text without a date as today", () => {
    expect(dayOf("8 min ago")).toBe(TODAY);
    expect(dayOf("Sep 123")).toBe(TODAY);
  });
});

describe("inScope", () => {
  it("keeps everything under the default scope", () => {
    expect(inScope(item, DEFAULT_SCOPE)).toBe(true);
  });
  it("applies the date range, inclusive at both ends", () => {
    expect(inScope(item, scope({ range: "7d" }))).toBe(true);
    expect(inScope({ ...item, day: 22 }, scope({ range: "7d" }))).toBe(true);
    expect(inScope({ ...item, day: 21 }, scope({ range: "7d" }))).toBe(false);
    expect(inScope({ ...item, day: TODAY }, scope({ range: "today" }))).toBe(true);
    expect(inScope(item, scope({ range: "today" }))).toBe(false);
    expect(inScope({ ...item, day: TODAY + 1 }, DEFAULT_SCOPE)).toBe(false);
  });
  it("matches unit, jurisdiction and typology exactly", () => {
    expect(inScope(item, scope({ unit: "Retail banking" }))).toBe(true);
    expect(inScope(item, scope({ unit: "Corporate banking" }))).toBe(false);
    expect(inScope(item, scope({ jurisdiction: "GH" }))).toBe(true);
    expect(inScope(item, scope({ jurisdiction: "AE" }))).toBe(false);
    expect(inScope(item, scope({ typology: "Structuring / smurfing" }))).toBe(true);
    expect(inScope(item, scope({ typology: "Sanctions proximity" }))).toBe(false);
  });
  it("applies the minimum score inclusively, and ignores it for unscored records", () => {
    expect(inScope(item, scope({ minScore: 80 }))).toBe(true);
    expect(inScope(item, scope({ minScore: 90 }))).toBe(false);
    expect(inScope({ ...item, score: undefined }, scope({ minScore: 90 }))).toBe(true);
  });
});

describe("extraCount and isDefaultScope", () => {
  it("counts only the More filters extras", () => {
    expect(extraCount(DEFAULT_SCOPE)).toBe(0);
    expect(extraCount(scope({ unit: "Retail banking", jurisdiction: "GH", range: "7d" }))).toBe(0);
    expect(extraCount(scope({ typology: "Sanctions proximity" }))).toBe(1);
    expect(extraCount(scope({ minScore: 70 }))).toBe(1);
    expect(extraCount(scope({ typology: "Sanctions proximity", minScore: 70 }))).toBe(2);
  });
  it("is default only when every field is", () => {
    expect(isDefaultScope({ ...DEFAULT_SCOPE })).toBe(true);
    for (const s of [{ range: "7d" }, { unit: "Retail banking" }, { jurisdiction: "GH" }, { typology: "x" }, { minScore: 50 }] as Partial<Scope>[]) {
      expect(isDefaultScope(scope(s))).toBe(false);
    }
  });
});

describe("record scopes", () => {
  it("reads a queue alert", () => {
    const a = { detected: "Sep 26, 09:42", entityType: "AE · MSB", typology: "Rapid movement of funds", score: 77 } as QueueAlert;
    expect(scopeOfQueueAlert(a)).toEqual({ day: 26, unit: "Payments & remittance", jurisdiction: "AE", typology: "Rapid movement of funds", score: 77 });
  });
  it("reads a case, which has no score", () => {
    const c = { opened: "Opened Sep 24", entityType: "GH · Individual", type: "Structuring / smurfing" } as Case;
    expect(scopeOfCase(c)).toEqual({ day: 24, unit: "Retail banking", jurisdiction: "GH", typology: "Structuring / smurfing" });
  });
  it("dates overview alerts today and takes the country from the meta line", () => {
    const a = { entityType: "Corporate", meta: "HK · 6 min ago", typology: "Sanctions proximity", score: 90 } as Alert;
    expect(scopeOfAlert(a)).toEqual({ day: TODAY, unit: "Corporate banking", jurisdiction: "HK", typology: "Sanctions proximity", score: 90 });
  });
});

describe("trendInRange", () => {
  const trend = Array.from({ length: 28 }, (_, i) => ({ date: `Sep ${String(i + 1).padStart(2, "0")}`, high: i }));
  it("keeps the days inside the range", () => {
    expect(trendInRange(trend, DEFAULT_SCOPE)).toHaveLength(28);
    expect(trendInRange(trend, scope({ range: "7d" })).map((d) => d.date)).toEqual(["Sep 22", "Sep 23", "Sep 24", "Sep 25", "Sep 26", "Sep 27", "Sep 28"]);
    expect(trendInRange(trend, scope({ range: "today" })).map((d) => d.date)).toEqual(["Sep 28"]);
  });
  it("ignores the non-date filters", () => {
    expect(trendInRange(trend, scope({ unit: "Retail banking", jurisdiction: "GH", typology: "x", minScore: 90 }))).toHaveLength(28);
  });
});
