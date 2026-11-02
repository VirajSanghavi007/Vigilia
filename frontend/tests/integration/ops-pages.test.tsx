import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import App from "../../src/App";
import { alertPath, casePath } from "../../src/routes";

// Real App + real ops mock data: tabs, filters, search, sort, selection,
// detail panels and the Settings/Profile save bar wired together.

async function open(page: RegExp) {
  const user = userEvent.setup();
  render(<MemoryRouter><App /></MemoryRouter>);
  await user.click(screen.getByRole("link", { name: page }));
  return user;
}
const region = (name: string) => screen.getByRole("region", { name });
const rows = (name: string) => within(region(name)).getAllByRole("row").slice(1);
const cellText = (name: string, col: number) => rows(name).map((r) => within(r).getAllByRole("cell")[col].textContent);
const footer = (name: string) => within(region(name)).getByText(/^Showing/).textContent;

describe("transactions", () => {
  const T = "Transaction monitoring";
  const S = "Selected transaction snapshot";
  const ids = () => cellText(T, 1).map((t) => t?.slice(0, 10));

  it("shows Figma tab counts, the population total and newest first", async () => {
    await open(/Transactions/);
    for (const t of ["All transactions 1.84M", "Flagged 12,684", "High risk 248", "On hold 36", "Cleared 1.82M"]) {
      expect(screen.getByRole("tab", { name: t })).toBeInTheDocument();
    }
    expect(footer(T)).toBe("Showing 1–8 of 1,840,216 transactions");
    expect(ids()[0]).toBe("TXN-984218");
    expect(ids().at(-1)).toBe("TXN-983951");
    expect(screen.getByRole("columnheader", { name: /Date/ })).toHaveAttribute("aria-sort", "descending");
  });

  it("narrows by tab, filter and search, and the total follows the matched rows", async () => {
    const user = await open(/Transactions/);
    await user.click(screen.getByRole("tab", { name: /^Flagged/ }));
    expect(ids()).toEqual(["TXN-984218", "TXN-984201", "TXN-984186", "TXN-983984"]);
    expect(footer(T)).toBe("Showing 1–4 of 4 transactions");
    await user.selectOptions(screen.getByLabelText("Channel"), "Cash deposit");
    expect(ids()).toEqual(["TXN-984186"]);
    await user.click(screen.getByRole("tab", { name: /^All transactions/ }));
    await user.selectOptions(screen.getByLabelText("Channel"), "All");
    await user.type(screen.getByLabelText("Search transactions"), "zzz");
    expect(within(region(T)).getByText("No transactions match these filters")).toBeInTheDocument();
  });

  it("flips date sort and drives the snapshot from View", async () => {
    const user = await open(/Transactions/);
    expect(within(region(S)).getByText(/Linked alert: ALT-92841/)).toHaveAttribute("href", "/alerts");
    expect(within(region(S)).getByText(/Case: AML-4821/)).toHaveAttribute("href", "/cases");
    await user.click(screen.getByRole("button", { name: /Date: Newest first/ }));
    expect(screen.getByRole("columnheader", { name: /Date/ })).toHaveAttribute("aria-sort", "ascending");
    expect(ids()[0]).toBe("TXN-983951");
    await user.click(within(rows(T)[0]).getByRole("button", { name: "View" }));
    expect(within(region(S)).getByText("TXN-983951")).toBeInTheDocument();
    expect(within(region(S)).queryByText(/Linked alert/)).not.toBeInTheDocument();
    expect(within(region("Recommended next step")).getByText(/Crescent Exchange LLC/)).toBeInTheDocument();
    expect(within(region("Recommended next step")).getByRole("link", { name: "View case" })).toHaveAttribute("href", "/cases");
  });

  it("selects rows into the bulk bar and clears them", async () => {
    const user = await open(/Transactions/);
    expect(screen.getByRole("status")).toHaveTextContent("1 transaction selected");
    await user.click(screen.getByLabelText("Select page"));
    expect(screen.getByRole("status")).toHaveTextContent("8 transactions selected");
    await user.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("customers", () => {
  const C = "Customer risk directory";
  const names = () => cellText(C, 1).map((t) => t?.split("C-")[0]);

  it("filters review-due and evidence tabs and by type", async () => {
    const user = await open(/Customers/);
    expect(footer(C)).toBe("Showing 1–8 of 24,816 customers");
    await user.click(screen.getByRole("tab", { name: /^Review due/ }));
    expect(names()).toEqual(["Kofi Mensah", "Harborline Imports Ltd", "Westbridge Services Ltd"]);
    await user.click(screen.getByRole("tab", { name: /^Pending evidence/ }));
    expect(rows(C)).toHaveLength(2);
    await user.click(screen.getByRole("tab", { name: /^All customers/ }));
    await user.selectOptions(screen.getByLabelText("Type"), "MSB");
    expect(cellText(C, 1)[0]).toContain("Crescent Exchange LLC");
  });

  it("sorts from the Risk score header and jumps to the overdue review queue", async () => {
    const user = await open(/Customers/);
    const head = screen.getByRole("columnheader", { name: /Risk score/ });
    expect(head).toHaveAttribute("aria-sort", "descending");
    const first = names()[0];
    await user.click(within(head).getByRole("button", { name: /Risk score ↓/ }));
    expect(head).toHaveAttribute("aria-sort", "ascending");
    expect(names().at(-1)).toBe(first);
    await user.click(screen.getByRole("button", { name: /Open overdue review queue/ }));
    expect(screen.getByRole("tab", { name: /^Review due/ })).toHaveAttribute("aria-selected", "true");
  });

  it("shows the EDD checklist for the first customer and plain facts for others", async () => {
    const user = await open(/Customers/);
    const sel = () => region("Selected customer");
    expect(within(sel()).getByText("KYC evidence checklist")).toBeInTheDocument();
    expect(within(sel()).getByText("C-10842 · Corporate · United Arab Emirates")).toBeInTheDocument();
    expect(within(sel()).getByRole("link", { name: "View case" })).toHaveAttribute("href", "/cases");
    await user.click(screen.getByLabelText("Select C-10842"));
    await user.click(screen.getByLabelText("Select C-22816"));
    expect(within(sel()).getByText("Crescent Exchange LLC")).toBeInTheDocument();
    expect(within(sel()).queryByText("KYC evidence checklist")).not.toBeInTheDocument();
  });
});

describe("investigators", () => {
  const D = "Assignment & escalation desk";

  it("puts late unassigned critical work first and offers Assign only to unowned rows", async () => {
    await open(/Investigators/);
    expect(cellText(D, 0)[0]).toContain("ALT-92796");
    for (const r of rows(D)) {
      const owner = within(r).getAllByRole("cell")[3].textContent ?? "";
      const id = /^[A-Z]+-\d+/.exec(within(r).getAllByRole("cell")[0].textContent ?? "")?.[0] ?? "";
      // Review opens the record's page; Assign acts in place.
      if (owner.startsWith("Unassigned")) expect(within(r).getByRole("button", { name: "Assign" })).toBeInTheDocument();
      else expect(within(r).getByRole("link", { name: `Review ${id}` })).toHaveAttribute("href", id.startsWith("ALT-") ? alertPath(id) : casePath(id));
    }
    expect(within(region("Nadia Karim")).getByText("63% capacity")).toHaveClass("delta", "good");
    expect(within(region("Amina Patel")).getByText("88% capacity")).toHaveClass("delta", "bad");
    expect(within(region("Amina Patel")).getByText("4 cases")).toBeInTheDocument();
    expect(within(region("Amina Patel")).getByText("3 alerts")).toBeInTheDocument();
  });

  it("filters by suggested owner's team and explains the archived completed tab", async () => {
    const user = await open(/Investigators/);
    await user.selectOptions(screen.getByLabelText("Team"), "Cross-border");
    expect(rows(D).length).toBeGreaterThan(0);
    for (const r of rows(D)) expect(within(r).getAllByRole("cell")[5]).toHaveTextContent("M. Alvarez");
    await user.click(screen.getByRole("tab", { name: "Completed today 11" }));
    expect(within(region(D)).getByText(/archived in the audit log/)).toBeInTheDocument();
  });
});

describe("reports", () => {
  const R = "Regulatory report register";
  const S = "Selected report";

  it("orders open work first and moves the stepper with the opened report", async () => {
    const user = await open(/Reports/);
    expect(cellText(R, 0)[0]).toContain("SAR-2026-0148");
    expect(footer(R)).toBe("Showing 1–6 of 40 reports · September 2026");
    const step = () => within(region(S)).queryByRole("listitem", { current: "step" });
    expect(step()).toHaveTextContent("2 Narrative");
    expect(within(region(S)).getByText("8 evidence files")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open SAR-2026-0147" }));
    expect(within(region(S)).getByRole("heading", { name: /SAR-2026-0147/ })).toBeInTheDocument();
    expect(step()).toHaveTextContent("3 Approval");
    await user.click(screen.getByRole("button", { name: "Open SAR-2026-0144" }));
    expect(step()).toBeNull();
    expect(within(region(S)).getAllByRole("listitem").filter((li) => li.classList.contains("done"))).toHaveLength(4);
  });

  it("groups Submitted and Accepted under Filed", async () => {
    const user = await open(/Reports/);
    await user.click(screen.getByRole("tab", { name: "Filed 28" }));
    expect(cellText(R, 0).map((t) => t?.slice(0, 13))).toEqual(["CTR-2026-0082", "SAR-2026-0144"]);
  });
});

describe("rules & models", () => {
  const L = "Detection rule library";

  it("keeps stored priority order and flags rising false positives", async () => {
    const user = await open(/Rules & models/);
    const order = () => cellText(L, 0).map((t) => t?.slice(0, 6));
    const first = order();
    expect(first[0]).toBe("TM-014");
    expect(screen.getByText("+0.8 pts", { selector: ".entity-meta" })).toHaveClass("bad");
    expect(screen.getByText(/design mock data/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Priority: Highest first/ }));
    expect(order()).toEqual([...first].reverse());
  });

  it("configures the selected rule from the Action column", async () => {
    const user = await open(/Rules & models/);
    expect(within(region("Selected rule")).getByText("Velocity anomaly · Version 12")).toBeInTheDocument();
    const row = rows(L).find((r) => r.textContent?.startsWith("SC-003"))!;
    await user.click(within(row).getByRole("button", { name: /Configure/ }));
    expect(within(region("Selected rule")).getByRole("heading", { name: /SC-003/ })).toBeInTheDocument();
    expect(within(region("Selected rule")).queryByText("Velocity anomaly · Version 12")).not.toBeInTheDocument();
  });

  it("shows only shadow rules under change requests", async () => {
    const user = await open(/Rules & models/);
    await user.click(screen.getByRole("tab", { name: "Change requests 2" }));
    expect(cellText(L, 0)).toEqual([expect.stringContaining("TM-041")]);
    expect(within(rows(L)[0]).getByRole("button", { name: /Review test/ })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Type"), "Screening");
    expect(within(region(L)).getByText("No rules match these filters")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /^Models/ }));
    expect(within(region(L)).getByText(/Model monitoring card/)).toBeInTheDocument();
  });
});

describe("audit log", () => {
  const A = "Chronological review";
  const E = "Evidence panel";

  it("lists newest first and opens evidence for the clicked event", async () => {
    const user = await open(/Audit log/);
    expect(cellText(A, 0)[0]).toBe("Sep 28, 09:54:122026 · UTC");
    expect(footer(A)).toBe("Showing 1–8 of 18,642 events · Newest first");
    expect(within(region(E)).getByText("assigned_investigator")).toBeInTheDocument();
    expect(within(region(E)).getByText("Sep 28, 2026 · 09:54:12")).toBeInTheDocument();
    expect(within(region(E)).getByText("req-7f28c9a1 · session-ap-0928-01")).toBeInTheDocument();
    expect(within(region("Evidence summary")).getByText("EVT-20260928-095412-4821")).toBeInTheDocument();
    await user.click(rows(A)[7]);
    expect(within(region(E)).getByText(/Request blocked/)).toBeInTheDocument();
    expect(within(region(E)).queryByRole("link", { name: "View case" })).not.toBeInTheDocument();
    expect(within(region("Evidence summary")).queryByText("Changed field")).not.toBeInTheDocument();
  });

  it("filters denied access events from Access review", async () => {
    const user = await open(/Audit log/);
    await user.click(within(region("Access review")).getByRole("button", { name: /Review events/ }));
    expect(rows(A)).toHaveLength(1);
    expect(footer(A)).toBe("Showing 1–1 of 1 events · Newest first");
  });

  it("filters by action", async () => {
    const user = await open(/Audit log/);
    await user.selectOptions(screen.getByLabelText("Action"), "CTR submitted");
    expect(cellText(A, 3).map((t) => t?.slice(0, 13))).toEqual(["CTR-2026-0082"]);
  });

  it("Related events searches for the selected record", async () => {
    const user = await open(/Audit log/);
    await user.click(rows(A)[2]);
    await user.click(within(region(E)).getByRole("button", { name: "Related events" }));
    expect(screen.getByLabelText("Search audit events")).toHaveValue("ALT-92841");
    expect(rows(A)).toHaveLength(1);
  });

  it("Copy ID writes the selected event id to the clipboard", async () => {
    const user = await open(/Audit log/);
    await user.click(within(region(E)).getByRole("button", { name: /Copy ID/ }));
    expect(await navigator.clipboard.readText()).toBe("EVT-20260928-095412-4821");
  });
});

describe("settings and profile", () => {
  const W = "Changes apply across this workspace";
  const P = "Your preferences, your workspace";
  const saveButtons = (bar: string) => within(region(bar)).getAllByRole("button");

  it("keeps the save bar visible, enabling it only while edits differ, and Cancel restores them", async () => {
    const user = await open(/Settings/);
    expect(within(region(W)).getByText("All changes saved")).toBeInTheDocument();
    for (const b of saveButtons(W)) expect(b).toBeDisabled();
    const digest = screen.getByRole("switch", { name: "Daily operations digest" });
    await user.click(digest);
    expect(within(region(W)).getByText("Unsaved changes")).toBeInTheDocument();
    for (const b of saveButtons(W)) expect(b).toBeEnabled();
    await user.click(digest);
    expect(within(region(W)).getByText("All changes saved")).toBeInTheDocument();
    await user.click(digest);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(digest).not.toBeChecked();
    expect(within(region(W)).getByText("All changes saved")).toBeInTheDocument();
  });

  it("saves workspace edits as the new baseline and keeps security controls locked", async () => {
    const user = await open(/Settings/);
    const name = screen.getByLabelText("Workspace name");
    await user.clear(name);
    await user.type(name, "Vigilia AML EU");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(name).toHaveValue("Vigilia AML EU");
    expect(within(region(W)).getByText("All changes saved")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Four-eyes approval for sensitive actions" })).toBeDisabled();
    expect(screen.getByRole("switch", { name: "Require multi-factor authentication" })).toBeDisabled();
    expect(screen.getByLabelText("Audit retention period")).toBeDisabled();
    expect(within(screen.getByRole("navigation", { name: "On this page" })).getAllByRole("link").map((a) => a.getAttribute("href")))
      .toEqual(["#general", "#security", "#notifications", "#audit"]);
  });

  it("saves profile edits and keeps them as the new baseline", async () => {
    const user = await open(/^Profile$/);
    const name = screen.getByLabelText("Display name");
    await user.clear(name);
    await user.type(name, "Amina K. Patel");
    expect(within(region(P)).getByText("Unsaved changes")).toBeInTheDocument();
    expect(within(region("Account")).queryByRole("heading", { name: /Amina K\. Patel/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save profile" }));
    expect(within(region(P)).getByText("All changes saved")).toBeInTheDocument();
    expect(within(region("Account")).getByRole("heading", { name: /Amina K\. Patel/ })).toBeInTheDocument();
    expect(screen.getByLabelText("Work email")).toBeDisabled();
  });

  it("revokes other sessions but never the current one", async () => {
    const user = await open(/^Profile$/);
    const list = () => within(screen.getByRole("list", { name: "Active sessions" })).getAllByRole("listitem");
    expect(list()).toHaveLength(2);
    expect(screen.getByText("(2 trusted devices)")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Revoke" }));
    expect(list()).toHaveLength(1);
    expect(list()[0]).toHaveTextContent("This session");
    expect(screen.getByText("(1 trusted device)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out other sessions" })).toBeDisabled();
  });

  it("signs out every other session at once", async () => {
    const user = await open(/^Profile$/);
    const signOut = screen.getByRole("button", { name: "Sign out other sessions" });
    expect(signOut).toBeEnabled();
    await user.click(signOut);
    expect(within(screen.getByRole("list", { name: "Active sessions" })).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Revoke" })).not.toBeInTheDocument();
    expect(signOut).toBeDisabled();
  });
});

describe("workspace loading", () => {
  it("marks the steps before the current stage complete and the rest waiting", () => {
    render(<MemoryRouter initialEntries={["/loading"]}><App /></MemoryRouter>);
    const steps = within(region("Connecting your workspace")).getAllByRole("listitem");
    expect(steps.map((s) => s.className)).toEqual(["done", "active", "todo", "todo"]);
    expect(steps[1]).toHaveAttribute("aria-current", "step");
    expect(steps[0]).toHaveTextContent("Complete");
    expect(steps[1]).toHaveTextContent("In progress");
    expect(steps[3]).toHaveTextContent("Waiting");
    expect(screen.getByText(/Stage 2 of 4 · Connect data sources/)).toBeInTheDocument();
    expect(region("Transaction analytics preview")).toHaveAttribute("aria-busy", "true");
    expect(within(region("Workspace guide")).getAllByRole("link").map((a) => a.getAttribute("href")))
      .toEqual(["/customers", "/investigations", "/transactions", "/cases"]);
  });
});

describe("header pills", () => {
  it.each([
    [/Transactions/, "248 high risk"], [/Customers/, "18 overdue reviews"], [/Investigators/, "2 cases awaiting assignment"],
    [/Reports/, "2 filings due today"], [/Rules & models/, "2 changes pending approval"], [/Audit log/, "3 access events to review"],
    [/Settings/, "Workspace configuration"], [/^Profile$/, "Personal account"], [/Transaction analytics/, "Memgraph · Claude"],
  ])("%s shows its Figma pill", async (nav, pill) => {
    await open(nav);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(pill);
  });
});
