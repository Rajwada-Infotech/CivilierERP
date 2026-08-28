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
    al.Id, al.AlNo, al.BookingId, al.Status, al.DraftedOn, al.IssuedOn, al.Remarks,
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
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const PW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const left = doc.page.margins.left;
    const logoBuf = decodeLogo(d.CompanyLogo);

    // ── Header band ──────────────────────────────────────────────────────────
    const hTop = doc.y;
    doc.rect(left, hTop, PW, 80).fill("#0f172a");

    let tx = left + 14;
    if (logoBuf) {
      try {
        doc.roundedRect(left + 12, hTop + 12, 56, 56, 6).fill("#ffffff");
        doc.image(logoBuf, left + 14, hTop + 14, { width: 52, height: 52, fit: [52, 52] });
        tx = left + 78;
      } catch (_) {}
    }
    const txtW = PW - (tx - left);
    doc.fillColor("#ffffff").fontSize(14).font("Helvetica-Bold")
      .text(d.CompanyName || "Company", tx, hTop + 16, { width: txtW });
    const compAddr = [d.CompanyAddress, d.CompanyAddress2, d.CompanyCity, d.CompanyState, d.CompanyPincode].filter(Boolean).join(", ");
    if (compAddr) doc.fontSize(7.5).font("Helvetica").fillColor("#94a3b8").text(compAddr, tx, hTop + 34, { width: txtW });
    const compContact = [d.CompanyPhone, d.CompanyEmail].filter(Boolean).join("  |  ");
    if (compContact) doc.fontSize(7.5).fillColor("#94a3b8").text(compContact, tx, hTop + 48, { width: txtW });

    doc.y = hTop + 80 + 20;
    doc.fillColor("#0f172a");

    // ── Title ─────────────────────────────────────────────────────────────────
    doc.fontSize(13).font("Helvetica-Bold").fillColor("#0f172a").text("ALLOTMENT LETTER", { align: "center" });
    doc.moveDown(0.25);
    doc.fontSize(8.5).font("Helvetica").fillColor("#64748b").text("Allotment of Residential / Commercial Unit", { align: "center" });
    doc.moveDown(1);

    // ── Ref + Date ────────────────────────────────────────────────────────────
    const refDate = d.IssuedOn || d.DraftedOn || new Date();
    const savedY = doc.y;
    doc.fontSize(8.5).font("Helvetica-Bold").fillColor("#0f172a").text(`Ref. No.: ${d.AlNo}`, left, savedY);
    doc.fontSize(8.5).font("Helvetica-Bold").fillColor("#0f172a").text(`Date: ${fmtDate(refDate)}`, left, savedY, { align: "right" });
    doc.y = savedY + 14;
    doc.moveDown(1);

    // ── Addressee ─────────────────────────────────────────────────────────────
    doc.fontSize(8.5).font("Helvetica-Bold").fillColor("#0f172a").text("To,");
    doc.font("Helvetica").text(d.ApplicantName || "-");
    if (d.CustomerAddress) doc.text(d.CustomerAddress);
    const custLocParts = [d.CustomerCity, d.CustomerState].filter(Boolean).join(", ");
    if (custLocParts) doc.text(custLocParts);
    if (d.Mobile) doc.text(`Mobile: ${d.Mobile}`);
    if (d.Email) doc.text(`Email: ${d.Email}`);
    doc.moveDown(1);

    // ── Subject ───────────────────────────────────────────────────────────────
    doc.font("Helvetica-Bold").text("Subject: ", { continued: true })
      .font("Helvetica").text(`Allotment of Unit ${d.UnitNo || "-"} in ${d.ProjectFullName || d.ProjectName || "-"}`);
    doc.moveDown(0.5);
    doc.moveTo(left, doc.y).lineTo(left + PW, doc.y).strokeColor("#e2e8f0").lineWidth(0.8).stroke();
    doc.moveDown(0.8);

    // ── Body ──────────────────────────────────────────────────────────────────
    doc.font("Helvetica").fontSize(8.5).text(`Dear ${d.ApplicantName || "Sir/Madam"},`);
    doc.moveDown(0.6);
    doc.text(
      `We are pleased to confirm the allotment of the unit specified below in our project ${d.ProjectFullName || d.ProjectName || "-"}. ` +
      `This allotment is made in your favour as per the terms and conditions of the booking agreement executed between the parties. ` +
      `Kindly acknowledge receipt of this letter and retain it for your records.`,
      { align: "justify" }
    );
    doc.moveDown(1.2);

    // ── Allotment details table ───────────────────────────────────────────────
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#0f172a").text("ALLOTMENT DETAILS");
    doc.moveDown(0.5);

    const detailRows = [
      ["Booking No.", d.BookingNo || "-"],
      ["Application No.", d.ApplicationNo || "-"],
      ["Project Name", d.ProjectFullName || d.ProjectName || "-"],
      ["Unit No.", d.UnitNo || "-"],
      d.BlockName ? ["Block / Wing", d.BlockName] : null,
      d.AreaSqFt ? ["Built-up Area", `${d.AreaSqFt} sq.ft.`] : null,
      d.RatePerSqFt ? ["Rate per sq.ft.", money(d.RatePerSqFt)] : null,
      ["Booking Date", fmtDate(d.BookingDate)],
      d.IssuedOn ? ["Issue Date", fmtDate(d.IssuedOn)] : null,
      d.ProjectRera ? ["RERA No.", d.ProjectRera] : null,
    ].filter(Boolean);

    const colW = PW / 2;
    let rowY = doc.y;
    detailRows.forEach(([label, value], i) => {
      const bg = i % 2 === 0 ? "#f8fafc" : "#ffffff";
      doc.rect(left, rowY, colW, 18).fill(bg);
      doc.rect(left + colW, rowY, colW, 18).fill(bg);
      doc.fillColor("#64748b").font("Helvetica").fontSize(8).text(label, left + 6, rowY + 5, { width: colW - 10 });
      doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(8).text(value, left + colW + 6, rowY + 5, { width: colW - 10 });
      rowY += 18;
    });
    doc.y = rowY + 14;

    // ── Financial summary ─────────────────────────────────────────────────────
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#0f172a").text("FINANCIAL SUMMARY");
    doc.moveDown(0.5);
    const finRows = [
      d.BookingAmount != null ? ["Booking Amount", money(d.BookingAmount)] : null,
      (d.GrandTotal != null || d.TotalValue != null) ? ["Total Consideration", money(d.GrandTotal || d.TotalValue)] : null,
    ].filter(Boolean);
    rowY = doc.y;
    finRows.forEach(([label, value], i) => {
      const bg = i % 2 === 0 ? "#f0fdf4" : "#ffffff";
      doc.rect(left, rowY, colW, 18).fill(bg);
      doc.rect(left + colW, rowY, colW, 18).fill(bg);
      doc.fillColor("#64748b").font("Helvetica").fontSize(8).text(label, left + 6, rowY + 5, { width: colW - 10 });
      doc.fillColor("#166534").font("Helvetica-Bold").fontSize(8).text(value, left + colW + 6, rowY + 5, { width: colW - 10 });
      rowY += 18;
    });
    doc.y = rowY + 16;

    // ── Terms ─────────────────────────────────────────────────────────────────
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#0f172a").text("TERMS & CONDITIONS");
    doc.moveDown(0.4);
    [
      "This allotment is subject to the terms and conditions of the Agreement to Sell / Sale Agreement signed between the parties.",
      "The allotment may be cancelled in the event of default in payment or non-compliance with the agreed terms.",
      "Unit dimensions and area are as per the approved project plan and may be subject to minor variations as permissible under law.",
      "Possession of the unit shall be given upon completion of all legal formalities, full payment of the consideration, and obtaining the Occupancy Certificate.",
    ].forEach((t, i) => {
      doc.font("Helvetica").fontSize(8).fillColor("#374151").text(`${i + 1}. ${t}`, left, doc.y, { width: PW, align: "justify" });
      doc.moveDown(0.3);
    });
    doc.moveDown(1.5);

    // ── Signature block ───────────────────────────────────────────────────────
    const sigY = doc.y;
    const sigHalf = PW * 0.55;
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#0f172a").text("Acknowledged by:", left, sigY);
    doc.text(`For ${d.CompanyName || "Company"}`, left + PW - sigHalf, sigY);
    doc.y = sigY + 40;
    doc.moveTo(left, doc.y).lineTo(left + sigHalf * 0.75, doc.y).strokeColor("#0f172a").lineWidth(0.5).stroke();
    doc.moveTo(left + PW - sigHalf, doc.y).lineTo(left + PW, doc.y).stroke();
    doc.moveDown(0.4);
    doc.font("Helvetica").fontSize(7.5).fillColor("#64748b").text("Customer Signature & Date", left);
    doc.text("Authorised Signatory", left + PW - sigHalf, doc.y - doc.currentLineHeight());

    // ── Footer ────────────────────────────────────────────────────────────────
    const footerText = `${d.AlNo}  |  ${d.CompanyName || ""}  |  Generated on ${new Date().toLocaleDateString("en-GB")}`;
    doc.fontSize(7).fillColor("#94a3b8").text(footerText, left, doc.page.height - 38, { width: PW, align: "center" });

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
