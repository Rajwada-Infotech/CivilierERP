/**
 * printList — prints a list page's rows as a plain, light table in its own window (the live page uses theme colours
 * and controls that don't print cleanly). Takes the same ExportColumn[] the page's ExportMenu uses, so Print and
 * Export always show the same columns.
 *
 *   printList({ title: "Work Orders", subtitle: "Project: Royal Garden", columns, rows });
 */
import { toast } from "sonner";
import { escapeHtml } from "@/utils/escapeHtml";
import { getCell, type ExportColumn } from "./export";

export interface PrintListOptions {
  title: string;
  /** The filters in force, shown under the title (e.g. "Status: Approved · Search: tower"). */
  subtitle?: string;
  columns: ExportColumn[];
  rows: Record<string, unknown>[];
  /** Headers of columns to right-align (amounts, quantities). */
  numeric?: string[];
}

export function printList({ title, subtitle, columns, rows, numeric = [] }: PrintListOptions) {
  if (!rows.length) {
    toast.info("Nothing to print — the list is empty.");
    return;
  }
  const right = new Set(numeric);
  const align = (h: string) => (right.has(h) ? ' style="text-align:right"' : "");
  const head = columns.map((c) => `<th${align(c.header)}>${escapeHtml(c.header)}</th>`).join("");
  const body = rows
    .map((r, i) => `<tr><td class="n">${i + 1}</td>${columns.map((c) => `<td${align(c.header)}>${escapeHtml(getCell(r, c)) || "—"}</td>`).join("")}</tr>`)
    .join("");
  const printed = new Date().toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8" /><title>${escapeHtml(title)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px; color: #111827; background: #fff; padding: 24px; }
  header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #111827; padding-bottom: 10px; margin-bottom: 14px; }
  h1 { font-size: 18px; font-weight: 800; letter-spacing: 0.01em; }
  .sub { color: #4b5563; margin-top: 4px; font-size: 11px; }
  .meta { text-align: right; color: #6b7280; font-size: 10px; line-height: 1.5; }
  table { width: 100%; border-collapse: collapse; }
  thead th { background: #f3f4f6; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #374151;
    text-align: left; padding: 7px 8px; border-bottom: 1px solid #9ca3af; }
  tbody td { padding: 6px 8px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
  tbody tr:nth-child(even) td { background: #fafafa; }
  td.n, th.n { color: #9ca3af; width: 28px; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  footer { margin-top: 14px; color: #9ca3af; font-size: 9px; display: flex; justify-content: space-between; }
  @page { size: A4 landscape; margin: 12mm; }
  @media print { body { padding: 0; } }
</style></head>
<body>
  <header>
    <div><h1>${escapeHtml(title)}</h1>${subtitle ? `<div class="sub">${escapeHtml(subtitle)}</div>` : ""}</div>
    <div class="meta">${rows.length} record${rows.length === 1 ? "" : "s"}<br />Printed ${escapeHtml(printed)}</div>
  </header>
  <table>
    <thead><tr><th class="n">#</th>${head}</tr></thead>
    <tbody>${body}</tbody>
  </table>
  <footer><span>CivilierERP</span><span>${escapeHtml(title)}</span></footer>
</body></html>`;

  openPrintWindow(html);
}

/** Opens a complete HTML document in its own window and prints it (also used by single-record prints). */
export function openPrintWindow(html: string) {
  const blobUrl = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
  const win = window.open(blobUrl, "_blank", "width=1100,height=760");
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
