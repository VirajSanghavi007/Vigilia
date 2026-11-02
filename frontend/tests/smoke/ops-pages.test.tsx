import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import App from "../../src/App";

const pages: [RegExp, string, string[]][] = [
  [/Transactions/, "Transactions", ["Transaction monitoring", "Selected transaction snapshot", "Recommended next step"]],
  [/Customers/, "Customers", ["Customer risk directory", "Selected customer", "Portfolio risk distribution", "Recent customer activity"]],
  [/Investigators/, "Investigators", ["Assignment & escalation desk", "Workload by investigation stage", "Recent team activity"]],
  [/Reports/, "Reports", ["Reporting overview", "Regulatory report register", "Selected report", "Scheduled reporting", "Filing performance", "Recent reporting activity"]],
  [/Rules & models/, "Rules & Models", ["Overview", "Model monitoring", "Detection rule library", "Selected rule", "Change control"]],
  [/Audit log/, "Audit Logs", ["Chronological review", "Evidence panel", "Evidence summary", "Event distribution", "Access review", "Retention & evidence controls"]],
  [/Transaction analytics/, "Transaction graph explorer", ["Ask the graph", "Graph schema", "Graph view", "Node details"]],
  [/^Investigations$/, "Investigations", ["Ask the graph", "Graph schema", "Graph view", "Node details"]],
  [/Settings/, "Settings", ["General", "Security & access", "Notification defaults", "Audit & retention", "Configuration record", "Detection environment"]],
  [/^Profile$/, "Profile", ["Account", "Your role & access", "Account record", "Personal details", "Personal preferences", "Security & sessions"]],
];

describe("operations pages smoke", () => {
  it.each(pages)("renders %s without errors", async (nav, title, regions) => {
    const errors = vi.spyOn(console, "error");
    render(<MemoryRouter><App /></MemoryRouter>);
    await userEvent.setup().click(screen.getByRole("link", { name: nav }));
    expect(screen.getByRole("heading", { level: 1, name: new RegExp(`^${title}`) })).toBeInTheDocument();
    for (const r of regions) expect(screen.getByRole("region", { name: r })).toBeInTheDocument();
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it("renders the workspace loading screen without errors", () => {
    const errors = vi.spyOn(console, "error");
    render(<MemoryRouter initialEntries={["/loading"]}><App /></MemoryRouter>);
    expect(screen.getByRole("heading", { level: 1, name: /^Preparing your workspace/ })).toBeInTheDocument();
    for (const r of ["Connecting your workspace", "Transaction analytics preview", "Workspace guide"]) {
      expect(screen.getByRole("region", { name: r })).toBeInTheDocument();
    }
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it("renders the landing page without errors", () => {
    const errors = vi.spyOn(console, "error");
    render(<MemoryRouter initialEntries={["/platform"]}><App /></MemoryRouter>);
    expect(screen.getByRole("heading", { level: 1, name: "See the connection. Build the case." })).toBeInTheDocument();
    expect(screen.getAllByRole("img", { name: "Vigilia AML" }).length).toBeGreaterThan(0);
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});
