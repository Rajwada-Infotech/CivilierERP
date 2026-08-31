const PDFDocument = require("pdfkit");
const { sql } = require("../db");
const {
  getHsnRate,
  UNIT_PARKING_THRESHOLD,
  AFFORDABLE_HSN_CODE,
  OTHER_RESIDENTIAL_HSN_CODE,
  EXTRA_WORK_HSN_CODE,
} = require("./crmGst");

// ── Utilities ─────────────────────────────────────────────────────────────────
function money(n) {
  return Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
function fmtDateTime(d) {
  return new Date(d).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}
function round2(n) { return Math.round(Number(n || 0) * 100) / 100; }
function decodeLogo(dataUrl) {
  if (!dataUrl || typeof dataUrl !== "string") return null;
  const m = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(dataUrl.trim());
  if (!m) return null;
  try { return Buffer.from(m[2], "base64"); } catch { return null; }
}

// ── Design tokens ─────────────────────────────────────────────────────────────
const NAVY     = "#1B3A6B";
const BLUE_ACC = "#2859A8";
const SECT_BG  = "#E8F0FF";
const BORDER   = "#C8D9F0";
const INK      = "#1A1A2E";
const LABEL    = "#5B6F8A";
const MUTED    = "#8093A5";
const ROW_ODD  = "#F3F7FD";
const ROW_TOT  = "#E4EEFA";
const WHITE    = "#FFFFFF";

// ── Data fetch ────────────────────────────────────────────────────────────────
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
      comp.gst_no AS CompanyGst, comp.pan_no AS CompanyPan, comp.phone AS CompanyPhone,
      comp.logo AS CompanyLogo,
      proj.name AS ProjectFullName, proj.rera_no AS ProjectRera,
      proj.address AS ProjectAddress, proj.city AS ProjectCity, proj.state AS ProjectState,
      um.UnitName, um.UnitType, um.AreaSqFt, um.BlockId, blk.BlockName,
      cust.CustomerNo, cust.PanNo AS CustomerPanNo, cust.AadhaarNo AS CustomerAadhaar,
      cust.Address AS CustomerAddress, cust.City AS CustomerCity, cust.State AS CustomerState,
      cust.Pincode AS CustomerPincode, cust.Occupation AS CustomerOccupation,
      bk.Id AS BookingId, bk.BookingNo, bk.BookingDate, bk.TotalValue, bk.ParkingTotal,
      bk.ExtraChargesTotal, bk.GrandTotal, bk.HsnCode, bk.UnitParkingGstRate,
      bk.UnitGstAmount, bk.ParkingGstAmount, bk.UnitParkingGstAmount,
      bk.ExtraWorkGstAmount, bk.TotalGstAmount, bk.WorkflowStage
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

  const [coAppRes, bankRes, planItemsRes] = await Promise.all([
    pool.request().input("id", sql.Int, applicationId).query(`
      SELECT Name, Relation, Mobile, Email, PanNo, AadhaarNo, DateOfBirth, Occupation,
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
          SELECT i.MilestoneNo, ISNULL(mm.Name, i.MilestoneName) AS Name, i.[Percent],
                 CAST(NULL AS DECIMAL(18,2)) AS Amount
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

  if (d.BookingId) {
    const [parkRes, extraRes] = await Promise.all([
      pool.request().input("bid", sql.Int, d.BookingId).query(`
        SELECT COALESCE(p.ParkingType, s.ParkingType) AS Type, pa.ParkingSlotNo, pa.Quantity,
               pa.RateSnapshot, pa.GstRateSnapshot, pa.GstAmount, pa.TotalAmount
        FROM dbo.CrmParkingAllotment pa
        LEFT JOIN dbo.ParkingMaster p ON p.Id = pa.ParkingMasterId
        LEFT JOIN dbo.ParkingSlot s ON s.Id = pa.ParkingSlotId
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
        SELECT COALESCE(p.ParkingType, s.ParkingType) AS Type, pa.ParkingSlotNo, pa.Quantity,
               pa.RateSnapshot, pa.GstRateSnapshot, pa.GstAmount, pa.TotalAmount
        FROM dbo.CrmParkingAllotment pa
        LEFT JOIN dbo.ParkingMaster p ON p.Id = pa.ParkingMasterId
        LEFT JOIN dbo.ParkingSlot s ON s.Id = pa.ParkingSlotId
        WHERE pa.ApplicationId = @aid AND pa.IsActive = 1
      `),
      pool.request().input("aid", sql.Int, applicationId).query(`
        SELECT s.ParkingType AS Type, s.SlotNo AS ParkingSlotNo, h.RateOverride, pm.Charge, pm.GstRate
        FROM dbo.CrmInventoryHold h
        JOIN dbo.ParkingSlot s ON s.Id = h.EntityId
        LEFT JOIN dbo.ParkingMaster pm
          ON pm.ProjectId = s.ProjectId AND pm.ParkingType = s.ParkingType AND pm.IsActive = 1
          AND (pm.BlockId = s.BlockId OR pm.BlockId IS NULL)
        WHERE h.EntityType = 'Parking' AND h.ApplicationId = @aid
          AND h.Status = 'Active' AND h.HoldUntil >= SYSDATETIME()
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
        TotalAmount: rate + gstAmount, _isHeld: true,
      });
    }
  }

  if (d.BookingId) {
    d.pricing = {
      unitValue: Number(d.TotalValue || 0),
      unitGst: Number(d.UnitGstAmount || 0),
      parkingBase: d.parking.reduce((s, p) => s + Number(p.RateSnapshot || 0) * Number(p.Quantity || 1), 0),
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
    const upTotal = unitValue + parkingBase;
    const hsnCode = upTotal <= UNIT_PARKING_THRESHOLD ? AFFORDABLE_HSN_CODE : OTHER_RESIDENTIAL_HSN_CODE;
    const gstRate = upTotal > 0 ? await getHsnRate(pool, hsnCode) : 0;
    const unitGst = round2(unitValue * gstRate / 100);
    const parkingGst = round2(parkingBase * gstRate / 100);
    d.pricing = {
      unitValue, unitGst, parkingBase, parkingGst, extraBase, extraGst,
      grandTotal: unitValue + unitGst + parkingBase + parkingGst + extraBase + extraGst,
      gstRate, hsnCode: upTotal > 0 ? hsnCode : null,
    };
  }
  return d;
}

