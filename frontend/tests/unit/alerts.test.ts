import { describe, expect, it } from "vitest";
import type { Alert } from "../../src/data/types";
import { filterAlerts, paginate } from "../../src/lib/alerts";

const mk = (id: string, over: Partial<Alert> = {}): Alert => ({
  id, entity: `Entity ${id}`, entityId: `ALF-${id}`, entityType: "Corporate", meta: "", amount: 1, score: 50,
  typology: "Structuring / smurfing", status: "In review", analyst: "D. Chiu", ...over,
});

describe("filterAlerts", () => {
  const alerts = [
    mk("1", { entity: "Orion Trading FZE" }),
    mk("2", { typology: "Sanctions proximity", analyst: null }),
    mk("3", { analyst: "N. Karim" }),
  ];
  it("returns everything for a blank query", () => {
    expect(filterAlerts(alerts, "   ")).toHaveLength(3);
  });
  it("matches entity name case-insensitively", () => {
    expect(filterAlerts(alerts, "ORION").map((a) => a.id)).toEqual(["1"]);
  });
  it("matches entity id, typology and analyst", () => {
    expect(filterAlerts(alerts, "alf-2").map((a) => a.id)).toEqual(["2"]);
    expect(filterAlerts(alerts, "sanctions").map((a) => a.id)).toEqual(["2"]);
    expect(filterAlerts(alerts, "karim").map((a) => a.id)).toEqual(["3"]);
  });
  it("trims the query and tolerates a null analyst", () => {
    expect(filterAlerts(alerts, "  karim ").map((a) => a.id)).toEqual(["3"]);
    expect(filterAlerts(alerts, "nobody")).toEqual([]);
  });
});

describe("paginate", () => {
  const items = Array.from({ length: 12 }, (_, i) => i + 1);
  it("returns the requested page with 1-based bounds", () => {
    expect(paginate(items, 2, 5)).toEqual({ items: [6, 7, 8, 9, 10], page: 2, pageCount: 3, start: 6, end: 10 });
  });
  it("returns a short last page", () => {
    expect(paginate(items, 3, 5)).toMatchObject({ items: [11, 12], start: 11, end: 12 });
  });
  it("clamps out-of-range pages", () => {
    expect(paginate(items, 0, 5).page).toBe(1);
    expect(paginate(items, 99, 5).page).toBe(3);
  });
  it("handles an exact multiple and an empty list", () => {
    expect(paginate(items.slice(0, 10), 2, 5).pageCount).toBe(2);
    expect(paginate([], 1, 5)).toEqual({ items: [], page: 1, pageCount: 1, start: 0, end: 0 });
  });
});
