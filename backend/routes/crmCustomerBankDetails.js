const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId } = require("../services/saAccess");
const { maybeAutoCreateAgreement, requireActiveBooking } = require("../services/crmWorkflowGuards");

router.use(authMiddleware);
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));

// GET / — every Approved booking with its live KYC-completeness status, so
// the list page can group by Pending/Complete without a per-row fetch.
// A booking with no CrmCustomerBankDetail row at all is naturally "Pending"
// via the LEFT JOIN (every completeness column is NULL).
router.get("/", requirePageRight("crm-customer-bank-details", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT
        b.Id AS BookingId, b.BookingNo, b.ProjectName, b.UnitNo, b.Status AS BookingStatus,
        a.ApplicantName, a.Mobile,
        wc.Outcome AS LastCallOutcome,
        CASE WHEN
          NULLIF(LTRIM(RTRIM(ISNULL(d.BankName, ''))), '') IS NOT NULL AND
          NULLIF(LTRIM(RTRIM(ISNULL(d.AccountNo, ''))), '') IS NOT NULL AND
          NULLIF(LTRIM(RTRIM(ISNULL(d.IfscCode, ''))), '') IS NOT NULL AND
          NULLIF(LTRIM(RTRIM(ISNULL(d.AccountHolderName, ''))), '') IS NOT NULL AND
          NULLIF(LTRIM(RTRIM(ISNULL(d.NomineeName, ''))), '') IS NOT NULL AND
          NULLIF(LTRIM(RTRIM(ISNULL(d.NomineeRelation, ''))), '') IS NOT NULL AND
          NULLIF(LTRIM(RTRIM(ISNULL(d.PanNo, ''))), '') IS NOT NULL AND
          NULLIF(LTRIM(RTRIM(ISNULL(d.AadhaarNo, ''))), '') IS NOT NULL AND
          NULLIF(LTRIM(RTRIM(ISNULL(d.Occupation, ''))), '') IS NOT NULL
        THEN CAST(1 AS BIT) ELSE CAST(0 AS BIT) END AS IsComplete
      FROM dbo.CrmBooking b
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      LEFT JOIN dbo.CrmCustomerBankDetail d ON d.BookingId = b.Id
      OUTER APPLY (
        SELECT TOP 1 Outcome FROM dbo.CrmWelcomeCall WHERE BookingId = b.Id ORDER BY CallDate DESC, CreatedAt DESC
      ) wc
      WHERE b.IsActive = 1 AND b.Status = 'Approved'
      ORDER BY b.CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-customer-bank-details] GET / error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.get("/booking/:bookingId", requirePageRight("crm-customer-bank-details", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const bid = parseInt(req.params.bookingId);
    const result = await pool.request().input("bid", sql.Int, bid)
      .query("SELECT * FROM dbo.CrmCustomerBankDetail WHERE BookingId = @bid");
    if (result.recordset.length) return res.json(result.recordset[0]);

    // No bank-detail row saved yet — PAN and the account holder's name are
    // already on file at Customer intake (dbo.CrmCustomer), so pre-fill them
    // here instead of making staff retype a PAN the system already has.
    // Everything else (bank/nominee/Aadhaar/occupation) is genuinely new
    // information this form is the first place to capture, so it stays blank.
    const prefill = await pool.request().input("bid", sql.Int, bid).query(`
      SELECT c.PanNo, c.CustomerName AS AccountHolderName
      FROM dbo.CrmBooking b
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      JOIN dbo.CrmCustomer c ON c.Id = a.CustomerId
      WHERE b.Id = @bid
    `);
    if (!prefill.recordset.length) return res.json(null);
    res.json({ PanNo: prefill.recordset[0].PanNo || null, AccountHolderName: prefill.recordset[0].AccountHolderName || null });
  } catch (e) {
    console.error("[crm-customer-bank-details] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.put("/booking/:bookingId", requirePageRight("crm-customer-bank-details", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const bid = parseInt(req.params.bookingId);
    const b = req.body;
    const actor = actorId(req);

    const activeErr = await requireActiveBooking(pool, bid);
    if (activeErr) return res.status(400).json({ error: activeErr });

    const existing = await pool.request().input("bid", sql.Int, bid).query("SELECT Id FROM dbo.CrmCustomerBankDetail WHERE BookingId = @bid");

    const fields = {
      bank: b.BankName || null, branch: b.BranchName || null, acc: b.AccountNo || null, ifsc: b.IfscCode || null,
      holder: b.AccountHolderName || null, nname: b.NomineeName || null, nrel: b.NomineeRelation || null,
      ndob: b.NomineeDob || null, ncon: b.NomineeContact || null, naddr: b.NomineeAddress || null,
      pan: b.PanNo || null, aadh: b.AadhaarNo || null,
      occ: b.Occupation || null, inc: b.AnnualIncome != null && b.AnnualIncome !== "" ? parseFloat(b.AnnualIncome) : null,
      cheque: b.ChequeNo || null, chqdate: b.ChequeDate || null, tref: b.TransactionRef || null,
      notes: b.Notes || null,
    };

    if (existing.recordset.length) {
      await pool.request()
        .input("bid", sql.Int, bid)
        .input("bank", sql.NVarChar(200), fields.bank).input("branch", sql.NVarChar(200), fields.branch)
        .input("acc", sql.NVarChar(50), fields.acc).input("ifsc", sql.NVarChar(20), fields.ifsc)
        .input("holder", sql.NVarChar(200), fields.holder).input("nname", sql.NVarChar(200), fields.nname)
        .input("nrel", sql.NVarChar(50), fields.nrel).input("ndob", sql.Date, fields.ndob)
        .input("ncon", sql.NVarChar(20), fields.ncon).input("naddr", sql.NVarChar(500), fields.naddr)
        .input("pan", sql.NVarChar(20), fields.pan).input("aadh", sql.NVarChar(20), fields.aadh)
        .input("occ", sql.NVarChar(100), fields.occ).input("inc", sql.Decimal(18,2), fields.inc)
        .input("cheque", sql.NVarChar(50), fields.cheque).input("chqdate", sql.Date, fields.chqdate)
        .input("tref", sql.NVarChar(200), fields.tref)
        .input("notes", sql.NVarChar(sql.MAX), fields.notes).input("ub", sql.Int, actor)
        .query(`
          UPDATE dbo.CrmCustomerBankDetail SET
            BankName = ISNULL(@bank, BankName), BranchName = ISNULL(@branch, BranchName),
            AccountNo = ISNULL(@acc, AccountNo), IfscCode = ISNULL(@ifsc, IfscCode),
            AccountHolderName = ISNULL(@holder, AccountHolderName),
            NomineeName = ISNULL(@nname, NomineeName), NomineeRelation = ISNULL(@nrel, NomineeRelation),
            NomineeDob = ISNULL(@ndob, NomineeDob), NomineeContact = ISNULL(@ncon, NomineeContact),
            NomineeAddress = ISNULL(@naddr, NomineeAddress),
            PanNo = ISNULL(@pan, PanNo), AadhaarNo = ISNULL(@aadh, AadhaarNo),
            Occupation = ISNULL(@occ, Occupation), AnnualIncome = ISNULL(@inc, AnnualIncome),
            ChequeNo = ISNULL(@cheque, ChequeNo), ChequeDate = ISNULL(@chqdate, ChequeDate),
            TransactionRef = ISNULL(@tref, TransactionRef),
            Notes = @notes, UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
          WHERE BookingId = @bid
        `);
    } else {
      await pool.request()
        .input("bid", sql.Int, bid)
        .input("bank", sql.NVarChar(200), fields.bank).input("branch", sql.NVarChar(200), fields.branch)
        .input("acc", sql.NVarChar(50), fields.acc).input("ifsc", sql.NVarChar(20), fields.ifsc)
        .input("holder", sql.NVarChar(200), fields.holder).input("nname", sql.NVarChar(200), fields.nname)
        .input("nrel", sql.NVarChar(50), fields.nrel).input("ndob", sql.Date, fields.ndob)
        .input("ncon", sql.NVarChar(20), fields.ncon).input("naddr", sql.NVarChar(500), fields.naddr)
        .input("pan", sql.NVarChar(20), fields.pan).input("aadh", sql.NVarChar(20), fields.aadh)
        .input("occ", sql.NVarChar(100), fields.occ).input("inc", sql.Decimal(18,2), fields.inc)
        .input("cheque", sql.NVarChar(50), fields.cheque).input("chqdate", sql.Date, fields.chqdate)
        .input("tref", sql.NVarChar(200), fields.tref)
        .input("notes", sql.NVarChar(sql.MAX), fields.notes).input("cb", sql.Int, actor)
        .query(`
          INSERT INTO dbo.CrmCustomerBankDetail
            (BookingId, BankName, BranchName, AccountNo, IfscCode, AccountHolderName,
             NomineeName, NomineeRelation, NomineeDob, NomineeContact, NomineeAddress,
             PanNo, AadhaarNo, Occupation, AnnualIncome, ChequeNo, ChequeDate, TransactionRef, Notes, CreatedBy, CreatedAt)
          VALUES (@bid, @bank, @branch, @acc, @ifsc, @holder, @nname, @nrel, @ndob, @ncon, @naddr, @pan, @aadh, @occ, @inc, @cheque, @chqdate, @tref, @notes, @cb, SYSDATETIME())
        `);
    }

    // Auto-flow: saved details are the other agreement-prep prerequisite —
    // fire the auto-create check (no-op if the welcome call isn't done yet).
    await maybeAutoCreateAgreement(pool, bid, actor);

    res.json({ success: true });
  } catch (e) {
    console.error("[crm-customer-bank-details] PUT error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /application/:applicationId — same record, keyed by Application
// instead of Booking, for the new Application-stage payment/KYC capture
// (Phase 1 of the Application/Booking redesign — a booking doesn't exist
// yet at this point, so BookingId stays NULL on this row until one does).
router.get("/application/:applicationId", requirePageRight("crm-customer-bank-details", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().input("aid", sql.Int, parseInt(req.params.applicationId))
      .query("SELECT * FROM dbo.CrmCustomerBankDetail WHERE ApplicationId = @aid");
    res.json(result.recordset[0] || null);
  } catch (e) {
    console.error("[crm-customer-bank-details] GET /application error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.put("/application/:applicationId", requirePageRight("crm-customer-bank-details", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const aid = parseInt(req.params.applicationId);
    const b = req.body;
    const actor = actorId(req);

    const app = await pool.request().input("aid", sql.Int, aid).query("SELECT Id FROM dbo.CrmApplication WHERE Id = @aid AND IsActive = 1");
    if (!app.recordset.length) return res.status(404).json({ error: "Application not found" });

    const existing = await pool.request().input("aid", sql.Int, aid).query("SELECT Id FROM dbo.CrmCustomerBankDetail WHERE ApplicationId = @aid");

    const fields = {
      bank: b.BankName || null, branch: b.BranchName || null, acc: b.AccountNo || null, ifsc: b.IfscCode || null,
      holder: b.AccountHolderName || null, nname: b.NomineeName || null, nrel: b.NomineeRelation || null,
      ndob: b.NomineeDob || null, ncon: b.NomineeContact || null, naddr: b.NomineeAddress || null,
      pan: b.PanNo || null, aadh: b.AadhaarNo || null,
      occ: b.Occupation || null, inc: b.AnnualIncome != null && b.AnnualIncome !== "" ? parseFloat(b.AnnualIncome) : null,
      cheque: b.ChequeNo || null, chqdate: b.ChequeDate || null, tref: b.TransactionRef || null,
      notes: b.Notes || null,
    };

    if (existing.recordset.length) {
      await pool.request()
        .input("aid", sql.Int, aid)
        .input("bank", sql.NVarChar(200), fields.bank).input("branch", sql.NVarChar(200), fields.branch)
        .input("acc", sql.NVarChar(50), fields.acc).input("ifsc", sql.NVarChar(20), fields.ifsc)
        .input("holder", sql.NVarChar(200), fields.holder).input("nname", sql.NVarChar(200), fields.nname)
        .input("nrel", sql.NVarChar(50), fields.nrel).input("ndob", sql.Date, fields.ndob)
        .input("ncon", sql.NVarChar(20), fields.ncon).input("naddr", sql.NVarChar(500), fields.naddr)
        .input("pan", sql.NVarChar(20), fields.pan).input("aadh", sql.NVarChar(20), fields.aadh)
        .input("occ", sql.NVarChar(100), fields.occ).input("inc", sql.Decimal(18,2), fields.inc)
        .input("cheque", sql.NVarChar(50), fields.cheque).input("chqdate", sql.Date, fields.chqdate)
        .input("tref", sql.NVarChar(200), fields.tref)
        .input("notes", sql.NVarChar(sql.MAX), fields.notes).input("ub", sql.Int, actor)
        .query(`
          UPDATE dbo.CrmCustomerBankDetail SET
            BankName = ISNULL(@bank, BankName), BranchName = ISNULL(@branch, BranchName),
            AccountNo = ISNULL(@acc, AccountNo), IfscCode = ISNULL(@ifsc, IfscCode),
            AccountHolderName = ISNULL(@holder, AccountHolderName),
            NomineeName = ISNULL(@nname, NomineeName), NomineeRelation = ISNULL(@nrel, NomineeRelation),
            NomineeDob = ISNULL(@ndob, NomineeDob), NomineeContact = ISNULL(@ncon, NomineeContact),
            NomineeAddress = ISNULL(@naddr, NomineeAddress),
            PanNo = ISNULL(@pan, PanNo), AadhaarNo = ISNULL(@aadh, AadhaarNo),
            Occupation = ISNULL(@occ, Occupation), AnnualIncome = ISNULL(@inc, AnnualIncome),
            ChequeNo = ISNULL(@cheque, ChequeNo), ChequeDate = ISNULL(@chqdate, ChequeDate),
            TransactionRef = ISNULL(@tref, TransactionRef),
            Notes = @notes, UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
          WHERE ApplicationId = @aid
        `);
    } else {
      await pool.request()
        .input("aid", sql.Int, aid)
        .input("bank", sql.NVarChar(200), fields.bank).input("branch", sql.NVarChar(200), fields.branch)
        .input("acc", sql.NVarChar(50), fields.acc).input("ifsc", sql.NVarChar(20), fields.ifsc)
        .input("holder", sql.NVarChar(200), fields.holder).input("nname", sql.NVarChar(200), fields.nname)
        .input("nrel", sql.NVarChar(50), fields.nrel).input("ndob", sql.Date, fields.ndob)
        .input("ncon", sql.NVarChar(20), fields.ncon).input("naddr", sql.NVarChar(500), fields.naddr)
        .input("pan", sql.NVarChar(20), fields.pan).input("aadh", sql.NVarChar(20), fields.aadh)
        .input("occ", sql.NVarChar(100), fields.occ).input("inc", sql.Decimal(18,2), fields.inc)
        .input("cheque", sql.NVarChar(50), fields.cheque).input("chqdate", sql.Date, fields.chqdate)
        .input("tref", sql.NVarChar(200), fields.tref)
        .input("notes", sql.NVarChar(sql.MAX), fields.notes).input("cb", sql.Int, actor)
        .query(`
          INSERT INTO dbo.CrmCustomerBankDetail
            (ApplicationId, BankName, BranchName, AccountNo, IfscCode, AccountHolderName,
             NomineeName, NomineeRelation, NomineeDob, NomineeContact, NomineeAddress,
             PanNo, AadhaarNo, Occupation, AnnualIncome, ChequeNo, ChequeDate, TransactionRef, Notes, CreatedBy, CreatedAt)
          VALUES (@aid, @bank, @branch, @acc, @ifsc, @holder, @nname, @nrel, @ndob, @ncon, @naddr, @pan, @aadh, @occ, @inc, @cheque, @chqdate, @tref, @notes, @cb, SYSDATETIME())
        `);
    }

    res.json({ success: true });
  } catch (e) {
    console.error("[crm-customer-bank-details] PUT /application error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
