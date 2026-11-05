// FA Maintenance & Repair: form shape, the posting preview, status marks and the printed voucher.
import { toast } from "sonner";
import { escapeHtml } from "@/utils/escapeHtml";
import {
  REPAIR_EXPENSE_LABEL,
  type MaintenanceItem,
  type PostingPlan,
  type RepairExpenseType,
} from "@/api/fixedAssetMaintenanceApi";

/** Query keys refreshed after any change (list and every record's own detail share the prefix). */
export const MAINT_REFRESH = ["fa-maintenance", "fixed-asset-dashboard"];

export interface FormState {
  companyId: string;
  projectId: string;
  docNo: string;
  docDate: string;
  itemName: string; // Item Selection
  assetId: string; // FA Item Code
  remarks: string;
  vendorId: string;
  repairExpenseType: RepairExpenseType | "";
  amount: string;
}

export const emptyForm = (): FormState => ({
  companyId: "", projectId: "", docNo: "", docDate: new Date().toISOString().slice(0, 10),
  itemName: "", assetId: "", remarks: "", vendorId: "", repairExpenseType: "", amount: "",
});

export const round2 = (n: number) => Math.round(n * 100) / 100;

export const fmtAmt = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

/** Status as a sheet mark: posted is settled, a draft is still in progress, cancelled shows a dash. */
export const maintTone = (s: MaintenanceItem["Status"]) =>
  (s === "Posted" ? "done" : s === "Draft" ? "waiting" : "none") as "done" | "waiting" | "none";

// Local preview mirrors the backend posting rule exactly:
//   Dr Direct/Indirect Repair Expense A/c            taxable
//   Dr GST Credit Available (Input GST)              GST
//   Cr Vendor                                        taxable + GST
export function localPostingPreview(
  f: FormState,
  vendorLabel: string,
  sac: { code: string | null; ratePct: number | null; desc: string | null },
): PostingPlan | null {
  const taxable = Number(f.amount);
  if (!f.repairExpenseType || !f.vendorId || !Number.isFinite(taxable) || taxable <= 0) return null;

  if (!sac.code) {
    return {
      voucherNo: f.docNo || "Auto-generated on save", isPosted: false, entries: [],
      error: "SAC Code is not configured for the selected FA Item Code. Set it on the Fixed Asset Depreciation Tag.",
    };
  }
  if (sac.ratePct == null) {
    return {
      voucherNo: f.docNo || "Auto-generated on save", isPosted: false, entries: [],
      error: `Applicable GST rate is not configured for SAC Code "${sac.code}" in the HSN master.`,
    };
  }

  const expenseAcct = f.repairExpenseType === "Direct" ? "Direct Repair Expense A/c" : "Indirect Repair Expense A/c";
  const gstAmount = round2((taxable * sac.ratePct) / 100);
  const total = round2(taxable + gstAmount);

  return {
    voucherNo: f.docNo || "Auto-generated on save",
    isPosted: false,
    gst: {
      sacCode: sac.code, sacDescription: sac.desc, ratePct: sac.ratePct,
      cgst: 0, sgst: 0, igst: 0,
      taxableAmount: taxable, gstAmount, totalAmount: total,
    },
    entries: [
      { account: expenseAcct, debit: taxable, credit: 0 },
      { account: "GST Credit Available", debit: gstAmount, credit: 0 },
      { account: vendorLabel || "Vendor A/c", debit: 0, credit: total },
    ],
  };
}

