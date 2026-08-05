/**
 * export.ts — data-export utilities for CivilierERP
 *
 * Three formats:
 *  • CSV  — zero deps, always works
 *  • XLSX — native aoa approach via a lightweight ArrayBuffer writer (no SheetJS)
 *  • PDF  — jsPDF + jspdf-autotable (browser-native, Vite-safe)
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ExportColumn {
  header: string;
  accessor: string | ((row: Record<string, unknown>) => unknown);
}

export interface PdfStatCard {
  label: string;
  value: string;
}

export interface PdfExportOptions {
  title: string;
  filename?: string;
  /** Filter context shown as a subtitle pill e.g. "Company: Eshita Builders" */
  subtitle?: string;
  /** Hex colour for table header row — defaults to #1e3a5f */
  headerColor?: string;
  /** Company name shown top-right */
  companyName?: string;
  /** Company sub-line (address / GST / email) shown under company name */
  companyAddress?: string;
  /** Base64 logo — shown top-right next to company name */
  logoBase64?: string;
  /** Summary stat cards rendered below the header band */
  stats?: PdfStatCard[];
  /**
   * Optional per-column cellPadding override, keyed by column index.
   * Use to tighten left padding on a column with deep text indentation
   * (e.g. a hierarchical Account/Name column) without affecting other reports.
   */
  columnPadding?: Record<
    number,
    {
      cellPadding?: {
        top?: number;
        bottom?: number;
        left?: number;
        right?: number;
      };
    }
  >;
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

function getCell(row: Record<string, unknown>, col: ExportColumn): string {
  const raw =
    typeof col.accessor === "function" ? col.accessor(row) : row[col.accessor];
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "boolean") return raw ? "Yes" : "No";
  return String(raw);
}

// jsPDF Helvetica only covers Latin-1. Replace known out-of-range chars.
function sanitizeForPdf(value: string): string {
  return value
    .replace(/₹/g, "Rs.")
    .replace(/[\u2500-\u257F]/g, "-")
    .replace(/[^\u0020-\u00FF]/g, "?");
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

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
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
  // Leading UTF-8 BOM — without it, Excel opens the file using the system's
  // ANSI codepage instead of UTF-8, garbling any non-ASCII character (₹, —,
  // etc.) into mojibake like "â‚¹"/"â€"" even though the bytes are valid UTF-8.
  const blob = new Blob(["﻿", `${header}\n${body}`], {
    type: "text/csv;charset=utf-8;",
  });
  triggerDownload(blob, `${filename}.csv`);
}

/**
 * Parses raw CSV text into an array of row objects keyed by header.
 * Handles quoted fields containing commas, escaped quotes (""), and
 * both \n and \r\n line endings. Blank trailing lines are ignored.
 *
 * This is intentionally dependency-free (no papaparse) to match the
 * zero-dep philosophy of exportToCsv above.
 */
export function parseCsv(text: string): Record<string, string>[] {
  // Strip a UTF-8 BOM if present (common when Excel saves CSVs).
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];
    const next = clean[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        i++; // skip the escaped quote pair
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      // Treat \r\n as one break — skip the \n that follows a \r.
      if (char === "\r" && next === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  // Flush the final field/row if the file doesn't end in a newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Drop fully-empty trailing rows (e.g. a stray blank line at EOF).
  while (rows.length && rows[rows.length - 1].every((c) => c.trim() === "")) {
    rows.pop();
  }

  if (rows.length === 0) return [];

  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((cells) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = (cells[i] ?? "").trim();
    });
    return obj;
  });
}

