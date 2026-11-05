import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/lib/fetchWithAuth", () => ({ fetchWithAuth: vi.fn() }));
vi.mock("@/hooks/usePageRights", () => ({ usePageRights: () => ({ canEdit: true }) }));

import { ModuleGroupSelector } from "./ApprovalSetup";

describe("ModuleGroupSelector (Where does this rule apply?)", () => {
  it("starts with every list closed, even for a group that already has areas selected", () => {
    render(<ModuleGroupSelector selectedModules={["crm-bookings"]} toggleModule={() => {}} />);
    // the chip shows how many are selected, but the list of areas is not dropped down
    expect(screen.getByText("CRM")).toBeInTheDocument();
    expect(screen.queryByText("CRM Booking")).not.toBeInTheDocument();
  });

  it("opens a group's list only when its chevron is clicked, and closes it again", () => {
    render(<ModuleGroupSelector selectedModules={["crm-bookings"]} toggleModule={() => {}} />);
    const chip = screen.getByText("CRM").closest("div") as HTMLElement;
    const chevron = chip.querySelectorAll("button")[1];
    fireEvent.click(chevron);
    expect(screen.getByText("CRM Booking")).toBeInTheDocument();
    fireEvent.click(chevron);
    expect(screen.queryByText("CRM Booking")).not.toBeInTheDocument();
  });
});
