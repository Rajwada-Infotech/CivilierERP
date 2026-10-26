// Prints one work order — its details, every activity group and activity, each activity's material breakdown,
// and the totals — as a plain, light A4 document in its own window (same look as the list's Print).
import { escapeHtml } from "@/utils/escapeHtml";
import { openPrintWindow } from "@/lib/printList";
import { fmt, fmtQ, type WorkOrderActivityDetail, type WorkOrderDetail } from "./config";

const day = (v?: string | null) =>
  v ? new Date(v).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const e = (v: unknown) => escapeHtml(v == null || v === "" ? "—" : String(v));
const money = (n?: number | null) => (n ? fmt(n) : "—");

function activityRows(act: WorkOrderActivityDetail, no: string, supplierName: string) {
  const hsn = act.HsnCode ? `${act.HsnCode}${act.HsnGstRate != null ? ` · ${act.HsnGstRate}%` : ""}` : "—";
  let html = `<tr class="act">
    <td class="n">${no}</td><td><b>${e(act.ActivityName)}</b></td><td>${e(hsn)}</td><td>${e(act.UOMName)}</td>
    <td class="r">${money(act.Rate)}</td><td class="r">${act.Area != null ? fmtQ(Number(act.Area)) : "—"}</td>
    <td class="r">${money(act.LabourAmount)}</td><td class="r">${money(act.MaterialAmount)}</td><td class="r"><b>${fmt(act.GrandTotal || 0)}</b></td>
  </tr>`;
  if (act.materials?.length) {
    const lines = act.materials.map((m, i) => {
      // Quantity is the consumption ratio per unit of area; the line's quantity is ratio × the activity's area.
      const qty = (m.Quantity || 0) * (act.Area || 0);
      const amount = qty * (m.Rate || 0);
      return `<tr>
        <td class="n">${i + 1}</td><td>${e(m.ItemName)}</td><td class="r">${m.Quantity != null ? fmtQ(Number(m.Quantity)) : "—"}</td>
        <td class="r">${fmtQ(qty)}</td><td>${e(m.UOMName)}</td><td class="r">${money(m.Rate)}</td>
        <td class="r">${m.GSTRate != null ? `${m.GSTRate}%` : "—"}</td><td>${e(m.SupplierNamePerLine || supplierName)}</td>
        <td class="r">${amount > 0 ? fmt(amount) : "—"}</td>
      </tr>`;
    }).join("");
    html += `<tr class="mats"><td></td><td colspan="8">
      <table class="sub">
        <thead><tr><th class="n">#</th><th>Material</th><th class="r">Ratio</th><th class="r">Qty</th><th>Unit</th><th class="r">Rate</th><th class="r">GST</th><th>Supplier</th><th class="r">Amount</th></tr></thead>
        <tbody>${lines}</tbody>
        <tfoot><tr><td colspan="8">Materials subtotal</td><td class="r">${fmt(act.MaterialAmount || 0)}</td></tr></tfoot>
      </table>
    </td></tr>`;
  }
  if (act.Remarks) html += `<tr class="rem"><td></td><td colspan="8">Remarks: ${e(act.Remarks)}</td></tr>`;
  return html;
}

