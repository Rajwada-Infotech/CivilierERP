// The Work Order printout — the orange invoice-style format (header band with the company and the WORK ORDER title,
// "to" / "from" blocks, an orange table header with banded rows, totals box, terms, sign-off, orange footer band).
// Opened in its own window and sent to the printer; this is the default (and only) Work Order print template.
import type { WorkOrderDetail } from "./config";

const ORANGE = "#f28c1a";
const esc = (v: unknown) =>
  String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const money = (n: number) => `₹${new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0)}`;
const num = (n: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(Number(n) || 0);
const day = (v?: string) =>
  v ? new Date(v).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

export function printWorkOrder(wo: WorkOrderDetail) {
  const labour = wo.activities.reduce((t, a) => t + (Number(a.LabourAmount) || 0), 0);
  const materials = wo.activities.reduce((t, a) => t + (Number(a.MaterialAmount) || 0), 0);

  // Activities grouped under their Activity Group, numbered 1, 1.1, 1.2 … as on screen.
  const groups = new Map<string, WorkOrderDetail["activities"]>();
  for (const a of wo.activities) {
    const g = a.ActivityGroupName || "Activities";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(a);
  }
  let rows = "";
  let gi = 0;
  for (const [name, acts] of groups) {
    gi++;
    rows += `<tr class="grp"><td>${String(gi).padStart(2, "0")}</td><td colspan="6">${esc(name)}</td></tr>`;
    acts.forEach((a, i) => {
      const gst = a.HsnCode ? `${esc(a.HsnCode)}${a.HsnGstRate != null ? ` · ${esc(a.HsnGstRate)}%` : ""}` : "—";
      rows += `<tr>
        <td>${gi}.${i + 1}</td>
        <td>${esc(String(a.ActivityName || "").replace(/^[,\s]+/, ""))}${a.Remarks ? `<div class="sub">${esc(a.Remarks)}</div>` : ""}</td>
        <td class="c">${gst}</td>
        <td class="c">${esc(a.UOMName || "—")}</td>
        <td class="r">${money(a.Rate)}</td>
        <td class="r">${num(a.Area)}</td>
        <td class="r">${money(a.GrandTotal)}</td>
      </tr>`;
    });
  }

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Work Order ${esc(wo.DocumentNumber)}</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "Lato", "Segoe UI", Arial, sans-serif; color: #2b2b2b; font-size: 11px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .page { width: 210mm; min-height: 297mm; position: relative; padding-bottom: 26mm; }
  .band { background: ${ORANGE}; color: #fff; padding: 12mm 14mm; display: flex; justify-content: space-between; align-items: center; }
  .brand { display: flex; align-items: center; gap: 10px; }
  .mark { width: 34px; height: 34px; border: 3px solid #fff; border-radius: 8px; transform: skew(-8deg); display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 18px; }
  .brand .name { font-size: 20px; font-weight: 900; letter-spacing: .5px; text-transform: uppercase; }
  .brand .tag { font-size: 8px; letter-spacing: 1.5px; text-transform: uppercase; opacity: .85; }
  .title { text-align: right; }
  .title h1 { margin: 0; font-size: 34px; letter-spacing: 1px; font-weight: 900; }
  .title .meta { font-size: 9px; margin-top: 4px; display: grid; grid-template-columns: auto auto; gap: 1px 14px; justify-content: end; }
  .parties { display: flex; justify-content: space-between; padding: 10mm 14mm 6mm; }
  .party h4 { margin: 0 0 4px; font-size: 11px; font-weight: 700; }
  .party h2 { margin: 0 0 4px; font-size: 16px; font-weight: 900; text-transform: uppercase; }
  .party p { margin: 1px 0; color: #666; font-size: 10px; }
  .party.right { text-align: left; min-width: 60mm; }
  table.items { width: calc(100% - 28mm); margin: 0 14mm; border-collapse: collapse; }
  table.items th { background: ${ORANGE}; color: #fff; text-align: left; font-size: 10px; letter-spacing: .5px; text-transform: uppercase; padding: 8px 8px; }
  table.items td { padding: 7px 8px; border-bottom: 1px solid #e6e6ea; vertical-align: top; }
  table.items tbody tr:nth-child(even) td { background: #f6f6f8; }
  table.items tr.grp td { background: #fdf0e0 !important; font-weight: 800; color: #9a5300; border-bottom: 1px solid #f2d2a8; }
  .c { text-align: center; } .r { text-align: right; white-space: nowrap; }
  .sub { color: #777; font-size: 9px; margin-top: 2px; }
  .lower { display: flex; justify-content: space-between; gap: 12mm; padding: 8mm 14mm 0; }
  .terms { flex: 1; }
  .terms h5 { margin: 0 0 3px; font-size: 10px; font-weight: 800; }
  .terms p { margin: 0 0 8px; color: #555; font-size: 10px; white-space: pre-wrap; }
  .thanks { font-size: 13px; font-weight: 900; margin-top: 10mm; }
  .totals { width: 68mm; }
  .totals .line { display: flex; justify-content: space-between; padding: 3px 0; font-size: 10.5px; }
  .totals .total { background: ${ORANGE}; color: #fff; font-weight: 900; display: flex; justify-content: space-between; padding: 8px 10px; margin-top: 6px; font-size: 13px; }
  .sign { text-align: center; margin: 18mm 14mm 0 auto; width: 60mm; }
  .sign .ln { border-top: 1px solid #bbb; padding-top: 4px; font-weight: 800; font-size: 10.5px; }
  .foot { position: absolute; left: 0; right: 0; bottom: 0; height: 16mm; background: ${ORANGE}; color: #fff; font-size: 9px; display: flex; align-items: center; justify-content: space-between; padding: 0 14mm; clip-path: polygon(0 0, 80% 0, 84% 100%, 0 100%); width: 100%; }
  .foot2 { position: absolute; right: 0; bottom: 0; height: 8mm; width: 20%; background: ${ORANGE}; clip-path: polygon(20% 0, 100% 0, 100% 100%, 0 100%); }
  .status { display: inline-block; margin-top: 6px; padding: 2px 8px; border: 1px solid #fff; border-radius: 10px; font-size: 9px; letter-spacing: 1px; text-transform: uppercase; }
</style></head><body><div class="page">
  <div class="band">
    <div class="brand"><div class="mark">${esc((wo.CompanyName || "C").trim().charAt(0).toUpperCase())}</div>
      <div><div class="name">${esc(wo.CompanyName || "Company")}</div><div class="tag">${esc(wo.ProjectName || "")}</div></div></div>
    <div class="title"><h1>WORK ORDER</h1>
      <div class="meta"><span>Work Order Number</span><span>${esc(wo.DocumentNumber)}</span><span>Work Order Date</span><span>${day(wo.DocumentDate)}</span></div>
      ${wo.Status ? `<div class="status">${esc(wo.Status)}</div>` : ""}</div>
  </div>
  <div class="parties">
    <div class="party"><h4>Work Order To:</h4><h2>${esc(wo.ContractorName || "—")}</h2>
      <p>Contractor</p>${wo.SupplierName ? `<p>Supplier: ${esc(wo.SupplierName)}</p>` : ""}</div>
    <div class="party right"><h4>Work Order From:</h4><h2>${esc(wo.CompanyName || "—")}</h2>
      <p>Project: ${esc(wo.ProjectName || "—")}</p>${wo.CreatedBy ? `<p>Prepared by: ${esc(wo.CreatedBy)}</p>` : ""}</div>
  </div>
  <table class="items"><thead><tr><th style="width:9%">No.</th><th>Activity description</th><th class="c" style="width:13%">HSN · GST</th><th class="c" style="width:8%">Unit</th><th class="r" style="width:13%">Rate</th><th class="r" style="width:9%">Area</th><th class="r" style="width:14%">Total</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="7" class="c">No activities</td></tr>`}</tbody></table>
  <div class="lower">
    <div class="terms">
      ${wo.Remarks ? `<h5>Remarks</h5><p>${esc(wo.Remarks)}</p>` : ""}
      ${wo.TermsAndConditions ? `<h5>Terms &amp; Conditions</h5><p>${esc(wo.TermsAndConditions)}</p>` : ""}
      <div class="thanks">Thank You For Your Business</div>
    </div>
    <div class="totals">
      <div class="line"><span>Raw materials</span><span>${money(materials)}</span></div>
      <div class="line"><span>Labour</span><span>${money(labour)}</span></div>
      <div class="total"><span>Total</span><span>${money(wo.TotalAmount || labour + materials)}</span></div>
    </div>
  </div>
  <div class="sign"><div style="height:14mm"></div><div class="ln">Authorised sign</div></div>
  <div class="foot"><span>${esc(wo.CompanyName || "")}</span><span>Work Order ${esc(wo.DocumentNumber)}</span><span>Printed ${new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</span></div>
  <div class="foot2"></div>
</div></body></html>`;

  const win = window.open("", "_blank", "width=900,height=1000");
  if (!win) return false;
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 300);
  return true;
}
