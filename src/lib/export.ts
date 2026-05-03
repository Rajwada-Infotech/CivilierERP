/**
 * export.ts — data-export utilities for CivilierERP
 *
 * Three formats:
 *  • CSV  — zero deps, always works
 *  • XLSX — native aoa approach via a lightweight ArrayBuffer writer (no SheetJS)
 *  • PDF  — jsPDF + jspdf-autotable (browser-native, Vite-safe)
 *
 * Usage:
 *   exportToCsv(rows, columns, "bank-master")
 *   exportToXlsx(rows, columns, "bank-master")
 *   exportToPdf(rows, columns, { title: "Bank Master", filename: "bank-master" })
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ExportColumn {
  /** Header label shown in the output file */
  header: string;
  /** Key on each data row, or accessor function */
  accessor: string | ((row: Record<string, unknown>) => unknown);
}

export interface PdfExportOptions {
  title: string;
  filename?: string;
  /** Optional subtitle / date range shown under the title */
  subtitle?: string;
  /** Hex colour for header row background — defaults to brand blue */
  headerColor?: string;
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

function getCell(row: Record<string, unknown>, col: ExportColumn): string {
  const raw =
    typeof col.accessor === "function" ? col.accessor(row) : row[col.accessor];
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "boolean") return raw ? "Yes" : "No";
  return String(raw);
}

// jsPDF's built-in Helvetica only covers Latin-1 (ISO 8859-1).
// Characters outside that range (e.g. ₹ U+20B9) render as garbage glyphs.
// This helper replaces known symbols with ASCII-safe equivalents for PDF output.
function sanitizeForPdf(value: string): string {
  return value
    .replace(/₹/g, "Rs.") // Indian rupee sign → Rs.
    .replace(/[^\x00-\xFF]/g, "?"); // any remaining non-Latin1 → ?
}

