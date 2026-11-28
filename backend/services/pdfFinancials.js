// Shared financial-breakdown renderer used by every customer-facing CRM
// document — Application Form, Money Receipt, Tax Invoice — so a "reputed
// real estate firm" shows the SAME professional, GST-compliant tax
// computation matrix everywhere, with no per-document drift.
//
// The presentation deliberately mirrors a formal Indian tax invoice: one
// row per particular (Unit / Parking / Extra Charges / a single payment),
// with Taxable Value, HSN/SAC, and the CGST + SGST split shown per row,
// a bold totals row, and a fused Grand-Total emphasis bar — instead of one
// giant number floating above small, disconnected fine print.

function money(n) {
  return Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

// Palette — kept here so all three documents share one identity.
const PALETTE = {
  navy: "#101f38",
  navySoft: "#1e3a5f",
  gold: "#a3690a",
  goldDeep: "#7c4a08",
  ink: "#111827",
  muted: "#5b6472",
  faint: "#8b93a1",
  line: "#dfe3ea",
  rowTint: "#f7f8fa",
  totalTint: "#eef1f6",
  white: "#ffffff",
};

// rows: [{ label, hsn, taxable, gstAmount, total, ratePct }]
//   gstAmount is the FULL GST for the row; it is split CGST = round2(half),
//   SGST = gstAmount - CGST so the two halves always re-sum to the exact
//   stored figure (no penny drift against the booking's persisted totals).
// opts: { left, width, title, grandTotalLabel, grandTotal, note,
//         showGrandTotalBar (default true) }
// Returns nothing; advances doc.y past the block it drew.
function drawFinancialBreakdown(doc, rows, opts) {
  // Font names — defaults to Helvetica; invoices pass DM Sans (see pdfFonts.js).
  const F = (opts && opts.fonts) || { regular: "Helvetica", bold: "Helvetica-Bold", italic: "Helvetica-Oblique" };
  const rs = F.regular !== "Helvetica" ? "\u20B9" : "Rs.";
  const rsSpace = F.regular !== "Helvetica" ? "\u20B9" : "Rs. ";
  const {
    left,
    width,
    title,
    grandTotal,
    grandTotalLabel = "GRAND TOTAL",
    note,
    showGrandTotalBar = true,
  } = opts;
  const C = PALETTE;

  if (title) {
    doc.font(F.bold).fontSize(8.5).fillColor(C.goldDeep)
      .text(title.toUpperCase(), left, doc.y, { characterSpacing: 0.8 });
    doc.y += 14;
    doc.fillColor("#000000");
  }

  // 7 columns: Particulars | HSN/SAC | Taxable Value | GST% | CGST | SGST | Amount
  const cw = [
    width * 0.27, // Particulars
    width * 0.10, // HSN/SAC
    width * 0.16, // Taxable Value
    width * 0.08, // GST rate
    width * 0.125, // CGST
    width * 0.125, // SGST
    width * 0.14, // Amount (Total)
  ];
  const totalW = cw.reduce((a, b) => a + b, 0);
  const aligns = ["left", "center", "right", "center", "right", "right", "right"];
  const headers = ["Particulars", "HSN/SAC", `Taxable (${rs})`, "GST %", `CGST (${rs})`, `SGST (${rs})`, `Amount (${rs})`];

  const tableTop = doc.y;
  const headerH = 26;

  // Header band (navy, white text). GST columns get a shared "GST" super-label
  // feel by simply being adjacent; kept single-row for compactness.
  doc.rect(left, tableTop, totalW, headerH).fill(C.navy);
  let x = left;
  doc.font(F.bold).fontSize(7).fillColor(C.white);
  headers.forEach((h, i) => {
    doc.text(h.toUpperCase(), x + 6, tableTop + 8.5, { width: cw[i] - 12, align: aligns[i], characterSpacing: 0.2 });
    x += cw[i];
  });
  doc.fillColor("#000000");

  // Data rows (dynamic height so long Particulars wrap cleanly without clipping)
  let y = tableTop + headerH;
  const baseRowH = 24;
  let sumTaxable = 0, sumCgst = 0, sumSgst = 0, sumTotal = 0;

  rows.forEach((r, ri) => {
    const taxable = Number(r.taxable || 0);
    const gstAmount = Number(r.gstAmount || 0);
    const cgst = round2(gstAmount / 2);
    const sgst = round2(gstAmount - cgst);
    const rowTotal = r.total != null ? Number(r.total) : round2(taxable + gstAmount);
    sumTaxable += taxable; sumCgst += cgst; sumSgst += sgst; sumTotal += rowTotal;

    const labelStr = String(r.label || "-");
    doc.font(F.bold).fontSize(8.5);
    const labelH = doc.heightOfString(labelStr, { width: cw[0] - 12 });
    const rowH = Math.max(baseRowH, Math.ceil(labelH) + 12);

    if (ri % 2 === 1) doc.rect(left, y, totalW, rowH).fill(C.rowTint);

    const rateLabel = r.ratePct != null && Number(r.ratePct) > 0 ? `${Number(r.ratePct)}%` : "-";
    const cells = [
      labelStr,
      r.hsn || "-",
      money(taxable),
      rateLabel,
      money(cgst),
      money(sgst),
      money(rowTotal),
    ];
    x = left;
    cells.forEach((cell, i) => {
      doc.font(i === 0 ? F.bold : F.regular).fontSize(8.5).fillColor(C.ink)
        .text(String(cell), x + 6, y + 7, { width: cw[i] - 12, align: aligns[i], lineBreak: i === 0 });
      x += cw[i];
    });
    doc.fillColor("#000000");
    if (ri < rows.length - 1) {
      doc.moveTo(left, y + rowH).lineTo(left + totalW, y + rowH).strokeColor(C.line).lineWidth(0.45).stroke();
    }
    y += rowH;
  });

  // Totals row (only meaningful with >1 particular).
  if (rows.length > 1) {
    doc.rect(left, y, totalW, baseRowH).fill(C.totalTint);
    const totalCells = ["Total", "", money(sumTaxable), "", money(sumCgst), money(sumSgst), money(sumTotal)];
    x = left;
    totalCells.forEach((cell, i) => {
      doc.font(F.bold).fontSize(8.5).fillColor(C.navy)
        .text(String(cell), x + 6, y + 7, { width: cw[i] - 12, align: aligns[i], lineBreak: false });
      x += cw[i];
    });
    doc.fillColor("#000000");
    y += baseRowH;
  }

  // Grid: outer border, header underline, column dividers.
  doc.rect(left, tableTop, totalW, y - tableTop).strokeColor(C.line).lineWidth(0.75).stroke();
  doc.moveTo(left, tableTop + headerH).lineTo(left + totalW, tableTop + headerH).strokeColor(C.line).lineWidth(0.75).stroke();
  if (rows.length > 1) {
    doc.moveTo(left, y - baseRowH).lineTo(left + totalW, y - baseRowH).strokeColor(C.line).lineWidth(0.75).stroke();
  }
  x = left;
  cw.forEach((w, i) => {
    if (i > 0) doc.moveTo(x, tableTop).lineTo(x, y).strokeColor(C.line).lineWidth(0.5).stroke();
    x += w;
  });

  // Grand Total emphasis bar, fused onto the table's bottom edge.
  if (showGrandTotalBar) {
    const gtH = 34;
    doc.rect(left, y, totalW, gtH).fill(C.navy);
    doc.rect(left, y, 4, gtH).fill(C.gold);
    doc.font(F.bold).fontSize(10).fillColor("#f6c76b")
      .text(grandTotalLabel.toUpperCase(), left + 16, y + 11.5, { width: totalW * 0.5, characterSpacing: 0.6 });
    doc.font(F.bold).fontSize(14.5).fillColor(C.white)
      .text(`${rsSpace}${money(grandTotal != null ? grandTotal : sumTotal)}`, left, y + 8, { width: totalW - 16, align: "right" });
    doc.fillColor("#000000");
    y += gtH;
  }

  doc.y = y + 10;

  if (note) {
    doc.font(F.italic).fontSize(7.5).fillColor(C.muted)
      .text(note, left, doc.y, { width: width });
    doc.fillColor("#000000");
    doc.y = doc.y + 8;
  }
}

module.exports = { drawFinancialBreakdown, money: money, round2, PALETTE };
