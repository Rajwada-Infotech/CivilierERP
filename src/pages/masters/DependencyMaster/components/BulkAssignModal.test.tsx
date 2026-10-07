import React from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = vi.hoisted(() => ({ preview: vi.fn(), apply: vi.fn() }));
vi.mock("@/api/dependencyBulkAssignApi", () => ({ previewBulkAssign: api.preview, applyBulkAssign: api.apply }));
vi.mock("@/api/dependencyActivityAssignmentApi", () => ({
  getEngineers: async () => [
    { id: 1, name: "Asha" },
    { id: 2, name: "Ravi" },
  ],
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// The real pickers are Radix popovers; stand in simple buttons that pick a fixed person.
vi.mock("@/pages/civilworkdpr/RungAssignmentModal", () => ({
  UserMultiSelect: ({ placeholder, onChange }: { placeholder: string; onChange: (ids: number[]) => void }) => (
    <button type="button" onClick={() => onChange([1, 2])}>{placeholder}</button>
  ),
  ApprovalLevelsEditor: () => null,
}));

import { BulkAssignModal } from "./BulkAssignModal";

const row = (over: Record<string, unknown>) => ({ id: 1, projectId: 5, projectName: "Pristine Enclave", towerId: 10, towerName: "T-1", ...over }) as never;
const rows = [
  row({ id: 1 }),
  row({ id: 2, towerId: 11, towerName: "T-2" }),
  row({ id: 3, projectId: 6, projectName: "Royal Garden", towerId: 20, towerName: "Block A" }),
];

const summary = (over: Record<string, unknown> = {}) => ({
  totalActivities: 12,
  skippedCancelledOrApproved: 2,
  eligible: 10,
  willChange: 7,
  engineers: { requested: true, willFill: 7, alreadySet: 3, willReplace: 0 },
  qc: { requested: false, willFill: 0, alreadySet: 0, willReplace: 0 },
  approval: { requested: false, willFill: 0, alreadySet: 0, willReplace: 0 },
  ...over,
});

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
beforeEach(() => {
  api.preview.mockReset();
  api.apply.mockReset();
  api.preview.mockResolvedValue({ applied: false, summary: summary() });
});
afterEach(cleanup);

const mount = (onClose = vi.fn()) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <BulkAssignModal open onClose={onClose} rows={rows} />
    </QueryClientProvider>,
  );

const pickProject = (label: string) => {
  const select = screen.getAllByRole("combobox")[0] as HTMLSelectElement;
  const opt = screen.getByRole("option", { name: label }) as HTMLOptionElement;
  fireEvent.change(select, { target: { value: opt.value } });
};

describe("BulkAssignModal", () => {
  it("lists only projects that have chains, and Assign is disabled until something is chosen", () => {
    mount();
    expect(screen.getByRole("option", { name: "Pristine Enclave" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Royal Garden" })).toBeTruthy();
    const assign = screen.getByRole("button", { name: "Assign" }) as HTMLButtonElement;
    expect(assign.disabled).toBe(true);
    expect(screen.getByText(/Choose a project/)).toBeTruthy();
    expect(api.preview).not.toHaveBeenCalled();
  });

  it("offers only the chosen project's blocks", () => {
    mount();
    pickProject("Pristine Enclave");
    expect(screen.getByRole("option", { name: "T-1" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "T-2" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Block A" })).toBeNull();
  });

  it("asks for a choice before previewing", () => {
    mount();
    pickProject("Pristine Enclave");
    expect(screen.getByText(/Choose engineers, quality check or approvers/)).toBeTruthy();
    expect(api.preview).not.toHaveBeenCalled();
  });

  it("previews the counts, then Assign sends exactly what was chosen", async () => {
    const onClose = vi.fn();
    api.apply.mockResolvedValue({ applied: true, summary: summary(), changed: { activities: 7, engineers: 7, qc: 0, approval: 0, created: 0 } });
    mount(onClose);
    pickProject("Pristine Enclave");
    fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "11" } }); // block T-2
    fireEvent.click(screen.getByRole("button", { name: "Select engineers…" }));

    expect(await screen.findByText(/of 10 activities will be updated/)).toBeTruthy();
    expect(screen.getByText(/2 cancelled or already approved are skipped/)).toBeTruthy();
    expect(screen.getByText(/3 already set, left as they are/)).toBeTruthy();
    expect(api.preview).toHaveBeenLastCalledWith({ projectId: 5, towerId: 11, engineerIds: [1, 2], qcUserIds: [], approvalLevels: [], overwrite: false });

    const assign = await screen.findByRole("button", { name: "Assign 7 activities" });
    await waitFor(() => expect((assign as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(assign);
    await waitFor(() => expect(api.apply).toHaveBeenCalledTimes(1));
    expect(api.apply.mock.calls[0][0]).toEqual({ projectId: 5, towerId: 11, engineerIds: [1, 2], qcUserIds: [], approvalLevels: [], overwrite: false });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("Overwrite existing is off by default and is sent when ticked", async () => {
    mount();
    pickProject("Pristine Enclave");
    fireEvent.click(screen.getByRole("button", { name: "Select engineers…" }));
    await screen.findByText(/activities will be updated/);
    expect(api.preview.mock.calls.at(-1)?.[0].overwrite).toBe(false);
    fireEvent.click(screen.getByLabelText(/Overwrite existing/));
    await waitFor(() => expect(api.preview.mock.calls.at(-1)?.[0].overwrite).toBe(true));
  });

  it("with every block chosen, towerId is null", async () => {
    mount();
    pickProject("Pristine Enclave");
    fireEvent.click(screen.getByRole("button", { name: "Select engineers…" }));
    await screen.findByText(/activities will be updated/);
    expect(api.preview.mock.calls.at(-1)?.[0].towerId).toBeNull();
  });

  it("says so, and keeps Assign off, when everything is already set", async () => {
    api.preview.mockResolvedValue({ applied: false, summary: summary({ willChange: 0, engineers: { requested: true, willFill: 0, alreadySet: 10, willReplace: 0 } }) });
    mount();
    pickProject("Pristine Enclave");
    fireEvent.click(screen.getByRole("button", { name: "Select engineers…" }));
    expect(await screen.findByText(/nothing to change/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Assign" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the server's message when the preview fails", async () => {
    api.preview.mockRejectedValue(new Error("You don't have access to this project."));
    mount();
    pickProject("Pristine Enclave");
    fireEvent.click(screen.getByRole("button", { name: "Select engineers…" }));
    expect(await screen.findByText("You don't have access to this project.")).toBeTruthy();
  });
});