// ── Drawing helpers ───────────────────────────────────────────────────────────
// RULE: every helper that calls doc.text() with explicit (x,y) coords
//       saves doc.y before it starts and sets doc.y = absolutePosition at
//       the end.  Never use `doc.y += n` after an explicit-coord text call.

function pageHeader(doc, d, W, L, pageLabel) {
  const BAND_H = 66;
  const bandY = doc.page.margins.top - 18; // slightly above top margin

  // Navy band (full bleed)
  doc.rect(0, bandY, doc.page.width, BAND_H).fill(NAVY);

  // Logo
  const logoBuf = decodeLogo(d.CompanyLogo);
  let textX = L;
  if (logoBuf) {
    try {
      doc.roundedRect(L, bandY + 11, 42, 42, 5).fill(WHITE);
      doc.image(logoBuf, L + 4, bandY + 15, { fit: [34, 34] });
      textX = L + 52;
    } catch { /* ignore */ }
  }

  // Company info (explicit coords, no auto-flow advance needed)
  const infoW = W - (textX - L) - 160;
  doc.font("Helvetica-Bold").fontSize(12.5).fillColor(WHITE)
    .text(d.CompanyName || "Company", textX, bandY + 10, { width: infoW, lineBreak: false });
  const addr = [d.CompanyAddress, d.CompanyAddress2, d.CompanyCity, d.CompanyState, d.CompanyPincode]
    .filter(Boolean).join(", ");
  doc.font("Helvetica").fontSize(6.5).fillColor("#A8BFDF")
    .text(addr, textX, bandY + 26, { width: infoW, lineBreak: false });
  const gstpan = [d.CompanyGst ? `GSTIN: ${d.CompanyGst}` : null, d.CompanyPan ? `PAN: ${d.CompanyPan}` : null]
    .filter(Boolean).join("   ·   ");
  if (gstpan) {
    doc.font("Helvetica").fontSize(6.5).fillColor("#A8BFDF")
      .text(gstpan, textX, bandY + 38, { width: infoW, lineBreak: false });
  }

  // Right column — document identity
  const rX = L + W - 155;
  doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#93BBFF")
    .text("APPLICATION FORM", rX, bandY + 10, { width: 155, align: "right", characterSpacing: 0.6 });
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(WHITE)
    .text(d.ApplicationNo, rX, bandY + 26, { width: 155, align: "right" });
  doc.font("Helvetica").fontSize(6.5).fillColor("#A8BFDF")
    .text(pageLabel, rX, bandY + 40, { width: 155, align: "right" });

  doc.fillColor(INK);
  // Set doc.y to below the band — explicitly, not +=
  doc.y = bandY + BAND_H + 14;
}

