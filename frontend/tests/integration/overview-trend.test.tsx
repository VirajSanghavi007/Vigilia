import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import App from "../../src/App";
import { getDashboard } from "../../src/data/mock";

// jsdom gives charts no size, so recharts draws nothing; swap the line chart
// for a stub that shows which days it was handed.
vi.mock("recharts", async (original) => ({
  ...(await original<typeof import("recharts")>()),
  LineChart: ({ data }: { data: { date: string }[] }) => <output data-testid="line-days">{data.map((d) => d.date).join(",")}</output>,
}));

describe("overview risk trend", () => {
  it("follows the header date range", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><App /></MemoryRouter>);
    const days = () => screen.getByTestId("line-days").textContent!.split(",");
    expect(days()).toEqual(getDashboard().riskTrend.map((d) => d.date));
    await user.selectOptions(screen.getByRole("combobox", { name: "Date range" }), "7d");
    expect(days()).toEqual(["Sep 22", "Sep 23", "Sep 24", "Sep 25", "Sep 26", "Sep 27", "Sep 28"]);
    await user.selectOptions(screen.getByRole("combobox", { name: "Date range" }), "today");
    expect(days()).toEqual(["Sep 28"]);
  });

  it("ignores the filters the daily series has no breakdown for", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><App /></MemoryRouter>);
    await user.selectOptions(screen.getByRole("combobox", { name: "Business unit" }), "Retail banking");
    expect(screen.getByTestId("line-days").textContent!.split(",")).toHaveLength(getDashboard().riskTrend.length);
  });
});