export function printWorkOrder(d: WorkOrderDetail) {
  const acts = d.activities || [];
  const groups = new Map<string, WorkOrderActivityDetail[]>();
  for (const a of acts) {
    const k = a.ActivityGroupName || "Ungrouped";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(a);
  }
  const labour = acts.reduce((s, a) => s + (a.LabourAmount || 0), 0);
  const materials = acts.reduce((s, a) => s + (a.MaterialAmount || 0), 0);

  const body = [...groups.entries()].map(([name, list], gi) => {
    const gLabour = list.reduce((s, a) => s + (a.LabourAmount || 0), 0);
    const gMats = list.reduce((s, a) => s + (a.MaterialAmount || 0), 0);
    return `<tbody class="group">
      <tr class="grp"><td class="n">${gi + 1}</td><td colspan="8">${e(name)} <span class="muted">· ${list.length} ${list.length === 1 ? "activity" : "activities"}</span></td></tr>
      ${list.map((a, ai) => activityRows(a, `${gi + 1}.${ai + 1}`, d.SupplierName)).join("")}
      <tr class="gtot"><td></td><td colspan="5">${e(name)} total</td><td class="r">${fmt(gLabour)}</td><td class="r">${fmt(gMats)}</td><td class="r">${fmt(gLabour + gMats)}</td></tr>
    </tbody>`;
  }).join("");

  const details: [string, string][] = [
    ["Company", d.CompanyName], ["Project", d.ProjectName], ["Contractor", d.ContractorName], ["Supplier", d.SupplierName],
    ["Document date", day(d.DocumentDate)], ["Created", `${day(d.CreatedAt)}${d.CreatedBy ? ` · ${d.CreatedBy}` : ""}`],
  ];
  const printed = new Date().toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const title = `Work Order ${d.DocumentNumber || ""}`.trim();

  openPrintWindow(`<!DOCTYPE html>
<html><head><meta charset="utf-8" /><title>${escapeHtml(title)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 10.5px; color: #111827; background: #fff; padding: 24px; }
  header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #111827; padding-bottom: 10px; margin-bottom: 12px; }
  h1 { font-size: 18px; font-weight: 800; }
  h2 { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #374151; margin: 16px 0 6px; }
  .status { display: inline-block; margin-top: 5px; border: 1px solid #111827; padding: 2px 7px; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; }
  .meta { text-align: right; color: #6b7280; font-size: 10px; line-height: 1.5; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); border: 1px solid #d1d5db; }
  .grid div { padding: 7px 9px; border-right: 1px solid #e5e7eb; border-bottom: 1px solid #e5e7eb; }
  .grid div:nth-child(3n) { border-right: 0; }
  .lbl { display: block; font-size: 8.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: #6b7280; margin-bottom: 2px; }
  .note { border: 1px solid #d1d5db; padding: 8px 10px; white-space: pre-line; margin-top: 6px; }
  table { width: 100%; border-collapse: collapse; }
  thead th { background: #f3f4f6; font-size: 8.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #374151; text-align: left; padding: 6px 7px; border-bottom: 1px solid #9ca3af; }
  td { padding: 5px 7px; vertical-align: top; }
  .r { text-align: right; white-space: nowrap; }
  .n { color: #6b7280; width: 34px; white-space: nowrap; }
  .muted { color: #6b7280; font-weight: 400; }
  tr.grp td { background: #e5e7eb; font-weight: 700; border-top: 1px solid #9ca3af; }
  tr.act td { border-top: 1px solid #e5e7eb; }
  tr.gtot td { font-weight: 700; border-top: 1px solid #9ca3af; border-bottom: 1px solid #9ca3af; background: #f9fafb; }
  tr.rem td { color: #4b5563; font-style: italic; padding-top: 0; }
  tr.mats > td { padding-top: 0; padding-bottom: 8px; }
  table.sub { border: 1px solid #e5e7eb; }
  table.sub thead th { background: #fafafa; font-size: 8px; padding: 4px 6px; }
  table.sub td { padding: 3px 6px; border-bottom: 1px solid #f3f4f6; font-size: 9.5px; }
  table.sub tfoot td { font-weight: 700; border-top: 1px solid #d1d5db; }
  .totals { margin-top: 14px; margin-left: auto; width: 300px; border: 1px solid #111827; }
  .totals div { display: flex; justify-content: space-between; padding: 6px 10px; border-bottom: 1px solid #e5e7eb; }
  .totals div:last-child { border-bottom: 0; background: #111827; color: #fff; font-size: 12px; font-weight: 800; }
  tbody.group, tr { page-break-inside: avoid; }
  thead { display: table-header-group; }
  footer { margin-top: 16px; color: #9ca3af; font-size: 9px; display: flex; justify-content: space-between; }
  @page { size: A4 portrait; margin: 12mm; }
  @media print { body { padding: 0; } }
</style></head>
<body>
  <header>
    <div><h1>${escapeHtml(title)}</h1><span class="status">${e(d.Status || "Draft")}</span></div>
    <div class="meta">${acts.length} activit${acts.length === 1 ? "y" : "ies"}<br />Printed ${escapeHtml(printed)}</div>
  </header>
  <div class="grid">${details.map(([l, v]) => `<div><span class="lbl">${l}</span>${e(v)}</div>`).join("")}</div>
  ${d.Remarks ? `<h2>Remarks</h2><div class="note">${e(d.Remarks)}</div>` : ""}

  <h2>Activities</h2>
  <table>
    <thead><tr><th class="n">#</th><th>Activity</th><th>HSN / GST</th><th>Unit</th><th class="r">Rate / unit</th><th class="r">Area</th><th class="r">Labour</th><th class="r">Materials</th><th class="r">Total</th></tr></thead>
    ${body || `<tbody><tr><td colspan="9" class="muted">No activities.</td></tr></tbody>`}
  </table>

  <div class="totals">
    <div><span>Raw materials</span><span>${fmt(materials)}</span></div>
    <div><span>Labour</span><span>${fmt(labour)}</span></div>
    <div><span>Grand total</span><span>${fmt(d.TotalAmount || 0)}</span></div>
  </div>

  ${d.TermsAndConditions ? `<h2>Terms &amp; conditions</h2><div class="note">${e(d.TermsAndConditions)}</div>` : ""}
  <footer><span>CivilierERP</span><span>${escapeHtml(title)}</span></footer>
</body></html>`);
}
