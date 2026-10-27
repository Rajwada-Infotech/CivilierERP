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

/** Formats SAC code for statutory documents (strips internal rate suffixes like AFH/OTH to leave standard SAC e.g. 9954). */
function formatSac(code) {
  if (!code) return "9954";
  const s = String(code).trim();
  const m = s.match(/^(\d{4,6})/);
  return m ? m[1] : s;
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
async function issueForRefund(pool, refundId, userEmail, { replacesId = null } = {}) {
  const already = (await pool.request().input("r", sql.Int, refundId)
    .query("SELECT COUNT(*) AS n FROM dbo.CrmGstNote WHERE RefundId = @r AND Status <> N'Cancelled'")).recordset[0].n;
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
      (SELECT ISNULL(SUM(Amount), 0) FROM dbo.CrmInvoice WHERE BookingId = @b AND Status <> N'Void' AND InvoiceType IN (N'Milestone', N'Booking', N'Final'))
        - (SELECT ISNULL(SUM(TotalAmount), 0) FROM dbo.CrmGstNote WHERE BookingId = @b AND Source = N'Adjustment' AND Status = N'Issued') AS Invoiced,
      (SELECT ISNULL(SUM(TotalAmount), 0) FROM dbo.CrmGstNote WHERE BookingId = @b AND DocType = N'RefundVoucher' AND Status <> N'Cancelled') AS PriorVouchers,
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
             i.Amount - ISNULL((SELECT SUM(n.TotalAmount) FROM dbo.CrmGstNote n WHERE n.InvoiceId = i.Id AND n.Status IN (N'Issued', N'TimeBarred')), 0) AS OpenAmount
      FROM dbo.CrmInvoice i
      WHERE i.BookingId = @b AND i.Status <> N'Void' AND i.InvoiceType IN (N'Milestone', N'Booking', N'Final')
      ORDER BY i.InvoiceDate DESC, i.Id DESC`)).recordset;
    for (const inv of invoices) {
      if (!(creditPart > 0)) break;
      const take = r2(Math.min(creditPart, Number(inv.OpenAmount)));
      if (!(take > 0)) continue;
      const deadline = creditNoteDeadline(inv.InvoiceDate);
      pieces.push({ type: "CreditNote", amount: take, invoice: inv, deadline, barred: iso(rf.PaidAt || new Date()) > deadline });
      creditPart = r2(creditPart - take);
    }
  }
  // Anything not matched to an invoice is still money that came in as an advance.
  const voucherTotal = r2(voucherPart + Math.max(0, creditPart));
  if (voucherTotal > 0) pieces.unshift({ type: "RefundVoucher", amount: voucherTotal });

  // The receipt(s) we gave for that money: hierarchical lookup so statutory
  // Refund Voucher (s.31(3)(e), Rule 51) always references the actual payment receipt.
  let receipts = [];
  if (voucherTotal > 0) {
    if (rf.SourceOnAccountId) {
      const oaRec = (await pool.request().input("oa", sql.Int, rf.SourceOnAccountId).query(`
        SELECT TOP 1 oa.ReceiptNo AS No, oa.ReceivedDate AS RPDocDate, oa.SourceReceivedPaymentId
        FROM dbo.CrmOnAccountPayment oa WHERE oa.Id = @oa`)).recordset[0];
      if (oaRec) {
        if (oaRec.SourceReceivedPaymentId) {
          const rpRec = (await pool.request().input("srp", sql.Int, oaRec.SourceReceivedPaymentId).query(`
            SELECT TOP 1 COALESCE(mr.ReceiptNo, rp.RPDocNo, rp.DocNo, @oaNo) AS No,
                         COALESCE(mr.ReceivedDate, rp.RPDocDate, @oaDate) AS RPDocDate
            FROM dbo.ReceivedPayment rp
            LEFT JOIN dbo.CrmMoneyReceipt mr ON mr.ReceivedPaymentId = rp.RPPaymentID
            WHERE rp.RPPaymentID = @srp`).input("oaNo", sql.NVarChar(50), oaRec.No).input("oaDate", sql.Date, oaRec.RPDocDate)).recordset[0];
          receipts.push(rpRec || oaRec);
        } else {
          receipts.push(oaRec);
        }
      }
    }
    if (!receipts.length) {
      receipts = (await pool.request().input("b", sql.Int, b).query(`
        SELECT TOP 3 oa.ReceiptNo AS No, oa.ReceivedDate AS RPDocDate
        FROM dbo.CrmOnAccountPayment oa
        WHERE (oa.BookingId = @b OR oa.HeldFromBookingId = @b) AND oa.ReceiptNo IS NOT NULL
        ORDER BY oa.ReceivedDate DESC, oa.Id DESC`)).recordset;
    }
    if (!receipts.length) {
      receipts = (await pool.request().input("b", sql.Int, b).query(`
        SELECT TOP 3 mr.ReceiptNo AS No, mr.ReceivedDate AS RPDocDate
        FROM dbo.CrmMoneyReceipt mr
        WHERE mr.BookingId = @b AND mr.Status = N'Approved'
        ORDER BY mr.ReceivedDate DESC, mr.Id DESC`)).recordset;
    }
    if (!receipts.length) {
      receipts = (await pool.request().input("b", sql.Int, b).query(`
        SELECT TOP 3 pr.ReceiptNo AS No, pr.ReceivedDate AS RPDocDate
        FROM dbo.CrmPaymentReceipt pr
        JOIN dbo.CrmPaymentMilestone m ON m.Id = pr.MilestoneId
        WHERE m.BookingId = @b AND pr.ReceiptNo IS NOT NULL
        ORDER BY pr.ReceivedDate DESC, pr.Id DESC`)).recordset;
    }
    if (!receipts.length) {
      receipts = (await pool.request().input("b", sql.Int, b).query(`
        SELECT TOP 3 COALESCE(rp.RPDocNo, rp.DocNo, CONCAT('RP-', rp.RPPaymentID)) AS No, rp.RPDocDate AS RPDocDate
        FROM dbo.ReceivedPayment rp
        WHERE rp.CrmBookingId = @b AND rp.RPStatus = N'Approved'
        ORDER BY rp.RPDocDate DESC, rp.RPPaymentID DESC`)).recordset;
    }
  }

  // GST split of each piece: the shares add up exactly to the refund's GST.
  let gstLeft = totalGst;
  const { getNextDocNumber } = require("./docNumber");
  const issued = [];
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    // Re-check under a lock on the refund: two calls at once (paid + the
    // manual "issue" button) both passed the check above and issued twice.
    await tx.request().input("r", sql.Int, refundId).query("SELECT Id FROM dbo.CrmRefund WITH (UPDLOCK, HOLDLOCK) WHERE Id = @r");
    const liveNow = (await tx.request().input("r", sql.Int, refundId)
      .query("SELECT COUNT(*) AS n FROM dbo.CrmGstNote WHERE RefundId = @r AND Status <> N'Cancelled'")).recordset[0].n;
    if (liveNow) { await tx.rollback(); return { none: "already issued" }; }
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
      const row = await tx.request()
        .input("no", sql.NVarChar(16), docNo).input("t", sql.NVarChar(20), p.type).input("st", sql.NVarChar(20), p.barred ? "TimeBarred" : "Issued")
        .input("r", sql.Int, refundId).input("b", sql.Int, b).input("c", sql.Int, rf.CustomerId ?? null)
        .input("co", sql.Int, rf.CompanyId ?? rf.BookingCompanyId ?? null).input("pr", sql.Int, rf.ProjectId ?? rf.BookingProjectId ?? null)
        .input("inv", sql.Int, p.invoice?.Id ?? null)
        .input("ag", sql.NVarChar(400), p.type === "CreditNote" ? p.invoice.InvoiceNo : (receipts.map((x) => x.No).filter(Boolean).join(", ") || null))
        .input("agd", sql.Date, p.type === "CreditNote" ? p.invoice.InvoiceDate : (receipts[0]?.RPDocDate || null))
        .input("dd", sql.Date, replacesId ? new Date() : (rf.PaidAt || new Date()))
        .input("tv", sql.Decimal(18, 2), r2(p.amount - gst)).input("rate", sql.Decimal(9, 4), rate || null)
        .input("g", sql.Decimal(18, 2), gst).input("tot", sql.Decimal(18, 2), p.amount)
        .input("dl", sql.Date, p.deadline || null).input("rm", sql.NVarChar(500), remarks).input("by", sql.NVarChar(200), userEmail || null)
        .input("rep", sql.Int, replacesId)
        .query(`INSERT INTO dbo.CrmGstNote (DocNo, DocType, Status, RefundId, BookingId, CustomerId, CompanyId, ProjectId, InvoiceId, AgainstRef, AgainstDate,
                  DocDate, TaxableValue, GstRate, GstAmount, TotalAmount, DeadlineDate, Remarks, CreatedBy, ReplacesId)
                OUTPUT INSERTED.Id
                VALUES (@no, @t, @st, @r, @b, @c, @co, @pr, @inv, @ag, @agd, @dd, @tv, @rate, @g, @tot, @dl, @rm, @by, @rep)`);
      issued.push({ id: row.recordset[0].Id, docNo, type: p.type, status: p.barred ? "TimeBarred" : "Issued", amount: p.amount, gst });
    }
    await tx.commit();
  } catch (err) {
    try { await tx.rollback(); } catch { /* rolled back */ }
    throw err;
  }
  return { issued };
}

/** Place of supply / CGST+SGST vs IGST, worked out once (services/gstin.js placeOfSupply). */
function withSupply(n) {
  if (!n) return n;
  const pos = require("./gstin").placeOfSupply({ projectGst: n.ProjectGst, companyGst: n.CompanyGst, projectState: n.ProjectState, companyState: n.CompanyState });
  return { ...n, PlaceOfSupply: pos.name, PlaceOfSupplyCode: pos.code, IntraState: pos.intraState };
}

const SELECT_NOTE_BASE = `
  SELECT n.Id, n.DocNo, n.DocType, n.Status, n.RefundId, n.BookingId, n.CustomerId, n.CompanyId, n.ProjectId, n.InvoiceId,
         n.AgainstRef, n.AgainstDate, n.DocDate, n.TaxableValue, n.GstRate, n.GstAmount, n.TotalAmount, n.DeadlineDate,
         n.Remarks, n.CreatedBy, n.CreatedAt, n.CancelledAt, n.CancelledBy, n.CancelReason, n.ReplacesId, n.Source,
         n.ReasonType, n.ApprovalStatus, n.RequestedById, n.RequestedAt, n.ApprovedAt, n.RejectionNote, n.MilestoneId,
         n.OnAccountId, n.MovedToAccount, n.CancelApprovalStatus, n.CancelRequestedById, n.CancelRequestedAt, n.CancelRequestReason,
         r.RefundNo, r.SourceType AS RefundSource, r.Reason AS RefundReason, r.PaidAt AS RefundPaidAt, r.GrossAmount AS RefundGross,
         r.DeductionAmount AS RefundKept, r.NetAmount AS RefundNet,
         b.BookingNo, ISNULL(b.UnitNo, b.BookingNo) AS Property, b.HsnCode, b.ApplicationId,
         rn.DocNo AS ReplacesNo,
         (SELECT TOP 1 x.DocNo FROM dbo.CrmGstNote x WHERE x.ReplacesId = n.Id) AS ReplacedByNo,
         c.CustomerName, c.CustomerNo, c.GstNo AS CustomerGst, c.Address AS CustomerAddress, c.City AS CustomerCity, c.State AS CustomerState, c.Pincode AS CustomerPincode, c.Mobile AS CustomerMobile,
         comp.name AS CompanyName, comp.address AS CompanyAddress, comp.address_line2 AS CompanyAddress2, comp.city AS CompanyCity, comp.state AS CompanyState,
         comp.pincode AS CompanyPincode, comp.gst_no AS CompanyGst, comp.pan_no AS CompanyPan,
         proj.name AS ProjectName, proj.state AS ProjectState, proj.gst_no AS ProjectGst
  FROM dbo.CrmGstNote n
  LEFT JOIN dbo.CrmRefund r ON r.Id = n.RefundId
  JOIN dbo.CrmBooking b ON b.Id = n.BookingId
  LEFT JOIN dbo.CrmCustomer c ON c.Id = n.CustomerId
  LEFT JOIN dbo.enterprise comp ON comp.id = n.CompanyId AND comp.business_type = 'C'
  LEFT JOIN dbo.enterprise proj ON proj.id = n.ProjectId AND proj.business_type = 'P'
  LEFT JOIN dbo.CrmGstNote rn ON rn.Id = n.ReplacesId`;

const SELECT_NOTE_DETAIL = `
  SELECT n.Id, n.DocNo, n.DocType, n.Status, n.RefundId, n.BookingId, n.CustomerId, n.CompanyId, n.ProjectId, n.InvoiceId,
         n.AgainstRef, n.AgainstDate, n.DocDate, n.TaxableValue, n.GstRate, n.GstAmount, n.TotalAmount, n.DeadlineDate,
         n.Remarks, n.CreatedBy, n.CreatedAt, n.CancelledAt, n.CancelledBy, n.CancelReason, n.ReplacesId, n.Source,
         n.ReasonType, n.ApprovalStatus, n.RequestedById, n.RequestedAt, n.ApprovedAt, n.RejectionNote, n.MilestoneId,
         n.OnAccountId, n.MovedToAccount, n.DueReducedBy, n.CancelApprovalStatus, n.CancelRequestedById, n.CancelRequestedAt, n.CancelRequestReason,
         r.RefundNo, r.SourceType AS RefundSource, r.Reason AS RefundReason, r.PaidAt AS RefundPaidAt, r.GrossAmount AS RefundGross,
         r.DeductionAmount AS RefundKept, r.NetAmount AS RefundNet,
         b.BookingNo, ISNULL(b.UnitNo, b.BookingNo) AS Property, b.HsnCode, b.ApplicationId,
         rn.DocNo AS ReplacesNo,
         (SELECT TOP 1 x.DocNo FROM dbo.CrmGstNote x WHERE x.ReplacesId = n.Id) AS ReplacedByNo,
         c.CustomerName, c.CustomerNo, c.GstNo AS CustomerGst, c.Address AS CustomerAddress, c.City AS CustomerCity, c.State AS CustomerState, c.Pincode AS CustomerPincode, c.Mobile AS CustomerMobile,
         comp.name AS CompanyName, comp.address AS CompanyAddress, comp.address_line2 AS CompanyAddress2, comp.city AS CompanyCity, comp.state AS CompanyState,
         comp.pincode AS CompanyPincode, comp.gst_no AS CompanyGst, comp.pan_no AS CompanyPan, comp.logo AS CompanyLogo,
         proj.name AS ProjectName, proj.state AS ProjectState, proj.gst_no AS ProjectGst
  FROM dbo.CrmGstNote n
  LEFT JOIN dbo.CrmRefund r ON r.Id = n.RefundId
  JOIN dbo.CrmBooking b ON b.Id = n.BookingId
  LEFT JOIN dbo.CrmCustomer c ON c.Id = n.CustomerId
  LEFT JOIN dbo.enterprise comp ON comp.id = n.CompanyId AND comp.business_type = 'C'
  LEFT JOIN dbo.enterprise proj ON proj.id = n.ProjectId AND proj.business_type = 'P'
  LEFT JOIN dbo.CrmGstNote rn ON rn.Id = n.ReplacesId`;

// The page's kinds of document (its tabs), as SQL: a raised note before issue, cancelled, past deadline,
// a credit note on an invoice, or a refund voucher on an advance.
const KIND_SQL = `CASE WHEN n.Status IN (N'Draft', N'Pending', N'Rejected') THEN 'request'
  WHEN n.Status = N'Cancelled' THEN 'cancelled' WHEN n.Status = N'TimeBarred' THEN 'barred'
  WHEN n.DocType = N'CreditNote' THEN 'invoice' ELSE 'advance' END`;

async function list(pool, {
  refundId = null, customerId = null, companyId = null, projectId = null, blockId = null,
  from = null, to = null, type = null, status = null, search = null,
  projectScope = null, includeCancelled = true, page = null, pageSize = null, offset = null
} = {}) {
  const req = pool.request();
  const w = ["1 = 1"];
  if (refundId) { w.push("n.RefundId = @r"); req.input("r", sql.Int, refundId); }
  if (customerId) { w.push("n.CustomerId = @c"); req.input("c", sql.Int, customerId); }
  if (companyId) { w.push("n.CompanyId = @co"); req.input("co", sql.Int, companyId); }
  if (projectId) { w.push("n.ProjectId = @pr"); req.input("pr", sql.Int, projectId); }
  if (blockId) { w.push("b.BlockId = @bl"); req.input("bl", sql.Int, blockId); }
  if (from) { w.push("n.DocDate >= @f"); req.input("f", sql.Date, from); }
  if (to) { w.push("n.DocDate <= @t"); req.input("t", sql.Date, to); }
  if (type) { w.push("n.DocType = @ty"); req.input("ty", sql.NVarChar(20), type); }
  if (status && status !== "all") {
    if (status === "request") {
      w.push("n.Status IN (N'Draft', N'Pending', N'Rejected')");
    } else if (status === "invoice") {
      w.push("n.DocType = N'CreditNote' AND n.Status = N'Issued'");
    } else if (status === "advance") {
      w.push("n.DocType = N'RefundVoucher' AND n.Status = N'Issued'");
    } else if (status === "barred") {
      w.push("n.Status = N'TimeBarred'");
    } else if (status === "cancelled") {
      w.push("n.Status = N'Cancelled'");
    } else {
      w.push("n.Status = @st"); req.input("st", sql.NVarChar(20), status);
    }
  } else if (!includeCancelled) {
    w.push("n.Status <> N'Cancelled'");
  }
  if (search && search.trim()) {
    w.push("(n.DocNo LIKE @q OR c.CustomerName LIKE @q OR b.UnitNo LIKE @q OR b.BookingNo LIKE @q OR r.RefundNo LIKE @q OR n.AgainstRef LIKE @q)");
    req.input("q", sql.NVarChar(100), `%${search.trim()}%`);
  }
  if (projectScope) w.push(require("./projectScope").projectPredicate(projectScope, "n.ProjectId", "").trim());

  if (page != null && pageSize != null) {
    const FROM = `
      FROM dbo.CrmGstNote n
      LEFT JOIN dbo.CrmRefund r ON r.Id = n.RefundId
      JOIN dbo.CrmBooking b ON b.Id = n.BookingId
      LEFT JOIN dbo.CrmCustomer c ON c.Id = n.CustomerId`;
    const total = (await req.query(`SELECT COUNT(*) AS total ${FROM} WHERE ${w.join(" AND ")}`)).recordset[0].total;
    // Per kind for the same filters, the tab aside — the page's figures and tabs (it used to fetch every note).
    const kw = w.filter((x) => !x.startsWith("n.Status") && !x.startsWith("n.DocType = N'"));
    const kinds = (await req.query(`SELECT ${KIND_SQL} AS Kind, COUNT(*) AS n, SUM(n.GstAmount) AS gst,
        SUM(CASE WHEN n.Status = N'Issued' AND n.DocType = N'CreditNote' AND n.DeadlineDate >= CAST(SYSDATETIME() AS DATE)
                  AND n.DeadlineDate <= DATEADD(DAY, 30, CAST(SYSDATETIME() AS DATE)) THEN 1 ELSE 0 END) AS dueSoon
      ${FROM} WHERE ${kw.join(" AND ")} GROUP BY ${KIND_SQL}`)).recordset;
    const kindCounts = {};
    for (const k of kinds) kindCounts[k.Kind] = { count: k.n, gst: Number(k.gst) || 0, dueSoon: k.dueSoon };

    const off = offset != null ? offset : (page - 1) * pageSize;
    req.input("offset", sql.Int, off);
    req.input("limit", sql.Int, pageSize);
    const dataSql = `${SELECT_NOTE_BASE} WHERE ${w.join(" AND ")} ORDER BY n.DocDate DESC, n.Id DESC OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`;
    const rows = (await req.query(dataSql)).recordset;
    return { rows, total, kindCounts };
  }

  return (await req.query(`${SELECT_NOTE_BASE} WHERE ${w.join(" AND ")} ORDER BY n.DocDate DESC, n.Id DESC`)).recordset.map(withSupply);
}

async function load(pool, id) {
  return withSupply((await pool.request().input("id", sql.Int, id).query(`${SELECT_NOTE_DETAIL} WHERE n.Id = @id`)).recordset[0] || null);
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
    const barred = n.Status === "TimeBarred" || (n.Status === "Cancelled" && !n.DocNo);
    const draft = ["Draft", "Pending", "Rejected"].includes(n.Status);
    const title = barred ? "CERTIFICATE OF GST PAID" : n.DocType === "CreditNote" ? (draft ? "CREDIT NOTE — DRAFT" : "CREDIT NOTE") : "REFUND VOUCHER";
    const law = barred ? "For the recipient's refund claim — CBIC Circular 188/20/2022-GST"
      : n.DocType === "CreditNote" ? "Section 34 of the CGST Act, 2017 read with Rule 53" : "Section 31(3)(e) of the CGST Act, 2017 read with Rule 51";

    doc.rect(L, 40, W, 78).fill("#0f172a");
    doc.fillColor("#fff").font(F.bold).fontSize(16).text(n.CompanyName || "", L + 14, 52, { width: W * 0.6 });
    doc.font(F.regular).fontSize(8)
      .text([n.CompanyAddress, n.CompanyAddress2, n.CompanyCity, n.CompanyState, n.CompanyPincode].filter(Boolean).join(", "), L + 14, 74, { width: W * 0.6 })
      .text([n.CompanyGst ? `GSTIN: ${n.CompanyGst}` : null, n.CompanyPan ? `PAN: ${n.CompanyPan}` : null].filter(Boolean).join("   "), L + 14, 98, { width: W * 0.6 });
    doc.font(F.bold).fontSize(15).text(title, L + W * 0.55, 52, { width: W * 0.45 - 14, align: "right" });
    doc.font(F.regular).fontSize(9)
      .text(barred ? `Ref: ${n.RefundNo || n.AgainstRef}` : draft ? "Not issued — waiting for approval" : `No: ${n.DocNo}`, L + W * 0.55, 76, { width: W * 0.45 - 14, align: "right" })
      .text(`Date: ${date(n.DocDate)}`, L + W * 0.55, 89, { width: W * 0.45 - 14, align: "right" });
    doc.fillColor("#475569").fontSize(7.5).text(law, L, 126, { width: W, align: "right" });

    let y = 146;
    doc.fillColor("#000").font(F.bold).fontSize(10).text("Issued to", L, y);
    doc.font(F.regular).fontSize(9).text([n.CustomerName,
      [n.CustomerAddress, n.CustomerCity, n.CustomerState, n.CustomerPincode].filter(Boolean).join(", "),
      n.CustomerMobile ? `Mobile: ${n.CustomerMobile}` : null, n.CustomerGst ? `GSTIN: ${n.CustomerGst}` : null].filter(Boolean).join(String.fromCharCode(10)), L, y + 14, { width: W * 0.55 });
    doc.font(F.bold).fontSize(10).text("Property", L + W * 0.6, y);
    doc.font(F.regular).fontSize(9)
      .text(`${n.Property} · ${n.BookingNo}`, L + W * 0.6, y + 14, { width: W * 0.4 })
      .text(n.ProjectName || "", L + W * 0.6, y + 27, { width: W * 0.4 })
      .text(n.RefundNo ? `Refund ${n.RefundNo}` : "Invoice value reduced — no refund", L + W * 0.6, y + 40, { width: W * 0.4 });

    y += 78;
    doc.font(F.bold).fontSize(9).fillColor("#000")
      .text(n.DocType === "CreditNote" ? `Against tax invoice ${n.AgainstRef || "-"} dated ${date(n.AgainstDate)}` : `Against receipt(s) ${n.AgainstRef || "-"}${n.AgainstDate ? ` (latest ${date(n.AgainstDate)})` : ""}`, L, y, { width: W });
    y += 22;
    const cols = [["Description", 0.42], ["HSN/SAC", 0.12], ["Taxable value", 0.16], ["GST rate", 0.1], ["GST", 0.2]];
    let x = L;
    doc.rect(L, y, W, 18).fill("#f1f5f9"); doc.fillColor("#000").font(F.bold).fontSize(8);
    for (const [h, w] of cols) { doc.text(h, x + 4, y + 5, { width: W * w - 8, align: h === "Description" ? "left" : "right" }); x += W * w; }
    y += 22; x = L;
    const REASON_TEXT = { Discount: "Discount allowed", AreaChange: "Change in area", PriceCorrection: "Price correction", Other: "Reduction in value" };
    const desc = n.Source === "Adjustment" ? `${REASON_TEXT[n.ReasonType] || "Reduction in value"} on the sale — ${n.Remarks || ""}`
      : n.DocType === "CreditNote" ? "Reduction of the sale value — booking cancelled / amount refunded" : "Advance received for the property, refunded — no supply made against it";
    const cells = [desc, formatSac(n.HsnCode), money(n.TaxableValue), n.GstRate != null ? `${Number(n.GstRate)}%` : "-", money(n.GstAmount)];
    doc.font(F.regular).fontSize(8.5);
    cells.forEach((c, i) => { doc.text(c, x + 4, y, { width: W * cols[i][1] - 8, align: i === 0 ? "left" : "right" }); x += W * cols[i][1]; });
    y += 34;
    doc.moveTo(L, y).lineTo(L + W, y).strokeColor("#cbd5e1").stroke();
    y += 8;
    // Place of supply for property is where the property is (IGST Act s.12(3)),
    // not the buyer's state: CGST + SGST unless the project is in another state.
    const norm = (x) => String(x || "").trim().toLowerCase();
    const sameState = n.IntraState !== false;
    const half = Math.round((Number(n.GstAmount) / 2) * 100) / 100;
    const rows = [["Taxable value", money(n.TaxableValue)],
      ...(sameState ? [["CGST", money(half)], ["SGST", money(Number(n.GstAmount) - half)]] : [["IGST", money(n.GstAmount)]]),
      ["Total", money(n.TotalAmount)]];
    for (const [k, v] of rows) {
      doc.font(k === "Total" ? F.bold : F.regular).fontSize(9).text(k, L + W * 0.55, y, { width: W * 0.25 }).text(v, L + W * 0.8, y, { width: W * 0.2, align: "right" });
      y += 15;
    }
    doc.fillColor("#94a3b8").fontSize(7).text(`Place of supply: ${n.PlaceOfSupply ? `${n.PlaceOfSupply}${n.PlaceOfSupplyCode ? ` (${n.PlaceOfSupplyCode})` : ""}` : "where the property is"} — location of the property.`, L, y); doc.fillColor("#000"); y += 12;
    y += 14;
    doc.font(F.regular).fontSize(8.5).fillColor("#334155").text(
      barred ? `The tax shown was charged on invoice ${n.AgainstRef} and paid by us to the government. It has not been adjusted or refunded to us, and the time to issue a credit note has passed (${date(n.DeadlineDate)}). The recipient may claim it from the department.`
        : n.Source === "Adjustment"
          ? `Reduces invoice ${n.AgainstRef}${Number(n.MovedToAccount) > 0 ? `; Rs. ${Number(n.MovedToAccount).toLocaleString("en-IN")} already paid is held as credit on the customer's account` : ""}. Declare in GSTR-1 by ${date(n.DeadlineDate)}.`
          : n.Remarks || "", L, y, { width: W });
    if (draft) {
      doc.save().rotate(-30, { origin: [L + W / 2, 420] }).fillColor("#64748b").opacity(0.15).font(F.bold).fontSize(72)
        .text("DRAFT", L, 390, { width: W, align: "center" }).restore();
      doc.opacity(1);
    }
    if (n.Status === "Cancelled") {
      doc.save().rotate(-30, { origin: [L + W / 2, 420] }).fillColor("#dc2626").opacity(0.18).font(F.bold).fontSize(64)
        .text("CANCELLED", L, 390, { width: W, align: "center" }).restore();
      doc.opacity(1).fillColor("#b91c1c").font(F.regular).fontSize(8.5)
        .text(`Cancelled on ${date(n.CancelledAt)}${n.CancelReason ? ` — ${n.CancelReason}` : ""}${n.ReplacedByNo ? `. Replaced by ${n.ReplacedByNo}.` : ""}`, L, y + 40, { width: W });
    }
    if (n.ReplacesNo) doc.fillColor("#475569").font(F.regular).fontSize(8).text(`Replaces ${n.ReplacesNo} (cancelled).`, L, y + 54, { width: W });
    doc.fillColor("#000").font(F.bold).fontSize(9).text(`For ${n.CompanyName || ""}`, L + W * 0.6, y + 70, { width: W * 0.4, align: "right" });
    doc.font(F.regular).fontSize(8).text("Authorised signatory", L + W * 0.6, y + 110, { width: W * 0.4, align: "right" });
    doc.end();
  });
}

class GstNoteError extends Error { constructor(m, status = 400) { super(m); this.status = status; } }

/**
 * Cancel one issued in error: it keeps its number (the series stays unbroken
 * for the GST return) and says who and why. Every document of that refund is
 * cancelled together — they were worked out as one split.
 */
async function cancel(pool, id, reason, userEmail) {
  const n = await load(pool, id);
  if (!n) throw new GstNoteError("Credit note not found", 404);
  if (n.Status === "Cancelled") throw new GstNoteError("It is already cancelled", 409);
  if (!String(reason || "").trim()) throw new GstNoteError("Say why it is being cancelled");
  // A refund's notes are one split: cancelled together. An adjustment stands alone.
  await pool.request().input("r", sql.Int, n.RefundId ?? null).input("id", sql.Int, id).input("why", sql.NVarChar(500), String(reason).trim().slice(0, 500)).input("by", sql.NVarChar(200), userEmail || null)
    .query(`UPDATE dbo.CrmGstNote SET Status = N'Cancelled', CancelledAt = SYSDATETIME(), CancelledBy = @by, CancelReason = @why
            WHERE Status <> N'Cancelled' AND ((@r IS NOT NULL AND RefundId = @r) OR Id = @id)`);
  return load(pool, id);
}

/** A fresh set for a refund whose documents were all cancelled. */
async function reissue(pool, refundId, userEmail) {
  const live = (await pool.request().input("r", sql.Int, refundId)
    .query("SELECT COUNT(*) AS n FROM dbo.CrmGstNote WHERE RefundId = @r AND Status <> N'Cancelled'")).recordset[0].n;
  if (live) throw new GstNoteError("This refund still has a live credit note — cancel it first", 409);
  const last = (await pool.request().input("r", sql.Int, refundId)
    .query("SELECT TOP 1 Id FROM dbo.CrmGstNote WHERE RefundId = @r AND Status = N'Cancelled' ORDER BY Id DESC")).recordset[0];
  const out = await issueForRefund(pool, refundId, userEmail, { replacesId: last?.Id ?? null });
  if (out.none) throw new GstNoteError(`No credit note needed: ${out.none}`, 409);
  return out;
}

/** Paid refunds that carried GST but have no live credit note yet. */
async function pending(pool, { projectScope = null } = {}) {
  const scope = projectScope ? ` AND ${require("./projectScope").projectPredicate(projectScope, "COALESCE(r.ProjectId, b.ProjectId)", "").trim()}` : "";
  return (await pool.request().query(`
    SELECT r.Id AS RefundId, r.RefundNo, r.NetAmount, r.DeductionAmount, r.PaidAt, r.SourceType, b.BookingNo, ISNULL(b.UnitNo, b.BookingNo) AS Property,
           c.CustomerName, proj.name AS ProjectName,
           (SELECT COUNT(*) FROM dbo.CrmGstNote x WHERE x.RefundId = r.Id AND x.Status = N'Cancelled') AS CancelledCount
    FROM dbo.CrmRefund r
    JOIN dbo.CrmBooking b ON b.Id = r.BookingId
    LEFT JOIN dbo.CrmCustomer c ON c.Id = r.CustomerId
    LEFT JOIN dbo.enterprise proj ON proj.id = COALESCE(r.ProjectId, b.ProjectId) AND proj.business_type = 'P'
    WHERE r.Status = N'Paid' AND r.NetAmount > 0 AND ISNULL(b.TotalGstAmount, 0) > 0
      AND NOT EXISTS (SELECT 1 FROM dbo.CrmGstNote n WHERE n.RefundId = r.Id AND n.Status <> N'Cancelled')${scope}
    ORDER BY r.PaidAt DESC`)).recordset;
}

// ════════════════════════════════════════════════════════════════════════════
//  Credit note WITHOUT a refund (migration 567): an invoice reduced — discount,
//  area change, price correction — and the money stays with us.
//    raised (Draft) -> sent for approval ('crm-credit-notes', maker-checker)
//    -> approved: numbered; booking value and the invoice's milestone come
//       down; anything already paid above the new amount moves to the
//       customer's account (an offsetting receipt line on the milestone + a
//       CrmOnAccountPayment credit, no new cash); the invoice's income goes
//       back to Advance from Customer in the same heads it was booked to.
//  GST stays as paid while the money is held as an advance; it is given back
//  only when that money is refunded (the refund's own voucher).
// ════════════════════════════════════════════════════════════════════════════
const REASONS = ["Discount", "AreaChange", "PriceCorrection", "Other"];
const SALE_INVOICE_TYPES = ["Milestone", "Booking", "Final"];

/** What an invoice can still be credited, and by when. */
async function invoiceCreditable(pool, invoiceId) {
  const inv = (await pool.request().input("i", sql.Int, invoiceId).query(`
    SELECT i.Id, i.InvoiceNo, i.InvoiceDate, i.InvoiceType, i.Amount, i.Status, i.MilestoneId, i.BookingId,
           b.Status AS BookingStatus, b.IsActive AS BookingActive, b.BookingNo, ISNULL(b.UnitNo, b.BookingNo) AS Property, b.ProjectId, b.CompanyId, a.CustomerId, c.CustomerName,
           i.Amount - ISNULL((SELECT SUM(n.TotalAmount) FROM dbo.CrmGstNote n WHERE n.InvoiceId = i.Id AND n.Status IN (N'Issued', N'TimeBarred')), 0) AS OpenAmount,
           (SELECT COUNT(*) FROM dbo.CrmGstNote n WHERE n.InvoiceId = i.Id AND n.Source = N'Adjustment' AND n.Status IN (N'Draft', N'Pending', N'Rejected')) AS OpenRequests
    FROM dbo.CrmInvoice i JOIN dbo.CrmBooking b ON b.Id = i.BookingId
    JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId LEFT JOIN dbo.CrmCustomer c ON c.Id = a.CustomerId
    WHERE i.Id = @i`)).recordset[0];
  if (!inv) throw new GstNoteError("Invoice not found", 404);
  const deadline = creditNoteDeadline(inv.InvoiceDate);
  return { ...inv, Open: r2(inv.OpenAmount), deadline, pastDeadline: iso(new Date()) > deadline };
}

function assertCreditable(inv, amount, { ignoreOpenRequests = false } = {}) {
  if (!SALE_INVOICE_TYPES.includes(inv.InvoiceType)) throw new GstNoteError("Only a sale invoice (booking / milestone / final) can be credited");
  if (inv.Status === "Void") throw new GstNoteError(`Invoice ${inv.InvoiceNo} is void`, 409);
  if (!inv.BookingActive || ["Cancelled", "Rejected", "Expired", "Transferred"].includes(inv.BookingStatus))
    throw new GstNoteError(`The booking of ${inv.InvoiceNo} is ${String(inv.BookingStatus || "closed").toLowerCase()} — its money is settled through the cancellation / refund`, 409);
  if (inv.pastDeadline) throw new GstNoteError(`Too late for a credit note on ${inv.InvoiceNo}: it had to be declared by ${inv.deadline}`, 409);
  if (!ignoreOpenRequests && inv.OpenRequests) throw new GstNoteError(`A credit note on ${inv.InvoiceNo} is already being prepared or approved — finish that one first`, 409);
  if (!(amount > 0)) throw new GstNoteError("Enter the amount to credit");
  if (amount > inv.Open + 0.005) throw new GstNoteError(`${inv.InvoiceNo} can be credited at most ${inv.Open.toLocaleString("en-IN")} (its value less earlier credit notes)`, 409);
}

async function createAdjustment(pool, body, user) {
  const invoiceId = parseInt(body.InvoiceId, 10);
  if (!Number.isInteger(invoiceId)) throw new GstNoteError("Choose the invoice");
  const amount = r2(body.Amount);
  const reason = String(body.ReasonType || "");
  if (!REASONS.includes(reason)) throw new GstNoteError("Choose why the invoice is reduced");
  const remarks = String(body.Remarks || "").trim();
  if (!remarks) throw new GstNoteError("Describe the reduction (what changed and why)");
  const inv = await invoiceCreditable(pool, invoiceId);
  assertCreditable(inv, amount);
  const { gstAmount } = await getGstSplit(pool, inv.BookingId, amount);
  const rate = await rateFor(pool, inv.BookingId);
  const row = await pool.request()
    .input("b", sql.Int, inv.BookingId).input("c", sql.Int, inv.CustomerId ?? null).input("co", sql.Int, inv.CompanyId ?? null).input("pr", sql.Int, inv.ProjectId ?? null)
    .input("inv", sql.Int, inv.Id).input("m", sql.Int, inv.MilestoneId ?? null).input("ag", sql.NVarChar(400), inv.InvoiceNo).input("agd", sql.Date, inv.InvoiceDate)
    .input("tv", sql.Decimal(18, 2), r2(amount - gstAmount)).input("rate", sql.Decimal(9, 4), rate || null).input("g", sql.Decimal(18, 2), gstAmount).input("tot", sql.Decimal(18, 2), amount)
    .input("dl", sql.Date, inv.deadline).input("rt", sql.NVarChar(40), reason).input("rm", sql.NVarChar(500), remarks.slice(0, 500))
    .input("by", sql.NVarChar(200), user.email || null).input("uid", sql.Int, user.userId ?? null)
    .query(`INSERT INTO dbo.CrmGstNote (DocNo, DocType, Status, Source, RefundId, BookingId, CustomerId, CompanyId, ProjectId, InvoiceId, MilestoneId, AgainstRef, AgainstDate,
              DocDate, TaxableValue, GstRate, GstAmount, TotalAmount, DeadlineDate, ReasonType, Remarks, CreatedBy, ApprovalStatus, RequestedById, RequestedAt)
            OUTPUT INSERTED.Id
            VALUES (NULL, N'CreditNote', N'Draft', N'Adjustment', NULL, @b, @c, @co, @pr, @inv, @m, @ag, @agd,
              CAST(SYSDATETIME() AS DATE), @tv, @rate, @g, @tot, @dl, @rt, @rm, @by, N'Draft', @uid, SYSDATETIME())`);
  return load(pool, row.recordset[0].Id);
}

async function loadAdjustment(pool, id) {
  const n = await load(pool, id);
  if (!n) throw new GstNoteError("Credit note not found", 404);
  if (n.Source !== "Adjustment") throw new GstNoteError("This credit note comes from a refund — it is issued with the refund", 409);
  return n;
}

async function updateAdjustment(pool, id, body, user) {
  const n = await loadAdjustment(pool, id);
  if (!["Draft", "Rejected"].includes(n.Status)) throw new GstNoteError("It can only be changed before it is sent for approval (or after it is sent back)", 409);
  const amount = r2(body.Amount ?? n.TotalAmount);
  const reason = String(body.ReasonType ?? n.ReasonType);
  if (!REASONS.includes(reason)) throw new GstNoteError("Choose why the invoice is reduced");
  const remarks = String(body.Remarks ?? n.Remarks ?? "").trim();
  if (!remarks) throw new GstNoteError("Describe the reduction (what changed and why)");
  const inv = await invoiceCreditable(pool, n.InvoiceId);
  assertCreditable(inv, amount, { ignoreOpenRequests: true });
  const { gstAmount } = await getGstSplit(pool, n.BookingId, amount);
  await pool.request().input("id", sql.Int, id).input("tv", sql.Decimal(18, 2), r2(amount - gstAmount)).input("g", sql.Decimal(18, 2), gstAmount)
    .input("tot", sql.Decimal(18, 2), amount).input("rt", sql.NVarChar(40), reason).input("rm", sql.NVarChar(500), remarks.slice(0, 500))
    .query("UPDATE dbo.CrmGstNote SET TaxableValue = @tv, GstAmount = @g, TotalAmount = @tot, ReasonType = @rt, Remarks = @rm WHERE Id = @id");
  return load(pool, id);
}

async function submitAdjustment(pool, id, user) {
  const n = await loadAdjustment(pool, id);
  if (!["Draft", "Rejected"].includes(n.Status)) throw new GstNoteError("It is already with the approvers", 409);
  const inv = await invoiceCreditable(pool, n.InvoiceId);
  assertCreditable(inv, Number(n.TotalAmount), { ignoreOpenRequests: true });
  const { transition } = require("./approvalService");
  await transition("crm-credit-notes", id, "Pending", user.email, user.role, null, user.userId);
  await pool.request().input("id", sql.Int, id).query("UPDATE dbo.CrmGstNote SET Status = N'Pending', RejectionNote = NULL WHERE Id = @id");
  return load(pool, id);
}

async function decideAdjustment(pool, id, approve, note, user) {
  const n = await loadAdjustment(pool, id);
  if (n.Status !== "Pending") throw new GstNoteError("It isn't waiting for approval", 409);
  if (!approve && !String(note || "").trim()) throw new GstNoteError("Say what needs fixing");
  if (approve) {
    // Refuse before the approval is recorded if it can no longer be applied.
    const inv = await invoiceCreditable(pool, n.InvoiceId);
    assertCreditable(inv, Number(n.TotalAmount), { ignoreOpenRequests: true });
  }
  const { transition } = require("./approvalService");
  const r = await transition("crm-credit-notes", id, approve ? "Approved" : "Rejected", user.email, user.role, note || null, user.userId);
  if (r.newStatus === "Rejected") {
    await pool.request().input("id", sql.Int, id).input("n", sql.NVarChar(500), note)
      .query("UPDATE dbo.CrmGstNote SET Status = N'Rejected', RejectionNote = @n WHERE Id = @id");
  } else if (r.newStatus === "Approved") {
    await applyAdjustment(pool, id, user);
  }
  return { status: r.newStatus, note: await load(pool, id) };
}

/** The approved reduction takes effect. */
async function applyAdjustment(pool, id, user) {
  const { getNextDocNumber } = require("./docNumber");
  const docNo = await getNextDocNumber(pool, "CRN", "CRN");
  const tx = new sql.Transaction(pool);
  await tx.begin();
  let moved = 0, onAccountId = null, n, dueReducedBy = null;
  try {
    n = (await tx.request().input("id", sql.Int, id).query("SELECT * FROM dbo.CrmGstNote WITH (UPDLOCK) WHERE Id = @id")).recordset[0];
    const amount = r2(n.TotalAmount);
    await tx.request().input("b", sql.Int, n.BookingId).input("t", sql.Decimal(18, 2), amount).input("g", sql.Decimal(18, 2), r2(n.GstAmount))
      .query("UPDATE dbo.CrmBooking SET CreditNoteTotal = ISNULL(CreditNoteTotal, 0) + @t, CreditNoteGst = ISNULL(CreditNoteGst, 0) + @g, UpdatedAt = SYSDATETIME() WHERE Id = @b");
    if (n.MilestoneId) {
      const m = (await tx.request().input("m", sql.Int, n.MilestoneId)
        .query("SELECT Id, AmountDue, AmountPaid, MilestoneName FROM dbo.CrmPaymentMilestone WITH (UPDLOCK) WHERE Id = @m")).recordset[0];
      if (m) {
        const newDue = r2(Math.max(0, Number(m.AmountDue) - amount));
        dueReducedBy = r2(Number(m.AmountDue) - newDue);
        moved = r2(Math.max(0, Number(m.AmountPaid || 0) - newDue));
        if (moved > 0) {
          // The milestone's paid figure is the sum of its receipts: an
          // offsetting line moves the extra off it, onto the account.
          await tx.request().input("no", sql.NVarChar(30), docNo).input("m", sql.Int, m.Id).input("amt", sql.Decimal(18, 2), -moved)
            .input("by", sql.Int, user.userId ?? null).input("note", sql.NVarChar(200), `Moved to the customer's account by credit note ${docNo}`)
            .query(`INSERT INTO dbo.CrmPaymentReceipt (ReceiptNo, MilestoneId, Amount, BaseAmount, GSTAmount, ReceivedDate, PaymentMode, Notes, CreatedBy, CreatedAt)
                    VALUES (@no, @m, @amt, @amt, 0, CAST(SYSDATETIME() AS DATE), N'CreditNote', @note, @by, SYSDATETIME())`);
          const oa = await tx.request().input("no", sql.NVarChar(30), docNo).input("b", sql.Int, n.BookingId).input("amt", sql.Decimal(18, 2), moved).input("by", sql.Int, user.userId ?? null)
            .input("note", sql.NVarChar(500), `Credit from credit note ${docNo} (${m.MilestoneName || "milestone"} reduced) — use on later milestones or refund it from Refunds.`)
            .query(`INSERT INTO dbo.CrmOnAccountPayment (ReceiptNo, BookingId, Amount, AppliedAmount, Status, ReceivedDate, PaymentMode, Notes, CreatedBy, CreatedAt)
                    OUTPUT INSERTED.Id VALUES (@no, @b, @amt, 0, N'Unapplied', CAST(SYSDATETIME() AS DATE), N'CreditNote', @note, @by, SYSDATETIME())`);
          onAccountId = oa.recordset[0].Id;
        }
        await tx.request().input("m", sql.Int, m.Id).input("due", sql.Decimal(18, 2), newDue).query(`
          UPDATE dbo.CrmPaymentMilestone SET AmountDue = @due,
            AmountPaid = (SELECT ISNULL(SUM(Amount), 0) FROM dbo.CrmPaymentReceipt WHERE MilestoneId = @m),
            Status = CASE WHEN (SELECT ISNULL(SUM(Amount), 0) FROM dbo.CrmPaymentReceipt WHERE MilestoneId = @m) >= @due THEN N'Paid' ELSE Status END,
            DemandStatus = CASE WHEN DemandStatus IS NOT NULL AND (SELECT ISNULL(SUM(Amount), 0) FROM dbo.CrmPaymentReceipt WHERE MilestoneId = @m) >= @due THEN N'Paid' ELSE DemandStatus END,
            UpdatedAt = SYSDATETIME()
          WHERE Id = @m`);
      }
    }
    await tx.request().input("id", sql.Int, id).input("no", sql.NVarChar(16), docNo).input("mv", sql.Decimal(18, 2), moved || null).input("oa", sql.Int, onAccountId)
      .input("dr", sql.Decimal(18, 2), dueReducedBy)
      .query(`UPDATE dbo.CrmGstNote SET DocNo = @no, Status = N'Issued', ApprovedAt = SYSDATETIME(), DocDate = CAST(SYSDATETIME() AS DATE),
                MovedToAccount = @mv, OnAccountId = @oa, DueReducedBy = @dr WHERE Id = @id`);
    await tx.commit();
  } catch (e) {
    try { await tx.rollback(); } catch { /* rolled back */ }
    // The approval stands but nothing changed: back to Pending to approve again.
    await pool.request().input("id", sql.Int, id).input("n", sql.NVarChar(500), `Not applied: ${e.message}`.slice(0, 500))
      .query("UPDATE dbo.CrmGstNote SET ApprovalStatus = N'Pending', RejectionNote = @n WHERE Id = @id");
    throw e;
  }
  // After commit — each step is idempotent and never undoes the credit note.
  try { await require("./crmGst").recalculateBookingGst(pool, n.BookingId); } catch (e) { console.error(`[credit-note ${docNo}] booking recalc:`, e.message); }
  try { await postAdjustmentToGL(pool, id, user.email); } catch (e) { console.error(`[credit-note ${docNo}] ledger:`, e.message); }
  if (onAccountId) {
    try { await onAccountLedger(pool, n, onAccountId, moved, docNo, "CREDIT", user.email); } catch (e) { console.error(`[credit-note ${docNo}] on-account ledger:`, e.message); }
  }
}

