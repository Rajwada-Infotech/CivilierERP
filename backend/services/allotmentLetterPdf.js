const PDFDocument = require("pdfkit");
const { sql } = require("../db");

function money(n) {
  const num = Number(n || 0);
  return "₹" + num.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function decodeLogo(dataUrl) {
  if (!dataUrl || typeof dataUrl !== "string") return null;
  const match = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(dataUrl.trim());
  if (!match) return null;
  try { return Buffer.from(match[2], "base64"); } catch { return null; }
}

const AL_PDF_SELECT = `
  SELECT
    al.Id, al.AlNo, al.BookingId, al.Status, al.IssuedOn, al.Remarks,
    b.BookingNo, b.BookingDate, b.BookingAmount, b.TotalValue, b.GrandTotal,
    b.AreaSqFt, b.RatePerSqFt, b.BlockName,
    COALESCE(bn.UnitNo, b.UnitNo) AS UnitNo,
    COALESCE(bn.ProjectName, b.ProjectName) AS ProjectName,
    a.ApplicantName, a.Mobile, a.Email, a.ApplicationNo,
    c.Address AS CustomerAddress, c.City AS CustomerCity, c.State AS CustomerState,
    comp.name AS CompanyName, comp.address AS CompanyAddress, comp.address_line2 AS CompanyAddress2,
    comp.city AS CompanyCity, comp.state AS CompanyState, comp.pincode AS CompanyPincode,
    comp.phone AS CompanyPhone, comp.email AS CompanyEmail, comp.logo AS CompanyLogo,
    proj.name AS ProjectFullName, proj.rera_no AS ProjectRera
  FROM dbo.CrmAllotmentLetter al
  JOIN dbo.CrmBooking b ON b.Id = al.BookingId
  JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
  LEFT JOIN dbo.CrmCustomer c ON c.Id = a.CustomerId
  LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
  LEFT JOIN dbo.enterprise comp ON comp.id = b.CompanyId AND comp.business_type = 'C'
  LEFT JOIN dbo.enterprise proj ON proj.id = b.ProjectId AND proj.business_type = 'P'
`;

async function fetchAllotmentLetterData(pool, id) {
  const r = await pool.request().input("id", sql.Int, id)
    .query(`${AL_PDF_SELECT} WHERE al.Id = @id`);
  return r.recordset[0] || null;
}

async function fetchAllotmentLetterDataByBookingId(pool, bookingId) {
  const r = await pool.request().input("bid", sql.Int, bookingId)
    .query(`${AL_PDF_SELECT} WHERE al.BookingId = @bid`);
  return r.recordset[0] || null;
}

function renderAllotmentLetterPdf(d) {
  return new Promise((resolve, reject) => {
    // A4: 595.28 × 841.89 pt. Margins: 45 all sides.
    const MARGIN = 45;
    const doc = new PDFDocument({ size: "A4", margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const PW = doc.page.width - MARGIN * 2;     // usable content width ≈ 505.28
    const PH = doc.page.height;                  // 841.89
    const left = MARGIN;

    // ── Fixed anchor positions (guarantee 1 page) ────────────────────────────
    // Signature block sits 90pt from the bottom of the content area.
    const SIG_Y    = PH - MARGIN - 88;
    const FOOTER_Y = PH - MARGIN - 16;

    // ── Header band (slate-900 background) ──────────────────────────────────
    const BAND_H = 72;
    doc.rect(left, MARGIN, PW, BAND_H).fill("#0f172a");

    const logoBuf = decodeLogo(d.CompanyLogo);
    let textX = left + 12;

    if (logoBuf) {
      try {
        doc.roundedRect(left + 10, MARGIN + 10, 52, 52, 5).fill("#ffffff");
        doc.image(logoBuf, left + 12, MARGIN + 12, { width: 48, height: 48, fit: [48, 48] });
        textX = left + 72;
      } catch (_) {}
    }

    const nameW = PW - (textX - left) - 8;
    doc.fillColor("#ffffff").fontSize(13).font("Helvetica-Bold")
      .text(d.CompanyName || "Company", textX, MARGIN + 14, { width: nameW });

    const compAddr = [d.CompanyAddress, d.CompanyCity, d.CompanyState].filter(Boolean).join(", ");
    if (compAddr)
      doc.fontSize(7).font("Helvetica").fillColor("#94a3b8").text(compAddr, textX, MARGIN + 30, { width: nameW });
    const compContact = [d.CompanyPhone, d.CompanyEmail].filter(Boolean).join("  |  ");
    if (compContact)
      doc.fontSize(7).fillColor("#94a3b8").text(compContact, textX, MARGIN + 42, { width: nameW });

    // ── Move cursor below band ───────────────────────────────────────────────
    doc.y = MARGIN + BAND_H + 14;
    doc.fillColor("#0f172a");

    // ── Title ────────────────────────────────────────────────────────────────
    doc.fontSize(12).font("Helvetica-Bold").fillColor("#0f172a").text("ALLOTMENT LETTER", { align: "center" });
    doc.moveDown(0.15);
    doc.fontSize(7.5).font("Helvetica").fillColor("#64748b").text("Allotment of Residential / Commercial Unit", { align: "center" });
    doc.moveDown(0.7);

    // ── Ref + Date ───────────────────────────────────────────────────────────
    const refDate = d.IssuedOn || new Date();
    const savedY = doc.y;
    doc.fontSize(8).font("Helvetica-Bold").fillColor("#0f172a").text(`Ref. No.: ${d.AlNo}`, left, savedY);
    doc.fontSize(8).font("Helvetica-Bold").fillColor("#0f172a").text(`Date: ${fmtDate(refDate)}`, left, savedY, { align: "right" });
    doc.y = savedY + 13;
    doc.moveDown(0.7);

    // ── Addressee ────────────────────────────────────────────────────────────
    doc.fontSize(8).font("Helvetica-Bold").fillColor("#0f172a").text("To,");
    doc.font("Helvetica").text(d.ApplicantName || "-");
    // Cap address at 1 line to save space
    const addrLine = [d.CustomerAddress, d.CustomerCity, d.CustomerState].filter(Boolean).join(", ");
    if (addrLine) doc.text(addrLine, { lineBreak: false });
    if (addrLine) doc.moveDown(0.4);
    if (d.Mobile) doc.text(`Mobile: ${d.Mobile}`);
    doc.moveDown(0.7);

    // ── Subject ──────────────────────────────────────────────────────────────
    doc.font("Helvetica-Bold").text("Subject: ", { continued: true })
      .font("Helvetica").text(`Allotment of Unit ${d.UnitNo || "-"} in ${d.ProjectFullName || d.ProjectName || "-"}`);
    doc.moveDown(0.3);
    doc.moveTo(left, doc.y).lineTo(left + PW, doc.y).strokeColor("#e2e8f0").lineWidth(0.7).stroke();
    doc.moveDown(0.6);

    // ── Body paragraph ───────────────────────────────────────────────────────
    doc.font("Helvetica").fontSize(8).fillColor("#1e293b")
      .text(
        `Dear ${d.ApplicantName || "Sir/Madam"}, we are pleased to confirm the allotment of the unit specified below in our project ` +
        `${d.ProjectFullName || d.ProjectName || "-"}. This allotment is made in your favour as per the terms of the booking agreement. ` +
        `Kindly acknowledge receipt and retain this letter for your records.`,
        { align: "justify" }
      );
    doc.moveDown(0.8);

    // ── Allotment details table ───────────────────────────────────────────────
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#0f172a").text("ALLOTMENT DETAILS");
    doc.moveDown(0.35);

    const detailRows = [
      ["Booking No.",      d.BookingNo      || "-"],
      ["Application No.",  d.ApplicationNo  || "-"],
      ["Project Name",     d.ProjectFullName || d.ProjectName || "-"],
      ["Unit No.",         d.UnitNo         || "-"],
      d.BlockName       ? ["Block / Wing",     d.BlockName]                         : null,
      d.AreaSqFt        ? ["Built-up Area",    `${d.AreaSqFt} sq.ft.`]              : null,
      d.RatePerSqFt     ? ["Rate / sq.ft.",    money(d.RatePerSqFt)]                : null,
      ["Booking Date",    fmtDate(d.BookingDate)],
      d.IssuedOn        ? ["Issue Date",       fmtDate(d.IssuedOn)]                  : null,
      d.ProjectRera     ? ["RERA No.",         d.ProjectRera]                       : null,
    ].filter(Boolean);

    const ROW_H = 16;
    const colW = PW / 2;
    let rowY = doc.y;
    detailRows.forEach(([label, value], i) => {
      const bg = i % 2 === 0 ? "#f8fafc" : "#ffffff";
      doc.rect(left, rowY, colW, ROW_H).fill(bg);
      doc.rect(left + colW, rowY, colW, ROW_H).fill(bg);
      doc.fillColor("#64748b").font("Helvetica").fontSize(7.5).text(label, left + 5, rowY + 4.5, { width: colW - 8, lineBreak: false });
      doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(7.5).text(value, left + colW + 5, rowY + 4.5, { width: colW - 8, lineBreak: false });
      rowY += ROW_H;
    });
    doc.y = rowY + 10;

    // ── Financial summary ─────────────────────────────────────────────────────
    const finRows = [
      d.BookingAmount != null ? ["Booking Amount",      money(d.BookingAmount)] : null,
      (d.GrandTotal || d.TotalValue) ? ["Total Consideration", money(d.GrandTotal || d.TotalValue)] : null,
    ].filter(Boolean);

    if (finRows.length) {
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#0f172a").text("FINANCIAL SUMMARY");
      doc.moveDown(0.35);
      rowY = doc.y;
      finRows.forEach(([label, value], i) => {
        const bg = i % 2 === 0 ? "#f0fdf4" : "#ffffff";
        doc.rect(left, rowY, colW, ROW_H).fill(bg);
        doc.rect(left + colW, rowY, colW, ROW_H).fill(bg);
        doc.fillColor("#64748b").font("Helvetica").fontSize(7.5).text(label, left + 5, rowY + 4.5, { width: colW - 8, lineBreak: false });
        doc.fillColor("#166534").font("Helvetica-Bold").fontSize(7.5).text(value, left + colW + 5, rowY + 4.5, { width: colW - 8, lineBreak: false });
        rowY += ROW_H;
      });
      doc.y = rowY + 10;
    }

    // ── Terms & conditions ────────────────────────────────────────────────────
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#0f172a").text("TERMS & CONDITIONS");
    doc.moveDown(0.3);
    [
      "This allotment is subject to the terms of the Agreement to Sell / Sale Agreement executed between the parties.",
      "The allotment may be cancelled upon default in payment or non-compliance with agreed terms.",
      "Possession shall be given on completion of all legal formalities, full payment, and obtaining the Occupancy Certificate.",
    ].forEach((t, i) => {
      doc.font("Helvetica").fontSize(7.5).fillColor("#374151")
        .text(`${i + 1}. ${t}`, left, doc.y, { width: PW, align: "justify" });
      doc.moveDown(0.25);
    });

    // ── Signature block — anchored at SIG_Y (never pushed to page 2) ─────────
    const sigHalf = PW * 0.52;
    doc.fontSize(8).font("Helvetica-Bold").fillColor("#0f172a")
      .text("Acknowledged by:", left, SIG_Y);
    doc.text(`For ${d.CompanyName || "Company"}`, left + PW - sigHalf, SIG_Y);

    const sigLineY = SIG_Y + 36;
    doc.moveTo(left, sigLineY).lineTo(left + sigHalf * 0.72, sigLineY)
      .strokeColor("#0f172a").lineWidth(0.5).stroke();
    doc.moveTo(left + PW - sigHalf, sigLineY).lineTo(left + PW, sigLineY).stroke();

    doc.fontSize(7).font("Helvetica").fillColor("#64748b")
      .text("Customer Signature & Date", left, sigLineY + 4);
    doc.text("Authorised Signatory", left + PW - sigHalf, sigLineY + 4);

    // ── Footer — anchored at FOOTER_Y ────────────────────────────────────────
    const footerText = `${d.AlNo}  ·  ${d.CompanyName || ""}  ·  Generated ${new Date().toLocaleDateString("en-GB")}`;
    doc.fontSize(6.5).fillColor("#94a3b8")
      .text(footerText, left, FOOTER_Y, { width: PW, align: "center" });

    doc.end();
  });
}

async function getAllotmentLetterPdfBuffer(pool, id) {
  const d = await fetchAllotmentLetterData(pool, id);
  if (!d) throw new Error("Allotment letter not found");
  return renderAllotmentLetterPdf(d);
}

async function getAllotmentLetterPdfBufferByBookingId(pool, bookingId) {
  const d = await fetchAllotmentLetterDataByBookingId(pool, bookingId);
  if (!d) throw new Error("Allotment letter not found for this booking");
  return renderAllotmentLetterPdf(d);
}

module.exports = { getAllotmentLetterPdfBuffer, getAllotmentLetterPdfBufferByBookingId };
