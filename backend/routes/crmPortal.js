const express = require("express");
const path = require("path");
const fs = require("fs");
const router = express.Router();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { getPool, sql } = require("../db");
const portalAuth = require("../middleware/crmPortalAuth");
const { logCrmAudit } = require("../services/crmAudit");
const { getNextDocNumber } = require("../services/docNumber");
const { emitNotification } = require("../services/notify");
const { maybeResolveAgreementDate } = require("../services/crmWorkflowGuards");

// Categories a customer is allowed to raise themselves — same vocabulary as
// the staff-side Service Ticket module (crmServiceTickets.js), so every
// ticket lives in one unified queue regardless of who opened it.
const CUSTOMER_TICKET_CATEGORIES = ["Warranty", "Complaint", "ServiceRequest", "SocietyIssue", "Legal", "Modification", "Other"];
const TICKET_SLA_HOURS = 96; // customer-raised tickets always start Normal priority

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
      SELECT b.Id, b.BookingNo, b.UnitNo, b.ProjectId, b.ProjectName, b.TotalValue, b.BookingAmount,
             b.TokenType, b.TokenValue, b.Status AS BookingStatus, b.BookingDate,
             b.ParkingTotal, b.ExtraChargesTotal, b.GrandTotal
      FROM dbo.CrmBooking b WHERE b.ApplicationId = @aid AND b.IsActive = 1
    `);
    const bk = booking.recordset[0];

    // Active holds are surfaced regardless of whether a booking exists yet —
    // a customer can have a unit or parking slot on hold before booking
    // anything at all (e.g. parking-only, or still deciding on a unit).
    const holds = await pool.request().input("aid", sql.Int, appId).query(`
      SELECT h.Id, h.EntityType, h.EntityId, h.HoldUntil, h.Reason,
             u.UnitName, s.SlotNo
      FROM dbo.CrmInventoryHold h
      LEFT JOIN dbo.UnitMaster u ON h.EntityType = 'Unit' AND u.Id = h.EntityId
      LEFT JOIN dbo.ParkingSlot s ON h.EntityType = 'Parking' AND s.Id = h.EntityId
      WHERE h.ApplicationId = @aid AND h.Status = 'Active' AND h.HoldUntil >= SYSDATETIME()
      ORDER BY h.HoldUntil
    `);

    if (!bk) return res.json({ stage: "Application", steps: [], holds: holds.recordset });

    const [welcomeCall, customerDetails, agreement, milestones, deed, handover, constructionUpdates] = await Promise.all([
      pool.request().input("bid", sql.Int, bk.Id).query("SELECT TOP 1 * FROM dbo.CrmWelcomeCall WHERE BookingId = @bid ORDER BY CreatedAt DESC"),
      pool.request().input("bid", sql.Int, bk.Id).query(`
        SELECT TOP 1
          CASE WHEN
            NULLIF(LTRIM(RTRIM(ISNULL(BankName, ''))), '') IS NOT NULL AND
            NULLIF(LTRIM(RTRIM(ISNULL(AccountNo, ''))), '') IS NOT NULL AND
            NULLIF(LTRIM(RTRIM(ISNULL(IfscCode, ''))), '') IS NOT NULL AND
            NULLIF(LTRIM(RTRIM(ISNULL(AccountHolderName, ''))), '') IS NOT NULL AND
            NULLIF(LTRIM(RTRIM(ISNULL(NomineeName, ''))), '') IS NOT NULL AND
            NULLIF(LTRIM(RTRIM(ISNULL(NomineeRelation, ''))), '') IS NOT NULL AND
            NULLIF(LTRIM(RTRIM(ISNULL(PanNo, ''))), '') IS NOT NULL AND
            NULLIF(LTRIM(RTRIM(ISNULL(AadhaarNo, ''))), '') IS NOT NULL AND
            NULLIF(LTRIM(RTRIM(ISNULL(Occupation, ''))), '') IS NOT NULL
          THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS IsComplete,
          UpdatedAt, CreatedAt
        FROM dbo.CrmCustomerBankDetail
        WHERE BookingId = @bid
      `),
      pool.request().input("bid", sql.Int, bk.Id).query(`
        SELECT Id, AgreementNo, Status, SeniorApprovalStatus, CustomerApprovalStatus,
               ProposedDateByCompany, ProposedDateByCustomer, AgreementDate, LastRecheckRemarks, SentToCustomerAt,
               (SELECT COUNT(*) FROM dbo.CrmAgreementDocument d WHERE d.AgreementId = CrmAgreement.Id) AS DocumentCount
        FROM dbo.CrmAgreement WHERE BookingId = @bid
      `),
      pool.request().input("bid", sql.Int, bk.Id).query(`
        SELECT MilestoneNo, MilestoneName, DueDate, AmountDue, AmountPaid, Status
        FROM dbo.CrmPaymentMilestone WHERE BookingId = @bid ORDER BY MilestoneNo
      `),
      pool.request().input("bid", sql.Int, bk.Id).query(`
        SELECT Id, Status, DeedDate, RegistrationDate, SentToCustomerAt,
               CustomerApprovalStatus, CustomerApprovedAt, CustomerRecheckRemarks
        FROM dbo.CrmSalesDeed WHERE BookingId = @bid
      `),
      pool.request().input("bid", sql.Int, bk.Id).query("SELECT Status, ScheduledDate, ActualHandoverDate FROM dbo.CrmHandover WHERE BookingId = @bid"),
      // Construction progress is a project-wide broadcast (Foundation/
      // Superstructure/etc apply to every unit in the project, not just this
      // customer's), so it's matched on the booking's real ProjectId — the
      // same link every other module inherits — not a free-text project name.
      bk.ProjectId
        ? pool.request().input("pid", sql.Int, bk.ProjectId)
            .query("SELECT UpdateDate, PercentComplete, Stage, Summary FROM dbo.CrmConstructionUpdate WHERE ProjectId = @pid ORDER BY UpdateDate DESC")
        : Promise.resolve({ recordset: [] }),
    ]);

    res.json({
      booking: bk,
      welcomeCall: welcomeCall.recordset[0] || null,
      customerDetails: customerDetails.recordset[0] || null,
      agreement: agreement.recordset[0] || null,
      paymentMilestones: milestones.recordset,
      salesDeed: deed.recordset[0] || null,
      handover: handover.recordset[0] || null,
      constructionUpdates: constructionUpdates.recordset,
      holds: holds.recordset,
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

const AGREEMENT_UPLOAD_DIR = path.join(__dirname, "../uploads/crm-agreement-documents");

// GET /agreement/documents — every document attached to the customer's own
// agreement, once it's been shared. Scoped strictly to their own
// ApplicationId — a customer can never see another buyer's documents.
router.get("/agreement/documents", async (req, res) => {
  try {
    const pool = getPool();
    const appId = req.portalUser.applicationId;
    const result = await pool.request().input("aid", sql.Int, appId).query(`
      SELECT d.Id, d.DocumentType, d.FileName, d.FileSize, d.MimeType, d.Status, d.VersionNo, d.CreatedAt
      FROM dbo.CrmAgreementDocument d
      JOIN dbo.CrmAgreement ag ON ag.Id = d.AgreementId
      JOIN dbo.CrmBooking b ON b.Id = ag.BookingId
      WHERE b.ApplicationId = @aid AND ag.SentToCustomerAt IS NOT NULL
      ORDER BY d.CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-portal] GET /agreement/documents error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /agreement/documents/file/:docId — stream a document's file, but only