/** The customer's on-account balance (Finance's OnAccountLedger), same shape as a deposit. */
async function onAccountLedger(pool, n, onAccountId, amount, docNo, type, userEmail) {
  const { ensureCrmCustomerLedgerHead } = require("./crmLedger");
  const head = await ensureCrmCustomerLedgerHead(pool, n.CustomerId, userEmail);
  await pool.request().input("PartyId", sql.Int, head).input("TxnType", sql.NVarChar(10), type).input("Amount", sql.Decimal(18, 2), amount)
    .input("RefDocNo", sql.NVarChar(100), docNo).input("RefId", sql.Int, onAccountId).input("CompanyId", sql.Int, n.CompanyId ?? null).input("ProjectId", sql.Int, n.ProjectId ?? null)
    .input("Notes", sql.NVarChar(500), type === "CREDIT" ? `Credit from credit note ${docNo}` : `Credit note ${docNo} cancelled — credit withdrawn`).input("CreatedBy", sql.NVarChar(150), userEmail || null)
    .query(`INSERT INTO dbo.OnAccountLedger (PartyId,PartyType,TxnDate,TxnType,Amount,RefType,RefDocNo,RefId,CompanyId,ProjectId,Notes,CreatedBy)
            VALUES (@PartyId, N'Customer', CAST(SYSDATETIME() AS DATE), @TxnType, @Amount, N'CrmOnAccountPayment', @RefDocNo, @RefId, @CompanyId, @ProjectId, @Notes, @CreatedBy);
            UPDATE dbo.AccountHeadMaster SET OnAccountBalance = OnAccountBalance ${type === "CREDIT" ? "+" : "-"} @Amount WHERE LHeadId = @PartyId;`);
}

