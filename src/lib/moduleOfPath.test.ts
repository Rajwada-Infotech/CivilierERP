import { describe, expect, it } from "vitest";
import { moduleOfPath } from "./moduleOfPath";

describe("moduleOfPath", () => {
  it("maps module pages to their module", () => {
    expect(moduleOfPath("/finance/payment")).toBe("finance");
    expect(moduleOfPath("/material/grn")).toBe("material");
    expect(moduleOfPath("/engineering")).toBe("engineering");
    expect(moduleOfPath("/crm/booking")).toBe("crm");
    expect(moduleOfPath("/civilworkdpr/work-allocation")).toBe("civilworkdpr");
    expect(moduleOfPath("/fixed-asset/record")).toBe("fixedasset");
    expect(moduleOfPath("/followup")).toBe("followup");
    expect(moduleOfPath("/ticket")).toBe("ticket");
  });

  it("keeps Sales and Sales Automation apart", () => {
    expect(moduleOfPath("/sales/sale-order")).toBe("sales");
    expect(moduleOfPath("/sales-automation/leads")).toBe("salesAutomation");
  });

  it("ignores everything else, including look-alike prefixes", () => {
    expect(moduleOfPath("/")).toBeNull();
    expect(moduleOfPath("/admin/widgets-rights")).toBeNull();
    expect(moduleOfPath("/crm-client-portal/overview")).toBeNull();
    expect(moduleOfPath("/materials-extra")).toBeNull();
  });
});
