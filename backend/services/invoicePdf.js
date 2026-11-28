const PDFDocument = require("pdfkit");
const { sql } = require("../db");
const { dmSansFonts } = require("./pdfFonts");
const { getGstSplit, gstSplitByRatio } = require("./crmLedger");
const { placeOfSupply, STATE_CODES, normalizeGstin } = require("./gstin");

const PDF_TEMPLATE_MARKER = "CivilierInvoiceV4";

// Pure engraved architectural monochrome palette (zero decorative colors).
const C = {
  ink: "#0f172a",       // Primary architectural ink
  charcoal: "#1e293b",  // Strong headers & numerals
  body: "#334155",      // Body copy & addresses
  muted: "#64748b",     // Micro-labels & captions
  faint: "#94a3b8",     // Signature rules & subtle marks
  rule: "#cbd5e1",      // Primary structural grid lines
  line: "#e2e8f0",      // Inner column/row dividers
  tint: "#f8fafc",      // Label strip / party header tint
  totalTint: "#f1f5f9", // Totals band tint
  white: "#ffffff",
  voidInk: "#991b1b",   // Muted crimson reserved strictly for VOID status
  voidBg: "#fef2f2",
};

function money(n) {
  const num = Number(n || 0);
  return num.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
function fmtDateTime(d) {
  if (!d) return "—";
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
// Indian numbering (Crore/Lakh/Thousand), matching Indian statutory and ERP displays.
function numberToWordsIndian(amount) {
  const abs = Math.abs(Number(amount || 0));
  const whole = Math.floor(abs + 1e-6);
  const paise = Math.round((abs - whole) * 100);
  if (whole === 0 && paise === 0) return "Zero Rupees Only";
  let n = whole;
  const crore = Math.floor(n / 1e7); n %= 1e7;
  const lakh = Math.floor(n / 1e5); n %= 1e5;
  const thousand = Math.floor(n / 1e3); n %= 1e3;
  const parts = [];
  if (crore) parts.push(threeDigitWords(crore) + " Crore");
  if (lakh) parts.push(threeDigitWords(lakh) + " Lakh");
  if (thousand) parts.push(threeDigitWords(thousand) + " Thousand");
  if (n) parts.push(threeDigitWords(n));
  const rupeePart = parts.length ? `${parts.join(" ")} Rupees` : "";
  const paisePart = paise > 0 ? `${rupeePart ? " and " : ""}${twoDigitWords(paise)} Paise` : "";
  return `${rupeePart}${paisePart} Only`;
}

const INVOICE_TYPE_LABEL = {
  Booking: "Booking Amount",
  Milestone: "Milestone Payment",
  Maintenance: "Maintenance Charges",
  Other: "Other Charges",
  OnAccount: "On-Account Advance",
  Final: "Final Invoice (Full Plan)",
  TransferFee: "Transfer Fee (Resale)",
};

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

function resolvePlaceOfSupply(d) {
  const pos = placeOfSupply({
    companyGst: d.CompanyGst,
    projectState: d.ProjectState,
    companyState: d.CompanyState,
  });
  const custCode = normalizeGstin(d.CustomerGst).slice(0, 2);
  const buyerState = d.CustomerState || (custCode && STATE_CODES[custCode]) || null;
  const label = pos.name
    ? pos.code ? `${pos.name} (${pos.code})` : pos.name
    : buyerState || "As per property location";
  return label;
}

function currencyPrefix(F) {
  return F.regular !== "Helvetica" ? "\u20B9" : "Rs. ";
}

async function fetchInvoiceData(pool, invoiceId) {
  const result = await pool.request().input("id", sql.Int, invoiceId).query(`
    SELECT
      inv.Id, inv.InvoiceNo, inv.InvoiceType, inv.Amount, inv.InvoiceDate, inv.Description, inv.CreatedAt,
      inv.Status, inv.VoidedAt, inv.VoidReason, inv.MilestoneId, inv.OnAccountPaymentId, inv.ResaleId,
      b.Id AS BookingId, b.BookingNo, b.BookingDate, b.UnitNo, b.BlockName, b.ProjectName, b.AreaSqFt, b.RatePerSqFt,
      b.GrandTotal, b.HsnCode, b.TotalGstAmount, b.UnitParkingGstRate,
      a.ApplicationNo, a.ApplicantName, a.Mobile, a.Email,
      comp.name AS CompanyName, comp.address AS CompanyAddress, comp.address_line2 AS CompanyAddress2,
      comp.city AS CompanyCity, comp.state AS CompanyState, comp.pincode AS CompanyPincode,
      comp.gst_no AS CompanyGst, comp.pan_no AS CompanyPan, comp.phone AS CompanyPhone, comp.email AS CompanyEmail,
      comp.logo AS CompanyLogo,
      proj.name AS ProjectFullName, proj.rera_no AS ProjectRera, proj.state AS ProjectState, proj.city AS ProjectCity,
      c.Address AS CustomerAddress, c.City AS CustomerCity, c.State AS CustomerState, c.Pincode AS CustomerPincode, c.GstNo AS CustomerGst,
      m.MilestoneNo, m.MilestoneName, m.DemandNo, m.DemandRaisedOn, m.PaidDate AS MilestonePaidDate, m.PaymentMode AS MilestonePaymentMode,
      oa.ReceiptNo AS OnAccountReceiptNo, oa.ReceivedDate AS OnAccountReceivedDate, oa.PaymentMode AS OnAccountPaymentMode,
      cu.name AS CreatedByName
    FROM dbo.CrmInvoice inv
    JOIN dbo.CrmBooking b ON b.Id = inv.BookingId
    JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
    LEFT JOIN dbo.CrmCustomer c ON c.Id = a.CustomerId
    LEFT JOIN dbo.enterprise comp ON comp.id = b.CompanyId AND comp.business_type = 'C'
    LEFT JOIN dbo.enterprise proj ON proj.id = b.ProjectId AND proj.business_type = 'P'
    LEFT JOIN dbo.CrmPaymentMilestone m ON m.Id = inv.MilestoneId
    LEFT JOIN dbo.CrmOnAccountPayment oa ON oa.Id = inv.OnAccountPaymentId
    LEFT JOIN dbo.Users cu ON cu.id = inv.CreatedBy
    WHERE inv.Id = @id
  `);
  const row = result.recordset[0];
  if (!row) return null;

  try {
    const cnRes = await pool.request().input("iid", sql.Int, invoiceId).query(`
      SELECT DocNo, DocDate, TotalAmount, Status
      FROM dbo.CrmGstNote
      WHERE InvoiceId = @iid AND Status IN (N'Issued', N'TimeBarred')
      ORDER BY DocDate, Id
    `);
    row.creditNotes = cnRes.recordset || [];
  } catch {
    row.creditNotes = [];
  }

  // GST split comes strictly from canonical getGstSplit() in crmLedger.js.
  // Resale transfer fees are billed to the buyer with the fee's own service GST / HSN.
  if (row.ResaleId) {
    const f = (await pool.request().input("rid", sql.Int, row.ResaleId).query(`
      SELECT r.DeveloperFeeAmount, r.DeveloperFeeGstAmount, r.DeveloperFeeHsnCode, r.DeveloperFeeGstRate,
             c.CustomerName, c.Mobile, c.Email, c.Address, c.City, c.State, c.Pincode, c.GstNo
      FROM dbo.CrmUnitResale r LEFT JOIN dbo.CrmCustomer c ON c.Id = r.ToCustomerId WHERE r.Id = @rid`)).recordset[0];
    if (f) {
      Object.assign(row, {
        ApplicantName: f.CustomerName, Mobile: f.Mobile, Email: f.Email,
        CustomerAddress: f.Address, CustomerCity: f.City, CustomerState: f.State, CustomerPincode: f.Pincode, CustomerGst: f.GstNo,
        HsnCode: f.DeveloperFeeHsnCode, UnitParkingGstRate: f.DeveloperFeeGstRate,
        InvBase: Number(f.DeveloperFeeAmount) || 0, InvGst: Number(f.DeveloperFeeGstAmount) || 0,
      });
      return row;
    }
  }
  const { gstAmount, baseAmount } = await getGstSplit(pool, row.BookingId, Number(row.Amount) || 0);
  row.InvGst = gstAmount;
  row.InvBase = baseAmount;
  return row;
}

// ── Unified Engraved Monochrome Stationery Layout ───────────────────────────
function drawWatermark(doc, F, text, color) {
  const cx = doc.page.width / 2;
  const cy = doc.page.height / 2;
  const span = Math.max(doc.page.width, doc.page.height) * 1.15;
  const cursorX = doc.x;
  const cursorY = doc.y;
  doc.save();
  doc.rotate(-36, { origin: [cx, cy] });
  doc.opacity(0.065);
  doc.font(F.bold).fontSize(112).fillColor(color)
    .text(text, cx - span / 2, cy - 62, { width: span, align: "center", lineBreak: false });
  doc.restore();
  doc.x = cursorX;
  doc.y = cursorY;
}

// Letterhead sitting cleanly above the unified architectural sheet frame.
function drawLetterhead(doc, F, d, { copyLabel, title, isVoid }) {
  const L = doc.page.margins.left;
  const W = doc.page.width - L - doc.page.margins.right;
  const y0 = 24;

  // Solid architectural ink top rule aligned with the document grid
  doc.rect(L, y0, W, 3).fill(C.ink);

  const startY = y0 + 13;
  const rightColW = 216;
  const rightColX = L + W - rightColW;
  const leftZoneW = W - rightColW - 18;
  const logoBuf = decodeLogo(d.CompanyLogo);

  let textX = L;
  let logoBottom = startY;
  if (logoBuf) {
    try {
      doc.image(logoBuf, L, startY + 1, { fit: [44, 44], align: "left", valign: "top" });
      textX = L + 55;
      logoBottom = startY + 45;
    } catch {
      textX = L;
    }
  }

  const infoW = leftZoneW - (textX - L);
  let ly = startY;
  doc.font(F.bold).fontSize(14).fillColor(C.ink)
    .text(d.CompanyName || "Company Name Not Set", textX, ly, { width: infoW, lineGap: 0.8 });
  ly = doc.y + 2.5;

  const addr = [d.CompanyAddress, d.CompanyAddress2, [d.CompanyCity, d.CompanyState, d.CompanyPincode].filter(Boolean).join(", ")].filter(Boolean).join(", ");
  if (addr) {
    doc.font(F.regular).fontSize(7.8).fillColor(C.body)
      .text(addr, textX, ly, { width: infoW, lineGap: 1.2 });
    ly = doc.y + 2;
  }

  const regIds = [d.CompanyGst ? `GSTIN: ${d.CompanyGst}` : null, d.CompanyPan ? `PAN: ${d.CompanyPan}` : null].filter(Boolean).join("   ·   ");
  if (regIds) {
    doc.font(F.bold).fontSize(7.5).fillColor(C.charcoal)
      .text(regIds, textX, ly, { width: infoW, lineBreak: false });
    ly = doc.y + 2;
  }
  const contactLine = [d.CompanyPhone ? `Tel: ${d.CompanyPhone}` : null, d.CompanyEmail || null].filter(Boolean).join("   ·   ");
  if (contactLine) {
    doc.font(F.regular).fontSize(7.4).fillColor(C.muted)
      .text(contactLine, textX, ly, { width: infoW, lineBreak: false });
    ly = doc.y + 2;
  }
  const leftBottom = Math.max(ly, logoBottom);

  // Right document title & restrained monochrome copy classification
  let ry = startY + 1;
  if (copyLabel) {
    doc.font(F.bold).fontSize(6.8).fillColor(isVoid ? C.voidInk : C.muted)
      .text(copyLabel.toUpperCase(), rightColX, ry, { width: rightColW, align: "right", characterSpacing: 1.0, lineBreak: false });
    ry += 11;
  }
  const titleSize = String(title).length > 12 ? 19 : 22;
  doc.font(F.bold).fontSize(titleSize).fillColor(C.ink)
    .text(title, rightColX, ry, { width: rightColW, align: "right", lineBreak: false });
  ry += titleSize + 5;
  if (isVoid) {
    doc.font(F.bold).fontSize(7.5).fillColor(C.voidInk)
      .text("STATUS: VOIDED", rightColX, ry, { width: rightColW, align: "right", characterSpacing: 0.9, lineBreak: false });
    ry += 11;
  }

  const endY = Math.max(leftBottom, ry) + 10;
  doc.x = L;
  doc.y = endY;
  doc.fillColor(C.ink);
}

// Metadata strip + two-column Billed To / Property & Booking grid inside the unified container.
function drawMetadataAndParties(doc, F, d, left, width, metaCols) {
  let y = doc.y;

  // Top Metadata Band (#f8fafc subtle surface, 4 balanced cells)
  const metaH = 34;
  doc.rect(left, y, width, metaH).fill(C.tint);
  const cellW = width / metaCols.length;
  metaCols.forEach(([k, v], i) => {
    const cx = left + i * cellW;
    if (i > 0) doc.moveTo(cx, y).lineTo(cx, y + metaH).lineWidth(0.5).strokeColor(C.line).stroke();
    doc.font(F.bold).fontSize(6.5).fillColor(C.muted)
      .text(k.toUpperCase(), cx + 10, y + 6.5, { width: cellW - 18, characterSpacing: 0.6, lineBreak: false });
    doc.font(i === 0 ? F.bold : F.regular).fontSize(8.4).fillColor(C.ink)
      .text(String(v || "—"), cx + 10, y + 17, { width: cellW - 18, lineBreak: false });
  });
  doc.moveTo(left, y + metaH).lineTo(left + width, y + metaH).lineWidth(0.75).strokeColor(C.rule).stroke();
  y += metaH;

  // Two-column Party & Booking Reference Grid (equal-height enclosed panels)
  const halfW = width * 0.50;
  const padX = 11;
  const innerW = halfW - padX * 2;
  const partyTop = y;

  const fullAddr = [d.CustomerAddress, [d.CustomerCity, d.CustomerState, d.CustomerPincode].filter(Boolean).join(", ")].filter(Boolean).join(", ");
  const contacts = [d.Mobile ? `Mob: ${d.Mobile}` : null, d.Email].filter(Boolean).join("   ·   ");
  const gstLine = d.CustomerGst ? `GSTIN: ${d.CustomerGst}` : "Unregistered / B2C Supply";

  // Pre-measure left height
  doc.font(F.bold).fontSize(10);
  const nameH = doc.heightOfString(d.ApplicantName || "Customer", { width: innerW });
  doc.font(F.regular).fontSize(8);
  const addrH = fullAddr ? doc.heightOfString(fullAddr, { width: innerW, lineGap: 1.2 }) + 3 : 0;
  const contH = contacts ? doc.heightOfString(contacts, { width: innerW }) + 3 : 0;
  const leftNeedH = 22 + nameH + 3 + addrH + contH + 16 + 8;

  // Pre-measure right rows
  const unitDisplay = [d.UnitNo, d.BlockName].filter(Boolean).join(" · ") || "—";
  const unitWithArea = d.AreaSqFt ? `${unitDisplay} (${Number(d.AreaSqFt).toLocaleString("en-IN")} sq.ft)` : unitDisplay;
  const rightRows = [
    ["Project", d.ProjectFullName || d.ProjectName || "—"],
    ["Unit / Block", unitWithArea],
    ["Booking No.", [d.BookingNo, d.BookingDate ? `(${fmtDate(d.BookingDate)})` : null].filter(Boolean).join(" ")],
    ["Application No.", d.ApplicationNo || "—"],
    ...(d.ProjectRera ? [["RERA Reg.", d.ProjectRera]] : []),
  ];
  let rightRowsH = 0;
  const measuredRight = rightRows.map(([k, v]) => {
    doc.font(F.bold).fontSize(8);
    const h = Math.max(13.5, doc.heightOfString(String(v), { width: innerW * 0.65 }) + 4);
    rightRowsH += h;
    return [k, v, h];
  });
  const rightNeedH = 22 + rightRowsH + 8;
  const partyH = Math.max(leftNeedH, rightNeedH, 94);

  // Center vertical divider & bottom border
  doc.moveTo(left + halfW, partyTop).lineTo(left + halfW, partyTop + partyH).lineWidth(0.75).strokeColor(C.rule).stroke();
  doc.moveTo(left, partyTop + partyH).lineTo(left + width, partyTop + partyH).lineWidth(0.75).strokeColor(C.rule).stroke();

  // Left: Billed To
  doc.font(F.bold).fontSize(6.6).fillColor(C.muted)
    .text("BILLED TO (RECIPIENT)", left + padX, partyTop + 8, { width: innerW, characterSpacing: 0.7, lineBreak: false });
  let ly = partyTop + 21;
  doc.font(F.bold).fontSize(10).fillColor(C.ink)
    .text(d.ApplicantName || "Customer", left + padX, ly, { width: innerW });
  ly = doc.y + 3;
  if (fullAddr) {
    doc.font(F.regular).fontSize(8).fillColor(C.body).text(fullAddr, left + padX, ly, { width: innerW, lineGap: 1.2 });
    ly = doc.y + 3;
  }
  if (contacts) {
    doc.font(F.regular).fontSize(7.8).fillColor(C.muted).text(contacts, left + padX, ly, { width: innerW });
    ly = doc.y + 3;
  }
  doc.font(d.CustomerGst ? F.bold : F.regular).fontSize(7.8).fillColor(d.CustomerGst ? C.charcoal : C.muted)
    .text(gstLine, left + padX, Math.max(ly, partyTop + partyH - 17), { width: innerW, lineBreak: false });

  // Right: Booking & Property
  const rightX = left + halfW;
  doc.font(F.bold).fontSize(6.6).fillColor(C.muted)
    .text("PROPERTY & BOOKING DETAILS", rightX + padX, partyTop + 8, { width: innerW, characterSpacing: 0.7, lineBreak: false });
  let ry = partyTop + 21;
  measuredRight.forEach(([k, v, rh], i) => {
    if (i > 0) doc.moveTo(rightX + padX, ry - 2).lineTo(rightX + halfW - padX, ry - 2).lineWidth(0.35).strokeColor(C.line).stroke();
    doc.font(F.regular).fontSize(7.6).fillColor(C.muted).text(k, rightX + padX, ry, { width: innerW * 0.35, lineBreak: false });
    doc.font(k === "Booking No." || k === "RERA Reg." ? F.bold : F.regular).fontSize(7.9).fillColor(C.ink)
      .text(String(v), rightX + padX + innerW * 0.35, ry, { width: innerW * 0.65, align: "right" });
    ry += rh;
  });

  doc.x = left;
  doc.y = partyTop + partyH;
  doc.fillColor(C.ink);
}

// Compact payment context bar inside the unified architectural grid.
function drawSettlementStrip(doc, F, d, left, width) {
  const isOnAccount = d.InvoiceType === "OnAccount";
  if (!(d.InvoiceType === "Milestone" || d.MilestonePaidDate || isOnAccount || d.InvoiceType === "Booking")) return;

  const y = doc.y;
  const h = 30;
  const stageVal = isOnAccount
    ? (d.OnAccountReceiptNo || "On-Account Advance")
    : (d.MilestoneNo ? `Milestone #${d.MilestoneNo} · ${INVOICE_TYPE_LABEL[d.InvoiceType] || "Milestone"}` : (INVOICE_TYPE_LABEL[d.InvoiceType] || "Milestone"));
  const dateVal = fmtDate(isOnAccount ? d.OnAccountReceivedDate : (d.MilestonePaidDate || d.InvoiceDate));
  const modeVal = (isOnAccount ? d.OnAccountPaymentMode : d.MilestonePaymentMode) || "Per payment schedule";
  const cols = [
    ["BILLING BASIS", stageVal, 0.44],
    [isOnAccount ? "RECEIPT DATE" : "SETTLEMENT DATE", dateVal, 0.28],
    ["PAYMENT MODE", modeVal, 0.28],
  ];

  doc.rect(left, y, width, h).fill(C.tint);
  let cx = left;
  cols.forEach(([k, v, share], idx) => {
    const cw = width * share;
    if (idx > 0) doc.moveTo(cx, y).lineTo(cx, y + h).lineWidth(0.5).strokeColor(C.line).stroke();
    doc.font(F.bold).fontSize(6.3).fillColor(C.muted).text(k, cx + 10, y + 5.5, { width: cw - 18, characterSpacing: 0.5, lineBreak: false });
    doc.font(F.bold).fontSize(7.9).fillColor(C.charcoal).text(String(v), cx + 10, y + 14.5, { width: cw - 18, lineBreak: false });
    cx += cw;
  });
  doc.moveTo(left, y + h).lineTo(left + width, y + h).lineWidth(0.75).strokeColor(C.rule).stroke();
  doc.x = left;
  doc.y = y + h;
}

// Ruled monochrome tax computation table docked edge-to-edge inside the architectural container.
function drawTaxGrid(doc, F, rs, left, width, rows, minItemHeight) {
  const cw = [
    width * 0.32, // Particulars
    width * 0.11, // HSN/SAC
    width * 0.15, // Taxable Value
    width * 0.07, // GST %
    width * 0.105, // CGST
    width * 0.105, // SGST
    width * 0.14, // Amount
  ];
  const aligns = ["left", "center", "right", "center", "right", "right", "right"];
  const headers = ["Particulars", "HSN / SAC", `Taxable (${rs})`, "GST", `CGST (${rs})`, `SGST (${rs})`, `Amount (${rs})`];

  const tableTop = doc.y;
  const headerH = 24;
  doc.rect(left, tableTop, width, headerH).fill(C.ink);

  let hx = left;
  doc.font(F.bold).fontSize(6.8).fillColor(C.white);
  headers.forEach((h, i) => {
    doc.text(h.toUpperCase(), hx + 7, tableTop + 8.5, { width: cw[i] - 14, align: aligns[i], characterSpacing: 0.3, lineBreak: false });
    hx += cw[i];
  });

  let y = tableTop + headerH;
  rows.forEach((r) => {
    const taxable = Number(r.taxable || 0);
    const gstAmount = Number(r.gstAmount || 0);
    const cgst = Math.round((gstAmount / 2) * 100) / 100;
    const sgst = Math.round((gstAmount - cgst) * 100) / 100;
    const total = r.total != null ? Number(r.total) : Math.round((taxable + gstAmount) * 100) / 100;
    const rateStr = r.ratePct > 0 ? `${r.ratePct}%` : "—";

    doc.font(F.bold).fontSize(8.8);
    const titleH = doc.heightOfString(String(r.label), { width: cw[0] - 14, lineGap: 1.5 });
    let subH = 0;
    if (r.subLabel) {
      doc.font(F.regular).fontSize(7.6);
      subH = doc.heightOfString(String(r.subLabel), { width: cw[0] - 14, lineGap: 1.2 }) + 4;
    }
    const rowH = Math.max(minItemHeight || 48, Math.ceil(titleH + subH) + 22);

    doc.font(F.bold).fontSize(8.8).fillColor(C.ink)
      .text(String(r.label), left + 7, y + 10, { width: cw[0] - 14, lineGap: 1.5 });
    if (r.subLabel) {
      doc.font(F.regular).fontSize(7.6).fillColor(C.muted)
        .text(String(r.subLabel), left + 7, doc.y + 2.5, { width: cw[0] - 14, lineGap: 1.2 });
    }

    const vals = [r.hsn || "—", money(taxable), rateStr, money(cgst), money(sgst), money(total)];
    let cx = left + cw[0];
    vals.forEach((v, idx) => {
      const colIdx = idx + 1;
      doc.font(colIdx === 6 ? F.bold : F.regular).fontSize(8.5).fillColor(C.ink)
        .text(String(v), cx + 7, y + 10.5, { width: cw[colIdx] - 14, align: aligns[colIdx], lineBreak: false });
      cx += cw[colIdx];
    });

    y += rowH;
    doc.moveTo(left, y).lineTo(left + width, y).lineWidth(0.75).strokeColor(C.rule).stroke();
  });

  // Subtle vertical column hairlines across the data region (under the solid ink header)
  let dx = left;
  for (let i = 0; i < cw.length - 1; i++) {
    dx += cw[i];
    doc.moveTo(dx, tableTop + headerH).lineTo(dx, y).lineWidth(0.45).strokeColor(C.line).stroke();
  }

  doc.x = left;
  doc.y = y;
  doc.fillColor(C.ink);
}

function drawFooter(doc, F, leftText, rightText) {
  const L = doc.page.margins.left;
  const W = doc.page.width - L - doc.page.margins.right;
  const fy = doc.page.height - 38;
  doc.font(F.regular).fontSize(7).fillColor(C.muted)
    .text(leftText, L, fy, { width: W * 0.52, height: 12, lineBreak: false });
  doc.font(F.regular).fontSize(7).fillColor(C.muted)
    .text(rightText, L + W * 0.52, fy, { width: W * 0.48, height: 12, align: "right", lineBreak: false });
}

function renderInvoicePdfBuffer(d) {
  return new Promise((resolve, reject) => {
    // Bottom margin kept compact so the single-page engraved sheet + footer never trigger auto-pagination.
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 24, bottom: 16, left: 36, right: 36 },
      info: {
        Title: `Tax Invoice ${d.InvoiceNo || ""}`,
        Author: d.CompanyName || "CivilierERP",
        Subject: `Tax Invoice for ${d.BookingNo || "Booking"}`,
        Producer: "CivilierERP",
        Keywords: PDF_TEMPLATE_MARKER,
      },
    });
    const F = dmSansFonts(doc);
    const rs = currencyPrefix(F);
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const L = doc.page.margins.left;
    const W = doc.page.width - L - doc.page.margins.right;
    const isVoid = String(d.Status || "").toLowerCase() === "void";

    if (isVoid) drawWatermark(doc, F, "VOID", C.voidInk);

    // 1. Engraved Architectural Letterhead
    drawLetterhead(doc, F, d, {
      copyLabel: isVoid ? "Voided Tax Invoice" : "Original for Recipient",
      title: "TAX INVOICE",
      isVoid,
    });

    // All inner invoice bands dock cleanly inside one precision outer architectural container
    const frameTop = doc.y;

    // 2. Metadata & Two-Column Party/Booking Grid
    drawMetadataAndParties(doc, F, d, L, W, [
      ["Invoice No.", d.InvoiceNo || "—"],
      ["Invoice Date", fmtDate(d.InvoiceDate || d.CreatedAt)],
      [d.DemandNo ? "Demand Ref." : "Invoice Category", d.DemandNo || (INVOICE_TYPE_LABEL[d.InvoiceType] || d.InvoiceType || "—")],
      ["Place of Supply", resolvePlaceOfSupply(d)],
    ]);

    // 3. Optional Void Audit Notice (quiet monochrome crimson bar inside the frame)
    if (isVoid) {
      const vTop = doc.y;
      const msg = `Voided${d.VoidedAt ? ` on ${fmtDate(d.VoidedAt)}` : ""}. Reason: ${d.VoidReason || "Marked void in audit register"}. Sequence number is permanently retained for statutory audit compliance.`;
      doc.font(F.regular).fontSize(7.8);
      const boxH = Math.max(28, doc.heightOfString(msg, { width: W - 26 }) + 16);
      doc.rect(L, vTop, W, boxH).fill(C.voidBg);
      doc.rect(L, vTop, 3, boxH).fill(C.voidInk);
      doc.font(F.bold).fontSize(7).fillColor(C.voidInk).text("VOIDED DOCUMENT — INVALID FOR TAX CREDIT", L + 11, vTop + 5.5, { width: W - 22, characterSpacing: 0.5, lineBreak: false });
      doc.font(F.regular).fontSize(7.8).fillColor(C.ink).text(msg, L + 11, vTop + 15, { width: W - 22 });
      doc.moveTo(L, vTop + boxH).lineTo(L + W, vTop + boxH).lineWidth(0.75).strokeColor(C.rule).stroke();
      doc.x = L;
      doc.y = vTop + boxH;
    }

    // 4. Optional Settlement Context Bar
    drawSettlementStrip(doc, F, d, L, W);

    // 5. Tax Computation Table (proportionally sized so the unified engraved sheet fills 1 page cleanly)
    const invAmt = Number(d.Amount || 0);
    const invGst = Number(d.InvGst || 0);
    const invBase = Number(d.InvBase != null ? d.InvBase : invAmt);
    const combinedRate = Number(d.UnitParkingGstRate || 0);
    const particulars = d.MilestoneName || INVOICE_TYPE_LABEL[d.InvoiceType] || d.InvoiceType || "Payment";
    const freeDescription = d.Description && d.Description !== particulars ? String(d.Description).trim() : null;
    const subParts = [d.MilestoneNo ? `Payment Plan Milestone #${d.MilestoneNo}` : null, freeDescription].filter(Boolean);

    const creditNotes = !isVoid && Array.isArray(d.creditNotes) ? d.creditNotes : [];
    const creditedTotal = creditNotes.reduce((s, n) => s + (Number(n.TotalAmount) || 0), 0);
    const hasCredits = creditNotes.length > 0 && creditedTotal > 0;

    // Reserve exact space needed below tax table so the unified frame anchors crisply above the bottom margin
    const summaryBlockH = hasCredits ? 128 : 96;
    const govBlockH = 92;
    const sheetBottomTarget = doc.page.height - 52;
    const availableForTable = sheetBottomTarget - doc.y - summaryBlockH - govBlockH;
    const dynamicItemMinH = Math.max(46, Math.min(180, availableForTable - 24));

    drawTaxGrid(doc, F, rs, L, W, [{
      label: particulars,
      subLabel: subParts.length ? subParts.join(" — ") : null,
      hsn: d.HsnCode || "—",
      taxable: invBase,
      gstAmount: invGst,
      total: invAmt,
      ratePct: combinedRate,
    }], dynamicItemMinH);

    // 6. Split Summary Dock inside the architectural container
    const sumTop = doc.y;
    const leftSumW = W * 0.56;
    const rightSumW = W - leftSumW;
    const rightSumX = L + leftSumW;

    const cgstAmt = Math.round((invGst / 2) * 100) / 100;
    const sgstAmt = Math.round((invGst - cgstAmt) * 100) / 100;
    const halfRateStr = combinedRate > 0 ? `${Number((combinedRate / 2).toFixed(2))}%` : null;

    // Compute exact Summary Dock height so left Words/Credits & right Totals share a flush bottom border
    let rAccH = 3 * 16 + 10; // Taxable + CGST + SGST + divider
    rAccH += 30;             // Total Invoice Value band
    if (hasCredits) rAccH += 36;
    doc.font(F.bold).fontSize(8.8);
    const wordsH = doc.heightOfString(`INR ${numberToWordsIndian(invAmt)}`, { width: leftSumW - 22, lineGap: 1.4 });
    const lAccH = 22 + wordsH + (hasCredits ? (24 + creditNotes.length * 13) : 10);
    const sumH = Math.max(rAccH, lAccH, summaryBlockH);

    // Left Summary Cell (Words + optional Credit Notes)
    doc.font(F.bold).fontSize(6.5).fillColor(C.muted)
      .text("AMOUNT CHARGEABLE (IN WORDS)", L + 11, sumTop + 9, { width: leftSumW - 22, characterSpacing: 0.7, lineBreak: false });
    doc.font(F.bold).fontSize(8.8).fillColor(C.ink)
      .text(`INR ${numberToWordsIndian(invAmt)}`, L + 11, sumTop + 20, { width: leftSumW - 22, lineGap: 1.4 });
    let cnCursor = doc.y + 10;
    if (hasCredits) {
      doc.moveTo(L + 11, cnCursor).lineTo(L + leftSumW - 11, cnCursor).lineWidth(0.45).strokeColor(C.line).stroke();
      cnCursor += 7;
      doc.font(F.bold).fontSize(6.4).fillColor(C.muted)
        .text("GST CREDIT NOTES ADJUSTED", L + 11, cnCursor, { width: leftSumW - 22, characterSpacing: 0.6, lineBreak: false });
      cnCursor += 11;
      creditNotes.forEach((cn) => {
        doc.font(F.regular).fontSize(7.6).fillColor(C.body)
          .text(`${cn.DocNo || "Credit Note"} · ${fmtDate(cn.DocDate)} (${cn.Status})`, L + 11, cnCursor, { width: leftSumW * 0.65, lineBreak: false });
        doc.font(F.bold).fontSize(7.6).fillColor(C.charcoal)
          .text(`-${rs}${money(cn.TotalAmount)}`, L + 11 + leftSumW * 0.60, cnCursor, { width: leftSumW * 0.40 - 22, align: "right", lineBreak: false });
        cnCursor += 12.5;
      });
    }

    // Right Summary Cell (Tax Breakdown + Emphasized Total Band)
    doc.moveTo(rightSumX, sumTop).lineTo(rightSumX, sumTop + sumH).lineWidth(0.75).strokeColor(C.rule).stroke();
    let ay = sumTop + 9;
    const accLines = [
      ["Taxable Value", `${rs}${money(invBase)}`],
      [halfRateStr ? `CGST (${halfRateStr})` : "CGST", `${rs}${money(cgstAmt)}`],
      [halfRateStr ? `SGST (${halfRateStr})` : "SGST", `${rs}${money(sgstAmt)}`],
    ];
    accLines.forEach(([k, v]) => {
      doc.font(F.regular).fontSize(8).fillColor(C.body).text(k, rightSumX + 11, ay, { width: rightSumW * 0.50, lineBreak: false });
      doc.font(F.regular).fontSize(8.2).fillColor(C.ink).text(v, rightSumX + 11 + rightSumW * 0.44, ay, { width: rightSumW * 0.56 - 22, align: "right", lineBreak: false });
      ay += 15.5;
    });

    const totalBandY = hasCredits ? (sumTop + sumH - 66) : (sumTop + sumH - 32);
    doc.rect(rightSumX + 0.5, totalBandY, rightSumW - 0.5, 32).fill(C.totalTint);
    doc.moveTo(rightSumX, totalBandY).lineTo(rightSumX + rightSumW, totalBandY).lineWidth(0.85).strokeColor(C.ink).stroke();
    doc.font(F.bold).fontSize(8.2).fillColor(C.ink)
      .text("TOTAL INVOICE VALUE", rightSumX + 11, totalBandY + 11, { width: rightSumW * 0.48, characterSpacing: 0.4, lineBreak: false });
    doc.font(F.bold).fontSize(12).fillColor(C.ink)
      .text(`${rs}${money(invAmt)}`, rightSumX + 11 + rightSumW * 0.44, totalBandY + 8.5, { width: rightSumW * 0.56 - 22, align: "right", lineBreak: false });

    if (hasCredits) {
      const adjY = totalBandY + 32;
      doc.moveTo(rightSumX, adjY).lineTo(rightSumX + rightSumW, adjY).lineWidth(0.6).strokeColor(C.rule).stroke();
      doc.font(F.regular).fontSize(7.8).fillColor(C.muted).text("Less: Credit Notes", rightSumX + 11, adjY + 6, { width: rightSumW * 0.50, lineBreak: false });
      doc.font(F.regular).fontSize(7.8).fillColor(C.body).text(`-${rs}${money(creditedTotal)}`, rightSumX + 11 + rightSumW * 0.44, adjY + 6, { width: rightSumW * 0.56 - 22, align: "right", lineBreak: false });
      doc.font(F.bold).fontSize(8.5).fillColor(C.ink).text("Net Effective Value", rightSumX + 11, adjY + 19, { width: rightSumW * 0.50, lineBreak: false });
      doc.font(F.bold).fontSize(9.5).fillColor(C.ink).text(`${rs}${money(Math.max(0, invAmt - creditedTotal))}`, rightSumX + 11 + rightSumW * 0.44, adjY + 18, { width: rightSumW * 0.56 - 22, align: "right", lineBreak: false });
    }

    doc.moveTo(L, sumTop + sumH).lineTo(L + W, sumTop + sumH).lineWidth(0.75).strokeColor(C.rule).stroke();
    doc.x = L;
    doc.y = sumTop + sumH;

    // 7. Governance & Signatory Row (bottom dock of the unified engraved frame — NEVER splits to page 2)
    const govTop = doc.y;
    const govLeftW = W * 0.62;
    const govRightW = W - govLeftW;

    const terms = [
      "Declaration: We declare that this invoice shows the actual price of the supply described and that all GST particulars are true and correct.",
      "1. Subject to applicable GST provisions and the executed Agreement for Sale / RERA terms.",
      "2. Retain this GST Tax Invoice for loan disbursement, input tax credit, and possession formalities.",
      `3. For billing enquiries, quote ${d.InvoiceNo || "this invoice number"} within 15 days of issue.`,
    ];
    let tyMeasure = 0;
    doc.font(F.regular).fontSize(7.1);
    terms.forEach((t) => { tyMeasure += doc.heightOfString(t, { width: govLeftW - 22, lineGap: 1.0 }) + 2; });
    const govH = Math.max(govBlockH, Math.ceil(tyMeasure) + 26);

    doc.moveTo(L + govLeftW, govTop).lineTo(L + govLeftW, govTop + govH).lineWidth(0.75).strokeColor(C.rule).stroke();

    // Left: Declaration & Terms
    doc.font(F.bold).fontSize(6.5).fillColor(C.muted)
      .text("DECLARATION & TERMS", L + 11, govTop + 9, { width: govLeftW - 22, characterSpacing: 0.7, lineBreak: false });
    let ty = govTop + 20;
    doc.font(F.regular).fontSize(7.1).fillColor(C.body);
    for (const t of terms) {
      doc.text(t, L + 11, ty, { width: govLeftW - 22, lineGap: 1.0 });
      ty = doc.y + 2;
    }

    // Right: Authorised Signatory
    const sigX = L + govLeftW;
    doc.font(F.bold).fontSize(8).fillColor(C.ink)
      .text(`For ${d.CompanyName || "the Company"}`, sigX + 12, govTop + 10, { width: govRightW - 24, align: "right", lineBreak: false });
    const sigLineY = govTop + govH - 28;
    doc.moveTo(sigX + 26, sigLineY).lineTo(sigX + govRightW - 12, sigLineY).lineWidth(0.6).strokeColor(C.faint).stroke();
    doc.font(F.bold).fontSize(7.4).fillColor(C.charcoal)
      .text("Authorised Signatory", sigX + 12, sigLineY + 5, { width: govRightW - 24, align: "right", lineBreak: false });
    if (d.CreatedByName) {
      doc.font(F.regular).fontSize(6.5).fillColor(C.muted)
        .text(`Issued by ${d.CreatedByName}`, sigX + 12, sigLineY + 15, { width: govRightW - 24, align: "right", lineBreak: false });
    }

    const frameEnd = govTop + govH;

    // Enclose the entire structured sheet in one precision 0.85pt architectural frame
    doc.rect(L, frameTop, W, frameEnd - frameTop).lineWidth(0.85).strokeColor(C.rule).stroke();

    // 8. Quiet Stationery Footer
    drawFooter(
      doc,
      F,
      "Computer-generated GST Tax Invoice · Valid without physical signature",
      `${d.InvoiceNo || "Invoice"}  ·  Issued ${fmtDate(d.InvoiceDate || d.CreatedAt)}  ·  Page 1 of 1`,
    );

    doc.end();
  });
}

