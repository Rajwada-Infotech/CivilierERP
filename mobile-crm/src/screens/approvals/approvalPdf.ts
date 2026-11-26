// The approval's details as a PDF, for the Download key on the inbox's record page — the phone's take on the web review
// panel's "Generate PDF" (masterPreviewPrint's label / value sheet): the module and reference, status and step, the
// summary, the rejection note, the lines, and every other field of the full record, printed on a plain A4 page with
// expo-print, saved under the reference's name and handed to the share sheet (save to Files, Drive, WhatsApp, mail…).
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { File, Paths } from "expo-file-system";

export type PdfLine = { name: string; qty: string; rate?: string; amount?: string };

export interface ApprovalPdf {
  module: string;
  reference: string;
  status: string;
  summary: { label: string; value: string }[];
  rejectionNote?: string | null;
  lines: PdfLine[];
  /** Material requests have no rate or amount yet: name and quantity only. */
  quantityOnly: boolean;
  fields: { label: string; value: string }[];
}

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

const grid = (rows: { label: string; value: string }[]) =>
  `<table class="kv">${rows.map((r) => `<tr><th>${esc(r.label)}</th><td>${esc(r.value)}</td></tr>`).join("")}</table>`;

function html(d: ApprovalPdf): string {
  const printed = new Date().toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const lines = d.lines.length
    ? `<h2>Items (${d.lines.length})</h2>
       <table class="lines">
         <tr><th class="n">#</th><th>Item</th><th class="r">Qty</th>${d.quantityOnly ? "" : `<th class="r">Rate</th><th class="r">Amount</th>`}</tr>
         ${d.lines
           .map(
             (l, i) =>
               `<tr><td class="n">${i + 1}</td><td>${esc(l.name)}</td><td class="r">${esc(l.qty)}</td>${d.quantityOnly ? "" : `<td class="r">${esc(l.rate)}</td><td class="r">${esc(l.amount)}</td>`}</tr>`,
           )
           .join("")}
       </table>`
    : "";
  return `<!doctype html><html><head><meta charset="utf-8" />
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Roboto, "Segoe UI", Arial, sans-serif; color: #111; font-size: 11px; margin: 0; }
  .cap { font-size: 9px; letter-spacing: .14em; text-transform: uppercase; color: #555; }
  .head { border-bottom: 2px solid #111; padding-bottom: 10px; margin-bottom: 14px; display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; }
  h1 { font-size: 22px; margin: 4px 0 0; letter-spacing: -.02em; }
  .mark { border: 1px solid #111; padding: 3px 8px; font-size: 9px; letter-spacing: .12em; text-transform: uppercase; white-space: nowrap; }
  h2 { font-size: 10px; letter-spacing: .14em; text-transform: uppercase; margin: 18px 0 6px; padding-bottom: 4px; border-bottom: 1px solid #111; }
  table { width: 100%; border-collapse: collapse; }
  .kv th { width: 34%; text-align: left; font-weight: 600; color: #555; padding: 5px 8px 5px 0; vertical-align: top; border-bottom: 1px solid #e3e3e3; }
  .kv td { padding: 5px 0; border-bottom: 1px solid #e3e3e3; word-break: break-word; }
  .lines th { text-align: left; font-size: 9px; letter-spacing: .1em; text-transform: uppercase; color: #555; border-bottom: 1px solid #111; padding: 5px 6px; }
  .lines td { padding: 5px 6px; border-bottom: 1px solid #e3e3e3; vertical-align: top; }
  .r { text-align: right; white-space: nowrap; } .n { width: 24px; color: #777; }
  .note { border: 1px solid #b42318; color: #b42318; padding: 8px 10px; margin-top: 12px; }
  .foot { margin-top: 22px; padding-top: 6px; border-top: 1px solid #e3e3e3; color: #777; font-size: 9px; }
</style></head><body>
  <div class="head">
    <div><div class="cap">CivilierERP · Approvals · ${esc(d.module)}</div><h1>${esc(d.reference)}</h1></div>
    <div class="mark">${esc(d.status)}</div>
  </div>
  <h2>Summary</h2>
  ${grid(d.summary)}
  ${d.rejectionNote ? `<div class="note"><b>Rejection note:</b> ${esc(d.rejectionNote)}</div>` : ""}
  ${lines}
  ${d.fields.length ? `<h2>Full record</h2>${grid(d.fields)}` : ""}
  <div class="foot">Downloaded from the CivilierERP Admin app · ${esc(printed)}</div>
</body></html>`;
}

/** Prints the approval to a PDF named after its reference and opens the share sheet (or the print dialog, where the
 * phone has no sharing). */
export async function downloadApprovalPdf(d: ApprovalPdf): Promise<void> {
  const { uri } = await Print.printToFileAsync({ html: html(d) });
  let out = uri;
  // printToFileAsync names the file at random; give it the reference's name so it reads properly where it is saved.
  try {
    const name = `${(d.reference || "approval").replace(/[^\w-]+/g, "_")}.pdf`;
    const dest = new File(Paths.cache, name);
    if (dest.exists) dest.delete();
    new File(uri).move(dest);
    out = dest.uri;
  } catch {
    // Keep the random name; the PDF itself is fine.
  }
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(out, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: d.reference });
  } else {
    await Print.printAsync({ uri: out });
  }
}
