const PDFDocument = require("pdfkit");
const { sql } = require("../db");
const { drawFinancialBreakdown } = require("./pdfFinancials");

function money(n) {
  const num = Number(n || 0);
  return num.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(d) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
function fmtDateTime(d) {
  if (!d) return "-";
  return new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
function twoDigitWords(n) {
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? " " + ONES[n % 10] : "");
}
function threeDigitWords(n) {
  if (n >= 100) return ONES[Math.floor(n / 100)] + " Hundred" + (n % 100 ? " " + twoDigitWords(n % 100) : "");
  return twoDigitWords(n);
}
// Indian numbering (Crore/Lakh/Thousand) — matches invoicePdf.js's own grouping.
function numberToWordsIndian(amount) {
  let n = Math.round(Number(amount || 0));
  if (n === 0) return "Zero Rupees Only";
  const crore = Math.floor(n / 1e7); n %= 1e7;
  const lakh = Math.floor(n / 1e5); n %= 1e5;
  const thousand = Math.floor(n / 1e3); n %= 1e3;
  const rest = n;
  const parts = [];
  if (crore) parts.push(threeDigitWords(crore) + " Crore");
  if (lakh) parts.push(threeDigitWords(lakh) + " Lakh");
  if (thousand) parts.push(threeDigitWords(thousand) + " Thousand");
  if (rest) parts.push(threeDigitWords(rest));
  return parts.join(" ") + " Rupees Only";
}

function decodeLogo(dataUrl) {
  if (!dataUrl || typeof dataUrl !== "string") return null;
  const match = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(dataUrl.trim());
  if (!match) return null;
  try {
    return Buffer.from(match[2], "base64");
  } catch {
    return null;
  }
}

// Two independent status sources feed the same displayed value, deliberately:
// mr.Status is the customer-facing approval state (Pending -> Approved via
// approveMoneyReceipt when Account's Head signs off; Pending -> Bounced via
// bounceMoneyReceipt if the instrument itself failed), while rpStatus is the
// downstream Finance/ledger state on the linked ReceivedPayment row. Priority:
//   mr.Status = 'Approved'  -> "Approved"   (customer-facing sign-off)
//   mr.Status = 'Bounced'   -> "Bounced"    (instrument bounced pre-approval)
//   rpStatus  = 'Approved'  -> "Approved"   (auto-generated MRs from
//                                            ensureMoneyReceiptForApproved
//                                            Payment: mr.Status = 'Approved'
//                                            already, so this only kicks in
//                                            for legacy rows that predate it)
//   rpStatus  = 'Rejected'  -> "Bounced"    (RPRejectionNote becomes the
//                                            bounce reason shown on the doc)
//   otherwise               -> "Pending"
function deriveStatus(moneyReceiptStatus, rpStatus) {
  if (moneyReceiptStatus === "Approved") return "Approved";
  if (moneyReceiptStatus === "Bounced") return "Bounced";
  if (rpStatus === "Approved") return "Approved";
  if (rpStatus === "Rejected") return "Bounced";
  return "Pending";
}

async function fetchMoneyReceiptData(pool, receiptId) {
  const result = await pool.request().input("id", sql.Int, receiptId).query(`
    SELECT
      mr.*,
      rp.RPStatus, rp.RPRejectionNote,
      b.BookingNo, b.UnitNo, b.BlockName, b.ProjectName,
      b.TotalValue, b.TotalGstAmount, b.GrandTotal, b.UnitParkingGstRate, b.HsnCode,
      a.ApplicationNo, a.ApplicantName, a.Mobile, a.Email,
      comp.name AS CompanyName, comp.address AS CompanyAddress, comp.address_line2 AS CompanyAddress2,
      comp.city AS CompanyCity, comp.state AS CompanyState, comp.pincode AS CompanyPincode,
      comp.gst_no AS CompanyGst, comp.pan_no AS CompanyPan, comp.phone AS CompanyPhone, comp.email AS CompanyEmail,
      comp.logo AS CompanyLogo,
      proj.name AS ProjectFullName, proj.rera_no AS ProjectRera,
      c.Address AS CustomerAddress, c.City AS CustomerCity, c.State AS CustomerState, c.Pincode AS CustomerPincode
    FROM dbo.CrmMoneyReceipt mr
    JOIN dbo.CrmBooking b ON b.Id = mr.BookingId
    JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
    LEFT JOIN dbo.ReceivedPayment rp ON rp.RPPaymentID = mr.ReceivedPaymentId
    LEFT JOIN dbo.CrmCustomer c ON c.Id = a.CustomerId
    LEFT JOIN dbo.enterprise comp ON comp.id = b.CompanyId AND comp.business_type = 'C'
    LEFT JOIN dbo.enterprise proj ON proj.id = b.ProjectId AND proj.business_type = 'P'
    WHERE mr.Id = @id
  `);
  const row = result.recordset[0];
  if (!row) return null;
  row.Status = deriveStatus(row.Status, row.RPStatus);
  if (row.Status === "Bounced") row.BouncedReason = row.RPRejectionNote || row.BouncedReason;
  return row;
}

async function getMoneyReceiptByReceivedPaymentId(pool, receivedPaymentId) {
  const result = await pool.request().input("rpid", sql.Int, receivedPaymentId)
    .query("SELECT Id FROM dbo.CrmMoneyReceipt WHERE ReceivedPaymentId = @rpid");
  return result.recordset[0] || null;
}

// Diagonal watermark, sized to span the full page like a real background
// security print — large, very low opacity, sitting behind every other
// element rather than reading as a stamped label. Drawn first so every
// later fill/text sits on top of it. Only shown for non-final states
// (Pending/Bounced); an Approved receipt is a clean, final document.
function drawWatermark(doc, text, color) {
  const cx = doc.page.width / 2;
  const cy = doc.page.height / 2;
  const span = Math.max(doc.page.width, doc.page.height) * 1.15;
  // doc.save()/restore() only cover the graphics state (transform, opacity,
  // fill color) — NOT the text cursor (doc.x/doc.y), which .text() mutates
  // to whatever coordinate the rotated write ends up landing on. Left
  // uncaptured, that corrupted cursor cascades into a wall of extra pages
  // for the rest of the document, so it's saved/restored by hand here.
  const cursorX = doc.x, cursorY = doc.y;
  doc.save();
  doc.rotate(-38, { origin: [cx, cy] });
  doc.opacity(0.09);
  doc.font("Helvetica-Bold").fontSize(96).fillColor(color)
    .text(text, cx - span / 2, cy - 55, { width: span, align: "center", lineBreak: false });
  doc.restore();
  doc.x = cursorX;
  doc.y = cursorY;
}

// Renders the receipt to an in-memory PDF buffer — a compact, single-page,
// certificate-style layout: thin brand accent rule, centered logo + company
// identity, a large diagonal PROVISIONAL / BOUNCED watermark for anything
// short of a clean Approved document, and one hero amount panel rather than
// a dense table — brief and presentable enough to hand straight to a customer.
function renderMoneyReceiptPdfBuffer(d) {
  return new Promise((resolve, reject) => {
    // A brief, single-panel document doesn't need a full A4 sheet — a
    // shorter custom page (A4 width, ~46% of its height) keeps the receipt
    // looking deliberately sized rather than a mostly-blank full page.
    const doc = new PDFDocument({ size: [595.28, 610], margin: 40 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const left = doc.page.margins.left;
    const logoBuf = decodeLogo(d.CompanyLogo);

    const accent = d.Status === "Approved" ? "#15803d" : d.Status === "Bounced" ? "#b91c1c" : "#b45309";
    const statusLabel = d.Status === "Approved" ? "APPROVED" : d.Status === "Bounced" ? "BOUNCED" : "PROVISIONAL";

    if (d.Status !== "Approved") {
      drawWatermark(doc, statusLabel, accent);
    }

    // ── Top accent rule + outer card frame — gives the page a designed,
    // bounded edge rather than text just starting at the margin.
    doc.rect(left, doc.y, pageWidth, 4).fill(accent);
    doc.y += 20;

    // ── Header: centered logo, company identity, document title ─────────
    if (logoBuf) {
      try {
        doc.image(logoBuf, left + pageWidth / 2 - 26, doc.y, { fit: [52, 52], align: "center", valign: "center" });
        doc.y += 58;
      } catch {
        /* fall through to text-only header */
      }
    }
    doc.font("Helvetica-Bold").fontSize(15).fillColor("#0f172a")
      .text(d.CompanyName || "Company Name Not Set", left, doc.y, { width: pageWidth, align: "center" });
    doc.font("Helvetica").fontSize(8).fillColor("#64748b")
      .text([d.CompanyAddress, d.CompanyAddress2, d.CompanyCity, d.CompanyState, d.CompanyPincode].filter(Boolean).join(", "), left, doc.y + 3, { width: pageWidth, align: "center" });
    const gstPanLine = [d.CompanyGst ? `GSTIN ${d.CompanyGst}` : null, d.CompanyPan ? `PAN ${d.CompanyPan}` : null, d.CompanyPhone, d.CompanyEmail].filter(Boolean).join("   ·   ");
    if (gstPanLine) doc.text(gstPanLine, left, doc.y + 2, { width: pageWidth, align: "center" });
    doc.moveDown(0.9);

    doc.moveTo(left + pageWidth * 0.32, doc.y).lineTo(left + pageWidth * 0.68, doc.y).strokeColor("#cbd5e1").lineWidth(0.75).stroke();
    doc.moveDown(0.7);

    doc.font("Helvetica-Bold").fontSize(20).fillColor("#0f172a")
      .text("MONEY RECEIPT", left, doc.y, { width: pageWidth, align: "center", characterSpacing: 1.2 });
    doc.moveDown(0.3);
    doc.font("Helvetica").fontSize(9).fillColor("#64748b")
      .text(`${d.ReceiptNo}   ·   ${fmtDate(d.ReceivedDate || d.CreatedAt)}`, left, doc.y, { width: pageWidth, align: "center" });
    doc.moveDown(0.5);

    // Compact status chip — a quieter, secondary cue next to the watermark
    // rather than the page's main focal point.
    doc.font("Helvetica-Bold").fontSize(8.5);
    const chipText = statusLabel;
    const chipW = doc.widthOfString(chipText) + 20;
    const chipX = left + pageWidth / 2 - chipW / 2;
    doc.roundedRect(chipX, doc.y, chipW, 18, 9).fillColor(accent).fillOpacity(0.12).fill();
    doc.fillOpacity(1).fillColor(accent).text(chipText, chipX, doc.y + 4, { width: chipW, align: "center", lineBreak: false });
    doc.fillColor("#000000");
    doc.y += 30;

    // ── Received From / Booking Reference ────────────────────────────────
    const colW = pageWidth / 2 - 12;
    const blockTop = doc.y;
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#94a3b8").text("RECEIVED FROM", left, blockTop, { characterSpacing: 0.5 });
    doc.font("Helvetica-Bold").fontSize(10.5).fillColor("#0f172a")
      .text(d.ApplicantName || "-", left, blockTop + 12, { width: colW });
    doc.font("Helvetica").fontSize(8.5).fillColor("#475569")
      .text([d.CustomerAddress, d.CustomerCity, d.CustomerState, d.CustomerPincode].filter(Boolean).join(", ") || "-", left, undefined, { width: colW })
      .text([d.Mobile, d.Email].filter(Boolean).join("   ·   "), left, undefined, { width: colW });

    const blockRightColX = left + colW + 24;
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#94a3b8").text("BOOKING REFERENCE", blockRightColX, blockTop, { characterSpacing: 0.5 });
    doc.font("Helvetica-Bold").fontSize(10.5).fillColor("#0f172a")
      .text(d.BookingNo, blockRightColX, blockTop + 12, { width: colW });
    doc.font("Helvetica").fontSize(8.5).fillColor("#475569")
      .text(`${d.ProjectFullName || d.ProjectName || "-"} · Unit ${[d.UnitNo, d.BlockName].filter(Boolean).join("/") || "-"}`, blockRightColX, undefined, { width: colW })
      .text([d.ApplicationNo ? `App. ${d.ApplicationNo}` : null, d.ProjectRera ? `RERA ${d.ProjectRera}` : null].filter(Boolean).join("   ·   "), blockRightColX, undefined, { width: colW });

    doc.y = Math.max(doc.y, blockTop + 62) + 16;
    doc.fillColor("#000000");

    // ── Amount received — the shared GST tax-computation matrix ────────────
    // Same component the Application Form and Tax Invoice use, so the money
    // received is shown with the identical professional Taxable / CGST / SGST
    // breakdown rather than a bare number with a small separated split line.
    //
    // Use the stored snapshot if available (set at receipt creation time via
    // migration 357); fall back to deriving from the booking's own GST rate
    // for older receipts. Formula: gst = amount × rate/100, principal =
    // amount − gst (rate/100 not rate/(100+rate) — the receipt amount is the
    // agreed booking amount on which GST is levied; the customer pays
    // principal + GST separately).
    const amount = Number(d.Amount || 0);
    let amountGst, amountPrin;
    if (d.BaseAmount != null && d.GSTAmount != null) {
      amountGst = Number(d.GSTAmount);
      amountPrin = Number(d.BaseAmount);
    } else {
      const rate = Number(d.UnitParkingGstRate || 0);
      if (rate > 0) {
        amountGst = Math.round(amount * rate / 100 * 100) / 100;
        amountPrin = Math.round((amount - amountGst) * 100) / 100;
      } else {
        const grandTotal = Number(d.GrandTotal || 1);
        const gstRatio = Number(d.TotalGstAmount || 0) / grandTotal;
        amountGst = Math.round(amount * gstRatio * 100) / 100;
        amountPrin = Math.round((amount - amountGst) * 100) / 100;
      }
    }
    const effRate = amountPrin > 0
      ? Math.round((amountGst / amountPrin) * 10000) / 100
      : Number(d.UnitParkingGstRate || 0);

    drawFinancialBreakdown(doc, [
      { label: "Payment Received", hsn: d.HsnCode || "-", taxable: amountPrin, gstAmount: amountGst, total: amount, ratePct: effRate },
    ], {
      left, width: pageWidth,
      grandTotal: amount, grandTotalLabel: "Amount Received",
      note: numberToWordsIndian(amount),
    });

    // ── Payment details strip ─────────────────────────────────────────────
    const stripTop = doc.y;
    const cellW = pageWidth / 3;
    const instrumentRef = d.PaymentMode === "Cheque" ? (d.ChequeNo || "-") : (d.TransactionRef || "-");
    const details = [
      ["PAYMENT MODE", d.PaymentMode || "-"],
      [d.PaymentMode === "Cheque" ? "CHEQUE NO." : "REFERENCE NO.", instrumentRef],
      [d.PaymentMode === "Cheque" ? "CHEQUE DATE" : "RECEIVED ON", fmtDate(d.PaymentMode === "Cheque" ? d.ChequeDate : d.ReceivedDate)],
    ];
    details.forEach(([label, value], idx) => {
      const x = left + idx * cellW;
      doc.font("Helvetica").fontSize(7.5).fillColor("#94a3b8").text(label, x, stripTop, { width: cellW - 8, characterSpacing: 0.4 });
      doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#0f172a").text(value, x, stripTop + 11, { width: cellW - 8, lineBreak: false });
    });
    doc.fillColor("#000000");
    doc.y = stripTop + 30;
    if (d.BankName) {
      doc.font("Helvetica").fontSize(8).fillColor("#64748b").text(`Bank: ${d.BankName}`, left, doc.y);
      doc.fillColor("#000000");
    }
    doc.moveDown(0.6);

    if (d.Remarks) {
      doc.font("Helvetica-Oblique").fontSize(8).fillColor("#64748b").text(d.Remarks, left, doc.y, { width: pageWidth });
      doc.fillColor("#000000");
      doc.moveDown(0.4);
    }
    if (d.Status === "Bounced" && d.BouncedReason) {
      doc.font("Helvetica-Bold").fontSize(8).fillColor("#b91c1c")
        .text(`Bounce reason: ${d.BouncedReason}`, left, doc.y, { width: pageWidth });
      doc.fillColor("#000000");
      doc.moveDown(0.4);
    }

    // ── Brief note + signature ────────────────────────────────────────────
    const noteTop = doc.y + 10;
    const noteColW = pageWidth * 0.62;
    const note = d.Status === "Approved"
      ? "This receipt confirms an approved payment against the booking referenced above. Please retain it for your records."
      : d.Status === "Bounced"
      ? "This instrument did not clear and this receipt is void. A fresh payment will generate a new receipt."
      : "This is a provisional receipt acknowledging the amount/instrument noted above. It becomes an approved receipt upon clearance by internal finance. If the instrument does not clear, this receipt will be marked Bounced.";
    doc.font("Helvetica").fontSize(7.75).fillColor("#64748b")
      .text(note, left, noteTop, { width: noteColW });

    const sigColX = left + noteColW + 20;
    const sigColW = pageWidth - noteColW - 20;
    doc.font("Helvetica").fontSize(8.5).fillColor("#0f172a")
      .text(`For ${d.CompanyName || "the Company"}`, sigColX, noteTop, { width: sigColW, align: "center" });
    doc.moveTo(sigColX + 8, noteTop + 40).lineTo(sigColX + sigColW - 8, noteTop + 40).strokeColor("#94a3b8").lineWidth(0.5).stroke();
    doc.font("Helvetica").fontSize(7.5).fillColor("#64748b")
      .text("Authorized Signatory", sigColX, noteTop + 44, { width: sigColW, align: "center" });

    doc.fillColor("#000000");

    // ── Footer ─────────────────────────────────────────────────────────────
    const footerY = doc.page.height - doc.page.margins.bottom - 30;
    doc.moveTo(left, footerY).lineTo(left + pageWidth, footerY).strokeColor("#e2e8f0").lineWidth(0.5).stroke();
    doc.font("Helvetica").fontSize(7).fillColor("#94a3b8")
      .text("System-generated — no physical signature required.", left, footerY + 7, { width: pageWidth * 0.6 })
      .text(`Generated ${fmtDateTime(new Date())}`, left + pageWidth * 0.6, footerY + 7, { width: pageWidth * 0.4, align: "right" });

    doc.end();
  });
}

async function generateMoneyReceiptPdf(pool, receiptId) {
  const d = await fetchMoneyReceiptData(pool, receiptId);
  if (!d) throw new Error("Money receipt not found");

  const buffer = await renderMoneyReceiptPdfBuffer(d);
  const base64 = buffer.toString("base64");

  await pool.request()
    .input("id", sql.Int, receiptId)
    .input("pdf", sql.NVarChar(sql.MAX), base64)
    .query(`UPDATE dbo.CrmMoneyReceipt SET PdfBase64 = @pdf, PdfGeneratedAt = SYSDATETIME() WHERE Id = @id`);

  return base64;
}

// Self-healing like invoicePdf.js's getInvoicePdfBuffer — but a Money
// Receipt's PDF must always reflect the CURRENT Status (Pending/Approved/
// Bounced badge), so unlike an invoice this always regenerates rather than
// trusting a stale cached copy from before an approve/bounce transition.
async function getMoneyReceiptPdfBuffer(pool, receiptId) {
  const base64 = await generateMoneyReceiptPdf(pool, receiptId);
  return Buffer.from(base64, "base64");
}

module.exports = { generateMoneyReceiptPdf, getMoneyReceiptPdfBuffer, renderMoneyReceiptPdfBuffer, fetchMoneyReceiptData, getMoneyReceiptByReceivedPaymentId, deriveStatus };
