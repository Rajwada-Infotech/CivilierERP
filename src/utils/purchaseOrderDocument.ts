// Purchase Order document — maps a full PO record (GET /purchase-orders/:id,
// with LineItems) onto the shared letterhead layout (letterheadDocument.ts) for
// Print and Generate PDF. Used by the Purchase Order page and the Approval
// Inbox popup, which both hand in the record and let this fetch the company
// and supplier letterhead details.
import {
  fmtDocDate,
  loadCompanyLetterhead,
  printLetterhead,
  downloadLetterheadPdf,
  type LetterheadCompany,
  type LetterheadDoc,
} from "@/utils/letterheadDocument";

export interface POSupplier {
  address?: string | null;
  contact?: string | null;
  phone?: string | null;
  email?: string | null;
  gst?: string | null;
}

const money = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function buildPurchaseOrderLetterhead(po: any, company: LetterheadCompany, supplier: POSupplier): LetterheadDoc {
  const supplierName = po.SupplierName ?? po.supplierName ?? "—";
  const projectName = po.ProjectName ?? po.projectName ?? "—";
  const poNumber = po.PurchaseOrderNo ?? po.poNumber ?? po.DocNo ?? "—";
  const items: any[] = Array.isArray(po.LineItems) ? po.LineItems : Array.isArray(po.POItems) ? po.POItems : [];

  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  let subtotal = 0;
  const rows = items.map((li) => {
    const qty = Number(li.Quantity ?? li.quantity ?? 0);
    const rate = Number(li.Rate ?? li.rate ?? 0);
    const tax = Number(li.TaxPct ?? li.gstRate ?? li.tax ?? 0);
    const base = qty * rate;
    subtotal += base;
    cgst += (base * Number(li.CgstRate ?? li.cgstRate ?? 0)) / 100;
    sgst += (base * Number(li.SgstRate ?? li.sgstRate ?? 0)) / 100;
    igst += (base * Number(li.IgstRate ?? li.igstRate ?? 0)) / 100;
    const name = li.ItemName ?? li.itemName ?? li.Description ?? "—";
    const desc = li.itemDescription ?? li.Description ?? "";
    const unit = li.UomName ?? li.UOMSymbol ?? li.unit ?? "";
    return {
      cells: [
        name,
        `${qty.toLocaleString("en-IN", { maximumFractionDigits: 3 })}${unit ? ` ${unit}` : ""}`,
        money(rate),
        money(Number(li.LineAmount ?? li.amount ?? base)),
      ],
      sub: [desc && desc !== name ? desc : "", tax > 0 ? `GST ${tax}%` : ""].filter(Boolean).join("  ·  ") || null,
    };
  });

  const grandTotal = Number(po.TotalAmount ?? po.totalAmount ?? 0);
  const expected = po.ExpectedDeliveryDate ? fmtDocDate(po.ExpectedDeliveryDate) : "";
  const payTerms = String(po.PaymentTerms ?? po.paymentTerms ?? "").trim();
  const payTermLine = po.PaymentTermDescription
    ? `${po.PaymentTermDescription}${po.PaymentTermDays != null ? ` (${po.PaymentTermDays} days)` : ""}`
    : "";
  const remarks = String(po.Remarks ?? po.remarks ?? "").trim();

  return {
    title: "Purchase Order",
    docNo: String(poNumber),
    date: fmtDocDate(po.PODate ?? po.poDate),
    status: po.Status ?? po.status ?? "Draft",
    company,
    toBlocks: [
      {
        label: "Order To :",
        lines: [
          supplierName,
          supplier.address || "",
          supplier.contact ? `Contact: ${supplier.contact}` : "",
          supplier.phone ? `Phone: ${supplier.phone}` : "",
          supplier.email || "",
          supplier.gst ? `GSTIN: ${supplier.gst}` : "",
        ],
      },
      { label: "Project / Site :", lines: [projectName] },
      ...(expected ? [{ label: "Expected Delivery :", lines: [expected] }] : []),
    ],
    columns: [
      { header: "Item Description" },
      { header: "Qty.", align: "right" as const, widthMm: 28 },
      { header: "Rate", align: "right" as const, widthMm: 25 },
      { header: "Amount", align: "right" as const, widthMm: 27 },
    ],
    rows,
    summary: [
      { label: "Subtotal (excl. GST)", value: money(subtotal) },
      ...(cgst > 0 ? [{ label: "CGST", value: money(cgst) }] : []),
      ...(sgst > 0 ? [{ label: "SGST", value: money(sgst) }] : []),
      ...(igst > 0 ? [{ label: "IGST", value: money(igst) }] : []),
      { label: "Grand Total", value: money(grandTotal), bold: true, rule: true },
    ],
    notes: [
      ...(payTermLine ? [{ title: "Payment Terms", lines: [payTermLine] }] : []),
      ...(remarks ? [{ title: "Remarks", lines: [remarks] }] : []),
    ],
    signLabel: "Authorised Signatory",
    signName: `For ${company.name}`,
    terms:
      payTerms ||
      "Goods are to be supplied as per the quantities, rates and delivery date above. Subject to inspection and approval on receipt; the order number must appear on all challans and invoices.",
  };
}

/** Fetches the company + supplier letterhead details a document record needs
 *  (also used by the GRN document, whose record carries the same ids). */
export async function loadLetterheadContext(po: any): Promise<{ company: LetterheadCompany; supplier: POSupplier }> {
  const companyId = po.CompanyID ?? po.CompanyId ?? po.companyId;
  const supplierId = po.SupplierID ?? po.SupplierId ?? po.supplierId;
  const [company, supplier] = await Promise.all([
    loadCompanyLetterhead(companyId, po.CompanyName ?? po.companyName),
    (async (): Promise<POSupplier> => {
      if (!supplierId) return {};
      try {
        const { getSupplierDetails } = await import("@/api/purchaseOrdersApi");
        const s = await getSupplierDetails(supplierId);
        return s
          ? { address: s.LHeadAddress, contact: s.LHeadContactPerson, phone: s.LHeadPhone, email: s.LHeadEmail, gst: s.LGST }
          : {};
      } catch {
        return {};
      }
    })(),
  ]);
  return { company, supplier };
}

export async function printPurchaseOrder(po: any) {
  const { company, supplier } = await loadLetterheadContext(po);
  printLetterhead(buildPurchaseOrderLetterhead(po, company, supplier));
}

export async function downloadPurchaseOrderPdf(po: any, filename: string) {
  const { company, supplier } = await loadLetterheadContext(po);
  await downloadLetterheadPdf(buildPurchaseOrderLetterhead(po, company, supplier), filename);
}
