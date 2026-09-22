import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import type { BankRecord } from "@/api/bankMasterApi";
import {
  emptySettlement,
  settlementError,
  settlementFromVoucher,
  settlementPayload,
  type SettlementValue,
} from "./settlement";

const api = vi.hoisted(() => ({ fetchChequeLots: vi.fn(), fetchChequeNumbers: vi.fn() }));
vi.mock("@/pages/finance/payment/api", () => api);

import { SettlementModeSection } from "./SettlementModeSection";

describe("settlement helpers", () => {
  it("has no error without a mode, and needs the full cheque detail for cheque modes", () => {
    expect(settlementError(emptySettlement())).toBeNull();
    const v: SettlementValue = { ...emptySettlement(), mode: "Cheque" };
    expect(settlementError(v)).toMatch(/bank account/i);
    expect(settlementError({ ...v, bankId: "58" })).toMatch(/lot/i);
    expect(settlementError({ ...v, bankId: "58", chequeLotId: 1 })).toMatch(/cheque number/i);
    expect(settlementError({ ...v, bankId: "58", chequeLotId: 1, chequeNo: "100001" })).toMatch(/date/i);
    expect(settlementError({ ...v, bankId: "58", chequeLotId: 1, chequeNo: "100001", chequeDate: "2026-09-21" })).toBeNull();
    expect(settlementError({ ...emptySettlement(), mode: "Cash" })).toBeNull();
    expect(settlementError({ ...emptySettlement(), mode: "NEFT" })).toBeNull();
  });

  it("sends only what the chosen mode uses", () => {
    expect(settlementPayload(emptySettlement())).toEqual({ Mode: null });
    expect(settlementPayload({ ...emptySettlement(), mode: "Cash", bankId: "5", chequeNo: "9" })).toEqual({
      Mode: "Cash", BankId: null, ChequeLotId: null, ChequeNo: null, ChequeDate: null, DigitalRefNumber: null,
    });
    expect(
      settlementPayload({ mode: "UPI", bankId: "5", chequeLotId: 1, chequeNo: "9", chequeDate: "x", digitalRefNumber: " T1 " }),
    ).toEqual({ Mode: "UPI", BankId: 5, ChequeLotId: null, ChequeNo: null, ChequeDate: null, DigitalRefNumber: "T1" });
    expect(
      settlementPayload({ mode: "Cheque", bankId: "5", chequeLotId: 2, chequeNo: "200001", chequeDate: "2026-09-21", digitalRefNumber: "z" }),
    ).toEqual({ Mode: "Cheque", BankId: 5, ChequeLotId: 2, ChequeNo: "200001", ChequeDate: "2026-09-21", DigitalRefNumber: null });
  });

  it("round-trips a saved voucher", () => {
    expect(
      settlementFromVoucher({ Mode: "Post-Dated Cheque", BankId: 58, ChequeLotId: 1, ChequeNo: "100002", ChequeDate: "2026-10-01T00:00:00.000Z" }),
    ).toEqual({ mode: "Post-Dated Cheque", bankId: "58", chequeLotId: 1, chequeNo: "100002", chequeDate: "2026-10-01", digitalRefNumber: "" });
    expect(settlementFromVoucher({ Mode: "Barter" }).mode).toBe("");
  });
});

const banks = [
  { BId: 58, BName: "Axis Bank", BAccountNumber: "1234", BCompanyName: "Acme" },
  { BId: 59, BName: "HDFC", BAccountNumber: "9876", BCompanyName: "Acme" },
] as unknown as BankRecord[];

function Harness({ initial = emptySettlement(), companySelected = true, list = banks }: { initial?: SettlementValue; companySelected?: boolean; list?: BankRecord[] }) {
  const [v, setV] = useState(initial);
  return (
    <>
      <SettlementModeSection value={v} onChange={setV} banks={list} companySelected={companySelected} />
      <output data-testid="state">{JSON.stringify(v)}</output>
    </>
  );
}
const state = () => JSON.parse(screen.getByTestId("state").textContent || "{}") as SettlementValue;

