import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { JournalVoucherLedgerOption } from "@/api/journalVoucherApi";
import { filterLedgerOptions, groupLedgerOptions } from "./ledgerGroups";
import { LedgerHeadPicker } from "./LedgerHeadPicker";

const o = (id: number, label: string, group: string, extra: Partial<JournalVoucherLedgerOption> = {}): JournalVoucherLedgerOption => ({
  id,
  label,
  group,
  code: null,
  type: "GL",
  accountNoLast4: null,
  ...extra,
});

const options = [
  o(1, "Rahul", "customer", { code: "CRMCUST-1" }),
  o(2, "Rahul", "customer", { code: "CRMCUST-2" }),
  o(3, "Amit Kumar", "partner", { code: "BA-CAP" }),
  o(4, "Sunrise Estates", "landlord"),
  o(5, "Bengal Cement", "supplier"),
  o(6, "Cash-in-Hand A/c", "cash", { code: "CASH-IN-HAND" }),
  o(7, "Axis Bank", "bank", { accountNoLast4: "4321" }),
  o(8, "ROYAL GARDEN (RAJWADA GROUP)", "project", { code: "PRJ-3-CUST" }),
  o(9, "Acme Vendor", "vendor"),
];

describe("groupLedgerOptions", () => {
  it("labels partners as Partners and keeps landlords out of Supplier", () => {
    const groups = groupLedgerOptions(options);
    const byLabel = Object.fromEntries(groups.map((g) => [g.label, g.options.map((x) => x.label)]));
    expect(byLabel["Partners"]).toEqual(["Amit Kumar"]);
    expect(byLabel["Landlord"]).toEqual(["Sunrise Estates"]);
    expect(byLabel["Supplier"]).toEqual(["Bengal Cement"]);
    expect(byLabel["Cash"]).toEqual(["Cash-in-Hand A/c"]);
    expect(byLabel["Project Ledgers"]).toEqual(["ROYAL GARDEN (RAJWADA GROUP)"]);
  });

  it("uses a fixed group order and drops empty groups", () => {
    const labels = groupLedgerOptions(options).map((g) => g.label);
    expect(labels).toEqual(["Bank", "Cash", "Customer", "Supplier", "Landlord", "Vendor", "Partners", "Project Ledgers"]);
  });

  it("sorts names A→Z within a group, ignoring case", () => {
    const g = groupLedgerOptions([o(1, "zeta", "customer"), o(2, "Alpha", "customer"), o(3, "beta", "customer")]);
    expect(g[0].options.map((x) => x.label)).toEqual(["Alpha", "beta", "zeta"]);
  });

  it("puts unknown groups under Other instead of dropping them", () => {
    expect(groupLedgerOptions([o(1, "Mystery", "made-up")])[0].label).toBe("Other");
  });
});

describe("filterLedgerOptions", () => {
  it("returns everything for an empty query", () => {
    expect(filterLedgerOptions(options, "  ")).toHaveLength(options.length);
  });
  it("matches by name, code, account tail and group name", () => {
    expect(filterLedgerOptions(options, "cement").map((x) => x.id)).toEqual([5]);
    expect(filterLedgerOptions(options, "ba-cap").map((x) => x.id)).toEqual([3]);
    expect(filterLedgerOptions(options, "4321").map((x) => x.id)).toEqual([7]);
    expect(filterLedgerOptions(options, "landlord").map((x) => x.id)).toEqual([4]);
  });
  it("requires every word to match", () => {
    expect(filterLedgerOptions(options, "rahul crmcust-2").map((x) => x.id)).toEqual([2]);
    expect(filterLedgerOptions(options, "rahul zzz")).toEqual([]);
  });
});

describe("LedgerHeadPicker", () => {
  beforeAll(() => {
    globalThis.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    Element.prototype.scrollIntoView ??= () => {};
  });
  afterEach(cleanup);

  it("searches, shows group headings, and returns the chosen id", () => {
    const onChange = vi.fn();
    render(<LedgerHeadPicker value={null} options={options} onChange={onChange} />);
    fireEvent.click(screen.getByRole("combobox"));
    expect(screen.getByText("Partners")).toBeInTheDocument();
    expect(screen.getByText("Landlord")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/search account heads/i), { target: { value: "sunrise" } });
    expect(screen.queryByText("Bengal Cement")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Sunrise Estates"));
    expect(onChange).toHaveBeenCalledWith(4);
  });

  it("tells same-named heads apart by code", () => {
    render(<LedgerHeadPicker value={null} options={options} onChange={() => {}} />);
    fireEvent.click(screen.getByRole("combobox"));
    expect(screen.getByText("CRMCUST-1")).toBeInTheDocument();
    expect(screen.getByText("CRMCUST-2")).toBeInTheDocument();
    expect(screen.getByText("•••4321")).toBeInTheDocument();
  });

  it("shows an empty message when nothing matches", () => {
    render(<LedgerHeadPicker value={null} options={options} onChange={() => {}} />);
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.change(screen.getByPlaceholderText(/search account heads/i), { target: { value: "zzzz" } });
    expect(screen.getByText(/No account head matches/)).toBeInTheDocument();
  });

  it("shows the selected head's name on the trigger", () => {
    render(<LedgerHeadPicker value={3} options={options} onChange={() => {}} />);
    expect(screen.getByRole("combobox")).toHaveTextContent("Amit Kumar");
  });
});