/**
 * The invoice's income back to Advance from Customer, in the same heads and
 * proportion it was booked (land / construction / villa): a scaled mirror of
 * the invoice's own voucher. Idempotent.
 */
async function postAdjustmentToGL(pool, id, userEmail) {
  const { hasPosting, postVoucher } = require("./generalLedger");
  if (await hasPosting(pool, "CrmGstNote", id)) return { posted: true, reason: "already posted" };
  const n = await load(pool, id);
  const legs = (await pool.request().input("i", sql.Int, n.InvoiceId).query(`
    SELECT LHeadId, SUM(DebitAmount) AS Dr, SUM(CreditAmount) AS Cr FROM dbo.GeneralLedgerEntry
    WHERE SourceType = 'CrmInvoice' AND SourceId = @i AND IsReversed = 0 GROUP BY LHeadId`)).recordset;
  const invBase = legs.reduce((s, l) => s + Number(l.Dr || 0), 0);
  if (!(invBase > 0)) return { none: true, reason: "the invoice has no ledger posting to mirror" };
  const factor = Math.min(1, Number(n.TaxableValue) / invBase);
  const out = legs.map((l) => ({ lHeadId: l.LHeadId, debit: r2(Number(l.Cr || 0) * factor), credit: r2(Number(l.Dr || 0) * factor) }));
  const dr = out.reduce((s, l) => s + l.debit, 0), cr = out.reduce((s, l) => s + l.credit, 0);
  const fix = r2(dr - cr);
  if (fix !== 0) { const big = out.reduce((a, b) => (b.credit > a.credit ? b : a)); big.credit = r2(big.credit + fix); }
  await postVoucher(pool, {
    voucherNo: n.DocNo, voucherDate: n.DocDate, sourceType: "CrmGstNote", sourceId: id,
    companyId: n.CompanyId ?? null, projectId: n.ProjectId ?? null, createdBy: userEmail,
    legs: out.filter((l) => l.debit > 0 || l.credit > 0).map((l) => ({ ...l, narration: `${n.DocNo} — credit note on ${n.AgainstRef}: sale value reduced, back to advance` })),
  });
  return { posted: true };
}

