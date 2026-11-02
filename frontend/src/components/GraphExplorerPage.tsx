import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { Info, Play, Sparkles, TriangleAlert } from "lucide-react";
import { forceLayout } from "../lib/forceLayout";
import { askGraph, cellText, fetchSchema, GraphApiError, nodeClass, nodeLabel, runCypher } from "../lib/graphApi";
import type { GraphNode, GraphSchema, QueryResult } from "../lib/graphApi";

const W = 760;
const H = 440;
const R = 7;
/** The API caps every query at this many rows (domain.graph.query.MAX_ROWS). */
export const MAX_ROWS = 200;
/** Past this many nodes the canvas drops txId labels; they would overlap into noise. */
const LABEL_LIMIT = 60;

export const STARTER_CYPHER = `MATCH p = (a:Transaction {class: "illicit"})-[:SENT_TO]->(b:Transaction)
RETURN p
LIMIT 25`;

export const EXAMPLES = [
  "Which illicit transactions send funds to licit ones?",
  "Show two-hop flows out of illicit transactions",
  "Which transactions receive the most incoming transfers?",
];

const CLASS_LABEL = { illicit: "Illicit", licit: "Licit", unknown: "Unknown" } as const;

type Failure = { message: string; hint?: string };

function failure(err: unknown): Failure {
  if (err instanceof GraphApiError) return { message: err.message, hint: err.hint };
  return { message: err instanceof Error ? err.message : String(err) };
}

function ErrorNote({ error }: { error: Failure }) {
  return (
    <div className="note bad-note" role="alert">
      <TriangleAlert size={14} />
      <span>{error.message}{error.hint && <><br />{error.hint}</>}</span>
    </div>
  );
}

function SchemaCard({ schema, error }: { schema: GraphSchema | null; error: Failure | null }) {
  const list = (items: Record<string, number>) => Object.entries(items).map(([k, v]) => (
    <li key={k}><code>{k}</code><strong>{v.toLocaleString("en-US")}</strong></li>
  ));
  return (
    <div className="card" role="region" aria-label="Graph schema">
      <h2>Graph schema</h2>
      <p className="card-sub">Live from Memgraph, refreshed every minute</p>
      {error && <ErrorNote error={error} />}
      {!schema && !error && <p className="empty">Loading schema…</p>}
      {schema && (
        <>
          <p className="eyebrow">Transaction classes</p>
          <ul className="schema-list">
            {Object.entries(schema.class_counts).map(([k, v]) => (
              <li key={k}><span className={`dot cls-${k}`} />{k}<strong>{v.toLocaleString("en-US")}</strong></li>
            ))}
          </ul>
          <p className="eyebrow">Node labels</p>
          <ul className="schema-list">{list(schema.labels)}</ul>
          <p className="eyebrow">Relationships</p>
          <ul className="schema-list">{list(schema.edge_types)}</ul>
          {Object.keys(schema.labels).length === 0 && <p className="card-sub">The graph is empty. Load the Elliptic dataset with the ingest endpoint first.</p>}
        </>
      )}
    </div>
  );
}