// if it genuinely belongs to this customer's own sent agreement.
router.get("/agreement/documents/file/:docId", async (req, res) => {
  try {
    const pool = getPool();
    const appId = req.portalUser.applicationId;
    const docId = parseInt(req.params.docId);
    const result = await pool.request().input("aid", sql.Int, appId).input("did", sql.Int, docId).query(`
      SELECT d.FileName, d.FilePath, d.MimeType
      FROM dbo.CrmAgreementDocument d
      JOIN dbo.CrmAgreement ag ON ag.Id = d.AgreementId
      JOIN dbo.CrmBooking b ON b.Id = ag.BookingId
      WHERE b.ApplicationId = @aid AND ag.SentToCustomerAt IS NOT NULL AND d.Id = @did
    `);
    if (!result.recordset.length || !result.recordset[0].FilePath) return res.status(404).json({ error: "File not found" });
    const doc = result.recordset[0];

    const resolvedPath = path.resolve(doc.FilePath);
    if (!resolvedPath.startsWith(path.resolve(AGREEMENT_UPLOAD_DIR) + path.sep)) return res.status(403).json({ error: "Access denied" });
    if (!fs.existsSync(resolvedPath)) return res.status(404).json({ error: "File not found on disk" });

    res.setHeader("Content-Type", doc.MimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${doc.FileName || "document"}"`);
    fs.createReadStream(resolvedPath).pipe(res);
  } catch (e) {
    console.error("[crm-portal] GET /agreement/documents/file error:", e.message);
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
    if (decision === "Recheck" && !String(remarks || "").trim()) {
      return res.status(400).json({ error: "Remarks are required when requesting a recheck" });
    }

    const ag = await pool.request().input("aid", sql.Int, appId).query(`
      SELECT ag.Id, ag.RecheckCount, ag.CustomerApprovalStatus, ag.SeniorApprovalStatus
      FROM dbo.CrmAgreement ag
      JOIN dbo.CrmBooking b ON b.Id = ag.BookingId
      WHERE b.ApplicationId = @aid AND ag.SentToCustomerAt IS NOT NULL
    `);
    if (!ag.recordset.length) return res.status(404).json({ error: "No agreement pending your response" });
    if (ag.recordset[0].SeniorApprovalStatus !== "Approved") {
      return res.status(400).json({ error: "Agreement is not ready for customer approval" });
    }
    if (ag.recordset[0].CustomerApprovalStatus === "Approved") {
      return res.status(400).json({ error: "Agreement has already been approved" });
    }
    const agreementId = ag.recordset[0].Id;

    if (decision === "Approve") {
      // Preserve the prior customer-proposed date (if any) in history before
      // it's overwritten.
      if (proposedDate) {
        await pool.request()
          .input("agid", sql.Int, agreementId)
          .input("pd",   sql.Date, proposedDate)
          .query(`
            INSERT INTO dbo.CrmAgreementDateHistory (AgreementId, ProposedBy, ProposedDate, CreatedAt)
            VALUES (@agid, 'Customer', @pd, SYSDATETIME())
          `);
      }
      await pool.request()
        .input("id", sql.Int, agreementId)
        .input("pdc", sql.Date, proposedDate || null)
        .query(`
          UPDATE dbo.CrmAgreement SET
            CustomerApprovalStatus = 'Approved', CustomerApprovedAt = SYSDATETIME(),
            ProposedDateByCustomer = ISNULL(@pdc, ProposedDateByCustomer)
          WHERE Id = @id
        `);
      // The customer just approved and (optionally) proposed a date — if it
      // now matches the company's proposed date, the agreement date is
      // finalized right here, immediately, from the customer's own action.
      await maybeResolveAgreementDate(pool, agreementId);
    } else {
      await pool.request()
        .input("id",  sql.Int, agreementId)
        .input("rem", sql.NVarChar(sql.MAX), remarks || null)
        .query(`
          UPDATE dbo.CrmAgreement SET
            CustomerApprovalStatus = 'RecheckRequested',
            RecheckCount = RecheckCount + 1,
            CustomerApprovedAt = NULL,
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

// POST /sales-deed/respond - customer approves or requests recheck on the
// sales deed after staff publish it to the portal.
router.post("/sales-deed/respond", async (req, res) => {
  try {
    const pool = getPool();
    const appId = req.portalUser.applicationId;
    const { decision, remarks } = req.body;
    if (!["Approve", "Recheck"].includes(decision)) return res.status(400).json({ error: "decision must be Approve or Recheck" });
    if (decision === "Recheck" && !String(remarks || "").trim()) {
      return res.status(400).json({ error: "Remarks are required when requesting a recheck" });
    }

    const deed = await pool.request().input("aid", sql.Int, appId).query(`
      SELECT d.Id, d.CustomerApprovalStatus
      FROM dbo.CrmSalesDeed d
      JOIN dbo.CrmBooking b ON b.Id = d.BookingId
      WHERE b.ApplicationId = @aid AND d.SentToCustomerAt IS NOT NULL
    `);
    if (!deed.recordset.length) return res.status(404).json({ error: "No sales deed pending your response" });
    if (deed.recordset[0].CustomerApprovalStatus === "Approved") {
      return res.status(400).json({ error: "Sales deed has already been approved" });
    }

    if (decision === "Approve") {
      await pool.request()
        .input("id", sql.Int, deed.recordset[0].Id)
        .query(`
          UPDATE dbo.CrmSalesDeed SET
            CustomerApprovalStatus = 'Approved',
            CustomerApprovedAt = SYSDATETIME(),
            CustomerRecheckRemarks = NULL
          WHERE Id = @id
        `);
    } else {
      await pool.request()
        .input("id", sql.Int, deed.recordset[0].Id)
        .input("rem", sql.NVarChar(sql.MAX), remarks)
        .query(`
          UPDATE dbo.CrmSalesDeed SET
            CustomerApprovalStatus = 'RecheckRequested',
            CustomerApprovedAt = NULL,
            CustomerRecheckRemarks = @rem
          WHERE Id = @id
        `);
    }

    res.json({ success: true });
  } catch (e) {
    console.error("[crm-portal] POST /sales-deed/respond error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /tickets — every support ticket raised against the customer's booking,
// staff-raised or self-raised. Only customer-safe fields — no AssignedTo
// staff identity, no internal AssigneeName, matches the "never expose
// internal discussions" rule the same way the rest of this file does.
router.get("/tickets", async (req, res) => {
  try {
    const pool = getPool();
    const appId = req.portalUser.applicationId;
    const result = await pool.request().input("aid", sql.Int, appId).query(`
      SELECT t.Id, t.TicketNo, t.Category, t.Priority, t.Subject, t.Description,
             t.Status, t.ResolvedAt, t.ResolutionNotes, t.CustomerRating, t.CustomerFeedback,
             t.RaisedByCustomer, t.CreatedAt
      FROM dbo.CrmServiceTicket t
      JOIN dbo.CrmBooking b ON b.Id = t.BookingId
      WHERE b.ApplicationId = @aid
      ORDER BY t.CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-portal] GET /tickets error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /tickets — customer raises a new support/legal/modification request.
// Always lands as Normal priority, Open status — staff re-prioritize from
// the regular Service Ticket queue, same as any other ticket.
router.post("/tickets", async (req, res) => {
  try {
    const pool = getPool();
    const appId = req.portalUser.applicationId;
    const { category, subject, description } = req.body;
    if (!CUSTOMER_TICKET_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: `category must be one of: ${CUSTOMER_TICKET_CATEGORIES.join(", ")}` });
    }
    if (!String(subject || "").trim()) return res.status(400).json({ error: "subject is required" });

    const booking = await pool.request().input("aid", sql.Int, appId)
      .query("SELECT TOP 1 Id FROM dbo.CrmBooking WHERE ApplicationId = @aid AND IsActive = 1 AND Status <> 'Cancelled' ORDER BY CreatedAt DESC");
    if (!booking.recordset.length) return res.status(400).json({ error: "No active booking found for your account" });
    const bookingId = booking.recordset[0].Id;

    const ticketNo = await getNextDocNumber(pool, "SVC", "SVC");
    const result = await pool.request()
      .input("no",   sql.NVarChar(30), ticketNo)
      .input("bid",  sql.Int, bookingId)
      .input("cat",  sql.NVarChar(50), category)
      .input("subj", sql.NVarChar(300), subject.trim())
      .input("desc", sql.NVarChar(sql.MAX), description || null)
      .input("sla",  sql.DateTime2(3), new Date(Date.now() + TICKET_SLA_HOURS * 3600 * 1000))
      .query(`
        INSERT INTO dbo.CrmServiceTicket
          (TicketNo, BookingId, Category, Priority, Subject, Description, Status, SlaDueDate, RaisedByCustomer, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@no, @bid, @cat, 'Normal', @subj, @desc, 'Open', @sla, 1, SYSDATETIME())
      `);

    const bk = await pool.request().input("bid", sql.Int, bookingId)
      .query("SELECT AssignedTo, BookingNo FROM dbo.CrmBooking WHERE Id = @bid");
    if (bk.recordset[0]?.AssignedTo) {
      await emitNotification(pool, bk.recordset[0].AssignedTo, "service_ticket_raised_by_customer",
        "Customer Raised a Ticket", `${ticketNo}: ${subject.trim()} (${bk.recordset[0].BookingNo})`,
        result.recordset[0].Id, "service_ticket");
    }

    res.status(201).json({ success: true, id: result.recordset[0].Id, TicketNo: ticketNo });
  } catch (e) {
    console.error("[crm-portal] POST /tickets error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