// ── Cancelling a credit note: a second person approves ('crm-credit-note-cancel')
async function requestCancel(pool, id, reason, user) {
  const n = await load(pool, id);
  if (!n) throw new GstNoteError("Credit note not found", 404);
  if (!["Issued", "TimeBarred"].includes(n.Status)) throw new GstNoteError(n.Status === "Cancelled" ? "It is already cancelled" : "Only an issued credit note can be cancelled", 409);
  if (n.CancelApprovalStatus === "Pending") throw new GstNoteError("Its cancellation is already waiting for approval", 409);
  if (!String(reason || "").trim()) throw new GstNoteError("Say why it is being cancelled");
  if (n.Source === "Adjustment") await assertAdjustmentReversible(pool, n);
  await pool.request().input("id", sql.Int, id).input("why", sql.NVarChar(500), String(reason).trim().slice(0, 500)).input("uid", sql.Int, user.userId ?? null)
    .query("UPDATE dbo.CrmGstNote SET CancelApprovalStatus = N'Draft', CancelRequestedById = @uid, CancelRequestedAt = SYSDATETIME(), CancelRequestReason = @why WHERE Id = @id");
  const { transition } = require("./approvalService");
  await transition("crm-credit-note-cancel", id, "Pending", user.email, user.role, null, user.userId);
  return load(pool, id);
}