describe("SettlementModeSection", () => {
  beforeEach(() => {
    api.fetchChequeLots.mockReset().mockResolvedValue([
      { CId: 1, ChequeLotNumber: "LOT-2025-001", RemainingCheques: 49 },
      { CId: 7, ChequeLotNumber: "LOT-2025-007", RemainingCheques: 10 },
    ]);
    api.fetchChequeNumbers.mockReset().mockResolvedValue([
      { number: "100001", used: true, bounced: false },
      { number: "100002", used: false, bounced: false },
      { number: "100003", used: false, bounced: true },
      { number: "100004", used: false, bounced: false },
    ]);
  });
  afterEach(cleanup);

  it("shows every payment mode", () => {
    render(<Harness />);
    for (const m of ["Cash", "Cheque", "Post-Dated Cheque", "NEFT", "UPI", "RTGS", "IMPS", "Card"]) {
      expect(screen.getByRole("button", { name: m })).toBeInTheDocument();
    }
  });

  it("Cash needs no bank; clicking the active mode again clears it", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Cash" }));
    expect(state().mode).toBe("Cash");
    expect(screen.queryByLabelText("Bank account")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cash" }));
    expect(state().mode).toBe("");
  });

  it("digital modes ask for a bank and the matching reference", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "NEFT" }));
    expect(screen.getByLabelText("Bank account")).toBeInTheDocument();
    expect(screen.getByText("NEFT UTR Number")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "UPI" }));
    expect(screen.getByText("UPI Transaction ID")).toBeInTheDocument();
  });

  it("Cheque: bank → that bank's lots → only free leaves", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Cheque" }));
    expect(screen.queryByLabelText("Cheque lot")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Bank account"), { target: { value: "58" } });
    await waitFor(() => expect(api.fetchChequeLots).toHaveBeenCalledWith(58));

    const lot = await screen.findByLabelText("Cheque lot");
    expect(lot).toHaveTextContent("LOT-2025-001");
    expect(lot).toHaveTextContent("(49 remaining)");
    fireEvent.change(lot, { target: { value: "1" } });
    await waitFor(() => expect(api.fetchChequeNumbers).toHaveBeenCalledWith(1));

    const num = await screen.findByLabelText("Cheque number");
    await waitFor(() => expect(num).toHaveTextContent("# 100002"));
    expect(num).toHaveTextContent("# 100004");
    expect(num).not.toHaveTextContent("100001"); // used
    expect(num).not.toHaveTextContent("100003"); // bounced

    fireEvent.change(num, { target: { value: "100002" } });
    fireEvent.change(screen.getByLabelText("Cheque date"), { target: { value: "2026-09-21" } });
    expect(state()).toMatchObject({ mode: "Cheque", bankId: "58", chequeLotId: 1, chequeNo: "100002", chequeDate: "2026-09-21" });
  });

  it("changing the bank drops the previously chosen lot and leaf", async () => {
    render(<Harness initial={{ ...emptySettlement(), mode: "Cheque", bankId: "58", chequeLotId: 1, chequeNo: "100002" }} />);
    await screen.findByLabelText("Cheque lot");
    fireEvent.change(screen.getByLabelText("Bank account"), { target: { value: "59" } });
    expect(state()).toMatchObject({ bankId: "59", chequeLotId: null, chequeNo: "" });
  });

  it("keeps a voucher's own already-claimed leaf selectable when editing", async () => {
    render(<Harness initial={{ ...emptySettlement(), mode: "Cheque", bankId: "58", chequeLotId: 1, chequeNo: "100001" }} />);
    const num = await screen.findByLabelText("Cheque number");
    await waitFor(() => expect(num).toHaveTextContent("# 100002"));
    expect(num).toHaveValue("100001");
  });

  it("switching between bank-based modes keeps the bank; switching to Cash drops it", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "NEFT" }));
    fireEvent.change(screen.getByLabelText("Bank account"), { target: { value: "58" } });
    fireEvent.click(screen.getByRole("button", { name: "RTGS" }));
    expect(state().bankId).toBe("58");
    fireEvent.click(screen.getByRole("button", { name: "Cash" }));
    expect(state().bankId).toBe("");
  });

  it("explains what to do when there is no company or no bank", () => {
    const { rerender } = render(<Harness companySelected={false} list={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Cheque" }));
    expect(screen.getByText(/Select the company first/i)).toBeInTheDocument();
    rerender(<Harness companySelected list={[]} />);
    expect(screen.getByText(/Select the company first|No bank accounts/i)).toBeInTheDocument();
  });

  it("warns when the lot has no free cheques", async () => {
    api.fetchChequeNumbers.mockResolvedValue([{ number: "100001", used: true, bounced: false }]);
    render(<Harness initial={{ ...emptySettlement(), mode: "Cheque", bankId: "58", chequeLotId: 1 }} />);
    expect(await screen.findByText(/No available cheques left/i)).toBeInTheDocument();
  });
});
