// Goods Receipt Note document — maps a full GRN record (GET /grns/:id, with the
// GRNItems JSON) onto the shared letterhead layout (letterheadDocument.ts) for
// Print and Generate PDF. Used by the GRN page and the Approval Inbox popup.
import { parseJsonArray } from "@/utils/parseJsonArray";
import {
  fmtDocDate,
  printLetterhead,
  downloadLetterheadPdf,
  type LetterheadCompany,
  type LetterheadDoc,
} from "@/utils/letterheadDocument";
import { loadLetterheadContext, type POSupplier } from "@/utils/purchaseOrderDocument";

const money = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const qtyText = (q: unknown, uom: unknown) =>
  `${Number(q ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 3 })}${uom ? ` ${uom}` : ""}`;

/** The number shown on the document: the issued DocNo, else the legacy GRN-prefixed GRNNo. */
export const grnDisplayNo = (grn: any): string =>
  grn.DocNo || (grn.GRNNo ? (String(grn.GRNNo).startsWith("GRN-") ? grn.GRNNo : `GRN-${grn.GRNNo}`) : "—");

export function buildGrnLetterhead(grn: any, company: LetterheadCompany, supplier: POSupplier): LetterheadDoc {
  // Only lines actually received — a GRN raised from "remaining items" can be
  // saved with some lines still at 0, and those aren't part of this receipt.
  const raw = Array.isArray(grn.GRNItems) ? grn.GRNItems : parseJsonArray<any>(grn.GRNItems);
  const items = raw.filter((i: any) => Number(i.receivedQty) > 0);
  const subtotal = items.reduce((s: number, i: any) => s + (Number(i.totalAmount) || 0), 0);
  const gst = items.reduce((s: number, i: any) => s + (Number(i.gstAmount) || 0), 0);

  const vehicle = [grn.VehicleInOutDocNo, grn.VehicleInOutVehicleNo].filter(Boolean).join(" · ");
  const remarks = String(grn.Remarks ?? "").trim();

  return {
    title: "Goods Receipt Note",
    docNo: grnDisplayNo(grn),
    date: fmtDocDate(grn.GRNDate ?? grn.DocDate),
    status: grn.Status,
    company,
    toBlocks: [
      {
        label: "Received From :",
        lines: [
          grn.SupplierName || "—",
          supplier.address || "",
          supplier.contact ? `Contact: ${supplier.contact}` : "",
          supplier.gst ? `GSTIN: ${supplier.gst}` : "",
        ],
      },
      { label: "Purchase Order :", lines: [grn.PONumber || "—"] },
      { label: "Project / Site :", lines: [grn.ProjectName || "—"] },
      ...(vehicle ? [{ label: "Vehicle In/Out :", lines: [vehicle] }] : []),
    ],
    columns: [
      { header: "Item Description" },
      { header: "Ordered", align: "right" as const, widthMm: 24 },
      { header: "Received", align: "right" as const, widthMm: 26 },
      { header: "Amount", align: "right" as const, widthMm: 27 },
    ],
    rows: items.map((it: any) => ({
      cells: [
        it.itemName || "—",
        qtyText(it.orderedQty, it.uom),
        qtyText(it.receivedQty, it.uom),
        money(Number(it.totalAmount || 0)),
      ],
      sub:
        [`Rate ${money(Number(it.rate || 0))}`, Number(it.gstPct) > 0 ? `GST ${it.gstPct}%` : ""]
          .filter(Boolean)
          .join("  ·  ") || null,
    })),
    summary: [
      { label: "Subtotal (excl. GST)", value: money(subtotal) },
      ...(gst > 0 ? [{ label: "GST", value: money(gst) }] : []),
      { label: "Grand Total", value: money(subtotal + gst), bold: true, rule: true },
    ],
    notes: remarks ? [{ title: "Remarks", lines: [remarks] }] : [],
    signLabel: "Received By",
    signName: grn.CreatedByName ?? grn.CreatedBy ?? null,
    terms:
      "This is a system-generated goods receipt note from CivilierERP. Quantities are as received at the store, subject to quality inspection and the terms of the referenced purchase order.",
  };
}

export async function printGrn(grn: any) {
  const { company, supplier } = await loadLetterheadContext(grn);
  printLetterhead(buildGrnLetterhead(grn, company, supplier));
}

export async function downloadGrnPdf(grn: any, filename?: string) {
  const { company, supplier } = await loadLetterheadContext(grn);
  await downloadLetterheadPdf(
    buildGrnLetterhead(grn, company, supplier),
    filename ?? `${grnDisplayNo(grn).replace(/[^\w-]+/g, "_")}.pdf`,
  );
}