/** An adjustment can be undone only while the credit it gave is untouched. */
async function assertAdjustmentReversible(pool, n) {
  if (!n.OnAccountId) return;
  const oa = (await pool.request().input("o", sql.Int, n.OnAccountId)
    .query("SELECT Amount, AppliedAmount, Status FROM dbo.CrmOnAccountPayment WHERE Id = @o")).recordset[0];
  const claimed = (await pool.request().input("o", sql.Int, n.OnAccountId)
    .query("SELECT TOP 1 RefundNo FROM dbo.CrmRefund WHERE SourceOnAccountId = @o AND Status NOT IN (N'Rejected', N'Cancelled')")).recordset[0];
  if (claimed) throw new GstNoteError(`Its credit is being refunded (${claimed.RefundNo}) — it can't be cancelled`, 409);
  if (!oa || Number(oa.AppliedAmount || 0) > 0.005) throw new GstNoteError("Its credit has already been used on a milestone — it can't be cancelled; raise a new invoice instead", 409);
}

async function decideCancel(pool, id, approve, note, user) {
  const n = await load(pool, id);
  if (!n) throw new GstNoteError("Credit note not found", 404);
  if (n.CancelApprovalStatus !== "Pending") throw new GstNoteError("No cancellation is waiting for approval", 409);
  if (!approve && !String(note || "").trim()) throw new GstNoteError("Say why it stays");
  if (approve && n.Source === "Adjustment") await assertAdjustmentReversible(pool, n);
  const { transition } = require("./approvalService");
  const r = await transition("crm-credit-note-cancel", id, approve ? "Approved" : "Rejected", user.email, user.role, note || null, user.userId);
  if (r.newStatus === "Approved") {
    if (n.Source === "Adjustment") await reverseAdjustment(pool, n, user);
    await cancel(pool, id, n.CancelRequestReason, user.email);
  }
  return { status: r.newStatus, note: await load(pool, id) };
}

