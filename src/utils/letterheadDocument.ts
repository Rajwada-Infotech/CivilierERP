// Letterhead-style document — the shared printable / PDF layout for the
// Material Request, Purchase Order (and any document that follows). Modelled on
// a classic "invoice" template: a coloured side rail (logo + company contact)
// down the left; a "to" block and the title/number/date top-right; a ruled item
// table; a summary; notes; a signature line and a terms footer.
//
// One LetterheadDoc feeds both Print (HTML in a new window) and Generate PDF
// (jsPDF), so the two can never disagree. Font: DM Sans (see documentFont.ts).
import { toast } from "sonner";
import { escapeHtml } from "@/utils/escapeHtml";
import { DM_SANS_FACE_CSS, embedDmSans, printWhenFontsReady } from "@/utils/documentFont";

export interface LetterheadCompany {
  name: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  gst?: string | null;
  logo?: string | null;
}

export interface LetterheadColumn {
  header: string;
  align?: "left" | "right" | "center";
  /** Fixed width in mm. The first column (the description) is left flexible. */
  widthMm?: number;
}

export interface LetterheadRow {
  /** cells[0] is the description (bold); the rest line up with `columns`. */
  cells: (string | number | null | undefined)[];
  /** Small grey line under the description (remarks, item notes). */
  sub?: string | null;
}

export interface LetterheadSummaryRow {
  label: string;
  value: string;
  bold?: boolean;
  /** Draw a rule above this row (e.g. the grand total). */
  rule?: boolean;
}

export interface LetterheadBlock {
  label: string;
  /** First line is rendered bold. */
  lines: string[];
}

export interface LetterheadDoc {
  title: string;
  docNo: string;
  /** Already formatted, e.g. "01 Oct 2026". */
  date?: string | null;
  status?: string | null;
  company: LetterheadCompany;
  /** Stacked blocks on the left of the header ("Requested For", "Order To", ...). */
  toBlocks: LetterheadBlock[];
  columns: LetterheadColumn[];
  rows: LetterheadRow[];
  summary: LetterheadSummaryRow[];
  notes?: { title: string; lines: string[] }[];
  signLabel: string;
  signName?: string | null;
  termsTitle?: string;
  terms: string;
}

// Side-rail palette — change here to re-colour every document, Print and PDF.
const PLUM = "#6b2a6d";
const CRIMSON = "#a3262f";
const ORANGE = "#e3822f";
const INK = "#1f2937";

export const fmtDocDate = (d?: string | null) => {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt.getTime())
    ? "—"
    : dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

/** Company letterhead details (address, phone, email, GST, logo) for a company id. */
export async function loadCompanyLetterhead(
  companyId: number | string | null | undefined,
  fallbackName: string | null | undefined,
): Promise<LetterheadCompany> {
  const base = { name: fallbackName || "CivilierERP" };
  if (!companyId) return base;
  try {
    const { getCompanyDetails } = await import("@/api/purchaseOrdersApi");
    const c = await getCompanyDetails(companyId);
    if (!c) return base;
    return {
      name: c.name || base.name,
      address: [c.address, c.address_line2, [c.city, c.state].filter(Boolean).join(", "), c.pincode]
        .filter(Boolean)
        .join(", "),
      phone: c.phone_number,
      email: c.email,
      gst: c.gst_no,
      logo: c.logo,
    };
  } catch {
    return base;
  }
}

const cellText = (v: string | number | null | undefined) =>
  v === null || v === undefined || v === "" ? "—" : String(v);

// ─── Print (HTML) ────────────────────────────────────────────────────────────

