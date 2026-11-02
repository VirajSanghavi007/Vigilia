import { afterEach, describe, expect, it, vi } from "vitest";
import { askGraph, cellText, fetchSchema, GraphApiError, nodeClass, nodeLabel, runCypher } from "../../src/lib/graphApi";
import type { GraphNode } from "../../src/lib/graphApi";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function stubFetch(res: Response | Error) {
  const fn = vi.fn(async () => { if (res instanceof Error) throw res; return res; });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

async function failure(p: Promise<unknown>): Promise<GraphApiError> {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(GraphApiError);
  return err as GraphApiError;
}

describe("graph API client", () => {
  it("GETs the schema from /v1/graph/schema", async () => {
    const schema = { labels: { Transaction: 3 }, edge_types: {}, property_keys: ["txId"], class_counts: {} };
    const fn = stubFetch(json(200, schema));
    expect(await fetchSchema()).toEqual(schema);
    expect(fn).toHaveBeenCalledWith("/v1/graph/schema", undefined);
  });

  it("POSTs the question as JSON to /ask and the Cypher to /query", async () => {
    const fn = stubFetch(json(200, { cypher: "x" }));
    await askGraph("who pays whom");
    expect(fn).toHaveBeenLastCalledWith("/v1/graph/ask", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: '{"question":"who pays whom"}',
    });
    stubFetch(json(200, { cypher: "x" }));
    const fn2 = vi.mocked(fetch);
    await runCypher("MATCH (n) RETURN n");
    expect(fn2).toHaveBeenLastCalledWith("/v1/graph/query", expect.objectContaining({ method: "POST", body: '{"cypher":"MATCH (n) RETURN n"}' }));
  });

  it("surfaces the server's detail with a status-specific hint", async () => {
    stubFetch(json(503, { detail: "Memgraph is not reachable: refused" }));
    const down = await failure(fetchSchema());
    expect(down.status).toBe(503);
    expect(down.message).toBe("Memgraph is not reachable: refused");
    expect(down.hint).toMatch(/docker compose up -d memgraph/);

    stubFetch(json(502, { detail: "Claude is not configured" }));
    expect((await failure(askGraph("abc"))).hint).toMatch(/ANTHROPIC_API_KEY/);

    stubFetch(json(400, { detail: "DELETE is not allowed: the explorer is read-only." }));
    const rejected = await failure(runCypher("MATCH (n) DELETE n"));
    expect(rejected.message).toBe("DELETE is not allowed: the explorer is read-only.");
    expect(rejected.hint).toBeUndefined();
  });

  it("falls back to a generic message when the detail is not a string or the body is not JSON", async () => {
    stubFetch(json(422, { detail: [{ loc: ["body", "question"], msg: "too short" }] }));
    expect((await failure(askGraph("ab"))).message).toBe("Request failed (422).");
    stubFetch(new Response("<html>gateway</html>", { status: 504 }));
    expect((await failure(fetchSchema())).message).toBe("Request failed (504).");
  });

  it("reports an unreachable API as status 0 with a start hint", async () => {
    stubFetch(new TypeError("Failed to fetch"));
    const err = await failure(fetchSchema());
    expect(err.status).toBe(0);
    expect(err.message).toBe("The Vigilia API is not reachable.");
    expect(err.hint).toMatch(/uvicorn vigilia\.api\.main:app/);
  });
});

describe("node helpers", () => {
  const node = (properties: Record<string, unknown>, labels = ["Transaction"]): GraphNode => ({ id: "4:x:1", labels, properties });

  it("classifies by the class property, defaulting to unknown", () => {
    expect(nodeClass(node({ class: "illicit" }))).toBe("illicit");
    expect(nodeClass(node({ class: "licit" }))).toBe("licit");
    expect(nodeClass(node({ class: "unknown" }))).toBe("unknown");
    expect(nodeClass(node({ class: "1" }))).toBe("unknown");
    expect(nodeClass(node({}))).toBe("unknown");
  });

  it("labels by txId, then first label, then 'node'", () => {
    expect(nodeLabel(node({ txId: "230425980" }))).toBe("230425980");
    expect(nodeLabel(node({ txId: 0 }))).toBe("0");
    expect(nodeLabel(node({ txId: null }))).toBe("Transaction");
    expect(nodeLabel(node({}, ["Account", "Entity"]))).toBe("Account");
    expect(nodeLabel(node({}, []))).toBe("node");
  });

  it("renders table cells as text", () => {
    expect(cellText("Transaction 1")).toBe("Transaction 1");
    expect(cellText(null)).toBe("null");
    expect(cellText(undefined)).toBe("null");
    expect(cellText(42)).toBe("42");
    expect(cellText(true)).toBe("true");
    expect(cellText(["a", 1])).toBe('["a",1]');
    expect(cellText({ k: "v" })).toBe('{"k":"v"}');
  });
});
