// Prints one saved Bill of Quantities as an A4 document in the "invoice" look: a dark left sidebar (project / bill
// details / summary), an orange header with the BILLS OF QUANTITIES title, peach-striped item and activity tables, a dark
// total bar, sign-off and an orange footer strip. The sidebar repeats on every page.
import { escapeHtml } from "@/utils/escapeHtml";
import { printStatusLabel } from "@/utils/printStatus";
import { openPrintWindow } from "@/lib/printList";
import { fmt, fmtDate, type BoqRecord } from "./config";

const e = (v: unknown) => escapeHtml(v == null || v === "" ? "—" : String(v));
const num = (v: unknown) => Number(v) || 0;

type Line = Record<string, any>;

function tableRows(rows: Line[], kind: "item" | "activity") {
  const cols = kind === "item" ? 7 : 6;
  if (!rows.length) return `<tr><td colspan="${cols}" class="empty">No ${kind === "item" ? "items" : "activities"}</td></tr>`;
  return rows.map((row, i) => {
    const name = kind === "item" ? row.itemName ?? row.ItemName : row.activityName ?? row.ActivityName;
    const code = kind === "item" ? row.itemCode ?? row.ItemCode : row.activityCode ?? row.ActivityCode;
    const desc = row.description ?? row.Description ?? "";
    const qty = row.quantity ?? row.Quantity ?? "";
    const uom = row.uomName ?? row.UomName ?? "";
    const rate = num(row.rate ?? row.Rate);
    const amount = num(row.amount ?? row.LineAmount ?? row.Amount);
    const forActivity = row.activityName ?? row.ActivityName ?? "";
    return `<tr>
      <td class="c">${i + 1}</td>
      <td><b>${e(name)}</b>${code ? ` <span class="code">${escapeHtml(String(code))}</span>` : ""}${desc ? `<div class="desc">${escapeHtml(String(desc))}</div>` : ""}</td>
      ${kind === "item" ? `<td class="act">${forActivity ? escapeHtml(String(forActivity)) : "—"}</td>` : ""}
      <td class="r">${escapeHtml(String(qty))}</td>
      <td class="c">${escapeHtml(String(uom))}</td>
      <td class="r">${fmt(rate)}</td>
      <td class="r">${fmt(amount)}</td>
    </tr>`;
  }).join("");
}

const sum = (rows: Line[]) => rows.reduce((s, r) => s + num(r.amount ?? r.LineAmount ?? r.Amount), 0);

