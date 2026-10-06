// "Invoice" style renderer — red banded invoice layout for Print (HTML) and
// Generate PDF (jsPDF). Takes the same LetterheadDoc as the side-rail
// letterhead so adapters only choose which renderer to call.
//
// Layout: hexagon corner shapes (top-right / bottom-left), red table header
// band, red-ruled rows, grey summary rows with a red total, signature and
// company contact bottom-right, terms bottom-left. Font: DM Sans.
import { toast } from "sonner";
import { escapeHtml } from "@/utils/escapeHtml";
import { DM_SANS_FACE_CSS, embedDmSans, printWhenFontsReady } from "@/utils/documentFont";
import { cellText, latin, rgb, toDataUrl, type LetterheadDoc } from "@/utils/letterheadDocument";

export interface InvoiceStyleMeta {
  /** Extra header facts shown beside No. / Date (e.g. Due Date). */
  meta?: { label: string; value: string }[];
}

const RED = "#d3202f";
const RED_DARK = "#8e1220";
const SHAPE_GREY = "#d9d9dc";
const BOX_GREY = "#e6e6e8";
const INK = "#1f2937";

type Pt = [number, number];
// Corner shapes in page mm for the top-right; the bottom-left is the same shape
// rotated 180° about the page centre.
const SHAPE_GREY_PTS: Pt[] = [[118, 0], [170, 0], [178, 11], [170, 22], [128, 22], [112, 11]];
const SHAPE_RED_PTS: Pt[] = [[152, 0], [210, 0], [210, 25], [178, 25], [164, 12.5]];
const SHAPE_DARK_PTS: Pt[] = [[152, 0], [182, 0], [164, 12.5]];
const same = (p: Pt[]) => p;
const rot = (p: Pt[]): Pt[] => p.map(([x, y]) => [210 - x, 297 - y]);

function shapesSvg(): string {
  const poly = (pts: Pt[], fill: string) => `<polygon points="${pts.map((p) => p.join(",")).join(" ")}" fill="${fill}"/>`;
  const set = (t: (p: Pt[]) => Pt[]) =>
    poly(t(SHAPE_GREY_PTS), SHAPE_GREY) + poly(t(SHAPE_RED_PTS), RED) + poly(t(SHAPE_DARK_PTS), RED_DARK);
  return `<svg class="shapes" viewBox="0 0 210 297" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">${set(same)}${set(rot)}</svg>`;
}

const headerMeta = (d: LetterheadDoc, extra?: InvoiceStyleMeta["meta"]) => [
  { label: "No.", value: d.docNo },
  { label: "Date", value: d.date || "—" },
  ...(extra ?? []),
];

