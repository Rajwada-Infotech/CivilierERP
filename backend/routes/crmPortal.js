const express = require("express");
const { CrmStatus } = require("../constants/crmStatuses");
const multer = require("multer");
const router = express.Router();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { getPool, sql } = require("../db");
const portalAuth = require("../middleware/crmPortalAuth");
const { getNextDocNumber } = require("../services/docNumber");
const { emitNotification } = require("../services/notify");
const { proposeAgreementDate, acceptAgreementDate, syncLegalMilestoneStep } = require("../services/crmWorkflowGuards");
const { logCommunication } = require("../services/crmCommunicationLog");
const { getInvoicePdfBuffer } = require("../services/invoicePdf");
const { getMoneyReceiptPdfBuffer } = require("../services/moneyReceiptPdf");
const { getAgreementBookingLockReason, agreementExecutedLockReason } = require("./crmAgreements");

// Categories a customer is allowed to raise themselves — same vocabulary as
// the staff-side Service Ticket module (crmServiceTickets.js), so every
// ticket lives in one unified queue regardless of who opened it.
const CUSTOMER_TICKET_CATEGORIES = ["Warranty", "Complaint", "ServiceRequest", "SocietyIssue", "Legal", "Modification", "Other"];
const TICKET_SLA_HOURS = 96; // customer-raised tickets always start Normal priority

const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 200, validate: false, message: { error: "Too many requests, please try again later." } }));

