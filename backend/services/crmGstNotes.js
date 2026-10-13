// GST documents for money given back to a CRM customer (migration 565).
//
// GST on a booking is charged when money comes in (postCrmOnAccountToGL /
// postCrmReceiptToGL: Cr Advance base + Cr GST Output); an invoice later only
// turns the advance into income. So when a refund is paid out:
//   * the part that was never invoiced  -> REFUND VOUCHER (s.31(3)(e), Rule 51)
//   * the part that was invoiced        -> CREDIT NOTE per invoice (s.34, Rule 53),
//     latest invoice first, each capped by what that invoice still carries;
//     past 30 November after the invoice's financial year it is TimeBarred —
//     recorded, but no credit note can be declared and the buyer claims that
//     GST from the department (Circular 188/20/2022).
// Cancellation charges kept by us get no document. One set per refund,
// issued once (idempotent by RefundId); never fatal to the payout.
const { sql } = require("../db");
const { getGstSplit } = require("./crmLedger");

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

/** Last day a credit note for an invoice dated `d` can be declared: 30 Nov after its financial year (Apr–Mar). */
function creditNoteDeadline(d) {
  const x = new Date(d);
  const fyEnd = x.getMonth() >= 3 ? x.getFullYear() + 1 : x.getFullYear();
  return `${fyEnd}-11-30`;
}

/** The rate printed on the document: the booking's own GST rate, else the one its GST total implies. */
async function rateFor(pool, bookingId) {
  const b = (await pool.request().input("b", sql.Int, bookingId)
    .query("SELECT ISNULL(UnitParkingGstRate, 0) AS Rate, ISNULL(TotalGstAmount, 0) AS Gst, ISNULL(GrandTotal, 0) AS Grand FROM dbo.CrmBooking WHERE Id = @b")).recordset[0] || {};
  if (Number(b.Rate) > 0) return Number(b.Rate);
  const base = Number(b.Grand) - Number(b.Gst);
  return base > 0 && Number(b.Gst) > 0 ? Math.round((Number(b.Gst) / base) * 10000) / 100 : 0;
}

/**
 * Splits a paid refund into its GST documents and records them.
 * Returns { issued: [...] } or { none: reason }.
 */
