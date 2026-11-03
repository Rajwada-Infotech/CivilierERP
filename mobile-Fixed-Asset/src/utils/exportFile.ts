// Export a table as PDF, Excel (.xlsx) or CSV and hand the file to the OS share sheet. Mirrors the web app's
// ExportMenu (lib/export.ts): the same three formats.
import * as FileSystem from "expo-file-system/legacy";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";

export type ExportFormat = "pdf" | "xlsx" | "csv";

export interface ExportColumn<T> {
  header: string;
  value: (row: T) => string | number | null | undefined;
}

const cell = <T,>(row: T, c: ExportColumn<T>): string => {
  const v = c.value(row);
  return v == null ? "" : String(v);
};

const HTML_ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => HTML_ESC[ch]);
// XML 1.0 cannot carry control characters.
const escapeXml = (s: string) => escapeHtml(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : "=";
    out += i + 2 < bytes.length ? B64[n & 63] : "=";
  }
  return out;
}

function csvText<T>(rows: T[], cols: ExportColumn<T>[]): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  // The BOM makes Excel read the file as UTF-8 (₹, —).
  return "﻿" + [cols.map((c) => esc(c.header)).join(","), ...rows.map((r) => cols.map((c) => esc(cell(r, c))).join(","))].join("\n");
}

const colLetter = (i: number) => {
  let n = i + 1, s = "";
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
};

async function xlsxBytes<T>(rows: T[], cols: ExportColumn<T>[], sheetName: string): Promise<Uint8Array> {
  const { zipSync, strToU8 } = await import("fflate");
  const all = [cols.map((c) => c.header), ...rows.map((r) => cols.map((c) => cell(r, c)))];
  const sheetData = all
    .map((cells, ri) => `<row r="${ri + 1}">${cells.map((v, ci) => `<c r="${colLetter(ci)}${ri + 1}" t="inlineStr"><is><t>${escapeXml(v)}</t></is></c>`).join("")}</row>`)
    .join("");
  const widths = cols.map((_, ci) => Math.min(60, Math.max(10, ...all.map((r) => r[ci].length)) + 2));
  const colsXml = `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>`;
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  return zipSync({
    "[Content_Types].xml": strToU8(`${head}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`),
    "_rels/.rels": strToU8(`${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`${head}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${escapeXml(sheetName.replace(/[\\/?*[\]:]/g, " ").slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`),
    "xl/worksheets/sheet1.xml": strToU8(`${head}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${colsXml}<sheetData>${sheetData}</sheetData></worksheet>`),
  });
}

function pdfHtml<T>(title: string, rows: T[], cols: ExportColumn<T>[]): string {
  const head = cols.map((c) => `<th>${escapeHtml(c.header)}</th>`).join("");
  const body = rows.map((r) => `<tr>${cols.map((c) => `<td>${escapeHtml(cell(r, c))}</td>`).join("")}</tr>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page{size:A4 landscape;margin:10mm}
    body{font-family:Arial,Helvetica,sans-serif;color:#111}
    h1{font-size:15pt;margin:0 0 2mm}
    p{font-size:8pt;color:#555;margin:0 0 4mm}
    table{border-collapse:collapse;width:100%}
    th{background:#1e3a5f;color:#fff;font-size:7pt;text-align:left;padding:1.5mm;text-transform:uppercase}
    td{font-size:7.5pt;padding:1.4mm;border-bottom:.2mm solid #ccc;vertical-align:top}
    tr{page-break-inside:avoid}
  </style></head><body><h1>${escapeHtml(title)}</h1><p>${rows.length} rows · ${new Date().toLocaleString("en-IN")}</p>
  <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></body></html>`;
}

/** Builds the file in the cache folder and opens the share sheet. */
export async function exportRows<T>(opts: { format: ExportFormat; title: string; filename: string; rows: T[]; columns: ExportColumn<T>[] }): Promise<void> {
  const { format, title, filename, rows, columns } = opts;
  if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing is not available on this device.");
  const stamp = new Date().toISOString().slice(0, 10);
  const target = `${FileSystem.cacheDirectory}${filename}-${stamp}.${format}`;
  let mime: string;

  if (format === "pdf") {
    const out = await Print.printToFileAsync({ html: pdfHtml(title, rows, columns) });
    await FileSystem.deleteAsync(target, { idempotent: true });
    await FileSystem.moveAsync({ from: out.uri, to: target });
    mime = "application/pdf";
  } else if (format === "xlsx") {
    await FileSystem.writeAsStringAsync(target, toBase64(await xlsxBytes(rows, columns, title)), { encoding: FileSystem.EncodingType.Base64 });
    mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  } else {
    await FileSystem.writeAsStringAsync(target, csvText(rows, columns), { encoding: FileSystem.EncodingType.UTF8 });
    mime = "text/csv";
  }
  await Sharing.shareAsync(target, { mimeType: mime, dialogTitle: title, UTI: format === "pdf" ? "com.adobe.pdf" : undefined });
}
