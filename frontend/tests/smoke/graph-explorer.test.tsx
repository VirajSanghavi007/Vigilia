import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import App from "../../src/App";

// Does /investigations start, call the API, and draw a result, with no
// React errors? One tiny canned backend reply per endpoint.

afterEach(() => vi.unstubAllGlobals());

describe("graph explorer smoke", () => {
  it("loads the schema and draws the starter query", async () => {
    const replies: Record<string, unknown> = {
      "/v1/graph/schema": { labels: { Transaction: 2 }, edge_types: { SENT_TO: 1 }, property_keys: ["txId"], class_counts: { illicit: 1, licit: 1 } },
      "/v1/graph/query": {
        cypher: "MATCH p=()-[]->() RETURN p LIMIT 25", explanation: null, columns: ["p"], rows: [["path (1 hops)"]],
        nodes: [{ id: "a", labels: ["Transaction"], properties: { txId: "1", class: "illicit" } }, { id: "b", labels: ["Transaction"], properties: { txId: "2", class: "licit" } }],
        edges: [{ id: "e", type: "SENT_TO", source: "a", target: "b" }],
      },
    };
    const fetchMock = vi.fn(async (path: string) => new Response(JSON.stringify(replies[path]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const errors = vi.spyOn(console, "error");

    render(<MemoryRouter initialEntries={["/investigations"]}><App /></MemoryRouter>);
    expect(screen.getByRole("heading", { level: 1, name: /^Investigations/ })).toBeInTheDocument();
    const canvas = await screen.findByRole("group", { name: "Graph canvas" });
    expect(within(canvas).getAllByRole("button")).toHaveLength(2);
    expect(await within(screen.getByRole("region", { name: "Graph schema" })).findByText("SENT_TO")).toBeInTheDocument();
    expect(fetchMock.mock.calls.map((c) => c[0]).sort()).toEqual(["/v1/graph/query", "/v1/graph/schema"]);
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});
