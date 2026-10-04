"use strict";
const PDFDocument = require("pdfkit");

/* ─── helpers ─────────────────────────────────────────────── */
const fmtDate = (d) => {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};
const fmtDateTime = (d) => {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
};
const decodeLogo = (dataUrl) => {
  if (!dataUrl || typeof dataUrl !== "string") return null;
  const m = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(dataUrl.trim());
  if (!m) return null;
  try { return Buffer.from(m[2], "base64"); } catch { return null; }
};

/* ─── palette ─────────────────────────────────────────────── */
const C = {
  ink:      "#0f172a",   // near-black headlines
  body:     "#1e293b",   // body text
  muted:    "#64748b",   // labels / captions
  rule:     "#e2e8f0",   // separating lines
  shade:    "#f8fafc",   // alternating row / light panel bg
  brand:    "#92400e",   // amber-900 — table header, accent strip
  brandBg:  "#fffbeb",   // amber-50
  brandMid: "#d97706",   // amber-600
  green:    "#15803d",
  greenBg:  "#f0fdf4",
  red:      "#b91c1c",
  redBg:    "#fef2f2",
  white:    "#ffffff",
  headerBg: "#0f172a",
};

/* Draw a horizontal ruled table row; returns new Y */
function tableRow(doc, cols, y, rowH, shade, left, totW) {
  if (shade) doc.rect(left, y, totW, rowH).fill(C.shade);
  doc.rect(left, y, totW, rowH).stroke(C.rule);
  doc.fillColor(C.body);

  let xCursor = left;
  for (const { text, w, align = "left", bold = false, color } of cols) {
    const pad = 6;
    doc
      .font(bold ? "Helvetica-Bold" : "Helvetica")
      .fontSize(8.5)
      .fillColor(color || C.body)
      .text(String(text ?? "—"), xCursor + pad, y + (rowH - 8.5) / 2 + 1, {
        width: w - pad * 2,
        align,
        lineBreak: false,
      });
    xCursor += w;
  }
  return y + rowH;
}