// Section header strip with left accent tab
function sectionHead(doc, title, L, W) {
  const STRIP_H = 18;
  const startY = doc.y;  // ← save before any drawing
  doc.rect(L, startY, W, STRIP_H).fill(SECT_BG);
  doc.rect(L, startY, 3.5, STRIP_H).fill(BLUE_ACC);
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(NAVY)
    .text(title.toUpperCase(), L + 12, startY + 5, { width: W - 20, characterSpacing: 0.5, lineBreak: false });
  doc.fillColor(INK);
  doc.y = startY + STRIP_H;  // ← set absolutely, never +=
}

// Multi-column field display
// pairs: [[label, value], ...]  |  colW: width of each column
function fieldRow(doc, pairs, L, colW) {
  const PAD_TOP = 7;
  const GAP     = 9;   // gap between label baseline and value top
  const PAD_BOT = 8;

  const startY = doc.y + PAD_TOP;

  // Render each column at explicit coords
  let maxBottom = startY;
  pairs.forEach(([label, value], i) => {
    const x = L + i * colW;
    const lbl = (label || "").toUpperCase();
    const val = value || "—";

    doc.font("Helvetica").fontSize(6.5).fillColor(LABEL)
      .text(lbl, x, startY, { width: colW - 10, characterSpacing: 0.3, lineBreak: false });

    // Value below the label — measure label height first to place correctly
    const lblH = doc.heightOfString(lbl, { width: colW - 10, fontSize: 6.5 });
    const valY = startY + Math.max(lblH, 9) + 2;
    doc.font("Helvetica-Bold").fontSize(9).fillColor(INK)
      .text(val, x, valY, { width: colW - 10 });

    const valH = doc.heightOfString(val, { width: colW - 10, fontSize: 9 });
    const colBottom = valY + valH;
    if (colBottom > maxBottom) maxBottom = colBottom;
  });

  const endY = maxBottom + PAD_BOT;

  // Thin separator
  doc.moveTo(L, endY).lineTo(L + colW * pairs.length, endY)
    .strokeColor(BORDER).lineWidth(0.4).stroke();

  doc.fillColor(INK);
  doc.y = endY + 4;  // ← set absolutely
}

// Bordered data table
// headers: string[] or {text, align}[]
// rows: string[][]
function dataTable(doc, headers, rows, colWidths, L) {
  if (!rows.length) return;
  const HDR_H   = 22;
  const MIN_ROW = 18;
  const totalW  = colWidths.reduce((a, b) => a + b, 0);
  const startY  = doc.y;

  const norm = headers.map((h) => (typeof h === "string" ? { text: h, align: "left" } : { align: "left", ...h }));

  // Header band
  doc.rect(L, startY, totalW, HDR_H).fill(NAVY);
  let x = L;
  norm.forEach((h, i) => {
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor(WHITE)
      .text(h.text.toUpperCase(), x + 6, startY + 7,
        { width: colWidths[i] - 12, align: h.align, characterSpacing: 0.3, lineBreak: false });
    x += colWidths[i];
  });

  // Pre-measure row heights
  const rowHeights = rows.map((row) => {
    let h = MIN_ROW;
    row.forEach((cell, i) => {
      const lh = doc.heightOfString(String(cell ?? "—"),
        { width: colWidths[i] - 12, fontSize: 8.5 }) + MIN_ROW / 2;
      if (lh > h) h = lh;
    });
    return h;
  });

  // Data rows
  let y = startY + HDR_H;
  rows.forEach((row, ri) => {
    const rh = rowHeights[ri];
    if (ri % 2 === 0) doc.rect(L, y, totalW, rh).fill(ROW_ODD);
    x = L;
    row.forEach((cell, ci) => {
      doc.font("Helvetica").fontSize(8.5).fillColor(INK)
        .text(String(cell ?? "—"), x + 6, y + 5,
          { width: colWidths[ci] - 12, align: norm[ci].align, lineBreak: false });
      x += colWidths[ci];
    });
    y += rh;
  });

  // Borders
  doc.rect(L, startY, totalW, y - startY).strokeColor(BORDER).lineWidth(0.5).stroke();
  doc.moveTo(L, startY + HDR_H).lineTo(L + totalW, startY + HDR_H).strokeColor(BORDER).lineWidth(0.5).stroke();
  x = L;
  colWidths.forEach((w, i) => {
    if (i > 0) doc.moveTo(x, startY).lineTo(x, y).strokeColor(BORDER).lineWidth(0.4).stroke();
    x += w;
  });

  doc.fillColor(INK);
  doc.y = y + 10;  // ← set absolutely
}

