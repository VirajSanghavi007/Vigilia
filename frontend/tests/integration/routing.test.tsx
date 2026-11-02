import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";
import App from "../../src/App";
import { paths } from "../../src/routes";

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}
function at(path: string) {
  render(<MemoryRouter initialEntries={[path]}><App /><Where /></MemoryRouter>);
}
const where = () => screen.getByTestId("where").textContent;

describe("routing", () => {
  it.each([
    [paths.alerts, /^Alert Queue/], [paths.cases, /^Cases/], [paths.transactions, /^Transactions/],
    [paths.analytics, /^Transaction graph explorer/], [paths.investigations, /^Investigations/],
    [paths.loading, /^Preparing your workspace/],
    [paths.customers, /^Customers/], [paths.investigators, /^Investigators/], [paths.reports, /^Reports/],
    [paths.rules, /^Rules & Models/], [paths.audit, /^Audit Logs/], [paths.settings, /^Settings/], [paths.profile, /^Profile/],
  ])("deep link %s renders its page", (path, title) => {
    at(path);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(title);
  });

  it("serves the overview at the root", () => {
    at("/");
    expect(screen.getByRole("heading", { name: /Financial Crime Overview/ })).toBeInTheDocument();
  });

  it("redirects unknown paths to the overview", () => {
    at("/nope");
    expect(where()).toBe("/");
  });

  it("sidebar clicks change the URL and mark only the matching link current", async () => {
    at("/");
    await userEvent.setup().click(screen.getByRole("link", { name: /Investigators/ }));
    expect(where()).toBe("/investigators");
    expect(screen.getByRole("link", { name: /Investigators/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /Overview/ })).not.toHaveAttribute("aria-current");
  });

  it("the user block is plain text, not a control", () => {
    at("/alerts");
    const name = screen.getByText("Amina Patel");
    expect(name.closest("button, a")).toBeNull();
    expect(screen.queryByRole("button", { name: /Amina Patel/ })).not.toBeInTheDocument();
  });

  it("the sidebar logo goes back to the overview", async () => {
    at("/rules");
    await userEvent.setup().click(screen.getByRole("link", { name: "Vigilia AML home" }));
    expect(where()).toBe("/");
    expect(screen.getByRole("heading", { name: /Financial Crime Overview/ })).toBeInTheDocument();
  });

  it("serves the public landing page outside the operations shell", async () => {
    at(paths.landing);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("See the connection. Build the case.");
    expect(screen.queryByRole("navigation", { name: "Main" })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getAllByRole("link", { name: /Explore the platform/ })[0]);
    expect(where()).toBe("/");
    expect(screen.getByRole("navigation", { name: "Main" })).toBeInTheDocument();
  });

  it("has no detection engine card in the sidebar", () => {
    for (const path of ["/", paths.loading]) {
      const { unmount } = render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
      expect(screen.queryByText("Detection engine")).not.toBeInTheDocument();
      expect(screen.queryByText("Model v4.8.2")).not.toBeInTheDocument();
      unmount();
    }
  });

  it("puts a breadcrumb on account pages and the filter row everywhere else", () => {
    at(paths.settings);
    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(crumbs).toHaveTextContent("Vigilia AML Operations/Workspace settingsProduction");
    expect(screen.queryByRole("combobox", { name: "Jurisdiction" })).not.toBeInTheDocument();
  });

  // The workspace filters only appear where they change what is shown, so no
  // control on screen is a dead end.
  it.each([paths.overview, paths.alerts, paths.cases, paths.riskMap, paths.riskTrend])("shows the workspace filters on %s", (path) => {
    at(path);
    expect(screen.getByRole("combobox", { name: "Jurisdiction" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Date range" })).toBeInTheDocument();
  });

  it.each([paths.transactions, paths.customers, paths.reports, paths.notifications])("shows only the refresh status on %s", (path) => {
    at(path);
    expect(screen.queryByRole("navigation", { name: "Breadcrumb" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Jurisdiction" })).not.toBeInTheDocument();
    expect(screen.getByText(/Data refreshed/)).toBeInTheDocument();
  });
});
