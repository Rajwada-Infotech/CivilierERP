const PDFDocument = require("pdfkit");
const { sql } = require("../db");

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
  OnAccount: "On-Account Payment",
};

// Data-URL ("data:image/png;base64,....") -> Buffer pdfkit can embed, or
// null if the source isn't there or isn't a raster format pdfkit supports
// (it can't rasterize SVG, and dbo.enterprise.logo can hold either
// depending on how the record was set up).
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

async function fetchInvoiceData(pool, invoiceId) {
  const result = await pool.request().input("id", sql.Int, invoiceId).query(`
    SELECT
      inv.Id, inv.InvoiceNo, inv.InvoiceType, inv.Amount, inv.InvoiceDate, inv.Description, inv.CreatedAt, inv.Status, inv.MilestoneId, inv.OnAccountPaymentId,
      b.BookingNo, b.UnitNo, b.BlockName, b.ProjectName, b.AreaSqFt, b.RatePerSqFt, b.GrandTotal, b.HsnCode,
      a.ApplicationNo, a.ApplicantName, a.Mobile, a.Email,
      comp.name AS CompanyName, comp.address AS CompanyAddress, comp.address_line2 AS CompanyAddress2,
      comp.city AS CompanyCity, comp.state AS CompanyState, comp.pincode AS CompanyPincode,
      comp.gst_no AS CompanyGst, comp.pan_no AS CompanyPan, comp.phone AS CompanyPhone, comp.email AS CompanyEmail,
      comp.logo AS CompanyLogo,
      proj.name AS ProjectFullName, proj.rera_no AS ProjectRera,
      c.Address AS CustomerAddress, c.City AS CustomerCity, c.State AS CustomerState, c.Pincode AS CustomerPincode,
      m.MilestoneNo, m.MilestoneName, m.PaidDate AS MilestonePaidDate, m.PaymentMode AS MilestonePaymentMode,
      oa.ReceiptNo AS OnAccountReceiptNo, oa.ReceivedDate AS OnAccountReceivedDate, oa.PaymentMode AS OnAccountPaymentMode
    FROM dbo.CrmInvoice inv
    JOIN dbo.CrmBooking b ON b.Id = inv.BookingId
    JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
    LEFT JOIN dbo.CrmCustomer c ON c.Id = a.CustomerId
    LEFT JOIN dbo.enterprise comp ON comp.id = b.CompanyId AND comp.business_type = 'C'
    LEFT JOIN dbo.enterprise proj ON proj.id = b.ProjectId AND proj.business_type = 'P'
    LEFT JOIN dbo.CrmPaymentMilestone m ON m.Id = inv.MilestoneId
    LEFT JOIN dbo.CrmOnAccountPayment oa ON oa.Id = inv.OnAccountPaymentId
    WHERE inv.Id = @id
  `);
  return result.recordset[0] || null;
}

