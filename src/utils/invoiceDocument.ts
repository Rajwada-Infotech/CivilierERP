// Invoice (Expense Booking) document — maps a booking record onto the shared
// letterhead layout (letterheadDocument.ts) for Print and Generate PDF.
//
// The amounts are NOT re-derived here: the preview modal already works out the
// GST split, billing terms / discount, net, TDS and balance (GRN-linked
// bookings use a live GRN calculation, the rest use computeBreakdown) and
// passes those figures in, so the printed invoice always shows exactly what the
// reviewer sees on screen.
import {
  fmtDocDate,
  printLetterhead,
  downloadLetterheadPdf,
  type LetterheadDoc,
  type LetterheadCompany,
  type LetterheadRow,
} from "@/utils/letterheadDocument";
import { loadLetterheadContext } from "@/utils/purchaseOrderDocument";

export interface InvoiceItemRow {
  name: string;
  qty: string;
  amount: number;
  sub?: string | null;
}

export interface InvoiceFigures {
  /** Line rows (GRN items, direct items, expense heads, or one lump row). */
  items: InvoiceItemRow[];
  basic: number;
  /** One entry per GST component that applies, e.g. {label:"CGST (9%)", amount}. */
  gst: { label: string; amount: number }[];
  /** Stored/derived net amount (after billing terms, discount and GST). */
  net: number;
  tds: number;
  tdsPercentage?: number | null;
  payable: number;
  paid: number;
  remaining: number;
}

const money = (n: number) =>
  `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function buildInvoiceLetterhead(
  rec: any,
  fig: InvoiceFigures,
  company: LetterheadCompany,
  supplier: { address?: string | null; contact?: string | null; gst?: string | null },
): LetterheadDoc {
  const gstTotal = fig.gst.reduce((s, g) => s + g.amount, 0);
  // Billing terms / discount sit between the basic amount and the net — show the
  // difference as one line so the summary always adds up.
  const adjustment = Math.round((fig.net - (fig.basic + gstTotal)) * 100) / 100;

  const source =
    rec.eSourceType === "TOD"
      ? "Direct Entry"
      : rec.sourceDocNo ||
        (rec.purchaseOrderId ? `PO-${rec.purchaseOrderId}` : null) ||
        (rec.workOrderId ? `WO-${rec.workOrderId}` : null) ||
        "";
  const linked = [
    rec.linkedPODocNo ? `PO ${rec.linkedPODocNo}` : "",
    rec.workDoneRef ? `Work Done ${rec.workDoneRef}` : "",
    ...(Array.isArray(rec.linkedGrnDocNos) ? rec.linkedGrnDocNos.map((g: string) => `GRN ${g}`) : []),
  ].filter(Boolean);
  const remarks = String(rec.remarks ?? "").trim();

  const rows: LetterheadRow[] = fig.items.map((it) => ({
    cells: [it.name, it.qty, money(it.amount)],
    sub: it.sub ?? null,
  }));

  return {
    title: "Invoice",
    docNo: rec.bookingReference || rec.bookingName || "—",
    date: fmtDocDate(rec.bookingDate),
    status: rec.status,
    company,
    toBlocks: [
      {
        label: "Billed From :",
        lines: [
          rec.supplier || "—",
          supplier.address || "",
          supplier.contact ? `Contact: ${supplier.contact}` : "",
          supplier.gst ? `GSTIN: ${supplier.gst}` : "",
          rec.vendorInvoiceNo
            ? `Vendor Invoice: ${rec.vendorInvoiceNo}${rec.vendorInvoiceDate ? ` (${fmtDocDate(rec.vendorInvoiceDate)})` : ""}`
            : "",
        ],
      },
      { label: "Project / Site :", lines: [rec.projectName || rec.projectSite || "—"] },
      ...(source || rec.docTypeName
        ? [{ label: "Source Document :", lines: [source || "—", rec.docTypeName || rec.materialCategory || ""] }]
        : []),
      ...(rec.dueDate ? [{ label: "Due Date :", lines: [fmtDocDate(rec.dueDate)] }] : []),
    ],
    columns: [
      { header: "Item Description" },
      { header: "Qty.", align: "right" as const, widthMm: 28 },
      { header: "Amount", align: "right" as const, widthMm: 30 },
    ],
    rows,
    summary: [
      { label: "Basic Amount", value: money(fig.basic) },
      ...fig.gst.map((g) => ({ label: g.label, value: money(g.amount) })),
      ...(Math.abs(adjustment) > 0.5
        ? [{ label: "Billing Terms / Discount", value: `${adjustment < 0 ? "- " : ""}${money(Math.abs(adjustment))}` }]
        : []),
      { label: "Net Amount", value: money(fig.net), bold: true, rule: true },
      ...(fig.tds > 0
        ? [
            { label: `TDS Deducted${fig.tdsPercentage != null ? ` (${fig.tdsPercentage}%)` : ""}`, value: `- ${money(fig.tds)}` },
            { label: "Payable After TDS", value: money(fig.payable), bold: true, rule: true },
          ]
        : []),
      ...(fig.paid > 0 ? [{ label: "Total Paid", value: money(fig.paid) }] : []),
      ...(fig.remaining > 0 ? [{ label: "Remaining", value: money(fig.remaining), bold: true }] : []),
    ],
    notes: [
      {
        title: "Bill Status",
        lines: [rec.billStatus ? `Status: ${rec.billStatus}` : "", ...(linked.length ? [`Linked: ${linked.join(" · ")}`] : [])].filter(Boolean),
      },
      ...(remarks ? [{ title: "Remarks", lines: [remarks] }] : []),
    ].filter((n) => n.lines.length > 0),
    signLabel: "Authorised Signatory",
    signName: `For ${company.name}`,
    terms:
      String(rec.tcText ?? "").trim() ||
      "This is a system-generated invoice from CivilierERP. Amounts are as booked and subject to the approval workflow and the payment terms agreed with the supplier.",
  };
}

async function context(rec: any) {
  return loadLetterheadContext({
    CompanyID: rec.companyId,
    CompanyName: rec.companyName,
    SupplierID: rec.supplierLHeadId,
  });
}

export async function printInvoice(rec: any, fig: InvoiceFigures) {
  const { company, supplier } = await context(rec);
  printLetterhead(buildInvoiceLetterhead(rec, fig, company, supplier));
}

export async function downloadInvoicePdf(rec: any, fig: InvoiceFigures, filename?: string) {
  const { company, supplier } = await context(rec);
  await downloadLetterheadPdf(
    buildInvoiceLetterhead(rec, fig, company, supplier),
    filename ?? `${String(rec.bookingReference || "invoice").replace(/[^\w-]+/g, "_")}.pdf`,
  );
}