// Generates the PDF and persists it (as base64) directly on the CrmInvoice row.
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

// Returns the stored PDF as a Buffer, regenerating and persisting if missing or rendered under an older template.
async function getInvoicePdfBuffer(pool, invoiceId) {
  const row = await pool.request().input("id", sql.Int, invoiceId)
    .query("SELECT PdfBase64 FROM dbo.CrmInvoice WHERE Id = @id");
  const existing = row.recordset[0]?.PdfBase64;
  if (existing) {
    const buf = Buffer.from(existing, "base64");
    if (buf.includes(PDF_TEMPLATE_MARKER)) return buf;
  }

  const base64 = await generateInvoicePdf(pool, invoiceId);
  return Buffer.from(base64, "base64");
}

// A booking's Consolidated Final Statement using the exact same engraved monochrome architectural sheet.
async function getFinalStatementPdfBuffer(pool, bookingId) {
  const head = (await pool.request().input("bid", sql.Int, bookingId).query(`
    SELECT b.BookingNo, b.BookingDate, b.UnitNo, b.BlockName, b.TotalGstAmount, b.GrandTotal,
           a.ApplicationNo, a.ApplicantName, a.Mobile, a.Email,
           c.Address AS CustomerAddress, c.City AS CustomerCity, c.State AS CustomerState, c.Pincode AS CustomerPincode, c.GstNo AS CustomerGst,
           comp.name AS CompanyName, comp.address AS CompanyAddress, comp.address_line2 AS CompanyAddress2, comp.city AS CompanyCity, comp.state AS CompanyState,
           comp.pincode AS CompanyPincode, comp.gst_no AS CompanyGst, comp.pan_no AS CompanyPan, comp.phone AS CompanyPhone, comp.email AS CompanyEmail, comp.logo AS CompanyLogo,
           COALESCE(proj.name, b.ProjectName) AS ProjectName, proj.rera_no AS ProjectRera, proj.state AS ProjectState
    FROM dbo.CrmBooking b
    JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
    LEFT JOIN dbo.CrmCustomer c ON c.Id = a.CustomerId
    LEFT JOIN dbo.enterprise comp ON comp.id = b.CompanyId AND comp.business_type = 'C'
    LEFT JOIN dbo.enterprise proj ON proj.id = b.ProjectId AND proj.business_type = 'P'
    WHERE b.Id = @bid`)).recordset[0];
  if (!head) return null;
  const invoices = (await pool.request().input("bid", sql.Int, bookingId).query(`
    SELECT i.InvoiceNo, i.InvoiceDate, i.InvoiceType, i.Amount, i.Description, m.MilestoneName,
           (SELECT ISNULL(SUM(n.TotalAmount), 0) FROM dbo.CrmGstNote n WHERE n.InvoiceId = i.Id AND n.Status IN (N'Issued', N'TimeBarred')) AS Credited
    FROM dbo.CrmInvoice i LEFT JOIN dbo.CrmPaymentMilestone m ON m.Id = i.MilestoneId
    WHERE i.BookingId = @bid AND i.Status <> 'Void' ORDER BY i.InvoiceDate, i.Id`)).recordset;
  const waived = (await pool.request().input("bid", sql.Int, bookingId).query(`
    SELECT m.MilestoneName, m.AmountDue - ISNULL(m.AmountPaid, 0) AS Amount FROM dbo.CrmPaymentMilestone m
    WHERE m.BookingId = @bid AND m.Status = 'Waived' ORDER BY m.MilestoneNo, m.Id`)).recordset;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 24, bottom: 16, left: 36, right: 36 },
      info: {
        Title: `Final Statement ${head.BookingNo || ""}`,
        Author: head.CompanyName || "CivilierERP",
        Subject: `Consolidated Invoice Statement — ${head.BookingNo || ""}`,
        Producer: "CivilierERP",
        Keywords: PDF_TEMPLATE_MARKER,
      },
    });
    const F = dmSansFonts(doc);
    const rs = currencyPrefix(F);
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const L = doc.page.margins.left;
    const W = doc.page.width - L - doc.page.margins.right;
    const round = (n) => Math.round(n * 100) / 100;

    drawLetterhead(doc, F, head, {
      copyLabel: "Consolidated Billing Summary",
      title: "FINAL STATEMENT",
      isVoid: false,
    });

    const frameTop = doc.y;
    drawMetadataAndParties(doc, F, head, L, W, [
      ["Booking No.", head.BookingNo || "—"],
      ["Statement Date", fmtDate(new Date())],
      ["Issued Invoices", `${invoices.length}`],
      ["Currency", "INR (Indian Rupee)"],
    ]);

    let tAmount = 0, tGst = 0, tBase = 0, tCredit = 0;
    const rows = invoices.map((inv) => {
      const amount = Number(inv.Amount) || 0;
      const { gstAmount, baseAmount } = gstSplitByRatio(amount, head.TotalGstAmount, head.GrandTotal);
      const credited = Number(inv.Credited) || 0;
      tAmount += amount; tGst += gstAmount; tBase += baseAmount; tCredit += credited;
      return {
        no: inv.InvoiceNo,
        date: fmtDate(inv.InvoiceDate),
        forText: String(inv.MilestoneName || inv.Description || INVOICE_TYPE_LABEL[inv.InvoiceType] || inv.InvoiceType),
        base: baseAmount,
        gst: gstAmount,
        amount,
      };
    });
    const totalWaived = round(waived.reduce((n, w) => n + Number(w.Amount), 0));
    const netInvoiced = round(tAmount - tCredit);

    // Monochrome KPI Summary Band inside frame
    const kpiY = doc.y;
    const kpiH = 34;
    const kpis = [
      ["TAXABLE VALUE", `${rs}${money(round(tBase))}`],
      ["TOTAL GST", `${rs}${money(round(tGst))}`],
      ["GROSS INVOICED", `${rs}${money(round(tAmount))}`],
      [tCredit > 0 ? "NET INVOICED" : "WAIVED / DISCOUNT", `${rs}${money(tCredit > 0 ? netInvoiced : totalWaived)}`],
    ];
    doc.rect(L, kpiY, W, kpiH).fill(C.tint);
    const kW = W / 4;
    kpis.forEach(([k, v], i) => {
      const kx = L + i * kW;
      if (i > 0) doc.moveTo(kx, kpiY).lineTo(kx, kpiY + kpiH).lineWidth(0.5).strokeColor(C.line).stroke();
      doc.font(F.bold).fontSize(6.5).fillColor(C.muted).text(k, kx + 10, kpiY + 6, { width: kW - 18, characterSpacing: 0.6, lineBreak: false });
      doc.font(F.bold).fontSize(9.5).fillColor(C.ink).text(v, kx + 10, kpiY + 16, { width: kW - 18, lineBreak: false });
    });
    doc.moveTo(L, kpiY + kpiH).lineTo(L + W, kpiY + kpiH).lineWidth(0.75).strokeColor(C.rule).stroke();
    doc.x = L;
    doc.y = kpiY + kpiH;

    // Statement Table inside frame
    const cols = [
      { t: "INVOICE NO.", x: 0, w: W * 0.21, r: false },
      { t: "DATE", x: W * 0.21, w: W * 0.13, r: false },
      { t: "PARTICULARS", x: W * 0.34, w: W * 0.26, r: false },
      { t: `TAXABLE (${rs.trim()})`, x: W * 0.60, w: W * 0.14, r: true },
      { t: `GST (${rs.trim()})`, x: W * 0.74, w: W * 0.12, r: true },
      { t: `TOTAL (${rs.trim()})`, x: W * 0.86, w: W * 0.14, r: true },
    ];
    const headerH = 24;
    const drawHead = (yy) => {
      doc.rect(L, yy, W, headerH).fill(C.ink);
      doc.fillColor(C.white).font(F.bold).fontSize(6.8);
      cols.forEach((c) => doc.text(c.t, L + c.x + 7, yy + 8.5, { width: c.w - 14, align: c.r ? "right" : "left", characterSpacing: 0.3, lineBreak: false }));
      return yy + headerH;
    };

    let y = drawHead(doc.y);
    let pageTop = frameTop;
    rows.forEach((row) => {
      doc.font(F.regular).fontSize(8.1);
      const wrapH = doc.heightOfString(row.forText, { width: cols[2].w - 14, lineGap: 1.2 });
      const rowH = Math.max(24, Math.ceil(wrapH) + 12);
      if (y + rowH > doc.page.height - 135) {
        doc.rect(L, pageTop, W, y - pageTop).lineWidth(0.85).strokeColor(C.rule).stroke();
        drawFooter(doc, F, "Consolidated Billing Summary · Not a GST Tax Invoice", `${head.BookingNo} · Continued`);
        doc.addPage();
        doc.rect(L, 24, W, 3).fill(C.ink);
        pageTop = 36;
        y = drawHead(36);
      }
      doc.fillColor(C.ink).font(F.bold).fontSize(8.1).text(row.no, L + cols[0].x + 7, y + 7, { width: cols[0].w - 14, lineBreak: false });
      doc.fillColor(C.body).font(F.regular).fontSize(8.1).text(row.date, L + cols[1].x + 7, y + 7, { width: cols[1].w - 14, lineBreak: false });
      doc.fillColor(C.ink).text(row.forText, L + cols[2].x + 7, y + 7, { width: cols[2].w - 14, lineGap: 1.2 });
      doc.text(money(row.base), L + cols[3].x + 7, y + 7, { width: cols[3].w - 14, align: "right", lineBreak: false });
      doc.text(money(row.gst), L + cols[4].x + 7, y + 7, { width: cols[4].w - 14, align: "right", lineBreak: false });
      doc.font(F.bold).text(money(row.amount), L + cols[5].x + 7, y + 7, { width: cols[5].w - 14, align: "right", lineBreak: false });
      y += rowH;
      doc.moveTo(L, y).lineTo(L + W, y).lineWidth(0.5).strokeColor(C.line).stroke();
    });

    if (y + 100 > doc.page.height - 52) {
      doc.rect(L, pageTop, W, y - pageTop).lineWidth(0.85).strokeColor(C.rule).stroke();
      drawFooter(doc, F, "Consolidated Billing Summary · Not a GST Tax Invoice", `${head.BookingNo} · Continued`);
      doc.addPage();
      doc.rect(L, 24, W, 3).fill(C.ink);
      pageTop = 36;
      y = 36;
    }

    // Bottom Docked Summary Strip inside frame
    const sumRowH = 28;
    doc.rect(L, y, W, sumRowH).fill(C.totalTint);
    doc.moveTo(L, y).lineTo(L + W, y).lineWidth(0.85).strokeColor(C.ink).stroke();
    doc.font(F.bold).fontSize(8.5).fillColor(C.ink).text("TOTAL INVOICED", L + 10, y + 9, { width: cols[2].w + cols[1].w, lineBreak: false });
    doc.font(F.bold).fontSize(8.5).fillColor(C.ink)
      .text(money(round(tBase)), L + cols[3].x + 7, y + 9, { width: cols[3].w - 14, align: "right", lineBreak: false })
      .text(money(round(tGst)), L + cols[4].x + 7, y + 9, { width: cols[4].w - 14, align: "right", lineBreak: false })
      .text(`${rs}${money(round(tAmount))}`, L + cols[5].x + 7, y + 9, { width: cols[5].w - 14, align: "right", lineBreak: false });
    y += sumRowH;

    if (tCredit > 0) {
      doc.moveTo(L, y).lineTo(L + W, y).lineWidth(0.5).strokeColor(C.line).stroke();
      doc.font(F.regular).fontSize(8).fillColor(C.muted).text("Less: Credit Notes Issued", L + 10, y + 6.5, { width: W * 0.5, lineBreak: false });
      doc.font(F.regular).fontSize(8).fillColor(C.body).text(`-${rs}${money(round(tCredit))}`, L + W * 0.5, y + 6.5, { width: W * 0.5 - 10, align: "right", lineBreak: false });
      y += 20;
      doc.moveTo(L, y).lineTo(L + W, y).lineWidth(0.5).strokeColor(C.line).stroke();
      doc.rect(L, y, W, 26).fill(C.tint);
      doc.font(F.bold).fontSize(9.2).fillColor(C.ink).text("Net Invoiced Value", L + 10, y + 7.5, { width: W * 0.5, lineBreak: false });
      doc.font(F.bold).fontSize(10).fillColor(C.ink).text(`${rs}${money(netInvoiced)}`, L + W * 0.5, y + 7, { width: W * 0.5 - 10, align: "right", lineBreak: false });
      y += 26;
    }

    if (waived.length) {
      doc.moveTo(L, y).lineTo(L + W, y).lineWidth(0.5).strokeColor(C.line).stroke();
      const note = `Waivers applied prior to billing (${rs}${money(totalWaived)} total): ${waived.map((w) => w.MilestoneName).join(", ")}.`;
      doc.font(F.regular).fontSize(7.8);
      const wh = Math.max(24, doc.heightOfString(note, { width: W - 20 }) + 12);
      doc.fillColor(C.body).text(note, L + 10, y + 6, { width: W - 20 });
      y += wh;
    }

    doc.moveTo(L, y).lineTo(L + W, y).lineWidth(0.5).strokeColor(C.line).stroke();
    const legalNote = "This consolidated statement summarizes all issued GST tax invoices listed above for reconciliation only and does not constitute a tax invoice.";
    doc.font(F.regular).fontSize(7.4);
    const lnh = Math.max(24, doc.heightOfString(legalNote, { width: W - 20 }) + 12);
    doc.fillColor(C.muted).text(legalNote, L + 10, y + 6, { width: W - 20 });
    y += lnh;

    doc.rect(L, pageTop, W, y - pageTop).lineWidth(0.85).strokeColor(C.rule).stroke();

    drawFooter(doc, F, "Consolidated Billing Summary · Not a GST Tax Invoice", `${head.BookingNo}  ·  Statement Date ${fmtDate(new Date())}`);
    doc.end();
  });
}

module.exports = { generateInvoicePdf, getInvoicePdfBuffer, renderInvoicePdfBuffer, getFinalStatementPdfBuffer };
