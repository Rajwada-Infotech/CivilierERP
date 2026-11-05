// The Work Done certificate, printed from a new window.
import { printStatusLabel } from "@/utils/printStatus";
import { type WorkDoneEntry, fmt, fmtDate } from "./config";

// Everything typed by a person goes through this before it lands in the page.
const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const or = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : esc(v));

export function printWorkDone(r: WorkDoneEntry) {
  const win = window.open("", "_blank", "width=900,height=700");
  if (!win) return;
  const tone =
    r.Status === "Approved" ? ["#d1fae5", "#065f46"] : r.Status === "Pending" ? ["#fef3c7", "#92400e"] : r.Status === "Rejected" ? ["#fee2e2", "#991b1b"] : ["#f3f4f6", "#374151"];
  win.document.write(`<!DOCTYPE html><html><head><title>Work Done — ${esc(r.DocNo || r.ID)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 12px; color: #1a1a2e; background: #fff; padding: 32px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111; padding-bottom: 16px; margin-bottom: 20px; }
  .logo-block h1 { font-size: 20px; font-weight: 800; letter-spacing: -0.5px; }
  .logo-block p { font-size: 10px; color: #6b7280; margin-top: 2px; }
  .doc-block { text-align: right; }
  .doc-block .doc-no { font-size: 16px; font-weight: 700; font-family: monospace; }
  .doc-block .doc-label { font-size: 9px; color: #9ca3af; text-transform: uppercase; letter-spacing: 1px; }
  .status-badge { display: inline-block; padding: 3px 10px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; background: ${tone[0]}; color: ${tone[1]}; }
  .section { margin-bottom: 20px; }
  .section-title { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px; padding-bottom: 4px; border-bottom: 1px solid #ddd; }
  .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
  .field label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.8px; color: #9ca3af; font-weight: 600; display: block; margin-bottom: 3px; }
  .field span { font-size: 12px; color: #111827; font-weight: 500; }
  .amount-box { border: 1px solid #ddd; padding: 16px; }
  .amount-row { display: flex; justify-content: space-between; align-items: center; padding: 5px 0; border-bottom: 1px solid #eee; }
  .amount-row:last-child { border-bottom: none; }
  .amount-row .label { color: #6b7280; font-size: 11px; }
  .amount-row .value { font-weight: 600; color: #111827; font-family: monospace; }
  .net-row { display: flex; justify-content: space-between; align-items: center; margin-top: 12px; padding: 12px 16px; background: #111; }
  .net-row .label { color: #eee; font-size: 12px; font-weight: 600; }
  .net-row .value { color: #fff; font-size: 16px; font-weight: 800; font-family: monospace; }
  .desc-box { border: 1px solid #e5e7eb; padding: 12px; font-size: 12px; color: #374151; line-height: 1.6; white-space: pre-wrap; }
  .footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #e5e7eb; display: flex; justify-content: space-between; font-size: 9px; color: #9ca3af; }
  @media print { body { padding: 20px; } }
</style></head><body>
<div class="header">
  <div class="logo-block"><h1>Civilier ERP</h1><p>Work Done Certificate</p></div>
  <div class="doc-block">
    <div class="doc-label">Document No</div>
    <div class="doc-no">${or(r.DocNo)}</div>
    <div style="margin-top:6px"><span class="status-badge">${esc(printStatusLabel(r.Status) || "Draft")}</span></div>
  </div>
</div>
<div class="section">
  <div class="section-title">Project Information</div>
  <div class="grid-3">
    <div class="field"><label>Company</label><span>${or(r.CompanyName)}</span></div>
    <div class="field"><label>Project / Site</label><span>${or(r.ProjectName)}</span></div>
    <div class="field"><label>Financial Year</label><span>${or(r.FinYear)}</span></div>
    <div class="field"><label>Document Date</label><span>${fmtDate(r.DocDate)}</span></div>
    <div class="field"><label>Work Order Ref</label><span>${or(r.WorkOrderNo)}</span></div>
    <div class="field"><label>Contractor</label><span>${or(r.ContractorName || r.SupplierName)}</span></div>
  </div>
</div>
<div class="section">
  <div class="section-title">Work Period &amp; Details</div>
  <div class="grid-3" style="margin-bottom:12px">
    <div class="field"><label>Period From</label><span>${fmtDate(r.PeriodFrom)}</span></div>
    <div class="field"><label>Period To</label><span>${fmtDate(r.PeriodTo)}</span></div>
    <div class="field"><label>Unit</label><span>${or(r.Unit)}</span></div>
    <div class="field"><label>Quantity Done</label><span>${or(r.QuantityDone)}</span></div>
    <div class="field"><label>Rate Per Unit</label><span>${fmt(r.RatePerUnit)}</span></div>
  </div>
  <div class="field"><label>Description of Work</label></div>
  <div class="desc-box" style="margin-top:6px">${or(r.DescriptionOfWork)}</div>
</div>
<div class="section">
  <div class="section-title">Amount Summary</div>
  <div class="amount-box">
    <div class="amount-row"><span class="label">Gross Amount</span><span class="value">${fmt(r.GrossAmount)}</span></div>
    <div class="amount-row"><span class="label">Deductions</span><span class="value" style="color:#dc2626">− ${fmt(r.Deductions)}</span></div>
  </div>
  <div class="net-row"><span class="label">Certified Amount</span><span class="value">${fmt(r.CertifiedAmount)}</span></div>
</div>
${r.Remarks ? `<div class="section"><div class="section-title">Remarks</div><div class="desc-box">${esc(r.Remarks)}</div></div>` : ""}
<div class="footer">
  <span>Generated from Civilier ERP · ${new Date().toLocaleDateString("en-IN")}</span>
  <span>Doc: ${esc(r.DocNo || r.ID)} · Status: ${esc(r.Status)}</span>
</div>
</body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 400);
}
