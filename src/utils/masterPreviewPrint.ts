import { toast } from "sonner";
import { DM_SANS_FACE_CSS, embedDmSans, printWhenFontsReady } from "@/utils/documentFont";

type PreviewField = {
  label: string;
  value?: string | number | boolean | null;
};

type PreviewCell = string | number | null | undefined;

/** Tabular section body (line items, ledger lines, ...) — rendered as a real
 *  table in both Print and PDF instead of label/value pairs. */
type PreviewTable = {
  columns: { header: string; align?: "left" | "right" | "center" }[];
  rows: PreviewCell[][];
  /** Optional totals row, one cell per column. */
  footer?: PreviewCell[];
};

export type PreviewSection = {
  title: string;
  fields: PreviewField[];
  table?: PreviewTable;
};

type PrintPreviewOptions = {
  title: string;
  subtitle: string;
  code?: string | null;
  status?: string | null;
  logo?: string | null;
  sections: PreviewSection[];
};

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const display = (value: PreviewField["value"]) => {
  if (value === true) return "Yes";
  if (value === false) return "No";
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
};

export function printMasterPreview({
  title,
  subtitle,
  code,
  status,
  logo,
  sections,
}: PrintPreviewOptions) {
  const logoHtml = logo
    ? `<img src="${escapeHtml(logo)}" alt="Logo" style="height:58px;max-width:180px;object-fit:contain;" />`
    : `<span style="font-size:20px;font-weight:800;color:#4f46e5;">Civilier ERP</span>`;

  const tableHtml = (t: PreviewTable) => {
    const align = (a?: string) => (a === "right" ? "right" : a === "center" ? "center" : "left");
    const head = t.columns
      .map((c) => `<th style="text-align:${align(c.align)}">${escapeHtml(c.header)}</th>`)
      .join("");
    const body = t.rows
      .map(
        (r) =>
          `<tr>${t.columns
            .map((c, i) => `<td style="text-align:${align(c.align)}">${escapeHtml(display(r[i]))}</td>`)
            .join("")}</tr>`,
      )
      .join("");
    const foot = t.footer
      ? `<tfoot><tr>${t.columns
          .map((c, i) => `<td style="text-align:${align(c.align)}">${escapeHtml(t.footer![i] ?? "")}</td>`)
          .join("")}</tr></tfoot>`
      : "";
    return `<table class="items"><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${foot}</table>`;
  };

  const sectionsHtml = sections
    .map(
      (section) => `
        <div class="section">
          <div class="section-title">${escapeHtml(section.title)}</div>
          ${
            section.table
              ? tableHtml(section.table)
              : `<div class="grid">
            ${section.fields
              .map(
                (field) => `
                  <div class="field">
                    <label>${escapeHtml(field.label)}</label>
                    <span>${escapeHtml(display(field.value))}</span>
                  </div>`,
              )
              .join("")}
          </div>`
          }
        </div>`,
    )
    .join("");

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(subtitle)} — ${escapeHtml(title || code || "")}</title>
  <style>
    ${DM_SANS_FACE_CSS}
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'DM Sans', 'Segoe UI', Arial, sans-serif; font-size: 13px; color: #111827; background: #fff; padding: 36px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 20px; border-bottom: 2px solid #4f46e5; margin-bottom: 26px; gap: 24px; }
    .doc-block { text-align: right; }
    .doc-title { font-size: 24px; font-weight: 800; color: #4f46e5; letter-spacing: -0.5px; }
    .doc-name { font-size: 15px; font-weight: 700; color: #111827; margin-top: 5px; }
    .doc-code { font-size: 12px; font-family: monospace; color: #6b7280; margin-top: 4px; }
    .badge { display: inline-block; margin-top: 8px; padding: 4px 10px; border-radius: 999px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; background: #eef2ff; color: #4338ca; }
    .section { margin-bottom: 22px; page-break-inside: avoid; }
    .section-title { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.1em; color: #4f46e5; margin-bottom: 10px; padding-bottom: 5px; border-bottom: 1px solid #e0e7ff; }
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px 16px; }
    .field { min-width: 0; }
    .field label { display: block; margin-bottom: 3px; color: #9ca3af; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; }
    .field span { display: block; color: #111827; font-size: 12px; font-weight: 500; line-height: 1.5; overflow-wrap: anywhere; }
    table.items { width: 100%; border-collapse: collapse; font-size: 12px; }
    table.items th { background: #f3f4f6; color: #6b7280; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; padding: 8px 10px; border-bottom: 1px solid #e5e7eb; }
    table.items td { padding: 8px 10px; border-bottom: 1px solid #f1f5f9; color: #111827; }
    table.items tfoot td { font-weight: 700; background: #f9fafb; border-top: 1px solid #e5e7eb; }
    .footer { margin-top: 36px; padding-top: 14px; border-top: 1px solid #e5e7eb; display: flex; justify-content: space-between; font-size: 11px; color: #9ca3af; }
    @media print {
      body { padding: 16px; }
      button { display: none !important; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div>${logoHtml}</div>
    <div class="doc-block">
      <div class="doc-title">${escapeHtml(subtitle)}</div>
      <div class="doc-name">${escapeHtml(title || "—")}</div>
      ${code ? `<div class="doc-code">${escapeHtml(code)}</div>` : ""}
      ${status ? `<span class="badge">${escapeHtml(status)}</span>` : ""}
    </div>
  </div>
  ${sectionsHtml}
  <div class="footer">
    <span>Generated by CivilierERP</span>
    <span>Printed: ${new Date().toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    })}</span>
  </div>
</body>
</html>`;

  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const blobUrl = URL.createObjectURL(blob);
  const win = window.open(blobUrl, "_blank", "width=960,height=720");
  if (!win) {
    URL.revokeObjectURL(blobUrl);
    toast.error("Pop-up blocked — please allow pop-ups for this site.");
    return;
  }
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  printWhenFontsReady(win);
}

// ─── PDF (jsPDF) ────────────────────────────────────────────────────────────
// Same {title, subtitle, code, status, sections} shape as printMasterPreview
// above — "Print" and "Generate PDF" render the identical content, just
// through different pipes (the browser's print dialog vs. a downloaded
// file), so the two buttons can never show different data for the same
// record. Portrait, single-column form layout (not src/lib/export.ts's
// landscape table export — that's for multi-row lists, this is one record).
function sanitizeForPdf(value: string): string {
  return String(value ?? "")
    .replace(/₹/g, "Rs. ")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/–|—/g, "-")
    .replace(/•/g, "-");
}

export async function downloadMasterPreviewPdf({
  title,
  subtitle,
  code,
  status,
  sections,
  filename,
}: PrintPreviewOptions & { filename: string }) {
  const { default: jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const FONT = await embedDmSans(doc);

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const marginX = 42;
  const contentW = pageW - marginX * 2;
  let y = 0;

  const ensureSpace = (needed: number) => {
    if (y + needed > pageH - 40) {
      doc.addPage();
      y = 40;
    }
  };

  // Header band
  doc.setFillColor(79, 70, 229); // indigo-600, matches printMasterPreview's accent
  doc.rect(0, 0, pageW, 64, "F");
  doc.setFont(FONT, "bold");
  doc.setFontSize(16);
  doc.setTextColor(255, 255, 255);
  doc.text(sanitizeForPdf(subtitle), marginX, 28);
  doc.setFont(FONT, "normal");
  doc.setFontSize(10);
  doc.text(sanitizeForPdf(title || code || "—"), marginX, 44);
  if (code) {
    doc.setFontSize(8);
    doc.setTextColor(199, 210, 254);
    doc.text(sanitizeForPdf(code), marginX, 56);
  }
  if (status) {
    doc.setFontSize(8);
    doc.setTextColor(255, 255, 255);
    doc.text(sanitizeForPdf(status).toUpperCase(), pageW - marginX, 28, { align: "right" });
  }
  y = 84;

  for (const section of sections) {
    ensureSpace(24);
    doc.setFont(FONT, "bold");
    doc.setFontSize(9);
    doc.setTextColor(79, 70, 229);
    doc.text(sanitizeForPdf(section.title).toUpperCase(), marginX, y);
    doc.setDrawColor(224, 231, 255);
    doc.setLineWidth(0.6);
    doc.line(marginX, y + 4, pageW - marginX, y + 4);
    y += 18;

    if (section.table) {
      const t = section.table;
      const { default: autoTable } = await import("jspdf-autotable");
      const cell = (v: PreviewCell) => sanitizeForPdf(v === null || v === undefined || v === "" ? "-" : String(v));
      autoTable(doc, {
        startY: y,
        margin: { left: marginX, right: marginX, bottom: 40 },
        head: [t.columns.map((c) => sanitizeForPdf(c.header))],
        body: t.rows.map((r) => t.columns.map((_, i) => cell(r[i]))),
        foot: t.footer ? [t.columns.map((_, i) => cell(t.footer![i]))] : undefined,
        showFoot: "lastPage",
        theme: "grid",
        styles: { font: FONT, fontSize: 8.5, cellPadding: 5, textColor: [17, 24, 39], lineColor: [229, 231, 235], lineWidth: 0.5 },
        headStyles: { fillColor: [243, 244, 246], textColor: [107, 114, 128], fontSize: 7.5, fontStyle: "bold" },
        footStyles: { fillColor: [249, 250, 251], textColor: [17, 24, 39], fontStyle: "bold" },
        columnStyles: Object.fromEntries(t.columns.map((c, i) => [i, { halign: c.align ?? "left" }])),
      });
      y = ((doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY ?? y) + 16;
      continue;
    }

    const colW = contentW / 2 - 8;
    let col = 0;
    let rowStartY = y;
    for (const field of section.fields) {
      const label = sanitizeForPdf(field.label);
      const valueRaw =
        field.value === true ? "Yes" : field.value === false ? "No" : field.value === null || field.value === undefined || field.value === "" ? "-" : String(field.value);
      const value = sanitizeForPdf(valueRaw);
      const x = marginX + col * (colW + 16);

      doc.setFont(FONT, "normal");
      doc.setFontSize(7);
      doc.setTextColor(156, 163, 175);
      doc.text(label.toUpperCase(), x, rowStartY);

      doc.setFont(FONT, "normal");
      doc.setFontSize(9.5);
      doc.setTextColor(17, 24, 39);
      const lines = doc.splitTextToSize(value, colW);
      doc.text(lines, x, rowStartY + 12);

      const rowH = 14 + lines.length * 12 + 6;
      if (col === 0) {
        col = 1;
      } else {
        col = 0;
        rowStartY += rowH;
        ensureSpace(rowH);
      }
    }
    if (col === 1) rowStartY += 14 + 12 + 6;
    y = rowStartY + 10;
  }

  doc.setFont(FONT, "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(156, 163, 175);
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.text(
      `CivilierERP  ·  Generated ${new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`,
      marginX,
      pageH - 20,
    );
    doc.text(`Page ${p} of ${pageCount}`, pageW - marginX, pageH - 20, { align: "right" });
  }

  doc.save(filename);
}
