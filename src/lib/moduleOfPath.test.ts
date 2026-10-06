import { describe, expect, it } from "vitest";
import { moduleOfPath } from "./moduleOfPath";

describe("moduleOfPath", () => {
  it("maps module pages to their module", () => {
    expect(moduleOfPath("/finance/payment")).toBe("Finance");
    expect(moduleOfPath("/material/grn")).toBe("Material");
    expect(moduleOfPath("/engineering")).toBe("Engineering");
    expect(moduleOfPath("/crm/booking")).toBe("CRM");
  });

  it("ignores everything else, including look-alike prefixes", () => {
    expect(moduleOfPath("/")).toBeNull();
    expect(moduleOfPath("/admin/widgets-rights")).toBeNull();
    expect(moduleOfPath("/crm-client-portal/overview")).toBeNull();
    expect(moduleOfPath("/materials-extra")).toBeNull();
  });
});
