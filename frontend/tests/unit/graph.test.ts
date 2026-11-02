import { describe, expect, it } from "vitest";
import { CANVAS, NODE_H, NODE_W, edges, nodes } from "../../src/data/graph";
import { edgePoints, pct } from "../../src/lib/graph";

describe("edgePoints", () => {
  it("clips a horizontal edge at the left and right box borders", () => {
    expect(edgePoints({ x: 0, y: 0 }, { x: 300, y: 0 }, 200, 80)).toEqual({ x1: 100, y1: 0, x2: 200, y2: 0 });
  });
  it("clips a vertical edge at the top and bottom box borders", () => {
    expect(edgePoints({ x: 0, y: 0 }, { x: 0, y: 200 }, 200, 80)).toEqual({ x1: 0, y1: 40, x2: 0, y2: 160 });
  });
  it("exits through whichever border the diagonal hits first", () => {
    // Steep: leaves through the bottom edge (h/2 = 40 of dy = 200 -> t = 0.2).
    expect(edgePoints({ x: 0, y: 0 }, { x: 100, y: 200 }, 200, 80)).toEqual({ x1: 20, y1: 40, x2: 80, y2: 160 });
    // Shallow: leaves through the side edge (w/2 = 100 of dx = 400 -> t = 0.25).
    expect(edgePoints({ x: 0, y: 0 }, { x: 400, y: 100 }, 200, 80)).toEqual({ x1: 100, y1: 25, x2: 300, y2: 75 });
  });
  it("handles edges pointing left and up", () => {
    expect(edgePoints({ x: 300, y: 200 }, { x: 0, y: 200 }, 200, 80)).toEqual({ x1: 200, y1: 200, x2: 100, y2: 200 });
    expect(edgePoints({ x: 0, y: 200 }, { x: 0, y: 0 }, 200, 80)).toEqual({ x1: 0, y1: 160, x2: 0, y2: 40 });
  });
  it("returns coincident centres unchanged instead of dividing by zero", () => {
    expect(edgePoints({ x: 5, y: 7 }, { x: 5, y: 7 }, 200, 80)).toEqual({ x1: 5, y1: 7, x2: 5, y2: 7 });
  });
});

describe("pct", () => {
  it("formats a share of the canvas as a CSS percentage", () => {
    expect(pct(380, 760)).toBe("50.000%");
    expect(pct(1, 3)).toBe("33.333%");
    expect(pct(0, 620)).toBe("0.000%");
  });
});

describe("graph data", () => {
  it("has unique node ids and edges that reference real nodes", () => {
    const ids = nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of edges) {
      expect(ids).toContain(e.from);
      expect(ids).toContain(e.to);
    }
  });
  it("keeps every node box inside the canvas", () => {
    for (const n of nodes) {
      expect(n.x - NODE_W / 2).toBeGreaterThanOrEqual(0);
      expect(n.x + NODE_W / 2).toBeLessThanOrEqual(CANVAS.w);
      expect(n.y - NODE_H / 2).toBeGreaterThanOrEqual(0);
      expect(n.y + NODE_H / 2).toBeLessThanOrEqual(CANVAS.h);
    }
  });
  it("marks exactly one node as the selected transaction", () => {
    expect(nodes.filter((n) => n.kind === "selected").map((n) => n.title)).toEqual(["TXN-984218"]);
  });
});