function GraphCanvas({ result, selected, onSelect }: { result: QueryResult; selected: string | null; onSelect: (id: string) => void }) {
  const pos = useMemo(
    () => forceLayout(result.nodes.map((n) => n.id), result.edges, W, H),
    [result],
  );
  const showLabels = result.nodes.length <= LABEL_LIMIT;
  const key = (id: string) => (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(id); }
  };
  return (
    <svg className="explorer-svg" viewBox={`0 0 ${W} ${H}`} role="group" aria-label="Graph canvas">
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" className="arrow-head" />
        </marker>
      </defs>
      {result.edges.map((e) => {
        const a = pos.get(e.source);
        const b = pos.get(e.target);
        if (!a || !b) return null;
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        // Stop the line at the target circle's rim so the arrowhead shows.
        const tx = b.x - ((b.x - a.x) / len) * (R + 2);
        const ty = b.y - ((b.y - a.y) / len) * (R + 2);
        const on = selected !== null && (e.source === selected || e.target === selected);
        return <line key={e.id} className={`xedge${on ? " on" : ""}`} x1={a.x} y1={a.y} x2={tx} y2={ty} markerEnd="url(#arrow)"><title>{e.type}</title></line>;
      })}
      {result.nodes.map((n) => {
        const p = pos.get(n.id)!;
        const cls = nodeClass(n);
        const label = nodeLabel(n);
        const isSel = n.id === selected;
        return (
          <g
            key={n.id}
            className={`xnode cls-${cls}${isSel ? " on" : ""}`}
            transform={`translate(${p.x},${p.y})`}
            role="button"
            tabIndex={0}
            aria-label={`${label}, ${CLASS_LABEL[cls]}`}
            aria-pressed={isSel}
            onClick={() => onSelect(n.id)}
            onKeyDown={key(n.id)}
          >
            <circle r={isSel ? R + 3 : R} />
            {showLabels && <text y={-R - 5}>{label}</text>}
          </g>
        );
      })}
    </svg>
  );
}

function Inspector({ node, result }: { node: GraphNode | undefined; result: QueryResult | null }) {
  if (!node || !result) {
    return (
      <aside className="card inspector" role="region" aria-label="Node details">
        <p className="eyebrow">Selected</p>
        <p className="card-sub">Click a node in the graph to inspect its properties.</p>
      </aside>
    );
  }
  const out = result.edges.filter((e) => e.source === node.id).length;
  const inc = result.edges.filter((e) => e.target === node.id).length;
  const cls = nodeClass(node);
  return (
    <aside className="card inspector" role="region" aria-label="Node details">
      <p className="eyebrow">Selected</p>
      <h2>{nodeLabel(node)}</h2>
      <p className="card-sub"><span className={`dot cls-${cls}`} /> {node.labels.join(", ") || "No label"} · {CLASS_LABEL[cls]}</p>
      <dl className="tiles">
        <div><dt>Outgoing in result</dt><dd>{out}</dd></div>
        <div><dt>Incoming in result</dt><dd>{inc}</dd></div>
      </dl>
      <p className="eyebrow spaced-eyebrow">Properties</p>
      <dl className="prop-list">
        {Object.entries(node.properties).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{cellText(v)}</dd></div>)}
      </dl>
    </aside>
  );
}

