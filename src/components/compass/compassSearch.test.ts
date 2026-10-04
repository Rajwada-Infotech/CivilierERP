import { describe, expect, it } from "vitest";
import type { CompassEntry } from "./compassRegistry";
import { groupByModule, searchEntries } from "./compassSearch";

const e = (
  label: string,
  moduleId: string,
  module: string,
  extra: Partial<CompassEntry> = {},
): CompassEntry => ({
  route: `/${moduleId}/${label.toLowerCase().replace(/\W+/g, "-")}`,
  label,
  moduleId,
  module,
  keywords: [],
  ...extra,
});

const entries: CompassEntry[] = [
  e("Invoice", "finance", "Finance", { keywords: ["expense booking", "bill"] }),
  e("Invoices", "crm", "CRM", { group: "Finance" }),
  e("Sale Invoice", "sales", "Sales"),
  e("BRS", "finance", "Finance", { keywords: ["bank reconciliation"] }),
  e("Purchase Order", "material", "Material", { keywords: ["po"] }),
  e("Purchase Order Amendment", "material", "Material", { group: "Amendment" }),
  e("Customer Master", "sales", "Sales", { group: "Setup", keywords: ["debtor"] }),
];

const labels = (q: string) => searchEntries(entries, q).map((x) => x.label);

describe("searchEntries", () => {
  it("returns nothing for an empty or whitespace query", () => {
    expect(searchEntries(entries, "")).toEqual([]);
    expect(searchEntries(entries, "   ")).toEqual([]);
  });

  it("ranks exact label over prefix over word-prefix over substring", () => {
    expect(labels("invoice")[0]).toBe("Invoice"); // exact
    expect(labels("invoice").indexOf("Invoices")).toBeLessThan(labels("invoice").indexOf("Sale Invoice"));
  });

  it("matches aliases the label doesn't contain", () => {
    expect(labels("reconciliation")).toEqual(["BRS"]);
    expect(labels("expense booking")).toContain("Invoice");
    expect(labels("po")[0]).toBe("Purchase Order");
  });

  it("requires every token to match (AND), letting module names narrow results", () => {
    const r = labels("finance invoice");
    expect(r).toContain("Invoice");
    expect(r).not.toContain("Sale Invoice"); // Sales module, no "finance" anywhere
  });

  it("is case-insensitive", () => {
    expect(labels("PURCHASE order")[0]).toBe("Purchase Order");
  });

  it("tolerates abbreviations via subsequence, but only for 3+ char tokens", () => {
    expect(labels("prchs")).toContain("Purchase Order");
    expect(labels("pq")).toEqual([]);
  });

  it("returns [] when nothing matches", () => {
    expect(labels("zzzzqqq")).toEqual([]);
  });

  it("respects the limit", () => {
    expect(searchEntries(entries, "e", 2)).toHaveLength(2);
  });

  it("breaks score ties by shorter label", () => {
    const r = labels("purchase order");
    expect(r[0]).toBe("Purchase Order");
    expect(r[1]).toBe("Purchase Order Amendment");
  });
});

describe("groupByModule", () => {
  it("groups by module, ordered by each group's best hit", () => {
    const groups = groupByModule(searchEntries(entries, "invoice"));
    expect(groups[0].moduleId).toBe("finance"); // exact "Invoice" ranks first
    expect(groups.map((g) => g.moduleId)).toEqual([...new Set(groups.map((g) => g.moduleId))]);
    expect(groups.find((g) => g.moduleId === "sales")?.entries[0].label).toBe("Sale Invoice");
  });
});
