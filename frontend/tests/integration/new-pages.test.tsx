import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import App from "../../src/App";
import { audit } from "../../src/data/ops";
import { getAlertQueue, getCases } from "../../src/data/queue";
import { DEFAULT_SCOPE, inScope, scopeOfQueueAlert, type Scope } from "../../src/lib/scope";
import { setThemePref, THEME_KEY } from "../../src/lib/theme";
import { alertPath, auditPath, casePath, paths, reportPath, rulePath } from "../../src/routes";

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}
function at(path: string) {
  render(<MemoryRouter initialEntries={[path]}><App /><Where /></MemoryRouter>);
  return userEvent.setup();
}
const where = () => screen.getByTestId("where").textContent;
const h1 = () => screen.getByRole("heading", { level: 1 });
const region = (name: string) => screen.getByRole("region", { name });
const queueIds = () => within(region("Investigation queue")).getAllByRole("row").slice(1)
  .map((r) => /ALT-\d+/.exec(r.textContent ?? "")?.[0]);
/** The header's own filter controls (the queue pages have a second "More filters"). */
const header = () => within(document.querySelector("header.header") as HTMLElement);
/** Ids the queue should hold under these filters, from the data rather than hard-coded. */
const expected = (s: Partial<Scope>) => getAlertQueue().alerts.filter((a) => inScope(scopeOfQueueAlert(a), { ...DEFAULT_SCOPE, ...s })).map((a) => a.id);
/** The queue shows exactly the expected alerts (first page of them). */
function expectQueue(s: Partial<Scope>) {
  const ids = expected(s);
  expect(ids.length).toBeGreaterThan(0);
  expect(region("Investigation queue")).toHaveTextContent(new RegExp(`of ${ids.length} `));
  const shown = queueIds();
  expect(shown).toHaveLength(Math.min(ids.length, 8));
  for (const id of shown) expect(ids).toContain(id);
}

afterEach(() => {
  setThemePref("system");
  localStorage.clear();
});

describe("record detail pages", () => {
  it("links an alert to its rule, case and audit trail", async () => {
    const user = at(alertPath("ALT-92841"));
    expect(h1()).toHaveTextContent(/^Alert ALT-92841/);
    expect(within(region("Linked case")).getByRole("link", { name: "AML-4821" })).toHaveAttribute("href", casePath("AML-4821"));
    expect(within(region("Audit trail")).getByRole("link", { name: "EVT-20260928-094631-2841" })).toBeInTheDocument();
    await user.click(within(region("Alert summary")).getByRole("link", { name: /TM-014/ }));
    expect(where()).toBe(rulePath("TM-014"));
    expect(h1()).toHaveTextContent(/^TM-014 · /);
    expect(within(region("Open alerts from this rule")).getByRole("link", { name: "ALT-92841" })).toBeInTheDocument();
    expect(within(region("Change history")).getByRole("link", { name: "EVT-20260928-095208-0014" })).toBeInTheDocument();
  });

  it("links a case to its alerts, filings and events", async () => {
    const user = at(casePath("AML-4821"));
    expect(h1()).toHaveTextContent(/^Case AML-4821/);
    expect(within(region("Open alerts")).getByRole("link", { name: "ALT-92841" })).toBeInTheDocument();
    expect(within(region("Audit trail")).getByRole("link", { name: "EVT-20260928-095412-4821" })).toBeInTheDocument();
    await user.click(within(region("Regulatory filings")).getByRole("link", { name: "SAR-2026-0148" }));
    expect(where()).toBe(reportPath("SAR-2026-0148"));
    // A draft has its evidence in and is on the narrative.
    expect(within(screen.getByRole("list", { name: "Filing steps" })).getByText(/2 Narrative/).closest("li")).toHaveAttribute("aria-current", "step");
    await user.click(within(region("Filing")).getByRole("link", { name: "AML-4821" }));
    expect(where()).toBe(casePath("AML-4821"));
  });

  it("opens the record behind an audit event", async () => {
    const user = at(auditPath("EVT-20260928-095412-4821"));
    expect(region("Event")).toHaveTextContent("append-only");
    await user.click(screen.getByRole("link", { name: /Open AML-4821/ }));
    expect(where()).toBe(casePath("AML-4821"));
    await user.click(screen.getByRole("link", { name: /Back to Cases/ }));
    expect(where()).toBe(paths.cases);
  });

  it("shows a denied event without a record link", () => {
    at(auditPath("EVT-20260928-080452-0001"));
    expect(region("Event")).toHaveTextContent("Request blocked");
    expect(screen.queryByRole("link", { name: /Open Customer export/ })).not.toBeInTheDocument();
    expect(screen.getByText("Customer export")).toBeInTheDocument();
  });

  it.each([
    [alertPath("ALT-1"), "Alert", "Alert queue", paths.alerts],
    [casePath("AML-1"), "Case", "Cases", paths.cases],
    [rulePath("TM-999"), "Rule", "Rules & models", paths.rules],
    [reportPath("SAR-2026-9999"), "Report", "Reports", paths.reports],
    [auditPath("EVT-0"), "Audit event", "Audit log", paths.audit],
  ])("%s is not found and leads back to the list", async (path, noun, list, to) => {
    const user = at(path);
    expect(h1()).toHaveTextContent(`${noun} not found`);
    await user.click(within(region("Record not found")).getByRole("link", { name: `Open ${list}` }));
    expect(where()).toBe(to);
  });

  it("opens the model page rather than a rule named model", () => {
    at(paths.ruleModel);
    expect(h1()).toHaveTextContent(/^Model /);
    expect(region("Model summary")).toHaveTextContent("not evaluated metrics");
  });
});