async function issueForRefund(pool, refundId, userEmail) {
  const already = (await pool.request().input("r", sql.Int, refundId)
    .query("SELECT COUNT(*) AS n FROM dbo.CrmGstNote WHERE RefundId = @r")).recordset[0].n;
  if (already) return { none: "already issued" };
  const rf = (await pool.request().input("r", sql.Int, refundId).query(`
    SELECT r.Id, r.RefundNo, r.BookingId, r.SourceOnAccountId, r.CustomerId, r.CompanyId, r.ProjectId, r.NetAmount, r.DeductionAmount, r.GrossAmount, r.Status, r.PaidAt,
           b.ProjectId AS BookingProjectId, b.CompanyId AS BookingCompanyId
    FROM dbo.CrmRefund r LEFT JOIN dbo.CrmBooking b ON b.Id = r.BookingId WHERE r.Id = @r`)).recordset[0];
  if (!rf) return { none: "refund not found" };
  if (rf.Status !== "Paid") return { none: "refund not paid yet" };
  if (!rf.BookingId) return { none: "no booking — nothing was charged GST through CRM" };
  const net = r2(rf.NetAmount);
  if (!(net > 0)) return { none: "nothing paid back" };
  const { gstAmount: totalGst } = await getGstSplit(pool, rf.BookingId, net);
  if (!(totalGst > 0)) return { none: "no GST was charged on this booking" };

  const b = rf.BookingId;
  const sums = (await pool.request().input("b", sql.Int, b).input("r", sql.Int, refundId).query(`
    SELECT
      (SELECT ISNULL(SUM(RPAmount), 0) FROM dbo.ReceivedPayment WHERE CrmBookingId = @b AND RPStatus = N'Approved' AND SourceCrmResaleId IS NULL) AS Received,
      (SELECT ISNULL(SUM(Amount), 0) FROM dbo.CrmInvoice WHERE BookingId = @b AND Status <> N'Void' AND InvoiceType IN (N'Milestone', N'Booking', N'Final')) AS Invoiced,
      (SELECT ISNULL(SUM(TotalAmount), 0) FROM dbo.CrmGstNote WHERE BookingId = @b AND DocType = N'RefundVoucher') AS PriorVouchers,
      (SELECT ISNULL(SUM(DeductionAmount), 0) FROM dbo.CrmRefund WHERE BookingId = @b AND Status = N'Paid' AND Id <> @r) AS PriorKept`)).recordset[0];
  // Money still sitting as an advance (received, never invoiced, not given back or kept before).
  const uninvoiced = Math.max(0, r2(sums.Received) - r2(sums.Invoiced) - r2(sums.PriorVouchers) - r2(sums.PriorKept));

  const rate = await rateFor(pool, b);
  const voucherPart = Math.min(net, uninvoiced);
  let creditPart = r2(net - voucherPart);
  const pieces = [];
  if (creditPart > 0) {
    const invoices = (await pool.request().input("b", sql.Int, b).query(`
      SELECT i.Id, i.InvoiceNo, i.InvoiceDate, i.Amount,
             i.Amount - ISNULL((SELECT SUM(n.TotalAmount) FROM dbo.CrmGstNote n WHERE n.InvoiceId = i.Id), 0) AS Open
      FROM dbo.CrmInvoice i
      WHERE i.BookingId = @b AND i.Status <> N'Void' AND i.InvoiceType IN (N'Milestone', N'Booking', N'Final')
      ORDER BY i.InvoiceDate DESC, i.Id DESC`)).recordset;
    for (const inv of invoices) {
      if (!(creditPart > 0)) break;
      const take = r2(Math.min(creditPart, Number(inv.Open)));
      if (!(take > 0)) continue;
      const deadline = creditNoteDeadline(inv.InvoiceDate);
      pieces.push({ type: "CreditNote", amount: take, invoice: inv, deadline, barred: iso(rf.PaidAt || new Date()) > deadline });
      creditPart = r2(creditPart - take);
    }
  }
  // Anything not matched to an invoice is still money that came in as an advance.
  const voucherTotal = r2(voucherPart + Math.max(0, creditPart));
  if (voucherTotal > 0) pieces.unshift({ type: "RefundVoucher", amount: voucherTotal });

  // The receipt(s) we gave for that money: the one the refund came from, else the latest.
  const receipts = voucherTotal > 0 ? (await pool.request().input("b", sql.Int, b).input("oa", sql.Int, rf.SourceOnAccountId ?? null).query(`
    SELECT TOP 5 ReceiptNo AS No, ReceivedDate AS RPDocDate FROM dbo.CrmOnAccountPayment
    WHERE ReceiptNo IS NOT NULL AND ((@oa IS NOT NULL AND Id = @oa) OR (@oa IS NULL AND (BookingId = @b OR HeldFromBookingId = @b)))
    ORDER BY ReceivedDate DESC, Id DESC`)).recordset : [];

  // GST split of each piece: the shares add up exactly to the refund's GST.
  let gstLeft = totalGst;
  const { getNextDocNumber } = require("./docNumber");
  const issued = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    const gst = i === pieces.length - 1 ? r2(gstLeft) : r2((totalGst * p.amount) / net);
    gstLeft = r2(gstLeft - gst);
    const docNo = p.type === "CreditNote" && p.barred ? null
      : await getNextDocNumber(pool, p.type === "CreditNote" ? "CRN" : "RFV", p.type === "CreditNote" ? "CRN" : "RFV");
    const remarks = p.type === "RefundVoucher"
      ? "Advance received with GST and never invoiced — given back"
      : p.barred
        ? `Past ${p.deadline}: no credit note can be declared for ${p.invoice.InvoiceNo}. The buyer claims this GST from the department (Circular 188/20/2022); give them the certificate.`
        : `Reduces invoice ${p.invoice.InvoiceNo}; declare in GSTR-1 by ${p.deadline} (or the annual return, if filed earlier).`;
    const row = await pool.request()
      .input("no", sql.NVarChar(16), docNo).input("t", sql.NVarChar(20), p.type).input("st", sql.NVarChar(20), p.barred ? "TimeBarred" : "Issued")
      .input("r", sql.Int, refundId).input("b", sql.Int, b).input("c", sql.Int, rf.CustomerId ?? null)
      .input("co", sql.Int, rf.CompanyId ?? rf.BookingCompanyId ?? null).input("pr", sql.Int, rf.ProjectId ?? rf.BookingProjectId ?? null)
      .input("inv", sql.Int, p.invoice?.Id ?? null)
      .input("ag", sql.NVarChar(400), p.type === "CreditNote" ? p.invoice.InvoiceNo : (receipts.map((x) => x.No).filter(Boolean).join(", ") || null))
      .input("agd", sql.Date, p.type === "CreditNote" ? p.invoice.InvoiceDate : (receipts[0]?.RPDocDate || null))
      .input("dd", sql.Date, rf.PaidAt || new Date())
      .input("tv", sql.Decimal(18, 2), r2(p.amount - gst)).input("rate", sql.Decimal(9, 4), rate || null)
      .input("g", sql.Decimal(18, 2), gst).input("tot", sql.Decimal(18, 2), p.amount)
      .input("dl", sql.Date, p.deadline || null).input("rm", sql.NVarChar(500), remarks).input("by", sql.NVarChar(200), userEmail || null)
      .query(`INSERT INTO dbo.CrmGstNote (DocNo, DocType, Status, RefundId, BookingId, CustomerId, CompanyId, ProjectId, InvoiceId, AgainstRef, AgainstDate,
                DocDate, TaxableValue, GstRate, GstAmount, TotalAmount, DeadlineDate, Remarks, CreatedBy)
              OUTPUT INSERTED.Id
              VALUES (@no, @t, @st, @r, @b, @c, @co, @pr, @inv, @ag, @agd, @dd, @tv, @rate, @g, @tot, @dl, @rm, @by)`);
    issued.push({ id: row.recordset[0].Id, docNo, type: p.type, status: p.barred ? "TimeBarred" : "Issued", amount: p.amount, gst });
  }
  return { issued };
}

