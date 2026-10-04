import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = vi.hoisted(() => ({
  getCheckpointUpdates: vi.fn(),
  saveCheckpointUpdate: vi.fn(),
  deleteCheckpointUpdate: vi.fn(),
  fetchCheckpointUpdatePhoto: vi.fn(),
}));
vi.mock("@/api/dependencyActivityAssignmentApi", () => api);
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// The real dialog needs a camera; stand in a button that "captures" a photo.
vi.mock("./CameraCaptureDialog", () => ({
  CameraCaptureDialog: ({ open, onConfirm }: { open: boolean; onConfirm: (b: Blob) => void }) =>
    open ? <button onClick={() => onConfirm(new Blob(["x"], { type: "image/jpeg" }))}>mock-capture</button> : null,
}));

import { CheckpointDailyUpdates, toYmd } from "./CheckpointDailyUpdates";

const wrap = (ui: React.ReactElement) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
};

const todayYmd = toYmd(new Date());

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  URL.createObjectURL ??= () => "blob:x";
  URL.revokeObjectURL ??= () => {};
});
beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.getCheckpointUpdates.mockResolvedValue([]);
  api.saveCheckpointUpdate.mockResolvedValue({ success: true, id: 1, replaced: false });
  api.fetchCheckpointUpdatePhoto.mockResolvedValue("blob:photo");
});
afterEach(cleanup);

describe("toYmd", () => {
  it("uses the local calendar date (no UTC day shift)", () => {
    expect(toYmd(new Date(2026, 8, 5, 23, 59))).toBe("2026-09-05");
    expect(toYmd(new Date(2026, 0, 1, 0, 1))).toBe("2026-01-01");
  });
});

describe("CheckpointDailyUpdates", () => {
  it("asks to save the allocation first when the checkpoint has no id yet", () => {
    wrap(<CheckpointDailyUpdates />);
    expect(screen.getByText(/Save the allocation/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /take photo/i })).not.toBeInTheDocument();
    expect(api.getCheckpointUpdates).not.toHaveBeenCalled();
  });

  it("shows the calendar dropdown defaulting to today and a camera button", async () => {
    wrap(<CheckpointDailyUpdates checkpointId={10} />);
    expect(await screen.findByText(/No updates yet/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Choose update date")).toHaveTextContent(/Today/);
    expect(screen.getByRole("button", { name: /take photo/i })).toBeInTheDocument();
  });

  it("logs the captured photo against the chosen date with the note", async () => {
    wrap(<CheckpointDailyUpdates checkpointId={10} />);
    await screen.findByText(/No updates yet/i);
    fireEvent.change(screen.getByPlaceholderText(/note for this photo/i), { target: { value: "watered" } });
    fireEvent.click(screen.getByRole("button", { name: /take photo/i }));
    fireEvent.click(await screen.findByText("mock-capture"));
    await waitFor(() => expect(api.saveCheckpointUpdate).toHaveBeenCalledTimes(1));
    const [cpId, input] = api.saveCheckpointUpdate.mock.calls[0];
    expect(cpId).toBe(10);
    expect(input.date).toBe(todayYmd);
    expect(input.note).toBe("watered");
    expect(input.photo).toBeInstanceOf(Blob);
  });

  it("shows today's existing update and offers a retake", async () => {
    api.getCheckpointUpdates.mockResolvedValue([
      { id: 5, date: todayYmd, hasPhoto: true, note: "day one", createdBy: "hiren@x", createdAt: "" },
    ]);
    wrap(<CheckpointDailyUpdates checkpointId={10} />);
    expect(await screen.findByText("day one")).toBeInTheDocument();
    expect(screen.getByText(/1 day logged/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retake/i })).toBeInTheDocument();
    await waitFor(() => expect(api.fetchCheckpointUpdatePhoto).toHaveBeenCalledWith(5));
  });

  it("removes a day's update", async () => {
    api.getCheckpointUpdates.mockResolvedValue([
      { id: 5, date: todayYmd, hasPhoto: false, note: "n", createdBy: null, createdAt: "" },
    ]);
    api.deleteCheckpointUpdate.mockResolvedValue({ success: true });
    wrap(<CheckpointDailyUpdates checkpointId={10} />);
    fireEvent.click(await screen.findByTitle(/remove this day's update/i));
    await waitFor(() => expect(api.deleteCheckpointUpdate).toHaveBeenCalledWith(5));
  });
});