describe("alert queue case link", () => {
  it("links the selected alert to its customer's open case", () => {
    at(paths.alerts);
    const link = screen.getByRole("link", { name: /^View case AML-\d+/ });
    const id = /AML-\d+/.exec(link.textContent ?? "")![0];
    expect(link).toHaveAttribute("href", casePath(id));
  });
});

describe("workspace filters", () => {
  it("narrow the alert queue and reset", async () => {
    const user = at(paths.alerts);
    expectQueue({});
    await user.selectOptions(screen.getByRole("combobox", { name: "Jurisdiction" }), "AE");
    expectQueue({ jurisdiction: "AE" });
    expect(expected({ jurisdiction: "AE" }).length).toBeLessThan(expected({}).length);
    await user.selectOptions(screen.getByRole("combobox", { name: "Business unit" }), "Corporate banking");
    expectQueue({ jurisdiction: "AE", unit: "Corporate banking" });
    await user.click(screen.getByRole("button", { name: "Reset filters" }));
    expectQueue({});
    expect(screen.queryByRole("button", { name: "Reset filters" })).not.toBeInTheDocument();
  });

  it("add and remove the More filters extras", async () => {
    const user = at(paths.alerts);
    const more = header().getByRole("button", { name: /More filters/ });
    expect(more).toHaveAttribute("aria-expanded", "false");
    await user.click(more);
    expect(more).toHaveAttribute("aria-expanded", "true");
    await user.selectOptions(header().getByRole("combobox", { name: "Typology" }), "Rapid movement of funds");
    await user.selectOptions(header().getByRole("combobox", { name: "Minimum risk score" }), "90");
    expect(more).toHaveTextContent("2");
    expectQueue({ typology: "Rapid movement of funds", minScore: 90 });
    await user.click(header().getByRole("button", { name: "Done" }));
    expect(header().queryByRole("group", { name: "More filters" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove score filter" }));
    expectQueue({ typology: "Rapid movement of funds" });
    expect(expected({ typology: "Rapid movement of funds" }).length).toBeGreaterThan(expected({ typology: "Rapid movement of funds", minScore: 90 }).length);
    await user.click(screen.getByRole("button", { name: "Remove typology filter" }));
    expectQueue({});
    expect(more).not.toHaveTextContent(/\d/);
  });

  it("carry over from the overview to the alert queue", async () => {
    const user = at(paths.overview);
    await user.selectOptions(screen.getByRole("combobox", { name: "Jurisdiction" }), "GH");
    await user.click(screen.getByRole("link", { name: /Alert queue/ }));
    expect(screen.getByRole("combobox", { name: "Jurisdiction" })).toHaveValue("GH");
    expectQueue({ jurisdiction: "GH" });
  });
});

describe("risk trend page", () => {
  const days = () => within(region("Daily alerts")).getAllByRole("row").length - 1;
  it("follows the date range", async () => {
    const user = at(paths.riskTrend);
    expect(days()).toBe(28);
    expect(within(screen.getByRole("region", { name: "Trend summary" })).getByText("+117.1%")).toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: "Date range" }), "7d");
    expect(days()).toBe(7);
    expect(h1()).toHaveTextContent("Sep 22 - Sep 28, 2026");
    // Newest day first.
    expect(within(region("Daily alerts")).getAllByRole("row")[1]).toHaveTextContent("Sep 28");
    await user.selectOptions(screen.getByRole("combobox", { name: "Date range" }), "today");
    expect(days()).toBe(1);
    expect(within(region("Daily alerts")).getAllByRole("row")[1]).toHaveTextContent("Sep 28");
  });
});

