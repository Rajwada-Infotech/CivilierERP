const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const router = express.Router();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { getPool, sql } = require("../db");
const portalAuth = require("../middleware/crmPortalAuth");
const { getNextDocNumber } = require("../services/docNumber");
const { emitNotification } = require("../services/notify");
const { maybeResolveAgreementDate, syncLegalMilestoneStep } = require("../services/crmWorkflowGuards");
const { logCommunication } = require("../services/crmCommunicationLog");

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

// Server-side enforcement of (1) account deactivation and (2) the forced
// first-login password reset. The JWT itself carries neither signal and is
// valid for 7 days regardless — until now nothing re-checked either flag
// per-request, so:
//   - staff deactivating a portal account (IsActive=0) had no actual effect
//     until the customer's existing token happened to expire on its own
//   - a customer could keep using the account indefinitely, still on the
//     mobile-number password, by navigating directly to any other portal
//     URL instead of the one that forces a reset right after login
// IsActive is checked first and blocks EVERY route with no exception (a
// deactivated account can't even reach /change-password — there's nothing
// left to protect access to). MustChangePassword only blocks routes other
// than /change-password, which is the one place that actually resolves it.
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
    res.status(500).json({ error: e.message });
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

    const [welcomeCall, customerDetails, agreement, milestones, deed, handover, possessionNotice, constructionUpdates, legalMilestone, nocs, prePossession] = await Promise.all([
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
               ProposedDateByCompany, ProposedDateByCustomer, AgreementDate, DateApprovalStatus, LastRecheckRemarks, SentToCustomerAt,
               (SELECT COUNT(*) FROM dbo.CrmAgreementDocument d WHERE d.AgreementId = CrmAgreement.Id) AS DocumentCount,
               (SELECT COUNT(*) FROM dbo.CrmAgreementDocument d WHERE d.AgreementId = CrmAgreement.Id AND d.Status IN ('Requested','Rejected')) AS DocumentsNeedingAction
        FROM dbo.CrmAgreement WHERE BookingId = @bid
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
      // Construction progress is a project-wide broadcast (Foundation/
      // Superstructure/etc apply to every unit in the project, not just this
      // customer's), so it's matched on the booking's real ProjectId — the
      // same link every other module inherits — not a free-text project name.
      bk.ProjectId
        ? pool.request().input("pid", sql.Int, bk.ProjectId)
            .query("SELECT UpdateDate, PercentComplete, Stage, Summary FROM dbo.CrmConstructionUpdate WHERE ProjectId = @pid ORDER BY UpdateDate DESC")
        : Promise.resolve({ recordset: [] }),
      pool.request().input("bid", sql.Int, bk.Id).query("SELECT OverallStatus FROM dbo.CrmLegalMilestone WHERE BookingId = @bid"),
      pool.request().input("bid", sql.Int, bk.Id).query("SELECT NocType, Status FROM dbo.CrmNoc WHERE BookingId = @bid"),
      pool.request().input("bid", sql.Int, bk.Id).query("SELECT Status, ScheduledInspectionDate FROM dbo.CrmPrePossession WHERE BookingId = @bid"),
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
        items: nocs.recordset.map((n) => ({ type: n.NocType, status: n.Status })),
      },
      prePossession: prePossession.recordset[0]
        ? { status: prePossession.recordset[0].Status, scheduledDate: prePossession.recordset[0].ScheduledInspectionDate }
        : null,
    });
  } catch (e) {
    console.error("[crm-portal] GET /timeline error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /agreement — full agreement text/terms once it has been sent to the customer
// GET /invoices — every invoice generated for the customer's booking(s),
// visible the moment staff generates one (no separate "send" gate — an
// invoice is a record of a real transaction the customer is entitled to
// see, unlike the Agreement/Sales Deed which need a deliberate publish
// step for a document still being negotiated).
router.get("/invoices", async (req, res) => {
  try {
    const pool = getPool();
    const appId = req.portalUser.applicationId;
    const result = await pool.request().input("aid", sql.Int, appId).query(`
      SELECT inv.Id, inv.InvoiceNo, inv.InvoiceType, inv.Amount, inv.InvoiceDate, inv.Description, inv.Status, inv.CreatedAt,
             b.BookingNo, b.UnitNo
      FROM dbo.CrmInvoice inv
      JOIN dbo.CrmBooking b ON b.Id = inv.BookingId
      WHERE b.ApplicationId = @aid
      ORDER BY inv.CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-portal] GET /invoices error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.get("/agreement", async (req, res) => {
  try {
    const pool = getPool();
    const appId = req.portalUser.applicationId;
    const result = await pool.request().input("aid", sql.Int, appId).query(`
      SELECT ag.Id, ag.AgreementNo, ag.Status, ag.AgreementDate, ag.LegalName, ag.LegalAddress,
             ag.PanNo, ag.AadhaarNo, ag.VersionNo, ag.CreatedAt,
             ag.SeniorApprovalStatus, ag.SeniorApprovedAt,
             ag.CustomerApprovalStatus, ag.CustomerApprovedAt, ag.RecheckCount,
             ag.ProposedDateByCompany, ag.ProposedDateByCustomer, ag.DateApprovalStatus,
             ag.SentToCustomerAt, ag.LastRecheckRemarks,
             b.BookingNo, b.UnitNo, b.ProjectName, b.TotalValue, b.BookingDate
      FROM dbo.CrmAgreement ag
      JOIN dbo.CrmBooking b ON b.Id = ag.BookingId
      WHERE b.ApplicationId = @aid AND ag.SentToCustomerAt IS NOT NULL
    `);
    // Not having an agreement shared yet is a normal, expected state for a
    // customer early in their journey — not an error — so this returns 200
    // with a null body instead of 404, same as every other "nothing yet"
    // lookup in this file (loan detail, bank detail, etc.).
    res.json(result.recordset[0] || null);
  } catch (e) {
    console.error("[crm-portal] GET /agreement error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

const AGREEMENT_UPLOAD_DIR = path.join(__dirname, "../uploads/crm-agreement-documents");
if (!fs.existsSync(AGREEMENT_UPLOAD_DIR)) fs.mkdirSync(AGREEMENT_UPLOAD_DIR, { recursive: true });

// GET /agreement/documents — every document attached to the customer's own
// agreement, once it's been shared. Scoped strictly to their own
// ApplicationId — a customer can never see another buyer's documents.
// Includes documents staff has *requested* but the customer hasn't uploaded
// yet (Status='Requested', no file) so the portal can prompt for them.
router.get("/agreement/documents", async (req, res) => {
  try {
    const pool = getPool();
    const appId = req.portalUser.applicationId;
    const result = await pool.request().input("aid", sql.Int, appId).query(`
      SELECT d.Id, d.DocumentType, d.Label, d.IsMandatory, d.UploadedByType,
             d.FileName, d.FileSize, d.MimeType, d.Status, d.Remarks, d.VersionNo,
             d.RequestedAt, d.UploadedAt, d.CreatedAt
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

const portalDocStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, AGREEMENT_UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${Date.now()}_${Math.round(Math.random() * 1e9)}_${safe}`);
  },
});
const portalDocUpload = multer({
  storage: portalDocStorage,
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

// Deletes a just-uploaded temp file, but only after confirming it actually
// resolves inside AGREEMENT_UPLOAD_DIR — multer's own filename() above
// already strips anything but [a-zA-Z0-9._-] from the original filename
// before writing to disk, so req.file.path can't genuinely escape that
// directory, but this makes the guarantee explicit at the point of deletion
// rather than relying on that sanitization alone (and satisfies static
// analysis that can't trace through the multer storage config).
function safeUnlinkUpload(filePath) {
  if (!filePath) return;
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(AGREEMENT_UPLOAD_DIR) + path.sep)) return;
  fs.unlink(resolved, () => {});
}

// POST /agreement/documents/:docId/upload — the customer fulfils a document
// staff requested (or re-submits after a rejection). Only ever allowed
// against their own agreement's document rows, and only while that row is
// still open for submission — a document already Verified (or one that was
// never requested from them, i.e. a staff-attached exhibit) can't be
// touched from this endpoint.
router.post("/agreement/documents/:docId/upload", (req, res) => {
  portalDocUpload.single("file")(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    try {
      const pool = getPool();
      const appId = req.portalUser.applicationId;
      const docId = parseInt(req.params.docId, 10);

      const check = await pool.request().input("aid", sql.Int, appId).input("did", sql.Int, docId).query(`
        SELECT d.Id, d.Status, d.DocumentType, ag.AgreementNo, ag.BookingId, b.AssignedTo, b.BookingNo, a.ApplicantName
        FROM dbo.CrmAgreementDocument d
        JOIN dbo.CrmAgreement ag ON ag.Id = d.AgreementId
        JOIN dbo.CrmBooking b ON b.Id = ag.BookingId
        JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
        WHERE b.ApplicationId = @aid AND ag.SentToCustomerAt IS NOT NULL AND d.Id = @did
      `);
      if (!check.recordset.length) {
        safeUnlinkUpload(req.file.path);
        return res.status(404).json({ error: "Document not found" });
      }
      const doc = check.recordset[0];
      if (!["Requested", "Rejected"].includes(doc.Status)) {
        safeUnlinkUpload(req.file.path);
        return res.status(400).json({ error: "This document isn't open for upload" });
      }

      await pool.request()
        .input("id", sql.Int, docId)
        .input("fname", sql.NVarChar(300), req.file.originalname)
        .input("fp", sql.NVarChar(500), req.file.path)
        .input("fs", sql.BigInt, req.file.size)
        .input("mt", sql.NVarChar(150), req.file.mimetype)
        .query(`
          UPDATE dbo.CrmAgreementDocument SET
            FileName = @fname, FilePath = @fp, FileSize = @fs, MimeType = @mt,
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
      if (req.file) safeUnlinkUpload(req.file.path);
      console.error("[crm-portal] POST /agreement/documents/:docId/upload error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });
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
      SELECT ag.Id, ag.RecheckCount, ag.CustomerApprovalStatus, ag.SeniorApprovalStatus,
             ag.AgreementNo, ag.BookingId, b.AssignedTo, b.BookingNo, a.ApplicantName,
             ag.VersionNo, ag.AgreementDate, ag.LegalName, ag.LegalAddress, ag.PanNo, ag.AadhaarNo, ag.Notes
      FROM dbo.CrmAgreement ag
      JOIN dbo.CrmBooking b ON b.Id = ag.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      WHERE b.ApplicationId = @aid AND ag.SentToCustomerAt IS NOT NULL
    `);
    if (!ag.recordset.length) return res.status(404).json({ error: "No agreement pending your response" });
    if (ag.recordset[0].SeniorApprovalStatus !== "Approved") {
      return res.status(400).json({ error: "Agreement is not ready for customer approval" });
    }
    if (ag.recordset[0].CustomerApprovalStatus === "Approved") {
      return res.status(400).json({ error: "Agreement has already been approved" });
    }
    const agreementRow = ag.recordset[0];
    const agreementId = agreementRow.Id;

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
      // now matches the company's proposed date, it goes to a super_admin
      // for sign-off (DateApprovalStatus='Pending'), not straight to
      // AgreementDate.
      await maybeResolveAgreementDate(pool, agreementId);
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

      // Not a legal-content edit — VersionNo doesn't bump — but Version
      // History should still surface *why* the customer bounced it back,
      // not just silently sit at RecheckRequested. Snapshot the current
      // (unchanged) content, tagged with the customer's own remarks.
      // CreatedBy is NULL here (no staff actor — this came from the portal).
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

    // Staff never otherwise learns the customer acted — this is the
    // connection back from portal to CRM that closes the loop.
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
    res.status(500).json({ error: e.message });
  }
});

// POST /agreement/propose-date — the customer's side of date negotiation,
// independent of the Approve/Recheck decision. /agreement/respond only ever
// lets a proposed date piggyback on the *first* approval action and then
// blocks entirely once approved ("already been approved") — so if staff
// proposes a date only after the customer has already approved the
// agreement's content (the normal order per the workflow spec: content
// approval happens before date negotiation), the customer previously had no
// way to respond at all. This endpoint is the customer's mirror of the
// staff side's PUT /:id/propose-date, usable any time after approval.
router.post("/agreement/propose-date", async (req, res) => {
  try {
    const pool = getPool();
    const appId = req.portalUser.applicationId;
    const { proposedDate } = req.body;
    if (!proposedDate) return res.status(400).json({ error: "proposedDate is required" });

    const ag = await pool.request().input("aid", sql.Int, appId).query(`
      SELECT ag.Id, ag.CustomerApprovalStatus, ag.AgreementDate, ag.DateApprovalStatus, ag.AgreementNo, ag.BookingId, b.AssignedTo, b.BookingNo, a.ApplicantName
      FROM dbo.CrmAgreement ag
      JOIN dbo.CrmBooking b ON b.Id = ag.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      WHERE b.ApplicationId = @aid AND ag.SentToCustomerAt IS NOT NULL
    `);
    if (!ag.recordset.length) return res.status(404).json({ error: "No agreement found" });
    const agreementRow = ag.recordset[0];
    if (agreementRow.CustomerApprovalStatus !== "Approved") {
      return res.status(400).json({ error: "Approve the agreement's content before proposing a date" });
    }
    if (agreementRow.AgreementDate) {
      return res.status(400).json({ error: "The agreement date is already confirmed" });
    }
    if (agreementRow.DateApprovalStatus === "Pending") {
      return res.status(400).json({ error: "Your proposed date is already awaiting approval" });
    }
    const agreementId = agreementRow.Id;

    await pool.request()
      .input("agid", sql.Int, agreementId)
      .input("pd", sql.Date, proposedDate)
      .query(`
        INSERT INTO dbo.CrmAgreementDateHistory (AgreementId, ProposedBy, ProposedDate, CreatedAt)
        VALUES (@agid, 'Customer', @pd, SYSDATETIME())
      `);
    await pool.request()
      .input("id", sql.Int, agreementId)
      .input("pdc", sql.Date, proposedDate)
      .query("UPDATE dbo.CrmAgreement SET ProposedDateByCustomer = @pdc WHERE Id = @id");

    // A match here no longer confirms the date outright — it moves to
    // DateApprovalStatus='Pending' and waits on a super_admin sign-off
    // (PUT /:id/date/approve), same gate the company's own propose-date
    // action goes through.
    const submittedForApproval = await maybeResolveAgreementDate(pool, agreementId);

    if (agreementRow.AssignedTo) {
      await emitNotification(pool, agreementRow.AssignedTo,
        submittedForApproval ? "crm_agreement_date_pending_approval" : "crm_agreement_customer_proposed_date",
        submittedForApproval ? "Agreement Date Awaiting Approval" : "Customer Proposed an Agreement Date",
        submittedForApproval
          ? `${agreementRow.ApplicantName} matched our proposed date for ${agreementRow.AgreementNo} (${agreementRow.BookingNo}) — awaiting super admin sign-off.`
          : `${agreementRow.ApplicantName} proposed ${proposedDate} for ${agreementRow.AgreementNo} (${agreementRow.BookingNo}) — review and confirm.`,
        agreementId, "crm_agreement");
    }
    await logCommunication(pool, {
      bookingId: agreementRow.BookingId, direction: "Inbound",
      subject: submittedForApproval ? "Customer's date matched — sent for approval" : `Customer proposed a date — ${proposedDate}`,
      summary: `${agreementRow.AgreementNo}: ${agreementRow.ApplicantName} ${submittedForApproval ? "matched our proposed date, sent for super admin sign-off" : `proposed ${proposedDate}`}.`,
    });

    res.json({ success: true, agreementDateSubmittedForApproval: submittedForApproval });
  } catch (e) {
    console.error("[crm-portal] POST /agreement/propose-date error:", e.message);
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
      SELECT d.Id, d.CustomerApprovalStatus, d.DeedNo, d.BookingId, b.AssignedTo, b.BookingNo, a.ApplicantName
      FROM dbo.CrmSalesDeed d
      JOIN dbo.CrmBooking b ON b.Id = d.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      WHERE b.ApplicationId = @aid AND d.SentToCustomerAt IS NOT NULL
    `);
    if (!deed.recordset.length) return res.status(404).json({ error: "No sales deed pending your response" });
    if (deed.recordset[0].CustomerApprovalStatus === "Approved") {
      return res.status(400).json({ error: "Sales deed has already been approved" });
    }
    const deedRow = deed.recordset[0];

    if (decision === "Approve") {
      // Auto-flow: customer approval is one of the "both sides" — the
      // moment it lands, Director approval (the next gate before Handover)
      // opens up on its own, matching the spec's "APPROVAL FROM BOTH SIDES
      // -> DIRECTOR APPROVAL" chain instead of waiting on a separate manual
      // "submit for director approval" click.
      await pool.request()
        .input("id", sql.Int, deedRow.Id)
        .query(`
          UPDATE dbo.CrmSalesDeed SET
            CustomerApprovalStatus = 'Approved',
            CustomerApprovedAt = SYSDATETIME(),
            CustomerRecheckRemarks = NULL,
            DirectorApprovalStatus = 'Pending'
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
    res.status(500).json({ error: e.message });
  }
});

// POST /possession-notice/respond — the customer's side of the possession
// notice: acknowledge it (they've received/accepted the handover offer) or
// dispute it (something's wrong — a reason is mandatory, same as the
// staff-side mark-disputed endpoint). This is the one step in the Closure
// sequence that previously had no customer-facing counterpart at all —
// staff could send a notice but the customer had no way to respond to it
// from their own portal.
router.post("/possession-notice/respond", async (req, res) => {
  try {
    const pool = getPool();
    const appId = req.portalUser.applicationId;
    const { decision, reason } = req.body; // decision: "Acknowledge" | "Dispute"
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
    await logCommunication(pool, {
      bookingId, direction: "Inbound",
      subject: `Support ticket raised — ${subject.trim()}`,
      summary: `${ticketNo} (${category}): ${description || subject.trim()}`,
    });

    res.status(201).json({ success: true, id: result.recordset[0].Id, TicketNo: ticketNo });
  } catch (e) {
    console.error("[crm-portal] POST /tickets error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Only these CrmAgreementApprovalLog actions are safe to show a customer —
// everything else (SeniorApprove/SeniorReject, the internal in-house review)
// is staff-only, same "never expose internal review" rule the rest of this
// file follows for brokerage/AssignedTo/etc.
const CUSTOMER_VISIBLE_LOG_ACTIONS = [
  "SendToCustomer", "CustomerApprove", "CustomerRecheck",
  "AgreementDateSubmittedForApproval", "AgreementDateConfirmed", "AgreementDateRejected",
];

// GET /activity — a single chronological feed of everything that's actually
// happened on this customer's application: agreement lifecycle events,
// payments received, documents reviewed, and support tickets. Requested
// specifically so the portal isn't just a set of static status pages — the
// customer can see the real communication/approval trail behind each one,
// the same way staff can via CrmAgreementApprovalLog, minus anything
// internal-only (senior review, brokerage, AssignedTo identities).
router.get("/activity", async (req, res) => {
  try {
    const pool = getPool();
    const appId = req.portalUser.applicationId;

    const [agreementLog, payments, documents, tickets] = await Promise.all([
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
        WHERE b.ApplicationId = @aid AND d.Status IN ('Verified', 'Rejected', 'Submitted')
        ORDER BY EventAt DESC
      `),
      pool.request().input("aid", sql.Int, appId).query(`
        SELECT t.TicketNo, t.Subject, t.Status, t.ResolvedAt, t.CreatedAt
        FROM dbo.CrmServiceTicket t
        JOIN dbo.CrmBooking b ON b.Id = t.BookingId
        WHERE b.ApplicationId = @aid
        ORDER BY t.CreatedAt DESC
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
        title: r.Status === "Verified" ? `Document verified — ${label}` : r.Status === "Rejected" ? `Document returned — ${label}` : `Document submitted — ${label}`,
        detail: r.Status === "Rejected" ? r.Remarks : null,
        at: r.EventAt,
      });
    }
    for (const r of tickets.recordset) {
      feed.push({ type: "ticket", title: `Ticket raised — ${r.Subject}`, detail: r.TicketNo, at: r.CreatedAt });
      if (r.ResolvedAt) {
        feed.push({ type: "ticket", title: `Ticket resolved — ${r.Subject}`, detail: r.TicketNo, at: r.ResolvedAt });
      }
    }

    feed.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    res.json(feed);
  } catch (e) {
    console.error("[crm-portal] GET /activity error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;