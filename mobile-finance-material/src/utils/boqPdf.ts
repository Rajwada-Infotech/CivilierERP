// A saved Bill of Quantities as an A4 PDF in the web app's invoice-style print format (src/pages/engineering/boq/
// printBoq.ts): dark sidebar (project / bill details / summary), orange header with the BILLS OF QUANTITIES title,
// peach-striped Items table (with the "For activity" column) and Activities table, a dark TOTAL bar, sign-off and an
// orange footer strip. Made with expo-print, saved under the BOQ number and handed to the share sheet.
// The same file lives in mobile-finance-material/src/utils/boqPdf.ts — keep the two identical.
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { File, Paths } from "expo-file-system";

type Line = Record<string, any>;

export interface BoqPdfRecord {
  BoqID?: number | string;
  BoqNo?: string | null;
  DocNo?: string | null;
  Status?: string | null;
  CompanyName?: string | null;
  ProjectName?: string | null;
  BoqDate?: string | null;
  CreatedBy?: string | null;
  Description?: string | null;
  TotalAmount?: number | string | null;
  BoqItems?: Line[] | null;
  BoqActivities?: Line[] | null;
}

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
const e = (v: unknown) => esc(v == null || v === "" ? "—" : v);
const num = (v: unknown) => Number(v) || 0;
const fmt = (n: number) => `₹${num(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const amountOf = (r: Line) => num(r.amount ?? r.LineAmount ?? r.Amount);
const sum = (rows: Line[]) => rows.reduce((s, r) => s + amountOf(r), 0);

function rowsHtml(rows: Line[], kind: "item" | "activity") {
  if (!rows.length) return `<tr><td colspan="${kind === "item" ? 7 : 6}" class="empty">No ${kind === "item" ? "items" : "activities"}</td></tr>`;
  return rows
    .map((row, i) => {
      const name = kind === "item" ? row.itemName ?? row.ItemName : row.activityName ?? row.ActivityName;
      const code = kind === "item" ? row.itemCode ?? row.ItemCode : row.activityCode ?? row.ActivityCode;
      const desc = row.description ?? row.Description ?? "";
      const forActivity = row.activityName ?? row.ActivityName ?? "";
      return `<tr>
      <td class="c">${i + 1}</td>
      <td><b>${e(name)}</b>${code ? ` <span class="code">${esc(code)}</span>` : ""}${desc ? `<div class="desc">${esc(desc)}</div>` : ""}</td>
      ${kind === "item" ? `<td class="act">${forActivity ? esc(forActivity) : "—"}</td>` : ""}
      <td class="r">${esc(row.quantity ?? row.Quantity ?? "")}</td>
      <td class="c">${esc(row.uomName ?? row.UomName ?? "")}</td>
      <td class="r">${fmt(num(row.rate ?? row.Rate))}</td>
      <td class="r">${fmt(amountOf(row))}</td>
    </tr>`;
    })
    .join("");
}

export function buildBoqHtml(record: BoqPdfRecord): string {
  const items = Array.isArray(record.BoqItems) ? record.BoqItems : [];
  const activities = Array.isArray(record.BoqActivities) ? record.BoqActivities : [];
  const itemTotal = sum(items);
  const activityTotal = sum(activities);
  const grand = num(record.TotalAmount) || itemTotal + activityTotal;
  const docNo = record.BoqNo || record.DocNo || `#${record.BoqID ?? ""}`;
  const company = record.CompanyName || "Company";
  const printed = new Date().toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const head = `<tr class="th"><th class="c">SL.</th><th>DESCRIPTION</th><th class="r">QTY</th><th class="c">UOM</th><th class="r">RATE</th><th class="r">AMOUNT</th></tr>`;
  const itemHead = `<tr class="th"><th class="c">SL.</th><th>DESCRIPTION</th><th>FOR ACTIVITY</th><th class="r">QTY</th><th class="c">UOM</th><th class="r">RATE</th><th class="r">AMOUNT</th></tr>`;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" /><title>BOQ ${esc(docNo)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  @page { size: A4 portrait; margin: 0; }
  html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: -apple-system, Roboto, 'Segoe UI', Arial, sans-serif; font-size: 10.5px; color: #2b2b2b; background: #fff7ea; }
  .side { position: fixed; top: 0; left: 0; bottom: 0; width: 64mm; background: #34373a; color: #fff; padding: 46mm 6mm 0 7mm; z-index: 1; }
  .side h5 { color: #f26a21; font-size: 10.5px; letter-spacing: 1.2px; margin: 14px 0 5px; text-transform: uppercase; }
  .side p { font-size: 9.5px; line-height: 1.55; color: #e9e9e9; word-break: break-word; }
  .side p span { color: #a9acb0; display: inline-block; min-width: 20mm; }
  .side .big { font-size: 12px; font-weight: 800; color: #fff; }
  .brand { position: absolute; top: 0; left: 0; width: 64mm; height: 40mm; background: #f26a21; color: #fff; z-index: 2; padding: 12mm 6mm 0 7mm; border-bottom-right-radius: 10mm; }
  .brand .mark { width: 9mm; height: 9mm; border: 2.2px solid #fff; transform: rotate(45deg) scale(.8); margin: 0 0 3mm 1mm; }
  .brand .name { font-size: 15px; font-weight: 900; letter-spacing: .6px; text-transform: uppercase; line-height: 1.15; }
  .brand .tag { font-size: 7.5px; letter-spacing: 1.2px; margin-top: 2px; opacity: .95; }
  .topbar { position: absolute; top: 0; left: 64mm; right: 0; height: 40mm; background: #fff7ea; overflow: hidden; }
  .topbar::before { content: ""; position: absolute; top: 0; left: 6mm; width: 22mm; height: 100%; background: #34373a; transform: skewX(-32deg); transform-origin: top left; }
  .topbar::after { content: ""; position: absolute; top: 0; left: 34mm; right: 0; height: 15mm; background: #f26a21; }
  .topbar h1 { position: absolute; z-index: 3; top: 4.5mm; right: 10mm; color: #fff; font-size: 25px; font-weight: 900; letter-spacing: 5px; text-transform: uppercase; }
  .topbar .status { position: absolute; z-index: 3; top: 20mm; right: 10mm; font-size: 9px; letter-spacing: 1px; text-transform: uppercase; color: #9a4a12; font-weight: 800; }
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
  .note { font-size: 9.5px; color: #555; white-space: pre-line; }
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
  <div class="brand"><div class="mark"></div><div class="name">${e(company)}</div><div class="tag">${esc(record.ProjectName || "")}</div></div>
  <div class="topbar"><h1>Bills of Quantities</h1><div class="status">${e(record.Status || "Draft")}</div></div>

  <div class="main">
    <div class="first-gap"></div>
    ${record.Description ? `<div class="note" style="margin:0 0 6mm"><b>Description</b>${esc(record.Description)}</div>` : ""}

    <h3 class="sec">Items <b>· ${items.length}</b></h3>
    <table class="t"><thead><tr class="spacer"><td colspan="7"></td></tr>${itemHead}</thead><tbody>${rowsHtml(items, "item")}</tbody>
      <tfoot><tr class="sub"><td class="k" colspan="6">Items total</td><td>${fmt(itemTotal)}</td></tr></tfoot></table>

    <h3 class="sec" style="margin-top:8mm">Activities <b>· ${activities.length}</b></h3>
    <table class="t"><thead><tr class="spacer"><td colspan="6"></td></tr>${head}</thead><tbody>${rowsHtml(activities, "activity")}</tbody>
      <tfoot><tr class="sub"><td class="k" colspan="5">Activities total</td><td>${fmt(activityTotal)}</td></tr></tfoot></table>

    <div class="block">
      <div class="totals">
        <div class="line"><span>Items</span><b>${fmt(itemTotal)}</b></div>
        <div class="line"><span>Activities</span><b>${fmt(activityTotal)}</b></div>
        <div class="grand"><span>TOTAL</span><span>: ${fmt(grand)}</span></div>
      </div>
      <div class="sign">Authorised sign</div>
      <div class="foot"><span>CivilierERP</span><span>BOQ ${esc(docNo)}</span><span>Printed ${esc(printed)}</span></div>
    </div>
    <div style="height:8mm"></div>
  </div>
</body></html>`;
}

/** Makes the BOQ's PDF named after its number and opens the share sheet (or the print dialog where sharing is missing). */
export async function shareBoqPdf(record: BoqPdfRecord): Promise<void> {
  const { uri } = await Print.printToFileAsync({ html: buildBoqHtml(record), width: 595, height: 842 });
  const ref = String(record.BoqNo || record.DocNo || `BOQ_${record.BoqID ?? ""}`);
  let out = uri;
  try {
    const dest = new File(Paths.cache, `${ref.replace(/[^\w-]+/g, "_")}.pdf`);
    if (dest.exists) dest.delete();
    new File(uri).move(dest);
    out = dest.uri;
  } catch {
    // Keep the random file name; the PDF itself is fine.
  }
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(out, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: ref });
  } else {
    await Print.printAsync({ uri: out });
  }
}
