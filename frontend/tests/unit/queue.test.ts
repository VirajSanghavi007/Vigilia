import { describe, expect, it } from "vitest";
import { getAlertQueue, getCases } from "../../src/data/queue";
import type { Case, QueueAlert } from "../../src/data/types";
import {
  alertRank, applyFilters, caseRank, caseStats, matchesQuery, percent, queueStats, sortByPriority, toggleId,
  togglePage, uniqueValues, workload,
} from "../../src/lib/queue";

const alert = (over: Partial<QueueAlert>): QueueAlert => ({
  id: "A", entity: "E", entityId: "C-1", entityType: "", severity: "High", typology: "T", rule: "", amount: 1,
  txCount: 1, score: 50, detected: "", sla: "", slaBreached: false, assignee: null, status: "New",
  narrative: "", customerRisk: "", linked: "", ...over,
});
const kase = (over: Partial<Case>): Case => ({
  id: "K", opened: "", entity: "E", entityId: "", entityType: "", type: "T", typeSub: "", priority: "High",
  status: "New", investigator: null, alerts: 1, due: "", dueNote: "", overdue: false, dueToday: false, ...over,
});

describe("matchesQuery", () => {
  it("matches any field, trimmed and case-insensitive", () => {
    expect(matchesQuery(["ALT-1", "Orion"], "  orion ")).toBe(true);
    expect(matchesQuery(["ALT-1", "Orion"], "alt-1")).toBe(true);
    expect(matchesQuery(["ALT-1", null], "zzz")).toBe(false);
  });
  it("blank query matches everything", () => {
    expect(matchesQuery([], "   ")).toBe(true);
  });
});

describe("applyFilters", () => {
  const items = [alert({ id: "1", severity: "Critical" }), alert({ id: "2", severity: "Low", typology: "X" })];
  it("ignores filters set to All", () => {
    expect(applyFilters(items, [{ get: (a) => a.severity, value: "All" }])).toHaveLength(2);
  });
  it("requires every active filter to match", () => {
    expect(applyFilters(items, [{ get: (a) => a.severity, value: "Low" }]).map((a) => a.id)).toEqual(["2"]);
    expect(applyFilters(items, [
      { get: (a) => a.severity, value: "Low" }, { get: (a) => a.typology, value: "T" },
    ])).toEqual([]);
  });
});

describe("sortByPriority and ranks", () => {
  const items = [alert({ id: "m", severity: "Medium", score: 99 }), alert({ id: "c", severity: "Critical", score: 60 }), alert({ id: "c2", severity: "Critical", score: 90 })];
  it("puts severity before score, highest first", () => {
    expect(sortByPriority(items, alertRank, "desc").map((a) => a.id)).toEqual(["c2", "c", "m"]);
  });
  it("reverses for lowest first without mutating input", () => {
    expect(sortByPriority(items, alertRank, "asc").map((a) => a.id)).toEqual(["m", "c", "c2"]);
    expect(items[0].id).toBe("m");
  });
  it("ranks cases by priority, then overdue, then due today", () => {
    const cs = [kase({ id: "plain" }), kase({ id: "today", dueToday: true }), kase({ id: "late", overdue: true }), kase({ id: "crit", priority: "Critical" })];
    expect(sortByPriority(cs, caseRank, "desc").map((c) => c.id)).toEqual(["crit", "late", "today", "plain"]);
  });
});

describe("selection helpers", () => {
  it("toggleId adds then removes, returning new sets", () => {
    const a = new Set<string>();
    const b = toggleId(a, "x");
    expect([...b]).toEqual(["x"]);
    expect(a.size).toBe(0);
    expect(toggleId(b, "x").size).toBe(0);
  });
  it("togglePage selects the rest of the page, or clears it when all are selected", () => {
    const some = new Set(["a", "z"]);
    expect([...togglePage(some, ["a", "b"])].sort()).toEqual(["a", "b", "z"]);
    expect([...togglePage(new Set(["a", "b", "z"]), ["a", "b"])]).toEqual(["z"]);
  });
  it("togglePage on an empty page changes nothing", () => {
    expect(togglePage(new Set(["z"]), []).size).toBe(1);
  });
});

describe("small helpers", () => {
  it("uniqueValues keeps first-seen order", () => {
    expect(uniqueValues(["b", "a", "b"], (x) => x)).toEqual(["b", "a"]);
  });
  it("percent rounds and guards zero", () => {
    expect(percent(12, 27)).toBe(44);
    expect(percent(1, 0)).toBe(0);
  });
});

describe("queueStats", () => {
  it("counts critical, unassigned, breached and mine", () => {
    const s = queueStats([
      alert({ severity: "Critical" }), alert({ severity: "Critical", assignee: "me" }),
      alert({ slaBreached: true, assignee: "you" }), alert({}),
    ], "me");
    expect(s).toEqual({ open: 4, critical: 2, criticalUnassigned: 1, unassigned: 2, unassignedPct: 50, breached: 1, mine: 1 });
  });
});

describe("caseStats and workload", () => {
  const cs = [
    kase({ priority: "Critical", overdue: true, investigator: "me" }), kase({ priority: "Critical" }),
    kase({ dueToday: true, status: "Pending approval", investigator: "you" }), kase({ dueToday: true, status: "In progress", investigator: "you" }),
  ];
  it("counts every KPI", () => {
    expect(caseStats(cs, "me")).toEqual({
      open: 4, critical: 2, criticalOverdue: 1, unassigned: 1, unassignedPct: 25, dueToday: 2,
      dueTodayAwaitingApproval: 1, pendingApproval: 1, overdue: 1, mine: 1,
    });
  });
  it("workload is busiest first and skips unassigned", () => {
    expect(workload(cs)).toEqual([{ name: "you", count: 2 }, { name: "me", count: 1 }]);
  });
});

// The mock data is meant to reproduce the Figma numbers; these pin that down.
describe("mock data matches the Figma frames", () => {
  it("alert queue: 27 open, 9 critical (3 unassigned), 12 unassigned, 7 breached, 6 mine", () => {
    const q = getAlertQueue();
    expect(queueStats(q.alerts, q.currentUser)).toEqual({
      open: 27, critical: 9, criticalUnassigned: 3, unassigned: 12, unassignedPct: 44, breached: 7, mine: 6,
    });
    expect(new Set(q.alerts.map((a) => a.id)).size).toBe(27);
  });
  it("cases: 14 open, 3 critical (1 overdue), 2 unassigned, 4 due today, 2 overdue, 4 mine", () => {
    const c = getCases();
    expect(caseStats(c.cases, c.currentUser)).toMatchObject({
      open: 14, critical: 3, criticalOverdue: 1, unassigned: 2, unassignedPct: 14, dueToday: 4,
      dueTodayAwaitingApproval: 1, pendingApproval: 2, overdue: 2, mine: 4,
    });
    expect(workload(c.cases)).toEqual([
      { name: "D. Chiu", count: 3 }, { name: "M. Alvarez", count: 3 }, { name: "A. Patel", count: 4 }, { name: "N. Karim", count: 2 },
    ].sort((a, b) => b.count - a.count));
  });
});