function getPdfCell(row: Record<string, unknown>, col: ExportColumn): string {
  return sanitizeForPdf(getCell(row, col));
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── CSV ──────────────────────────────────────────────────────────────────────

export function exportToCsv(
  rows: Record<string, unknown>[],
  columns: ExportColumn[],
  filename = "export",
): void {
  const escape = (v: string) =>
    v.includes(",") || v.includes('"') || v.includes("\n")
      ? `"${v.replace(/"/g, '""')}"`
      : v;

  const header = columns.map((c) => escape(c.header)).join(",");
  const body = rows
    .map((row) => columns.map((c) => escape(getCell(row, c))).join(","))
    .join("\n");

  const blob = new Blob([`${header}\n${body}`], {
    type: "text/csv;charset=utf-8;",
  });
  triggerDownload(blob, `${filename}.csv`);
}

// ─── XLSX (lightweight — no SheetJS) ─────────────────────────────────────────
// Writes a minimal XLSX using the Open XML SpreadsheetML spec.
// No external dependency required — generates a valid .xlsx that Excel,
// LibreOffice, and Google Sheets can all open.

function escapeXml(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function exportToXlsx(
  rows: Record<string, unknown>[],
  columns: ExportColumn[],
  filename = "export",
  sheetName = "Sheet1",
): Promise<void> {
  // Build rows: header first
  const allRows = [
    columns.map((c) => c.header),
    ...rows.map((row) => columns.map((c) => getCell(row, c))),
  ];

  // ── Worksheet XML ──────────────────────────────────────────────────────────
  const rowsXml = allRows
    .map((cells, ri) => {
      const cellsXml = cells
        .map((val, ci) => {
          const col = String.fromCharCode(65 + ci); // A, B, C ...
          const ref = `${col}${ri + 1}`;
          const safe = escapeXml(val);
          return `<c r="${ref}" t="inlineStr"><is><t>${safe}</t></is></c>`;
        })
        .join("");
      return `<row r="${ri + 1}">${cellsXml}</row>`;
    })
    .join("");

  const wsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${rowsXml}</sheetData>
</worksheet>`;

  // ── Workbook XML ───────────────────────────────────────────────────────────
  const wbXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;

  // ── Relationships ──────────────────────────────────────────────────────────
  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"
    Target="worksheets/sheet1.xml"/>
</Relationships>`;

  const pkgRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"
    Target="xl/workbook.xml"/>
</Relationships>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml"  ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml"
    ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml"
    ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;

  // ── Zip using fflate (bundled with Vite) ───────────────────────────────────
  const { zipSync, strToU8 } = await import("fflate");

  const zipped = zipSync({
    "[Content_Types].xml": strToU8(contentTypes),
    "_rels/.rels": strToU8(pkgRels),
    "xl/workbook.xml": strToU8(wbXml),
    "xl/_rels/workbook.xml.rels": strToU8(wbRels),
    "xl/worksheets/sheet1.xml": strToU8(wsXml),
  });

  const blob = new Blob([zipped], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  triggerDownload(blob, `${filename}.xlsx`);
}

// ─── PDF (jsPDF + jspdf-autotable) ────────────────────────────────────────────

export async function exportToPdf(
  rows: Record<string, unknown>[],
  columns: ExportColumn[],
  options: PdfExportOptions,
): Promise<void> {
  const {
    title,
    filename = "export",
    subtitle,
    headerColor = "#1e40af",
  } = options;

  const { default: jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");

  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });

  const now = new Date();
  const dateStr = now.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const timeStr = now.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  });

  // ── Header ────────────────────────────────────────────────────────────────
  const pageW = doc.internal.pageSize.getWidth();

  doc.setFontSize(16);
  doc.setTextColor("#0f172a");
  doc.setFont("helvetica", "bold");
  doc.text(title, 36, 40);

  let cursorY = 52;

  if (subtitle) {
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor("#64748b");
    doc.text(subtitle, 36, cursorY);
    cursorY += 12;
  }

  doc.setFontSize(7);
  doc.setTextColor("#94a3b8");
  doc.text(
    `Exported on ${dateStr} at ${timeStr} · ${rows.length} record${rows.length !== 1 ? "s" : ""}`,
    36,
    cursorY,
  );
  cursorY += 6;

  // Thin divider
  doc.setDrawColor("#e2e8f0");
  doc.setLineWidth(0.5);
  doc.line(36, cursorY, pageW - 36, cursorY);
  cursorY += 8;

  // ── Table ─────────────────────────────────────────────────────────────────
  const head = [columns.map((c) => c.header)];
  const body = rows.map((row) => columns.map((c) => getPdfCell(row, c)));

  // Parse hex to RGB for jsPDF
  const hexToRgb = (hex: string) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return [r, g, b] as [number, number, number];
  };
  const [hr, hg, hb] = hexToRgb(headerColor);

  autoTable(doc, {
    head,
    body,
    startY: cursorY,
    margin: { left: 36, right: 36 },
    styles: {
      fontSize: 7.5,
      cellPadding: 4,
      textColor: "#334155",
      lineColor: "#f1f5f9",
      lineWidth: 0.3,
    },
    headStyles: {
      fillColor: [hr, hg, hb],
      textColor: "#ffffff",
      fontStyle: "bold",
      fontSize: 7,
    },
    alternateRowStyles: {
      fillColor: "#f8fafc",
    },
    didDrawPage: (data: any) => {
      // Footer on every page
      const pageCount = (doc as any).internal.getNumberOfPages();
      doc.setFontSize(7);
      doc.setTextColor("#94a3b8");
      doc.text(
        `CivilierERP · ${title}`,
        36,
        doc.internal.pageSize.getHeight() - 16,
      );
      doc.text(
        `Page ${data.pageNumber} of ${pageCount}`,
        pageW - 36,
        doc.internal.pageSize.getHeight() - 16,
        { align: "right" },
      );
    },
  });

  doc.save(`${filename}.pdf`);
}