// POST /login — email + password (mobile number initially, forced reset on first
// login — unchanged). Identity anchor is CustomerId (migration 254); email is
// the UX credential resolved via CrmCustomer → CrmCustomerPortalUser.
// UQ_CrmCustomer_Email (migration 255, filtered on active nonblank emails)
// guarantees the lookup is always unambiguous — no silent wrong-row risk.
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email and password are required" });

    const pool = getPool();

    // Resolve Email → CrmCustomer → CrmCustomerPortalUser
    const result = await pool.request()
      .input("em", sql.NVarChar(200), email.trim().toLowerCase())
      .query(`
        SELECT pu.Id AS PortalUserId, pu.CustomerId, pu.PasswordHash,
               pu.MustChangePassword, pu.IsActive, pu.Email
        FROM dbo.CrmCustomer c
        JOIN dbo.CrmCustomerPortalUser pu ON pu.CustomerId = c.Id
        WHERE LOWER(LTRIM(RTRIM(c.Email))) = @em
          AND c.IsActive = 1
      `);
    if (result.recordset.length > 1) {
      return res.status(409).json({
        error: "This email matches more than one customer record. Please contact the sales office to confirm your mobile number.",
      });
    }
    const user = result.recordset[0];
    if (!user) return res.status(401).json({ error: "Invalid email or password" });
    if (!user.IsActive) return res.status(401).json({ error: "This portal account has been deactivated" });

    const ok = await bcrypt.compare(password, user.PasswordHash);
    if (!ok) return res.status(401).json({ error: "Invalid email or password" });

    await pool.request().input("id", sql.Int, user.PortalUserId)
      .query("UPDATE dbo.CrmCustomerPortalUser SET LastLoginAt = SYSDATETIME() WHERE Id = @id");

    // JWT carries customerId only — applicationId is a request-scoped param,
    // validated per-request against customerId, never embedded in the token.
    const token = jwt.sign(
      { type: "crm_portal", portalUserId: user.PortalUserId, customerId: user.CustomerId, email: user.Email },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({ token, mustChangePassword: !!user.MustChangePassword });
  } catch (e) {
    console.error("[crm-portal] POST /login error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});


router.use(portalAuth);

// Server-side enforcement of (1) account deactivation and (2) the forced
// first-login password reset. IsActive is checked first and blocks EVERY
// route with no exception. MustChangePassword only blocks routes other than
// /change-password, which is the one place that actually resolves it.
router.use(async (req, res, next) => {
  try {
    const pool = getPool();
    const row = await pool.request().input("id", sql.Int, req.portalUser.portalUserId)
      .query("SELECT IsActive, MustChangePassword FROM dbo.CrmCustomerPortalUser WHERE Id = @id");
    if (!row.recordset.length) return res.status(401).json({ error: "Portal account not found" });
    if (!row.recordset[0].IsActive) {
      return res.status(401).json({ error: "This portal account has been deactivated" });
    }
    if (req.path === "/change-password") return next();
    if (row.recordset[0].MustChangePassword) {
      return res.status(403).json({ error: "You must set a new password before continuing", mustChangePassword: true });
    }
    next();
  } catch (e) {
    console.error("[crm-portal] password-change gate error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

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
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// ─── Ownership-check helper ───────────────────────────────────────────────────
// Every detail route passes an applicationId param; this validates it belongs
// to the authenticated customer before allowing the request through.
// Returns the validated integer applicationId on success, throws 403 on failure.
// This is the server-side enforcement of Option A: JWT carries customerId,
// applicationId is a request-scoped param, validated here on every request.
async function resolveAndAssertApplication(pool, req, res) {
  const raw = req.query.applicationId || req.params.applicationId;
  const appId = parseInt(raw, 10);
  if (!appId || isNaN(appId)) {
    res.status(400).json({ error: "applicationId is required" });
    return null;
  }
  const check = await pool.request()
    .input("aid", sql.Int, appId)
    .input("cid", sql.Int, req.portalUser.customerId)
    .query(`
      SELECT a.Id
      FROM dbo.CrmApplication a
      WHERE a.Id = @aid
        AND a.CustomerId = @cid
        AND a.IsActive = 1
    `);
  if (!check.recordset.length) {
    res.status(403).json({ error: "Application not found or does not belong to this account" });
    return null;
  }
  return appId;
}

// ─── GET /applications — summary listing of ALL applications for this customer ─
// This is the new landing page after login: every Application + its Booking
// stage, so the customer can pick which unit's timeline to view.
router.get("/applications", async (req, res) => {
  try {
    const pool = getPool();
    const customerId = req.portalUser.customerId;
    const result = await pool.request().input("cid", sql.Int, customerId).query(`
      SELECT
        a.Id AS ApplicationId, a.ApplicationNo, a.ApplicantName, a.Status AS ApplicationStatus,
        a.InterestedProject, a.CreatedAt AS ApplicationDate,
        b.Id AS BookingId, b.BookingNo,
        COALESCE(bn.UnitNo,      b.UnitNo)      AS UnitNo,
        COALESCE(bn.ProjectName, b.ProjectName) AS ProjectName,
        b.Status AS BookingStatus, b.GrandTotal, b.BookingDate,
        ag.Status AS AgreementStatus, ag.SentToCustomerAt,
        ag.CustomerApprovalStatus, ag.SeniorApprovalStatus,
        sd.Status AS SalesDeedStatus, sd.CustomerApprovalStatus AS DeedCustomerApprovalStatus,
        h.Status AS HandoverStatus, h.ActualHandoverDate
      FROM dbo.CrmApplication a
      LEFT JOIN dbo.CrmBooking b ON b.ApplicationId = a.Id AND b.IsActive = 1
      LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
      LEFT JOIN dbo.CrmAgreement ag ON ag.BookingId = b.Id
      LEFT JOIN dbo.CrmSalesDeed sd ON sd.BookingId = b.Id
      LEFT JOIN dbo.CrmHandover h ON h.BookingId = b.Id
      WHERE a.CustomerId = @cid AND a.IsActive = 1
      ORDER BY a.CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-portal] GET /applications error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// ─── GET /me — customer profile from the CrmCustomer record ──────────────────
router.get("/me", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().input("cid", sql.Int, req.portalUser.customerId).query(`
      SELECT c.Id, c.CustomerNo, c.CustomerName AS Name, c.Mobile, c.Email, c.Address, c.City, c.State
      FROM dbo.CrmCustomer c WHERE c.Id = @cid
    `);
    if (!result.recordset.length) return res.status(404).json({ error: "Customer record not found" });
    res.json(result.recordset[0]);
  } catch (e) {
    console.error("[crm-portal] GET /me error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// ─── GET /timeline — per-application step-by-step milestone view ─────────────
// Requires ?applicationId= — validated against req.portalUser.customerId.
router.get("/timeline", async (req, res) => {
  try {
    const pool = getPool();
    const appId = await resolveAndAssertApplication(pool, req, res);
    if (appId === null) return;

    const booking = await pool.request().input("aid", sql.Int, appId).query(`
      SELECT b.Id, b.BookingNo,
             COALESCE(bn.UnitNo,      b.UnitNo)      AS UnitNo,
             b.ProjectId,
             COALESCE(bn.ProjectName, b.ProjectName) AS ProjectName,
             b.TotalValue, b.BookingAmount,
             b.TokenType, b.TokenValue, b.Status AS BookingStatus, b.BookingDate,
             b.ParkingTotal, b.ExtraChargesTotal, b.GrandTotal
      FROM dbo.CrmBooking b
      LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
      WHERE b.ApplicationId = @aid AND b.IsActive = 1
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
      WHERE h.ApplicationId = @aid AND h.Status = '${CrmStatus.ACTIVE}' AND h.HoldUntil >= SYSDATETIME()
      ORDER BY h.HoldUntil
    `);

    if (!bk) return res.json({ stage: "Application", steps: [], holds: holds.recordset });

    const [welcomeCall, customerDetails, agreement, milestones, deed, handover, possessionNotice, constructionUpdates, legalMilestone, nocs, prePossession, queryPayment, registry] = await Promise.all([
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
               ProposedDate, ProposedDateStatus, AgreementDate, DateApprovalStatus, LastRecheckRemarks, SentToCustomerAt,
               (SELECT COUNT(*) FROM dbo.CrmAgreementDocument d WHERE d.AgreementId = CrmAgreement.Id) AS DocumentCount,
               (SELECT COUNT(*) FROM dbo.CrmAgreementDocument d WHERE d.AgreementId = CrmAgreement.Id AND d.Status IN ('Requested','${CrmStatus.REJECTED}')) AS DocumentsNeedingAction
        FROM dbo.CrmAgreement WHERE BookingId = @bid AND SentToCustomerAt IS NOT NULL
      `),
      pool.request().input("bid", sql.Int, bk.Id).query(`
        SELECT MilestoneNo, MilestoneName, DueDate, AmountDue, AmountPaid, Status
        FROM dbo.CrmPaymentMilestone WHERE BookingId = @bid ORDER BY MilestoneNo
      `),
      pool.request().input("bid", sql.Int, bk.Id).query(`
        SELECT Id, DeedNo, Status, DeedValue, SubRegistrarOffice, RegistrationNo, DeedDate, RegistrationDate, SentToCustomerAt,
               CustomerApprovalStatus, CustomerApprovedAt, CustomerRecheckRemarks
        FROM dbo.CrmSalesDeed WHERE BookingId = @bid
      `),
      pool.request().input("bid", sql.Int, bk.Id).query("SELECT Status, ScheduledDate, ActualHandoverDate FROM dbo.CrmHandover WHERE BookingId = @bid"),
      pool.request().input("bid", sql.Int, bk.Id).query(`
        SELECT TOP 1 Id, NoticeNo, Status, OfferedDate, ResponseDeadline, SentAt, AcknowledgedAt, DisputedAt, DisputeReason
        FROM dbo.CrmPossessionNotice WHERE BookingId = @bid AND Status <> 'Draft' ORDER BY CreatedAt DESC
      `),
      // Construction progress is project-wide, matched on the booking's real ProjectId.
      bk.ProjectId
        ? pool.request().input("pid", sql.Int, bk.ProjectId)
            .query("SELECT UpdateDate, PercentComplete, Stage, Summary FROM dbo.CrmConstructionUpdate WHERE ProjectId = @pid ORDER BY UpdateDate DESC")
        : Promise.resolve({ recordset: [] }),
      pool.request().input("bid", sql.Int, bk.Id).query("SELECT OverallStatus FROM dbo.CrmLegalMilestone WHERE BookingId = @bid"),
      pool.request().input("bid", sql.Int, bk.Id).query("SELECT NocType, Status, NocNo, IssuedDate FROM dbo.CrmNoc WHERE BookingId = @bid"),
      pool.request().input("bid", sql.Int, bk.Id).query("SELECT Status, ScheduledInspectionDate FROM dbo.CrmPrePossession WHERE BookingId = @bid"),
      // Query Payment: the customer's own government payment (stamp duty +
      // registration fee) — required amount is read live from the Sales
      // Deed, same as the staff-side route, never duplicated here.
      pool.request().input("bid", sql.Int, bk.Id).query(`
        SELECT qp.Id, qp.QPNo, qp.Status, qp.InfoSentAt, qp.ConfirmedAt, qp.ConfirmedAmount,
               sd.StampDuty, sd.RegistrationFee, ISNULL(sd.StampDuty,0) + ISNULL(sd.RegistrationFee,0) AS RequiredAmount
        FROM dbo.CrmQueryPayment qp
        LEFT JOIN dbo.CrmSalesDeed sd ON sd.Id = qp.SalesDeedId
        WHERE qp.BookingId = @bid
      `),
      pool.request().input("bid", sql.Int, bk.Id).query("SELECT Id, RegNo, Status, ScheduledDate, CompletedDate FROM dbo.CrmRegistry WHERE BookingId = @bid"),
    ]);

    res.json({
      booking: bk,
      welcomeCall: welcomeCall.recordset[0] || null,
      customerDetails: customerDetails.recordset[0] || null,
      agreement: agreement.recordset[0] || null,
      paymentMilestones: milestones.recordset,
      salesDeed: deed.recordset[0] || null,
      handover: handover.recordset[0] || null,
      possessionNotice: possessionNotice.recordset[0] || null,
      constructionUpdates: constructionUpdates.recordset,
      holds: holds.recordset,
      // Customer-facing framing of internal process trackers — raw step
      // names (DocCollection/LegalReview/etc) and NOC bank details are never
      // exposed, only an overall status the customer can act/wait on.
      legalDocumentation: legalMilestone.recordset[0]
        ? { status: legalMilestone.recordset[0].OverallStatus }
        : null,
      nocStatus: {
        total: nocs.recordset.length,
        issued: nocs.recordset.filter((n) => n.Status === "Issued").length,
        items: nocs.recordset.map((n) => ({ type: n.NocType, status: n.Status, nocNo: n.NocNo, issuedDate: n.IssuedDate })),
      },
      queryPayment: queryPayment.recordset[0] || null,
      registry: registry.recordset[0] || null,
      prePossession: prePossession.recordset[0]
        ? { status: prePossession.recordset[0].Status, scheduledDate: prePossession.recordset[0].ScheduledInspectionDate }
        : null,
    });
  } catch (e) {
    console.error("[crm-portal] GET /timeline error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// GET /invoices — every invoice for the selected application's booking.
// Requires ?applicationId=
router.get("/invoices", async (req, res) => {
  try {
    const pool = getPool();
    const appId = await resolveAndAssertApplication(pool, req, res);
    if (appId === null) return;
    const result = await pool.request().input("aid", sql.Int, appId).query(`
      SELECT inv.Id, inv.InvoiceNo, inv.InvoiceType, inv.Amount, inv.InvoiceDate, inv.Description, inv.Status, inv.CreatedAt,
             b.BookingNo, COALESCE(bn.UnitNo, b.UnitNo) AS UnitNo
      FROM dbo.CrmInvoice inv
      JOIN dbo.CrmBooking b ON b.Id = inv.BookingId
      LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
      WHERE b.ApplicationId = @aid
      ORDER BY inv.CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-portal] GET /invoices error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// GET /invoices/:invoiceId/pdf — same invoice PDF the staff side downloads,
// scoped to invoices on a booking belonging to THIS logged-in customer only
// (via applicationId, same ownership check every other portal route uses —
// portalUser.customerId comes from the JWT, never a client-supplied value).
router.get("/invoices/:invoiceId/pdf", async (req, res) => {
  try {
    const pool = getPool();
    const appId = await resolveAndAssertApplication(pool, req, res);
    if (appId === null) return;
    const invoiceId = parseInt(req.params.invoiceId);
    const row = await pool.request().input("iid", sql.Int, invoiceId).input("aid", sql.Int, appId).query(`
      SELECT inv.InvoiceNo
      FROM dbo.CrmInvoice inv
      JOIN dbo.CrmBooking b ON b.Id = inv.BookingId
      WHERE inv.Id = @iid AND b.ApplicationId = @aid
    `);
    if (!row.recordset.length) return res.status(404).json({ error: "Invoice not found" });
    const invoiceNo = row.recordset[0].InvoiceNo;
    const buffer = await getInvoicePdfBuffer(pool, invoiceId);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${invoiceNo}.pdf"`);
    res.send(buffer);
  } catch (e) {
    console.error("[crm-portal] GET /invoices/:invoiceId/pdf error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// GET /receipts — list approved money receipts for the customer's booking.
// Only Approved receipts are shown — Pending/Bounced receipts are internal
// workflow states the customer doesn't need to see.
router.get("/receipts", async (req, res) => {
  try {
    const pool = getPool();
    const appId = await resolveAndAssertApplication(pool, req, res);
    if (appId === null) return;
    const result = await pool.request().input("aid", sql.Int, appId).query(`
      SELECT mr.Id, mr.ReceiptNo, mr.Amount, mr.PaymentMode, mr.ChequeNo,
             mr.TransactionRef, mr.ReceivedDate, mr.CreatedAt,
             b.BookingNo, COALESCE(bn.UnitNo, b.UnitNo) AS UnitNo
      FROM dbo.CrmMoneyReceipt mr
      JOIN dbo.CrmBooking b ON b.Id = mr.BookingId
      LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
      WHERE b.ApplicationId = @aid AND mr.Status = 'Approved'
      ORDER BY mr.ReceivedDate DESC
    `);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-portal] GET /receipts error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// GET /receipts/:receiptId/pdf — scoped to receipts on a booking belonging to
// THIS logged-in customer only (same ownership check as /invoices/:id/pdf).
router.get("/receipts/:receiptId/pdf", async (req, res) => {
  try {
    const pool = getPool();
    const appId = await resolveAndAssertApplication(pool, req, res);
    if (appId === null) return;
    const receiptId = parseInt(req.params.receiptId);
    const row = await pool.request()
      .input("rid", sql.Int, receiptId)
      .input("aid", sql.Int, appId)
      .query(`
        SELECT mr.ReceiptNo
        FROM dbo.CrmMoneyReceipt mr
        JOIN dbo.CrmBooking b ON b.Id = mr.BookingId
        WHERE mr.Id = @rid AND b.ApplicationId = @aid AND mr.Status = 'Approved'
      `);
    if (!row.recordset.length) return res.status(404).json({ error: "Receipt not found" });
    const receiptNo = row.recordset[0].ReceiptNo;
    const buffer = await getMoneyReceiptPdfBuffer(pool, receiptId);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${receiptNo}.pdf"`);
    res.send(buffer);
  } catch (e) {
    console.error("[crm-portal] GET /receipts/:receiptId/pdf error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// GET /agreement — requires ?applicationId=
router.get("/agreement", async (req, res) => {
  try {
    const pool = getPool();
    const appId = await resolveAndAssertApplication(pool, req, res);
    if (appId === null) return;
    const result = await pool.request().input("aid", sql.Int, appId).query(`
      SELECT ag.Id, ag.AgreementNo, ag.Status, ag.AgreementDate, ag.LegalName, ag.LegalAddress,
             ag.PanNo, ag.AadhaarNo, ag.VersionNo, ag.CreatedAt,
             ag.SeniorApprovalStatus, ag.SeniorApprovedAt,
             ag.CustomerApprovalStatus, ag.CustomerApprovedAt, ag.RecheckCount,
             ag.ProposedDate, ag.ProposedDateStatus, ag.DateApprovalStatus,
             ag.SentToCustomerAt, ag.LastRecheckRemarks,
             b.BookingNo,
             COALESCE(bn.UnitNo,      b.UnitNo)      AS UnitNo,
             COALESCE(bn.ProjectName, b.ProjectName) AS ProjectName,
             b.TotalValue, b.BookingDate
      FROM dbo.CrmAgreement ag
      JOIN dbo.CrmBooking b ON b.Id = ag.BookingId
      LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
      WHERE b.ApplicationId = @aid AND ag.SentToCustomerAt IS NOT NULL
    `);
    // Not having an agreement shared yet is a normal, expected state — 200 + null.
    res.json(result.recordset[0] || null);
  } catch (e) {
    console.error("[crm-portal] GET /agreement error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// GET /agreement/documents — requires ?applicationId=
router.get("/agreement/documents", async (req, res) => {
  try {
    const pool = getPool();
    const appId = await resolveAndAssertApplication(pool, req, res);
    if (appId === null) return;
    const result = await pool.request().input("aid", sql.Int, appId).query(`
      SELECT d.Id, d.DocumentType, d.Label, d.IsMandatory, d.UploadedByType,
             d.FileName, d.FileSize, d.MimeType, d.Status, d.Remarks, d.VersionNo,
             d.RequestedAt, d.UploadedAt, d.CreatedAt
      FROM dbo.CrmAgreementDocument d
      JOIN dbo.CrmAgreement ag ON ag.Id = d.AgreementId
      JOIN dbo.CrmBooking b ON b.Id = ag.BookingId
      -- IdentityProof-type documents are the "first batch" — KYC paperwork
      -- the customer can and should upload right away, well before the
      -- Legal Executive's Sale Agreement paper exists or the agreement is
      -- formally sent. Every other document type stays gated behind
      -- SentToCustomerAt (the actual legal content shouldn't be visible
      -- until it's been through senior approval and been shared).
      WHERE b.ApplicationId = @aid AND (ag.SentToCustomerAt IS NOT NULL OR d.DocumentType = 'IdentityProof')
      ORDER BY d.CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-portal] GET /agreement/documents error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

const portalDocUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ALLOWED = [
      "application/pdf", "image/jpeg", "image/png", "image/webp",
      "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];
    if (ALLOWED.includes(file.mimetype)) return cb(null, true);
    cb(new Error("File type not allowed — please upload a PDF, Word document, or image"));
  },
});

// POST /agreement/documents/:docId/upload — requires ?applicationId=
router.post("/agreement/documents/:docId/upload", (req, res) => {
  portalDocUpload.single("file")(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    try {
      const pool = getPool();
      const appId = await resolveAndAssertApplication(pool, req, res);
      if (appId === null) return;
      const docId = parseInt(req.params.docId, 10);

      // Same early-access carve-out as GET /agreement/documents — IdentityProof
      // uploads don't wait on SentToCustomerAt.
      const check = await pool.request().input("aid", sql.Int, appId).input("did", sql.Int, docId).query(`
        SELECT d.Id, d.AgreementId, d.Status, d.DocumentType, ag.AgreementNo, ag.BookingId, b.AssignedTo, b.BookingNo, a.ApplicantName
        FROM dbo.CrmAgreementDocument d
        JOIN dbo.CrmAgreement ag ON ag.Id = d.AgreementId
        JOIN dbo.CrmBooking b ON b.Id = ag.BookingId
        JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
        WHERE b.ApplicationId = @aid AND (ag.SentToCustomerAt IS NOT NULL OR d.DocumentType = 'IdentityProof') AND d.Id = @did
      `);
      if (!check.recordset.length) {
        return res.status(404).json({ error: "Document not found" });
      }
      const doc = check.recordset[0];
      if (!["Requested", CrmStatus.REJECTED].includes(doc.Status)) {
        return res.status(400).json({ error: "This document isn't open for upload" });
      }
      // Same two gates every staff-side document route already enforces
      // (crmAgreements.js) — this customer-facing upload was the one path
      // missing them. A booking cancelled out from under a still-open
      // document request, or an agreement that's since been Executed/
      // Registered, must not accept a new upload either.
      const lockReason = await getAgreementBookingLockReason(pool, doc.AgreementId);
      if (lockReason) return res.status(409).json({ error: `Cannot upload — ${lockReason}.` });
      const execLockReason = await agreementExecutedLockReason(pool, doc.AgreementId);
      if (execLockReason) return res.status(409).json({ error: `Cannot upload — ${execLockReason}.` });

      await pool.request()
        .input("id", sql.Int, docId)
        .input("fname", sql.NVarChar(300), req.file.originalname)
        .input("fb64", sql.NVarChar(sql.MAX), req.file.buffer.toString("base64"))
        .input("fs", sql.BigInt, req.file.size)
        .input("mt", sql.NVarChar(150), req.file.mimetype)
        .query(`
          UPDATE dbo.CrmAgreementDocument SET
            FileName = @fname, FileBase64 = @fb64, FileSize = @fs, MimeType = @mt,
            Status = 'Submitted', Remarks = NULL, UploadedAt = SYSDATETIME()
          WHERE Id = @id
        `);

      if (doc.AssignedTo) {
        await emitNotification(pool, doc.AssignedTo, "crm_document_submitted", "Document Submitted by Customer",
          `${doc.ApplicantName} uploaded ${doc.DocumentType.replace(/([A-Z])/g, " $1").trim()} for ${doc.AgreementNo} (${doc.BookingNo}).`,
          docId, "crm_agreement_document");
      }
      await logCommunication(pool, {
        bookingId: doc.BookingId, direction: "Inbound",
        subject: `Customer submitted a document — ${doc.DocumentType.replace(/([A-Z])/g, " $1").trim()}`,
        summary: `${doc.ApplicantName} uploaded ${doc.DocumentType.replace(/([A-Z])/g, " $1").trim()} for ${doc.AgreementNo}.`,
      });

      res.json({ success: true });
    } catch (e) {
      console.error("[crm-portal] POST /agreement/documents/:docId/upload error:", e.message);
      res.status(500).json({ error: "An internal error occurred. Please try again later." });
    }
  });
});

// GET /agreement/documents/file/:docId — requires ?applicationId=
router.get("/agreement/documents/file/:docId", async (req, res) => {
  try {
    const pool = getPool();
    const appId = await resolveAndAssertApplication(pool, req, res);
    if (appId === null) return;
    const docId = parseInt(req.params.docId);
    // Same early-access carve-out as GET /agreement/documents — a customer
    // must be able to preview/download an IdentityProof file they already
    // uploaded, even before the agreement itself has been sent.
    const result = await pool.request().input("aid", sql.Int, appId).input("did", sql.Int, docId).query(`
      SELECT d.FileName, d.FileBase64, d.MimeType
      FROM dbo.CrmAgreementDocument d
      JOIN dbo.CrmAgreement ag ON ag.Id = d.AgreementId
      JOIN dbo.CrmBooking b ON b.Id = ag.BookingId
      WHERE b.ApplicationId = @aid AND (ag.SentToCustomerAt IS NOT NULL OR d.DocumentType = 'IdentityProof') AND d.Id = @did
    `);
    if (!result.recordset.length || !result.recordset[0].FileBase64) return res.status(404).json({ error: "File not found" });
    const doc = result.recordset[0];

    res.setHeader("Content-Type", doc.MimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${doc.FileName || "document"}"`);
    res.send(Buffer.from(doc.FileBase64, "base64"));
  } catch (e) {
    console.error("[crm-portal] GET /agreement/documents/file error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// POST /agreement/respond — requires ?applicationId=
router.post("/agreement/respond", async (req, res) => {
  try {
    const pool = getPool();
    const appId = await resolveAndAssertApplication(pool, req, res);
    if (appId === null) return;
    const { decision, remarks, proposedDate } = req.body;
    if (!["Approve", "Recheck"].includes(decision)) return res.status(400).json({ error: "decision must be Approve or Recheck" });
    if (decision === "Recheck" && !String(remarks || "").trim()) {
      return res.status(400).json({ error: "Remarks are required when requesting a recheck" });
    }

    const ag = await pool.request().input("aid", sql.Int, appId).query(`
      SELECT ag.Id, ag.RecheckCount, ag.CustomerApprovalStatus, ag.SeniorApprovalStatus,
             ag.AgreementNo, ag.BookingId, b.AssignedTo, b.BookingNo, a.ApplicantName,
             ag.VersionNo, ag.AgreementDate, ag.LegalName, ag.LegalAddress, ag.PanNo, ag.AadhaarNo, ag.Notes
      FROM dbo.CrmAgreement ag
      JOIN dbo.CrmBooking b ON b.Id = ag.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      WHERE b.ApplicationId = @aid AND ag.SentToCustomerAt IS NOT NULL
    `);
    if (!ag.recordset.length) return res.status(404).json({ error: "No agreement pending your response" });
    if (ag.recordset[0].SeniorApprovalStatus !== CrmStatus.APPROVED) {
      return res.status(400).json({ error: "Agreement is not ready for customer approval" });
    }
    if (ag.recordset[0].CustomerApprovalStatus === CrmStatus.APPROVED) {
      return res.status(400).json({ error: "Agreement has already been approved" });
    }
    const agreementRow = ag.recordset[0];
    const agreementId = agreementRow.Id;

    if (decision === "Approve") {
      await pool.request()
        .input("id", sql.Int, agreementId)
        .query(`
          UPDATE dbo.CrmAgreement SET
            CustomerApprovalStatus = '${CrmStatus.APPROVED}', CustomerApprovedAt = SYSDATETIME()
          WHERE Id = @id
        `);
      // proposedDate here is optional — the customer approving content and
      // proposing/responding on the date in one step. Not a hard requirement:
      // if turn-taking blocks it (e.g. nothing's been proposed by the
      // company yet), that's a real validation error and should surface,
      // not be silently dropped, since money/date info would otherwise
      // vanish without the customer knowing.
      if (proposedDate) {
        await proposeAgreementDate(pool, agreementId, "Customer", proposedDate, null);
      }
      await syncLegalMilestoneStep(pool, agreementRow.BookingId, "MutualAgreement", null);
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

      await pool.request()
        .input("agid", sql.Int, agreementId)
        .input("ver",  sql.Int, agreementRow.VersionNo)
        .input("adt",  sql.Date, agreementRow.AgreementDate)
        .input("lname",sql.NVarChar(300), agreementRow.LegalName)
        .input("laddr",sql.NVarChar(sql.MAX), agreementRow.LegalAddress)
        .input("pan",  sql.NVarChar(20), agreementRow.PanNo)
        .input("aadh", sql.NVarChar(20), agreementRow.AadhaarNo)
        .input("note", sql.NVarChar(sql.MAX), agreementRow.Notes)
        .input("reason", sql.NVarChar(500), `Customer recheck requested: ${remarks}`)
        .query(`
          INSERT INTO dbo.CrmAgreementRevision
            (AgreementId, VersionNo, AgreementDate, LegalName, LegalAddress, PanNo, AadhaarNo, Notes, Reason, CreatedBy, CreatedAt)
          VALUES (@agid, @ver, @adt, @lname, @laddr, @pan, @aadh, @note, @reason, NULL, SYSDATETIME())
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

    if (agreementRow.AssignedTo) {
      await emitNotification(pool, agreementRow.AssignedTo,
        decision === "Approve" ? "crm_agreement_customer_approved" : "crm_agreement_recheck_requested",
        decision === "Approve" ? "Agreement Approved by Customer" : "Agreement Recheck Requested",
        decision === "Approve"
          ? `${agreementRow.ApplicantName} approved agreement ${agreementRow.AgreementNo} (${agreementRow.BookingNo}).`
          : `${agreementRow.ApplicantName} requested a recheck on agreement ${agreementRow.AgreementNo} (${agreementRow.BookingNo}): ${remarks}`,
        agreementId, "crm_agreement");
    }
    await logCommunication(pool, {
      bookingId: agreementRow.BookingId, direction: "Inbound",
      subject: decision === "Approve" ? "Customer approved the agreement" : "Customer requested a recheck",
      summary: decision === "Approve"
        ? `${agreementRow.ApplicantName} approved ${agreementRow.AgreementNo}.`
        : `${agreementRow.ApplicantName} requested a recheck on ${agreementRow.AgreementNo}: ${remarks}`,
    });

    res.json({ success: true });
  } catch (e) {
    console.error("[crm-portal] POST /agreement/respond error:", e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

// POST /agreement/propose-date — requires ?applicationId=
router.post("/agreement/propose-date", async (req, res) => {
  try {
    const pool = getPool();
    const appId = await resolveAndAssertApplication(pool, req, res);
    if (appId === null) return;
    const { proposedDate } = req.body;
    if (!proposedDate) return res.status(400).json({ error: "proposedDate is required" });

    const ag = await pool.request().input("aid", sql.Int, appId).query(`
      SELECT ag.Id, ag.CustomerApprovalStatus, ag.AgreementNo, ag.BookingId, b.AssignedTo, b.BookingNo, a.ApplicantName
      FROM dbo.CrmAgreement ag
      JOIN dbo.CrmBooking b ON b.Id = ag.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      WHERE b.ApplicationId = @aid AND ag.SentToCustomerAt IS NOT NULL
    `);
    if (!ag.recordset.length) return res.status(404).json({ error: "No agreement found" });
    const agreementRow = ag.recordset[0];
    if (agreementRow.CustomerApprovalStatus !== CrmStatus.APPROVED) {
      return res.status(400).json({ error: "Approve the agreement's content before proposing a date" });
    }
    const agreementId = agreementRow.Id;

    await proposeAgreementDate(pool, agreementId, "Customer", proposedDate, null);

    if (agreementRow.AssignedTo) {
      await emitNotification(pool, agreementRow.AssignedTo,
        "crm_agreement_customer_proposed_date", "Customer Proposed an Agreement Date",
        `${agreementRow.ApplicantName} proposed ${proposedDate} for ${agreementRow.AgreementNo} (${agreementRow.BookingNo}) — review and confirm or revise.`,
        agreementId, "crm_agreement");
    }
    await logCommunication(pool, {
      bookingId: agreementRow.BookingId, direction: "Inbound",
      subject: `Customer proposed a date — ${proposedDate}`,
      summary: `${agreementRow.AgreementNo}: ${agreementRow.ApplicantName} proposed ${proposedDate}.`,
    });

    res.json({ success: true });
  } catch (e) {
    console.error("[crm-portal] POST /agreement/propose-date error:", e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

// POST /agreement/date/accept — requires ?applicationId=. Customer accepts
// the company's currently-proposed date as-is, without re-typing it. Moves
// the negotiation to 'Matched' and opens the super_admin sign-off gate —
// same as a same-date match did under the old two-column design.
router.post("/agreement/date/accept", async (req, res) => {
  try {
    const pool = getPool();
    const appId = await resolveAndAssertApplication(pool, req, res);
    if (appId === null) return;

    const ag = await pool.request().input("aid", sql.Int, appId).query(`
      SELECT ag.Id, ag.CustomerApprovalStatus, ag.AgreementNo, ag.BookingId, ag.ProposedDate, b.AssignedTo, b.BookingNo, a.ApplicantName
      FROM dbo.CrmAgreement ag
      JOIN dbo.CrmBooking b ON b.Id = ag.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      WHERE b.ApplicationId = @aid AND ag.SentToCustomerAt IS NOT NULL
    `);
    if (!ag.recordset.length) return res.status(404).json({ error: "No agreement found" });
    const agreementRow = ag.recordset[0];
    if (agreementRow.CustomerApprovalStatus !== CrmStatus.APPROVED) {
      return res.status(400).json({ error: "Approve the agreement's content before responding to a proposed date" });
    }
    const agreementId = agreementRow.Id;

    await acceptAgreementDate(pool, agreementId, "Customer");

    if (agreementRow.AssignedTo) {
      await emitNotification(pool, agreementRow.AssignedTo,
        "crm_agreement_date_pending_approval", "Agreement Date Awaiting Approval",
        `${agreementRow.ApplicantName} accepted our proposed date for ${agreementRow.AgreementNo} (${agreementRow.BookingNo}) — awaiting super admin sign-off.`,
        agreementId, "crm_agreement");
    }
    await logCommunication(pool, {
      bookingId: agreementRow.BookingId, direction: "Inbound",
      subject: "Customer accepted the proposed date — sent for approval",
      summary: `${agreementRow.AgreementNo}: ${agreementRow.ApplicantName} accepted ${String(agreementRow.ProposedDate).slice(0, 10)}, sent for super admin sign-off.`,
    });

    res.json({ success: true });
  } catch (e) {
    console.error("[crm-portal] POST /agreement/date/accept error:", e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

// POST /sales-deed/respond — requires ?applicationId=
router.post("/sales-deed/respond", async (req, res) => {
  try {
    const pool = getPool();
    const appId = await resolveAndAssertApplication(pool, req, res);
    if (appId === null) return;
    const { decision, remarks } = req.body;
    if (!["Approve", "Recheck"].includes(decision)) return res.status(400).json({ error: "decision must be Approve or Recheck" });
    if (decision === "Recheck" && !String(remarks || "").trim()) {
      return res.status(400).json({ error: "Remarks are required when requesting a recheck" });
    }

    const deed = await pool.request().input("aid", sql.Int, appId).query(`
      SELECT d.Id, d.CustomerApprovalStatus, d.DeedNo, d.BookingId, b.AssignedTo, b.BookingNo, a.ApplicantName
      FROM dbo.CrmSalesDeed d
      JOIN dbo.CrmBooking b ON b.Id = d.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      WHERE b.ApplicationId = @aid AND d.SentToCustomerAt IS NOT NULL
    `);
    if (!deed.recordset.length) return res.status(404).json({ error: "No sales deed pending your response" });
    if (deed.recordset[0].CustomerApprovalStatus === CrmStatus.APPROVED) {
      return res.status(400).json({ error: "Sales deed has already been approved" });
    }
    const deedRow = deed.recordset[0];

    if (decision === "Approve") {
      await pool.request()
        .input("id", sql.Int, deedRow.Id)
        .query(`
          UPDATE dbo.CrmSalesDeed SET
            CustomerApprovalStatus = '${CrmStatus.APPROVED}',
            CustomerApprovedAt = SYSDATETIME(),
            CustomerRecheckRemarks = NULL,
            DirectorApprovalStatus = '${CrmStatus.PENDING}'
          WHERE Id = @id
        `);
    } else {
      await pool.request()
        .input("id", sql.Int, deedRow.Id)
        .input("rem", sql.NVarChar(sql.MAX), remarks)
        .query(`
          UPDATE dbo.CrmSalesDeed SET
            CustomerApprovalStatus = 'RecheckRequested',
            CustomerApprovedAt = NULL,
            CustomerRecheckRemarks = @rem
          WHERE Id = @id
        `);
    }

    if (deedRow.AssignedTo) {
      await emitNotification(pool, deedRow.AssignedTo,
        decision === "Approve" ? "crm_sales_deed_customer_approved" : "crm_sales_deed_recheck_requested",
        decision === "Approve" ? "Sales Deed Approved by Customer" : "Sales Deed Recheck Requested",
        decision === "Approve"
          ? `${deedRow.ApplicantName} approved sale deed ${deedRow.DeedNo} (${deedRow.BookingNo}).`
          : `${deedRow.ApplicantName} requested a recheck on sale deed ${deedRow.DeedNo} (${deedRow.BookingNo}): ${remarks}`,
        deedRow.Id, "crm_sales_deed");
    }
    await logCommunication(pool, {
      bookingId: deedRow.BookingId, direction: "Inbound",
      subject: decision === "Approve" ? "Customer approved the sales deed" : "Customer requested a recheck on sales deed",
      summary: decision === "Approve"
        ? `${deedRow.ApplicantName} approved ${deedRow.DeedNo}.`
        : `${deedRow.ApplicantName} requested a recheck on ${deedRow.DeedNo}: ${remarks}`,
    });

    res.json({ success: true });
  } catch (e) {
    console.error("[crm-portal] POST /sales-deed/respond error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// POST /possession-notice/respond — requires ?applicationId=
router.post("/possession-notice/respond", async (req, res) => {
  try {
    const pool = getPool();
    const appId = await resolveAndAssertApplication(pool, req, res);
    if (appId === null) return;
    const { decision, reason } = req.body;
    if (!["Acknowledge", "Dispute"].includes(decision)) return res.status(400).json({ error: "decision must be Acknowledge or Dispute" });
    if (decision === "Dispute" && !String(reason || "").trim()) {
      return res.status(400).json({ error: "A reason is required to dispute the possession notice" });
    }

    const notice = await pool.request().input("aid", sql.Int, appId).query(`
      SELECT n.Id, n.Status, n.NoticeNo, n.BookingId, b.AssignedTo, b.BookingNo, a.ApplicantName
      FROM dbo.CrmPossessionNotice n
      JOIN dbo.CrmBooking b ON b.Id = n.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      WHERE b.ApplicationId = @aid AND n.Status <> 'Draft'
      ORDER BY n.CreatedAt DESC
    `);
    if (!notice.recordset.length) return res.status(404).json({ error: "No possession notice found" });
    const row = notice.recordset[0];
    if (row.Status !== "Sent") {
      return res.status(400).json({ error: `Cannot respond to a notice in status '${row.Status}'` });
    }

    await pool.request().input("id", sql.Int, row.Id).input("reason", sql.NVarChar(sql.MAX), reason || null).query(
      decision === "Acknowledge"
        ? "UPDATE dbo.CrmPossessionNotice SET Status = 'Acknowledged', AcknowledgedAt = SYSDATETIME() WHERE Id = @id"
        : "UPDATE dbo.CrmPossessionNotice SET Status = 'Disputed', DisputedAt = SYSDATETIME(), DisputeReason = @reason WHERE Id = @id"
    );

    if (row.AssignedTo) {
      await emitNotification(pool, row.AssignedTo,
        decision === "Acknowledge" ? "crm_possession_notice_acknowledged" : "crm_possession_notice_disputed",
        decision === "Acknowledge" ? "Possession Notice Acknowledged" : "Possession Notice Disputed",
        decision === "Acknowledge"
          ? `${row.ApplicantName} acknowledged ${row.NoticeNo} (${row.BookingNo}).`
          : `${row.ApplicantName} disputed ${row.NoticeNo} (${row.BookingNo}): ${reason}`,
        row.Id, "crm_possession_notice");
    }
    await logCommunication(pool, {
      bookingId: row.BookingId, direction: "Inbound",
      subject: decision === "Acknowledge" ? "Customer acknowledged possession notice" : "Customer disputed possession notice",
      summary: decision === "Acknowledge"
        ? `${row.ApplicantName} acknowledged ${row.NoticeNo}.`
        : `${row.ApplicantName} disputed ${row.NoticeNo}: ${reason}`,
    });

    res.json({ success: true });
  } catch (e) {
    console.error("[crm-portal] POST /possession-notice/respond error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// ─── Query Payment ──────────────────────────────────────────────────────────
// The customer's own government payment (stamp duty + registration fee, paid
// directly to the Sub-Registrar Office, never to the company — see
// crmQueryPayment.js). The customer needs to: see the amount + paperwork
// staff sent them, and upload their own proof of payment once they've paid.
// Staff still does the actual "Confirm" step (crmQueryPayment.js POST
// /:id/confirm) — this only gets the proof in front of them.
const QP_MAX_FILE_BYTES = 4 * 1024 * 1024;

// GET /query-payment/attachments — requires ?applicationId=
router.get("/query-payment/attachments", async (req, res) => {
  try {
    const pool = getPool();
    const appId = await resolveAndAssertApplication(pool, req, res);
    if (appId === null) return;
    const result = await pool.request().input("aid", sql.Int, appId).query(`
      SELECT att.AttachmentId, att.DocType, att.FileName, att.MimeType, att.FileSize, att.UploadedAt
      FROM dbo.CrmQueryPaymentAttachments att
      JOIN dbo.CrmQueryPayment qp ON qp.Id = att.QueryPaymentId
      JOIN dbo.CrmBooking b ON b.Id = qp.BookingId
      WHERE b.ApplicationId = @aid
      ORDER BY att.UploadedAt DESC
    `);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-portal] GET /query-payment/attachments error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// GET /query-payment/attachment/:attachId/file — requires ?applicationId=
router.get("/query-payment/attachment/:attachId/file", async (req, res) => {
  try {
    const pool = getPool();
    const appId = await resolveAndAssertApplication(pool, req, res);
    if (appId === null) return;
    const attachId = parseInt(req.params.attachId, 10);
    const result = await pool.request().input("aid", sql.Int, appId).input("said", sql.Int, attachId).query(`
      SELECT att.FileName, att.MimeType, att.FileData
      FROM dbo.CrmQueryPaymentAttachments att
      JOIN dbo.CrmQueryPayment qp ON qp.Id = att.QueryPaymentId
      JOIN dbo.CrmBooking b ON b.Id = qp.BookingId
      WHERE b.ApplicationId = @aid AND att.AttachmentId = @said
    `);
    if (!result.recordset.length) return res.status(404).json({ error: "Attachment not found" });
    const att = result.recordset[0];
    res.setHeader("Content-Type", att.MimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(att.FileName)}"`);
    res.send(att.FileData);
  } catch (e) {
    console.error("[crm-portal] GET /query-payment/attachment/:id/file error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// POST /query-payment/proof — requires ?applicationId=. Base64 JSON body
// (same convention as the staff-side route), decoded back into the exact
// bytes stored in the existing VARBINARY(MAX) column. Never flips Status —
// only staff confirming (crmQueryPayment.js) does that, since they're the
// ones who can actually verify the government received the payment.
router.post("/query-payment/proof", async (req, res) => {
  try {
    const pool = getPool();
    const appId = await resolveAndAssertApplication(pool, req, res);
    if (appId === null) return;
    const { fileName, mimeType, base64 } = req.body || {};
    if (!fileName || !base64) return res.status(400).json({ error: "fileName and base64 are required" });
    const buffer = Buffer.from(base64, "base64");
    if (!buffer.length) return res.status(400).json({ error: "File is empty" });
    if (buffer.length > QP_MAX_FILE_BYTES) {
      return res.status(400).json({ error: `File is too large (max ${(QP_MAX_FILE_BYTES / 1024 / 1024).toFixed(0)}MB)` });
    }

    const qp = await pool.request().input("aid", sql.Int, appId).query(`
      SELECT qp.Id, qp.QPNo, qp.Status, qp.BookingId, b.AssignedTo, b.BookingNo, a.ApplicantName
      FROM dbo.CrmQueryPayment qp
      JOIN dbo.CrmBooking b ON b.Id = qp.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      WHERE b.ApplicationId = @aid
    `);
    if (!qp.recordset.length) return res.status(404).json({ error: "No government payment tracker found for this booking" });
    const row = qp.recordset[0];
    if (row.Status === "Confirmed") return res.status(400).json({ error: "Already confirmed — no further proof needed" });

    await pool.request()
      .input("qpid", sql.Int, row.Id)
      .input("dtype", sql.NVarChar(20), "Proof")
      .input("fname", sql.NVarChar(255), fileName)
      .input("mtype", sql.NVarChar(100), mimeType || "application/octet-stream")
      .input("fsize", sql.Int, buffer.length)
      .input("fdata", sql.VarBinary(sql.MAX), buffer)
      .query(`
        INSERT INTO dbo.CrmQueryPaymentAttachments (QueryPaymentId, DocType, FileName, MimeType, FileSize, FileData)
        VALUES (@qpid, @dtype, @fname, @mtype, @fsize, @fdata)
      `);

    if (row.AssignedTo) {
      await emitNotification(pool, row.AssignedTo, "crm_query_payment_proof_uploaded", "Payment Proof Uploaded by Customer",
        `${row.ApplicantName} uploaded proof of government payment for ${row.QPNo} (${row.BookingNo}) — review and confirm.`,
        row.Id, "crm_query_payment");
    }
    await logCommunication(pool, {
      bookingId: row.BookingId, direction: "Inbound",
      subject: "Customer uploaded government payment proof",
      summary: `${row.ApplicantName} uploaded proof of payment for ${row.QPNo} — awaiting staff confirmation.`,
    });

    res.json({ success: true });
  } catch (e) {
    console.error("[crm-portal] POST /query-payment/proof error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// GET /tickets — requires ?applicationId=
router.get("/tickets", async (req, res) => {
  try {
    const pool = getPool();
    const appId = await resolveAndAssertApplication(pool, req, res);
    if (appId === null) return;
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
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// POST /tickets — requires ?applicationId=
router.post("/tickets", async (req, res) => {
  try {
    const pool = getPool();
    const appId = await resolveAndAssertApplication(pool, req, res);
    if (appId === null) return;
    const { category, subject, description } = req.body;
    if (!CUSTOMER_TICKET_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: `category must be one of: ${CUSTOMER_TICKET_CATEGORIES.join(", ")}` });
    }
    if (!String(subject || "").trim()) return res.status(400).json({ error: "subject is required" });

    const booking = await pool.request().input("aid", sql.Int, appId)
      .query("SELECT TOP 1 Id FROM dbo.CrmBooking WHERE ApplicationId = @aid AND IsActive = 1 AND Status <> 'Cancelled' ORDER BY CreatedAt DESC");
    if (!booking.recordset.length) return res.status(400).json({ error: "No active booking found for this application" });
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
    await logCommunication(pool, {
      bookingId, direction: "Inbound",
      subject: `Support ticket raised — ${subject.trim()}`,
      summary: `${ticketNo} (${category}): ${description || subject.trim()}`,
    });

    res.status(201).json({ success: true, id: result.recordset[0].Id, TicketNo: ticketNo });
  } catch (e) {
    console.error("[crm-portal] POST /tickets error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// Only these CrmAgreementApprovalLog actions are safe to show a customer —
// everything else (SeniorApprove/SeniorReject, internal review) is staff-only.
const CUSTOMER_VISIBLE_LOG_ACTIONS = [
  "SendToCustomer", "CustomerApprove", "CustomerRecheck",
  "AgreementDateSubmittedForApproval", "AgreementDateConfirmed", "AgreementDateRejected",
];

// GET /activity — chronological feed for one application. Requires ?applicationId=
router.get("/activity", async (req, res) => {
  try {
    const pool = getPool();
    const appId = await resolveAndAssertApplication(pool, req, res);
    if (appId === null) return;

    const [agreementLog, payments, documents, tickets, salesDeed, queryPayment, qpProofs, registry, nocs] = await Promise.all([
      pool.request().input("aid", sql.Int, appId)
        .query(`
          SELECT l.Action, l.Remarks, l.CreatedAt, ag.AgreementNo
          FROM dbo.CrmAgreementApprovalLog l
          JOIN dbo.CrmAgreement ag ON ag.Id = l.AgreementId
          JOIN dbo.CrmBooking b ON b.Id = ag.BookingId
          WHERE b.ApplicationId = @aid
            AND l.Action IN (${CUSTOMER_VISIBLE_LOG_ACTIONS.map((a) => `'${a}'`).join(",")})
          ORDER BY l.CreatedAt DESC
        `),
      pool.request().input("aid", sql.Int, appId).query(`
        SELECT r.Amount, r.ReceivedDate, r.PaymentMode, r.CreatedAt, m.MilestoneName
        FROM dbo.CrmPaymentReceipt r
        JOIN dbo.CrmPaymentMilestone m ON m.Id = r.MilestoneId
        JOIN dbo.CrmBooking b ON b.Id = m.BookingId
        WHERE b.ApplicationId = @aid
        ORDER BY r.CreatedAt DESC
      `),
      pool.request().input("aid", sql.Int, appId).query(`
        SELECT d.DocumentType, d.Label, d.Status, d.Remarks, d.UploadedAt, ISNULL(d.UploadedAt, d.CreatedAt) AS EventAt
        FROM dbo.CrmAgreementDocument d
        JOIN dbo.CrmAgreement ag ON ag.Id = d.AgreementId
        JOIN dbo.CrmBooking b ON b.Id = ag.BookingId
        WHERE b.ApplicationId = @aid AND d.Status IN ('Verified', '${CrmStatus.REJECTED}', 'Submitted')
        ORDER BY EventAt DESC
      `),
      pool.request().input("aid", sql.Int, appId).query(`
        SELECT t.TicketNo, t.Subject, t.Status, t.ResolvedAt, t.CreatedAt
        FROM dbo.CrmServiceTicket t
        JOIN dbo.CrmBooking b ON b.Id = t.BookingId
        WHERE b.ApplicationId = @aid
        ORDER BY t.CreatedAt DESC
      `),
      // Sales Deed has no dedicated approval-log table like Agreement does —
      // its own timestamp columns (SentToCustomerAt/CustomerApprovedAt/
      // UpdatedAt) are the only record of when each customer-facing event
      // actually happened, so those are what the feed reads.
      pool.request().input("aid", sql.Int, appId).query(`
        SELECT sd.DeedNo, sd.SentToCustomerAt, sd.CustomerApprovalStatus, sd.CustomerApprovedAt, sd.CustomerRecheckRemarks, sd.UpdatedAt
        FROM dbo.CrmSalesDeed sd
        JOIN dbo.CrmBooking b ON b.Id = sd.BookingId
        WHERE b.ApplicationId = @aid
      `),
      pool.request().input("aid", sql.Int, appId).query(`
        SELECT qp.Id, qp.QPNo, qp.InfoSentAt, qp.ConfirmedAt, qp.ConfirmedAmount
        FROM dbo.CrmQueryPayment qp
        JOIN dbo.CrmBooking b ON b.Id = qp.BookingId
        WHERE b.ApplicationId = @aid
      `),
      pool.request().input("aid", sql.Int, appId).query(`
        SELECT att.FileName, att.UploadedAt
        FROM dbo.CrmQueryPaymentAttachments att
        JOIN dbo.CrmQueryPayment qp ON qp.Id = att.QueryPaymentId
        JOIN dbo.CrmBooking b ON b.Id = qp.BookingId
        WHERE b.ApplicationId = @aid AND att.DocType = 'Proof'
        ORDER BY att.UploadedAt DESC
      `),
      pool.request().input("aid", sql.Int, appId).query(`
        SELECT reg.RegNo, reg.Status, reg.ScheduledDate, reg.CompletedDate, reg.UpdatedAt
        FROM dbo.CrmRegistry reg
        JOIN dbo.CrmBooking b ON b.Id = reg.BookingId
        WHERE b.ApplicationId = @aid
      `),
      pool.request().input("aid", sql.Int, appId).query(`
        SELECT n.NocType, n.NocNo, n.IssuedDate
        FROM dbo.CrmNoc n
        JOIN dbo.CrmBooking b ON b.Id = n.BookingId
        WHERE b.ApplicationId = @aid AND n.IssuedDate IS NOT NULL
      `),
    ]);

    const feed = [];
    const AGREEMENT_LOG_LABELS = {
      SendToCustomer: (r) => ({ title: "Agreement shared with you", detail: r.AgreementNo }),
      CustomerApprove: (r) => ({ title: "You approved the agreement", detail: r.AgreementNo }),
      CustomerRecheck: (r) => ({ title: "You requested a recheck", detail: r.Remarks || r.AgreementNo }),
      AgreementDateSubmittedForApproval: (r) => ({ title: "Agreement date matched — sent for approval", detail: r.AgreementNo }),
      AgreementDateConfirmed: (r) => ({ title: "Agreement date confirmed", detail: r.AgreementNo }),
      AgreementDateRejected: (r) => ({ title: "Proposed date was not accepted", detail: r.Remarks || r.AgreementNo }),
    };
    for (const r of agreementLog.recordset) {
      const fn = AGREEMENT_LOG_LABELS[r.Action];
      if (!fn) continue;
      const { title, detail } = fn(r);
      feed.push({ type: "agreement", title, detail, at: r.CreatedAt });
    }
    for (const r of payments.recordset) {
      feed.push({ type: "payment", title: `Payment received — ${r.MilestoneName}`, detail: `₹${Number(r.Amount).toLocaleString("en-IN")}${r.PaymentMode ? ` via ${r.PaymentMode}` : ""}`, at: r.CreatedAt });
    }
    for (const r of documents.recordset) {
      const label = r.Label || r.DocumentType?.replace(/([A-Z])/g, " $1").trim();
      feed.push({
        type: "document",
        title: r.Status === "Verified" ? `Document verified — ${label}` : r.Status === CrmStatus.REJECTED ? `Document returned — ${label}` : `Document submitted — ${label}`,
        detail: r.Status === CrmStatus.REJECTED ? r.Remarks : null,
        at: r.EventAt,
      });
    }
    for (const r of tickets.recordset) {
      feed.push({ type: "ticket", title: `Ticket raised — ${r.Subject}`, detail: r.TicketNo, at: r.CreatedAt });
      if (r.ResolvedAt) {
        feed.push({ type: "ticket", title: `Ticket resolved — ${r.Subject}`, detail: r.TicketNo, at: r.ResolvedAt });
      }
    }

    // Sales Deed — same "agreement" bucket as the Agreement events above,
    // since they live on the same portal page and represent the same kind
    // of customer decision.
    const sd = salesDeed.recordset[0];
    if (sd) {
      if (sd.SentToCustomerAt) feed.push({ type: "agreement", title: "Sales deed shared with you", detail: sd.DeedNo, at: sd.SentToCustomerAt });
      if (sd.CustomerApprovedAt) feed.push({ type: "agreement", title: "You approved the sales deed", detail: sd.DeedNo, at: sd.CustomerApprovedAt });
      else if (sd.CustomerApprovalStatus === "RecheckRequested") feed.push({ type: "agreement", title: "You requested a recheck on the sales deed", detail: sd.CustomerRecheckRemarks || sd.DeedNo, at: sd.UpdatedAt });
    }

    // Query Payment, Registry, NOC — grouped under "legal" (the same journey
    // shown on the Agreement page's Government Payment/Registry/NOC cards),
    // distinct from the "agreement" bucket above.
    const qp = queryPayment.recordset[0];
    if (qp) {
      if (qp.InfoSentAt) feed.push({ type: "legal", title: "Government payment details sent to you", detail: qp.QPNo, at: qp.InfoSentAt });
      if (qp.ConfirmedAt) feed.push({ type: "legal", title: "Government payment confirmed", detail: qp.ConfirmedAmount ? `₹${Number(qp.ConfirmedAmount).toLocaleString("en-IN")}` : qp.QPNo, at: qp.ConfirmedAt });
    }
    for (const r of qpProofs.recordset) {
      feed.push({ type: "legal", title: "You uploaded proof of payment", detail: r.FileName, at: r.UploadedAt });
    }
    const reg = registry.recordset[0];
    if (reg) {
      if (reg.ScheduledDate) feed.push({ type: "legal", title: "Registry appointment scheduled", detail: `${reg.RegNo} · ${new Date(reg.ScheduledDate).toLocaleDateString("en-IN")}`, at: reg.ScheduledDate });
      if (reg.CompletedDate) feed.push({ type: "legal", title: "Registry completed", detail: reg.RegNo, at: reg.CompletedDate });
    }
    for (const r of nocs.recordset) {
      feed.push({ type: "legal", title: `${r.NocType} NOC issued`, detail: r.NocNo, at: r.IssuedDate });
    }

    feed.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    res.json(feed);
  } catch (e) {
    console.error("[crm-portal] GET /activity error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

module.exports = router;