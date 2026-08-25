const PDFDocument = require("pdfkit");
const { sql } = require("../db");
const { getHsnRate, UNIT_PARKING_THRESHOLD, AFFORDABLE_HSN_CODE, OTHER_RESIDENTIAL_HSN_CODE, EXTRA_WORK_HSN_CODE } = require("./crmGst");
const { drawFinancialBreakdown } = require("./pdfFinancials");

function money(n) {
  return Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(d) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
function fmtDateTime(d) {
  return new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function decodeLogo(dataUrl) {
  if (!dataUrl || typeof dataUrl !== "string") return null;
  const match = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(dataUrl.trim());
  if (!match) return null;
  try { return Buffer.from(match[2], "base64"); } catch { return null; }
}

// ── Data fetch ────────────────────────────────────────────────────────────────
// Prefers the Booking's own already-computed, already-repriced totals
// (recalculateBookingGst, crmGst.js) once one exists — same numbers Money
// Receipts/Invoices show, so the two documents a customer gets never
// disagree. Before a Booking exists (Draft application, or Pending but the
// auto-create-booking retry hasn't run yet), falls back to a live HSN-rate
// estimate off the Application's own Rate/SqFt and the Application-scoped
// Parking holds / Extra Charges — same 1%/5%/18% bracket rule, just computed
// read-only instead of persisted.
//
// Deliberately never fetches Broker/Channel Partner — this document goes
// straight to the customer, and internal commission/referral arrangements
// are not something they see (per explicit instruction).
async function fetchApplicationFormData(pool, applicationId) {
  const appRes = await pool.request().input("id", sql.Int, applicationId).query(`
    SELECT
      a.Id, a.ApplicationNo, a.ApplicantName, a.Mobile, a.AltMobile, a.Email,
      a.ProjectId, a.PreferredUnitId, a.CompanyId, a.PropertyType, a.BhkPreference,
      a.Source, a.Status, a.Notes, a.RatePerSqFt, a.DateOfApply,
      a.PaymentPlanId, a.TokenType, a.TokenValue, a.BookingAmount, a.PaymentMode, a.DepositBankId,
      a.CreatedAt,
      pp.PlanName AS PaymentPlanName,
      bank.LHeadName AS DepositBankName,
      comp.name AS CompanyName, comp.address AS CompanyAddress, comp.address_line2 AS CompanyAddress2,
      comp.city AS CompanyCity, comp.state AS CompanyState, comp.pincode AS CompanyPincode,
      comp.gst_no AS CompanyGst, comp.pan_no AS CompanyPan, comp.phone AS CompanyPhone, comp.email AS CompanyEmail,
      comp.logo AS CompanyLogo,
      proj.name AS ProjectFullName, proj.rera_no AS ProjectRera,
      proj.address AS ProjectAddress, proj.city AS ProjectCity, proj.state AS ProjectState,
      um.UnitName, um.UnitType, um.AreaSqFt, um.BlockId, blk.BlockName,
      cust.CustomerNo, cust.PanNo AS CustomerPanNo, cust.AadhaarNo AS CustomerAadhaar,
      cust.Address AS CustomerAddress, cust.City AS CustomerCity, cust.State AS CustomerState, cust.Pincode AS CustomerPincode,
      cust.Occupation AS CustomerOccupation,
      bk.Id AS BookingId, bk.BookingNo, bk.BookingDate, bk.TotalValue, bk.ParkingTotal, bk.ExtraChargesTotal,
      bk.GrandTotal, bk.HsnCode, bk.UnitParkingGstRate, bk.UnitGstAmount, bk.ParkingGstAmount,
      bk.UnitParkingGstAmount, bk.ExtraWorkGstAmount, bk.TotalGstAmount, bk.WorkflowStage
    FROM dbo.CrmApplication a
    LEFT JOIN dbo.CrmPaymentPlanTemplate pp ON pp.Id = a.PaymentPlanId
    LEFT JOIN dbo.AccountHeadMaster bank ON bank.LHeadId = a.DepositBankId
    LEFT JOIN dbo.enterprise comp ON comp.id = a.CompanyId AND comp.business_type = 'C'
    LEFT JOIN dbo.enterprise proj ON proj.id = a.ProjectId AND proj.business_type = 'P'
    LEFT JOIN dbo.UnitMaster um ON um.Id = a.PreferredUnitId
    LEFT JOIN dbo.BlockMaster blk ON blk.Id = um.BlockId
    LEFT JOIN dbo.CrmCustomer cust ON cust.Id = a.CustomerId
    LEFT JOIN dbo.CrmBooking bk ON bk.ApplicationId = a.Id AND bk.IsActive = 1
    WHERE a.Id = @id
  `);
  const d = appRes.recordset[0];
  if (!d) return null;

  // Milestone amounts: once a real Booking exists, dbo.CrmPaymentMilestone
  // already holds the correct, final AmountDue per milestone — NOT a plain
  // percentage-of-grand-total (the "Booking" milestone is a fixed token
  // amount, not a % share, so every later milestone's % is actually applied
  // against (GrandTotal - fixed token amount), not the full GrandTotal —
  // recomputing that split here would silently disagree with the real
  // schedule the customer is actually being charged against). Only estimate
  // from the template's raw percentages pre-Booking, when no real schedule
  // exists yet to read.
  const [coAppRes, bankRes, planItemsRes] = await Promise.all([
    pool.request().input("id", sql.Int, applicationId).query(`
      SELECT Name, Relation, Mobile, Email, PanNo, AadhaarNo, DateOfBirth, Gender, Occupation, AnnualIncome,
             Address, City, State, Pincode
      FROM dbo.CrmCoApplicant WHERE ApplicationId = @id AND IsActive = 1 ORDER BY Id
    `),
    pool.request().input("id", sql.Int, applicationId).query(`
      SELECT TOP 1 BankName, BranchName, AccountNo, IfscCode, AccountHolderName,
             NomineeName, NomineeRelation, NomineeContact
      FROM dbo.CrmCustomerBankDetail WHERE ApplicationId = @id ORDER BY Id DESC
    `),
    d.BookingId
      ? pool.request().input("bid", sql.Int, d.BookingId).query(`
          SELECT MilestoneNo, MilestoneName AS Name, [Percent], AmountDue AS Amount
          FROM dbo.CrmPaymentMilestone WHERE BookingId = @bid ORDER BY MilestoneNo
        `)
      : d.PaymentPlanId
      ? pool.request().input("pid", sql.Int, d.PaymentPlanId).query(`
          SELECT i.MilestoneNo, ISNULL(mm.Name, i.MilestoneName) AS Name, i.[Percent], CAST(NULL AS DECIMAL(18,2)) AS Amount
          FROM dbo.CrmPaymentPlanTemplateItem i
          LEFT JOIN dbo.CrmMilestoneMaster mm ON mm.Id = i.MilestoneMasterId
          WHERE i.PlanTemplateId = @pid ORDER BY i.MilestoneNo
        `)
      : Promise.resolve({ recordset: [] }),
  ]);
  d.coApplicants = coAppRes.recordset;
  d.bankDetail = bankRes.recordset[0] || null;
  d.planItems = planItemsRes.recordset;
  d.planItemsAreEstimate = !d.BookingId;

  // Parking + Extra Charges — scoped to the real Booking once one exists
  // (repriced, authoritative), otherwise to the Application-stage rows
  // (holds not yet converted into a real CrmParkingAllotment still show —
  // same "Hold" merge crmParking.js's own GET /application/:id uses).
  if (d.BookingId) {
    const [parkRes, extraRes] = await Promise.all([
      pool.request().input("bid", sql.Int, d.BookingId).query(`
        SELECT p.ParkingType AS Type, pa.ParkingSlotNo, pa.Quantity, pa.RateSnapshot, pa.GstRateSnapshot, pa.GstAmount, pa.TotalAmount
        FROM dbo.CrmParkingAllotment pa
        JOIN dbo.ParkingMaster p ON p.Id = pa.ParkingMasterId
        WHERE pa.BookingId = @bid AND pa.IsActive = 1
      `),
      pool.request().input("bid", sql.Int, d.BookingId).query(`
        SELECT Description, Amount, GstRate, GstAmount, TotalAmount
        FROM dbo.CrmExtraCharge WHERE BookingId = @bid AND IsActive = 1
      `),
    ]);
    d.parking = parkRes.recordset;
    d.extraCharges = extraRes.recordset;
  } else {
    const [parkRes, holdRes, extraRes] = await Promise.all([
      pool.request().input("aid", sql.Int, applicationId).query(`
        SELECT p.ParkingType AS Type, pa.ParkingSlotNo, pa.Quantity, pa.RateSnapshot, pa.GstRateSnapshot, pa.GstAmount, pa.TotalAmount
        FROM dbo.CrmParkingAllotment pa
        JOIN dbo.ParkingMaster p ON p.Id = pa.ParkingMasterId
        WHERE pa.ApplicationId = @aid AND pa.IsActive = 1
      `),
      pool.request().input("aid", sql.Int, applicationId).query(`
        SELECT s.ParkingType AS Type, s.SlotNo AS ParkingSlotNo, h.RateOverride, pm.Charge, pm.GstRate
        FROM dbo.CrmInventoryHold h
        JOIN dbo.ParkingSlot s ON s.Id = h.EntityId
        LEFT JOIN dbo.ParkingMaster pm ON pm.ProjectId = s.ProjectId AND pm.ParkingType = s.ParkingType AND pm.IsActive = 1
          AND (pm.BlockId = s.BlockId OR pm.BlockId IS NULL)
        WHERE h.EntityType = 'Parking' AND h.ApplicationId = @aid AND h.Status = 'Active' AND h.HoldUntil >= SYSDATETIME()
      `),
      pool.request().input("aid", sql.Int, applicationId).query(`
        SELECT Description, Amount, GstRate, GstAmount, TotalAmount
        FROM dbo.CrmExtraCharge WHERE ApplicationId = @aid AND IsActive = 1
      `),
    ]);
    d.parking = parkRes.recordset;
    d.extraCharges = extraRes.recordset;
    for (const h of holdRes.recordset) {
      const rate = h.RateOverride != null ? Number(h.RateOverride) : Number(h.Charge || 0);
      const gstRate = Number(h.GstRate || 0);
      const gstAmount = Math.round(rate * gstRate) / 100;
      d.parking.push({
        Type: h.Type, ParkingSlotNo: h.ParkingSlotNo, Quantity: 1,
        RateSnapshot: rate, GstRateSnapshot: gstRate, GstAmount: gstAmount,
        TotalAmount: rate + gstAmount, IsHeld: true,
      });
    }
  }

  // Pricing — read straight off the Booking when one exists; otherwise a
  // live read-only estimate using the exact same bracket rule
  // recalculateBookingGst persists once a Booking is created.
  if (d.BookingId) {
    d.pricing = {
      unitValue: Number(d.TotalValue || 0),
      unitGst: Number(d.UnitGstAmount || 0),
      parkingBase: Number(d.parking.reduce((s, p) => s + Number(p.RateSnapshot || 0) * Number(p.Quantity || 1), 0)),
      parkingGst: Number(d.ParkingGstAmount || 0),
      extraBase: d.extraCharges.reduce((s, c) => s + Number(c.Amount || 0), 0),
      extraGst: Number(d.ExtraWorkGstAmount || 0),
      grandTotal: Number(d.GrandTotal || 0),
      gstRate: Number(d.UnitParkingGstRate || 0),
      hsnCode: d.HsnCode || null,
    };
  } else {
    const unitValue = d.RatePerSqFt && d.AreaSqFt ? Number(d.RatePerSqFt) * Number(d.AreaSqFt) : 0;
    const parkingBase = d.parking.reduce((s, p) => s + Number(p.RateSnapshot || 0) * Number(p.Quantity || 1), 0);
    const extraBase = d.extraCharges.reduce((s, c) => s + Number(c.Amount || 0), 0);
    const extraGst = d.extraCharges.reduce((s, c) => s + Number(c.GstAmount || 0), 0);
    const unitParkingTotal = unitValue + parkingBase;
    const hsnCode = unitParkingTotal <= UNIT_PARKING_THRESHOLD ? AFFORDABLE_HSN_CODE : OTHER_RESIDENTIAL_HSN_CODE;
    const gstRate = unitValue > 0 || parkingBase > 0 ? await getHsnRate(pool, hsnCode) : 0;
    const unitGst = Math.round(unitValue * gstRate) / 100;
    const parkingGst = Math.round(parkingBase * gstRate) / 100;
    d.pricing = {
      unitValue, unitGst, parkingBase, parkingGst, extraBase, extraGst,
      grandTotal: unitValue + unitGst + parkingBase + parkingGst + extraBase + extraGst,
      gstRate, hsnCode: unitValue > 0 || parkingBase > 0 ? hsnCode : null,
    };
  }

  return d;
}

// ── Design system ────────────────────────────────────────────────────────────
// Deep navy + warm gold — the "premium real-estate certificate" palette this
// document is styled around, applied consistently: navy band + navy table
// headers, gold section chips + gold rule accents, cream tint for the one
// hero figure on the page (Grand Total).
const NAVY       = "#101f38";
const NAVY_SOFT  = "#1e3a5f";
const GOLD       = "#a3690a";
const GOLD_DEEP  = "#7c4a08";
const CREAM      = "#fbf3e6";
const INK        = "#111827";
const MUTED      = "#5b6472";
const FAINT      = "#8b93a1";
const LINE       = "#dfe3ea";
const ROW_TINT   = "#f7f8fa";
const WHITE      = "#ffffff";

function decoFrame(doc) {
  const w = doc.page.width, h = doc.page.height;
  doc.rect(16, 16, w - 32, h - 32).strokeColor(GOLD).lineWidth(1).stroke();
  doc.rect(19.5, 19.5, w - 39, h - 39).strokeColor(GOLD).lineWidth(0.4).stroke();
}

// Full-width navy band across the top of every page — logo (on a white
// rounded chip so it reads on the dark background regardless of the
// logo's own colours), company identity in white, and the document title
// in gold on the right.
function topBand(doc, d, pageWidth, left, pageLabel) {
  const bandH = 62;
  const bandY = 30;
  doc.rect(24, bandY, doc.page.width - 48, bandH).fill(NAVY);

  const logoBuf = decodeLogo(d.CompanyLogo);
  let textX = left + 4;
  if (logoBuf) {
    try {
      doc.roundedRect(left + 4, bandY + 11, 40, 40, 6).fill(WHITE);
      doc.image(logoBuf, left + 8, bandY + 15, { fit: [32, 32] });
      textX = left + 54;
    } catch { /* text-only fallback */ }
  }
  doc.font("Helvetica-Bold").fontSize(13).fillColor(WHITE)
    .text(d.CompanyName || "Company Name Not Set", textX, bandY + 12, { width: pageWidth - (textX - left) - 150 });
  doc.font("Helvetica").fontSize(7.25).fillColor("#c7cedb")
    .text([d.CompanyAddress, d.CompanyAddress2, d.CompanyCity, d.CompanyState, d.CompanyPincode].filter(Boolean).join(", "), textX, bandY + 29, { width: pageWidth - (textX - left) - 150 });
  const gstPan = [d.CompanyGst ? `GSTIN ${d.CompanyGst}` : null, d.CompanyPan ? `PAN ${d.CompanyPan}` : null].filter(Boolean).join("   ·   ");
  if (gstPan) {
    doc.font("Helvetica").fontSize(7.25).fillColor("#c7cedb")
      .text(gstPan, textX, bandY + 41, { width: pageWidth - (textX - left) - 150 });
  }

  doc.font("Helvetica-Bold").fontSize(10.5).fillColor(GOLD).text("APPLICATION FORM", left + pageWidth - 150, bandY + 14, { width: 150, align: "right", characterSpacing: 0.8 });
  doc.font("Helvetica").fontSize(8).fillColor("#c7cedb").text(d.ApplicationNo, left + pageWidth - 150, bandY + 29, { width: 150, align: "right" });
  doc.font("Helvetica").fontSize(7.5).fillColor("#9aa4b6").text(pageLabel, left + pageWidth - 150, bandY + 41, { width: 150, align: "right" });

  doc.fillColor("#000000");
  doc.y = bandY + bandH + 18;
}

// A gold "chip" header + a bordered content card beneath it — content is
// drawn by contentFn(innerLeft, innerWidth) with normal doc.y flow; the
// border is stroked AFTER (drawn last, outline-only so it never covers the
// already-rendered content), around the exact box the content occupied.
function sectionBox(doc, title, left, width, contentFn) {
  const chipH = 20;
  doc.rect(left, doc.y, width, chipH).fill(GOLD);
  doc.font("Helvetica-Bold").fontSize(9).fillColor(WHITE)
    .text(title.toUpperCase(), left + 10, doc.y + 6, { width: width - 20, characterSpacing: 0.8 });
  doc.fillColor("#000000");
  doc.y += chipH;

  const pad = 12;
  const contentTop = doc.y;
  doc.y += pad;
  contentFn(left + pad, width - pad * 2);
  doc.y += pad - 4;
  const contentBottom = doc.y;

  doc.rect(left, contentTop, width, contentBottom - contentTop).strokeColor(LINE).lineWidth(0.75).stroke();
  doc.y = contentBottom + 14;
}

function fieldRow(doc, pairs, left, colW) {
  const rowTop = doc.y;
  let maxH = 0;
  pairs.forEach(([label, value], i) => {
    const x = left + i * colW;
    doc.font("Helvetica-Bold").fontSize(6.75).fillColor(GOLD_DEEP).text(label.toUpperCase(), x, rowTop, { width: colW - 10, characterSpacing: 0.4 });
    const before = doc.y;
    doc.font("Helvetica-Bold").fontSize(9.5).fillColor(INK).text(value || "-", x, rowTop + 10, { width: colW - 10 });
    maxH = Math.max(maxH, doc.y - rowTop);
    doc.y = before;
  });
  doc.fillColor("#000000");
  doc.y = rowTop + Math.max(maxH, 26) + 7;
}

// Fully gridded/bordered table — navy header row (white text), light zebra
// striping, outer border + column dividers. Row heights are measured with
// doc.heightOfString BEFORE anything is drawn, so zebra backgrounds can be
// painted first without covering the text that goes on top of them.
function gridTable(doc, headers, rows, colWidths, left) {
  const norm = headers.map((h) => (typeof h === "string" ? { text: h, align: "left" } : { align: "left", ...h }));
  const totalW = colWidths.reduce((a, b) => a + b, 0);
  const tableTop = doc.y;
  const headerH = 22;

  doc.rect(left, tableTop, totalW, headerH).fill(NAVY);
  let x = left;
  doc.font("Helvetica-Bold").fontSize(7.5).fillColor(WHITE);
  norm.forEach((h, i) => {
    doc.text(h.text.toUpperCase(), x + 7, tableTop + 7, { width: colWidths[i] - 14, align: h.align, characterSpacing: 0.4 });
    x += colWidths[i];
  });
  doc.fillColor("#000000");

  let y = tableTop + headerH;
  const rowHeights = rows.map((row) => {
    doc.font("Helvetica").fontSize(8.5);
    let h = 18;
    row.forEach((cell, i) => {
      h = Math.max(h, doc.heightOfString(String(cell ?? "-"), { width: colWidths[i] - 14 }) + 11);
    });
    return h;
  });

  rows.forEach((row, ri) => {
    const rowH = rowHeights[ri];
    if (ri % 2 === 1) doc.rect(left, y, totalW, rowH).fill(ROW_TINT);
    x = left;
    doc.font("Helvetica").fontSize(8.5).fillColor(INK);
    row.forEach((cell, i) => {
      doc.text(String(cell ?? "-"), x + 7, y + 6, { width: colWidths[i] - 14, align: norm[i].align });
      x += colWidths[i];
    });
    doc.fillColor("#000000");
    y += rowH;
  });

  doc.rect(left, tableTop, totalW, y - tableTop).strokeColor(LINE).lineWidth(0.75).stroke();
  doc.moveTo(left, tableTop + headerH).lineTo(left + totalW, tableTop + headerH).strokeColor(LINE).lineWidth(0.75).stroke();
  x = left;
  colWidths.forEach((w, i) => {
    if (i > 0) doc.moveTo(x, tableTop).lineTo(x, y).strokeColor(LINE).lineWidth(0.5).stroke();
    x += w;
  });

  doc.y = y + 12;
}

function pageFooter(doc, pageWidth, left, pageNo, totalPages) {
  const footerY = doc.page.height - doc.page.margins.bottom - 20;
  doc.moveTo(left, footerY).lineTo(left + pageWidth, footerY).strokeColor(GOLD).lineWidth(0.75).stroke();
  doc.font("Helvetica-Oblique").fontSize(6.75).fillColor(FAINT)
    .text("This is a system-generated Application Form and does not itself constitute a Booking confirmation or Agreement.", left, footerY + 6, { width: pageWidth * 0.68 });
  doc.font("Helvetica-Bold").fontSize(7).fillColor(GOLD_DEEP)
    .text(`Page ${pageNo} of ${totalPages}`, left + pageWidth * 0.68, footerY + 6, { width: pageWidth * 0.32, align: "right" });
  doc.fillColor("#000000");
}

// ── Renderer ─────────────────────────────────────────────────────────────────
function renderApplicationFormPdfBuffer(d) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 42, bufferPages: true });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const left = doc.page.margins.left;
    const p = d.pricing;
    const TOTAL_PAGES = 3;

    // ── PAGE 1 — Cover, Applicant, Unit, Pricing ────────────────────────────
    decoFrame(doc);
    topBand(doc, d, pageWidth, left, `${fmtDate(d.DateOfApply || d.CreatedAt)}  ·  Page 1`);

    doc.font("Helvetica-Bold").fontSize(18).fillColor(NAVY)
      .text("Booking Application Form", left, doc.y, { width: pageWidth, align: "center" });
    doc.moveDown(0.25);
    const statusColor = d.Status === "Approved" ? "#15803d" : d.Status === "Rejected" || d.Status === "Cancelled" ? "#b91c1c" : GOLD_DEEP;
    const statusBadgeText = `${(d.Status || "").toUpperCase()}${d.BookingNo ? `   ·   BOOKING ${d.BookingNo}` : ""}`;
    doc.font("Helvetica-Bold").fontSize(8).fillColor(statusColor)
      .text(statusBadgeText, left, doc.y, { width: pageWidth, align: "center", characterSpacing: 0.6 });
    doc.fillColor("#000000");
    doc.moveDown(1.3);

    sectionBox(doc, "Applicant Details", left, pageWidth, (il, iw) => {
      fieldRow(doc, [
        ["Applicant Name", d.ApplicantName],
        ["Mobile", [d.Mobile, d.AltMobile].filter(Boolean).join(" / ")],
        ["Email", d.Email],
      ], il, iw / 3);
      fieldRow(doc, [
        ["PAN", d.CustomerPanNo],
        ["Aadhaar", d.CustomerAadhaar],
        ["Occupation", d.CustomerOccupation],
      ], il, iw / 3);
      fieldRow(doc, [
        ["Address", [d.CustomerAddress, d.CustomerCity, d.CustomerState, d.CustomerPincode].filter(Boolean).join(", ") || "-"],
      ], il, iw);
    });

    sectionBox(doc, "Project & Unit Details", left, pageWidth, (il, iw) => {
      fieldRow(doc, [
        ["Project", d.ProjectFullName],
        ["Unit", [d.UnitName, d.BlockName].filter(Boolean).join(" / ")],
        ["Unit Type", d.UnitType || d.BhkPreference],
      ], il, iw / 3);
      fieldRow(doc, [
        ["Area", d.AreaSqFt ? `${d.AreaSqFt} sqft` : "-"],
        ["Rate / SqFt", d.RatePerSqFt ? `Rs. ${money(d.RatePerSqFt)}` : "-"],
        ["RERA No.", d.ProjectRera],
      ], il, iw / 3);
    });

    // ── Pricing — the full GST-compliant tax-computation matrix (Unit +
    // Parking + Extra Charges), rendered by the shared breakdown component
    // so it looks identical to the Money Receipt and Tax Invoice.
    const pricingRows = [];
    pricingRows.push({
      label: "Unit / Apartment", hsn: p.hsnCode || "-",
      taxable: p.unitValue, gstAmount: p.unitGst, total: p.unitValue + p.unitGst, ratePct: p.gstRate,
    });
    if (p.parkingBase > 0) {
      pricingRows.push({
        label: "Parking", hsn: p.hsnCode || "-",
        taxable: p.parkingBase, gstAmount: p.parkingGst, total: p.parkingBase + p.parkingGst, ratePct: p.gstRate,
      });
    }
    if (p.extraBase > 0) {
      const extraRate = p.extraBase > 0 ? Math.round((p.extraGst / p.extraBase) * 10000) / 100 : 18;
      pricingRows.push({
        label: "Extra Charges", hsn: EXTRA_WORK_HSN_CODE,
        taxable: p.extraBase, gstAmount: p.extraGst, total: p.extraBase + p.extraGst, ratePct: extraRate,
      });
    }
    drawFinancialBreakdown(doc, pricingRows, {
      left, width: pageWidth, title: "Pricing Summary",
      grandTotal: p.grandTotal, grandTotalLabel: "Grand Total (Incl. GST)",
      note: p.hsnCode
        ? `Unit${p.parkingBase > 0 ? " & Parking" : ""} taxed under HSN ${p.hsnCode} (combined-value GST bracket). GST shown as CGST + SGST as applicable.`
        : "GST shown as CGST + SGST as applicable.",
    });

    sectionBox(doc, "Booking / Token Amount", left, pageWidth, (il, iw) => {
      fieldRow(doc, [
        ["Token Type", d.TokenType],
        ["Amount", d.TokenValue || d.BookingAmount ? `Rs. ${money(d.TokenValue || d.BookingAmount)}` : "-"],
        ["Payment Mode", d.PaymentMode],
      ], il, iw / 3);
      fieldRow(doc, [
        ["Payment Plan", d.PaymentPlanName],
        ["Deposited To", d.DepositBankName],
      ], il, iw / 3);
    });

    pageFooter(doc, pageWidth, left, 1, TOTAL_PAGES);

    // ── PAGE 2 — Co-Applicants + Payment Plan ───────────────────────────────
    doc.addPage();
    decoFrame(doc);
    topBand(doc, d, pageWidth, left, "Page 2");

    sectionBox(doc, "Co-Applicant(s)", left, pageWidth, (il, iw) => {
      if (d.coApplicants.length === 0) {
        doc.font("Helvetica-Oblique").fontSize(8.5).fillColor(MUTED).text("No co-applicants on this application.", il, doc.y);
        doc.fillColor("#000000");
        return;
      }
      d.coApplicants.forEach((c, i) => {
        doc.font("Helvetica-Bold").fontSize(9).fillColor(NAVY)
          .text(`${i + 1}. ${c.Name}${c.Relation ? `  (${c.Relation})` : ""}`, il, doc.y, { width: iw });
        doc.font("Helvetica").fontSize(8).fillColor(MUTED)
          .text([c.Mobile, c.Email].filter(Boolean).join("  ·  ") || "-", il, doc.y + 1, { width: iw })
          .text([c.PanNo ? `PAN ${c.PanNo}` : null, c.AadhaarNo ? `Aadhaar ${c.AadhaarNo}` : null].filter(Boolean).join("  ·  "), il, undefined, { width: iw })
          .text([c.Address, c.City, c.State, c.Pincode].filter(Boolean).join(", "), il, undefined, { width: iw });
        doc.fillColor("#000000");
        if (i < d.coApplicants.length - 1) doc.moveDown(0.7);
      });
    });

    doc.font("Helvetica-Bold").fontSize(9).fillColor(GOLD_DEEP)
      .text("PAYMENT PLAN SCHEDULE", left, doc.y, { characterSpacing: 0.8 });
    doc.y += 14;
    if (d.planItems.length === 0) {
      doc.font("Helvetica-Oblique").fontSize(8.5).fillColor(MUTED).text("No payment plan selected yet.", left, doc.y);
      doc.fillColor("#000000");
    } else {
      if (d.planItemsAreEstimate) {
        doc.font("Helvetica-Oblique").fontSize(7.5).fillColor(MUTED)
          .text("Indicative — a % share of the Grand Total. The confirmed schedule is fixed once the Booking is created (the first milestone is a fixed Token amount, not a % share).", left, doc.y, { width: pageWidth });
        doc.y += 8;
        doc.fillColor("#000000");
      }
      const colW = [pageWidth * 0.1, pageWidth * 0.48, pageWidth * 0.18, pageWidth * 0.24];
      gridTable(
        doc,
        [{ text: "#" }, "Milestone", { text: "%", align: "right" }, { text: "Amount (Rs.)", align: "right" }],
        d.planItems.map((it, i) => [
          i + 1, it.Name, `${Number(it.Percent).toFixed(2)}%`,
          it.Amount != null ? money(it.Amount)
            : p.grandTotal > 0 ? money(Math.round(p.grandTotal * Number(it.Percent)) / 100) : "-",
        ]),
        colW, left
      );
    }

    pageFooter(doc, pageWidth, left, 2, TOTAL_PAGES);

    // ── PAGE 3 — Parking, Extra Charges, Bank/KYC, Declaration ──────────────
    doc.addPage();
    decoFrame(doc);
    topBand(doc, d, pageWidth, left, "Page 3");

    if (d.parking.length > 0) {
      doc.font("Helvetica-Bold").fontSize(9).fillColor(GOLD_DEEP).text("PARKING", left, doc.y, { characterSpacing: 0.8 });
      doc.y += 14;
      const colW = [pageWidth * 0.22, pageWidth * 0.2, pageWidth * 0.12, pageWidth * 0.23, pageWidth * 0.23];
      gridTable(
        doc,
        ["Type", "Slot", "Qty", "Rate (Rs.)", { text: "Total (Rs.)", align: "right" }],
        d.parking.map((pk) => [
          pk.Type + (pk.IsHeld ? " (Held)" : ""), pk.ParkingSlotNo || "-", pk.Quantity, money(pk.RateSnapshot), money(pk.TotalAmount),
        ]),
        colW, left
      );
    }

    if (d.extraCharges.length > 0) {
      doc.font("Helvetica-Bold").fontSize(9).fillColor(GOLD_DEEP).text("EXTRA CHARGES", left, doc.y, { characterSpacing: 0.8 });
      doc.y += 14;
      const colW = [pageWidth * 0.5, pageWidth * 0.2, pageWidth * 0.15, pageWidth * 0.15];
      gridTable(
        doc,
        ["Description", { text: "Amount (Rs.)", align: "right" }, { text: "GST", align: "right" }, { text: "Total (Rs.)", align: "right" }],
        d.extraCharges.map((c) => [c.Description, money(c.Amount), `${c.GstRate}%`, money(c.TotalAmount)]),
        colW, left
      );
    }

    sectionBox(doc, "Bank Details & Nominee", left, pageWidth, (il, iw) => {
      if (!d.bankDetail) {
        doc.font("Helvetica-Oblique").fontSize(8.5).fillColor(MUTED).text("No bank/nominee details captured yet.", il, doc.y);
        doc.fillColor("#000000");
        return;
      }
      fieldRow(doc, [
        ["Bank Name", d.bankDetail.BankName],
        ["Account No.", d.bankDetail.AccountNo],
        ["IFSC", d.bankDetail.IfscCode],
      ], il, iw / 3);
      fieldRow(doc, [
        ["Account Holder", d.bankDetail.AccountHolderName],
        ["Nominee", d.bankDetail.NomineeName],
        ["Nominee Relation / Contact", [d.bankDetail.NomineeRelation, d.bankDetail.NomineeContact].filter(Boolean).join(" · ")],
      ], il, iw / 3);
    });

    // ── Declaration — its own boxed callout, matching the visual weight of
    // the pricing hero rather than plain running text.
    const declTop = doc.y;
    const declText = "I/We hereby declare that the information provided in this Application Form is true and correct to the best of my/our knowledge. " +
      "I/We understand that this Application Form, by itself, does not constitute a confirmed booking or a binding Agreement for Sale — " +
      "the booking is confirmed only on internal verification/approval, and the terms of sale are governed by the formal Agreement executed separately. " +
      "The amount, unit, and pricing details above are as captured at the time this document was generated and are subject to the Payment Plan and Project terms.";
    const declPad = 12;
    doc.font("Helvetica").fontSize(8).fillColor("#4b5563");
    const declH = doc.heightOfString(declText, { width: pageWidth - declPad * 2 }) + declPad * 2;
    doc.roundedRect(left, declTop, pageWidth, declH, 5).fillColor("#fafafa").fill();
    doc.roundedRect(left, declTop, pageWidth, declH, 5).strokeColor(LINE).lineWidth(0.75).stroke();
    doc.fillColor("#4b5563").font("Helvetica-Bold").fontSize(7.5)
      .text("DECLARATION", left + declPad, declTop + declPad - 2, { characterSpacing: 0.6 });
    doc.font("Helvetica").fontSize(8).fillColor("#4b5563")
      .text(declText, left + declPad, declTop + declPad + 10, { width: pageWidth - declPad * 2 });
    doc.fillColor("#000000");
    doc.y = declTop + declH + 24;

    const sigTop = doc.y;
    const sigColW = pageWidth / 2 - 16;
    doc.moveTo(left, sigTop + 28).lineTo(left + sigColW, sigTop + 28).strokeColor(FAINT).lineWidth(0.5).stroke();
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor(NAVY).text("Applicant's Signature", left, sigTop + 32, { width: sigColW });

    const sigColX2 = left + pageWidth - sigColW;
    doc.moveTo(sigColX2, sigTop + 28).lineTo(sigColX2 + sigColW, sigTop + 28).strokeColor(FAINT).lineWidth(0.5).stroke();
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor(NAVY).text(`For ${d.CompanyName || "the Company"}`, sigColX2, sigTop + 32, { width: sigColW });
    doc.font("Helvetica").fontSize(7.5).fillColor(MUTED).text("Authorized Signatory", sigColX2, sigTop + 45, { width: sigColW });
    doc.fillColor("#000000");

    pageFooter(doc, pageWidth, left, 3, TOTAL_PAGES);
    doc.font("Helvetica-Oblique").fontSize(6.5).fillColor(FAINT)
      .text(`Generated ${fmtDateTime(new Date())}`, left, doc.page.height - doc.page.margins.bottom - 8, { width: pageWidth, align: "right" });
    doc.fillColor("#000000");

    doc.end();
  });
}

async function getApplicationFormPdfBuffer(pool, applicationId) {
  const d = await fetchApplicationFormData(pool, applicationId);
  if (!d) throw new Error("Application not found");
  return renderApplicationFormPdfBuffer(d);
}

module.exports = { fetchApplicationFormData, renderApplicationFormPdfBuffer, getApplicationFormPdfBuffer };