export function printLetterhead(d: LetterheadDoc) {
  const c = d.company;
  const safeLogo = c.logo && /^(https?:\/\/|data:image\/|\/)/i.test(c.logo) ? escapeHtml(c.logo) : "";
  const logoHtml = safeLogo ? `<div class="logo"><img src="${safeLogo}" alt="" /></div>` : "";

  const contact = (label: string, value?: string | null) =>
    value ? `<div class="c-item"><span>${label}</span>${escapeHtml(value)}</div>` : "";

  const thead = [
    `<th style="width:8mm">#</th>`,
    ...d.columns.map(
      (col) =>
        `<th class="${col.align ?? "left"}"${col.widthMm ? ` style="width:${col.widthMm}mm"` : ""}>${escapeHtml(col.header)}</th>`,
    ),
  ].join("");

  const rows = d.rows
    .map(
      (r, i) => `<tr>
        <td class="n">${i + 1}</td>
        <td class="desc"><b>${escapeHtml(cellText(r.cells[0]))}</b>${r.sub ? `<small>${escapeHtml(r.sub)}</small>` : ""}</td>
        ${d.columns
          .slice(1)
          .map((col, k) => `<td class="${col.align ?? "left"}">${escapeHtml(cellText(r.cells[k + 1]))}</td>`)
          .join("")}
      </tr>`,
    )
    .join("");

  const toHtml = d.toBlocks
    .map(
      (b) => `<div class="blk"><small class="lbl">${escapeHtml(b.label)}</small>${b.lines
        .filter(Boolean)
        .map((l, i) => (i === 0 ? `<b>${escapeHtml(l)}</b>` : `<small>${escapeHtml(l)}</small>`))
        .join("")}</div>`,
    )
    .join("");

  const sumHtml = d.summary
    .map(
      (s) =>
        `<div class="${s.rule ? "big" : ""}${s.bold ? " bold" : ""}"><span>${escapeHtml(s.label)}</span><span>${escapeHtml(s.value)}</span></div>`,
    )
    .join("");

  const notesHtml = (d.notes ?? [])
    .map((n) => `<h4>${escapeHtml(n.title)}</h4>${n.lines.map((l) => escapeHtml(l)).join("<br/>")}`)
    .join("<div style=\"height:2mm\"></div>");

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8" />
<title>${escapeHtml(d.title)} — ${escapeHtml(d.docNo)}</title>
<style>
  ${DM_SANS_FACE_CSS}
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: 'DM Sans', 'Segoe UI', Arial, sans-serif; color: ${INK}; font-size: 12px; background: #fff; }
  .side { position: fixed; left: 0; top: 0; bottom: 0; width: 62mm; }
  .plum { position: absolute; left: 0; top: 0; width: 100%; height: 56mm; background: ${PLUM}; color: #fff; padding: 12mm 8mm; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 3mm; }
  .plum .logo { background: #fff; border-radius: 3mm; padding: 2mm 3mm; max-width: 46mm; }
  .plum .logo img { display: block; max-height: 16mm; max-width: 40mm; object-fit: contain; }
  .plum .co { font-size: 15px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; line-height: 1.25; }
  .crimson { position: absolute; left: 0; top: 62mm; width: 100%; height: 150mm; background: ${CRIMSON}; color: #fff; border-bottom-right-radius: 45mm; padding: 14mm 8mm 0; }
  .c-item { font-size: 10.5px; line-height: 1.5; margin-bottom: 6mm; word-break: break-word; opacity: .96; }
  .c-item span { display: block; font-size: 8px; letter-spacing: .14em; text-transform: uppercase; opacity: .7; margin-bottom: 1mm; }
  .orange { position: absolute; left: 0; bottom: 0; width: 100%; height: 36mm; background: ${ORANGE}; }
  .main { margin-left: 74mm; padding: 16mm 14mm 14mm 0; min-height: 297mm; display: flex; flex-direction: column; }
  .top { display: flex; justify-content: space-between; gap: 8mm; margin-bottom: 12mm; }
  .to { flex: 1 1 0; min-width: 0; max-width: 68mm; }
  .title { flex: none; }
  .to .blk { margin-bottom: 3mm; }
  .to small { display: block; font-size: 10.5px; color: #4b5563; line-height: 1.45; }
  .to small.lbl { font-size: 10px; margin-bottom: .5mm; }
  .to b { font-size: 13px; display: block; margin: .5mm 0; }
  .title { text-align: right; }
  .title h1 { font-size: 24px; font-weight: 800; letter-spacing: .01em; }
  .title .no { font-size: 11px; margin-top: 1.5mm; font-weight: 600; }
  .title .dt { font-size: 11px; color: #4b5563; }
  .title .pill { display: inline-block; margin-top: 2mm; padding: 1px 9px; border: 1px solid ${INK}; border-radius: 999px; font-size: 9px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
  table { width: 100%; border-collapse: separate; border-spacing: 0; }
  thead th { text-align: left; font-size: 12px; font-weight: 800; padding: 7px 4px; border-top: 1.5px solid ${INK}; border-bottom: 1.5px solid ${INK}; }
  th.right, td.right { text-align: right; } th.center, td.center { text-align: center; }
  tbody tr { page-break-inside: avoid; }
  tbody td { padding: 9px 4px; border-bottom: 1px solid ${INK}; vertical-align: top; }
  td.n { width: 8mm; font-weight: 600; }
  td.desc b { display: block; font-size: 12.5px; }
  td.desc small { display: block; font-size: 9px; color: #6b7280; margin-top: 1px; line-height: 1.4; }
  .sum { margin: 8mm 0 0 auto; width: 76mm; font-size: 11.5px; }
  .sum div { display: flex; justify-content: space-between; padding: 3px 0; }
  .sum .bold { font-weight: 800; }
  .sum .big { border-top: 1.5px solid ${INK}; margin-top: 2mm; padding-top: 4px; font-weight: 800; font-size: 13px; }
  .grow { flex: 1; min-height: 14mm; }
  .bottom { display: flex; justify-content: space-between; align-items: flex-end; gap: 8mm; }
  .notes { font-size: 10.5px; line-height: 1.6; max-width: 90mm; }
  .notes h4, .sig h4 { font-size: 10px; letter-spacing: .08em; text-transform: uppercase; margin-bottom: 1.5mm; }
  .sig { text-align: right; font-size: 10.5px; }
  .sig .line { width: 52mm; border-top: 1px solid ${INK}; margin: 14mm 0 1.5mm auto; }
  .sig b { display: block; font-size: 11.5px; }
  .terms { margin-top: 9mm; padding-top: 3mm; border-top: 1px solid ${INK}; font-size: 9.5px; color: #374151; line-height: 1.5; white-space: pre-wrap; }
</style></head><body>
  <div class="side">
    <div class="plum">${logoHtml}<div class="co">${escapeHtml(c.name)}</div></div>
    <div class="crimson">
      ${contact("Address", c.address)}${contact("Phone", c.phone)}${contact("Email", c.email)}${contact("GSTIN", c.gst)}
    </div>
    <div class="orange"></div>
  </div>
  <div class="main">
    <div class="top">
      <div class="to">${toHtml}</div>
      <div class="title">
        <h1>${escapeHtml(d.title)}</h1>
        <div class="no">No. ${escapeHtml(d.docNo)}</div>
        <div class="dt">${escapeHtml(d.date || "")}</div>
        ${d.status ? `<div class="pill">${escapeHtml(d.status)}</div>` : ""}
      </div>
    </div>
    <table>
      <thead><tr>${thead}</tr></thead>
      <tbody>${rows || `<tr><td colspan="${d.columns.length + 1}" style="text-align:center;color:#6b7280">No items</td></tr>`}</tbody>
    </table>
    <div class="sum">${sumHtml}</div>
    <div class="grow"></div>
    <div class="bottom">
      <div class="notes">${notesHtml}</div>
      <div class="sig"><div class="line"></div><h4>${escapeHtml(d.signLabel)}</h4><b>${escapeHtml(d.signName || "—")}</b></div>
    </div>
    <div class="terms"><b>${escapeHtml(d.termsTitle || "Terms & Conditions :")}</b> ${escapeHtml(d.terms)}</div>
  </div>
</body></html>`;

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

// ─── PDF (jsPDF) ─────────────────────────────────────────────────────────────

const rgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

const latin = (v: unknown) =>
  String(v ?? "")
    .replace(/₹/g, "Rs. ")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[^\x00-\xFF]/g, "");

async function toDataUrl(src?: string | null): Promise<string | null> {
  if (!src) return null;
  if (src.startsWith("data:image/")) return src;
  try {
    const res = await fetch(src);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(typeof fr.result === "string" ? fr.result : null);
      fr.onerror = () => resolve(null);
      fr.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export async function downloadLetterheadPdf(d: LetterheadDoc, filename: string) {
  const { default: jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  // Embed DM Sans; falls back to Helvetica if the font files can't be fetched.
  const FONT = await embedDmSans(doc);
  const W = 210;
  const H = 297;
  const SIDE = 62;
  const LEFT = SIDE + 12;
  const RIGHT = W - 14;
  const c = d.company;
  const logo = await toDataUrl(c.logo);

  const fill = (hex: string) => doc.setFillColor(...rgb(hex));
  const color = (hex: string) => doc.setTextColor(...rgb(hex));

  const drawSide = () => {
    fill(PLUM);
    doc.rect(0, 0, SIDE, 56, "F");
    // crimson rail, rounded bottom-right corner (quarter-circle bezier)
    const y0 = 62;
    const y1 = 212;
    const r = 45;
    const k = r * 0.5523;
    fill(CRIMSON);
    doc.lines(
      [
        [SIDE, 0],
        [0, y1 - y0 - r],
        [0, k, -(r - k), r, -r, r],
        [-(SIDE - r), 0],
      ],
      0,
      y0,
      [1, 1],
      "F",
      true,
    );
    fill(ORANGE);
    doc.rect(0, H - 36, SIDE, 36, "F");
  };

  const drawSideContent = () => {
    let y = 22;
    if (logo) {
      try {
        const fmt = /^data:image\/png/i.test(logo) ? "PNG" : /^data:image\/webp/i.test(logo) ? "WEBP" : "JPEG";
        fill("#ffffff");
        doc.roundedRect(SIDE / 2 - 20, 9, 40, 20, 2.5, 2.5, "F");
        doc.addImage(logo, fmt, SIDE / 2 - 18, 10.5, 36, 17, undefined, "FAST");
        y = 36;
      } catch {
        /* logo unreadable — name only */
      }
    }
    color("#ffffff");
    doc.setFont(FONT, "bold");
    doc.setFontSize(11);
    const nameLines = doc.splitTextToSize(latin(c.name).toUpperCase(), SIDE - 14);
    doc.text(nameLines, SIDE / 2, y + (logo ? 0 : 6), { align: "center" });

    let cy = 80;
    const block = (label: string, value?: string | null) => {
      if (!value) return;
      doc.setFont(FONT, "normal");
      doc.setFontSize(6.5);
      doc.setTextColor(255, 255, 255);
      doc.setGState?.(new (doc as any).GState({ opacity: 0.7 }));
      doc.text(label.toUpperCase(), 8, cy);
      doc.setGState?.(new (doc as any).GState({ opacity: 1 }));
      doc.setFontSize(8.5);
      const lines = doc.splitTextToSize(latin(value), SIDE - 16);
      doc.text(lines, 8, cy + 4.5);
      cy += 4.5 + lines.length * 4 + 6;
    };
    block("Address", c.address);
    block("Phone", c.phone);
    block("Email", c.email);
    block("GSTIN", c.gst);
  };

  drawSide();
  drawSideContent();

  // ── header: "to" blocks (left) + title block (right)
  let hy = 22;
  // The title sits top-right in 20pt bold; the "to" column gets whatever width
  // is left beside it so a long title ("Goods Receipt Note") can't run into it.
  doc.setFont(FONT, "bold");
  doc.setFontSize(20);
  const titleW = doc.getTextWidth(latin(d.title));
  const toW = Math.max(38, Math.min(68, RIGHT - LEFT - titleW - 6));
  for (const b of d.toBlocks) {
    color("#4b5563");
    doc.setFont(FONT, "normal");
    doc.setFontSize(8.5);
    doc.text(latin(b.label), LEFT, hy);
    hy += 5.5;
    b.lines.filter(Boolean).forEach((line, i) => {
      doc.setFont(FONT, i === 0 ? "bold" : "normal");
      doc.setFontSize(i === 0 ? 11 : 8.5);
      color(i === 0 ? INK : "#4b5563");
      const wrapped = doc.splitTextToSize(latin(line), toW);
      doc.text(wrapped, LEFT, hy);
      hy += wrapped.length * (i === 0 ? 5 : 4) + (i === 0 ? 0.5 : 0);
    });
    hy += 3;
  }

  color(INK);
  doc.setFont(FONT, "bold");
  doc.setFontSize(20);
  doc.text(latin(d.title), RIGHT, 24, { align: "right" });
  doc.setFontSize(9);
  doc.text(latin(`No. ${d.docNo}`), RIGHT, 31, { align: "right" });
  doc.setFont(FONT, "normal");
  color("#4b5563");
  doc.text(latin(d.date || ""), RIGHT, 36, { align: "right" });
  if (d.status) {
    doc.setFont(FONT, "bold");
    doc.setFontSize(7);
    color(INK);
    const label = latin(d.status).toUpperCase();
    const tw = doc.getTextWidth(label) + 7;
    doc.setDrawColor(...rgb(INK));
    doc.setLineWidth(0.25);
    doc.roundedRect(RIGHT - tw, 39, tw, 5, 2.5, 2.5, "S");
    doc.text(label, RIGHT - tw / 2, 42.6, { align: "center" });
  }

  // ── items table (ruled, no vertical lines)
  const fixedW = d.columns.slice(1).reduce((a, col) => a + (col.widthMm ?? 22), 0);
  const itemW = RIGHT - LEFT - 8 - fixedW;
  // The description wraps in a narrow column, and the grey sub-line has to be
  // drawn under however many lines the name took — measure both up front.
  doc.setFont(FONT, "bold");
  doc.setFontSize(9.5);
  const nameLineCounts = d.rows.map((r) => doc.splitTextToSize(latin(cellText(r.cells[0])), itemW - 2).length);
  const subLines = d.rows.map((r) =>
    r.sub ? (doc.setFont(FONT, "normal"), doc.setFontSize(7), doc.splitTextToSize(latin(r.sub), itemW - 2)) : [],
  );
  const columnStyles: Record<number, any> = { 0: { cellWidth: 8, fontStyle: "bold" }, 1: { cellWidth: itemW, fontStyle: "bold" } };
  d.columns.slice(1).forEach((col, k) => {
    columnStyles[k + 2] = { cellWidth: col.widthMm ?? 22, halign: col.align ?? "left" };
  });
  autoTable(doc, {
    startY: Math.max(52, hy + 4),
    margin: { left: LEFT, right: W - RIGHT, top: 14, bottom: 22 },
    head: [["#", ...d.columns.map((col) => latin(col.header))]],
    body: d.rows.map((r, i) => [
      String(i + 1),
      latin(cellText(r.cells[0])) + subLines[i].map(() => "\n ").join(""),
      ...d.columns.slice(1).map((_, k) => latin(cellText(r.cells[k + 1]))),
    ]),
    theme: "plain",
    styles: { font: FONT, fontSize: 9.5, cellPadding: { top: 3, bottom: 3, left: 1, right: 1 }, textColor: rgb(INK), valign: "top" },
    headStyles: { fontStyle: "bold", fontSize: 9.5 },
    columnStyles,
    didParseCell: (data) => {
      if (data.section === "head" && data.column.index >= 2) {
        data.cell.styles.halign = d.columns[data.column.index - 1]?.align ?? "left";
      }
    },
    didDrawPage: (data) => {
      if (data.pageNumber > 1) {
        drawSide();
        drawSideContent();
      }
    },
    didDrawCell: (data) => {
      doc.setDrawColor(...rgb(INK));
      const { x, y, width, height } = data.cell;
      if (data.section === "head") {
        doc.setLineWidth(0.45);
        doc.line(x, y, x + width, y);
        doc.line(x, y + height, x + width, y + height);
      } else if (data.section === "body") {
        doc.setLineWidth(0.25);
        doc.line(x, y + height, x + width, y + height);
        if (data.column.index === 1 && subLines[data.row.index].length) {
          doc.setFont(FONT, "normal");
          doc.setFontSize(7);
          doc.setTextColor(107, 114, 128);
          doc.text(subLines[data.row.index], x + 1, y + 3 + nameLineCounts[data.row.index] * 3.85 + 2.2);
          // autoTable only re-applies a cell's font when it changes between
          // cells, so put the cell's own style back or every later row
          // would be drawn in this small grey sub-line font.
          doc.setFont(FONT, data.cell.styles.fontStyle);
          doc.setFontSize(data.cell.styles.fontSize);
          doc.setTextColor(...rgb(INK));
        }
      }
    },
  });

  let y = ((doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY ?? 60) + 8;
  const sumH = d.summary.length * 5.5 + 6;
  if (y + sumH + 50 > H - 18) {
    doc.addPage();
    drawSide();
    drawSideContent();
    y = 24;
  }

  // ── summary
  const sx = RIGHT - 76;
  doc.setFontSize(9);
  for (const s of d.summary) {
    if (s.rule) {
      doc.setDrawColor(...rgb(INK));
      doc.setLineWidth(0.45);
      doc.line(sx, y - 2.5, RIGHT, y - 2.5);
      y += 1;
    }
    doc.setFont(FONT, s.bold || s.rule ? "bold" : "normal");
    doc.setFontSize(s.rule ? 10.5 : 9);
    color(INK);
    doc.text(latin(s.label), sx, y);
    doc.text(latin(s.value), RIGHT, y, { align: "right" });
    y += 5.5;
  }

  // ── notes + signature
  y = Math.max(y + 10, 205);
  if (y + 45 > H - 14) {
    doc.addPage();
    drawSide();
    drawSideContent();
    y = 40;
  }
  let ny = y;
  for (const n of d.notes ?? []) {
    doc.setFont(FONT, "bold");
    doc.setFontSize(8);
    color(INK);
    doc.text(latin(n.title).toUpperCase(), LEFT, ny);
    doc.setFont(FONT, "normal");
    doc.setFontSize(8.5);
    const wrapped = doc.splitTextToSize(latin(n.lines.join("\n")), 80);
    doc.text(wrapped, LEFT, ny + 5);
    ny += 5 + wrapped.length * 4 + 3;
  }
  doc.setDrawColor(...rgb(INK));
  doc.setLineWidth(0.25);
  doc.line(RIGHT - 52, y + 14, RIGHT, y + 14);
  doc.setFont(FONT, "bold");
  doc.setFontSize(8);
  color(INK);
  doc.text(latin(d.signLabel).toUpperCase(), RIGHT, y + 19, { align: "right" });
  doc.setFontSize(9.5);
  doc.text(latin(d.signName || "-"), RIGHT, y + 24, { align: "right" });

  // ── terms footer
  const ty = H - 26;
  doc.setLineWidth(0.25);
  doc.line(LEFT, ty, RIGHT, ty);
  doc.setFont(FONT, "bold");
  doc.setFontSize(7.5);
  const label = `${d.termsTitle || "Terms & Conditions :"}  `;
  const labelW = doc.getTextWidth(label);
  doc.text(label, LEFT, ty + 4.5);
  doc.setFont(FONT, "normal");
  doc.setTextColor(55, 65, 81);
  doc.text(doc.splitTextToSize(latin(d.terms), RIGHT - LEFT - labelW - 1).slice(0, 4), LEFT + labelW, ty + 4.5);

  doc.save(filename);
}
