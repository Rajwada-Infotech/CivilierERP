const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { getPool, sql } = require("../db");
const portalAuth = require("../middleware/crmPortalAuth");


const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 200, validate: false, message: { error: "Too many requests, please try again later." } }));

// POST /login — email + mobile-as-password (or the password the customer set later)
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email and password are required" });

    const pool = getPool();
    const result = await pool.request().input("em", sql.NVarChar(200), email.trim().toLowerCase())
      .query("SELECT * FROM dbo.CrmCustomerPortalUser WHERE Email = @em AND IsActive = 1");
    const user = result.recordset[0];
    if (!user) return res.status(401).json({ error: "Invalid email or password" });

    const ok = await bcrypt.compare(password, user.PasswordHash);
    if (!ok) return res.status(401).json({ error: "Invalid email or password" });

    await pool.request().input("id", sql.Int, user.Id)
      .query("UPDATE dbo.CrmCustomerPortalUser SET LastLoginAt = SYSDATETIME() WHERE Id = @id");

    const token = jwt.sign(
      { type: "crm_portal", portalUserId: user.Id, applicationId: user.ApplicationId, email: user.Email },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({ token, mustChangePassword: !!user.MustChangePassword });
  } catch (e) {
    console.error("[crm-portal] POST /login error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.use(portalAuth);

// POST /change-password — force-set a real password on first login
router.post("/change-password", async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });
    const pool = getPool();
    const hash = await bcrypt.hash(newPassword, 10);
    await pool.request()
      .input("id", sql.Int, req.portalUser.portalUserId)
      .input("hash", sql.NVarChar(200), hash)
      .query("UPDATE dbo.CrmCustomerPortalUser SET PasswordHash = @hash, MustChangePassword = 0 WHERE Id = @id");
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-portal] POST /change-password error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /me — applicant + booking summary
router.get("/me", async (req, res) => {
  try {
    const pool = getPool();
    const appId = req.portalUser.applicationId;
    const app = await pool.request().input("aid", sql.Int, appId).query(`
      SELECT a.Id, a.ApplicationNo, a.ApplicantName, a.Mobile, a.Email, a.InterestedProject, a.Status
      FROM dbo.CrmApplication a WHERE a.Id = @aid AND a.IsActive = 1
    `);
    if (!app.recordset.length) return res.status(404).json({ error: "Application not found" });
    res.json(app.recordset[0]);
  } catch (e) {
    console.error("[crm-portal] GET /me error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /timeline — step-by-step milestone view. Brokerage is never queried
// or included here, by design — the customer only ever sees their own
// application/booking/agreement/payment/handover progression.
router.get("/timeline", async (req, res) => {
  try {
    const pool = getPool();
    const appId = req.portalUser.applicationId;

    const booking = await pool.request().input("aid", sql.Int, appId).query(`
      SELECT b.Id, b.BookingNo, b.UnitNo, b.ProjectName, b.TotalValue, b.BookingAmount,
             b.TokenType, b.TokenValue, b.Status AS BookingStatus, b.BookingDate
      FROM dbo.CrmBooking b WHERE b.ApplicationId = @aid AND b.IsActive = 1
    `);
    const bk = booking.recordset[0];
    if (!bk) return res.json({ stage: "Application", steps: [] });

    const [welcomeCall, agreement, milestones, deed, handover] = await Promise.all([
      pool.request().input("bid", sql.Int, bk.Id).query("SELECT TOP 1 * FROM dbo.CrmWelcomeCall WHERE BookingId = @bid ORDER BY CreatedAt DESC"),
      pool.request().input("bid", sql.Int, bk.Id).query(`
        SELECT Id, AgreementNo, Status, SeniorApprovalStatus, CustomerApprovalStatus,
               ProposedDateByCompany, ProposedDateByCustomer, AgreementDate, LastRecheckRemarks, SentToCustomerAt
        FROM dbo.CrmAgreement WHERE BookingId = @bid
      `),
      pool.request().input("bid", sql.Int, bk.Id).query(`
        SELECT MilestoneNo, MilestoneName, DueDate, AmountDue, AmountPaid, Status
        FROM dbo.CrmPaymentMilestone WHERE BookingId = @bid ORDER BY MilestoneNo
      `),
      pool.request().input("bid", sql.Int, bk.Id).query("SELECT Status, DeedDate, RegistrationDate FROM dbo.CrmSalesDeed WHERE BookingId = @bid"),
      pool.request().input("bid", sql.Int, bk.Id).query("SELECT Status, ScheduledDate, ActualHandoverDate FROM dbo.CrmHandover WHERE BookingId = @bid"),
    ]);

    res.json({
      booking: bk,
      welcomeCall: welcomeCall.recordset[0] || null,
      agreement: agreement.recordset[0] || null,
      paymentMilestones: milestones.recordset,
      salesDeed: deed.recordset[0] || null,
      handover: handover.recordset[0] || null,
    });
  } catch (e) {
    console.error("[crm-portal] GET /timeline error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /agreement — full agreement text/terms once it has been sent to the customer
router.get("/agreement", async (req, res) => {
  try {
    const pool = getPool();
    const appId = req.portalUser.applicationId;
    const result = await pool.request().input("aid", sql.Int, appId).query(`
      SELECT ag.Id, ag.AgreementNo, ag.Status, ag.AgreementDate, ag.LegalName, ag.LegalAddress,
             ag.CustomerApprovalStatus, ag.ProposedDateByCompany, ag.ProposedDateByCustomer,
             ag.SentToCustomerAt, ag.LastRecheckRemarks, b.BookingNo, b.UnitNo, b.TotalValue
      FROM dbo.CrmAgreement ag
      JOIN dbo.CrmBooking b ON b.Id = ag.BookingId
      WHERE b.ApplicationId = @aid AND ag.SentToCustomerAt IS NOT NULL
    `);
    if (!result.recordset.length) return res.status(404).json({ error: "No agreement has been shared yet" });
    res.json(result.recordset[0]);
  } catch (e) {
    console.error("[crm-portal] GET /agreement error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /agreement/respond — customer approves or requests a recheck
router.post("/agreement/respond", async (req, res) => {
  try {
    const pool = getPool();
    const appId = req.portalUser.applicationId;
    const { decision, remarks, proposedDate } = req.body; // decision: "Approve" | "Recheck"
    if (!["Approve", "Recheck"].includes(decision)) return res.status(400).json({ error: "decision must be Approve or Recheck" });

    const ag = await pool.request().input("aid", sql.Int, appId).query(`
      SELECT ag.Id, ag.RecheckCount
      FROM dbo.CrmAgreement ag
      JOIN dbo.CrmBooking b ON b.Id = ag.BookingId
      WHERE b.ApplicationId = @aid AND ag.SentToCustomerAt IS NOT NULL
    `);
    if (!ag.recordset.length) return res.status(404).json({ error: "No agreement pending your response" });
    const agreementId = ag.recordset[0].Id;

    if (decision === "Approve") {
      await pool.request()
        .input("id", sql.Int, agreementId)
        .input("pdc", sql.Date, proposedDate || null)
        .query(`
          UPDATE dbo.CrmAgreement SET
            CustomerApprovalStatus = 'Approved', CustomerApprovedAt = SYSDATETIME(),
            ProposedDateByCustomer = ISNULL(@pdc, ProposedDateByCustomer)
          WHERE Id = @id
        `);
    } else {
      await pool.request()
        .input("id",  sql.Int, agreementId)
        .input("rem", sql.NVarChar(sql.MAX), remarks || null)
        .query(`
          UPDATE dbo.CrmAgreement SET
            CustomerApprovalStatus = 'RecheckRequested',
            RecheckCount = RecheckCount + 1,
            LastRecheckRemarks = @rem
          WHERE Id = @id
        `);
    }

    await pool.request()
      .input("agid", sql.Int, agreementId)
      .input("act",  sql.NVarChar(30), decision === "Approve" ? "CustomerApprove" : "CustomerRecheck")
      .input("rem",  sql.NVarChar(sql.MAX), remarks || null)
      .input("aname",sql.NVarChar(200), req.portalUser.email)
      .query(`
        INSERT INTO dbo.CrmAgreementApprovalLog (AgreementId, Action, Remarks, ActorType, ActorId, ActorName, CreatedAt)
        VALUES (@agid, @act, @rem, 'Customer', NULL, @aname, SYSDATETIME())
      `);

    res.json({ success: true });
  } catch (e) {
    console.error("[crm-portal] POST /agreement/respond error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