/** Undo an approved adjustment: booking, milestone, account credit and ledger back as before. */
async function reverseAdjustment(pool, n, user) {
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    await tx.request().input("b", sql.Int, n.BookingId).input("t", sql.Decimal(18, 2), r2(n.TotalAmount)).input("g", sql.Decimal(18, 2), r2(n.GstAmount))
      .query("UPDATE dbo.CrmBooking SET CreditNoteTotal = ISNULL(CreditNoteTotal, 0) - @t, CreditNoteGst = ISNULL(CreditNoteGst, 0) - @g, UpdatedAt = SYSDATETIME() WHERE Id = @b");
    if (n.MilestoneId) {
      if (Number(n.MovedToAccount) > 0) {
        await tx.request().input("no", sql.NVarChar(30), n.DocNo).input("m", sql.Int, n.MilestoneId).input("amt", sql.Decimal(18, 2), r2(n.MovedToAccount))
          .input("by", sql.Int, user.userId ?? null).input("note", sql.NVarChar(200), `Credit note ${n.DocNo} cancelled — money back on this milestone`)
          .query(`INSERT INTO dbo.CrmPaymentReceipt (ReceiptNo, MilestoneId, Amount, BaseAmount, GSTAmount, ReceivedDate, PaymentMode, Notes, CreatedBy, CreatedAt)
                  VALUES (@no, @m, @amt, @amt, 0, CAST(SYSDATETIME() AS DATE), N'CreditNote', @note, @by, SYSDATETIME())`);
        await tx.request().input("o", sql.Int, n.OnAccountId).input("no", sql.NVarChar(30), n.DocNo)
          .query("UPDATE dbo.CrmOnAccountPayment SET AppliedAmount = Amount, Status = N'Applied', Notes = ISNULL(Notes, '') + CHAR(10) + N'Withdrawn: credit note ' + @no + N' cancelled.' WHERE Id = @o");
      }
      // Put back what really came off (it never went below zero), not the
      // whole note - older notes have no record of it and keep the total.
      const putBack = n.DueReducedBy != null ? r2(n.DueReducedBy) : r2(n.TotalAmount);
      await tx.request().input("m", sql.Int, n.MilestoneId).input("t", sql.Decimal(18, 2), putBack).query(`
        UPDATE dbo.CrmPaymentMilestone SET AmountDue = AmountDue + @t,
          AmountPaid = (SELECT ISNULL(SUM(Amount), 0) FROM dbo.CrmPaymentReceipt WHERE MilestoneId = @m),
          Status = CASE WHEN (SELECT ISNULL(SUM(Amount), 0) FROM dbo.CrmPaymentReceipt WHERE MilestoneId = @m) >= AmountDue + @t THEN N'Paid'
                        WHEN Status = N'Paid' THEN N'Pending' ELSE Status END,
          UpdatedAt = SYSDATETIME()
        WHERE Id = @m`);
    }
    await tx.commit();
  } catch (e) { try { await tx.rollback(); } catch { /* rolled back */ } throw e; }
  try { await require("./crmGst").recalculateBookingGst(pool, n.BookingId); } catch (e) { console.error(`[credit-note ${n.DocNo}] recalc on cancel:`, e.message); }
  try { await require("./generalLedger").reversePostingBySource(pool, "CrmGstNote", n.Id); } catch (e) { console.error(`[credit-note ${n.DocNo}] ledger reversal:`, e.message); }
  if (n.OnAccountId && Number(n.MovedToAccount) > 0) {
    try { await onAccountLedger(pool, n, n.OnAccountId, r2(n.MovedToAccount), n.DocNo, "DEBIT", user.email); } catch (e) { console.error(`[credit-note ${n.DocNo}] on-account ledger on cancel:`, e.message); }
  }
}

