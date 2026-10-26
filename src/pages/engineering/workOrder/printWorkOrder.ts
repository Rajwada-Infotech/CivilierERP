// Prints one work order — its details, every activity group and activity, each activity's material breakdown,
// and the totals — as an A4 document in the orange invoice-style format (header band with the company and the WORK ORDER
// title, "to" / "from" blocks, orange table header, totals box, terms, sign-off, footer band). The default Work Order print.
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
      <tr class="grp"><td class="n">${String(gi + 1).padStart(2, "0")}</td><td colspan="8">${e(name)} <span class="muted">· ${list.length} ${list.length === 1 ? "activity" : "activities"}</span></td></tr>
      ${list.map((a, ai) => activityRows(a, `${gi + 1}.${ai + 1}`, d.SupplierName)).join("")}
      <tr class="gtot"><td></td><td colspan="5">${e(name)} total</td><td class="r">${fmt(gLabour)}</td><td class="r">${fmt(gMats)}</td><td class="r">${fmt(gLabour + gMats)}</td></tr>
    </tbody>`;
  }).join("");

  const printed = new Date().toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const title = `Work Order ${d.DocumentNumber || ""}`.trim();
  const mark = escapeHtml((d.CompanyName || "C").trim().charAt(0).toUpperCase());

  openPrintWindow(`<!DOCTYPE html>
