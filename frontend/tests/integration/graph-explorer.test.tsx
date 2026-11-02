import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import App from "../../src/App";
import { MAX_ROWS, STARTER_CYPHER } from "../../src/components/GraphExplorerPage";
import type { QueryResult } from "../../src/lib/graphApi";

// Real App and page against a fake /v1/graph backend behind fetch: the
// starter query, asking Claude, editing and re-running Cypher, the
// inspector, and each failure the API can report.

const schema = {
  labels: { Transaction: 203769 },
  edge_types: { SENT_TO: 234355 },
  property_keys: ["txId", "class", "timeStep"],
  class_counts: { unknown: 157205, licit: 42019, illicit: 4545 },
};

const node = (id: string, txId: string, cls: string) => ({ id, labels: ["Transaction"], properties: { txId, class: cls, timeStep: 7 } });

const starter: QueryResult = {
  cypher: STARTER_CYPHER,
  explanation: null,
  columns: ["p"],
  rows: [["path (1 hops)"], ["path (1 hops)"]],
  nodes: [node("n1", "111", "illicit"), node("n2", "222", "licit"), node("n3", "333", "unknown")],
  edges: [{ id: "e1", type: "SENT_TO", source: "n1", target: "n2" }, { id: "e2", type: "SENT_TO", source: "n1", target: "n3" }],
};

const asked: QueryResult = {
  cypher: 'MATCH (t:Transaction {class: "illicit"})\nRETURN t.txId AS txId\nLIMIT 200',
  explanation: "Lists illicit transaction ids.",
  columns: ["txId"],
  rows: [["111"]],
  nodes: [],
  edges: [],
};

type Reply = { status: number; body: unknown };
const ok = (body: unknown): Reply => ({ status: 200, body });

let routes: Record<string, Reply | ((body: Record<string, string>) => Reply)>;
let calls: { path: string; body: Record<string, string> | null }[];