// ─── XLSX (lightweight — no SheetJS) ─────────────────────────────────────────

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
  const allRows = [
    columns.map((c) => c.header),
    ...rows.map((row) => columns.map((c) => getCell(row, c))),
  ];
  const rowsXml = allRows
    .map((cells, ri) => {
      const cellsXml = cells
        .map((val, ci) => {
          const col = String.fromCharCode(65 + ci);
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
  const wbXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;
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

  const { zipSync, strToU8 } = await import("fflate");
  const zipped = zipSync({
    "[Content_Types].xml": strToU8(contentTypes),
    "_rels/.rels": strToU8(pkgRels),
    "xl/workbook.xml": strToU8(wbXml),
    "xl/_rels/workbook.xml.rels": strToU8(wbRels),
    "xl/worksheets/sheet1.xml": strToU8(wsXml),
  });
  const blob = new Blob([zipped.buffer as ArrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  triggerDownload(blob, `${filename}.xlsx`);
}

// ─── PDF (jsPDF + jspdf-autotable) ────────────────────────────────────────────
// Layout (landscape A4, 841 × 595 pt):
//
//  ┌─────────────────────────────────────────────────────────────┐
//  │  [HEADER BAND — dark navy fill, full width]                  │
//  │   Report title (bold white, large)          [Logo] CompanyName│
//  │   Export date · N records                   CompanyAddress   │
//  └─────────────────────────────────────────────────────────────┘
//  │  [SUBTITLE PILL — if filter active]                          │
//  │  [STAT CARDS — 3–4 cards, light grey fills]                 │
//  ┌─────────────────────────────────────────────────────────────┐
//  │  TABLE (navy header, alt-row shading, thin borders)          │
//  └─────────────────────────────────────────────────────────────┘
//  │  Footer: CivilierERP · title                Page N of M     │

export async function exportToPdf(
  rows: Record<string, unknown>[],
  columns: ExportColumn[],
  options: PdfExportOptions,
): Promise<void> {
  const {
    title,
    filename = "export",
    subtitle,
    headerColor = "#1e3a5f",
    companyName,
    companyAddress,
    logoBase64,
    stats,
  } = options;

  const { default: jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");

  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });

  const pageW = doc.internal.pageSize.getWidth(); // 841.89
  const pageH = doc.internal.pageSize.getHeight(); // 595.28
  const marginX = 36;

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

  const [hr, hg, hb] = hexToRgb(headerColor);

  // ── 1. Header band ────────────────────────────────────────────────────────
  const bandH = 64;
  doc.setFillColor(hr, hg, hb);
  doc.rect(0, 0, pageW, bandH, "F");

  // Left: Report title
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(255, 255, 255);
  doc.text(sanitizeForPdf(title), marginX, 26);

  // Left: subtitle line
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(180, 200, 230);
  const metaLine = `Exported on ${dateStr} at ${timeStr}  ·  ${rows.length} record${rows.length !== 1 ? "s" : ""}`;
  doc.text(metaLine, marginX, 40);

  // Right: logo + company block
  let rightX = pageW - marginX;
  const logoSize = 38;
  const logoY = (bandH - logoSize) / 2;

  if (logoBase64) {
    try {
      // Detect image type from data URI or default to JPEG
      const imgType = logoBase64.startsWith("data:image/png") ? "PNG" : "JPEG";
      const logoX = rightX - logoSize;
      doc.addImage(logoBase64, imgType, logoX, logoY, logoSize, logoSize);
      rightX = logoX - 8;
    } catch {
      // logo failed — continue without it
    }
  }

  if (companyName) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(255, 255, 255);
    doc.text(sanitizeForPdf(companyName), rightX, 24, { align: "right" });
  }
  if (companyAddress) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(180, 200, 230);
    doc.text(sanitizeForPdf(companyAddress), rightX, 36, { align: "right" });
  }

  // Thin accent line at bottom of band
  doc.setDrawColor(255, 255, 255);
  doc.setLineWidth(0.4);
  doc.line(0, bandH, pageW, bandH);

  let cursorY = bandH + 14;

  // ── 2. Active filter pill ─────────────────────────────────────────────────
  if (subtitle) {
    const pillW = Math.min(
      doc.getStringUnitWidth(sanitizeForPdf(subtitle)) * 7.5 + 24,
      320,
    );
    doc.setFillColor(235, 241, 255);
    doc.roundedRect(marginX, cursorY, pillW, 15, 3, 3, "F");
    doc.setDrawColor(180, 200, 240);
    doc.setLineWidth(0.5);
    doc.roundedRect(marginX, cursorY, pillW, 15, 3, 3, "S");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(hr, hg, hb);
    doc.text(sanitizeForPdf(subtitle), marginX + 8, cursorY + 10);
    cursorY += 26;
  }

  // ── 3. Stat cards ─────────────────────────────────────────────────────────
  if (stats && stats.length > 0) {
    const cardCount = stats.length;
    const gap = 10;
    const totalGap = gap * (cardCount - 1);
    const cardW = (pageW - marginX * 2 - totalGap) / cardCount;
    const cardH = 48;

    stats.forEach((s, i) => {
      const cx = marginX + i * (cardW + gap);
      const cy = cursorY;

      // Card background
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(cx, cy, cardW, cardH, 4, 4, "F");
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.5);
      doc.roundedRect(cx, cy, cardW, cardH, 4, 4, "S");

      // Top accent bar
      doc.setFillColor(hr, hg, hb);
      doc.rect(cx, cy, cardW, 3, "F");

      // Label
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(100, 116, 139);
      doc.text(sanitizeForPdf(s.label.toUpperCase()), cx + 10, cy + 16);

      // Value
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.setTextColor(15, 23, 42);
      doc.text(sanitizeForPdf(s.value), cx + 10, cy + 36);
    });

    cursorY += cardH + 16;
  }

  // ── 4. Table ──────────────────────────────────────────────────────────────
  const head = [columns.map((c) => c.header)];
  const body = rows.map((row) => columns.map((c) => getPdfCell(row, c)));

  autoTable(doc, {
    head,
    body,
    startY: cursorY,
    margin: { left: marginX, right: marginX },
    tableLineColor: [226, 232, 240],
    tableLineWidth: 0.3,
    styles: {
      fontSize: 7.5,
      cellPadding: { top: 5, bottom: 5, left: 6, right: 6 },
      textColor: [51, 65, 85],
      lineColor: [241, 245, 249],
      lineWidth: 0.3,
    },
    headStyles: {
      fillColor: [hr, hg, hb],
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 7,
      cellPadding: { top: 6, bottom: 6, left: 6, right: 6 },
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    columnStyles: {
      // Right-align numeric columns heuristically — columns whose header contains
      // "Amount", "No", "Count" get right alignment
      ...Object.fromEntries(
        columns
          .map((c, i) =>
            /amount|count|qty|no\.?$/i.test(c.header)
              ? [i, { halign: "right" as const }]
              : null,
          )
          .filter(Boolean) as [number, { halign: "right" }][],
      ),
      // Optional per-export override for specific column indices (e.g. tighter
      // left padding on a name/account column with deep indentation).
      ...(options.columnPadding ?? {}),
    },
    didDrawPage: (data: any) => {
      // Footer band
      const pageCount = (doc as any).internal.getNumberOfPages();
      doc.setFillColor(248, 250, 252);
      doc.rect(0, pageH - 22, pageW, 22, "F");
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.4);
      doc.line(0, pageH - 22, pageW, pageH - 22);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.5);
      doc.setTextColor(148, 163, 184);
      doc.text(`CivilierERP  ·  ${sanitizeForPdf(title)}`, marginX, pageH - 8);
      doc.text(
        `Page ${data.pageNumber} of ${pageCount}`,
        pageW - marginX,
        pageH - 8,
        { align: "right" },
      );
    },
  });

  doc.save(`${filename}.pdf`);
}
