// Material Request document — the printable / PDF layout used by the Material
// Request page and the Approval Inbox popup. Modelled on a classic "invoice"
// template: a coloured side rail (logo, company contact) down the left, the
// document title + number top-right, a ruled item table, a notes block and a
// signature line. One data shape (MRDocData) feeds both Print (HTML in a new
// window) and Generate PDF (jsPDF), so the two can never disagree.
import { toast } from "sonner";
import { escapeHtml } from "@/utils/escapeHtml";
import { DM_SANS_FACE_CSS, FONT_BASE, embedDmSans, printWhenFontsReady } from "@/utils/documentFont";

export interface MRDocItem {
  name: string;
  qty: number | string;
  uom: string;
  remarks?: string | null;
}

export interface MRDocData {
  docNo: string;
  status?: string | null;
  priority?: string | null;
  requestDate?: string | null;
  requiredByDate?: string | null;
  finYear?: string | null;
  projectName?: string | null;
  reason?: string | null;
  remarks?: string | null;
  createdBy?: string | null;
  company: {
    name: string;
    address?: string | null;
    phone?: string | null;
    email?: string | null;
    gst?: string | null;
    logo?: string | null;
  };
  items: MRDocItem[];
}

// Side-rail palette — change here to re-colour both Print and PDF.
const PLUM = "#6b2a6d";
const CRIMSON = "#a3262f";
const ORANGE = "#e3822f";
const INK = "#1f2937";

const fmtDate = (d?: string | null) => {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt.getTime())
    ? "—"
    : dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

const fmtQty = (q: number | string) => {
  const n = Number(q);
  return Number.isFinite(n) ? n.toLocaleString("en-IN", { maximumFractionDigits: 3 }) : String(q ?? "");
};

