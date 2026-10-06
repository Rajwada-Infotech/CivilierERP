// Material Request document — maps a Material Request record onto the shared
// letterhead layout (letterheadDocument.ts) for Print and Generate PDF. Used by
// the Material Request page and the Approval Inbox popup.
import {
  fmtDocDate,
  loadCompanyLetterhead,
  printLetterhead,
  downloadLetterheadPdf,
  type LetterheadCompany,
  type LetterheadDoc,
} from "@/utils/letterheadDocument";

export interface MRDocItem {
  name: string;
  qty: number | string;
  uom: string;
  remarks?: string | null;
}

export interface MRDocData {
  docNo: string;
  status?: string | null;
  priority?: string | null;
  requestDate?: string | null;
  requiredByDate?: string | null;
  finYear?: string | null;
  projectName?: string | null;
  reason?: string | null;
  remarks?: string | null;
  createdBy?: string | null;
  company: LetterheadCompany;
  items: MRDocItem[];
}

const fmtQty = (q: number | string) => {
  const n = Number(q);
  return Number.isFinite(n) ? n.toLocaleString("en-IN", { maximumFractionDigits: 3 }) : String(q ?? "");
};

/** Company letterhead details for the MR's company. */
export const loadMRCompany = loadCompanyLetterhead;

/** Builds MRDocData from a full GET /material-requests/:id record. */
export function mrDocFromRecord(rec: any, company: LetterheadCompany): MRDocData {
  return {
    docNo: rec.DocNo || `MR-${rec.MRId ?? ""}`,
    status: rec.Status,
    priority: rec.Priority || "Normal",
    requestDate: rec.RequestDate,
    requiredByDate: rec.RequiredByDate,
    finYear: rec.FinYearName,
    projectName: rec.ProjectName,
    reason: rec.Reason,
    remarks: rec.Remarks,
    createdBy: rec.CreatedByName ?? rec.CreatedBy,
    company: { ...company, name: company.name || rec.CompanyName || "CivilierERP" },
    items: (Array.isArray(rec.items) ? rec.items : []).map((it: any) => ({
      name: it.ItemName || it.ItemId || "—",
      qty: it.Quantity ?? 0,
      uom: it.UOMName || it.UOMSymbol || it.UOMCode || "",
      remarks: it.Remarks || null,
    })),
  };
}

function toLetterhead(d: MRDocData): LetterheadDoc {
  return {
    title: "Material Request",
    docNo: d.docNo,
    date: fmtDocDate(d.requestDate),
    status: d.status,
    company: d.company,
    toBlocks: [
      {
        label: "Requested For :",
        lines: [d.projectName || "—", d.company.name, d.finYear ? `Financial Year ${d.finYear}` : ""],
      },
    ],
    columns: [
      { header: "Item Description" },
      { header: "Qty.", align: "right", widthMm: 24 },
      { header: "UOM", widthMm: 26 },
    ],
    rows: d.items.map((it) => ({ cells: [it.name, fmtQty(it.qty), it.uom || "—"], sub: it.remarks })),
    summary: [
      { label: "Total Items", value: String(d.items.length) },
      { label: "Priority", value: d.priority || "Normal" },
      { label: "Required By", value: fmtDocDate(d.requiredByDate), bold: true, rule: true },
    ],
    notes: [
      {
        title: "Notes",
        lines: [d.reason ? `Reason: ${d.reason}` : "", d.remarks ? `Remarks: ${d.remarks}` : ""].filter(Boolean),
      },
    ].filter((n) => n.lines.length > 0),
    signLabel: "Requested By",
    signName: d.createdBy,
    terms:
      "This is a system-generated material request from CivilierERP. Quantities are as requested and subject to approval, availability and the purchase terms agreed with the supplier.",
  };
}

export const printMaterialRequest = (d: MRDocData) => printLetterhead(toLetterhead(d));

export const downloadMaterialRequestPdf = (d: MRDocData, filename: string) =>
  downloadLetterheadPdf(toLetterhead(d), filename);
