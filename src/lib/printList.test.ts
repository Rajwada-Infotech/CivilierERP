import { afterEach, describe, expect, it, vi } from "vitest";
import { printList } from "./printList";

vi.mock("sonner", () => ({ toast: { info: vi.fn(), error: vi.fn() } }));

// printList writes a standalone HTML page into a Blob and opens it; capture that page.
const capture = () => {
  let blob: Blob | null = null;
  vi.stubGlobal("URL", { createObjectURL: (b: Blob) => ((blob = b), "blob:x"), revokeObjectURL: () => {} });
  const win = { focus: vi.fn(), print: vi.fn(), onload: null as null | (() => void) };
  const open = vi.spyOn(window, "open").mockReturnValue(win as unknown as Window);
  return { html: async () => (blob ? await blob.text() : ""), open, win };
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("printList", () => {
  const columns = [
    { header: "WO No", accessor: "DocNo" },
    { header: "Total Amount", accessor: (r: Record<string, unknown>) => Number(r.Amount) },
  ];

  it("prints every row with a numbered first column, the filters and the record count", async () => {
    const c = capture();
    printList({ title: "Work Orders", subtitle: "Status: approved", columns, rows: [{ DocNo: "WO/1", Amount: 1500 }, { DocNo: "WO/2", Amount: 20 }], numeric: ["Total Amount"] });
    const html = await c.html();
    expect(c.open).toHaveBeenCalled();
    expect(html).toContain("<title>Work Orders</title>");
    expect(html).toContain("Status: approved");
    expect(html).toContain("2 records");
    expect(html).toContain("WO/1");
    expect(html).toContain('<td style="text-align:right">1500</td>');
    c.win.onload?.();
    expect(c.win.print).toHaveBeenCalled();
  });

  it("escapes what it prints", async () => {
    const c = capture();
    printList({ title: "List", columns, rows: [{ DocNo: "<script>x</script>", Amount: 1 }] });
    const html = await c.html();
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("opens nothing for an empty list", () => {
    const c = capture();
    printList({ title: "List", columns, rows: [] });
    expect(c.open).not.toHaveBeenCalled();
  });
});