beforeEach(() => {
  calls = [];
  routes = { "/v1/graph/schema": ok(schema), "/v1/graph/query": ok(starter), "/v1/graph/ask": ok(asked) };
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, string> : null;
    calls.push({ path, body });
    const r = routes[path];
    const reply = typeof r === "function" ? r(body ?? {}) : r;
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => vi.unstubAllGlobals());

async function openExplorer() {
  const user = userEvent.setup();
  render(<MemoryRouter initialEntries={["/investigations"]}><App /></MemoryRouter>);
  await screen.findByRole("group", { name: "Graph canvas" });
  return user;
}
const region = (name: string) => screen.getByRole("region", { name });
const graphNode = (name: RegExp) => within(region("Graph view")).getByRole("button", { name });
const cypherBox = () => screen.getByLabelText("Cypher") as HTMLTextAreaElement;

describe("graph explorer", () => {
  it("runs the starter query on load and draws its nodes and relationships", async () => {
    await openExplorer();
    expect(calls.find((c) => c.path === "/v1/graph/query")?.body).toEqual({ cypher: STARTER_CYPHER });
    const canvas = region("Graph view");
    expect(within(canvas).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["111, Illicit", "222, Licit", "333, Unknown"]);
    expect(canvas.querySelectorAll("line.xedge")).toHaveLength(2);
    expect(canvas.querySelector("g.xnode.cls-illicit")).not.toBeNull();
    expect(canvas).toHaveAttribute("aria-busy", "false");
    expect(within(region("Query results")).getByText("2 rows · 3 nodes · 2 relationships drawn")).toBeInTheDocument();
    expect(cypherBox().value).toBe(STARTER_CYPHER);
  });

  it("shows the live schema with counts", async () => {
    await openExplorer();
    const s = region("Graph schema");
    await within(s).findByText("Transaction");
    const items = within(s).getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual(["unknown157,205", "licit42,019", "illicit4,545", "Transaction203,769", "SENT_TO234,355"]);
    expect(within(s).queryByText(/graph is empty/)).toBeNull();
  });

  it("says when the graph is empty", async () => {
    routes["/v1/graph/schema"] = ok({ labels: {}, edge_types: {}, property_keys: [], class_counts: {} });
    await openExplorer();
    expect(await within(region("Graph schema")).findByText(/graph is empty/)).toBeInTheDocument();
  });

  it("inspects the first node, then whichever node is clicked or activated by keyboard", async () => {
    const user = await openExplorer();
    const inspector = () => region("Node details");
    expect(within(inspector()).getByRole("heading", { name: "111" })).toBeInTheDocument();
    expect(graphNode(/^111/)).toHaveAttribute("aria-pressed", "true");
    expect(within(inspector()).getByText("Outgoing in result").nextSibling).toHaveTextContent("2");
    expect(within(inspector()).getByText("Incoming in result").nextSibling).toHaveTextContent("0");
    // Both edges touch the selected node.
    expect(region("Graph view").querySelectorAll("line.xedge.on")).toHaveLength(2);

    await user.click(graphNode(/^222/));
    expect(within(inspector()).getByRole("heading", { name: "222" })).toBeInTheDocument();
    expect(within(inspector()).getByText(/Transaction · Licit/)).toBeInTheDocument();
    expect(within(inspector()).getByText("Incoming in result").nextSibling).toHaveTextContent("1");
    expect(within(inspector()).getByText("timeStep").nextSibling).toHaveTextContent("7");
    expect(graphNode(/^222/)).toHaveAttribute("aria-pressed", "true");
    expect(graphNode(/^111/)).toHaveAttribute("aria-pressed", "false");
    expect(region("Graph view").querySelectorAll("line.xedge.on")).toHaveLength(1);

    graphNode(/^333/).focus();
    await user.keyboard("{Enter}");
    expect(within(inspector()).getByRole("heading", { name: "333" })).toBeInTheDocument();
    graphNode(/^111/).focus();
    await user.keyboard(" ");
    expect(within(inspector()).getByRole("heading", { name: "111" })).toBeInTheDocument();
    await user.keyboard("a");
    expect(within(inspector()).getByRole("heading", { name: "111" })).toBeInTheDocument();
  });

  it("asks Claude, shows the Cypher it ran and its explanation, and the table", async () => {
    const user = await openExplorer();
    const askBtn = screen.getByRole("button", { name: /^Ask/ });
    expect(askBtn).toBeDisabled();
    await user.type(screen.getByLabelText("Question"), "  ab ");
    expect(askBtn).toBeDisabled();
    await user.clear(screen.getByLabelText("Question"));
    await user.type(screen.getByLabelText("Question"), "  Which transactions are illicit?  ");
    await user.click(askBtn);
    expect(await screen.findByText("Lists illicit transaction ids.")).toBeInTheDocument();
    expect(calls.at(-1)).toEqual({ path: "/v1/graph/ask", body: { question: "Which transactions are illicit?" } });
    expect(cypherBox().value).toBe(asked.cypher);
    expect(within(region("Graph view")).getByText(/Nothing to draw/)).toBeInTheDocument();
    expect(region("Node details")).toHaveTextContent("Click a node in the graph");
    const table = region("Query results");
    expect(within(table).getByRole("columnheader", { name: "txId" })).toBeInTheDocument();
    expect(within(table).getByRole("cell", { name: "111" })).toBeInTheDocument();
    expect(within(table).getByText(/^1 row ·/)).toBeInTheDocument();
  });

  it("fills the question from an example chip", async () => {
    const user = await openExplorer();
    await user.click(screen.getByRole("button", { name: "Show two-hop flows out of illicit transactions" }));
    expect(screen.getByLabelText("Question")).toHaveValue("Show two-hop flows out of illicit transactions");
    expect(screen.getByRole("button", { name: /^Ask/ })).toBeEnabled();
  });

  it("re-runs edited Cypher and shows the guarded query the API ran", async () => {
    routes["/v1/graph/query"] = (body) => ok({ ...starter, cypher: `${body.cypher}\nLIMIT 200`, nodes: starter.nodes.slice(1), edges: [] });
    const user = await openExplorer();
    await user.clear(cypherBox());
    const run = screen.getByRole("button", { name: /Run query/ });
    expect(run).toBeDisabled();
    await user.type(cypherBox(), "MATCH (t:Transaction) RETURN t");
    await user.click(run);
    await waitFor(() => expect(cypherBox().value).toBe("MATCH (t:Transaction) RETURN t\nLIMIT 200"));
    expect(calls.at(-1)).toEqual({ path: "/v1/graph/query", body: { cypher: "MATCH (t:Transaction) RETURN t" } });
    expect(within(region("Graph view")).getAllByRole("button")).toHaveLength(2);
    // The selection moves to the new result's first node.
    expect(within(region("Node details")).getByRole("heading", { name: "222" })).toBeInTheDocument();
  });

  it("explains a rejected query and keeps the previous result", async () => {
    const user = await openExplorer();
    routes["/v1/graph/query"] = { status: 400, body: { detail: "DELETE is not allowed: the explorer is read-only." } };
    await user.click(screen.getByRole("button", { name: /Run query/ }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("DELETE is not allowed: the explorer is read-only.");
    expect(within(region("Graph view")).getAllByRole("button")).toHaveLength(3);
    expect(screen.getByRole("button", { name: /Run query/ })).toBeEnabled();
  });

  it("tells the investigator how to fix an unreachable Memgraph or Claude", async () => {
    routes["/v1/graph/schema"] = { status: 503, body: { detail: "Memgraph is not reachable: refused" } };
    routes["/v1/graph/query"] = { status: 503, body: { detail: "Memgraph is not reachable: refused" } };
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={["/investigations"]}><App /></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(2));
    for (const a of screen.getAllByRole("alert")) expect(a).toHaveTextContent(/docker compose up -d memgraph/);
    expect(screen.queryByRole("region", { name: "Query results" })).toBeNull();

    routes["/v1/graph/ask"] = { status: 502, body: { detail: "Claude is not configured: set ANTHROPIC_API_KEY for the API." } };
    await user.type(screen.getByLabelText("Question"), "anything at all");
    await user.click(screen.getByRole("button", { name: /^Ask/ }));
    await waitFor(() => expect(within(region("Ask the graph")).getByRole("alert")).toHaveTextContent(/Claude is not configured/));
  });

  it("warns when the result hit the row cap", async () => {
    routes["/v1/graph/query"] = ok({ ...starter, rows: Array.from({ length: MAX_ROWS }, (_, i) => [`r${i}`]) });
    await openExplorer();
    expect(within(region("Query results")).getByText(/Capped at 200 rows/)).toBeInTheDocument();
  });

  it("shows an empty table message for no matches and hides labels on large graphs", async () => {
    const many = Array.from({ length: 61 }, (_, i) => node(`m${i}`, `${i}`, "unknown"));
    routes["/v1/graph/query"] = ok({ ...starter, rows: [], nodes: many, edges: [] });
    await openExplorer();
    expect(within(region("Query results")).getByText("The query matched nothing.")).toBeInTheDocument();
    expect(region("Graph view").querySelectorAll("g.xnode text")).toHaveLength(0);
  });

  it("labels nodes when the graph is small enough to read", async () => {
    await openExplorer();
    expect([...region("Graph view").querySelectorAll("g.xnode text")].map((t) => t.textContent)).toEqual(["111", "222", "333"]);
  });

  it("disables both actions while a request is in flight", async () => {
    let release: (r: Reply) => void = () => {};
    const user = await openExplorer();
    routes["/v1/graph/ask"] = ok(asked);
    const slow = new Promise<Reply>((r) => { release = r; });
    vi.mocked(fetch).mockImplementationOnce(async () => {
      const reply = await slow;
      return new Response(JSON.stringify(reply.body), { status: reply.status });
    });
    await user.type(screen.getByLabelText("Question"), "slow question");
    await user.click(screen.getByRole("button", { name: /^Ask/ }));
    expect(screen.getByRole("button", { name: /Asking Claude/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Run query/ })).toBeDisabled();
    expect(region("Graph view")).toHaveAttribute("aria-busy", "true");
    release(ok(asked));
    await screen.findByText("Lists illicit transaction ids.");
    expect(screen.getByRole("button", { name: /Run query/ })).toBeEnabled();
  });

  it("drops a stale reply that lands after a newer one", async () => {
    // StrictMode mounts twice in development, so the first starter query is
    // superseded by the second; if it lands last it must not overwrite it.
    let release: (r: Reply) => void = () => {};
    const slow = new Promise<Reply>((r) => { release = r; });
    const stale: QueryResult = { ...starter, nodes: [node("s1", "999", "illicit")], edges: [] };
    const fetchMock = vi.mocked(fetch);
    const fast = fetchMock.getMockImplementation()!;
    let queries = 0;
    fetchMock.mockImplementation(async (path, init) => {
      if (path === "/v1/graph/query" && queries++ === 0) {
        const reply = await slow;
        return new Response(JSON.stringify(reply.body), { status: reply.status });
      }
      return fast(path, init);
    });
    render(<StrictMode><MemoryRouter initialEntries={["/investigations"]}><App /></MemoryRouter></StrictMode>);
    await waitFor(() => expect(within(region("Graph view")).getAllByRole("button")).toHaveLength(3));
    release(ok(stale));
    await slow;
    await new Promise((r) => setTimeout(r, 20));
    expect(within(region("Graph view")).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["111, Illicit", "222, Licit", "333, Unknown"]);
    expect(queries).toBe(2);
  });

  it("clears an earlier error once a later request succeeds", async () => {
    const user = await openExplorer();
    routes["/v1/graph/query"] = { status: 400, body: { detail: "Only read queries are allowed." } };
    await user.click(screen.getByRole("button", { name: /Run query/ }));
    await screen.findByRole("alert");
    routes["/v1/graph/query"] = ok(starter);
    await user.click(screen.getByRole("button", { name: /Run query/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Run query/ })).toBeEnabled());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("reports a reply that is not valid JSON", async () => {
    const user = await openExplorer();
    vi.mocked(fetch).mockImplementationOnce(async () => new Response("<html>proxy page</html>", { status: 200 }));
    await user.click(screen.getByRole("button", { name: /Run query/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/JSON/);
  });

  it("skips relationships whose ends are not in the result", async () => {
    routes["/v1/graph/query"] = ok({ ...starter, edges: [...starter.edges, { id: "e3", type: "SENT_TO", source: "n1", target: "ghost" }] });
    await openExplorer();
    expect(region("Graph view").querySelectorAll("line.xedge")).toHaveLength(2);
  });

  it("is also the Transaction analytics page", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><App /></MemoryRouter>);
    await user.click(screen.getByRole("link", { name: /Transaction analytics/ }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/Transaction graph explorer/);
    expect(await screen.findByRole("group", { name: "Graph canvas" })).toBeInTheDocument();
  });
});
