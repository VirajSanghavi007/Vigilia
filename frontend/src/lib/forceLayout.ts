// Deterministic force-directed layout (Fruchterman-Reingold) for the graph
// explorer. Hand-rolled rather than d3-force: a query result is at most a few
// hundred nodes, a fixed-step simulation is plenty, and being a pure function
// of its input means the same query always draws the same picture (and tests
// can assert on it) with no new dependency.

export type Point = { x: number; y: number };
type Link = { source: string; target: string };

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const GRAVITY = 0.2;

export function forceLayout(ids: string[], links: Link[], width: number, height: number, pad = 28): Map<string, Point> {
  const n = ids.length;
  const out = new Map<string, Point>();
  if (n === 0) return out;
  if (n === 1) {
    out.set(ids[0], { x: width / 2, y: height / 2 });
    return out;
  }

  const index = new Map(ids.map((id, i) => [id, i]));
  const pairs = links
    .map((l) => [index.get(l.source), index.get(l.target)] as const)
    .filter((p): p is readonly [number, number] => p[0] !== undefined && p[1] !== undefined && p[0] !== p[1]);

  // Sunflower-spiral start: spread out, and the same every time.
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const r = Math.sqrt(i + 0.5) * 10;
    xs[i] = r * Math.cos(i * GOLDEN_ANGLE);
    ys[i] = r * Math.sin(i * GOLDEN_ANGLE);
  }

  const k = 30; // ideal edge length, in layout units before fitting
  // O(n^2) per step, so big results get fewer steps to stay interactive.
  const steps = n > 300 ? 60 : 200;
  let temp = k * 2;
  const dx = new Float64Array(n);
  const dy = new Float64Array(n);
  for (let step = 0; step < steps; step++) {
    dx.fill(0);
    dy.fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let ux = xs[i] - xs[j];
        let uy = ys[i] - ys[j];
        let d2 = ux * ux + uy * uy;
        if (d2 < 1e-6) { ux = 0.1; uy = 0; d2 = 0.01; }
        const f = (k * k) / d2; // repulsion k^2/d, applied along the unit vector u/d
        dx[i] += ux * f; dy[i] += uy * f;
        dx[j] -= ux * f; dy[j] -= uy * f;
      }
    }
    for (const [a, b] of pairs) {
      const ux = xs[a] - xs[b];
      const uy = ys[a] - ys[b];
      const d = Math.sqrt(ux * ux + uy * uy) || 0.01;
      const f = d / k; // attraction d^2/k, along u/d
      dx[a] -= ux * f; dy[a] -= uy * f;
      dx[b] += ux * f; dy[b] += uy * f;
    }
    for (let i = 0; i < n; i++) {
      // Gravity keeps disconnected components near each other; too weak and
      // they drift to the corners, so fitting to the box squashes each one.
      dx[i] -= xs[i] * GRAVITY;
      dy[i] -= ys[i] * GRAVITY;
      const len = Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i]);
      if (len > 0) {
        const move = Math.min(len, temp);
        xs[i] += (dx[i] / len) * move;
        ys[i] += (dy[i] / len) * move;
      }
    }
    temp = Math.max(temp * 0.97, 0.5);
  }

  // Fit into the box, keeping the aspect ratio so distances stay meaningful.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, xs[i]); maxX = Math.max(maxX, xs[i]);
    minY = Math.min(minY, ys[i]); maxY = Math.max(maxY, ys[i]);
  }
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const scale = Math.min((width - 2 * pad) / spanX, (height - 2 * pad) / spanY);
  const offX = (width - spanX * scale) / 2;
  const offY = (height - spanY * scale) / 2;
  ids.forEach((id, i) => out.set(id, { x: offX + (xs[i] - minX) * scale, y: offY + (ys[i] - minY) * scale }));
  return out;
}