// 7-column GST pricing table
function pricingTable(doc, rows, grandTotal, L, W, hsnNote) {
  sectionHead(doc, "3.  Financial Summary", L, W);
  doc.y += 4;

  // Column widths must sum to W
  const cw = [W * 0.235, W * 0.10, W * 0.155, W * 0.085, W * 0.13, W * 0.13, W * 0.165];
  const aligns = ["left", "center", "right", "center", "right", "right", "right"];
  const hdrs = ["Particulars", "HSN / SAC", "Taxable Value", "GST %", "CGST (₹)", "SGST (₹)", "Amount (₹)"];
  const totalW = cw.reduce((a, b) => a + b, 0);
  const HDR_H  = 24;
  const ROW_H  = 22;
  const GT_H   = 32;

  const tableY = doc.y;

  // Header
  doc.rect(L, tableY, totalW, HDR_H).fill(NAVY);
  let x = L;
  hdrs.forEach((h, i) => {
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor(WHITE)
      .text(h.toUpperCase(), x + 5, tableY + 8,
        { width: cw[i] - 10, align: aligns[i], characterSpacing: 0.25, lineBreak: false });
    x += cw[i];
  });

  // Data rows + running totals
  let y = tableY + HDR_H;
  let sumTaxable = 0, sumCgst = 0, sumSgst = 0, sumTotal = 0;

  rows.forEach((r, ri) => {
    const taxable = Number(r.taxable || 0);
    const gstAmt  = Number(r.gstAmount || 0);
    const cgst    = round2(gstAmt / 2);
    const sgst    = round2(gstAmt - cgst);
    const total   = r.total != null ? Number(r.total) : round2(taxable + gstAmt);
    sumTaxable += taxable; sumCgst += cgst; sumSgst += sgst; sumTotal += total;

    if (ri % 2 === 0) doc.rect(L, y, totalW, ROW_H).fill(ROW_ODD);

    const rate = r.ratePct != null && Number(r.ratePct) > 0 ? `${Number(r.ratePct)}%` : "—";
    const cells = [r.label, r.hsn || "—", money(taxable), rate, money(cgst), money(sgst), money(total)];
    x = L;
    cells.forEach((cell, ci) => {
      doc.font(ci === 0 ? "Helvetica-Bold" : "Helvetica").fontSize(8.5).fillColor(INK)
        .text(String(cell), x + 5, y + 6,
          { width: cw[ci] - 10, align: aligns[ci], lineBreak: false });
      x += cw[ci];
    });
    y += ROW_H;
  });

  // Subtotals row (only when multiple lines)
  if (rows.length > 1) {
    doc.rect(L, y, totalW, ROW_H).fill(ROW_TOT);
    doc.moveTo(L, y).lineTo(L + totalW, y).strokeColor(BORDER).lineWidth(0.5).stroke();
    const tCells = ["Sub-Total", "", money(sumTaxable), "", money(sumCgst), money(sumSgst), money(sumTotal)];
    x = L;
    tCells.forEach((cell, ci) => {
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor(NAVY)
        .text(String(cell), x + 5, y + 6,
          { width: cw[ci] - 10, align: aligns[ci], lineBreak: false });
      x += cw[ci];
    });
    y += ROW_H;
  }

  // Grid lines
  doc.rect(L, tableY, totalW, y - tableY).strokeColor(BORDER).lineWidth(0.5).stroke();
  doc.moveTo(L, tableY + HDR_H).lineTo(L + totalW, tableY + HDR_H).strokeColor(BORDER).lineWidth(0.5).stroke();
  x = L;
  cw.forEach((w, i) => {
    if (i > 0) doc.moveTo(x, tableY).lineTo(x, y).strokeColor(BORDER).lineWidth(0.4).stroke();
    x += w;
  });

  // Grand total bar
  doc.rect(L, y, totalW, GT_H).fill(NAVY);
  doc.rect(L, y, 4, GT_H).fill(BLUE_ACC);
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#93BBFF")
    .text("GRAND TOTAL (INCL. GST)", L + 14, y + 11,
      { width: totalW * 0.55, characterSpacing: 0.5, lineBreak: false });
  doc.font("Helvetica-Bold").fontSize(14).fillColor(WHITE)
    .text(`Rs. ${money(grandTotal != null ? grandTotal : sumTotal)}`, L, y + 8,
      { width: totalW - 10, align: "right", lineBreak: false });
  y += GT_H;

  doc.fillColor(INK);
  doc.y = y + 8;  // ← set absolutely

  if (hsnNote) {
    const noteY = doc.y;
    doc.font("Helvetica-Oblique").fontSize(6.75).fillColor(MUTED)
      .text(hsnNote, L, noteY, { width: W });
    const noteH = doc.heightOfString(hsnNote, { width: W, fontSize: 6.75 });
    doc.fillColor(INK);
    doc.y = noteY + noteH + 8;  // ← set absolutely
  }
}

