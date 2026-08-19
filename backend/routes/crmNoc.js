const express = require("express");
const router = express.Router();
const apiRateLimit = require("../middleware/apiRateLimit");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId, requireUserEmail } = require("../services/saAccess");
const { getNextDocNumber } = require("../services/docNumber");
// Approve/reject is gated to admin/super_admin/marketing_head via this shared
// engine — same mechanism BOQ/Purchase Orders/etc. use — instead of any
// editor being able to self-approve a NOC on this page.
const { transition: approvalTransition } = require("../services/approvalService");
const { requireActiveBooking } = require("../services/crmWorkflowGuards");

router.use(authMiddleware);
router.use(apiRateLimit);

const NOC_TYPES = ["Organisation", "Bank"];

const NOC_SELECT = `
  SELECT n.*, b.BookingNo, b.UnitNo, a.ApplicantName, a.Mobile
  FROM dbo.CrmNoc n
  JOIN dbo.CrmBooking b ON b.Id = n.BookingId
  JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
`;

// GET / — all NOCs
router.get("/", requirePageRight("crm-noc", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const { type, status } = req.query;
    const req0 = pool.request();
    const conds = [];
    if (type)   { req0.input("t",  sql.NVarChar(30), type);   conds.push("n.NocType = @t"); }
    if (status) { req0.input("st", sql.NVarChar(30), status); conds.push("n.Status = @st"); }
    const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
    const result = await req0.query(`${NOC_SELECT} ${where} ORDER BY n.CreatedAt DESC`);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-noc] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /booking/:bookingId/context — everything the "Request NOC" dialog
// needs the instant a booking is picked, so staff see the real gate
// (Agreement must exist) and every field the form can be pre-filled from
// *before* filling the form, instead of typing everything and only finding
// out it's rejected on submit.
router.get("/booking/:bookingId/context", requirePageRight("crm-noc", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const bookingId = parseInt(req.params.bookingId);

    const booking = await pool.request().input("bid", sql.Int, bookingId).query(`
      SELECT b.Id, b.BookingNo, b.UnitNo, a.ApplicantName, a.Mobile,
             ISNULL(b.GrandTotal, b.TotalValue) AS GrandTotal
      FROM dbo.CrmBooking b JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      WHERE b.Id = @bid
    `);
    if (!booking.recordset.length) return res.status(404).json({ error: "Booking not found" });

    const agreement = await pool.request().input("bid", sql.Int, bookingId)
      .query("SELECT TOP 1 Id, AgreementNo, Status FROM dbo.CrmAgreement WHERE BookingId = @bid ORDER BY CreatedAt DESC");

    const existingNocs = await pool.request().input("bid", sql.Int, bookingId)
      .query("SELECT Id, NocNo, NocType, Status FROM dbo.CrmNoc WHERE BookingId = @bid ORDER BY CreatedAt DESC");

    // The customer's own bank account on file (KYC/Welcome Call) — kept in
    // the response for reference/display only. It is NOT the pre-fill source
    // for a Bank NOC's lender fields below — that was the bug: a Bank NOC
    // exists for the LENDING bank, and the customer's personal KYC account is
    // a different bank entirely more often than not.
    const bankDetail = await pool.request().input("bid", sql.Int, bookingId)
      .query("SELECT BankName, AccountNo, IfscCode FROM dbo.CrmCustomerBankDetail WHERE BookingId = @bid");

    // The actual lender record (Home Loan Tracking) — real BankName/
    // LoanAccountNo/LoanAmount the bank itself sanctioned, not a guess. Null
    // when no loan has been recorded yet; the frontend leaves the Bank NOC
    // fields blank in that case rather than falling back to a wrong source.
    const loanDetail = await pool.request().input("bid", sql.Int, bookingId)
      .query("SELECT BankName, LoanAccountNo, LoanAmount, SanctionStatus FROM dbo.CrmLoanDetail WHERE BookingId = @bid");

    res.json({
      booking: booking.recordset[0],
      agreement: agreement.recordset[0] || null,
      existingNocs: existingNocs.recordset,
      customerBankDetail: bankDetail.recordset[0] || null,
      loanDetail: loanDetail.recordset[0] || null,
    });
  } catch (e) {
    console.error("[crm-noc] GET /booking/:id/context error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST / — request a NOC. Gated on an Agreement existing for the booking —
// deliberately not a stricter "Executed" gate: a Bank NOC (loan clearance/
// disbursement condition) can legitimately need to be requested while the
// agreement is still being finalized, unlike Org NOC which typically comes
// later. Both need the transaction (the agreement) to exist to reference,
// which is the one threshold true for both types without guessing at
// exactly when each is supposed to fire.
router.post("/", requirePageRight("crm-noc", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    if (!b.BookingId) return res.status(400).json({ error: "BookingId is required" });
    const bookingId = parseInt(b.BookingId);

    const activeErr = await requireActiveBooking(pool, bookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });

    const agr = await pool.request().input("bid", sql.Int, bookingId)
      .query("SELECT Id FROM dbo.CrmAgreement WHERE BookingId = @bid");
    if (!agr.recordset.length) {
      return res.status(400).json({ error: "NOC requires an agreement to exist for this booking first" });
    }

    const nocType = NOC_TYPES.includes(b.NocType) ? b.NocType : "Organisation";

    // Sales Deed must come before Bank NOC — a Bank NOC releases the
    // lending bank's charge against the unit, which only makes sense once
    // the deed itself exists. Org NOC has no such dependency.
    if (nocType === "Bank") {
      const deed = await pool.request().input("bid", sql.Int, bookingId)
        .query("SELECT Id FROM dbo.CrmSalesDeed WHERE BookingId = @bid");
      if (!deed.recordset.length) {
        return res.status(400).json({ error: "A Bank NOC requires the Sales Deed to exist for this booking first" });
      }
    }
    const nocNo = await getNextDocNumber(pool, "NOC", "NOC");

    const result = await pool.request()
      .input("no",   sql.NVarChar(30),  nocNo)
      .input("bid",  sql.Int,           parseInt(b.BookingId))
      .input("type", sql.NVarChar(30),  nocType)
      .input("dt",   sql.Date,          b.NocDate || null)
      .input("reason", sql.NVarChar(500), b.Reason || null)
      .input("bank", sql.NVarChar(255), b.BankName || null)
      .input("acc",  sql.NVarChar(100), b.LoanAccountNo || null)
      .input("lamt", sql.Decimal(18,2), b.LoanAmount != null ? parseFloat(b.LoanAmount) : null)
      .input("note", sql.NVarChar(sql.MAX), b.Notes || null)
      .input("cb",   sql.Int,           actorId(req))
      .query(`
        INSERT INTO dbo.CrmNoc
          (NocNo, BookingId, NocType, NocDate, Reason, BankName, LoanAccountNo, LoanAmount, Status, Notes, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@no, @bid, @type, @dt, @reason, @bank, @acc, @lamt, 'Pending', @note, @cb, SYSDATETIME())
      `);
    res.status(201).json({ success: true, id: result.recordset[0].Id, NocNo: nocNo });
  } catch (e) {
    console.error("[crm-noc] POST error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id — update bank loan tracking fields/notes only. Status is never
// settable here — Approved/Rejected go through the endpoints below, Issued
// through /:id/mark-issued.
router.put("/:id", requirePageRight("crm-noc", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    const id = parseInt(req.params.id);

    const cur0 = await pool.request().input("id", sql.Int, id).query("SELECT BookingId FROM dbo.CrmNoc WHERE Id = @id");
    if (!cur0.recordset.length) return res.status(404).json({ error: "NOC not found" });
    const activeErr0 = await requireActiveBooking(pool, cur0.recordset[0].BookingId);
    if (activeErr0) return res.status(400).json({ error: activeErr0 });

    await pool.request()
      .input("id",    sql.Int,  id)
      .input("lss",   sql.NVarChar(50),  b.LoanSanctionStatus || null)
      .input("lsd",   sql.Date, b.LoanSanctionDate || null)
      .input("lds",   sql.NVarChar(50),  b.LoanDisbursementStatus || null)
      .input("ldd",   sql.Date, b.LoanDisbursementDate || null)
      .input("note",  sql.NVarChar(sql.MAX), b.Notes || null)
      .input("ub",    sql.Int,  actorId(req))
      .query(`
        UPDATE dbo.CrmNoc SET
          LoanSanctionStatus = ISNULL(@lss, LoanSanctionStatus), LoanSanctionDate = ISNULL(@lsd, LoanSanctionDate),
          LoanDisbursementStatus = ISNULL(@lds, LoanDisbursementStatus), LoanDisbursementDate = ISNULL(@ldd, LoanDisbursementDate),
          Notes = @note, UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-noc] PUT error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id/submit — Rejected -> Pending (resubmit)
router.put("/:id/submit", requirePageRight("crm-noc", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const pool0 = getPool();
    const cur0 = await pool0.request().input("id", sql.Int, id).query("SELECT BookingId FROM dbo.CrmNoc WHERE Id = @id");
    if (!cur0.recordset.length) return res.status(404).json({ error: "NOC not found" });
    const activeErr0 = await requireActiveBooking(pool0, cur0.recordset[0].BookingId);
    if (activeErr0) return res.status(400).json({ error: activeErr0 });

    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;
    const result = await approvalTransition("crm-noc", id, "Pending", userEmail, req.user?.role);
    res.json({ success: true, status: result.newStatus });
  } catch (e) {
    console.error("[crm-noc] submit error:", e.message);
    res.status(e.status || 400).json({ error: e.message });
  }
});

// PUT /:id/approve — admin/super_admin/marketing_head only, enforced inside
// approvalTransition().
router.put("/:id/approve", requirePageRight("crm-noc", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const pool0 = getPool();
    const cur0 = await pool0.request().input("id", sql.Int, id).query("SELECT BookingId FROM dbo.CrmNoc WHERE Id = @id");
    if (!cur0.recordset.length) return res.status(404).json({ error: "NOC not found" });
    const activeErr0 = await requireActiveBooking(pool0, cur0.recordset[0].BookingId);
    if (activeErr0) return res.status(400).json({ error: activeErr0 });

    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;
    const result = await approvalTransition("crm-noc", id, "Approved", userEmail, req.user?.role);
    await getPool().request()
      .input("id", sql.Int, id)
      .query("UPDATE dbo.CrmNoc SET ApprovalDate = ISNULL(ApprovalDate, CAST(SYSDATETIME() AS DATE)) WHERE Id = @id");
    res.json({ success: true, status: result.newStatus });
  } catch (e) {
    console.error("[crm-noc] approve error:", e.message);
    res.status(e.status || (e.message.includes("not authorized") ? 403 : 400)).json({ error: e.message });
  }
});

// PUT /:id/reject — admin/super_admin/marketing_head only.
router.put("/:id/reject", requirePageRight("crm-noc", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const pool0 = getPool();
    const cur0 = await pool0.request().input("id", sql.Int, id).query("SELECT BookingId FROM dbo.CrmNoc WHERE Id = @id");
    if (!cur0.recordset.length) return res.status(404).json({ error: "NOC not found" });
    const activeErr0 = await requireActiveBooking(pool0, cur0.recordset[0].BookingId);
    if (activeErr0) return res.status(400).json({ error: activeErr0 });

    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;
    const result = await approvalTransition("crm-noc", id, "Rejected", userEmail, req.user?.role, req.body?.note || null);
    res.json({ success: true, status: result.newStatus });
  } catch (e) {
    console.error("[crm-noc] reject error:", e.message);
    res.status(e.status || (e.message.includes("not authorized") ? 403 : 400)).json({ error: e.message });
  }
});

// PUT /:id/mark-issued — a business action (recording physical issuance),
// not an approval decision — any editor can do this once Approved.
router.put("/:id/mark-issued", requirePageRight("crm-noc", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);

    const cur = await pool.request().input("id", sql.Int, id).query("SELECT Status, BookingId FROM dbo.CrmNoc WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "NOC not found" });
    const activeErr = await requireActiveBooking(pool, cur.recordset[0].BookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });
    if (cur.recordset[0].Status !== "Approved") {
      return res.status(400).json({ error: `Cannot mark issued — NOC must be Approved (currently '${cur.recordset[0].Status}')` });
    }

    await pool.request().input("id", sql.Int, id)
      .query("UPDATE dbo.CrmNoc SET Status = 'Issued', IssuedDate = CAST(SYSDATETIME() AS DATE), UpdatedAt = SYSDATETIME() WHERE Id = @id");
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-noc] mark-issued error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