function ResultsTable({ result }: { result: QueryResult }) {
  return (
    <div className="card" role="region" aria-label="Query results">
      <div className="card-head">
        <div>
          <h2>Query results</h2>
          <p className="card-sub">
            {result.rows.length.toLocaleString("en-US")} {result.rows.length === 1 ? "row" : "rows"}
            {" · "}{result.nodes.length} nodes · {result.edges.length} relationships drawn
          </p>
        </div>
      </div>
      {result.rows.length >= MAX_ROWS && (
        <div className="note warn"><Info size={14} /><span>Capped at {MAX_ROWS} rows. Narrow the question or add a filter to see the rest.</span></div>
      )}
      {result.rows.length === 0
        ? <p className="empty">The query matched nothing.</p>
        : (
          <div className="table-scroll">
            <table>
              <thead><tr>{result.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
              <tbody>
                {result.rows.map((row, i) => (
                  <tr key={i}>{row.map((v, j) => <td key={j} className="mono-cell">{cellText(v)}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </div>
  );
}

/** Investigations: ask Claude a question about the Memgraph transaction graph, review and edit the
 * Cypher it wrote, and explore the result as a graph and a table. */
export function GraphExplorerPage() {
  const [schema, setSchema] = useState<GraphSchema | null>(null);
  const [schemaError, setSchemaError] = useState<Failure | null>(null);
  const [question, setQuestion] = useState("");
  const [cypher, setCypher] = useState(STARTER_CYPHER);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<Failure | null>(null);
  const [busy, setBusy] = useState<"ask" | "run" | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  // Only the latest request may write state; an older one finishing late is dropped.
  const latest = useRef(0);

  async function submit(kind: "ask" | "run", request: () => Promise<QueryResult>) {
    const ticket = ++latest.current;
    setBusy(kind);
    setError(null);
    try {
      const res = await request();
      if (ticket !== latest.current) return;
      setResult(res);
      setCypher(res.cypher);
      setExplanation(res.explanation);
      setSelected(res.nodes[0]?.id ?? null);
    } catch (err) {
      if (ticket === latest.current) setError(failure(err));
    } finally {
      if (ticket === latest.current) setBusy(null);
    }
  }

  useEffect(() => {
    let live = true;
    fetchSchema().then((s) => { if (live) setSchema(s); }, (err) => { if (live) setSchemaError(failure(err)); });
    void submit("run", () => runCypher(STARTER_CYPHER));
    return () => { live = false; latest.current++; };
  }, []);

  const ask = (e: FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (q.length >= 3) void submit("ask", () => askGraph(q));
  };
  const run = (e: FormEvent) => {
    e.preventDefault();
    if (cypher.trim()) void submit("run", () => runCypher(cypher));
  };
  const node = result?.nodes.find((n) => n.id === selected);

  return (
    <>
      <section className="explorer-top">
        <div className="card" role="region" aria-label="Ask the graph">
          <h2>Ask the graph</h2>
          <p className="card-sub">Claude writes read-only Cypher for your question; review or edit it before re-running.</p>
          <form className="ask-form" onSubmit={ask}>
            <label className="sr-only" htmlFor="graph-question">Question</label>
            <input
              id="graph-question"
              className="text-input"
              placeholder="e.g. Which illicit transactions send funds to licit ones?"
              value={question}
              maxLength={1000}
              onChange={(e) => setQuestion(e.target.value)}
            />
            <button className="btn primary" type="submit" disabled={busy !== null || question.trim().length < 3}>
              <Sparkles size={13} />{busy === "ask" ? "Asking Claude…" : "Ask"}
            </button>
          </form>
          <div className="chips">
            {EXAMPLES.map((q) => <button key={q} type="button" className="chip" onClick={() => setQuestion(q)}>{q}</button>)}
          </div>
          <form className="cypher-form" onSubmit={run}>
            <label className="eyebrow" htmlFor="graph-cypher">Cypher</label>
            <textarea id="graph-cypher" className="cypher" spellCheck={false} rows={5} value={cypher} onChange={(e) => setCypher(e.target.value)} />
            <div className="table-actions spaced">
              <button className="btn" type="submit" disabled={busy !== null || !cypher.trim()}>
                <Play size={13} />{busy === "run" ? "Running…" : "Run query"}
              </button>
              <span className="card-sub">Read-only: writes, procedures and multiple statements are rejected. Results are capped at {MAX_ROWS} rows.</span>
            </div>
          </form>
          {explanation && <div className="note info"><Sparkles size={14} /><span>{explanation}</span></div>}
          {error && <ErrorNote error={error} />}
        </div>
        <SchemaCard schema={schema} error={schemaError} />
      </section>
      <section className="graph-layout">
        <div className="card" role="region" aria-label="Graph view" aria-busy={busy !== null}>
          <div className="card-head">
            <div>
              <h2>Graph view</h2>
              <p className="card-sub">Arrows follow SENT_TO: funds flow from source to target</p>
            </div>
          </div>
          <div className="legend">
            {(["illicit", "licit", "unknown"] as const).map((c) => <span key={c}><span className={`dot cls-${c}`} />{CLASS_LABEL[c]}</span>)}
          </div>
          {!result && !error && <p className="empty">Running the starter query…</p>}
          {result && result.nodes.length === 0 && (
            <p className="empty">Nothing to draw: this result has no nodes or relationships. Return paths or nodes to see them here.</p>
          )}
          {result && result.nodes.length > 0 && <GraphCanvas result={result} selected={selected} onSelect={setSelected} />}
        </div>
        <Inspector node={node} result={result} />
      </section>
      {result && <ResultsTable result={result} />}
    </>
  );
}
