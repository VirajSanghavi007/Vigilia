import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import App from "../../src/App";

// Real App + real mock data + real child components: exercises the
// search box -> table filter and pager wiring end to end.

const table = () => screen.getByRole("region", { name: "Recent alerts" });
const bodyRows = () => within(table()).getAllByRole("row").slice(1);

describe("alerts table interactions", () => {
  it("pages forward and back", async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(within(table()).getByText("Showing 1-5 of 10 alerts")).toBeInTheDocument();
    expect(within(table()).getByText("Orion Trading FZE")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(within(table()).getByText("Showing 6-10 of 10 alerts")).toBeInTheDocument();
    expect(within(table()).queryByText("Orion Trading FZE")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "1" }));
    expect(within(table()).getByText("Showing 1-5 of 10 alerts")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
  });

  it("filters from the header search and resets to page 1", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Next page" }));
    // Matches 9 alerts, so a stale page 2 would still be valid: proves the reset.
    await user.type(screen.getByRole("textbox", { name: "Search alerts" }), "ALF-50");
    expect(within(table()).getByText("Showing 1-5 of 9 alerts")).toBeInTheDocument();
  });

  it("narrows the table to matching typology", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByRole("textbox", { name: "Search alerts" }), "sanctions");
    expect(bodyRows()).toHaveLength(2);
    expect(within(table()).getByText("Showing 1-2 of 2 alerts")).toBeInTheDocument();
  });

  it("shows an empty state when nothing matches", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByRole("textbox", { name: "Search alerts" }), "zzz");
    expect(within(table()).getByText('No alerts match "zzz"')).toBeInTheDocument();
    expect(within(table()).getByText("Showing 0-0 of 0 alerts")).toBeInTheDocument();
  });

  it("highlights the selected sidebar item", async () => {
    const user = userEvent.setup();
    render(<App />);
    const cases = screen.getByRole("button", { name: /Cases/ });
    await user.click(cases);
    expect(cases).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: /Overview/ })).not.toHaveAttribute("aria-current");
  });
});
