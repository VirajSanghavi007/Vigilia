import { CANVAS, NODE_H, NODE_W, edges, nodes, type EdgeKind } from "../data/graph";
import { edgePoints, pct } from "../lib/graph";

const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
const kinds: EdgeKind[] = ["payment", "context", "risk"];

/**
 * Relationship canvas around TXN-984218: SVG edges with HTML node buttons laid
 * over them at the same coordinates, so nodes stay focusable and readable.
 */
export function TransactionGraph({ selected, onSelect }: { selected: string; onSelect: (id: string) => void }) {
  return (
    <div className="graph-scroll">
      <div className="graph-canvas" style={{ aspectRatio: `${CANVAS.w} / ${CANVAS.h}` }}>
        <svg viewBox={`0 0 ${CANVAS.w} ${CANVAS.h}`} aria-hidden>
          <defs>
            {kinds.map((k) => (
              <marker key={k} id={`arrow-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0 0L10 5L0 10z" className={`arrow ${k}`} />
              </marker>
            ))}
          </defs>
          {edges.map((e) => {
            const p = edgePoints(byId[e.from], byId[e.to], NODE_W, NODE_H);
            const at = e.at ?? 0.5;
            const lx = p.x1 + (p.x2 - p.x1) * at;
            const ly = p.y1 + (p.y2 - p.y1) * at;
            return (
              <g key={`${e.from}-${e.to}`} className={`edge ${e.kind}`}>
                <line {...p} markerEnd={`url(#arrow-${e.kind})`} />
                <text x={lx} y={ly} dy="0.35em" textAnchor="middle" className="edge-label">{e.label}</text>
              </g>
            );
          })}
        </svg>
        {nodes.map((n) => (
          <button key={n.id} className={`gnode ${n.kind}${n.id === selected ? " on" : ""}`} aria-pressed={n.id === selected}
            style={{ left: pct(n.x - NODE_W / 2, CANVAS.w), top: pct(n.y - NODE_H / 2, CANVAS.h), width: pct(NODE_W, CANVAS.w), height: pct(NODE_H, CANVAS.h) }}
            onClick={() => onSelect(n.id)}>
            <strong>{n.title}</strong>
            {n.lines.map((l) => <span key={l}>{l}</span>)}
          </button>
        ))}
      </div>
    </div>
  );
}

export function GraphLegend() {
  return (
    <div className="legend graph-legend">
      <span><i className="key selected" />Selected transaction</span>
      <span><i className="key cluster" />Linked activity</span>
      <span><i className="key risk" />High-risk connection</span>
      <span><i className="key sample" />Sample relationship</span>
    </div>
  );
}
