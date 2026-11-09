const PDFDocument = require("pdfkit");
const { sql } = require("../db");
const { bookingFundingApplySql } = require("./crmPaymentFunding");
const { money, fmtDate, decodeLogo, drawWatermark } = require("./moneyReceiptPdf");

const CERT_NAME = { OC: "Occupancy Certificate", CC: "Completion Certificate", "OC+CC": "Occupancy and Completion Certificates" };
const rupees = (n) => `Rs. ${money(n)}`;

async function fetchPossessionLetterData(pool, noticeId) {
  const r = await pool.request().input("id", sql.Int, noticeId).query(`
    SELECT n.Id, n.NoticeNo, n.Status, n.OfferedDate, n.ResponseDeadline, n.CreatedAt,
      b.BookingNo, COALESCE(bn.UnitNo, b.UnitNo) AS UnitNo, b.BlockName, COALESCE(bn.ProjectName, b.ProjectName) AS ProjectName,
      a.ApplicantName, a.Mobile, a.Email,
      c.Address AS CustomerAddress, c.City AS CustomerCity, c.State AS CustomerState, c.Pincode AS CustomerPincode,
      comp.name AS CompanyName, comp.address AS CompanyAddress, comp.address_line2 AS CompanyAddress2, comp.city AS CompanyCity,
      comp.state AS CompanyState, comp.pincode AS CompanyPincode, comp.gst_no AS CompanyGst, comp.phone AS CompanyPhone, comp.email AS CompanyEmail, comp.logo AS CompanyLogo,
      proj.name AS ProjectFullName,
      ISNULL(fm.RequiredAmount, 0) AS RequiredAmount, ISNULL(fm.MilestonePaid, 0) + ISNULL(fo.OnAccountAvailable, 0) AS Collected,
      cert.CertType, cert.CertificateNo, cert.ReceivedDate AS CertDate, cert.IssuedBy AS CertAuthority, cert.BlockId AS CertBlockId
    FROM dbo.CrmPossessionNotice n
    JOIN dbo.CrmBooking b ON b.Id = n.BookingId
    JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
    LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
    LEFT JOIN dbo.UnitMaster um ON um.Id = b.UnitId
    LEFT JOIN dbo.CrmCustomer c ON c.Id = a.CustomerId
    LEFT JOIN dbo.enterprise comp ON comp.id = b.CompanyId AND comp.business_type = 'C'
    LEFT JOIN dbo.enterprise proj ON proj.id = b.ProjectId AND proj.business_type = 'P'
    ${bookingFundingApplySql("b")}
    OUTER APPLY (SELECT TOP 1 oc.CertType, oc.CertificateNo, oc.ReceivedDate, oc.IssuedBy, oc.BlockId FROM dbo.CrmOccupancyCertificate oc
      WHERE oc.ProjectId = b.ProjectId AND oc.Status = 'Received' AND (oc.BlockId = um.BlockId OR oc.BlockId IS NULL)
      ORDER BY CASE WHEN oc.BlockId IS NULL THEN 1 ELSE 0 END, oc.ReceivedDate DESC) cert
    WHERE n.Id = @id`);
  return r.recordset[0] || null;
}

// The certificate sentence names only what is on record.
function certificateSentence(d, project) {
  const scope = d.CertBlockId != null && d.BlockName ? `Block ${d.BlockName} of ${project}` : project;
  const name = CERT_NAME[d.CertType] || "Occupancy or Completion Certificate";
  const details = [d.CertificateNo ? `No. ${d.CertificateNo}` : null, d.CertDate ? `dated ${fmtDate(d.CertDate)}` : null].filter(Boolean).join(" ");
  const verb = d.CertType === "OC+CC" ? "have" : "has";
  return `We are pleased to inform you that the ${name} for ${scope}${details ? `, ${details},` : ""} ${verb} been issued by ${d.CertAuthority || "the competent authority"}.`;
}

