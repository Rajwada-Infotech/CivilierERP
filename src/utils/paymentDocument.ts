// Payment Receipt document — maps a payment record (plus its company letterhead
// and invoice-chain summary, both already loaded by the Payment page) onto the
// shared letterhead layout (letterheadDocument.ts) for Print and Generate PDF.
//
// A receipt has no item list, so the ruled table carries the amount breakdown
// (what was paid, or each expense head), with the tax / TDS working in the
// summary and the mode / reference details in the notes.
import {
  printLetterhead,
  downloadLetterheadPdf,
  type LetterheadCompany,
  type LetterheadDoc,
  type LetterheadRow,
} from "@/utils/letterheadDocument";

const money = (n: number) =>
  `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function companyFrom(detail: any, fallbackName: string | null | undefined): LetterheadCompany {
  return {
    name: detail?.name || fallbackName || "CivilierERP",
    address: [detail?.address, detail?.address_line2, [detail?.city, detail?.state].filter(Boolean).join(", "), detail?.pincode]
      .filter(Boolean)
      .join(", "),
    phone: detail?.phone_number,
    email: detail?.email,
    gst: [detail?.gst_no, detail?.pan ? `PAN ${detail.pan}` : ""].filter(Boolean).join("  ·  ") || null,
    logo: detail?.logo,
  };
}

export function buildPaymentLetterhead(rec: any, companyDetail: any, chain: any): LetterheadDoc {
  const company = companyFrom(companyDetail, rec.company);
  const supplier = chain?.supplier ?? null;
  const docChain = chain?.chain ?? null;
  const amount = Number(rec.amount ?? 0);

  // ── amount breakdown rows
  const allocations: { label?: string | null; amount: number }[] = Array.isArray(rec.expenseHeadAllocations)
    ? rec.expenseHeadAllocations
    : [];
  const refs = [
    docChain?.vendorInvoiceNo
      ? `Invoice ${docChain.vendorInvoiceNo}${docChain.vendorInvoiceDate ? ` (${docChain.vendorInvoiceDate})` : ""}`
      : "",
    docChain?.poNo ? `PO ${docChain.poNo}` : "",
    docChain?.grnNo ? `GRN ${docChain.grnNo}` : "",
    docChain?.mrDocNo ? `MR ${docChain.mrDocNo}` : "",
    docChain?.expenseDocNo || rec.expenseRef ? `Expense ${docChain?.expenseDocNo || rec.expenseRef}` : "",
    rec.parentDocNo ? `Ref ${rec.parentDocNo}` : "",
  ].filter(Boolean);

  const rows: LetterheadRow[] =
    allocations.length > 0
      ? allocations.map((a) => ({ cells: [a.label ?? "Expense Head", money(a.amount)] }))
      : [{ cells: [rec.paymentName || "Payment", money(amount)], sub: refs.join("  ·  ") || null }];

  // ── tax / TDS working
  const base = rec.baseAmount ?? null;
  const cgst = rec.cgstRate ? (base * rec.cgstRate) / 100 : 0;
  const sgst = rec.sgstRate ? (base * rec.sgstRate) / 100 : 0;
  const igst = rec.igstRate ? (base * rec.igstRate) / 100 : 0;
  const hasTax = base != null && (rec.cgstRate || rec.sgstRate || rec.igstRate);
  const tds = Number(rec.tdsAmount || 0);

  const summary = [
    ...(hasTax
      ? [
          { label: "Taxable Amount", value: money(base) },
          ...(rec.cgstRate ? [{ label: `CGST (${rec.cgstRate}%)`, value: money(cgst) }] : []),
          ...(rec.sgstRate ? [{ label: `SGST (${rec.sgstRate}%)`, value: money(sgst) }] : []),
          ...(rec.igstRate ? [{ label: `IGST (${rec.igstRate}%)`, value: money(igst) }] : []),
        ]
      : []),
    { label: "Payment Amount", value: money(amount), bold: true, rule: true },
    ...(rec.tdsId
      ? [
          { label: `TDS Deducted${rec.tdsPercentage != null ? ` (${rec.tdsPercentage}%)` : ""}`, value: `- ${money(tds)}` },
          { label: "Net Payable", value: money(Math.max(0, amount - tds)), bold: true, rule: true },
        ]
      : []),
  ];

  // ── payment details (mode, bank, reference) for the notes block
  const reference = rec.chequeNo
    ? `Cheque #${rec.chequeNo}`
    : rec.neftNumber || rec.upiTransactionId || rec.rtgsReference || rec.impsReference || rec.cardReference || "";
  const details = [
    `Mode: ${rec.mode || "—"}`,
    rec.bankName ? `Bank: ${rec.bankName}` : "",
    reference ? `Reference / Txn ID: ${reference}` : "",
    rec.chequeDate ? `Cheque Date: ${rec.chequeDate}` : "",
    rec.chequeLotNumber ? `Cheque Lot: ${rec.chequeLotNumber}` : "",
    rec.cardDisplay ? `Card Used: ${rec.cardDisplay}` : "",
    rec.tdsId && (rec.tdsName || rec.tdsNature) ? `TDS: ${rec.tdsName || rec.tdsNature}` : "",
  ].filter(Boolean);

  return {
    title: "Payment Receipt",
    docNo: rec.docNo || rec.paymentName || "—",
    date: rec.date || "",
    status: rec.status,
    company,
    toBlocks: [
      {
        label: "Paid To :",
        lines: supplier
          ? [
              supplier.name || rec.paidTo || "—",
              supplier.address || "",
              [supplier.phone, supplier.email].filter(Boolean).join("  ·  "),
              [supplier.gst ? `GSTIN: ${supplier.gst}` : "", supplier.pan ? `PAN: ${supplier.pan}` : ""]
                .filter(Boolean)
                .join("  ·  "),
            ]
          : [rec.paidTo || "—"],
      },
      { label: "Project / Site :", lines: [rec.project || "—", rec.projectSite || ""] },
      { label: "Payment Mode :", lines: [rec.mode || "—"] },
    ],
    columns: [{ header: "Particulars" }, { header: "Amount", align: "right" as const, widthMm: 40 }],
    rows,
    summary,
    notes: [{ title: "Payment Details", lines: details }],
    signLabel: "Authorised Signatory",
    signName: `For ${company.name}`,
    terms: "This is a system-generated payment receipt from CivilierERP and does not require a physical signature.",
  };
}

export const printPayment = (rec: any, companyDetail: any, chain: any) =>
  printLetterhead(buildPaymentLetterhead(rec, companyDetail, chain));

export const downloadPaymentPdf = (rec: any, companyDetail: any, chain: any, filename?: string) =>
  downloadLetterheadPdf(
    buildPaymentLetterhead(rec, companyDetail, chain),
    filename ?? `${String(rec.docNo || rec.paymentName || "payment-receipt").replace(/[^\w-]+/g, "_")}.pdf`,
  );