// Renders the invoice to an in-memory PDF buffer — nothing touches disk.
// The caller is responsible for persisting the buffer (as base64) onto the
// CrmInvoice row; this function only knows how to draw the document.
function renderInvoicePdfBuffer(d) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const left = doc.page.margins.left;
    const logoBuf = decodeLogo(d.CompanyLogo);

    // ── Header band: logo + company identity + document title ────────────
    // Drawn at fixed, explicitly-tracked coordinates rather than chained off
    // doc.y — .rect().fill() is a vector op that does NOT advance the text
    // flow cursor, so any text positioned via doc.y-relative arithmetic after
    // it silently lands wherever the cursor was BEFORE the rect, not inside
    // the band that was just drawn.
    const headerTop = doc.y;
    const headerHeight = 82;
    doc.rect(left, headerTop, pageWidth, headerHeight).fill("#0f172a");

    let textStartX = left + 14;
    if (logoBuf) {
      try {
        // White backing chip so dark/transparent-background logos stay legible
        // against the dark header band.
        doc.roundedRect(left + 12, headerTop + 12, 58, 58, 6).fill("#ffffff");
        doc.image(logoBuf, left + 16, headerTop + 16, { fit: [50, 50], align: "center", valign: "center" });
        textStartX = left + 82;
      } catch {
        // Corrupt/unsupported image data — fall back to text-only header
        // rather than failing invoice generation over a logo.
        textStartX = left + 14;
      }
    }

    const leftColWidth = pageWidth * 0.62 - (textStartX - left);
    doc.fillColor("#ffffff").fontSize(17).font("Helvetica-Bold")
      .text(d.CompanyName || "Company Name Not Set", textStartX, headerTop + 12, { width: leftColWidth, lineBreak: false });
    doc.fontSize(8).font("Helvetica")
      .text([d.CompanyAddress, d.CompanyAddress2].filter(Boolean).join(", "), textStartX, headerTop + 33, { width: leftColWidth, lineBreak: false })
      .text([d.CompanyCity, d.CompanyState, d.CompanyPincode].filter(Boolean).join(", "), textStartX, headerTop + 44, { width: leftColWidth, lineBreak: false });
    const gstPanLine = [d.CompanyGst ? `GSTIN: ${d.CompanyGst}` : null, d.CompanyPan ? `PAN: ${d.CompanyPan}` : null].filter(Boolean).join("   ");
    if (gstPanLine) doc.text(gstPanLine, textStartX, headerTop + 55, { width: leftColWidth, lineBreak: false });
    const contactLine = [d.CompanyPhone, d.CompanyEmail].filter(Boolean).join("   ");
    if (contactLine) doc.text(contactLine, textStartX, headerTop + 66, { width: leftColWidth, lineBreak: false });

    const rightColX = left + pageWidth * 0.62;
    const rightColWidth = pageWidth * 0.38 - 14;
    doc.fillColor("#ffffff").fontSize(19).font("Helvetica-Bold")
      .text("TAX INVOICE", rightColX, headerTop + 14, { width: rightColWidth, align: "right", lineBreak: false });
    doc.fontSize(9).font("Helvetica")
      .text(`No: ${d.InvoiceNo}`, rightColX, headerTop + 39, { width: rightColWidth, align: "right", lineBreak: false })
      .text(`Date: ${fmtDate(d.InvoiceDate || d.CreatedAt)}`, rightColX, headerTop + 52, { width: rightColWidth, align: "right", lineBreak: false });
    // Status pill, top-right of the header — quick visual read without
    // opening the record (Generated / Paid / Cancelled etc.).
    const statusText = (d.Status || "Generated").toUpperCase();
    doc.fontSize(7.5).font("Helvetica-Bold")
      .fillColor("#94a3b8").text(statusText, rightColX, headerTop + 66, { width: rightColWidth, align: "right", lineBreak: false });

    doc.fillColor("#000000");
    doc.y = headerTop + headerHeight + 20;

    // ── Bill To / Booking Reference two-column block ────────────────────────
    const colW = pageWidth / 2 - 10;
    const blockTop = doc.y;
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#0f172a").text("BILLED TO", left, blockTop);
    doc.font("Helvetica").fontSize(9.5).fillColor("#000000")
      .text(d.ApplicantName || "-", left, blockTop + 14, { width: colW, continued: false })
      .text([d.CustomerAddress, d.CustomerCity, d.CustomerState, d.CustomerPincode].filter(Boolean).join(", ") || "-", { width: colW })
      .text(d.Mobile ? `Mobile: ${d.Mobile}` : "", { width: colW })
      .text(d.Email ? `Email: ${d.Email}` : "", { width: colW });

    const blockRightColX = left + colW + 20;
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#0f172a").text("BOOKING REFERENCE", blockRightColX, blockTop);
    doc.font("Helvetica").fontSize(9.5).fillColor("#000000")
      .text(`Booking No: ${d.BookingNo}`, blockRightColX, blockTop + 14, { width: colW })
      .text(`Application No: ${d.ApplicationNo || "-"}`, blockRightColX, undefined, { width: colW })
      .text(`Project: ${d.ProjectFullName || d.ProjectName || "-"}`, blockRightColX, undefined, { width: colW })
      .text(`Unit: ${[d.UnitNo, d.BlockName].filter(Boolean).join(" / ") || "-"}`, blockRightColX, undefined, { width: colW });
    if (d.ProjectRera) doc.text(`RERA: ${d.ProjectRera}`, blockRightColX, undefined, { width: colW });

    doc.y = Math.max(doc.y, blockTop + 92);
    doc.moveDown(0.5);
    doc.moveTo(left, doc.y).lineTo(left + pageWidth, doc.y).strokeColor("#cbd5e1").stroke();
    doc.moveDown(0.6);

    // ── Payment context panel — what this specific invoice is for, in plain
    // terms, rather than leaving the reader to infer it from the line item
    // description alone. Only rendered when there's real payment data to show
    // (Milestone invoices always have it; Maintenance/Other may not).
    if (d.InvoiceType === "Milestone" || d.MilestonePaidDate || d.InvoiceType === "OnAccount") {
      const isOnAccount = d.InvoiceType === "OnAccount";
      const panelTop = doc.y;
      const panelH = 34;
      doc.rect(left, panelTop, pageWidth, panelH).fill("#f8fafc");
      doc.strokeColor("#e2e8f0").rect(left, panelTop, pageWidth, panelH).stroke();
      const cellW = pageWidth / 3;
      const cellPad = 10;
      doc.font("Helvetica").fontSize(7.5).fillColor("#64748b")
        .text(isOnAccount ? "PAYMENT REF" : "PAYMENT STAGE", left + cellPad, panelTop + 6, { width: cellW - cellPad })
        .text(isOnAccount ? "RECEIVED ON" : "PAID ON", left + cellW + cellPad, panelTop + 6, { width: cellW - cellPad })
        .text("PAYMENT MODE", left + 2 * cellW + cellPad, panelTop + 6, { width: cellW - cellPad });
      doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#0f172a")
        .text(isOnAccount ? (d.OnAccountReceiptNo || "-") : (d.MilestoneName || INVOICE_TYPE_LABEL[d.InvoiceType] || d.InvoiceType), left + cellPad, panelTop + 17, { width: cellW - cellPad, lineBreak: false })
        .text(fmtDate(isOnAccount ? d.OnAccountReceivedDate : d.MilestonePaidDate), left + cellW + cellPad, panelTop + 17, { width: cellW - cellPad, lineBreak: false })
        .text((isOnAccount ? d.OnAccountPaymentMode : d.MilestonePaymentMode) || "-", left + 2 * cellW + cellPad, panelTop + 17, { width: cellW - cellPad, lineBreak: false });
      doc.fillColor("#000000");
      doc.y = panelTop + panelH + 14;
    }

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
    doc.moveDown(1.2);

    // ── Terms & signature block ──────────────────────────────────────────
    const termsTop = doc.y;
    const termsColW = pageWidth * 0.6;
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#0f172a").text("TERMS & NOTES", left, termsTop);
    doc.font("Helvetica").fontSize(7.5).fillColor("#475569");
    const terms = [
      "This invoice reflects a payment already received against the booking referenced above.",
      "Please retain this document for your records; it may be required for loan disbursement or possession formalities.",
      "For any discrepancy, contact the project sales office within 15 days of the invoice date.",
    ];
    let ty = termsTop + 13;
    for (const t of terms) {
      doc.text(`•  ${t}`, left, ty, { width: termsColW });
      ty = doc.y + 2;
    }

    const sigColX = left + termsColW + 20;
    const sigColW = pageWidth - termsColW - 20;
    doc.font("Helvetica").fontSize(8.5).fillColor("#0f172a")
      .text(`For ${d.CompanyName || "the Company"}`, sigColX, termsTop, { width: sigColW, align: "center" });
    doc.moveTo(sigColX + 10, termsTop + 46).lineTo(sigColX + sigColW - 10, termsTop + 46).strokeColor("#94a3b8").stroke();
    doc.font("Helvetica").fontSize(7.5).fillColor("#64748b")
      .text("Authorized Signatory", sigColX, termsTop + 50, { width: sigColW, align: "center" });

    doc.y = Math.max(ty, termsTop + 64) + 16;
    doc.fillColor("#000000");

    // ── Footer ─────────────────────────────────────────────────────────────
    const footerY = doc.page.height - doc.page.margins.bottom - 46;
    doc.moveTo(left, footerY).lineTo(left + pageWidth, footerY).strokeColor("#cbd5e1").stroke();
    doc.font("Helvetica").fontSize(7.5).fillColor("#94a3b8")
      .text("This is a system-generated invoice and does not require a physical signature.", left, footerY + 8, { width: pageWidth })
      .text(`Generated ${fmtDateTime(new Date())} — ${d.CompanyName || ""} — Invoice ${d.InvoiceNo}`, left, footerY + 19, { width: pageWidth });

    doc.end();
  });
}

