// Geometry for the transaction graph. No React, so it unit-tests directly.

export interface Point { x: number; y: number }

/**
 * Where the straight line between two box centres leaves each box, so arrows
 * start and end on the node borders instead of under them. Boxes are w x h.
 */
export function edgePoints(a: Point, b: Point, w: number, h: number): { x1: number; y1: number; x2: number; y2: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
  // Fraction of the centre-to-centre vector that stays inside one box.
  const t = Math.min(dx === 0 ? Infinity : w / 2 / Math.abs(dx), dy === 0 ? Infinity : h / 2 / Math.abs(dy));
  return { x1: a.x + dx * t, y1: a.y + dy * t, x2: b.x - dx * t, y2: b.y - dy * t };
}

/** Position as a percentage of the canvas, for HTML nodes laid over the SVG edges. */
export function pct(value: number, total: number): string {
  return `${((value / total) * 100).toFixed(3)}%`;
}