// Page footer
function pageFooter(doc, W, L, pageNo, totalPages, appNo) {
  const fy = doc.page.height - doc.page.margins.bottom - 22;
  doc.moveTo(L, fy).lineTo(L + W, fy).strokeColor(BLUE_ACC).lineWidth(0.5).stroke();
  doc.font("Helvetica-Oblique").fontSize(6.5).fillColor(MUTED)
    .text(
      "System-generated Application Form. Does not constitute a confirmed booking or Agreement for Sale.",
      L, fy + 6, { width: W * 0.66, lineBreak: false }
    );
  doc.font("Helvetica-Bold").fontSize(7).fillColor(NAVY)
    .text(`Page ${pageNo} of ${totalPages}`, L + W * 0.66, fy + 6,
      { width: W * 0.34, align: "right", lineBreak: false });
  doc.font("Helvetica").fontSize(6).fillColor(MUTED)
    .text(`${appNo}  ·  Generated ${fmtDateTime(new Date())}`, L, fy + 15,
      { width: W, align: "right", lineBreak: false });
  doc.fillColor(INK);
}

// ── Renderer ──────────────────────────────────────────────────────────────────
function renderApplicationFormPdfBuffer(d) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 40 });
      const chunks = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("end",  () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const L = doc.page.margins.left;
      const W = doc.page.width - L * 2;
      const p = d.pricing;
      const TOTAL = 3;

      // ── PAGE 1 ─── Applicant · Unit · Pricing · Token ──────────────────────
      pageHeader(doc, d, W, L, `Date: ${fmtDate(d.DateOfApply || d.CreatedAt)}   ·   Page 1 of ${TOTAL}`);

      // Form title
      {
        const titleY = doc.y;
        doc.font("Helvetica-Bold").fontSize(17).fillColor(NAVY)
          .text("BOOKING APPLICATION FORM", L, titleY, { width: W, align: "center", lineBreak: false });
        doc.y = titleY + 24;
      }

      // Status / booking badge
      {
        const statusText = (d.Status || "Draft").toUpperCase();
        const statusBg = { Approved: "#DCFCE7", Rejected: "#FEE2E2", Cancelled: "#FEE2E2" }[d.Status] || "#FEF3C7";
        const statusFg = { Approved: "#166534", Rejected: "#991B1B", Cancelled: "#991B1B" }[d.Status] || "#92400E";
        const badge = [statusText, d.BookingNo ? `BOOKING NO: ${d.BookingNo}` : null].filter(Boolean).join("   ·   ");
        const badgeW = Math.min(doc.widthOfString(badge, { font: "Helvetica-Bold", fontSize: 7.5 }) + 28, W);
        const badgeX = L + (W - badgeW) / 2;
        const badgeY = doc.y;
        doc.roundedRect(badgeX, badgeY, badgeW, 16, 4).fill(statusBg);
        doc.font("Helvetica-Bold").fontSize(7.5).fillColor(statusFg)
          .text(badge, badgeX + 14, badgeY + 4, { width: badgeW - 28, characterSpacing: 0.4, lineBreak: false });
        doc.fillColor(INK);
        doc.y = badgeY + 24;  // ← set absolutely
      }

      // 1. APPLICANT DETAILS
      sectionHead(doc, "1.  Applicant Details", L, W);
      doc.y += 4;
      fieldRow(doc, [
        ["Full Name of Applicant", d.ApplicantName],
        ["Mobile No.", d.Mobile || "—"],
        ["Alternate Mobile", d.AltMobile || "—"],
      ], L, W / 3);
      fieldRow(doc, [
        ["Email Address", d.Email || "—"],
        ["PAN No.", d.CustomerPanNo || "—"],
        ["Aadhaar No.", d.CustomerAadhaar || "—"],
      ], L, W / 3);
      fieldRow(doc, [
        ["Occupation", d.CustomerOccupation || "—"],
        ["Correspondence Address", [d.CustomerAddress, d.CustomerCity, d.CustomerState, d.CustomerPincode].filter(Boolean).join(", ") || "—"],
      ], L, W / 2);
      doc.y += 6;

      // 2. PROJECT & UNIT DETAILS
      sectionHead(doc, "2.  Project & Unit Details", L, W);
      doc.y += 4;
      fieldRow(doc, [
        ["Project Name", d.ProjectFullName || "—"],
        ["RERA Registration No.", d.ProjectRera || "Applied / Not Applicable"],
        ["Project Location", [d.ProjectAddress, d.ProjectCity, d.ProjectState].filter(Boolean).join(", ") || "—"],
      ], L, W / 3);
      fieldRow(doc, [
        ["Unit / Flat No.", d.UnitName || "—"],
        ["Block / Tower", d.BlockName || "—"],
        ["Unit Type / Configuration", d.UnitType || d.BhkPreference || "—"],
      ], L, W / 3);
      fieldRow(doc, [
        ["Area (Super Built-Up)", d.AreaSqFt ? `${Number(d.AreaSqFt).toLocaleString("en-IN")} sq. ft.` : "—"],
        ["Rate per Sq. Ft.", d.RatePerSqFt ? `Rs. ${money(d.RatePerSqFt)}` : "—"],
        ["Property Type", d.PropertyType || "—"],
      ], L, W / 3);
      // Parking — informational only (pricing is in section 3)
      if (d.parking.length > 0) {
        const pkSummary = d.parking.map((pk) => {
          const slot = pk.ParkingSlotNo ? ` (Slot: ${pk.ParkingSlotNo})` : "";
          const qty  = Number(pk.Quantity || 1) > 1 ? ` × ${pk.Quantity}` : "";
          return `${pk.Type}${qty}${slot}`;
        }).join("   |   ");
        fieldRow(doc, [["Parking Allotment", pkSummary]], L, W);
      }
      doc.y += 6;

      // 3. FINANCIAL SUMMARY
      const pricingRows = [];
      pricingRows.push({
        label: "Unit / Apartment", hsn: p.hsnCode || "—",
        taxable: p.unitValue, gstAmount: p.unitGst,
        total: p.unitValue + p.unitGst, ratePct: p.gstRate,
      });
      if (p.parkingBase > 0) {
        pricingRows.push({
          label: "Parking", hsn: p.hsnCode || "—",
          taxable: p.parkingBase, gstAmount: p.parkingGst,
          total: p.parkingBase + p.parkingGst, ratePct: p.gstRate,
        });
      }
      if (p.extraBase > 0) {
        const extRate = p.extraBase > 0 ? round2((p.extraGst / p.extraBase) * 100) : 18;
        pricingRows.push({
          label: "Extra / Additional Charges", hsn: EXTRA_WORK_HSN_CODE,
          taxable: p.extraBase, gstAmount: p.extraGst,
          total: p.extraBase + p.extraGst, ratePct: extRate,
        });
      }
      const hsnNote = p.hsnCode
        ? `HSN ${p.hsnCode} applies to Unit${p.parkingBase > 0 ? " & Parking" : ""}. GST split equally as CGST + SGST. Subject to revision per applicable law.`
        : "GST split equally as CGST + SGST. Subject to revision per applicable law.";
      pricingTable(doc, pricingRows, p.grandTotal, L, W, hsnNote);

      // 4. BOOKING / TOKEN AMOUNT
      sectionHead(doc, "4.  Booking / Token Amount", L, W);
      doc.y += 4;
      fieldRow(doc, [
        ["Token Type", d.TokenType || "—"],
        ["Token / Booking Amount", d.TokenValue || d.BookingAmount ? `Rs. ${money(d.TokenValue || d.BookingAmount)}` : "—"],
        ["Mode of Payment", d.PaymentMode || "—"],
      ], L, W / 3);
      fieldRow(doc, [
        ["Payment Plan", d.PaymentPlanName || "—"],
        ["Amount Deposited To", d.DepositBankName || "—"],
        ["Application Date", fmtDate(d.DateOfApply || d.CreatedAt)],
      ], L, W / 3);

      pageFooter(doc, W, L, 1, TOTAL, d.ApplicationNo);

      // ── PAGE 2 ─── Co-Applicants · Payment Plan ────────────────────────────
      doc.addPage();
      pageHeader(doc, d, W, L, `Page 2 of ${TOTAL}`);

      // 5. CO-APPLICANT DETAILS
      sectionHead(doc, "5.  Co-Applicant Details", L, W);
      if (d.coApplicants.length === 0) {
        const naY = doc.y + 6;
        doc.font("Helvetica-Oblique").fontSize(8.5).fillColor(MUTED)
          .text("No co-applicants on this application.", L + 12, naY, { lineBreak: false });
        doc.fillColor(INK);
        doc.y = naY + 22;
      } else {
        d.coApplicants.forEach((c, i) => {
          doc.y += 5;
          {
            const hY = doc.y;
            doc.font("Helvetica-Bold").fontSize(9).fillColor(NAVY)
              .text(`Co-Applicant ${i + 1}  —  ${c.Name}${c.Relation ? `  (${c.Relation})` : ""}`,
                L + 12, hY, { width: W - 20, lineBreak: false });
            doc.fillColor(INK);
            doc.y = hY + 16;
          }
          fieldRow(doc, [
            ["Mobile", c.Mobile || "—"],
            ["Email", c.Email || "—"],
            ["Date of Birth", c.DateOfBirth ? fmtDate(c.DateOfBirth) : "—"],
          ], L, W / 3);
          fieldRow(doc, [
            ["PAN No.", c.PanNo || "—"],
            ["Aadhaar No.", c.AadhaarNo || "—"],
            ["Occupation", c.Occupation || "—"],
          ], L, W / 3);
          fieldRow(doc, [
            ["Address", [c.Address, c.City, c.State, c.Pincode].filter(Boolean).join(", ") || "—"],
          ], L, W);
          if (i < d.coApplicants.length - 1) {
            const divY = doc.y;
            doc.moveTo(L, divY).lineTo(L + W, divY)
              .strokeColor(BORDER).lineWidth(0.5).dash(4, { space: 3 }).stroke();
            doc.undash();
            doc.y = divY + 8;
          }
        });
        doc.y += 4;
      }

      // 6. PAYMENT PLAN SCHEDULE
      sectionHead(doc, "6.  Payment Plan Schedule", L, W);
      doc.y += 6;
      if (d.planItems.length === 0) {
        const naY = doc.y;
        doc.font("Helvetica-Oblique").fontSize(8.5).fillColor(MUTED)
          .text("No payment plan selected.", L + 12, naY, { lineBreak: false });
        doc.fillColor(INK);
        doc.y = naY + 22;
      } else {
        if (d.planItemsAreEstimate) {
          const noteY = doc.y;
          doc.font("Helvetica-Oblique").fontSize(7.5).fillColor(MUTED)
            .text(
              "Indicative only — amounts shown are the Grand Total prorated by the plan's percentage. " +
              "The confirmed schedule is set at Booking, where the first milestone is a fixed token amount.",
              L, noteY, { width: W }
            );
          const noteH = doc.heightOfString(
            "Indicative only — amounts shown are the Grand Total prorated by the plan's percentage. " +
            "The confirmed schedule is set at Booking, where the first milestone is a fixed token amount.",
            { width: W, fontSize: 7.5 }
          );
          doc.fillColor(INK);
          doc.y = noteY + noteH + 10;
        }
        dataTable(
          doc,
          [{ text: "S.No.", align: "center" }, "Milestone", { text: "Percentage", align: "right" }, { text: "Amount (Rs.)", align: "right" }],
          d.planItems.map((it, i) => [
            String(i + 1),
            it.Name || `Milestone ${i + 1}`,
            `${Number(it.Percent || 0).toFixed(2)} %`,
            it.Amount != null
              ? money(it.Amount)
              : p.grandTotal > 0 ? money(Math.round(p.grandTotal * Number(it.Percent)) / 100) : "—",
          ]),
          [W * 0.09, W * 0.52, W * 0.17, W * 0.22],
          L
        );
      }

      pageFooter(doc, W, L, 2, TOTAL, d.ApplicationNo);

      // ── PAGE 3 ─── Bank · Extra Charges · Declaration · Signatures ─────────
      doc.addPage();
      pageHeader(doc, d, W, L, `Page 3 of ${TOTAL}`);

      // 7. BANK & NOMINEE
      sectionHead(doc, "7.  Bank Details & Nominee Information", L, W);
      if (!d.bankDetail) {
        const naY = doc.y + 6;
        doc.font("Helvetica-Oblique").fontSize(8.5).fillColor(MUTED)
          .text("Bank and nominee details have not been captured yet.", L + 12, naY, { lineBreak: false });
        doc.fillColor(INK);
        doc.y = naY + 22;
      } else {
        doc.y += 4;
        fieldRow(doc, [
          ["Bank Name", d.bankDetail.BankName || "—"],
          ["Branch Name", d.bankDetail.BranchName || "—"],
          ["IFSC Code", d.bankDetail.IfscCode || "—"],
        ], L, W / 3);
        fieldRow(doc, [
          ["Account Number", d.bankDetail.AccountNo || "—"],
          ["Account Holder Name", d.bankDetail.AccountHolderName || "—"],
        ], L, W / 2);
        if (d.bankDetail.NomineeName) {
          fieldRow(doc, [
            ["Nominee Name", d.bankDetail.NomineeName],
            ["Nominee Relation", d.bankDetail.NomineeRelation || "—"],
            ["Nominee Contact", d.bankDetail.NomineeContact || "—"],
          ], L, W / 3);
        }
        doc.y += 4;
      }

      // 8. EXTRA CHARGES BREAKDOWN (if any — amounts already totalled in section 3)
      if (d.extraCharges.length > 0) {
        sectionHead(doc, "8.  Additional Charges Breakdown", L, W);
        {
          const noteY = doc.y + 4;
          doc.font("Helvetica-Oblique").fontSize(7.5).fillColor(MUTED)
            .text("Breakdown of extra charges included in the Financial Summary (page 1).", L, noteY, { width: W, lineBreak: false });
          doc.fillColor(INK);
          doc.y = noteY + 16;
        }
        dataTable(
          doc,
          ["Description", { text: "Base Amount (Rs.)", align: "right" }, { text: "GST %", align: "center" }, { text: "GST Amt (Rs.)", align: "right" }, { text: "Total (Rs.)", align: "right" }],
          d.extraCharges.map((c) => [
            c.Description || "—",
            money(c.Amount),
            `${c.GstRate || 0} %`,
            money(c.GstAmount),
            money(c.TotalAmount),
          ]),
          [W * 0.38, W * 0.185, W * 0.10, W * 0.155, W * 0.18],
          L
        );
      }

      // 9. DECLARATION
      sectionHead(doc, "9.  Declaration", L, W);
      {
        const declText =
          "I/We hereby declare that all information furnished in this Application Form is true, correct, and complete to the best of my/our knowledge. " +
          "I/We understand and acknowledge that:\n\n" +
          "a)  This Application Form is an expression of interest and does NOT constitute a confirmed booking, allotment, or Agreement for Sale.\n\n" +
          "b)  The booking shall be confirmed only upon written acknowledgement or approval from the Developer after due verification.\n\n" +
          "c)  The unit, pricing, and financial details are as at the date of this Application and are subject to the Payment Plan and the formal " +
              "Agreement for Sale to be executed separately.\n\n" +
          "d)  Refund of the token amount, if any, on cancellation or withdrawal shall be governed by the Developer's cancellation policy and applicable law.";

        const PAD = 12;
        const declH = doc.heightOfString(declText, { width: W - PAD * 2, fontSize: 8.25 }) + PAD * 2 + 4;
        const declY = doc.y + 8;
        doc.rect(L, declY, W, declH).fill("#F0F5FF");
        doc.rect(L, declY, 3.5, declH).fill(BLUE_ACC);
        doc.font("Helvetica").fontSize(8.25).fillColor(INK)
          .text(declText, L + PAD, declY + PAD, { width: W - PAD * 2 });
        doc.y = declY + declH + 22;  // ← set absolutely
      }

      // 10. SIGNATURES (3-column)
      {
        const sigY = doc.y;
        const sigH = 52;
        const colW = (W - 30) / 3;

        const sigCols = [
          { label: "Applicant's Signature", name: d.ApplicantName || "" },
          { label: d.coApplicants.length > 0 ? "Co-Applicant's Signature" : "Witness Signature", name: d.coApplicants[0]?.Name || "" },
          { label: `For ${d.CompanyName || "the Developer"}`, name: "Authorised Signatory" },
        ];

        sigCols.forEach((col, i) => {
          const sx = L + i * (colW + 15);
          doc.rect(sx, sigY, colW, sigH).strokeColor(BORDER).lineWidth(0.5).stroke();
          doc.moveTo(sx + 8, sigY + 36).lineTo(sx + colW - 8, sigY + 36).strokeColor(MUTED).lineWidth(0.4).stroke();
          doc.font("Helvetica-Bold").fontSize(7.5).fillColor(NAVY)
            .text(col.label, sx + 8, sigY + 39, { width: colW - 16, lineBreak: false });
          if (col.name) {
            doc.font("Helvetica").fontSize(7).fillColor(LABEL)
              .text(col.name, sx + 8, sigY + 49, { width: colW - 16, lineBreak: false });
          }
        });

        doc.fillColor(INK);
        doc.y = sigY + sigH + 8;
      }

      pageFooter(doc, W, L, 3, TOTAL, d.ApplicationNo);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

async function getApplicationFormPdfBuffer(pool, applicationId) {
  const d = await fetchApplicationFormData(pool, applicationId);
  if (!d) throw new Error("Application not found");
  return renderApplicationFormPdfBuffer(d);
}

module.exports = { fetchApplicationFormData, renderApplicationFormPdfBuffer, getApplicationFormPdfBuffer };