// Generates the PDF and persists it (as base64) directly on the CrmInvoice
// row — no file on disk, nothing that can go missing between deploys or
// diverge across app instances. Returns the base64 string that was stored.
async function generateInvoicePdf(pool, invoiceId) {
  const d = await fetchInvoiceData(pool, invoiceId);
  if (!d) throw new Error("Invoice not found");

  const buffer = await renderInvoicePdfBuffer(d);
  const base64 = buffer.toString("base64");

  await pool.request()
    .input("id", sql.Int, invoiceId)
    .input("pdf", sql.NVarChar(sql.MAX), base64)
    .query(`UPDATE dbo.CrmInvoice SET PdfBase64 = @pdf, PdfGeneratedAt = SYSDATETIME() WHERE Id = @id`);

  return base64;
}

// Returns the stored PDF as a Buffer, regenerating (and re-persisting) it on
// the fly if the row predates this column or was somehow cleared — an
// invoice's PDF is always derivable from its own row data, so there's no
// "permanently lost" state the way a missing disk file used to be.
async function getInvoicePdfBuffer(pool, invoiceId) {
  const row = await pool.request().input("id", sql.Int, invoiceId)
    .query("SELECT PdfBase64 FROM dbo.CrmInvoice WHERE Id = @id");
  const existing = row.recordset[0]?.PdfBase64;
  if (existing) return Buffer.from(existing, "base64");

  const base64 = await generateInvoicePdf(pool, invoiceId);
  return Buffer.from(base64, "base64");
}

module.exports = { generateInvoicePdf, getInvoicePdfBuffer, renderInvoicePdfBuffer };
