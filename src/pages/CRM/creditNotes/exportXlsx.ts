// The Excel for the GST return: a GSTR-1 summary sheet and every document in the period.
import { buildWorkbook, downloadBlob, type XlsxCell } from "@/lib/xlsxBook";
import { API, KIND, formatSac, getJson, kindOf } from "./config";

export async function exportCreditNotesXlsx(from: string, to: string, filters: { companyId?: string; projectId?: string; blockId?: string }) {
  const q = new URLSearchParams({ from, to });
  if (filters.companyId) q.set("companyId", filters.companyId);
  if (filters.projectId) q.set("projectId", filters.projectId);
  if (filters.blockId) q.set("blockId", filters.blockId);
  const dataForExport = await getJson(`${API}/gst-notes?${q.toString()}`);
  const exportRows: any[] = Array.isArray(dataForExport) ? dataForExport : dataForExport.rows || [];

  const live = exportRows.filter((n) => ["invoice", "advance"].includes(kindOf(n)));
  const split = (n: any) => {
    const same = n.IntraState !== false;
    const half = Math.round((Number(n.GstAmount) / 2) * 100) / 100;
    return same ? [half, Number(n.GstAmount) - half, 0] : [0, 0, Number(n.GstAmount)];
  };
  const H = (v: string): XlsxCell => ({ v, s: "header" });
  const detail: XlsxCell[][] = [
    ["Type", "No.", "Date", "Status", "Customer", "Buyer GSTIN", "Property", "Booking", "Against", "Against date",
      "HSN/SAC", "Rate %", "Taxable value", "CGST", "SGST", "IGST", "Total", "Declare by", "Refund", "Cancelled reason"].map(H),
    ...exportRows
      .filter((n) => kindOf(n) !== "request")
      .map((n) => {
        const [c, s, i] = split(n);
        return [
          KIND[kindOf(n)].label, n.DocNo || "", String(n.DocDate).slice(0, 10), n.Status, n.CustomerName || "", n.CustomerGst || "",
          n.Property, n.BookingNo, n.AgainstRef || "", n.AgainstDate ? String(n.AgainstDate).slice(0, 10) : "",
          formatSac(n.HsnCode), n.GstRate != null ? Number(n.GstRate) : "", Number(n.TaxableValue), c, s, i, Number(n.TotalAmount),
          n.DeadlineDate ? String(n.DeadlineDate).slice(0, 10) : "", n.RefundNo, n.CancelReason || "",
        ];
      }),
  ];
  const groups = new Map<string, number[]>();
  for (const n of live) {
    // GSTR-1: a registered buyer's credit note goes to CDNR (they see it in
    // their GSTR-2B), an individual's to CDNUR / B2C.
    const key = `${
      kindOf(n) === "invoice"
        ? n.CustomerGst
          ? "Credit notes — registered buyers (GSTR-1 CDNR)"
          : "Credit notes — unregistered buyers (GSTR-1 CDNUR / B2C)"
        : "Refund vouchers on advances (GSTR-1 advance adjustment)"
    }|${Number(n.GstRate || 0)}`;
    const g = groups.get(key) || [0, 0, 0, 0, 0, 0];
    const [c, s, i] = split(n);
    groups.set(key, [g[0] + 1, g[1] + Number(n.TaxableValue), g[2] + c, g[3] + s, g[4] + i, g[5] + Number(n.TotalAmount)]);
  }
  const summary: XlsxCell[][] = [
    [{ v: `Credit notes ${from} to ${to} — cancelled and past-deadline ones excluded`, s: "title" }],
    [],
    ["Where it goes", "Rate %", "Documents", "Taxable value", "CGST", "SGST", "IGST", "Total"].map(H),
    ...[...groups.entries()].map(([k, g]) => {
      const [where, rate] = k.split("|");
      return [where, Number(rate), g[0], ...g.slice(1).map((x) => Math.round(x * 100) / 100)];
    }),
  ];
  downloadBlob(
    await buildWorkbook([
      { name: "GSTR-1 summary", rows: summary, widths: [58, 8, 10, 16, 14, 14, 14, 16] },
      { name: "Credit notes", rows: detail, widths: [34, 16, 12, 11, 24, 17, 18, 16, 22, 12, 10, 8, 14, 12, 12, 12, 14, 12, 16, 30], freezeBelowRow: 2 },
    ]),
    `Credit-notes-${from}-to-${to}.xlsx`
  );
}
