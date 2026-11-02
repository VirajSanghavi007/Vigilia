import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import App from "../../src/App";

// Real App + real mock data: sidebar navigation, tabs, filters, sort,
// selection and pagination wired together.

async function open(page: RegExp) {
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole("button", { name: page }));
  return user;
}
const region = (name: string) => screen.getByRole("region", { name });
const rows = (name: string) => within(region(name)).getAllByRole("row").slice(1);
const firstId = (name: string) => within(rows(name)[0]).getAllByRole("cell")[name === "Investigation queue" ? 2 : 1].textContent;

describe("page switching", () => {
  it("swaps pages from the sidebar and back", async () => {
    const user = await open(/Alert queue/);
    expect(screen.queryByRole("heading", { name: /Financial Crime Overview/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Cases/ }));
    expect(screen.getByRole("region", { name: "Case management" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Overview/ }));
    expect(screen.getByRole("heading", { name: /Financial Crime Overview/ })).toBeInTheDocument();
  });
  it("shows a placeholder for undesigned pages", async () => {
    await open(/Transactions/);
    expect(screen.getByRole("region", { name: "Coming soon" })).toBeInTheDocument();
  });
});

describe("alert queue", () => {
  const Q = "Investigation queue";

  it("shows Figma counts, highest priority first, and pages through 27 alerts", async () => {
    const user = await open(/Alert queue/);
    for (const t of ["All open 27", "My alerts 6", "Unassigned 12", "SLA breached 7", "Closed 184"]) {
      expect(screen.getByRole("tab", { name: t })).toBeInTheDocument();
    }
    expect(firstId(Q)).toContain("ALT-92841");
    expect(within(region(Q)).getByText("Showing 1-8 of 27 open alerts")).toBeInTheDocument();
    expect(within(region(Q)).getByRole("button", { name: "Previous page" })).toBeDisabled();
    await user.click(within(region(Q)).getByRole("button", { name: "4" }));
    expect(within(region(Q)).getByText("Showing 25-27 of 27 open alerts")).toBeInTheDocument();
    await user.click(within(region(Q)).getByRole("button", { name: "Previous page" }));
    expect(within(region(Q)).getByText("Showing 17-24 of 27 open alerts")).toBeInTheDocument();
  });

  it("tabs filter the rows and reset to page 1", async () => {
    const user = await open(/Alert queue/);
    await user.click(within(region(Q)).getByRole("button", { name: "Next page" }));
    await user.click(screen.getByRole("tab", { name: "Unassigned 12" }));
    expect(within(region(Q)).getByText("Showing 1-8 of 12 alerts")).toBeInTheDocument();
    for (const r of rows(Q)) expect(within(r).getByText("Unassigned")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "My alerts 6" }));
    expect(rows(Q)).toHaveLength(6);
    await user.click(screen.getByRole("tab", { name: "SLA breached 7" }));
    expect(rows(Q)).toHaveLength(7);
    await user.click(screen.getByRole("tab", { name: "Closed 184" }));
    expect(within(region(Q)).getByText(/Closed alerts are archived/)).toBeInTheDocument();
  });

  it("search and dropdowns narrow results and reset paging", async () => {
    const user = await open(/Alert queue/);
    await user.click(within(region(Q)).getByRole("button", { name: "Next page" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Severity" }), "Critical");
    expect(within(region(Q)).getByText("Showing 1-8 of 9 open alerts")).toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: "Assignee" }), "Unassigned");
    expect(rows(Q)).toHaveLength(3);
    await user.type(screen.getByRole("textbox", { name: "Search queue" }), "kofi");
    expect(rows(Q)).toHaveLength(1);
    await user.type(screen.getByRole("textbox", { name: "Search queue" }), "zzz");
    expect(within(region(Q)).getByText("No alerts match these filters")).toBeInTheDocument();
  });

  it("search on page 2 resets to page 1", async () => {
    const user = await open(/Alert queue/);
    await user.click(within(region(Q)).getByRole("button", { name: "Next page" }));
    await user.type(screen.getByRole("textbox", { name: "Search queue" }), "ALT-92");
    expect(within(region(Q)).getByText("Showing 1-8 of 27 open alerts")).toBeInTheDocument();
    expect(within(region(Q)).getByRole("button", { name: "Previous page" })).toBeDisabled();
  });

  it("other filters each narrow and reset to page 1", async () => {
    const user = await open(/Alert queue/);
    await user.click(within(region(Q)).getByRole("button", { name: "Next page" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Typology" }), "Layering / circular flows");
    expect(rows(Q)).toHaveLength(1);
    await user.selectOptions(screen.getByRole("combobox", { name: "Typology" }), "All");
    await user.click(within(region(Q)).getByRole("button", { name: "Next page" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Status" }), "Escalated");
    expect(rows(Q)).toHaveLength(1);
  });

  it("priority toggle reverses the sort", async () => {
    const user = await open(/Alert queue/);
    await user.click(screen.getByRole("button", { name: /Priority: Highest first/ }));
    expect(screen.getByRole("button", { name: /Priority: Lowest first/ })).toBeInTheDocument();
    expect(within(rows(Q)[0]).getByText("Low")).toBeInTheDocument();
  });

  it("selection drives the bulk bar and the snapshot", async () => {
    const user = await open(/Alert queue/);
    expect(screen.getByText("1 alert selected")).toBeInTheDocument();
    expect(within(region("Selected alert snapshot")).getByText("ALT-92841")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Select ALT-92841" }));
    expect(screen.queryByText(/selected$/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Select ALT-92838" }));
    expect(within(region("Selected alert snapshot")).getByText("ALT-92838")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Select page" }));
    expect(screen.getByText("8 alerts selected")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Select page" }));
    expect(screen.queryByText(/alerts? selected/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Select ALT-92756" }));
    await user.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.queryByText(/alerts? selected/)).not.toBeInTheDocument();
  });
});

describe("cases", () => {
  const C = "Case management";

  it("shows Figma KPIs, tabs, workload and two pages", async () => {
    const user = await open(/Cases/);
    expect(screen.getByText("2 overdue cases")).toBeInTheDocument();
    for (const t of ["All open 14", "My cases 4", "Unassigned 2", "Pending approval 2", "Overdue 2", "Closed 38"]) {
      expect(screen.getByRole("tab", { name: t })).toBeInTheDocument();
    }
    expect(firstId(C)).toContain("AML-4821");
    expect(within(region(C)).getByText("Showing 1-8 of 14 open cases")).toBeInTheDocument();
    await user.click(within(region(C)).getByRole("button", { name: "Next page" }));
    expect(within(region(C)).getByText("Showing 9-14 of 14 open cases")).toBeInTheDocument();
    expect(within(region("Investigator workload")).getByText(/12 assigned cases across 4 investigators/)).toBeInTheDocument();
    expect(within(region("Investigator workload")).getByText(/1 critical case is unassigned/)).toBeInTheDocument();
  });

  it("tabs, filters and search narrow cases", async () => {
    const user = await open(/Cases/);
    await user.click(within(region(C)).getByRole("button", { name: "Next page" }));
    await user.click(screen.getByRole("tab", { name: "Overdue 2" }));
    expect(rows(C)).toHaveLength(2);
    await user.click(screen.getByRole("tab", { name: "Pending approval 2" }));
    expect(rows(C)).toHaveLength(2);
    await user.click(screen.getByRole("tab", { name: "My cases 4" }));
    expect(rows(C)).toHaveLength(4);
    await user.click(screen.getByRole("tab", { name: "Unassigned 2" }));
    expect(rows(C)).toHaveLength(2);
    await user.click(screen.getByRole("tab", { name: "All open 14" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Priority" }), "Low");
    expect(rows(C)).toHaveLength(3);
    await user.selectOptions(screen.getByRole("combobox", { name: "Investigator" }), "N. Karim");
    expect(rows(C)).toHaveLength(1);
    await user.selectOptions(screen.getByRole("combobox", { name: "Priority" }), "All");
    await user.selectOptions(screen.getByRole("combobox", { name: "Investigator" }), "All");
    await user.selectOptions(screen.getByRole("combobox", { name: "Status" }), "Escalated");
    expect(rows(C)).toHaveLength(1);
    await user.selectOptions(screen.getByRole("combobox", { name: "Status" }), "All");
    await user.selectOptions(screen.getByRole("combobox", { name: "Type" }), "Sanctions proximity");
    expect(rows(C)).toHaveLength(2);
    await user.type(screen.getByRole("textbox", { name: "Search cases" }), "harbor");
    expect(rows(C)).toHaveLength(1);
    await user.click(screen.getByRole("tab", { name: "Closed 38" }));
    expect(within(region(C)).getByText(/Closed cases are archived/)).toBeInTheDocument();
  });

  it("filters reset to page 1", async () => {
    const user = await open(/Cases/);
    await user.click(within(region(C)).getByRole("button", { name: "Next page" }));
    await user.type(screen.getByRole("textbox", { name: "Search cases" }), "AML-4");
    expect(within(region(C)).getByText("Showing 1-8 of 14 open cases")).toBeInTheDocument();
  });

  it("selection, bulk bar and sort toggle", async () => {
    const user = await open(/Cases/);
    expect(screen.getByText("1 case selected")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Select page" }));
    expect(screen.getByText("8 cases selected")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.queryByText(/cases? selected/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Priority: Highest first/ }));
    expect(within(rows(C)[0]).getByText("Low")).toBeInTheDocument();
  });
});
