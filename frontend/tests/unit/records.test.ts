import { describe, expect, it } from "vitest";
import type { AuditEvent, Report } from "../../src/data/ops";
import type { Case, QueueAlert, Severity } from "../../src/data/types";
import {
  alertsForCase, alertsForRule, buildNotifications, eventsFor, findById, reportsForCase, riskByJurisdiction,
  scopeOptionsFrom, trendSummary,
} from "../../src/lib/records";
import { alertPath, auditPath, casePath, recordPath, reportPath, rulePath } from "../../src/routes";

const alert = (id: string, o: Partial<QueueAlert> = {}) =>
  ({ id, entityId: "C-1", entity: "Orion", entityType: "AE · Corporate", rule: "TM-014 · Velocity anomaly", severity: "High" as Severity,
    amount: 100, slaBreached: false, sla: "8 min ago", detected: "Sep 28, 09:42", ...o }) as QueueAlert;
const kase = (id: string, o: Partial<Case> = {}) =>
  ({ id, entityId: "C-1", entity: "Orion", overdue: false, dueNote: "2d left", due: "Sep 30", ...o }) as Case;

describe("findById", () => {
  const items = [{ id: "a" }, { id: "b" }];
  it("finds a record", () => expect(findById(items, "b")).toBe(items[1]));
  it("is undefined for a missing or absent id", () => {
    expect(findById(items, "c")).toBeUndefined();
    expect(findById(items, undefined)).toBeUndefined();
  });
});

describe("eventsFor", () => {
  const ev = (id: string, record: string, recordSub: string) => ({ id, record, recordSub }) as AuditEvent;
  it("matches the record or the sub-record", () => {
    const rows = [ev("1", "AML-1", "x"), ev("2", "AML-2", "AML-1"), ev("3", "AML-2", "y")];
    expect(eventsFor(rows, "AML-1").map((e) => e.id)).toEqual(["1", "2"]);
    expect(eventsFor(rows, "AML-9")).toEqual([]);
  });
});

describe("reportsForCase", () => {
  it("returns filings raised from the case", () => {
    const rows = [{ id: "SAR-1", ref: "AML-1" }, { id: "SAR-2", ref: "AML-2" }, { id: "SAR-3", ref: "AML-1" }] as Report[];
    expect(reportsForCase(rows, "AML-1").map((r) => r.id)).toEqual(["SAR-1", "SAR-3"]);
  });
});

describe("alertsForCase and alertsForRule", () => {
  const rows = [alert("A1"), alert("A2", { entityId: "C-2", rule: "TM-008 · Cash threshold" }), alert("A3", { rule: "TM-0145 · Other" })];
  it("matches the case's customer", () => {
    expect(alertsForCase(rows, kase("AML-1")).map((a) => a.id)).toEqual(["A1", "A3"]);
    expect(alertsForCase(rows, kase("AML-2", { entityId: "C-9" }))).toEqual([]);
  });
  it("matches the whole rule id, not a prefix", () => {
    expect(alertsForRule(rows, "TM-014").map((a) => a.id)).toEqual(["A1"]);
    expect(alertsForRule(rows, "TM-008").map((a) => a.id)).toEqual(["A2"]);
  });
});

describe("scopeOptionsFrom", () => {
  it("sorts, de-duplicates and drops blanks", () => {
    const s = (jurisdiction: string, typology: string) => ({ day: 1, unit: "u", jurisdiction, typology });
    expect(scopeOptionsFrom([s("GB", "b"), s("AE", "a"), s("", "b"), s("GB", "")])).toEqual({ jurisdictions: ["AE", "GB"], typologies: ["a", "b"] });
  });
});