const SELECT_NOTE = `
  SELECT n.*, r.RefundNo, b.BookingNo, ISNULL(b.UnitNo, b.BookingNo) AS Property, b.HsnCode,
         c.CustomerName, c.CustomerNo, c.Address AS CustomerAddress, c.City AS CustomerCity, c.State AS CustomerState, c.Pincode AS CustomerPincode, c.Mobile AS CustomerMobile,
         comp.name AS CompanyName, comp.address AS CompanyAddress, comp.address_line2 AS CompanyAddress2, comp.city AS CompanyCity, comp.state AS CompanyState,
         comp.pincode AS CompanyPincode, comp.gst_no AS CompanyGst, comp.pan_no AS CompanyPan, comp.logo AS CompanyLogo,
         proj.name AS ProjectName, proj.state AS ProjectState
  FROM dbo.CrmGstNote n
  JOIN dbo.CrmRefund r ON r.Id = n.RefundId
  JOIN dbo.CrmBooking b ON b.Id = n.BookingId
  LEFT JOIN dbo.CrmCustomer c ON c.Id = n.CustomerId
  LEFT JOIN dbo.enterprise comp ON comp.id = n.CompanyId AND comp.business_type = 'C'
  LEFT JOIN dbo.enterprise proj ON proj.id = n.ProjectId AND proj.business_type = 'P'`;

