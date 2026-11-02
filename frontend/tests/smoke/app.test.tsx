import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import App from "../../src/App";

describe("dashboard smoke", () => {
  it("renders every section without errors", () => {
    const errors = vi.spyOn(console, "error");
    render(<App />);
    expect(screen.getByRole("heading", { name: /Financial Crime Overview/ })).toBeInTheDocument();
    for (const title of [
      "Risk trend", "Transaction monitoring", "Alert severity",
      "Alert typology breakdown", "Geographic risk", "Case activity",
    ]) {
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    }
    expect(screen.getByText("$2.48B")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(6); // header + 5 alerts
    expect(errors).not.toHaveBeenCalled();
  });
});