/** Company letterhead details (address, phone, email, GST, logo) for the MR's company. */
export async function loadMRCompany(
  companyId: number | string | null | undefined,
  fallbackName: string | null | undefined,
): Promise<MRDocData["company"]> {
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

/** Builds MRDocData from a full GET /material-requests/:id record. */
export function mrDocFromRecord(rec: any, company: MRDocData["company"]): MRDocData {
  return {
    docNo: rec.DocNo || `MR-${rec.MRId ?? ""}`,
    status: rec.Status,
    priority: rec.Priority || "Normal",
    requestDate: rec.RequestDate,
    requiredByDate: rec.RequiredByDate,
    finYear: rec.FinYearName,
    projectName: rec.ProjectName,
    reason: rec.Reason,
    remarks: rec.Remarks,
    createdBy: rec.CreatedByName ?? rec.CreatedBy,
    company: { ...company, name: company.name || rec.CompanyName || "CivilierERP" },
    items: (Array.isArray(rec.items) ? rec.items : []).map((it: any) => ({
      name: it.ItemName || it.ItemId || "—",
      qty: it.Quantity ?? 0,
      uom: it.UOMName || it.UOMSymbol || it.UOMCode || "",
      remarks: it.Remarks || null,
    })),
  };
}

// ─── Print (HTML) ────────────────────────────────────────────────────────────

export function printMaterialRequest(d: MRDocData) {
  const c = d.company;
  const safeLogo = c.logo && /^(https?:\/\/|data:image\/|\/)/i.test(c.logo) ? escapeHtml(c.logo) : "";
  const logoHtml = safeLogo
    ? `<div class="logo"><img src="${safeLogo}" alt="" /></div>`
    : "";

  const contact = (label: string, value?: string | null) =>
    value ? `<div class="c-item"><span>${label}</span>${escapeHtml(value)}</div>` : "";

  const rows = d.items
    .map(
      (it, i) => `<tr>
        <td class="n">${i + 1}</td>
        <td class="desc"><b>${escapeHtml(it.name)}</b>${it.remarks ? `<small>${escapeHtml(it.remarks)}</small>` : ""}</td>
        <td class="r">${escapeHtml(fmtQty(it.qty))}</td>
        <td class="u">${escapeHtml(it.uom || "—")}</td>
      </tr>`,
    )
    .join("");

  const notes = [d.reason ? `<b>Reason:</b> ${escapeHtml(d.reason)}` : "", d.remarks ? `<b>Remarks:</b> ${escapeHtml(d.remarks)}` : ""]
    .filter(Boolean)
    .join("<br/>");

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8" />
<title>Material Request — ${escapeHtml(d.docNo)}</title>
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
  .to small { display: block; font-size: 10.5px; color: #4b5563; }
  .to b { font-size: 13px; display: block; margin: 1mm 0; }
  .title { text-align: right; }
  .title h1 { font-size: 24px; font-weight: 800; letter-spacing: .01em; }
  .title .no { font-size: 11px; margin-top: 1.5mm; font-weight: 600; }
  .title .dt { font-size: 11px; color: #4b5563; }
  .title .pill { display: inline-block; margin-top: 2mm; padding: 1px 9px; border: 1px solid ${INK}; border-radius: 999px; font-size: 9px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
  table { width: 100%; border-collapse: separate; border-spacing: 0; }
  thead th { text-align: left; font-size: 12px; font-weight: 800; padding: 7px 4px; border-top: 1.5px solid ${INK}; border-bottom: 1.5px solid ${INK}; }
  thead th.r, td.r { text-align: right; }
  tbody tr { page-break-inside: avoid; }
  tbody td { padding: 9px 4px; border-bottom: 1px solid ${INK}; vertical-align: top; }
  td.n { width: 8mm; font-weight: 600; }
  td.desc b { display: block; font-size: 12.5px; }
  td.desc small { display: block; font-size: 9px; color: #6b7280; margin-top: 1px; line-height: 1.4; }
  td.u { width: 26mm; }
  td.r, th.r { width: 24mm; }
  .sum { margin: 8mm 0 0 auto; width: 70mm; font-size: 11.5px; }
  .sum div { display: flex; justify-content: space-between; padding: 3px 0; }
  .sum .big { border-top: 1.5px solid ${INK}; margin-top: 2mm; padding-top: 4px; font-weight: 800; }
  .grow { flex: 1; min-height: 14mm; }
  .bottom { display: flex; justify-content: space-between; align-items: flex-end; gap: 8mm; }
  .notes { font-size: 10.5px; line-height: 1.6; max-width: 90mm; }
  .notes h4, .sig h4 { font-size: 10px; letter-spacing: .08em; text-transform: uppercase; margin-bottom: 1.5mm; }
  .sig { text-align: right; font-size: 10.5px; }
  .sig .line { width: 52mm; border-top: 1px solid ${INK}; margin: 14mm 0 1.5mm auto; }
  .sig b { display: block; font-size: 11.5px; }
  .terms { margin-top: 9mm; padding-top: 3mm; border-top: 1px solid ${INK}; font-size: 9.5px; color: #374151; line-height: 1.5; }
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
      <div class="to">
        <small>Requested For :</small>
        <b>${escapeHtml(d.projectName || "—")}</b>
        <small>${escapeHtml(c.name)}</small>
        ${d.finYear ? `<small>Financial Year ${escapeHtml(d.finYear)}</small>` : ""}
      </div>
      <div class="title">
        <h1>Material Request</h1>
        <div class="no">No. ${escapeHtml(d.docNo)}</div>
        <div class="dt">${escapeHtml(fmtDate(d.requestDate))}</div>
        ${d.status ? `<div class="pill">${escapeHtml(d.status)}</div>` : ""}
      </div>
    </div>
    <table>
      <thead><tr><th style="width:8mm">#</th><th>Item Description</th><th class="r">Qty.</th><th>UOM</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="4" style="text-align:center;color:#6b7280">No items</td></tr>`}</tbody>
    </table>
    <div class="sum">
      <div><span>Total Items</span><b>${d.items.length}</b></div>
      <div><span>Priority</span><b>${escapeHtml(d.priority || "Normal")}</b></div>
      <div class="big"><span>Required By</span><span>${escapeHtml(fmtDate(d.requiredByDate))}</span></div>
    </div>
    <div class="grow"></div>
    <div class="bottom">
      <div class="notes">${notes ? `<h4>Notes</h4>${notes}` : ""}</div>
      <div class="sig"><div class="line"></div><h4>Requested By</h4><b>${escapeHtml(d.createdBy || "—")}</b></div>
    </div>
    <div class="terms"><b>Terms &amp; Conditions :</b> This is a system-generated material request from CivilierERP. Quantities are as requested and subject to approval, availability and the purchase terms agreed with the supplier.</div>
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

export async function downloadMaterialRequestPdf(d: MRDocData, filename: string) {
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

  // ── header: requested-for (left) + title block (right)
  color("#4b5563");
  doc.setFont(FONT, "normal");
  doc.setFontSize(8.5);
  doc.text("Requested For :", LEFT, 22);
  color(INK);
  doc.setFont(FONT, "bold");
  doc.setFontSize(11);
  doc.text(doc.splitTextToSize(latin(d.projectName || "-"), 70), LEFT, 28);
  color("#4b5563");
  doc.setFont(FONT, "normal");
  doc.setFontSize(8.5);
  doc.text(doc.splitTextToSize(latin(c.name), 70), LEFT, 34);
  if (d.finYear) doc.text(latin(`Financial Year ${d.finYear}`), LEFT, 39);

  color(INK);
  doc.setFont(FONT, "bold");
  doc.setFontSize(20);
  doc.text("Material Request", RIGHT, 24, { align: "right" });
  doc.setFontSize(9);
  doc.text(latin(`No. ${d.docNo}`), RIGHT, 31, { align: "right" });
  doc.setFont(FONT, "normal");
  color("#4b5563");
  doc.text(latin(fmtDate(d.requestDate)), RIGHT, 36, { align: "right" });
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
  const itemW = RIGHT - LEFT - 8 - 24 - 26;
  const remarkLines = d.items.map((it) =>
    it.remarks ? (doc.setFontSize(7), doc.splitTextToSize(latin(it.remarks), itemW - 4)) : [],
  );
  autoTable(doc, {
    startY: 52,
    margin: { left: LEFT, right: W - RIGHT, top: 14, bottom: 22 },
    head: [["#", "Item Description", "Qty.", "UOM"]],
    body: d.items.map((it, i) => [
      String(i + 1),
      latin(it.name) + remarkLines[i].map(() => "\n ").join(""),
      latin(fmtQty(it.qty)),
      latin(it.uom || "-"),
    ]),
    theme: "plain",
    styles: { font: FONT, fontSize: 9.5, cellPadding: { top: 3, bottom: 3, left: 1, right: 1 }, textColor: rgb(INK), valign: "top" },
    headStyles: { fontStyle: "bold", fontSize: 9.5 },
    columnStyles: {
      0: { cellWidth: 8, fontStyle: "bold" },
      1: { cellWidth: itemW, fontStyle: "bold" },
      2: { cellWidth: 24, halign: "right" },
      3: { cellWidth: 26 },
    },
    didParseCell: (data) => {
      if (data.section === "head" && data.column.index === 2) data.cell.styles.halign = "right";
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
        if (data.column.index === 1 && remarkLines[data.row.index].length) {
          doc.setFont(FONT, "normal");
          doc.setFontSize(7);
          doc.setTextColor(107, 114, 128);
          doc.text(remarkLines[data.row.index], x + 1, y + 3 + 4.2 + 3.2);
          // autoTable only re-applies a cell's font when it changes between
          // cells, so put the cell's own style back or every later row
          // would be drawn in this small grey remark font.
          doc.setFont(FONT, data.cell.styles.fontStyle);
          doc.setFontSize(data.cell.styles.fontSize);
          doc.setTextColor(...rgb(INK));
        }
      }
    },
  });

  let y = ((doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY ?? 60) + 8;
  const need = 70;
  if (y + need > H - 18) {
    doc.addPage();
    drawSide();
    drawSideContent();
    y = 24;
  }

  // ── summary
  const sx = RIGHT - 70;
  doc.setFontSize(9);
  const sumRow = (label: string, value: string, bold = false) => {
    doc.setFont(FONT, bold ? "bold" : "normal");
    color(INK);
    doc.text(label, sx, y);
    doc.text(latin(value), RIGHT, y, { align: "right" });
    y += 5.5;
  };
  sumRow("Total Items", String(d.items.length));
  sumRow("Priority", d.priority || "Normal");
  doc.setDrawColor(...rgb(INK));
  doc.setLineWidth(0.45);
  doc.line(sx, y - 2.5, RIGHT, y - 2.5);
  y += 1;
  sumRow("Required By", fmtDate(d.requiredByDate), true);

  // ── notes + signature
  y = Math.max(y + 10, 205);
  if (y + 45 > H - 14) {
    doc.addPage();
    drawSide();
    drawSideContent();
    y = 40;
  }
  const notes = [d.reason ? `Reason: ${d.reason}` : "", d.remarks ? `Remarks: ${d.remarks}` : ""].filter(Boolean);
  if (notes.length) {
    doc.setFont(FONT, "bold");
    doc.setFontSize(8);
    color(INK);
    doc.text("NOTES", LEFT, y);
    doc.setFont(FONT, "normal");
    doc.setFontSize(8.5);
    doc.text(doc.splitTextToSize(latin(notes.join("\n")), 80), LEFT, y + 5);
  }
  doc.setDrawColor(...rgb(INK));
  doc.setLineWidth(0.25);
  doc.line(RIGHT - 52, y + 14, RIGHT, y + 14);
  doc.setFont(FONT, "bold");
  doc.setFontSize(8);
  doc.text("REQUESTED BY", RIGHT, y + 19, { align: "right" });
  doc.setFontSize(9.5);
  doc.text(latin(d.createdBy || "-"), RIGHT, y + 24, { align: "right" });

  // ── terms footer
  const ty = H - 26;
  doc.setLineWidth(0.25);
  doc.line(LEFT, ty, RIGHT, ty);
  doc.setFont(FONT, "bold");
  doc.setFontSize(7.5);
  const label = "Terms & Conditions :  ";
  const labelW = doc.getTextWidth(label);
  doc.text(label, LEFT, ty + 4.5);
  doc.setFont(FONT, "normal");
  doc.setTextColor(55, 65, 81);
  doc.text(
    doc.splitTextToSize(
      "This is a system-generated material request from CivilierERP. Quantities are as requested and subject to approval, availability and the purchase terms agreed with the supplier.",
      RIGHT - LEFT - labelW - 1,
    ),
    LEFT + labelW,
    ty + 4.5,
  );

  doc.save(filename);
}
