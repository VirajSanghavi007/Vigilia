// Client for the FastAPI graph explorer (/v1/graph). Vite proxies /v1 to the
// backend in dev, so these are same-origin requests.

export type GraphSchema = {
  labels: Record<string, number>;
  edge_types: Record<string, number>;
  property_keys: string[];
  class_counts: Record<string, number>;
};

export type GraphNode = { id: string; labels: string[]; properties: Record<string, unknown> };
export type GraphEdge = { id: string; type: string; source: string; target: string };

export type QueryResult = {
  cypher: string;
  explanation: string | null;
  columns: string[];
  rows: unknown[][];
  nodes: GraphNode[];
  edges: GraphEdge[];
};

/** What the page should say for each failure status, beyond the server's own detail. */
const HINTS: Record<number, string> = {
  503: "Start Memgraph with `docker compose up -d memgraph`, then try again.",
  502: "Check that ANTHROPIC_API_KEY is set for the API server.",
};

export class GraphApiError extends Error {
  constructor(readonly status: number, message: string, readonly hint?: string) {
    super(message);
    this.name = "GraphApiError";
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/v1/graph${path}`, init);
  } catch {
    throw new GraphApiError(0, "The Vigilia API is not reachable.", "Start it with `python -m uvicorn vigilia.api.main:app --port 8000`.");
  }
  if (res.ok) return (await res.json()) as T;
  const body = (await res.json().catch(() => null)) as { detail?: unknown } | null;
  // FastAPI's own 422 for a bad request body is a list of field errors, not a string.
  const detail = typeof body?.detail === "string" ? body.detail : `Request failed (${res.status}).`;
  throw new GraphApiError(res.status, detail, HINTS[res.status]);
}

const post = (body: object): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const fetchSchema = () => call<GraphSchema>("/schema");
export const askGraph = (question: string) => call<QueryResult>("/ask", post({ question }));
export const runCypher = (cypher: string) => call<QueryResult>("/query", post({ cypher }));

export type TxClass = "illicit" | "licit" | "unknown";

/** Elliptic class of a node; anything unlabelled or non-transaction counts as unknown. */
export function nodeClass(node: GraphNode): TxClass {
  const c = node.properties.class;
  return c === "illicit" || c === "licit" ? c : "unknown";
}

/** Short on-canvas label: the txId when there is one, else the first label. */
export function nodeLabel(node: GraphNode): string {
  const tx = node.properties.txId;
  return tx !== undefined && tx !== null ? String(tx) : node.labels[0] ?? "node";
}

/** Table cell text for any JSON value the API returns. */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}