/** Invoices on a booking that can still take a credit note (for the raise form). */
async function creditableInvoices(pool, { search = "", projectScope = null } = {}) {
  const t = String(search || "").trim();
  const req = pool.request().input("q", sql.NVarChar(200), `%${t}%`);
  const scope = projectScope ? ` AND ${require("./projectScope").projectPredicate(projectScope, "b.ProjectId", "").trim()}` : "";
  const rows = (await req.query(`
    SELECT TOP 60 i.Id, i.InvoiceNo, i.InvoiceDate, i.InvoiceType, i.Amount, b.BookingNo, ISNULL(b.UnitNo, b.BookingNo) AS Property, c.CustomerName,
           i.Amount - ISNULL((SELECT SUM(n.TotalAmount) FROM dbo.CrmGstNote n WHERE n.InvoiceId = i.Id AND n.Status IN (N'Issued', N'TimeBarred')), 0) AS OpenAmount,
           -- For the raise form's preview: the booking's value and GST share, and the milestone's paid figure.
           b.GrandTotal AS BookingTotal, ISNULL(b.TotalGstAmount, 0) AS BookingGst, ISNULL(b.UnitParkingGstRate, 0) AS GstRate,
           m.MilestoneName, m.AmountDue AS MilestoneDue, m.AmountPaid AS MilestonePaid, proj.name AS ProjectName
    FROM dbo.CrmInvoice i JOIN dbo.CrmBooking b ON b.Id = i.BookingId
    JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId LEFT JOIN dbo.CrmCustomer c ON c.Id = a.CustomerId
    LEFT JOIN dbo.CrmPaymentMilestone m ON m.Id = i.MilestoneId
    LEFT JOIN dbo.enterprise proj ON proj.id = b.ProjectId AND proj.business_type = 'P'
    WHERE i.Status <> N'Void' AND i.InvoiceType IN (N'Milestone', N'Booking', N'Final') AND b.IsActive = 1
      AND b.Status NOT IN (N'Cancelled', N'Rejected', N'Expired', N'Transferred')${scope}
      ${t ? "AND (i.InvoiceNo LIKE @q OR b.BookingNo LIKE @q OR b.UnitNo LIKE @q OR c.CustomerName LIKE @q)" : ""}
    ORDER BY i.InvoiceDate DESC, i.Id DESC`)).recordset;
  return rows.map((r) => ({ ...r, Open: r2(r.OpenAmount), Deadline: creditNoteDeadline(r.InvoiceDate) }))
    .filter((r) => r.Open > 0.005 && iso(new Date()) <= r.Deadline);
}

module.exports = {
  issueForRefund, reissue, cancel, pending, list, load, renderPdf, creditNoteDeadline, formatSac, GstNoteError,
  createAdjustment, updateAdjustment, submitAdjustment, decideAdjustment, requestCancel, decideCancel, creditableInvoices, invoiceCreditable, REASONS,
};