/* ─── main render ─────────────────────────────────────────── */
function renderWelcomeCallPdfBuffer(d) {
  return new Promise((resolve, reject) => {
    const MARGIN = 40;
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
      info: { Title: `Welcome Call Verification — ${d.BookingNo || ""}` },
    });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end",  () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const PW   = doc.page.width  - MARGIN * 2;   // ≈ 515 pt
    const PH   = doc.page.height;                 // 841.89 pt
    const L    = MARGIN;
    const R    = L + PW;

    const logoBuf   = decodeLogo(d.CompanyLogo);
    const isLocked  = !!d.SubmittedAt;
    const lockColor = isLocked ? C.green : C.brandMid;
    const lockLabel = isLocked ? "VERIFIED & LOCKED" : "PENDING VERIFICATION";

    /* ══════════════════════════════════════════════════════════
       HEADER BAND — dark background, logo left, title right
    ══════════════════════════════════════════════════════════ */
    const BAND_H = 80;
    doc.rect(L, MARGIN, PW, BAND_H).fill(C.headerBg);

    /* Logo chip */
    let textX = L + 14;
    if (logoBuf) {
      try {
        doc.roundedRect(L + 10, MARGIN + 10, 58, 58, 6).fill(C.white);
        doc.image(logoBuf, L + 13, MARGIN + 13, { fit: [52, 52], align: "center", valign: "center" });
        textX = L + 80;
      } catch (_) { /* corrupt logo */ }
    }

    /* Company text */
    const nameColW = PW * 0.56 - (textX - L);
    doc.fillColor(C.white).font("Helvetica-Bold").fontSize(15)
      .text(d.CompanyName || "Company", textX, MARGIN + 14, { width: nameColW, lineBreak: false });
    doc.font("Helvetica").fontSize(7.5).fillColor("#94a3b8")
      .text(
        [d.CompanyAddress, d.CompanyCity, d.CompanyState, d.CompanyPincode].filter(Boolean).join(", "),
        textX, MARGIN + 33, { width: nameColW, lineBreak: false }
      );
    const gstLine = [d.CompanyGst ? `GSTIN ${d.CompanyGst}` : null, d.CompanyPhone].filter(Boolean).join("   ·   ");
    if (gstLine)
      doc.text(gstLine, textX, MARGIN + 44, { width: nameColW, lineBreak: false });

    /* Document type — right side */
    const rtW = PW * 0.44 - 12;
    const rtX = L + PW - rtW;
    doc.fillColor(C.white).font("Helvetica-Bold").fontSize(22)
      .text("WELCOME CALL", rtX, MARGIN + 8, { width: rtW, align: "right", lineBreak: false });
    doc.fontSize(10).fillColor(C.brandMid)
      .text("VERIFICATION REPORT", rtX, MARGIN + 35, { width: rtW, align: "right", lineBreak: false });

    /* Lock / status badge */
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor(lockColor)
      .text(lockLabel, rtX, MARGIN + 54, { width: rtW, align: "right", lineBreak: false });
    doc.font("Helvetica").fontSize(7).fillColor("#94a3b8")
      .text(
        isLocked ? `Submitted ${fmtDateTime(d.SubmittedAt)}` : "Awaiting submission",
        rtX, MARGIN + 66, { width: rtW, align: "right", lineBreak: false }
      );

    /* ══════════════════════════════════════════════════════════
       AMBER ACCENT STRIPE
    ══════════════════════════════════════════════════════════ */
    let curY = MARGIN + BAND_H;
    doc.rect(L, curY, PW, 3).fill(C.brandMid);
    curY += 3 + 18;
    doc.fillColor(C.body);

    /* ══════════════════════════════════════════════════════════
       BOOKING DETAILS — bordered info table (4-cell grid)
    ══════════════════════════════════════════════════════════ */
    // Section title bar
    doc.rect(L, curY, PW, 19).fill(C.brand);
    doc.font("Helvetica-Bold").fontSize(8).fillColor(C.white)
      .text("BOOKING DETAILS", L + 8, curY + 5, { lineBreak: false });
    curY += 19;

    /* 4-col details grid */
    const infoCols  = 4;
    const infoW     = PW / infoCols;
    const infoRowH  = 36;

    const infoItems = [
      { label: "APPLICANT NAME",  value: d.ApplicantName  || "—" },
      { label: "BOOKING NO.",     value: d.BookingNo       || "—" },
      { label: "PROJECT",         value: d.ProjectName     || "—" },
      { label: "UNIT NO.",        value: d.UnitNo          || "—" },
      { label: "SUBMITTED BY",    value: d.SubmittedByName || "—" },
      { label: "SUBMITTED ON",    value: fmtDateTime(d.SubmittedAt) },
      { label: "REPORT DATE",     value: fmtDateTime(new Date()) },
      { label: "STATUS",          value: isLocked ? "Verified & Locked" : "Pending" },
    ];

    // Draw outer border
    doc.rect(L, curY, PW, infoRowH * 2).stroke(C.rule);
    for (let i = 0; i < infoItems.length; i++) {
      const col = i % infoCols;
      const row = Math.floor(i / infoCols);
      const x   = L + col * infoW;
      const y   = curY + row * infoRowH;
      // Cell border
      doc.rect(x, y, infoW, infoRowH).stroke(C.rule);
      // Label
      doc.font("Helvetica").fontSize(6.5).fillColor(C.muted)
        .text(infoItems[i].label, x + 6, y + 6, { width: infoW - 10, lineBreak: false });
      // Value
      const isStatus = infoItems[i].label === "STATUS";
      doc.font("Helvetica-Bold").fontSize(9).fillColor(isStatus ? lockColor : C.ink)
        .text(infoItems[i].value, x + 6, y + 17, { width: infoW - 10, lineBreak: false });
    }
    curY += infoRowH * 2 + 18;

    /* ══════════════════════════════════════════════════════════
       CHECKLIST SECTIONS
    ══════════════════════════════════════════════════════════ */
    const sections = d.sections || [];

    for (const section of sections) {
      const items = section.items || [];
      const doneCount = items.filter(i => i.IsChecked && i.RecheckStatus !== "Open").length;

      /* Page break if less than 80pt left */
      if (curY > PH - MARGIN - 80) {
        doc.addPage();
        curY = MARGIN;
      }

      /* ── Section header ── */
      const secComplete = doneCount === items.length && items.length > 0;
      const secBg       = secComplete ? C.greenBg : C.brandBg;
      const secBorder   = secComplete ? C.green    : C.brandMid;

      doc.rect(L, curY, PW, 22).fill(secBg).stroke(secBorder);
      // Left accent bar
      doc.rect(L, curY, 4, 22).fill(secBorder);
      doc.font("Helvetica-Bold").fontSize(9).fillColor(secComplete ? C.green : C.brand)
        .text(section.label.toUpperCase(), L + 12, curY + 6, { width: PW * 0.65, lineBreak: false });
      doc.font("Helvetica").fontSize(8).fillColor(C.muted)
        .text(`${doneCount} of ${items.length} verified`, L, curY + 7, { width: PW - 10, align: "right", lineBreak: false });
      curY += 22;

      /* ── Column header row ── */
      doc.rect(L, curY, PW, 18).fill(C.shade).stroke(C.rule);
      const COL_CHK   = 30;
      const COL_ITEM  = PW - COL_CHK - 70 - 80;
      const COL_STS   = 70;
      const COL_RMKS  = 80;

      doc.font("Helvetica-Bold").fontSize(7).fillColor(C.muted);
      doc.text("#",       L + 9,                  curY + 5, { width: COL_CHK - 4,   lineBreak: false });
      doc.text("ITEM",    L + COL_CHK + 4,        curY + 5, { width: COL_ITEM - 8,  lineBreak: false });
      doc.text("STATUS",  L + COL_CHK + COL_ITEM, curY + 5, { width: COL_STS - 4,   lineBreak: false });
      doc.text("REMARKS", R - COL_RMKS + 4,       curY + 5, { width: COL_RMKS - 8,  lineBreak: false });
      curY += 18;

      /* ── Item rows ── */
      for (let idx = 0; idx < items.length; idx++) {
        const item     = items[idx];
        const checked  = item.IsChecked && item.RecheckStatus !== "Open";
        const recheck  = item.RecheckStatus === "Open";
        const rowColor = checked ? C.greenBg : recheck ? C.redBg : C.white;

        // Estimate row height for remarks wrap
        const hasRemark = !!item.Remarks;
        const rowH = hasRemark ? 32 : 22;

        if (curY + rowH > PH - MARGIN - 40) {
          doc.addPage();
          curY = MARGIN;
          // Repeat column header
          doc.rect(L, curY, PW, 18).fill(C.shade).stroke(C.rule);
          doc.font("Helvetica-Bold").fontSize(7).fillColor(C.muted);
          doc.text("#",       L + 9,                  curY + 5, { width: COL_CHK - 4,   lineBreak: false });
          doc.text("ITEM",    L + COL_CHK + 4,        curY + 5, { width: COL_ITEM - 8,  lineBreak: false });
          doc.text("STATUS",  L + COL_CHK + COL_ITEM, curY + 5, { width: COL_STS - 4,   lineBreak: false });
          doc.text("REMARKS", R - COL_RMKS + 4,       curY + 5, { width: COL_RMKS - 8,  lineBreak: false });
          curY += 18;
        }

        // Row background + border
        doc.rect(L, curY, PW, rowH).fill(rowColor);
        doc.rect(L, curY, PW, rowH).stroke(C.rule);

        // Vertical column dividers
        const divX1 = L + COL_CHK;
        const divX2 = divX1 + COL_ITEM;
        const divX3 = divX2 + COL_STS;
        doc.moveTo(divX1, curY).lineTo(divX1, curY + rowH).stroke(C.rule);
        doc.moveTo(divX2, curY).lineTo(divX2, curY + rowH).stroke(C.rule);
        doc.moveTo(divX3, curY).lineTo(divX3, curY + rowH).stroke(C.rule);

        /* # cell — checkbox visual */
        const cbX = L + 8;
        const cbY = curY + (rowH - 10) / 2;
        if (checked) {
          doc.roundedRect(cbX, cbY, 10, 10, 2).fill(C.green);
          // Tick
          doc.moveTo(cbX + 2.2, cbY + 5).lineTo(cbX + 4.2, cbY + 7.5).lineTo(cbX + 8, cbY + 2.5)
            .strokeColor(C.white).lineWidth(1.6).stroke().lineWidth(1);
          doc.strokeColor(C.rule);
        } else if (recheck) {
          doc.roundedRect(cbX, cbY, 10, 10, 2).fill(C.redBg).stroke("#fca5a5");
          doc.font("Helvetica-Bold").fontSize(9).fillColor(C.red)
            .text("!", cbX, cbY + 0.5, { width: 10, align: "center", lineBreak: false });
        } else {
          doc.roundedRect(cbX, cbY, 10, 10, 2).fillAndStroke(C.white, "#d1d5db");
        }

        /* Index number */
        doc.font("Helvetica").fontSize(7.5).fillColor(C.muted)
          .text(String(idx + 1), L + 20, curY + (rowH - 7.5) / 2, { width: 10, align: "center", lineBreak: false });

        /* Item label */
        const labelColor = checked ? C.green : recheck ? C.red : C.body;
        const textY = hasRemark ? curY + 6 : curY + (rowH - 8.5) / 2;
        doc.font(checked ? "Helvetica-Bold" : "Helvetica").fontSize(8.5).fillColor(labelColor)
          .text(item.Label, L + COL_CHK + 6, textY, { width: COL_ITEM - 12, lineBreak: false });

        /* Remarks */
        if (hasRemark) {
          doc.font("Helvetica-Oblique").fontSize(7.5).fillColor(C.muted)
            .text(item.Remarks, L + COL_CHK + 6, curY + 18, { width: COL_ITEM - 12, lineBreak: false });
        }

        /* Status pill text */
        const stsText  = checked ? "✓ Verified" : recheck ? "⚠ Recheck" : "○ Pending";
        const stsColor = checked ? C.green : recheck ? C.red : C.brandMid;
        doc.font("Helvetica-Bold").fontSize(8).fillColor(stsColor)
          .text(stsText, divX2 + 5, curY + (rowH - 8) / 2, { width: COL_STS - 10, lineBreak: false });

        /* Remarks column (short) */
        const rmkText = item.Remarks
          ? item.Remarks.length > 22 ? item.Remarks.slice(0, 20) + "…" : item.Remarks
          : "—";
        doc.font("Helvetica").fontSize(7.5).fillColor(C.muted)
          .text(rmkText, divX3 + 5, curY + (rowH - 7.5) / 2, { width: COL_RMKS - 10, lineBreak: false });

        curY += rowH;
      }

      curY += 14; // gap between sections
    }

    /* ══════════════════════════════════════════════════════════
       SUMMARY BAR
    ══════════════════════════════════════════════════════════ */
    if (curY > PH - MARGIN - 80) { doc.addPage(); curY = MARGIN; }
    curY += 6;

    const allItems     = sections.reduce((s, sec) => s + (sec.items || []).length, 0);
    const verifiedCnt  = sections.reduce((s, sec) => s + (sec.items || []).filter(i => i.IsChecked && i.RecheckStatus !== "Open").length, 0);
    const recheckCnt   = sections.reduce((s, sec) => s + (sec.items || []).filter(i => i.RecheckStatus === "Open").length, 0);
    const pct          = allItems > 0 ? Math.round(verifiedCnt / allItems * 100) : 0;

    const sumH = 48;
    doc.rect(L, curY, PW, sumH).fill(isLocked ? C.greenBg : C.brandBg).stroke(isLocked ? C.green : C.brandMid);
    doc.rect(L, curY, 4, sumH).fill(isLocked ? C.green : C.brandMid);

    const sumItems = [
      { label: "TOTAL ITEMS",  val: String(allItems) },
      { label: "VERIFIED",     val: String(verifiedCnt),  color: C.green   },
      { label: "RECHECK",      val: String(recheckCnt),   color: recheckCnt > 0 ? C.red : C.muted },
      { label: "COMPLETION",   val: `${pct}%`,            color: pct === 100 ? C.green : C.brandMid },
      { label: "STATUS",       val: isLocked ? "LOCKED" : "PENDING", color: lockColor },
    ];
    const sumCellW = (PW - 14) / sumItems.length;
    sumItems.forEach((si, idx) => {
      const sx = L + 14 + idx * sumCellW;
      doc.font("Helvetica").fontSize(7).fillColor(C.muted).text(si.label, sx, curY + 9, { width: sumCellW - 4, lineBreak: false });
      doc.font("Helvetica-Bold").fontSize(14).fillColor(si.color || C.ink).text(si.val, sx, curY + 19, { width: sumCellW - 4, lineBreak: false });
    });
    curY += sumH + 22;

    /* ══════════════════════════════════════════════════════════
       SIGNATURE BLOCK
    ══════════════════════════════════════════════════════════ */
    if (curY > PH - MARGIN - 80) { doc.addPage(); curY = MARGIN; }

    const sigColW = PW * 0.38;
    const sigLeftX = L;
    const sigRightX = R - sigColW;

    // Note (left)
    doc.font("Helvetica").fontSize(8).fillColor(C.muted)
      .text(
        isLocked
          ? "This document confirms that the Welcome Call verification was completed and the checklist was reviewed with the customer over phone."
          : "This document is in draft status. Verification has not been finalized.",
        sigLeftX, curY, { width: PW - sigColW - 20 }
      );

    // Signature (right)
    doc.font("Helvetica").fontSize(8.5).fillColor(C.body)
      .text(`For ${d.CompanyName || "the Company"}`, sigRightX, curY, { width: sigColW, align: "center" });
    doc.moveTo(sigRightX + 10, curY + 46).lineTo(sigRightX + sigColW - 10, curY + 46)
      .strokeColor("#94a3b8").lineWidth(0.6).stroke();
    doc.font("Helvetica").fontSize(7.5).fillColor(C.muted)
      .text("Authorized Signatory", sigRightX, curY + 50, { width: sigColW, align: "center" });

    /* ══════════════════════════════════════════════════════════
       PAGE FOOTER
    ══════════════════════════════════════════════════════════ */
    const footerY = PH - MARGIN - 20;
    doc.moveTo(L, footerY).lineTo(R, footerY).strokeColor(C.rule).lineWidth(0.6).stroke();
    doc.font("Helvetica").fontSize(7).fillColor("#94a3b8")
      .text("System-generated document — no physical signature required.", L, footerY + 5, { width: PW * 0.6, lineBreak: false });
    doc.text(`Generated ${fmtDateTime(new Date())}`, L, footerY + 5, { width: PW, align: "right", lineBreak: false });

    doc.end();
  });
}

module.exports = { renderWelcomeCallPdfBuffer };