describe("riskByJurisdiction", () => {
  it("groups by country with counts, exposure and the worst severity", () => {
    const rows = riskByJurisdiction([
      alert("1", { entityType: "AE · Corporate", severity: "Medium", amount: 10 }),
      alert("2", { entityType: "AE · MSB", severity: "Critical", amount: 5 }),
      alert("3", { entityType: "AE · Corporate", severity: "High", amount: 1 }),
      alert("4", { entityType: "GB · Corporate", severity: "Low", amount: 900 }),
      alert("5", { entityType: "Corporate", severity: "Critical", amount: 1 }),
    ]);
    expect(rows).toEqual([
      { code: "AE", alerts: 3, critical: 1, amount: 16, topSeverity: "Critical" },
      { code: "GB", alerts: 1, critical: 0, amount: 900, topSeverity: "Low" },
    ]);
  });
  it("breaks ties on alert count by exposure", () => {
    const rows = riskByJurisdiction([alert("1", { entityType: "AE · X", amount: 1 }), alert("2", { entityType: "GB · X", amount: 2 })]);
    expect(rows.map((r) => r.code)).toEqual(["GB", "AE"]);
  });
  it("keeps the worst severity when a milder one comes later", () => {
    const [r] = riskByJurisdiction([alert("1", { severity: "High" }), alert("2", { severity: "Medium" })]);
    expect(r.topSeverity).toBe("High");
  });
  it("is empty for no alerts", () => expect(riskByJurisdiction([])).toEqual([]));
});

describe("trendSummary", () => {
  it("is null for an empty range", () => expect(trendSummary([])).toBeNull());
  it("totals, finds the first peak and the change", () => {
    expect(trendSummary([{ date: "Sep 01", high: 40 }, { date: "Sep 02", high: 70 }, { date: "Sep 03", high: 70 }, { date: "Sep 04", high: 50 }])).toEqual({
      total: 230, peak: { date: "Sep 02", high: 70 }, first: 40, last: 50, changePct: 25,
    });
  });
  it("rounds the change to one decimal and allows a fall", () => {
    expect(trendSummary([{ date: "a", high: 3 }, { date: "b", high: 4 }])!.changePct).toBe(33.3);
    expect(trendSummary([{ date: "a", high: 3 }, { date: "b", high: 2 }])!.changePct).toBe(-33.3);
  });
  it("reports no change from a zero start or a single day", () => {
    expect(trendSummary([{ date: "a", high: 0 }, { date: "b", high: 5 }])!.changePct).toBe(0);
    expect(trendSummary([{ date: "a", high: 9 }])).toEqual({ total: 9, peak: { date: "a", high: 9 }, first: 9, last: 9, changePct: 0 });
  });
});

describe("buildNotifications", () => {
  const links = { alert: (id: string) => `/a/${id}`, case: (id: string) => `/c/${id}`, audit: "/audit" };
  it("lists breached alerts, then overdue cases, then denied access", () => {
    const items = buildNotifications(
      [alert("A1", { slaBreached: true, sla: "SLA overdue · 32m" }), alert("A2")],
      [kase("AML-1", { overdue: true, dueNote: "Overdue 1d", due: "Sep 27" }), kase("AML-2")],
      [{ title: "Export denied", sub: "svc", ago: "Sep 27" }],
      links,
    );
    expect(items).toEqual([
      { id: "A1", title: "SLA breached · A1", sub: "Orion · SLA overdue · 32m", when: "Sep 28, 09:42", tone: "bad", to: "/a/A1" },
      { id: "AML-1", title: "Case overdue · AML-1", sub: "Orion · Overdue 1d", when: "Sep 27", tone: "warn", to: "/c/AML-1" },
      { id: "denied-0", title: "Export denied", sub: "svc", when: "Sep 27", tone: "info", to: "/audit" },
    ]);
  });
  it("is empty when nothing needs attention", () => {
    expect(buildNotifications([alert("A1")], [kase("AML-1")], [], links)).toEqual([]);
  });
});

describe("recordPath", () => {
  it.each([
    ["ALT-92841", alertPath("ALT-92841")], ["AML-4821", casePath("AML-4821")],
    ["TM-014", rulePath("TM-014")], ["SC-003", rulePath("SC-003")],
    ["SAR-2026-0148", reportPath("SAR-2026-0148")], ["CTR-2026-0082", reportPath("CTR-2026-0082")],
    ["EVT-20260928-095412-4821", auditPath("EVT-20260928-095412-4821")],
  ])("%s has a page", (id, to) => {
    expect(recordPath(id)).toBe(to);
  });
  it.each(["Customer export", "TM-01a", "XTM-014", "TM-014 · Velocity", "SAR-26-1", "CTR-2026-", "12 cash transactions", ""])("%s has no page", (id) => {
    expect(recordPath(id)).toBeUndefined();
  });
  it("encodes ids into the path", () => {
    expect(alertPath("ALT 1/2")).toBe("/alerts/ALT%201%2F2");
  });
});