<html><head><meta charset="utf-8" /><title>${escapeHtml(title)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Lato', 'Segoe UI', Arial, sans-serif; font-size: 10.5px; color: #2b2b2b; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .band { background: #f28c1a; color: #fff; padding: 22px 28px; display: flex; justify-content: space-between; align-items: center; }
  .brand { display: flex; align-items: center; gap: 10px; }
  .mark { width: 34px; height: 34px; border: 3px solid #fff; border-radius: 8px; transform: skew(-8deg); display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 18px; }
  .brand .name { font-size: 19px; font-weight: 900; letter-spacing: .5px; text-transform: uppercase; }
  .brand .tag { font-size: 8px; letter-spacing: 1.5px; text-transform: uppercase; opacity: .9; }
  .title { text-align: right; }
  .title h1 { font-size: 32px; letter-spacing: 1px; font-weight: 900; }
  .title .meta { font-size: 9px; margin-top: 4px; display: grid; grid-template-columns: auto auto; gap: 1px 14px; justify-content: end; }
  .status { display: inline-block; margin-top: 6px; padding: 2px 8px; border: 1px solid #fff; border-radius: 10px; font-size: 9px; letter-spacing: 1px; text-transform: uppercase; }
  .wrap { padding: 0 28px 24px; }
  .parties { display: flex; justify-content: space-between; padding: 18px 0 12px; }
  .party h4 { font-size: 11px; font-weight: 700; margin-bottom: 3px; }
  .party h3 { font-size: 15px; font-weight: 900; text-transform: uppercase; margin-bottom: 3px; }
  .party p { color: #666; font-size: 10px; margin: 1px 0; }
  .party.right { min-width: 230px; }
  h2 { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; color: #9a5300; margin: 14px 0 5px; }
  .note { background: #f6f6f8; padding: 8px 10px; white-space: pre-line; border-left: 3px solid #f28c1a; }
  table { width: 100%; border-collapse: collapse; }
  thead th { background: #f28c1a; color: #fff; font-size: 8.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; text-align: left; padding: 7px 7px; }
  td { padding: 5px 7px; vertical-align: top; }
  .r { text-align: right; white-space: nowrap; }
  .n { color: #8a8a8a; width: 34px; white-space: nowrap; }
  thead th.n { color: #fff; }
  .muted { color: #8a8a8a; font-weight: 400; }
  tr.grp td { background: #fdf0e0; color: #9a5300; font-weight: 800; border-top: 1px solid #f2d2a8; }
  tr.act td { border-top: 1px solid #e6e6ea; }
  tr.gtot td { font-weight: 700; background: #f6f6f8; border-top: 1px solid #d9d9de; }
  tr.rem td { color: #5a5a5a; font-style: italic; padding-top: 0; }
  tr.mats > td { padding-top: 0; padding-bottom: 8px; }
  table.sub { border: 1px solid #e6e6ea; }
  table.sub thead th { background: #fafafa; color: #555; font-size: 8px; padding: 4px 6px; border-bottom: 1px solid #e6e6ea; }
  table.sub td { padding: 3px 6px; border-bottom: 1px solid #f1f1f4; font-size: 9.5px; }
  table.sub tfoot td { font-weight: 700; border-top: 1px solid #d9d9de; }
  .lower { display: flex; justify-content: space-between; gap: 24px; margin-top: 14px; }
  .terms { flex: 1; }
  .thanks { font-size: 13px; font-weight: 900; margin-top: 18px; }
  .totals { width: 260px; flex-shrink: 0; }
  .totals .line { display: flex; justify-content: space-between; padding: 4px 0; }
  .totals .total { background: #f28c1a; color: #fff; font-weight: 900; display: flex; justify-content: space-between; padding: 8px 10px; margin-top: 6px; font-size: 13px; }
  .sign { width: 190px; margin: 34px 0 0 auto; text-align: center; border-top: 1px solid #bbb; padding-top: 4px; font-weight: 800; }
  tbody.group, tr { page-break-inside: avoid; }
  thead { display: table-header-group; }
  footer { background: #f28c1a; color: #fff; font-size: 9px; display: flex; justify-content: space-between; padding: 9px 28px; margin-top: 18px; }
  @page { size: A4 portrait; margin: 0; }
</style></head>
<body>
  <div class="band">
    <div class="brand"><div class="mark">${mark}</div><div><div class="name">${e(d.CompanyName)}</div><div class="tag">${escapeHtml(d.ProjectName || "")}</div></div></div>
    <div class="title"><h1>WORK ORDER</h1>
      <div class="meta"><span>Work Order Number</span><span>${e(d.DocumentNumber)}</span><span>Work Order Date</span><span>${day(d.DocumentDate)}</span></div>
      <span class="status">${e(d.Status || "Draft")}</span></div>
  </div>
  <div class="wrap">
    <div class="parties">
      <div class="party"><h4>Work Order To:</h4><h3>${e(d.ContractorName)}</h3><p>Contractor</p>${d.SupplierName ? `<p>Supplier: ${e(d.SupplierName)}</p>` : ""}</div>
      <div class="party right"><h4>Work Order From:</h4><h3>${e(d.CompanyName)}</h3><p>Project: ${e(d.ProjectName)}</p><p>Created: ${day(d.CreatedAt)}${d.CreatedBy ? ` · ${escapeHtml(d.CreatedBy)}` : ""}</p></div>
    </div>
    ${d.Remarks ? `<h2>Remarks</h2><div class="note">${e(d.Remarks)}</div>` : ""}

    <h2>Activities · ${acts.length} activit${acts.length === 1 ? "y" : "ies"}</h2>
    <table>
      <thead><tr><th class="n">No.</th><th>Activity</th><th>HSN / GST</th><th>Unit</th><th class="r">Rate / unit</th><th class="r">Area</th><th class="r">Labour</th><th class="r">Materials</th><th class="r">Total</th></tr></thead>
      ${body || `<tbody><tr><td colspan="9" class="muted">No activities.</td></tr></tbody>`}
    </table>

    <div class="lower">
      <div class="terms">
        ${d.TermsAndConditions ? `<h2>Terms &amp; conditions</h2><div class="note">${e(d.TermsAndConditions)}</div>` : ""}
        <div class="thanks">Thank You For Your Business</div>
      </div>
      <div class="totals">
        <div class="line"><span>Raw materials</span><span>${fmt(materials)}</span></div>
        <div class="line"><span>Labour</span><span>${fmt(labour)}</span></div>
        <div class="total"><span>Grand total</span><span>${fmt(d.TotalAmount || 0)}</span></div>
      </div>
    </div>
    <div class="sign">Authorised sign</div>
  </div>
  <footer><span>CivilierERP</span><span>${escapeHtml(title)}</span><span>Printed ${escapeHtml(printed)}</span></footer>
</body></html>`);
}