export function printInvoiceStyle(d: LetterheadDoc, extra?: InvoiceStyleMeta["meta"]) {
  const c = d.company;
  const safeLogo = c.logo && /^(https?:\/\/|data:image\/|\/)/i.test(c.logo) ? escapeHtml(c.logo) : "";
  const meta = headerMeta(d, extra);

  const thead = [
    `<th style="width:8mm">#</th>`,
    ...d.columns.map(
      (col, i) =>
        `<th class="${i === 0 ? "left" : col.align ?? "left"}"${col.widthMm ? ` style="width:${col.widthMm}mm"` : ""}>${escapeHtml(col.header)}</th>`,
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
        `<div class="${s.rule ? "tot" : ""}${s.bold ? " bold" : ""}"><span>${escapeHtml(s.label)}</span><span>${escapeHtml(s.value)}</span></div>`,
    )
    .join("");
  const notesHtml = (d.notes ?? [])
    .map((n) => `<h4>${escapeHtml(n.title)}</h4><p>${n.lines.map((l) => escapeHtml(l)).join("<br/>")}</p>`)
    .join("");
  const contact = [c.address, c.phone, c.email, c.gst ? `GSTIN: ${c.gst}` : ""]
    .filter(Boolean)
    .map((l) => `<div>${escapeHtml(String(l))}</div>`)
    .join("");

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8" />
<title>${escapeHtml(d.title)} — ${escapeHtml(d.docNo)}</title>
<style>
  ${DM_SANS_FACE_CSS}
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: 'DM Sans', 'Segoe UI', Arial, sans-serif; color: ${INK}; font-size: 12px; background: #fff; }
  .shapes { position: fixed; left: 0; top: 0; width: 210mm; height: 297mm; z-index: 0; }
  .main { position: relative; z-index: 1; padding: 14mm 16mm 34mm; min-height: 297mm; display: flex; flex-direction: column; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; }
  .brand img { display: block; max-height: 15mm; max-width: 44mm; object-fit: contain; margin-bottom: 2mm; }
  .brand .co { font-size: 13px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; max-width: 70mm; line-height: 1.25; }
  .ttl { text-align: right; margin-top: 20mm; }
  .ttl h1 { font-size: 26px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; padding-bottom: 2mm; border-bottom: 1px solid #c9c9cd; }
  .row2 { display: flex; justify-content: space-between; gap: 8mm; margin: 8mm 0 7mm; }
  .to { max-width: 78mm; }
  .to .blk { margin-bottom: 3mm; }
  .to small { display: block; font-size: 10.5px; color: #4b5563; line-height: 1.45; }
  .to small.lbl { color: ${RED}; font-weight: 700; font-size: 10px; margin-bottom: .5mm; }
  .to b { display: block; font-size: 13px; margin: .3mm 0; }
  .meta { display: flex; gap: 6mm; align-self: flex-start; }
  .meta div { border-left: 2px solid ${RED}; padding-left: 2.5mm; font-size: 10px; color: #4b5563; }
  .meta b { display: block; font-size: 11.5px; color: ${INK}; }
  table { width: 100%; border-collapse: separate; border-spacing: 0; }
  thead th { background: ${RED}; color: #fff; text-align: left; font-size: 11.5px; font-weight: 700; padding: 7px 6px; }
  th.right, td.right { text-align: right; } th.center, td.center { text-align: center; }
  tbody tr { page-break-inside: avoid; }
  tbody td { padding: 9px 6px; border-bottom: 1px solid ${RED}; vertical-align: top; }
  td.n { font-weight: 600; width: 8mm; }
  td.desc b { display: block; font-size: 12.5px; }
  td.desc small { display: block; font-size: 9px; color: #6b7280; margin-top: 1px; line-height: 1.4; }
  .lower { display: flex; justify-content: space-between; gap: 8mm; margin-top: 7mm; align-items: flex-start; }
  .notes { flex: 1; font-size: 10.5px; line-height: 1.6; max-width: 92mm; }
  .notes h4, .terms h4 { font-size: 11.5px; color: ${RED}; margin: 0 0 1mm; }
  .notes p { margin-bottom: 3mm; }
  .sum { width: 74mm; font-size: 11.5px; }
  .sum div { display: flex; justify-content: space-between; padding: 4px 10px; background: ${BOX_GREY}; }
  .sum div.bold { font-weight: 800; }
  .sum div.tot { background: ${RED}; color: #fff; font-weight: 800; font-size: 13px; padding: 7px 10px; }
  .grow { flex: 1; min-height: 8mm; }
  .sigrow { display: flex; justify-content: flex-end; }
  .sig { width: 64mm; text-align: right; font-size: 10.5px; }
  .sig .line { border-top: 1px solid ${INK}; margin: 14mm 0 1.5mm; }
  .sig h5 { font-size: 10px; letter-spacing: .06em; text-transform: uppercase; }
  .sig b { display: block; font-size: 11.5px; }
  .contact { margin-top: 4mm; text-align: right; font-size: 9.5px; color: #4b5563; line-height: 1.5; }
  .terms { margin-top: 5mm; max-width: 122mm; font-size: 9.5px; color: #374151; line-height: 1.5; white-space: pre-wrap; }
</style></head><body>
  ${shapesSvg()}
  <div class="main">
    <div class="head">
      <div class="brand">${safeLogo ? `<img src="${safeLogo}" alt="" />` : ""}<div class="co">${escapeHtml(c.name)}</div></div>
      <div class="ttl"><h1>${escapeHtml(d.title)}</h1></div>
    </div>
    <div class="row2">
      <div class="to">${toHtml}</div>
      <div class="meta">${meta.map((m) => `<div>${escapeHtml(m.label)}<b>${escapeHtml(m.value)}</b></div>`).join("")}</div>
    </div>
    <table>
      <thead><tr>${thead}</tr></thead>
      <tbody>${rows || `<tr><td colspan="${d.columns.length + 1}" style="text-align:center;color:#6b7280">No items</td></tr>`}</tbody>
    </table>
    <div class="lower"><div class="notes">${notesHtml}</div><div class="sum">${sumHtml}</div></div>
    <div class="grow"></div>
    <div class="sigrow"><div class="sig"><div class="line"></div><h5>${escapeHtml(d.signLabel)}</h5><b>${escapeHtml(d.signName || "—")}</b>
      <div class="contact">${contact}</div></div></div>
    <div class="terms"><h4>${escapeHtml((d.termsTitle || "Terms & Conditions :").replace(/\s*:$/, ""))}</h4>${escapeHtml(d.terms)}</div>
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

export async function downloadInvoiceStylePdf(d: LetterheadDoc, filename: string, extra?: InvoiceStyleMeta["meta"]) {
  const { default: jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const FONT = await embedDmSans(doc);
  const W = 210;
  const H = 297;
  const LEFT = 16;
  const RIGHT = W - 16;
  const c = d.company;
  const logo = await toDataUrl(c.logo);
  const fill = (hex: string) => doc.setFillColor(...rgb(hex));
  const color = (hex: string) => doc.setTextColor(...rgb(hex));

  const drawShapes = () => {
    const poly = (pts: Pt[], hex: string) => {
      fill(hex);
      const [first, ...rest] = pts;
      const deltas = rest.map((p, i) => [p[0] - (i ? rest[i - 1][0] : first[0]), p[1] - (i ? rest[i - 1][1] : first[1])]);
      doc.lines(deltas, first[0], first[1], [1, 1], "F", true);
    };
    for (const t of [same, rot]) {
      poly(t(SHAPE_GREY_PTS), SHAPE_GREY);
      poly(t(SHAPE_RED_PTS), RED);
      poly(t(SHAPE_DARK_PTS), RED_DARK);
    }
  };
  drawShapes();

  // brand
  let by = 14;
  if (logo) {
    try {
      const fmt = /^data:image\/png/i.test(logo) ? "PNG" : /^data:image\/webp/i.test(logo) ? "WEBP" : "JPEG";
      doc.addImage(logo, fmt, LEFT, by, 38, 15, undefined, "FAST");
      by += 19;
    } catch {
      /* name only */
    }
  } else by += 4;
  color(INK);
  doc.setFont(FONT, "bold");
  doc.setFontSize(11);
  doc.text(doc.splitTextToSize(latin(c.name).toUpperCase(), 80), LEFT, by);

  // title
  doc.setFontSize(22);
  doc.text(latin(d.title).toUpperCase(), RIGHT, 42, { align: "right" });
  doc.setDrawColor(201, 201, 205);
  doc.setLineWidth(0.25);
  doc.line(RIGHT - 70, 45, RIGHT, 45);

  // No. / Date / extras, each with a red tick
  const meta = headerMeta(d, extra);
  const mw = Math.min(34, 74 / meta.length);
  meta.forEach((m, i) => {
    const mx = RIGHT - mw * (meta.length - i);
    doc.setDrawColor(...rgb(RED));
    doc.setLineWidth(0.5);
    doc.line(mx, 52, mx, 61);
    doc.setFont(FONT, "normal");
    doc.setFontSize(7.5);
    color("#4b5563");
    doc.text(latin(m.label), mx + 2, 54.5);
    doc.setFont(FONT, "bold");
    doc.setFontSize(8.5);
    color(INK);
    doc.text(doc.splitTextToSize(latin(m.value), mw - 3).slice(0, 1), mx + 2, 59.5);
  });

  // "to" blocks
  let hy = 52;
  const toW = RIGHT - 80 - LEFT - 6;
  for (const b of d.toBlocks) {
    doc.setFont(FONT, "bold");
    doc.setFontSize(8);
    color(RED);
    doc.text(latin(b.label), LEFT, hy);
    hy += 4.8;
    b.lines.filter(Boolean).forEach((line, i) => {
      doc.setFont(FONT, i === 0 ? "bold" : "normal");
      doc.setFontSize(i === 0 ? 10.5 : 8.5);
      color(i === 0 ? INK : "#4b5563");
      const wrapped = doc.splitTextToSize(latin(line), toW);
      doc.text(wrapped, LEFT, hy);
      hy += wrapped.length * (i === 0 ? 4.8 : 4);
    });
    hy += 2.5;
  }

  // items
  const fixedW = d.columns.slice(1).reduce((a, col) => a + (col.widthMm ?? 22), 0);
  const itemW = RIGHT - LEFT - 8 - fixedW;
  doc.setFont(FONT, "bold");
  doc.setFontSize(9.5);
  const nameLineCounts = d.rows.map((r) => doc.splitTextToSize(latin(cellText(r.cells[0])), itemW - 4).length);
  const subLines = d.rows.map((r) =>
    r.sub ? (doc.setFont(FONT, "normal"), doc.setFontSize(7), doc.splitTextToSize(latin(r.sub), itemW - 4)) : [],
  );
  const columnStyles: Record<number, any> = { 0: { cellWidth: 8, fontStyle: "bold" }, 1: { cellWidth: itemW, fontStyle: "bold" } };
  d.columns.slice(1).forEach((col, k) => {
    columnStyles[k + 2] = { cellWidth: col.widthMm ?? 22, halign: col.align ?? "left" };
  });
  autoTable(doc, {
    startY: Math.max(68, hy + 4),
    margin: { left: LEFT, right: W - RIGHT, top: 30, bottom: 34 },
    head: [["#", ...d.columns.map((col) => latin(col.header))]],
    body: d.rows.map((r, i) => [
      String(i + 1),
      latin(cellText(r.cells[0])) + subLines[i].map(() => "\n ").join(""),
      ...d.columns.slice(1).map((_, k) => latin(cellText(r.cells[k + 1]))),
    ]),
    theme: "plain",
    styles: { font: FONT, fontSize: 9.5, cellPadding: { top: 3, bottom: 3, left: 2, right: 2 }, textColor: rgb(INK), valign: "top" },
    headStyles: { fontStyle: "bold", fontSize: 9.5, fillColor: rgb(RED), textColor: [255, 255, 255] },
    columnStyles,
    didParseCell: (data) => {
      if (data.section === "head" && data.column.index >= 2) {
        data.cell.styles.halign = d.columns[data.column.index - 1]?.align ?? "left";
      }
    },
    didDrawPage: (data) => {
      if (data.pageNumber > 1) drawShapes();
    },
    didDrawCell: (data) => {
      if (data.section !== "body") return;
      const { x, y, width, height } = data.cell;
      doc.setDrawColor(...rgb(RED));
      doc.setLineWidth(0.25);
      doc.line(x, y + height, x + width, y + height);
      if (data.column.index === 1 && subLines[data.row.index].length) {
        doc.setFont(FONT, "normal");
        doc.setFontSize(7);
        doc.setTextColor(107, 114, 128);
        doc.text(subLines[data.row.index], x + 2, y + 3 + nameLineCounts[data.row.index] * 3.85 + 2.2);
        // autoTable only re-applies a cell's font when it changes between
        // cells, so put the cell's own style back after the sub-line.
        doc.setFont(FONT, data.cell.styles.fontStyle);
        doc.setFontSize(data.cell.styles.fontSize);
        doc.setTextColor(...rgb(INK));
      }
    },
  });

  let y = ((doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY ?? 70) + 8;
  const sumH = d.summary.reduce((a, s) => a + (s.rule ? 8 : 6), 0);
  if (y + Math.max(sumH, 20) + 78 > H - 22) {
    doc.addPage();
    drawShapes();
    y = 32;
  }

  // summary (grey rows, red total) on the right, notes on the left
  const sx = RIGHT - 74;
  let sy = y;
  for (const s of d.summary) {
    const h = s.rule ? 8 : 6;
    fill(s.rule ? RED : BOX_GREY);
    doc.rect(sx, sy, 74, h, "F");
    doc.setFont(FONT, s.bold || s.rule ? "bold" : "normal");
    doc.setFontSize(s.rule ? 10 : 9);
    if (s.rule) doc.setTextColor(255, 255, 255);
    else color(INK);
    doc.text(latin(s.label), sx + 3, sy + h / 2 + 1.3);
    doc.text(latin(s.value), RIGHT - 3, sy + h / 2 + 1.3, { align: "right" });
    sy += h;
  }
  let ny = y + 2;
  for (const n of d.notes ?? []) {
    doc.setFont(FONT, "bold");
    doc.setFontSize(9);
    color(RED);
    doc.text(latin(n.title), LEFT, ny + 2);
    doc.setFont(FONT, "normal");
    doc.setFontSize(8.5);
    color(INK);
    const wrapped = doc.splitTextToSize(latin(n.lines.join("\n")), 88);
    doc.text(wrapped, LEFT, ny + 7);
    ny += 7 + wrapped.length * 4 + 3;
  }

  // signature + contact bottom-right, terms bottom-left above the corner shape
  const sigY = Math.max(Math.max(sy, ny) + 8, 190);
  doc.setDrawColor(...rgb(INK));
  doc.setLineWidth(0.25);
  doc.line(RIGHT - 56, sigY + 14, RIGHT, sigY + 14);
  doc.setFont(FONT, "bold");
  doc.setFontSize(8);
  color(INK);
  doc.text(latin(d.signLabel).toUpperCase(), RIGHT, sigY + 19, { align: "right" });
  doc.setFontSize(9.5);
  doc.text(latin(d.signName || "-"), RIGHT, sigY + 24, { align: "right" });
  doc.setFont(FONT, "normal");
  doc.setFontSize(8);
  color("#4b5563");
  const contact = [c.address, c.phone, c.email, c.gst ? `GSTIN: ${c.gst}` : ""]
    .filter(Boolean)
    .flatMap((l) => doc.splitTextToSize(latin(l), 58) as string[]);
  doc.text(contact.slice(0, 7), RIGHT, sigY + 31, { align: "right", lineHeightFactor: 1.4 });

  const ty = Math.max(sigY + 22, 252);
  doc.setFont(FONT, "bold");
  doc.setFontSize(9.5);
  color(RED);
  doc.text(latin((d.termsTitle || "Terms & Conditions :").replace(/\s*:$/, "")), LEFT, ty);
  doc.setFont(FONT, "normal");
  doc.setFontSize(7.5);
  color("#374151");
  doc.text(doc.splitTextToSize(latin(d.terms), 108).slice(0, 4), LEFT, ty + 4.5);

  doc.save(filename);
}
