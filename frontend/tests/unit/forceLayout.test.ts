import { describe, expect, it } from "vitest";
import { forceLayout } from "../../src/lib/forceLayout";

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

describe("forceLayout", () => {
  it("returns nothing for no nodes and centres a single node", () => {
    expect(forceLayout([], [], 100, 80).size).toBe(0);
    expect(forceLayout(["a"], [], 100, 80).get("a")).toEqual({ x: 50, y: 40 });
  });

  it("places every node inside the padded box and fills one axis", () => {
    const ids = Array.from({ length: 30 }, (_, i) => `n${i}`);
    const links = ids.slice(1).map((id, i) => ({ source: ids[i], target: id }));
    const pos = forceLayout(ids, links, 400, 300, 20);
    const pts = [...pos.values()];
    expect(pts).toHaveLength(30);
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(20 - 1e-9);
      expect(p.x).toBeLessThanOrEqual(380 + 1e-9);
      expect(p.y).toBeGreaterThanOrEqual(20 - 1e-9);
      expect(p.y).toBeLessThanOrEqual(280 + 1e-9);
    }
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const spanX = Math.max(...xs) - Math.min(...xs);
    const spanY = Math.max(...ys) - Math.min(...ys);
    // Scaled to fit, so at least one axis spans the whole padded box.
    expect(Math.max(spanX / 360, spanY / 260)).toBeCloseTo(1, 6);
    // And centred on the other.
    expect((Math.max(...xs) + Math.min(...xs)) / 2).toBeCloseTo(200, 6);
    expect((Math.max(...ys) + Math.min(...ys)) / 2).toBeCloseTo(150, 6);
  });

  it("is deterministic", () => {
    const ids = ["a", "b", "c", "d"];
    const links = [{ source: "a", target: "b" }, { source: "c", target: "d" }];
    expect(forceLayout(ids, links, 300, 200)).toEqual(forceLayout(ids, links, 300, 200));
  });

  it("pulls linked nodes together and pushes unlinked ones apart", () => {
    // Two triangles with no link between them.
    const ids = ["a1", "a2", "a3", "b1", "b2", "b3"];
    const tri = (p: string) => [[`${p}1`, `${p}2`], [`${p}2`, `${p}3`], [`${p}3`, `${p}1`]].map(([source, target]) => ({ source, target }));
    const pos = forceLayout(ids, [...tri("a"), ...tri("b")], 600, 600);
    const p = (id: string) => pos.get(id)!;
    const within = Math.max(dist(p("a1"), p("a2")), dist(p("a2"), p("a3")), dist(p("b1"), p("b2")));
    const across = Math.min(...["a1", "a2", "a3"].flatMap((a) => ["b1", "b2", "b3"].map((b) => dist(p(a), p(b)))));
    expect(across).toBeGreaterThan(within);
  });

  it("keeps nodes apart and ignores self-loops and links to unknown nodes", () => {
    const ids = ["a", "b", "c"];
    const clean = forceLayout(ids, [{ source: "a", target: "b" }], 300, 300);
    const noisy = forceLayout(ids, [
      { source: "a", target: "b" }, { source: "c", target: "c" }, { source: "a", target: "ghost" }, { source: "ghost", target: "c" },
    ], 300, 300);
    expect(noisy).toEqual(clean);
    expect(dist(clean.get("a")!, clean.get("c")!)).toBeGreaterThan(10);
    expect(dist(clean.get("b")!, clean.get("c")!)).toBeGreaterThan(10);
  });

  it("keeps a linked pair well apart", () => {
    const pos = forceLayout(["a", "b"], [{ source: "a", target: "b" }], 200, 100);
    expect(dist(pos.get("a")!, pos.get("b")!)).toBeGreaterThan(50);
  });

  it("spreads a chain out instead of collapsing it onto its middle", () => {
    // Without repulsion both ends would fall onto the middle node; fitting to
    // the box rescales, so compare distances to each other, not to pixels.
    const pos = forceLayout(["a", "b", "c"], [{ source: "a", target: "b" }, { source: "b", target: "c" }], 400, 400);
    const p = (id: string) => pos.get(id)!;
    expect(dist(p("a"), p("c"))).toBeGreaterThan(1.5 * Math.max(dist(p("a"), p("b")), dist(p("b"), p("c"))));
  });

  it("centres the short axis in tall and wide boxes", () => {
    const ids = ["a", "b", "c", "d", "e"];
    const links = ids.slice(1).map((id, i) => ({ source: ids[i], target: id }));
    for (const [w, h] of [[3000, 200], [200, 3000]]) {
      const pts = [...forceLayout(ids, links, w, h, 10).values()];
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      expect((Math.max(...xs) + Math.min(...xs)) / 2).toBeCloseTo(w / 2, 6);
      expect((Math.max(...ys) + Math.min(...ys)) / 2).toBeCloseTo(h / 2, 6);
    }
  });

  it("keeps separate flows close enough that each stays readable", () => {
    // Four unconnected paths, like a typical query result. If they drift to
    // the corners, fitting to the box crushes each path to a few pixels.
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k"];
    const links = [["a", "b"], ["b", "c"], ["d", "e"], ["e", "f"], ["g", "h"], ["h", "i"], ["j", "k"]].map(([source, target]) => ({ source, target }));
    const pos = forceLayout(ids, links, 760, 440);
    for (const l of links) expect(dist(pos.get(l.source)!, pos.get(l.target)!)).toBeGreaterThan(35);
  });

  it("lays out a large result without hanging", () => {
    const ids = Array.from({ length: 400 }, (_, i) => `n${i}`);
    const links = ids.slice(1).map((id, i) => ({ source: ids[Math.floor(i / 3)], target: id }));
    const t = performance.now();
    const pos = forceLayout(ids, links, 760, 440);
    expect(pos.size).toBe(400);
    expect(performance.now() - t).toBeLessThan(5000);
    for (const p of pos.values()) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
  });
});