export function printBoq(record: BoqRecord) {
  const items: Line[] = Array.isArray(record.BoqItems) ? (record.BoqItems as Line[]) : [];
  const activities: Line[] = Array.isArray(record.BoqActivities) ? (record.BoqActivities as Line[]) : [];
  const itemTotal = sum(items);
  const activityTotal = sum(activities);
  const grand = num(record.TotalAmount) || itemTotal + activityTotal;
  const docNo = record.BoqNo || record.DocNo || `#${record.BoqID}`;
  const company = record.CompanyName || "Company";
  const mark = escapeHtml(company.trim().charAt(0).toUpperCase());
  const origin = window.location.origin;
  const printed = new Date().toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const itemHead = `<tr class="th"><th class="c">SL.</th><th>DESCRIPTION</th><th>FOR ACTIVITY</th><th class="r">QTY</th><th class="c">UOM</th><th class="r">RATE</th><th class="r">AMOUNT</th></tr>`;
  const head = `<tr class="th"><th class="c">SL.</th><th>DESCRIPTION</th><th class="r">QTY</th><th class="c">UOM</th><th class="r">RATE</th><th class="r">AMOUNT</th></tr>`;

  openPrintWindow(`<!DOCTYPE html>
<html><head><meta charset="utf-8" /><title>BOQ ${escapeHtml(String(docNo))}</title>
<style>
  /* DM Sans, from the app's own copy (the print window is a blob page, so the address must be absolute). */
  @font-face { font-family: 'DM Sans'; font-weight: 100 600; src: url('${origin}/fonts/DMSans-Regular.ttf') format('truetype'); }
  @font-face { font-family: 'DM Sans'; font-weight: 700 900; src: url('${origin}/fonts/DMSans-Bold.ttf') format('truetype'); }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  @page { size: A4 portrait; margin: 0; }
  html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: 'DM Sans', 'Segoe UI', Arial, sans-serif; font-size: 10.5px; color: #2b2b2b; background: #fff7ea; }
  /* Dark sidebar, repeated on every page */
  .side { position: fixed; top: 0; left: 0; bottom: 0; width: 64mm; background: #34373a; color: #fff; padding: 46mm 6mm 0 7mm; z-index: 1; }
  .side h5 { color: #f26a21; font-size: 10.5px; letter-spacing: 1.2px; margin: 14px 0 5px; text-transform: uppercase; }
  .side p { font-size: 9.5px; line-height: 1.55; color: #e9e9e9; word-break: break-word; }
  .side p span { color: #a9acb0; display: inline-block; min-width: 20mm; }
  .side .big { font-size: 12px; font-weight: 800; color: #fff; }
  /* Orange brand block + diagonal accents, first page only */
  .brand { position: absolute; top: 0; left: 0; width: 64mm; height: 40mm; background: #f26a21; color: #fff; z-index: 2; padding: 12mm 6mm 0 7mm; border-bottom-right-radius: 10mm; }
  .brand .mark { width: 9mm; height: 9mm; border: 2.2px solid #fff; transform: rotate(45deg) scale(.8); margin: 0 0 3mm 1mm; }
  .brand .name { font-size: 15px; font-weight: 900; letter-spacing: .6px; text-transform: uppercase; line-height: 1.15; }
  .brand .tag { font-size: 7.5px; letter-spacing: 1.2px; margin-top: 2px; opacity: .95; }
  .topbar { position: absolute; top: 0; left: 64mm; right: 0; height: 40mm; background: #fff7ea; overflow: hidden; }
  .topbar::before { content: ""; position: absolute; top: 0; left: 6mm; width: 22mm; height: 100%; background: #34373a; transform: skewX(-32deg); transform-origin: top left; }
  .topbar::after { content: ""; position: absolute; top: 0; left: 34mm; right: 0; height: 15mm; background: #f26a21; }
  .topbar h1 { position: absolute; z-index: 3; top: 4.5mm; right: 10mm; color: #fff; font-size: 25px; font-weight: 900; letter-spacing: 5px; text-transform: uppercase; }
  .topbar .status { position: absolute; z-index: 3; top: 20mm; right: 10mm; font-size: 9px; letter-spacing: 1px; text-transform: uppercase; color: #9a4a12; font-weight: 800; }
  /* Content column */
  .main { margin-left: 64mm; padding: 0 10mm 0 9mm; }
  .first-gap { height: 44mm; }
  table.t { width: 100%; border-collapse: collapse; }
  table.t thead { display: table-header-group; }
  .spacer td { height: 4mm; padding: 0; border: 0; }
  tr.th th { background: #f26a21; color: #fff; font-size: 8.5px; letter-spacing: .8px; padding: 7px 7px; text-align: left; }
  tbody tr td { padding: 7px; vertical-align: top; background: #fde3cd; border-bottom: 3px solid #fff7ea; }
  tbody tr:nth-child(even) td { background: #fdeede; }
  .c { text-align: center; } .r { text-align: right; white-space: nowrap; }
  th.c { text-align: center; } th.r { text-align: right; }
  .act { color: #9a4a12; font-weight: 700; font-size: 9.5px; }
  .code { color: #9a4a12; font-size: 9px; margin-left: 4px; }
  .desc { color: #6b6b6b; font-size: 9.5px; margin-top: 2px; }
  .empty { text-align: center; color: #8a8a8a; }
  tr, .block { page-break-inside: avoid; }
  h3.sec { font-size: 11px; letter-spacing: 1.2px; text-transform: uppercase; color: #34373a; margin: 4px 0 6px; }
  h3.sec b { color: #f26a21; }
  .sub td { background: transparent !important; border: 0; text-align: right; padding: 3px 7px; font-size: 10px; }
  .sub td.k { color: #6b6b6b; }
  .totals { width: 82mm; margin: 6mm 0 0 auto; }
  .totals .line { display: flex; justify-content: space-between; padding: 3px 7px; font-size: 10.5px; }
  .totals .line b { font-weight: 700; }
  .grand { margin-top: 5px; background: #34373a; color: #fff; display: flex; justify-content: space-between; padding: 9px 12px; font-weight: 900; font-size: 14px; letter-spacing: .5px; }
  .note { margin-top: 8mm; font-size: 9.5px; color: #555; white-space: pre-line; }
  .note b { display: block; color: #34373a; font-size: 10px; margin-bottom: 2px; }
  .sign { width: 52mm; margin: 14mm 0 0 auto; text-align: center; border-top: 1px solid #999; padding-top: 4px; font-weight: 800; font-size: 10px; }
  .foot { margin-top: 10mm; background: #f26a21; color: #fff; display: flex; justify-content: space-between; gap: 8px; font-size: 9px; padding: 8px 12px; border-radius: 12px 0 0 12px; }
</style></head>
<body>
  <aside class="side">
    <h5>Project</h5>
    <p class="big">${e(record.ProjectName)}</p>
    <p>${e(company)}</p>
    <h5>Bill details</h5>
    <p><span>BOQ No</span>${e(docNo)}</p>
    ${record.DocNo && record.DocNo !== record.BoqNo ? `<p><span>Doc No</span>${e(record.DocNo)}</p>` : ""}
    <p><span>Date</span>${e(fmtDate(record.BoqDate))}</p>
    <p><span>Created by</span>${e(record.CreatedBy)}</p>
    <h5>Summary</h5>
    <p><span>Items</span>${fmt(itemTotal)}</p>
    <p><span>Activities</span>${fmt(activityTotal)}</p>
    <p class="big"><span>Total</span>${fmt(grand)}</p>
  </aside>
  <div class="brand"><div class="mark"></div><div class="name">${e(company)}</div><div class="tag">${escapeHtml(record.ProjectName || "")}</div></div>
  <div class="topbar"><h1>Bills of Quantities</h1><div class="status">${e(printStatusLabel(record.Status) || "Draft")}</div></div>

  <div class="main">
    <div class="first-gap"></div>
    ${record.Description ? `<div class="note" style="margin:0 0 6mm"><b>Description</b>${escapeHtml(String(record.Description))}</div>` : ""}

    <h3 class="sec">Items <b>· ${items.length}</b></h3>
    <table class="t"><thead><tr class="spacer"><td colspan="7"></td></tr>${itemHead}</thead><tbody>${tableRows(items, "item")}</tbody>
      <tfoot><tr class="sub"><td class="k" colspan="6">Items total</td><td>${fmt(itemTotal)}</td></tr></tfoot></table>

    <h3 class="sec" style="margin-top:8mm">Activities <b>· ${activities.length}</b></h3>
    <table class="t"><thead><tr class="spacer"><td colspan="6"></td></tr>${head}</thead><tbody>${tableRows(activities, "activity")}</tbody>
      <tfoot><tr class="sub"><td class="k" colspan="5">Activities total</td><td>${fmt(activityTotal)}</td></tr></tfoot></table>

    <div class="block">
      <div class="totals">
        <div class="line"><span>Items</span><b>${fmt(itemTotal)}</b></div>
        <div class="line"><span>Activities</span><b>${fmt(activityTotal)}</b></div>
        <div class="grand"><span>TOTAL</span><span>: ${fmt(grand)}</span></div>
      </div>
      <div class="sign">Authorised sign</div>
      <div class="foot"><span>CivilierERP</span><span>BOQ ${escapeHtml(String(docNo))}</span><span>Printed ${escapeHtml(printed)}</span></div>
    </div>
    <div style="height:8mm"></div>
  </div>
</body></html>`);
}
