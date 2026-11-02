import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import App from "../../src/App";

describe("queue pages smoke", () => {
  it("renders the alert queue page without errors", async () => {
    const errors = vi.spyOn(console, "error");
    render(<MemoryRouter><App /></MemoryRouter>);
    await userEvent.setup().click(screen.getByRole("link", { name: /Alert queue/ }));
    expect(screen.getByRole("heading", { name: /Alert Queue/ })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Investigation queue" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Selected alert snapshot" })).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(9); // header + 8
    expect(errors).not.toHaveBeenCalled();
  });

  it("renders the cases page without errors", async () => {
    const errors = vi.spyOn(console, "error");
    render(<MemoryRouter><App /></MemoryRouter>);
    await userEvent.setup().click(screen.getByRole("link", { name: /Cases/ }));
    expect(screen.getByRole("heading", { name: /Cases/ })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Case management" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Investigator workload" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Recent case activity" })).toBeInTheDocument();
    expect(errors).not.toHaveBeenCalled();
  });
});