function renderPossessionLetterBuffer(d) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 54 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    const ink = "#0f172a", soft = "#475569", faint = "#94a3b8", rule = "#cbd5e1";
    const project = d.ProjectFullName || d.ProjectName || "the project";
    const balance = Math.max(0, Math.round((Number(d.RequiredAmount) - Number(d.Collected)) * 100) / 100);
    const name = d.ApplicantName || "Customer";

    if (d.Status === "Draft") drawWatermark(doc, "DRAFT", "#b45309");

    // Letterhead
    const logo = decodeLogo(d.CompanyLogo);
    const top = doc.y;
    let textX = left;
    if (logo) { try { doc.image(logo, left, top, { fit: [48, 48] }); textX = left + 60; } catch { /* text-only letterhead */ } }
    doc.font("Helvetica-Bold").fontSize(14).fillColor(ink).text(d.CompanyName || "Company Name Not Set", textX, top, { width: width - (textX - left) });
    doc.font("Helvetica").fontSize(8).fillColor(soft)
      .text([d.CompanyAddress, d.CompanyAddress2, d.CompanyCity, d.CompanyState, d.CompanyPincode].filter(Boolean).join(", "), textX, undefined, { width: width - (textX - left) })
      .text([d.CompanyGst ? `GSTIN ${d.CompanyGst}` : null, d.CompanyPhone, d.CompanyEmail].filter(Boolean).join("   |   "), textX, undefined, { width: width - (textX - left) });
    doc.y = Math.max(doc.y, top + 50) + 8;
    doc.moveTo(left, doc.y).lineTo(left + width, doc.y).strokeColor(rule).lineWidth(0.75).stroke();
    doc.y += 12;

    // Reference and addressee
    const refY = doc.y;
    doc.font("Helvetica").fontSize(9.5).fillColor(ink).text(`Ref: ${d.NoticeNo}`, left, refY, { width: width / 2 });
    doc.text(`Date: ${fmtDate(d.OfferedDate || d.CreatedAt)}`, left + width / 2, refY, { width: width / 2, align: "right" });
    doc.y = refY + 22;
    doc.font("Helvetica").fontSize(9.5).text("To,", left);
    doc.font("Helvetica-Bold").text(name, left);
    doc.font("Helvetica").fillColor(soft);
    const address = [d.CustomerAddress, d.CustomerCity, d.CustomerState, d.CustomerPincode].filter(Boolean).join(", ");
    if (address) doc.text(address, left, undefined, { width: width * 0.65 });
    const contact = [d.Mobile, d.Email].filter(Boolean).join("   |   ");
    if (contact) doc.text(contact, left);
    doc.moveDown(0.8);

    const unit = [d.BlockName ? `Block ${d.BlockName}` : null, d.UnitNo ? `Unit ${d.UnitNo}` : null].filter(Boolean).join(", ");
    doc.font("Helvetica-Bold").fontSize(10).fillColor(ink).text(`Sub: Offer of Possession of ${unit || "your unit"}, ${project}`, left, undefined, { width });
    doc.moveDown(0.7);
    const para = (t) => { doc.font("Helvetica").fontSize(9.75).fillColor(ink).text(t, left, undefined, { width, align: "justify", lineGap: 1.5 }); doc.moveDown(0.55); };

    para(`Dear ${name},`);
    para(certificateSentence(d, project));
    para(`In accordance with your Agreement for Sale, we hereby offer you possession of the above unit with effect from ${fmtDate(d.OfferedDate)}.`);

    // The booking at a glance
    const rows = [
      ["Booking No.", d.BookingNo], ["Unit", d.UnitNo || "-"],
      ["Total Consideration", rupees(d.RequiredAmount)], ["Amount Received", rupees(d.Collected)],
      ["Balance Payable", rupees(balance)], ["Please Respond By", fmtDate(d.ResponseDeadline)],
    ];
    const boxTop = doc.y + 2, rowH = 19, half = width / 2;
    rows.forEach(([k, v], i) => {
      const x = left + (i % 2) * half, y = boxTop + Math.floor(i / 2) * rowH;
      doc.font("Helvetica").fontSize(8.5).fillColor(soft).text(k, x + 8, y + 5.5, { width: half * 0.5, lineBreak: false });
      doc.font("Helvetica-Bold").fontSize(9).fillColor(ink).text(String(v), x + half * 0.5, y + 5.5, { width: half * 0.5 - 8, align: "right", lineBreak: false });
    });
    const boxH = rowH * Math.ceil(rows.length / 2);
    doc.rect(left, boxTop, width, boxH).strokeColor(rule).lineWidth(0.75).stroke();
    doc.moveTo(left + half, boxTop).lineTo(left + half, boxTop + boxH).stroke();
    for (let i = 1; i < rows.length / 2; i++) doc.moveTo(left, boxTop + i * rowH).lineTo(left + width, boxTop + i * rowH).stroke();
    doc.x = left; doc.y = boxTop + boxH + 12;

    if (balance > 0) para(`Our records show a balance of ${rupees(balance)}. Please clear it before the handover.`);
    para(`Please confirm your acceptance by ${fmtDate(d.ResponseDeadline)}, by signing the acknowledgement below and returning a copy to us or through your customer portal. Any objection may be raised with us by the same date.`);
    if (d.CertType !== "CC") para("Under Section 19(10) of the Real Estate (Regulation and Development) Act, 2016, an allottee is required to take physical possession of the unit within two months of the occupancy certificate being issued.");
    para("At the handover, our team will inspect the unit jointly with you and record any defects for rectification.");

    doc.font("Helvetica").fontSize(9.75).fillColor(ink).text("Yours faithfully,", left);
    doc.font("Helvetica-Bold").text(`For ${d.CompanyName || "the Company"}`, left);
    doc.y += 30;
    doc.font("Helvetica").fontSize(9).fillColor(soft).text("Authorised Signatory", left);
    doc.y += 12;

    // The customer's copy comes back signed
    doc.moveTo(left, doc.y).lineTo(left + width, doc.y).dash(3, { space: 3 }).strokeColor(faint).lineWidth(0.75).stroke().undash();
    doc.y += 9;
    doc.font("Helvetica-Bold").fontSize(9.5).fillColor(ink).text("ACKNOWLEDGEMENT", left, undefined, { width, align: "center" });
    doc.moveDown(0.35);
    doc.font("Helvetica").fontSize(9).fillColor(ink).text(`I/We acknowledge receipt of Notice ${d.NoticeNo} and accept the offer of possession of the above unit.`, left, undefined, { width });
    const sigY = doc.y + 30, cell = width / 3;
    ["Name of Allottee", "Signature", "Date"].forEach((label, i) => {
      doc.moveTo(left + i * cell, sigY).lineTo(left + (i + 1) * cell - 14, sigY).strokeColor(faint).lineWidth(0.5).stroke();
      doc.font("Helvetica").fontSize(8).fillColor(soft).text(label, left + i * cell, sigY + 4, { width: cell - 14, lineBreak: false });
    });
    doc.end();
  });
}

async function getPossessionLetterBuffer(pool, noticeId) {
  const d = await fetchPossessionLetterData(pool, noticeId);
  return d ? { buffer: await renderPossessionLetterBuffer(d), noticeNo: d.NoticeNo } : null;
}

module.exports = { getPossessionLetterBuffer, renderPossessionLetterBuffer, fetchPossessionLetterData };