// Standalone light-themed print document for a Maintenance & Repair voucher —
// same blob-URL + window.print() pattern used by GRN.tsx (the live view uses
// theme CSS variables that don't print cleanly).
export function printMaintenanceVoucher(d: MaintenanceItem) {
  const money = (n: number | null | undefined) =>
    "₹" + new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n || 0));
  const taxable = d.TaxableAmount ?? d.Amount;
  const rows: Array<[string, string]> = [
    ["Doc Number", d.DocNo || "—"],
    ["Doc Date", d.DocDate ? new Date(d.DocDate).toLocaleDateString("en-IN") : "—"],
    ["Company", d.CompanyName || "—"],
    ["Project", d.ProjectName || "—"],
    ["Item", d.ItemName || "—"],
    ["FA Item Code", d.FAItemCode || "—"],
    ["Vendor", d.VendorName || "—"],
    ["Repair Expense Type", REPAIR_EXPENSE_LABEL[d.RepairExpenseType] || d.RepairExpenseType],
    ["SAC Code", d.SacCode || "—"],
    ["Status", d.Status],
    ["Voucher No", d.VoucherNo || "—"],
  ];
  const infoHtml = rows
    .map(([k, v]) => `<div class="field"><label>${escapeHtml(k)}</label><span>${escapeHtml(v)}</span></div>`)
    .join("");

  const entries = d.posting && !d.posting.error ? d.posting.entries : [];
  const entryRows = entries
    .map(
      (e) => `
      <tr>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;">${escapeHtml(e.account)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:center;font-weight:700;">${e.debit ? "Dr" : "Cr"}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right;font-family:monospace;">${money(e.debit || e.credit)}</td>
      </tr>`,
    )
    .join("");
  const totalDr = entries.reduce((s, e) => s + (e.debit || 0), 0);
  const totalCr = entries.reduce((s, e) => s + (e.credit || 0), 0);

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8" /><title>${escapeHtml(d.DocNo || "Maintenance Voucher")}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 13px; color: #111827; background: #fff; padding: 36px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 28px; margin: 22px 0 26px; }
  .field { display: flex; justify-content: space-between; gap: 12px; padding: 6px 0; border-bottom: 1px solid #f3f4f6; }
  .field label { color: #6b7280; }
  .field span { font-weight: 600; text-align: right; }
  table { width: 100%; border-collapse: collapse; }
  thead th { background: #f3f4f6; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: #6b7280; padding: 9px 10px; text-align: left; }
  @media print { body { padding: 16px; } }
</style></head>
<body>
  <div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:18px;border-bottom:2px solid #4f46e5;">
    <div style="font-size:20px;font-weight:800;color:#4f46e5;">${escapeHtml(d.CompanyName || "CivilierERP")}</div>
    <div style="text-align:right;">
      <div style="font-size:22px;font-weight:800;color:#4f46e5;">FA MAINTENANCE &amp; REPAIR</div>
      <div style="font-size:15px;font-weight:700;font-family:monospace;margin-top:4px;">${escapeHtml(d.DocNo || "—")}</div>
    </div>
  </div>

  <div class="grid">${infoHtml}</div>

  <div style="display:flex;justify-content:flex-end;margin-bottom:22px;">
    <table style="width:280px;">
      <tbody>
        <tr><td style="color:#6b7280;padding:5px 8px;">Taxable Amount</td><td style="text-align:right;padding:5px 8px;font-family:monospace;">${money(taxable)}</td></tr>
        <tr><td style="color:#6b7280;padding:5px 8px;">GST @ ${d.GstRatePct ?? 0}%</td><td style="text-align:right;padding:5px 8px;font-family:monospace;">${money(d.GstAmount)}</td></tr>
        <tr style="border-top:2px solid #4f46e5;"><td style="padding:8px;font-weight:800;">Total (incl. GST)</td><td style="text-align:right;padding:8px;font-family:monospace;font-weight:800;color:#4f46e5;">${money(d.TotalAmount ?? d.Amount)}</td></tr>
      </tbody>
    </table>
  </div>

  ${entries.length ? `
  <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#9ca3af;margin-bottom:8px;">Accounting Entry</div>
  <table>
    <thead><tr><th>Account</th><th style="text-align:center;">Dr/Cr</th><th style="text-align:right;">Amount</th></tr></thead>
    <tbody>${entryRows}
      <tr style="border-top:2px solid #4f46e5;font-weight:800;">
        <td style="padding:8px 10px;">Total</td>
        <td style="padding:8px 10px;text-align:center;">Dr ${money(totalDr)}</td>
        <td style="padding:8px 10px;text-align:right;font-family:monospace;">Cr ${money(totalCr)}</td>
      </tr>
    </tbody>
  </table>` : ""}

  ${d.Remarks ? `<div style="margin-top:20px;"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#9ca3af;margin-bottom:6px;">Remarks</div><div style="font-size:12px;color:#374151;">${escapeHtml(d.Remarks)}</div></div>` : ""}

  <div style="margin-top:40px;padding-top:14px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;font-size:11px;color:#9ca3af;">
    <span>Generated by CivilierERP</span>
    <span>Printed: ${new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</span>
  </div>
</body></html>`;

  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const blobUrl = URL.createObjectURL(blob);
  const win = window.open(blobUrl, "_blank", "width=960,height=720");
  if (!win) {
    URL.revokeObjectURL(blobUrl);
    toast.error("Pop-up blocked — please allow pop-ups for this site.");
    return;
  }
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  win.onload = () => {
    win.focus();
    win.print();
  };
}
