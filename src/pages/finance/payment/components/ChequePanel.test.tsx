import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const lotsMock = vi.fn();
vi.mock("../api", () => ({
  fetchChequeLots: (...a: unknown[]) => lotsMock(...a),
  fetchChequeNumbers: async () => [],
  deductChequeFromLot: async () => ({}),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { ChequePanel } from "./ChequePanel";

const lot = (over: Record<string, unknown> = {}) => ({
  CId: 15,
  ChequeLotNumber: "LOT 15",
  AccountNumber: "4056582879",
  IFSCCode: "KKBK0000329",
  ChequeStartNumber: 5,
  ChequeEndNumber: 50,
  RemainingCheques: 44,
  ...over,
});

const form = (over: Record<string, unknown> = {}) =>
  ({ chequeLotId: 15, chequeLotNumber: "LOT 15", chequeAccountNumber: "4056582879", chequeIfsc: "KKBK0000329", chequeNo: "", chequeDate: "", ...over }) as never;

beforeEach(() => lotsMock.mockReset());

const renderPanel = (f = form()) => render(<ChequePanel bankId={3} form={f} set={() => {}} isPostDated={false} />);

describe("ChequePanel - the cheque range beside the lot number", () => {
  it("one lot: the range sits right beside the lot number, with the remaining count", async () => {
    lotsMock.mockResolvedValue([lot()]);
    renderPanel();
    await waitFor(() => expect(screen.getByText("LOT 15")).toBeInTheDocument());
    expect(screen.getByText("· Cheques 5 – 50")).toBeInTheDocument();
    expect(screen.getByText("44 remaining")).toBeInTheDocument();
  });

  it("several lots: every option in the dropdown shows its range", async () => {
    lotsMock.mockResolvedValue([lot(), lot({ CId: 16, ChequeLotNumber: "LOT 16", ChequeStartNumber: 51, ChequeEndNumber: 100, RemainingCheques: 50 })]);
    renderPanel();
    await waitFor(() => expect(screen.getAllByRole("option").length).toBeGreaterThan(1));
    const labels = screen.getAllByRole("option").map((o) => o.textContent);
    expect(labels.some((t) => t?.includes("LOT 15") && t.includes("Cheques 5 – 50") && t.includes("(44 remaining)"))).toBe(true);
    expect(labels.some((t) => t?.includes("LOT 16") && t.includes("Cheques 51 – 100"))).toBe(true);
  });

  it("a lot with no range recorded shows just its number, no stray separator", async () => {
    lotsMock.mockResolvedValue([lot({ ChequeStartNumber: null, ChequeEndNumber: null })]);
    renderPanel();
    await waitFor(() => expect(screen.getByText("LOT 15")).toBeInTheDocument());
    expect(screen.queryByText(/· Cheques/)).not.toBeInTheDocument();
  });
});
