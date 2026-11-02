import { describe, expect, it } from "vitest";
import { audit, customers, investigators, profile, reports, rules, transactions, workspaceSettings } from "../../src/data/ops";
import { capacityTone, dateKey, filingStep, isDirty, isNarrowed, pagerTotal, share, stepState } from "../../src/lib/ops";
import { teamOf } from "../../src/components/InvestigatorsPage";
import { ruleType } from "../../src/components/RulesPage";
import { txnRank } from "../../src/components/TransactionsPage";

describe("pagerTotal", () => {
  it("shows the population until something narrows the list", () => {
    expect(pagerTotal(8, 1840216, false)).toBe("1,840,216");
    expect(pagerTotal(3, 1840216, true)).toBe("3");
  });
});

describe("isNarrowed", () => {
  it("is false with every filter on All and an empty or blank query", () => {
    expect(isNarrowed({ Risk: "All", KYC: "All" }, "")).toBe(false);
    expect(isNarrowed({ Risk: "All" }, "   ")).toBe(false);
    expect(isNarrowed({}, "")).toBe(false);
  });
  it("is true for any active filter or search text", () => {
    expect(isNarrowed({ Risk: "All", KYC: "Verified" }, "")).toBe(true);
    expect(isNarrowed({ Risk: "All" }, "orion")).toBe(true);
  });
});

describe("isDirty", () => {
  it("compares flat values, including keys only one side has", () => {
    expect(isDirty({ a: 1, b: true }, { a: 1, b: true })).toBe(false);
    expect(isDirty({ a: 1, b: false }, { a: 1, b: true })).toBe(true);
    expect(isDirty({ a: 1 } as Record<string, number>, { a: 1, b: 2 })).toBe(true);
    expect(isDirty({ a: 1, b: 2 }, { a: 1 } as Record<string, number>)).toBe(true);
  });
});

describe("capacityTone", () => {
  it("splits at 75 and above 85", () => {
    expect(capacityTone(74)).toBe("good");
    expect(capacityTone(75)).toBe("warn");
    expect(capacityTone(85)).toBe("warn");
    expect(capacityTone(86)).toBe("bad");
  });
});

describe("share", () => {
  it("formats one decimal and guards a zero total", () => {
    expect(share(486, 24816)).toBe("2.0%");
    expect(share(1, 3)).toBe("33.3%");
    expect(share(5, 0)).toBe("0.0%");
  });
});

describe("stepState", () => {
  it("marks earlier steps done, the current active and later todo", () => {
    expect([0, 1, 2, 3].map((i) => stepState(i, 2))).toEqual(["done", "done", "active", "todo"]);
  });
});

// Pins the design mock data to the Figma numbers the pages display.
describe("ops mock data", () => {
  it("matches Figma populations and counts", () => {
    expect(transactions.population).toBe(1840216);
    expect(transactions.rows).toHaveLength(8);
    expect(customers.population).toBe(24816);
    expect(customers.distribution.map((d) => d.count)).toEqual([486, 4218, 20112]);
    expect(customers.distribution.reduce((s, d) => s + d.count, 0)).toBe(customers.population);
    expect(investigators.team).toHaveLength(4);
    expect(investigators.rows.filter((r) => r.owner === null).every((r) => r.action === "Assign")).toBe(true);
    expect(reports.tabCounts.all).toBe(reports.tabCounts.draft + reports.tabCounts.review + reports.tabCounts.approved + reports.tabCounts.filed);
    expect(rules.population).toBe(47);
    expect(audit.population).toBe(18642);
    expect(audit.distribution.reduce((s, d) => s + d.count, 0)).toBe(audit.population);
  });
  it("ends the precision trend at the headline model precision", () => {
    expect(rules.precisionTrend).toHaveLength(28);
    expect(rules.precisionTrend[27]).toEqual({ date: "Sep 28", precision: rules.model.precision });
  });
  it("records a field change only on the first audit event", () => {
    expect(audit.rows.filter((r) => r.change).map((r) => r.id)).toEqual([audit.rows[0].id]);
  });
  it("uses Vigilia branding in account defaults", () => {
    expect(workspaceSettings.workspaceName).toBe("Vigilia AML Operations");
    expect(profile.form.displayName).toBe(profile.name);
  });
});

describe("dateKey", () => {
  it("orders by month, day, hour, minute and optional seconds", () => {
    const keys = ["Aug 31, 23:59", "Sep 1, 00:00", "Sep 28, 09:42", "Sep 28, 09:42:01", "Sep 28, 10:00", "Oct 2, 08:00"].map(dateKey);
    expect([...keys].sort((x, y) => x - y)).toEqual(keys);
    expect(new Set(keys).size).toBe(keys.length);
    expect(dateKey("Sep 28, 09:42:00")).toBe(dateKey("Sep 28, 09:42"));
  });
  it("returns -1 for unparseable or unknown-month strings", () => {
    expect(dateKey("Yesterday")).toBe(-1);
    expect(dateKey("Foo 28, 09:42")).toBe(-1);
    expect(dateKey("Sep 28 09:42")).toBe(-1);
  });
});

describe("filingStep", () => {
  it("maps report status to the active Evidence/Narrative/Approval/Submit step", () => {
    expect(["Draft", "In review", "Approved", "Submitted", "Accepted", "Unknown"].map(filingStep)).toEqual([1, 2, 3, 4, 4, 0]);
  });
});

describe("teamOf", () => {
  it("matches a short or full name by surname to the investigator's team", () => {
    expect(teamOf("D. Cho")).toBe("Corporate");
    expect(teamOf("Miguel Alvarez")).toBe("Cross-border");
  });
  it("falls back to Unassigned for unknown or missing names", () => {
    expect(teamOf(null)).toBe("Unassigned");
    expect(teamOf("Z. Nobody")).toBe("Unassigned");
  });
});

describe("txnRank", () => {
  it("orders transactions by date, not by risk score", () => {
    const [a, b] = transactions.rows;
    const older = { ...a, date: "Sep 27, 10:00", score: 99 };
    const newer = { ...b, date: "Sep 28, 08:00", score: 10 };
    expect(txnRank(newer)).toBeGreaterThan(txnRank(older));
  });
});

describe("ruleType", () => {
  it("classifies by ID prefix", () => {
    expect(ruleType("SC-003")).toBe("Screening");
    expect(ruleType("TM-014")).toBe("Monitoring");
    expect(ruleType("XSC-1")).toBe("Monitoring");
  });
});

describe("Figma detail records", () => {
  it("keeps the selected report, rule and audit details keyed to real rows", () => {
    expect(reports.rows.map((r) => r.id)).toEqual(expect.arrayContaining(Object.keys(reports.detail)));
    expect(rules.rows.map((r) => r.id)).toEqual(expect.arrayContaining(Object.keys(rules.detail)));
    expect(audit.rows.map((r) => r.id)).toEqual(expect.arrayContaining(Object.keys(audit.detail)));
  });
});
