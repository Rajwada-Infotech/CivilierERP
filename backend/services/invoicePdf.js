const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");
const { sql } = require("../db");

const PDF_DIR = path.join(__dirname, "../uploads/crm-invoices");
if (!fs.existsSync(PDF_DIR)) fs.mkdirSync(PDF_DIR, { recursive: true });

function money(n) {
  const num = Number(n || 0);
  return num.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(d) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
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
// Indian numbering (Crore/Lakh/Thousand), not the international
// Million/Billion grouping — every other rupee amount in this app is shown
// in that same Indian grouping, so the words should match.
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

const INVOICE_TYPE_LABEL = {
  Booking: "Booking Amount",
  Milestone: "Milestone Payment",
  Maintenance: "Maintenance Charges",
  Other: "Other Charges",
};

async function fetchInvoiceData(pool, invoiceId) {
  const result = await pool.request().input("id", sql.Int, invoiceId).query(`
    SELECT
      inv.Id, inv.InvoiceNo, inv.InvoiceType, inv.Amount, inv.InvoiceDate, inv.Description, inv.CreatedAt, inv.Status,
      b.BookingNo, b.UnitNo, b.BlockName, b.ProjectName, b.AreaSqFt, b.RatePerSqFt, b.GrandTotal, b.HsnCode,
      a.ApplicationNo, a.ApplicantName, a.Mobile, a.Email,
      comp.name AS CompanyName, comp.address AS CompanyAddress, comp.address_line2 AS CompanyAddress2,
      comp.city AS CompanyCity, comp.state AS CompanyState, comp.pincode AS CompanyPincode,
      comp.gst_no AS CompanyGst, comp.pan_no AS CompanyPan, comp.phone AS CompanyPhone, comp.email AS CompanyEmail,
      proj.name AS ProjectFullName,
      c.Address AS CustomerAddress, c.City AS CustomerCity, c.State AS CustomerState, c.Pincode AS CustomerPincode
    FROM dbo.CrmInvoice inv
    JOIN dbo.CrmBooking b ON b.Id = inv.BookingId
    JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
    LEFT JOIN dbo.CrmCustomer c ON c.Id = a.CustomerId
    LEFT JOIN dbo.enterprise comp ON comp.id = b.CompanyId AND comp.business_type = 'C'
    LEFT JOIN dbo.enterprise proj ON proj.id = b.ProjectId AND proj.business_type = 'P'
    WHERE inv.Id = @id
  `);
  return result.recordset[0] || null;
}

// Generates the PDF and writes it to disk as <InvoiceNo>.pdf, replacing any
// prior file of the same name (an invoice is immutable once created — this
// only ever re-renders the same data, e.g. if the file was lost). Filename
// is deterministic from InvoiceNo, so no separate "file path" column is
// needed on CrmInvoice — the download route derives it the same way.
async function generateInvoicePdf(pool, invoiceId) {
  const d = await fetchInvoiceData(pool, invoiceId);
  if (!d) throw new Error("Invoice not found");

  const filePath = path.join(PDF_DIR, `${d.InvoiceNo}.pdf`);
  const doc = new PDFDocument({ size: "A4", margin: 40 });
  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const left = doc.page.margins.left;

  // ── Header band: Company identity + document title ──────────────────────
  // Drawn at fixed, explicitly-tracked coordinates rather than chained off
  // doc.y — .rect().fill() is a vector op that does NOT advance the text
  // flow cursor, so any text positioned via doc.y-relative arithmetic after
  // it silently lands wherever the cursor was BEFORE the rect, not inside
  // the band that was just drawn.
  const headerTop = doc.y;
  const headerHeight = 70;
  doc.rect(left, headerTop, pageWidth, headerHeight).fill("#0f172a");

  const leftColWidth = pageWidth * 0.62 - 14;
  doc.fillColor("#ffffff").fontSize(16).font("Helvetica-Bold")
    .text(d.CompanyName || "Company Name Not Set", left + 14, headerTop + 10, { width: leftColWidth, lineBreak: false });
  doc.fontSize(8).font("Helvetica")
    .text([d.CompanyAddress, d.CompanyAddress2].filter(Boolean).join(", "), left + 14, headerTop + 30, { width: leftColWidth, lineBreak: false })
    .text([d.CompanyCity, d.CompanyState, d.CompanyPincode].filter(Boolean).join(", "), left + 14, headerTop + 41, { width: leftColWidth, lineBreak: false });
  const gstPanLine = [d.CompanyGst ? `GSTIN: ${d.CompanyGst}` : null, d.CompanyPan ? `PAN: ${d.CompanyPan}` : null].filter(Boolean).join("   ");
  if (gstPanLine) doc.text(gstPanLine, left + 14, headerTop + 52, { width: leftColWidth, lineBreak: false });

  const rightColX = left + pageWidth * 0.62;
  const rightColWidth = pageWidth * 0.38 - 14;
  doc.fillColor("#ffffff").fontSize(18).font("Helvetica-Bold")
    .text("TAX INVOICE", rightColX, headerTop + 12, { width: rightColWidth, align: "right", lineBreak: false });
  doc.fontSize(9).font("Helvetica")
    .text(`No: ${d.InvoiceNo}`, rightColX, headerTop + 36, { width: rightColWidth, align: "right", lineBreak: false })
    .text(`Date: ${fmtDate(d.InvoiceDate || d.CreatedAt)}`, rightColX, headerTop + 49, { width: rightColWidth, align: "right", lineBreak: false });

  doc.fillColor("#000000");
  doc.y = headerTop + headerHeight + 20;

  // ── Bill To / Booking Reference two-column block ────────────────────────
  const colW = pageWidth / 2 - 10;
  const blockTop = doc.y;
  doc.font("Helvetica-Bold").fontSize(9).text("BILLED TO", left, blockTop);
  doc.font("Helvetica").fontSize(9.5)
    .text(d.ApplicantName || "-", left, blockTop + 14, { width: colW, continued: false })
    .text([d.CustomerAddress, d.CustomerCity, d.CustomerState, d.CustomerPincode].filter(Boolean).join(", ") || "-", { width: colW })
    .text(d.Mobile ? `Mobile: ${d.Mobile}` : "", { width: colW })
    .text(d.Email ? `Email: ${d.Email}` : "", { width: colW });

  const blockRightColX = left + colW + 20;
  doc.font("Helvetica-Bold").fontSize(9).text("BOOKING REFERENCE", blockRightColX, blockTop);
  doc.font("Helvetica").fontSize(9.5)
    .text(`Booking No: ${d.BookingNo}`, blockRightColX, blockTop + 14, { width: colW })
    .text(`Application No: ${d.ApplicationNo || "-"}`, blockRightColX, undefined, { width: colW })
    .text(`Project: ${d.ProjectFullName || d.ProjectName || "-"}`, blockRightColX, undefined, { width: colW })
    .text(`Unit: ${[d.UnitNo, d.BlockName].filter(Boolean).join(" / ") || "-"}`, blockRightColX, undefined, { width: colW });

  doc.y = Math.max(doc.y, blockTop + 90);
  doc.moveDown(0.5);
  doc.moveTo(left, doc.y).lineTo(left + pageWidth, doc.y).strokeColor("#cbd5e1").stroke();
  doc.moveDown(0.8);

  // ── Line item table ───────────────────────────────────────────────────────
  const tableTop = doc.y;
  const col1 = left, col1W = pageWidth * 0.12;
  const col2 = col1 + col1W, col2W = pageWidth * 0.58;
  const col3 = col2 + col2W, col3W = pageWidth - col1W - col2W;

  doc.rect(left, tableTop, pageWidth, 22).fill("#f1f5f9");
  doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(9)
    .text("#", col1 + 6, tableTop + 6, { width: col1W - 6 })
    .text("Description", col2 + 6, tableTop + 6, { width: col2W - 6 })
    .text("Amount (Rs.)", col3, tableTop + 6, { width: col3W - 6, align: "right" });

  const rowY = tableTop + 22;
  const description = d.Description || `${INVOICE_TYPE_LABEL[d.InvoiceType] || d.InvoiceType} — ${d.BookingNo}`;
  doc.font("Helvetica").fontSize(9.5).fillColor("#000000")
    .text("1", col1 + 6, rowY + 8, { width: col1W - 6 })
    .text(description, col2 + 6, rowY + 8, { width: col2W - 6 })
    .text(money(d.Amount), col3, rowY + 8, { width: col3W - 6, align: "right" });
  const rowH = Math.max(28, doc.heightOfString(description, { width: col2W - 6 }) + 16);
  doc.rect(left, tableTop, pageWidth, 22 + rowH).strokeColor("#cbd5e1").stroke();
  doc.moveTo(col2, tableTop).lineTo(col2, tableTop + 22 + rowH).strokeColor("#cbd5e1").stroke();
  doc.moveTo(col3, tableTop).lineTo(col3, tableTop + 22 + rowH).strokeColor("#cbd5e1").stroke();
  doc.moveTo(left, tableTop + 22).lineTo(left + pageWidth, tableTop + 22).strokeColor("#cbd5e1").stroke();

  doc.y = tableTop + 22 + rowH + 10;

  // ── Total ──────────────────────────────────────────────────────────────
  doc.font("Helvetica-Bold").fontSize(11)
    .text(`Total: Rs. ${money(d.Amount)}`, left, doc.y, { width: pageWidth, align: "right" });
  doc.moveDown(0.4);
  doc.font("Helvetica-Oblique").fontSize(8.5).fillColor("#475569")
    .text(`Amount in words: ${numberToWordsIndian(d.Amount)}`, left, doc.y, { width: pageWidth, align: "right" });
  doc.fillColor("#000000");

  // ── Footer ─────────────────────────────────────────────────────────────
  const footerY = doc.page.height - doc.page.margins.bottom - 70;
  doc.moveTo(left, footerY).lineTo(left + pageWidth, footerY).strokeColor("#cbd5e1").stroke();
  doc.font("Helvetica").fontSize(8).fillColor("#64748b")
    .text("This is a system-generated invoice and does not require a physical signature.", left, footerY + 8, { width: pageWidth })
    .text(`Generated on ${fmtDate(new Date())} — ${d.CompanyName || ""}`, left, footerY + 20, { width: pageWidth });
  doc.text(`Status: ${d.Status || "Active"}`, left, footerY + 32, { width: pageWidth });

  doc.end();
  await new Promise((resolve, reject) => {
    stream.on("finish", resolve);
    stream.on("error", reject);
  });
  return filePath;
}

function invoicePdfPath(invoiceNo) {
  return path.join(PDF_DIR, `${invoiceNo}.pdf`);
}

module.exports = { generateInvoicePdf, invoicePdfPath, PDF_DIR };
