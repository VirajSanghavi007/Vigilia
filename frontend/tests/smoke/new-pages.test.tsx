import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../../src/App";
import { alertPath, auditPath, casePath, paths, reportPath, rulePath } from "../../src/routes";

afterEach(() => vi.restoreAllMocks());

describe("new pages smoke", () => {
  it.each([
    [alertPath("ALT-92841"), /^Alert ALT-92841/],
    [casePath("AML-4821"), /^Case AML-4821/],
    [rulePath("TM-014"), /^TM-014 · /],
    [reportPath("SAR-2026-0148"), /^SAR-2026-0148/],
    [auditPath("EVT-20260928-095412-4821"), /^Case assigned/],
    [alertPath("ALT-0"), /^Alert not found/],
    [paths.notifications, /^Notifications/],
    [paths.typologies, /^Typologies/],
    [paths.riskMap, /^Risk map/],
    [paths.riskTrend, /^Risk trend/],
    [paths.accessRequest, /^Request access/],
    [paths.support, /^Support/],
    [paths.configPolicy, /^Configuration policy/],
    [paths.reportSchedules, /^Report schedules/],
    [paths.customerReviews, /^Customer reviews/],
    [paths.ruleModel, /^Model /],
    [paths.assignmentPolicy, /^Assignment policy/],
  ])("%s renders without errors", (path, title) => {
    const errors = vi.spyOn(console, "error");
    render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(title);
    expect(screen.getAllByRole("region").length).toBeGreaterThan(0);
    expect(errors).not.toHaveBeenCalled();
  });
});