async function list(pool, { refundId = null, customerId = null, from = null, to = null, type = null, projectScope = null } = {}) {
  const req = pool.request();
  const w = ["1 = 1"];
  if (refundId) { w.push("n.RefundId = @r"); req.input("r", sql.Int, refundId); }
  if (customerId) { w.push("n.CustomerId = @c"); req.input("c", sql.Int, customerId); }
  if (from) { w.push("n.DocDate >= @f"); req.input("f", sql.Date, from); }
  if (to) { w.push("n.DocDate <= @t"); req.input("t", sql.Date, to); }
  if (type) { w.push("n.DocType = @ty"); req.input("ty", sql.NVarChar(20), type); }
  if (projectScope) w.push(require("./projectScope").projectPredicate(projectScope, "n.ProjectId", "").trim());
  return (await req.query(`${SELECT_NOTE} WHERE ${w.join(" AND ")} ORDER BY n.DocDate DESC, n.Id DESC`)).recordset;
}

async function load(pool, id) {
  return (await pool.request().input("id", sql.Int, id).query(`${SELECT_NOTE} WHERE n.Id = @id`)).recordset[0] || null;
}

/** The document as a PDF: refund voucher, credit note, or (time-barred) the buyer's tax-paid certificate. */
function renderPdf(n) {
  const PDFDocument = require("pdfkit");
  const { dmSansFonts } = require("./pdfFonts");
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const F = dmSansFonts(doc);
    const chunks = [];
    doc.on("data", (c) => chunks.push(c)); doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject);
    const W = doc.page.width - 80, L = 40;
    const money = (x) => `Rs. ${Number(x || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const date = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "-");
    const barred = n.Status === "TimeBarred";
    const title = barred ? "CERTIFICATE OF GST PAID" : n.DocType === "CreditNote" ? "CREDIT NOTE" : "REFUND VOUCHER";
    const law = barred ? "For the recipient's refund claim — CBIC Circular 188/20/2022-GST"
      : n.DocType === "CreditNote" ? "Section 34 of the CGST Act, 2017 read with Rule 53" : "Section 31(3)(e) of the CGST Act, 2017 read with Rule 51";

    doc.rect(L, 40, W, 78).fill("#0f172a");
    doc.fillColor("#fff").font(F.bold).fontSize(16).text(n.CompanyName || "", L + 14, 52, { width: W * 0.6 });
    doc.font(F.regular).fontSize(8)
      .text([n.CompanyAddress, n.CompanyAddress2, n.CompanyCity, n.CompanyState, n.CompanyPincode].filter(Boolean).join(", "), L + 14, 74, { width: W * 0.6 })
      .text([n.CompanyGst ? `GSTIN: ${n.CompanyGst}` : null, n.CompanyPan ? `PAN: ${n.CompanyPan}` : null].filter(Boolean).join("   "), L + 14, 98, { width: W * 0.6 });
    doc.font(F.bold).fontSize(15).text(title, L + W * 0.55, 52, { width: W * 0.45 - 14, align: "right" });
    doc.font(F.regular).fontSize(9)
      .text(barred ? `Ref: ${n.RefundNo}` : `No: ${n.DocNo}`, L + W * 0.55, 76, { width: W * 0.45 - 14, align: "right" })
      .text(`Date: ${date(n.DocDate)}`, L + W * 0.55, 89, { width: W * 0.45 - 14, align: "right" });
    doc.fillColor("#475569").fontSize(7.5).text(law, L, 126, { width: W, align: "right" });

    let y = 146;
    doc.fillColor("#000").font(F.bold).fontSize(10).text("Issued to", L, y);
    doc.font(F.regular).fontSize(9).text([n.CustomerName,
      [n.CustomerAddress, n.CustomerCity, n.CustomerState, n.CustomerPincode].filter(Boolean).join(", "),
      n.CustomerMobile ? `Mobile: ${n.CustomerMobile}` : null].filter(Boolean).join(String.fromCharCode(10)), L, y + 14, { width: W * 0.55 });
    doc.font(F.bold).fontSize(10).text("Property", L + W * 0.6, y);
    doc.font(F.regular).fontSize(9)
      .text(`${n.Property} · ${n.BookingNo}`, L + W * 0.6, y + 14, { width: W * 0.4 })
      .text(n.ProjectName || "", L + W * 0.6, y + 27, { width: W * 0.4 })
      .text(`Refund ${n.RefundNo}`, L + W * 0.6, y + 40, { width: W * 0.4 });

    y += 78;
    doc.font(F.bold).fontSize(9).fillColor("#000")
      .text(n.DocType === "CreditNote" ? `Against tax invoice ${n.AgainstRef || "-"} dated ${date(n.AgainstDate)}` : `Against receipt(s) ${n.AgainstRef || "-"}${n.AgainstDate ? ` (latest ${date(n.AgainstDate)})` : ""}`, L, y, { width: W });
    y += 22;
    const cols = [["Description", 0.42], ["HSN/SAC", 0.12], ["Taxable value", 0.16], ["GST rate", 0.1], ["GST", 0.2]];
    let x = L;
    doc.rect(L, y, W, 18).fill("#f1f5f9"); doc.fillColor("#000").font(F.bold).fontSize(8);
    for (const [h, w] of cols) { doc.text(h, x + 4, y + 5, { width: W * w - 8, align: h === "Description" ? "left" : "right" }); x += W * w; }
    y += 22; x = L;
    const desc = n.DocType === "CreditNote" ? "Reduction of the sale value — booking cancelled / amount refunded" : "Advance received for the property, refunded — no supply made against it";
    const cells = [desc, n.HsnCode || "-", money(n.TaxableValue), n.GstRate != null ? `${Number(n.GstRate)}%` : "-", money(n.GstAmount)];
    doc.font(F.regular).fontSize(8.5);
    cells.forEach((c, i) => { doc.text(c, x + 4, y, { width: W * cols[i][1] - 8, align: i === 0 ? "left" : "right" }); x += W * cols[i][1]; });
    y += 34;
    doc.moveTo(L, y).lineTo(L + W, y).strokeColor("#cbd5e1").stroke();
    y += 8;
    // Place of supply for property is where the property is (IGST Act s.12(3)),
    // not the buyer's state: CGST + SGST unless the project is in another state.
    const norm = (x) => String(x || "").trim().toLowerCase();
    const sameState = !n.ProjectState || !n.CompanyState || norm(n.ProjectState) === norm(n.CompanyState);
    const half = Math.round((Number(n.GstAmount) / 2) * 100) / 100;
    const rows = [["Taxable value", money(n.TaxableValue)],
      ...(sameState ? [["CGST", money(half)], ["SGST", money(Number(n.GstAmount) - half)]] : [["IGST", money(n.GstAmount)]]),
      ["Total", money(n.TotalAmount)]];
    for (const [k, v] of rows) {
      doc.font(k === "Total" ? F.bold : F.regular).fontSize(9).text(k, L + W * 0.55, y, { width: W * 0.25 }).text(v, L + W * 0.8, y, { width: W * 0.2, align: "right" });
      y += 15;
    }
    doc.fillColor("#94a3b8").fontSize(7).text(`Place of supply: ${n.ProjectState || n.CompanyState || "where the property is"} (location of the property).`, L, y); doc.fillColor("#000"); y += 12;
    y += 14;
    doc.font(F.regular).fontSize(8.5).fillColor("#334155").text(
      barred ? `The tax shown was charged on invoice ${n.AgainstRef} and paid by us to the government. It has not been adjusted or refunded to us, and the time to issue a credit note has passed (${date(n.DeadlineDate)}). The recipient may claim it from the department.`
        : n.Remarks || "", L, y, { width: W });
    doc.fillColor("#000").font(F.bold).fontSize(9).text(`For ${n.CompanyName || ""}`, L + W * 0.6, y + 70, { width: W * 0.4, align: "right" });
    doc.font(F.regular).fontSize(8).text("Authorised signatory", L + W * 0.6, y + 110, { width: W * 0.4, align: "right" });
    doc.end();
  });
}

module.exports = { issueForRefund, list, load, renderPdf, creditNoteDeadline };
