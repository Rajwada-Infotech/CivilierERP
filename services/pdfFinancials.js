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
    doc.font("Helvetica-Bold").fontSize(9).fillColor(C.goldDeep)
      .text(title.toUpperCase(), left, doc.y, { characterSpacing: 0.8 });
    doc.y += 14;
    doc.fillColor("#000000");
  }

  // 7 columns: Particulars | HSN/SAC | Taxable Value | GST% | CGST | SGST | Amount
  const cw = [
    width * 0.23, // Particulars
    width * 0.11, // HSN/SAC
    width * 0.17, // Taxable Value
    width * 0.09, // GST rate
    width * 0.13, // CGST
    width * 0.13, // SGST
    width * 0.14, // Amount (Total)
  ];
  const totalW = cw.reduce((a, b) => a + b, 0);
  const aligns = ["left", "center", "right", "center", "right", "right", "right"];
  const headers = ["Particulars", "HSN/SAC", "Taxable Value", "GST %", "CGST (Rs.)", "SGST (Rs.)", "Amount (Rs.)"];

  const tableTop = doc.y;
  const headerH = 26;

  // Header band (navy, white text). GST columns get a shared "GST" super-label
  // feel by simply being adjacent; kept single-row for compactness.
  doc.rect(left, tableTop, totalW, headerH).fill(C.navy);
  let x = left;
  doc.font("Helvetica-Bold").fontSize(7).fillColor(C.white);
  headers.forEach((h, i) => {
    doc.text(h.toUpperCase(), x + 6, tableTop + 8, { width: cw[i] - 12, align: aligns[i], characterSpacing: 0.2 });
    x += cw[i];
  });
  doc.fillColor("#000000");

  // Data rows
  let y = tableTop + headerH;
  const rowH = 22;
  let sumTaxable = 0, sumCgst = 0, sumSgst = 0, sumTotal = 0;

  rows.forEach((r, ri) => {
    const taxable = Number(r.taxable || 0);
    const gstAmount = Number(r.gstAmount || 0);
    const cgst = round2(gstAmount / 2);
    const sgst = round2(gstAmount - cgst);
    const rowTotal = r.total != null ? Number(r.total) : round2(taxable + gstAmount);
    sumTaxable += taxable; sumCgst += cgst; sumSgst += sgst; sumTotal += rowTotal;

    if (ri % 2 === 1) doc.rect(left, y, totalW, rowH).fill(C.rowTint);

    const rateLabel = r.ratePct != null && Number(r.ratePct) > 0 ? `${Number(r.ratePct)}%` : "-";
    const cells = [
      r.label,
      r.hsn || "-",
      money(taxable),
      rateLabel,
      money(cgst),
      money(sgst),
      money(rowTotal),
    ];
    x = left;
    cells.forEach((cell, i) => {
      doc.font(i === 0 ? "Helvetica-Bold" : "Helvetica").fontSize(8.5).fillColor(C.ink)
        .text(String(cell), x + 6, y + 6, { width: cw[i] - 12, align: aligns[i], lineBreak: false });
      x += cw[i];
    });
    doc.fillColor("#000000");
    y += rowH;
  });

  // Totals row (only meaningful with >1 particular, but harmless with one).
  if (rows.length > 1) {
    doc.rect(left, y, totalW, rowH).fill(C.totalTint);
    const totalCells = ["Total", "", money(sumTaxable), "", money(sumCgst), money(sumSgst), money(sumTotal)];
    x = left;
    totalCells.forEach((cell, i) => {
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C.navy)
        .text(String(cell), x + 6, y + 6, { width: cw[i] - 12, align: aligns[i], lineBreak: false });
      x += cw[i];
    });
    doc.fillColor("#000000");
    y += rowH;
  }

  // Grid: outer border, header underline, column dividers.
  doc.rect(left, tableTop, totalW, y - tableTop).strokeColor(C.line).lineWidth(0.75).stroke();
  doc.moveTo(left, tableTop + headerH).lineTo(left + totalW, tableTop + headerH).strokeColor(C.line).lineWidth(0.75).stroke();
  if (rows.length > 1) {
    doc.moveTo(left, y - rowH).lineTo(left + totalW, y - rowH).strokeColor(C.line).lineWidth(0.75).stroke();
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
    doc.font("Helvetica-Bold").fontSize(10.5).fillColor(C.gold)
      .text(grandTotalLabel.toUpperCase(), left + 16, y + 11, { width: totalW * 0.5, characterSpacing: 0.6 });
    doc.font("Helvetica-Bold").fontSize(15).fillColor(C.white)
      .text(`Rs. ${money(grandTotal != null ? grandTotal : sumTotal)}`, left, y + 8, { width: totalW - 16, align: "right" });
    doc.fillColor("#000000");
    y += gtH;
  }

  doc.y = y + 10;

  if (note) {
    doc.font("Helvetica-Oblique").fontSize(7).fillColor(C.muted)
      .text(note, left, doc.y, { width: width });
    doc.fillColor("#000000");
    doc.y += 12;
  }
}

module.exports = { drawFinancialBreakdown, money: money, round2, PALETTE };