describe("drill-downs into the alert queue", () => {
  it("opens a typology's alerts", async () => {
    const user = at(paths.typologies);
    const row = within(region("Typology breakdown")).getByText("Structuring / smurfing").closest("tr")!;
    expect(within(row).getByRole("link", { name: /TM-008/ })).toHaveAttribute("href", rulePath("TM-008"));
    await user.click(within(row).getByRole("button", { name: /Open alerts/ }));
    expect(where()).toBe(paths.alerts);
    expect(screen.getByText(/Typology: Structuring \/ smurfing/)).toBeInTheDocument();
    expectQueue({ typology: "Structuring / smurfing" });
  });

  it("opens a jurisdiction's alerts from the risk map", async () => {
    const user = at(paths.riskMap);
    const rows = within(region("Alerts by jurisdiction")).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(new Set(getAlertQueue().alerts.map((a) => a.entityType.slice(0, 2))).size);
    const ch = rows.find((r) => r.textContent?.startsWith("CH"))!;
    await user.click(within(ch).getByRole("button", { name: /Open alerts/ }));
    expect(where()).toBe(paths.alerts);
    expect(screen.getByRole("combobox", { name: "Jurisdiction" })).toHaveValue("CH");
    expectQueue({ jurisdiction: "CH" });
  });

  it("follows the filters and shows an empty state", async () => {
    const user = at(paths.riskMap);
    await user.selectOptions(screen.getByRole("combobox", { name: "Business unit" }), "Retail banking");
    const codes = within(region("Alerts by jurisdiction")).getAllByRole("row").slice(1).map((r) => r.textContent?.slice(0, 2));
    const retail = getAlertQueue().alerts.filter((a) => /individual/i.test(a.entityType)).map((a) => a.entityType.slice(0, 2));
    expect(codes.sort()).toEqual([...new Set(retail)].sort());
    await user.click(header().getByRole("button", { name: /More filters/ }));
    // No retail customer is in the sanctions-proximity typology.
    expect(expected({ unit: "Retail banking", typology: "Sanctions proximity" })).toEqual([]);
    await user.selectOptions(screen.getByRole("combobox", { name: "Typology" }), "Sanctions proximity");
    expect(region("Alerts by jurisdiction")).toHaveTextContent("No open alerts match the current filters.");
  });
});

describe("notifications", () => {
  it("lists what needs attention and links to it", async () => {
    const user = at(paths.overview);
    await user.click(screen.getByRole("link", { name: "Notifications" }));
    expect(where()).toBe(paths.notifications);
    const breached = getAlertQueue().alerts.filter((a) => a.slaBreached);
    const overdue = getCases().cases.filter((c) => c.overdue);
    const items = within(region("Notifications")).getAllByRole("listitem");
    expect(items).toHaveLength(breached.length + overdue.length + audit.denied.length);
    expect(h1()).toHaveTextContent(`${items.length} unread`);
    await user.click(within(items[0]).getByRole("link"));
    expect(where()).toBe(alertPath(breached[0].id));
    expect(h1()).toHaveTextContent(`Alert ${breached[0].id}`);
  });
});

describe("theme setting", () => {
  it("applies from Profile straight away without dirtying the form", async () => {
    const user = at(paths.profile);
    const select = within(region("Personal preferences")).getByRole("combobox", { name: "Theme" });
    expect(select).toHaveValue("Match system");
    await user.selectOptions(select, "Dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem(THEME_KEY)).toBe("dark");
    expect(screen.queryByRole("button", { name: /Save changes/ })).not.toBeInTheDocument();
    await user.selectOptions(select, "Light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("stays in step with the header toggle", async () => {
    const user = at(paths.profile);
    await user.click(screen.getByRole("button", { name: /^Theme: System/ }));
    expect(screen.getByRole("combobox", { name: "Theme" })).toHaveValue("Light");
    await user.click(screen.getByRole("button", { name: /^Theme: Light/ }));
    expect(screen.getByRole("combobox", { name: "Theme" })).toHaveValue("Dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});
