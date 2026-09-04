const express = require("express");
const { CrmStatus } = require("../constants/crmStatuses");
const router = express.Router();
const apiRateLimit = require("../middleware/apiRateLimit");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId, requireUserEmail } = require("../services/saAccess");
const { getNextDocNumber } = require("../services/docNumber");
const { logCommunication } = require("../services/crmCommunicationLog");
const { requireActiveBooking, checkLoanProcessingCleared, maybeAutoCreateLegalMilestone, getProjectSaleGate } = require("../services/crmWorkflowGuards");
const { transition: approvalTransition, recordGLPosting } = require("../services/approvalService");
const { emitNotification } = require("../services/notify");
const { postCrmSalesDeedStatutoryToGL } = require("../services/crmLedger");
const multer = require('multer');

router.use(authMiddleware);
router.use(apiRateLimit);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 10 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/pdf', 'image/jpeg', 'image/png', 'image/webp',
      'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain'
    ];
    if (allowedTypes.includes(file.mimetype)) cb(null, true);
    else cb(new Error(`File type ${file.mimetype} not supported`), false);
  }
});

const DEED_SELECT = `
  SELECT d.*, b.BookingNo, COALESCE(bn.UnitNo, b.UnitNo) AS UnitNo,
         b.TotalValue AS BookingValue, b.Status AS BookingStatus, a.ApplicantName, a.Mobile,
         le.name AS LegalExecutiveName
  FROM dbo.CrmSalesDeed d
  JOIN dbo.CrmBooking b ON b.Id = d.BookingId
  JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
  LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
  LEFT JOIN dbo.Users le ON le.id = d.LegalExecutiveId
`;

function deriveDeedStatus({ bookingStatus, registrationNo, executedBy, deedDate, registrationDeadline }) {
  const today = new Date(new Date().toDateString());
  if (bookingStatus === CrmStatus.CANCELLED) return CrmStatus.CANCELLED;
  if (registrationNo) return CrmStatus.REGISTERED;
  if (executedBy && registrationDeadline && new Date(registrationDeadline) < today) return "Overdue";
  if (executedBy) return CrmStatus.EXECUTED;
  if (deedDate && new Date(deedDate) < today) return "Overdue";
  return CrmStatus.DRAFT;
}

async function deedDocumentProgress(pool, deedId) {
  const result = await pool.request().input('id', sql.Int, deedId).query(`
    SELECT COUNT(*) AS Required, SUM(CASE WHEN FileBase64 IS NOT NULL THEN 1 ELSE 0 END) AS Uploaded
    FROM dbo.CrmSalesDeedDocument WHERE SalesDeedId = @id AND IsMandatory = 1
  `);
  const row = result.recordset[0] || { Required: 0, Uploaded: 0 };
  const required = Number(row.Required) || 0;
  const uploaded = Number(row.Uploaded) || 0;
  const percent = required > 0 ? Math.round((uploaded / required) * 100) : 0;
  return { required, uploaded, percent };
}

// Stricter than deedDocumentProgress() above — that one gates Senior Approval
// on documents merely being UPLOADED (mirrors Agreement's own senior-approval
// gate). This one gates actual Execution: every mandatory document must have
// been reviewed and marked Verified by staff, not just present. A file
// sitting unreviewed is not the same fact as someone having actually checked
// it against the original.
async function deedMandatoryDocsVerified(pool, deedId) {
  const result = await pool.request().input('id', sql.Int, deedId).query(`
    SELECT COUNT(*) AS Required, SUM(CASE WHEN Status = 'Verified' THEN 1 ELSE 0 END) AS Verified
    FROM dbo.CrmSalesDeedDocument WHERE SalesDeedId = @id AND IsMandatory = 1
  `);
  const row = result.recordset[0] || { Required: 0, Verified: 0 };
  const required = Number(row.Required) || 0;
  const verified = Number(row.Verified) || 0;
  return { required, verified, allVerified: required > 0 && verified === required };
}

// The three-stage approval chain (Senior → Customer → Director) this module
// already builds correctly, but until now nothing actually required it
// before a deed could be marked Executed via PUT /:id below — the chain ran
// in parallel with reality, not as a gate on it. This is the single
// precondition function Execution must pass; mirrors the combined check in
// crmAgreements.js's PUT /:id/mark-executed.
async function assertDeedReadyForExecution(pool, deedId) {
  const row = await pool.request().input('id', sql.Int, deedId).query(`
    SELECT SeniorApprovalStatus, CustomerApprovalStatus, DirectorApprovalStatus FROM dbo.CrmSalesDeed WHERE Id = @id
  `);
  if (!row.recordset.length) return "Sale deed not found";
  const d = row.recordset[0];
  const missing = [];
  if (d.SeniorApprovalStatus !== 'Approved') missing.push(`Senior Approval (currently ${d.SeniorApprovalStatus || 'not requested'})`);
  if (d.CustomerApprovalStatus !== 'Approved') missing.push(`Customer Approval (currently ${d.CustomerApprovalStatus || 'not sent'})`);
  if (d.DirectorApprovalStatus !== 'Approved') missing.push(`Director Approval (currently ${d.DirectorApprovalStatus || 'not requested'})`);
  if (missing.length) return `Cannot record execution — still pending: ${missing.join(', ')}`;

  const docs = await deedMandatoryDocsVerified(pool, deedId);
  if (!docs.allVerified) {
    return docs.required === 0
      ? "Cannot record execution — no mandatory documents have been requested yet"
      : `Cannot record execution — ${docs.verified}/${docs.required} mandatory documents verified (all must be reviewed and Verified, not just uploaded)`;
  }
  return null;
}

async function logDeedApprovalHistory(deedId, action, remarks, actorIdVal, actorType = 'Staff') {
  const pool = getPool();
  await pool.request()
    .input('did', sql.Int, deedId)
    .input('act', sql.NVarChar(40), action)
    .input('rem', sql.NVarChar(sql.MAX), remarks || null)
    .input('atype', sql.NVarChar(20), actorType)
    .input('aid', sql.Int, actorIdVal)
    .query(`INSERT INTO dbo.CrmSalesDeedApprovalLog (SalesDeedId, Action, Remarks, ActorType, ActorId, CreatedAt)
            VALUES (@did, @act, @rem, @atype, @aid, SYSDATETIME())`);
}

async function getDeedBookingLockReason(pool, deedId) {
  const result = await pool.request().input('id', sql.Int, deedId).query(`
    SELECT b.Status AS BookingStatus, b.IsActive AS BookingIsActive
    FROM dbo.CrmSalesDeed d
    JOIN dbo.CrmBooking b ON b.Id = d.BookingId
    WHERE d.Id = @id
  `);
  if (!result.recordset.length) return null;
  const row = result.recordset[0];
  if (row.BookingIsActive === false || ['Cancelled', 'Rejected'].includes(row.BookingStatus)) {
    return `the underlying booking is ${row.BookingStatus || 'inactive'}`;
  }
  return null;
}

// 1. GET /eligible-bookings
router.get("/eligible-bookings", requirePageRight("crm-sales-deed", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT b.Id, b.BookingNo, COALESCE(bn.UnitNo, b.UnitNo) AS UnitNo, a.ApplicantName,
             ag.Status AS AgreementStatus, ag.AgreementNo,
             proj.entity_type AS ProjectType, proj.status AS ProjectStatus, hov.Status AS HandoverStatus
      FROM dbo.CrmBooking b
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
      LEFT JOIN dbo.enterprise proj ON proj.id = b.ProjectId AND proj.business_type = 'P'
      OUTER APPLY (
        SELECT TOP 1 Status, AgreementNo
        FROM dbo.CrmAgreement WHERE BookingId = b.Id ORDER BY CreatedAt DESC
      ) ag
      OUTER APPLY (
        SELECT TOP 1 Status FROM dbo.CrmHandover WHERE BookingId = b.Id ORDER BY CreatedAt DESC
      ) hov
      WHERE b.Status <> 'Cancelled'
        AND NOT EXISTS (SELECT 1 FROM dbo.CrmSalesDeed WHERE BookingId = b.Id)
        AND ag.Status = 'Registered'
        AND (proj.entity_type <> 'UnderConstruction' OR proj.status = 'Completed' OR hov.Status = 'Completed')
      ORDER BY b.CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-sales-deed] eligible-bookings error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// 2. GET /
router.get("/", requirePageRight("crm-sales-deed", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const { status } = req.query;
    const result = await pool.request().query(`${DEED_SELECT} ORDER BY d.CreatedAt DESC`);
    const rows = result.recordset.map((r) => ({
      ...r,
      Status: deriveDeedStatus({
        bookingStatus: r.BookingStatus, registrationNo: r.RegistrationNo,
        executedBy: r.ExecutedBy, deedDate: r.DeedDate,
        registrationDeadline: r.RegistrationDeadline,
      }),
    }));
    res.json(status ? rows.filter((r) => r.Status === status) : rows);
  } catch (e) {
    console.error("[crm-sales-deed] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// 3. GET /booking/:bookingId/context
router.get("/booking/:bookingId/context", requirePageRight("crm-sales-deed", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const bookingId = parseInt(req.params.bookingId);

    const booking = await pool.request().input("bid", sql.Int, bookingId).query(`
      SELECT b.Id, b.BookingNo, COALESCE(bn.UnitNo, b.UnitNo) AS UnitNo,
             b.Status AS BookingStatus, b.FinancingType, a.ApplicantName, a.Mobile,
             ISNULL(b.GrandTotal, b.TotalValue) AS GrandTotal
      FROM dbo.CrmBooking b
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
      WHERE b.Id = @bid
    `);
    if (!booking.recordset.length) return res.status(404).json({ error: "Booking not found" });

    const agreement = await pool.request().input("bid", sql.Int, bookingId)
      .query("SELECT TOP 1 Id, AgreementNo, Status, AfsStampDuty, AfsRegistrationFee FROM dbo.CrmAgreement WHERE BookingId = @bid ORDER BY CreatedAt DESC");

    const loanDetail = await pool.request().input("bid", sql.Int, bookingId)
      .query("SELECT BankName, LoanAccountNo, LoanAmount, SanctionStatus FROM dbo.CrmLoanDetail WHERE BookingId = @bid");

    const loanBlockReason = await checkLoanProcessingCleared(pool, bookingId);

    const existingDeed = await pool.request().input("bid", sql.Int, bookingId)
      .query("SELECT Id, DeedNo FROM dbo.CrmSalesDeed WHERE BookingId = @bid");

    const queryPayment = await pool.request().input("bid", sql.Int, bookingId)
      .query("SELECT TOP 1 Id AS QPId, QPNo, Status AS QPStatus, ConfirmedAmount FROM dbo.CrmQueryPayment WHERE BookingId = @bid");

    const registry = await pool.request().input("bid", sql.Int, bookingId)
      .query("SELECT TOP 1 Id AS RegistryId, RegNo, Status AS RegistryStatus, ScheduledDate FROM dbo.CrmRegistry WHERE BookingId = @bid");

    const gate = await getProjectSaleGate(pool, bookingId);

    const handover = await pool.request().input("bid", sql.Int, bookingId)
      .query("SELECT TOP 1 Status FROM dbo.CrmHandover WHERE BookingId = @bid ORDER BY CreatedAt DESC");

    const qp = queryPayment.recordset[0] || null;
    const reg = registry.recordset[0] || null;
    res.json({
      booking: booking.recordset[0],
      agreement: agreement.recordset[0] || null,
      loanDetail: loanDetail.recordset[0] || null,
      loanBlockReason,
      existingDeed: existingDeed.recordset[0] || null,
      registryStatus: reg?.RegistryStatus || null,
      registryNo: reg?.RegNo || null,
      registryScheduledDate: reg?.ScheduledDate || null,
      queryPaymentStatus: qp?.QPStatus || null,
      queryPaymentNo: qp?.QPNo || null,
      queryPaymentConfirmedAmount: qp?.ConfirmedAmount || null,
      handoverStatus: handover.recordset[0]?.Status || null,
      projectType: gate.projectType,
      projectStatus: gate.projectStatus,
      requiresHandoverBeforeDeed: gate.requiresHandoverBeforeDeed,
    });
  } catch (e) {
    console.error("[crm-sales-deed] context error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// 4. GET /:id
router.get("/:id", requirePageRight("crm-sales-deed", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    const [deedRes, docRes, logRes] = await Promise.all([
      pool.request().input('id', sql.Int, id).query(`${DEED_SELECT} WHERE d.Id = @id`),
      pool.request().input('id', sql.Int, id).query(`
        SELECT Id, DocumentType, Label, IsMandatory, Status, FileName, MimeType,
               FileSize, UploadedAt, UploadedByType, Remarks, VersionNo, CreatedAt,
               CASE WHEN FileBase64 IS NOT NULL THEN 1 ELSE 0 END AS HasFile
        FROM dbo.CrmSalesDeedDocument WHERE SalesDeedId = @id ORDER BY CreatedAt
      `),
      pool.request().input('id', sql.Int, id).query(`
        SELECT l.*, u.name AS ActorName
        FROM dbo.CrmSalesDeedApprovalLog l
        LEFT JOIN dbo.Users u ON u.id = l.ActorId
        WHERE l.SalesDeedId = @id ORDER BY l.CreatedAt DESC
      `),
    ]);
    if (!deedRes.recordset[0]) return res.status(404).json({ error: 'Sale deed not found' });
    const deed = {
      ...deedRes.recordset[0],
      Status: deriveDeedStatus({
        bookingStatus: deedRes.recordset[0].BookingStatus,
        registrationNo: deedRes.recordset[0].RegistrationNo,
        executedBy: deedRes.recordset[0].ExecutedBy,
        deedDate: deedRes.recordset[0].DeedDate,
        registrationDeadline: deedRes.recordset[0].RegistrationDeadline,
      })
    };
    res.json({ deed, documents: docRes.recordset, approvalLog: logRes.recordset });
  } catch (e) {
    console.error("[crm-sales-deed] GET /:id error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// 5. GET /:id/revisions
router.get("/:id/revisions", requirePageRight("crm-sales-deed", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().input("id", sql.Int, parseInt(req.params.id, 10))
      .query(`SELECT * FROM dbo.CrmSalesDeedRevision WHERE SalesDeedId = @id ORDER BY VersionNo DESC`);
    res.json(result.recordset);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 6. PUT /:id/assign-legal
router.put("/:id/assign-legal", requirePageRight("crm-sales-deed", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    const { LegalExecutiveId } = req.body;
    const lock = await getDeedBookingLockReason(pool, id);
    if (lock) return res.status(400).json({ error: `Cannot assign legal executive because ${lock}` });

    await pool.request()
      .input("id", sql.Int, id)
      .input("leid", sql.Int, LegalExecutiveId || null)
      .input("ub", sql.Int, actorId(req))
      .query(`UPDATE dbo.CrmSalesDeed SET LegalExecutiveId = @leid, UpdatedBy = @ub, UpdatedAt = SYSDATETIME() WHERE Id = @id`);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 7. PUT /:id/submit
router.put("/:id/submit", requirePageRight("crm-sales-deed", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    const lock = await getDeedBookingLockReason(pool, id);
    if (lock) return res.status(400).json({ error: `Cannot submit deed because ${lock}` });
    
    const cur = await pool.request().input("id", sql.Int, id).query("SELECT SeniorApprovalStatus FROM dbo.CrmSalesDeed WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "Deed not found" });
    // NULL is the real starting state for every deed (never initialized at
    // creation, matching Agreement's own SeniorApprovalStatus) — this used
    // to only accept 'Rejected', which meant a brand new deed could never
    // enter the Senior Approval queue in the first place; only a deed that
    // had already been rejected once could ever be (re-)submitted.
    if (!['Rejected', null].includes(cur.recordset[0].SeniorApprovalStatus)) {
      return res.status(400).json({ error: `Cannot submit — current status is ${cur.recordset[0].SeniorApprovalStatus}` });
    }
    
    await pool.request().input("id", sql.Int, id).input("ub", sql.Int, actorId(req)).query(`
      UPDATE dbo.CrmSalesDeed SET SeniorApprovalStatus = 'Pending', UpdatedBy = @ub, UpdatedAt = SYSDATETIME() WHERE Id = @id
    `);
    await logDeedApprovalHistory(id, 'Submitted', null, actorId(req), 'Staff');
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 8. PUT /:id/approve (Senior Approval)
router.put("/:id/approve", requirePageRight("crm-sales-deed", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    const deedRow = await pool.request().input('id', sql.Int, id).query(`
      SELECT d.*, b.AssignedTo, b.BookingNo, a.ApplicantName
      FROM dbo.CrmSalesDeed d
      JOIN dbo.CrmBooking b ON b.Id = d.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      WHERE d.Id = @id
    `);
    if (!deedRow.recordset.length) return res.status(404).json({ error: "Sale deed not found" });
    const deed = deedRow.recordset[0];

    const lock = await getDeedBookingLockReason(pool, id);
    if (lock) return res.status(400).json({ error: `Cannot approve deed because ${lock}` });

    if (!deed.LegalExecutiveId) return res.status(400).json({ error: "A Legal Executive must be assigned before approval" });
    
    const prog = await deedDocumentProgress(pool, id);
    if (prog.required === 0) return res.status(400).json({ error: "No mandatory documents requested yet" });
    if (prog.percent < 100) return res.status(400).json({ error: `${prog.percent}% complete — all mandatory docs must be uploaded before approval` });

    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;

    const transitionResult = await approvalTransition("crm-sales-deed-senior", id, 'Approved', userEmail, req.user?.role, req.body?.Remarks, actorId(req));
    
    await pool.request().input("id", sql.Int, id).input("ub", sql.Int, actorId(req)).input("rem", sql.NVarChar(sql.MAX), req.body?.Remarks || null).query(`
      UPDATE dbo.CrmSalesDeed SET
        SeniorApprovalStatus = 'Approved', SeniorApprovedBy = @ub, SeniorApprovedAt = SYSDATETIME(), SeniorApprovalRemarks = @rem,
        SentToCustomerAt = SYSDATETIME(), CustomerApprovalStatus = 'Pending', CustomerApprovedAt = NULL,
        UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
      WHERE Id = @id
    `);

    await logDeedApprovalHistory(id, 'SeniorApprove', req.body?.Remarks, actorId(req), 'Staff');
    await logDeedApprovalHistory(id, 'SendToCustomer', 'Auto-sent to customer upon senior approval', actorId(req), 'System');

    await logCommunication(pool, {
      bookingId: deed.BookingId, direction: 'Outbound',
      subject: `Sales deed ${deed.DeedNo} approved and sent to customer`,
      summary: `Senior approval complete. Sales deed sent to customer for review.`,
      createdBy: actorId(req),
    });

    if (deed.AssignedTo) {
      await emitNotification(pool, deed.AssignedTo, 'crm_sales_deed_senior_approved',
        'Sales Deed Senior Approved',
        `${deed.DeedNo} (${deed.BookingNo}) is senior-approved and sent to customer.`,
        id, 'crm_sales_deed');
    }

    res.json({ success: true, status: transitionResult.newStatus });
  } catch (e) {
    res.status(e.status || (e.message.includes("not authorized") ? 403 : 400)).json({ error: e.message });
  }
});

// 9. PUT /:id/reject (Senior Rejection)
router.put("/:id/reject", requirePageRight("crm-sales-deed", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    const remarks = req.body?.Remarks;
    if (!remarks?.trim()) return res.status(400).json({ error: "Rejection remarks are required" });

    const lock = await getDeedBookingLockReason(pool, id);
    if (lock) return res.status(400).json({ error: `Cannot reject deed because ${lock}` });

    const deedRow = await pool.request().input('id', sql.Int, id).query(`SELECT * FROM dbo.CrmSalesDeed WHERE Id = @id`);
    if (!deedRow.recordset.length) return res.status(404).json({ error: "Deed not found" });
    const deed = deedRow.recordset[0];

    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;

    await pool.request()
      .input("did", sql.Int, id)
      .input("vn", sql.Int, deed.VersionNo)
      .input("dv", sql.Decimal(18,2), deed.DeedValue)
      .input("sd", sql.Decimal(18,2), deed.StampDuty)
      .input("rf", sql.Decimal(18,2), deed.RegistrationFee)
      .input("sdc", sql.Decimal(18,2), deed.StampDutyCredit)
      .input("sro", sql.NVarChar(255), deed.SubRegistrarOffice)
      .input("notes", sql.NVarChar(sql.MAX), deed.Notes)
      .input("rea", sql.NVarChar(sql.MAX), remarks)
      .input("cb", sql.Int, actorId(req))
      .query(`
        INSERT INTO dbo.CrmSalesDeedRevision (SalesDeedId, VersionNo, DeedValue, StampDuty, RegistrationFee, StampDutyCredit, SubRegistrarOffice, Notes, Reason, CreatedBy, CreatedAt)
        VALUES (@did, @vn, @dv, @sd, @rf, @sdc, @sro, @notes, @rea, @cb, SYSDATETIME())
      `);

    const transitionResult = await approvalTransition("crm-sales-deed-senior", id, 'Rejected', userEmail, req.user?.role, remarks, actorId(req));

    await pool.request().input("id", sql.Int, id).input("ub", sql.Int, actorId(req)).input("rem", sql.NVarChar(sql.MAX), remarks).query(`
      UPDATE dbo.CrmSalesDeed SET
        SeniorApprovalStatus = 'Rejected', SeniorApprovalRemarks = @rem,
        SentToCustomerAt = NULL, CustomerApprovalStatus = 'Pending', CustomerApprovedAt = NULL,
        VersionNo = VersionNo + 1,
        UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
      WHERE Id = @id
    `);

    // A rejection must actually send the deed back to the legal preparer to
    // reprepare and reupload — not just flip a status flag while every
    // mandatory document sits there still marked Verified/Uploaded, which
    // would let staff resubmit unchanged work and loop forever without ever
    // fixing what the senior flagged. Reset every mandatory document back to
    // Requested (clearing the file) so the same Attach-File control the
    // Documents tab already shows for a fresh request reappears here too,
    // and Senior Approval's own document-progress gate naturally blocks
    // resubmission until they're genuinely reworked.
    await pool.request().input("id", sql.Int, id).input("ub", sql.Int, actorId(req)).query(`
      UPDATE dbo.CrmSalesDeedDocument SET
        Status = 'Requested', FileBase64 = NULL, FileName = NULL, MimeType = NULL, FileSize = NULL,
        UploadedByType = NULL, UploadedAt = NULL, UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
      WHERE SalesDeedId = @id AND IsMandatory = 1
    `);

    await logDeedApprovalHistory(id, 'SeniorReject', remarks, actorId(req), 'Staff');
    res.json({ success: true, status: transitionResult.newStatus });
  } catch (e) {
    res.status(e.status || (e.message.includes("not authorized") ? 403 : 400)).json({ error: e.message });
  }
});

// 10. PUT /:id/send-to-customer
router.put("/:id/send-to-customer", requirePageRight("crm-sales-deed", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    const deed = await pool.request().input("id", sql.Int, id).query(`
      SELECT d.Id, d.Status, d.SeniorApprovalStatus, ag.Status AS AgreementStatus, d.BookingId
      FROM dbo.CrmSalesDeed d
      LEFT JOIN dbo.CrmAgreement ag ON ag.Id = d.AgreementId
      WHERE d.Id = @id
    `);
    if (!deed.recordset.length) return res.status(404).json({ error: "Sale deed not found" });
    const row = deed.recordset[0];
    
    const activeErr = await requireActiveBooking(pool, row.BookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });
    
    if (row.SeniorApprovalStatus !== 'Approved') {
      return res.status(400).json({ error: 'Deed must receive senior approval before it can be sent to the customer' });
    }
    if (!["Executed", "Registered"].includes(row.AgreementStatus)) {
      return res.status(400).json({ error: "Agreement must be at least Executed before sending the sales deed to the customer" });
    }
    if (row.Status === CrmStatus.REGISTERED) {
      return res.status(400).json({ error: "Registered sales deed cannot be resent for customer approval" });
    }

    await pool.request()
      .input("id", sql.Int, id)
      .input("ub", sql.Int, actorId(req))
      .query(`
        UPDATE dbo.CrmSalesDeed SET
          SentToCustomerAt = SYSDATETIME(),
          CustomerApprovalStatus = '${CrmStatus.PENDING}',
          CustomerApprovedAt = NULL,
          CustomerRecheckRemarks = NULL,
          UpdatedBy = @ub,
          UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 11. PUT /:id/director/approve
router.put("/:id/director/approve", requirePageRight("crm-sales-deed", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const pool0 = getPool();
    const deedBooking = await pool0.request().input("id", sql.Int, id).query("SELECT BookingId, CustomerApprovalStatus, SeniorApprovalStatus FROM dbo.CrmSalesDeed WHERE Id = @id");
    if (!deedBooking.recordset.length) return res.status(404).json({ error: "Sale deed not found" });
    const row = deedBooking.recordset[0];
    const activeErr0 = await requireActiveBooking(pool0, row.BookingId);
    if (activeErr0) return res.status(400).json({ error: activeErr0 });

    if (row.SeniorApprovalStatus !== 'Approved') {
      return res.status(400).json({ error: "Senior approval must be obtained before director approval" });
    }
    if (row.CustomerApprovalStatus !== CrmStatus.APPROVED) {
      return res.status(400).json({ error: `Customer must approve the sales deed before director approval (current status: ${row.CustomerApprovalStatus || "not sent"})` });
    }

    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;
    const remarks = req.body?.Remarks || null;
    const result = await approvalTransition("crm-sales-deed-director", id, CrmStatus.APPROVED, userEmail, req.user?.role, remarks, actorId(req));
    if (result.newStatus === CrmStatus.APPROVED) {
      const pool = getPool();
      await pool.request()
        .input("id", sql.Int, id)
        .input("ab", sql.Int, actorId(req))
        .input("rem", sql.NVarChar(sql.MAX), remarks)
        .query(`
          UPDATE dbo.CrmSalesDeed SET
            DirectorApprovedBy = @ab, DirectorApprovedAt = SYSDATETIME(), DirectorApprovalRemarks = @rem
          WHERE Id = @id
        `);

      const info = await pool.request().input("id", sql.Int, id).query(`
        SELECT d.DeedNo, d.BookingId, b.AssignedTo, b.BookingNo, a.ApplicantName
        FROM dbo.CrmSalesDeed d
        JOIN dbo.CrmBooking b ON b.Id = d.BookingId
        JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
        WHERE d.Id = @id
      `);
      const infoRow = info.recordset[0];
      if (infoRow?.AssignedTo) {
        await emitNotification(pool, infoRow.AssignedTo, "crm_sales_deed_director_approved",
          "Sales Deed Director-Approved",
          `${infoRow.DeedNo} (${infoRow.BookingNo}) has been director-approved — handover can now be scheduled.`,
          id, "crm_sales_deed");
      }
      await logCommunication(pool, {
        bookingId: infoRow?.BookingId, direction: "Outbound",
        subject: `Sales deed ${infoRow?.DeedNo} director-approved`,
        summary: "Director approval complete — handover can now proceed.",
        createdBy: actorId(req),
      });
    }
    res.json({ success: true, status: result.newStatus, ...result });
  } catch (e) {
    res.status(e.status || (e.message.includes("not authorized") ? 403 : 400)).json({ error: e.message });
  }
});

// 12. PUT /:id/director/reject
router.put("/:id/director/reject", requirePageRight("crm-sales-deed", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const pool0 = getPool();
    const deedBooking = await pool0.request().input("id", sql.Int, id).query("SELECT BookingId FROM dbo.CrmSalesDeed WHERE Id = @id");
    if (!deedBooking.recordset.length) return res.status(404).json({ error: "Sale deed not found" });
    const activeErr0 = await requireActiveBooking(pool0, deedBooking.recordset[0].BookingId);
    if (activeErr0) return res.status(400).json({ error: activeErr0 });

    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;
    const remarks = req.body?.Remarks || null;
    const result = await approvalTransition("crm-sales-deed-director", id, CrmStatus.REJECTED, userEmail, req.user?.role, remarks);
    const pool = getPool();
    await pool.request()
      .input("id", sql.Int, id)
      .input("rem", sql.NVarChar(sql.MAX), remarks)
      .query("UPDATE dbo.CrmSalesDeed SET DirectorApprovalRemarks = @rem WHERE Id = @id");
    res.json({ success: true, status: result.newStatus });
  } catch (e) {
    res.status(e.status || (e.message.includes("not authorized") ? 403 : 400)).json({ error: e.message });
  }
});

// 13. PUT /:id
router.put("/:id", requirePageRight("crm-sales-deed", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    const id = parseInt(req.params.id);

    const cur = await pool.request().input("id", sql.Int, id).query(`
      SELECT d.RegistrationNo, d.ExecutedBy, d.DeedDate, d.RegistrationDeadline, d.BookingId, d.DeedNo, d.SentToCustomerAt,
             d.DocCollectionDone, d.DeedDraftingDone, d.InternalApprovalDone, d.DirectorApprovalStatus,
             b.Status AS BookingStatus
      FROM dbo.CrmSalesDeed d JOIN dbo.CrmBooking b ON b.Id = d.BookingId
      WHERE d.Id = @id
    `);
    if (!cur.recordset.length) return res.status(404).json({ error: "Sale deed not found" });
    const row = cur.recordset[0];

    const activeErr = await requireActiveBooking(pool, row.BookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });

    const CORE_FIELDS = ["DeedValue", "StampDuty", "RegistrationFee", "StampDutyCredit", "SubRegistrarOffice", "DeedDate"];
    const editingCoreFields = CORE_FIELDS.some((k) => b[k] !== undefined);
    if (editingCoreFields && row.SentToCustomerAt) {
      return res.status(400).json({ error: "Deed Value, Stamp Duty, Registration Fee, Stamp Duty Credit, Sub-Registrar Office and Deed Date can no longer be edited once the deed has been sent to the customer for approval." });
    }

    // Execution is the deed's own signing event — the Senior → Customer →
    // Director approval chain exists specifically to clear it for that, so
    // it can't be reachable by just typing a name into ExecutedBy. Only
    // checked the first time it's set (row.ExecutedBy was empty) — an
    // already-Executed deed's ExecutedBy can still be corrected via ISNULL
    // below without re-litigating approvals that already happened.
    if (b.ExecutedBy && !row.ExecutedBy) {
      const execErr = await assertDeedReadyForExecution(pool, id);
      if (execErr) return res.status(400).json({ error: execErr });
    }

    if (b.RegistrationNo && !row.RegistrationNo) {
      const registry = await pool.request().input("bid", sql.Int, row.BookingId)
        .query("SELECT Status FROM dbo.CrmRegistry WHERE BookingId = @bid");
      if (!registry.recordset.length || registry.recordset[0].Status !== "Completed") {
        return res.status(400).json({ error: "Registration number can't be recorded until Registry is marked Completed (Query Payment must be Confirmed first)" });
      }
      if (row.DirectorApprovalStatus !== CrmStatus.APPROVED) {
        return res.status(400).json({ error: "Director must approve the sales deed before the registration number can be recorded" });
      }
    }

    const newRegDeadline = b.RegistrationDeadline !== undefined ? (b.RegistrationDeadline || null) : row.RegistrationDeadline;
    const newStatus = deriveDeedStatus({
      bookingStatus: row.BookingStatus,
      registrationNo: b.RegistrationNo || row.RegistrationNo,
      executedBy: b.ExecutedBy || row.ExecutedBy,
      deedDate: b.DeedDate || row.DeedDate,
      registrationDeadline: newRegDeadline,
    });

    await pool.request()
      .input("id",    sql.Int,  id)
      .input("regno", sql.NVarChar(100), b.RegistrationNo || null)
      .input("bookno",sql.NVarChar(100), b.BookNo || null)
      .input("partno",sql.NVarChar(100), b.PartNo || null)
      .input("regdt", sql.Date, b.RegistrationDate || null)
      .input("posdt", sql.Date, b.PossessionDate || null)
      .input("regdl", sql.Date, b.RegistrationDeadline !== undefined ? (b.RegistrationDeadline || null) : row.RegistrationDeadline)
      .input("exby",  sql.NVarChar(200), b.ExecutedBy || null)
      .input("st",    sql.NVarChar(30), newStatus)
      .input("note",  sql.NVarChar(sql.MAX), b.Notes || null)
      .input("dval",    sql.Decimal(18,2), b.DeedValue != null && b.DeedValue !== "" ? parseFloat(b.DeedValue) : null)
      .input("stamp",   sql.Decimal(18,2), b.StampDuty != null && b.StampDuty !== "" ? parseFloat(b.StampDuty) : null)
      .input("regfee",  sql.Decimal(18,2), b.RegistrationFee != null && b.RegistrationFee !== "" ? parseFloat(b.RegistrationFee) : null)
      .input("credit",  sql.Decimal(18,2), b.StampDutyCredit != null && b.StampDutyCredit !== "" ? parseFloat(b.StampDutyCredit) : null)
      .input("sro",     sql.NVarChar(255), b.SubRegistrarOffice || null)
      .input("ddt",     sql.Date, b.DeedDate || null)
      .input("dcdone",  sql.Bit, b.DocCollectionDone !== undefined ? (b.DocCollectionDone ? 1 : 0) : null)
      .input("dcdate",  sql.Date, b.DocCollectionDate !== undefined ? (b.DocCollectionDate || null) : null)
      .input("dcnotes", sql.NVarChar(sql.MAX), b.DocCollectionNotes !== undefined ? (b.DocCollectionNotes || null) : null)
      .input("dddone",  sql.Bit, b.DeedDraftingDone !== undefined ? (b.DeedDraftingDone ? 1 : 0) : null)
      .input("dddate",  sql.Date, b.DeedDraftingDate !== undefined ? (b.DeedDraftingDate || null) : null)
      .input("ddnotes", sql.NVarChar(sql.MAX), b.DeedDraftingNotes !== undefined ? (b.DeedDraftingNotes || null) : null)
      .input("iadone",  sql.Bit, b.InternalApprovalDone !== undefined ? (b.InternalApprovalDone ? 1 : 0) : null)
      .input("iadate",  sql.Date, b.InternalApprovalDate !== undefined ? (b.InternalApprovalDate || null) : null)
      .input("ianotes", sql.NVarChar(sql.MAX), b.InternalApprovalNotes !== undefined ? (b.InternalApprovalNotes || null) : null)
      .input("idx2dt",  sql.Date, b.Index2ReceivedDate !== undefined ? (b.Index2ReceivedDate || null) : null)
      .input("ub",      sql.Int,  actorId(req))
      .query(`
        UPDATE dbo.CrmSalesDeed SET
          RegistrationNo = ISNULL(@regno, RegistrationNo), BookNo = ISNULL(@bookno, BookNo),
          PartNo = ISNULL(@partno, PartNo), RegistrationDate = ISNULL(@regdt, RegistrationDate),
          PossessionDate = ISNULL(@posdt, PossessionDate), ExecutedBy = ISNULL(@exby, ExecutedBy),
          RegistrationDeadline = @regdl,
          DeedValue = ISNULL(@dval, DeedValue), StampDuty = ISNULL(@stamp, StampDuty),
          RegistrationFee = ISNULL(@regfee, RegistrationFee),
          StampDutyCredit = ISNULL(@credit, StampDutyCredit),
          SubRegistrarOffice = ISNULL(@sro, SubRegistrarOffice),
          DeedDate = ISNULL(@ddt, DeedDate),
          DocCollectionDone  = CASE WHEN @dcdone  IS NOT NULL THEN @dcdone  ELSE DocCollectionDone  END,
          DocCollectionDate  = CASE WHEN @dcdone  IS NOT NULL THEN @dcdate  ELSE DocCollectionDate  END,
          DocCollectionNotes = CASE WHEN @dcdone  IS NOT NULL THEN @dcnotes ELSE DocCollectionNotes END,
          DeedDraftingDone   = CASE WHEN @dddone  IS NOT NULL THEN @dddone  ELSE DeedDraftingDone   END,
          DeedDraftingDate   = CASE WHEN @dddone  IS NOT NULL THEN @dddate  ELSE DeedDraftingDate   END,
          DeedDraftingNotes  = CASE WHEN @dddone  IS NOT NULL THEN @ddnotes ELSE DeedDraftingNotes  END,
          InternalApprovalDone  = CASE WHEN @iadone IS NOT NULL THEN @iadone  ELSE InternalApprovalDone  END,
          InternalApprovalDate  = CASE WHEN @iadone IS NOT NULL THEN @iadate  ELSE InternalApprovalDate  END,
          InternalApprovalNotes = CASE WHEN @iadone IS NOT NULL THEN @ianotes ELSE InternalApprovalNotes END,
          Index2ReceivedDate = CASE WHEN @idx2dt IS NOT NULL THEN @idx2dt ELSE Index2ReceivedDate END,
          Status = @st, Notes = @note, UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);

    const executedByJustSet = !row.ExecutedBy && b.ExecutedBy;
    if (executedByJustSet) {
      const sent = await pool.request().input("id", sql.Int, id).query("SELECT SentToCustomerAt FROM dbo.CrmSalesDeed WHERE Id = @id");
      if (!sent.recordset[0].SentToCustomerAt) {
        await pool.request().input("id", sql.Int, id).query(`
          UPDATE dbo.CrmSalesDeed SET SentToCustomerAt = SYSDATETIME(), CustomerApprovalStatus = '${CrmStatus.PENDING}', CustomerApprovedAt = NULL
          WHERE Id = @id
        `);
        await logCommunication(pool, {
          bookingId: row.BookingId, direction: "Outbound",
          subject: `Sales deed ${row.DeedNo} sent to customer`,
          summary: "Sales deed executed and shared with the customer via portal, awaiting their approval.",
          createdBy: actorId(req),
        });
      }
    }

    if (newStatus === CrmStatus.REGISTERED && !row.RegistrationNo) {
      try {
        const outcome = await postCrmSalesDeedStatutoryToGL(pool, id, req.user?.name || req.user?.email || "system");
        await recordGLPosting("crm-sales-deed", id, outcome, req.user?.name || req.user?.email || "system");
      } catch (glErr) {
        console.error("[crm-sales-deed] GL posting failed:", glErr.message);
        await recordGLPosting("crm-sales-deed", id, { failed: true, reason: glErr.message }, req.user?.name || req.user?.email || "system");
      }
    }

    res.json({ success: true, status: newStatus });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 14. POST /:id/documents/upload
router.post("/:id/documents/upload", requirePageRight("crm-sales-deed", "edit"), upload.array('files'), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    const { DocumentType = 'Other', Label, IsMandatory = 0, Remarks } = req.body;
    const lock = await getDeedBookingLockReason(pool, id);
    if (lock) return res.status(400).json({ error: `Cannot upload documents because ${lock}` });

    const deed = await pool.request().input("id", sql.Int, id).query("SELECT VersionNo, RegistrationNo, Status FROM dbo.CrmSalesDeed WHERE Id = @id");
    if (!deed.recordset.length) return res.status(404).json({ error: "Deed not found" });
    if (['Registered', 'Cancelled'].includes(deed.recordset[0].Status)) {
      return res.status(400).json({ error: "Cannot modify documents for registered or cancelled deeds" });
    }

    const vn = deed.recordset[0].VersionNo || 1;

    for (const file of req.files) {
      const b64 = file.buffer.toString('base64');
      const reqCheck = await pool.request()
        .input("did", sql.Int, id)
        .input("dt", sql.NVarChar(50), DocumentType)
        .query("SELECT TOP 1 Id FROM dbo.CrmSalesDeedDocument WHERE SalesDeedId = @did AND DocumentType = @dt AND Status = 'Requested' AND IsMandatory = 1 ORDER BY CreatedAt ASC");

      // Fulfilling any pending mandatory request for this DocumentType, not
      // just a hardcoded 'DeedDraft' — the old check meant a mandatory
      // request for e.g. NOC or PowerOfAttorney (or a second DeedDraft
      // request after rejection) could never actually be fulfilled by this
      // endpoint; it would silently create an unrelated non-mandatory row
      // instead, permanently orphaning the real requirement.
      if (reqCheck.recordset.length > 0) {
        const reqDocId = reqCheck.recordset[0].Id;
        await pool.request()
          .input("docid", sql.Int, reqDocId)
          .input("b64", sql.NVarChar(sql.MAX), b64)
          .input("fn", sql.NVarChar(255), file.originalname)
          .input("mt", sql.NVarChar(100), file.mimetype)
          .input("fs", sql.Int, file.size)
          .input("rem", sql.NVarChar(sql.MAX), Remarks || null)
          .input("ub", sql.Int, actorId(req))
          .query(`
            UPDATE dbo.CrmSalesDeedDocument SET
              FileBase64 = @b64, FileName = @fn, MimeType = @mt, FileSize = @fs,
              Status = 'Uploaded', UploadedByType = 'Staff', UploadedAt = SYSDATETIME(),
              Remarks = ISNULL(@rem, Remarks), UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
            WHERE Id = @docid
          `);
      } else {
        await pool.request()
          .input("did", sql.Int, id)
          .input("dt", sql.NVarChar(50), DocumentType)
          .input("lbl", sql.NVarChar(255), Label || file.originalname)
          .input("ism", sql.Bit, parseInt(IsMandatory, 10) || 0)
          .input("fn", sql.NVarChar(255), file.originalname)
          .input("mt", sql.NVarChar(100), file.mimetype)
          .input("fs", sql.Int, file.size)
          .input("b64", sql.NVarChar(sql.MAX), b64)
          .input("rem", sql.NVarChar(sql.MAX), Remarks || null)
          .input("vn", sql.Int, vn)
          .input("cb", sql.Int, actorId(req))
          .query(`
            INSERT INTO dbo.CrmSalesDeedDocument
              (SalesDeedId, DocumentType, Label, IsMandatory, Status, FileName, MimeType, FileSize, FileBase64,
               UploadedByType, UploadedAt, Remarks, VersionNo, CreatedBy, CreatedAt)
            VALUES (@did, @dt, @lbl, @ism, 'Uploaded', @fn, @mt, @fs, @b64,
               'Staff', SYSDATETIME(), @rem, @vn, @cb, SYSDATETIME())
          `);
      }
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 14b. POST /:id/documents/request
// Creates a mandatory (or, if explicitly false, optional) document
// requirement dynamically — the one thing this module was missing. Until
// now the ONLY mandatory document a deed could ever have was the single
// 'DeedDraft' row auto-seeded at creation (see POST / below); if that row
// was ever consumed some other way, or a second/different mandatory
// document became necessary (a rejection needing a fresh copy, a NOC, a
// Power of Attorney), there was no way to ask for one — Senior Approval
// would permanently report "no mandatory documents requested yet" with no
// recovery path in the UI. Mirrors Agreement's own document-request flow.
router.post("/:id/documents/request", requirePageRight("crm-sales-deed", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    const { DocumentType, Label, IsMandatory = true } = req.body;
    if (!DocumentType?.trim()) return res.status(400).json({ error: "DocumentType is required" });

    const lock = await getDeedBookingLockReason(pool, id);
    if (lock) return res.status(400).json({ error: `Cannot request documents because ${lock}` });

    const deed = await pool.request().input("id", sql.Int, id).query("SELECT Status FROM dbo.CrmSalesDeed WHERE Id = @id");
    if (!deed.recordset.length) return res.status(404).json({ error: "Deed not found" });
    if (['Registered', 'Cancelled'].includes(deed.recordset[0].Status)) {
      return res.status(400).json({ error: "Cannot request documents for a registered or cancelled deed" });
    }

    const dup = await pool.request().input("did", sql.Int, id).input("dt", sql.NVarChar(50), DocumentType.trim())
      .query("SELECT TOP 1 Id FROM dbo.CrmSalesDeedDocument WHERE SalesDeedId = @did AND DocumentType = @dt AND Status IN ('Requested', 'Uploaded')");
    if (dup.recordset.length) return res.status(409).json({ error: `A ${DocumentType} request is already open for this deed` });

    await pool.request()
      .input('did', sql.Int, id)
      .input('dt', sql.NVarChar(50), DocumentType.trim())
      .input('lbl', sql.NVarChar(255), Label?.trim() || DocumentType.trim())
      .input('ism', sql.Bit, IsMandatory ? 1 : 0)
      .input('cb', sql.Int, actorId(req))
      .query(`
        INSERT INTO dbo.CrmSalesDeedDocument (SalesDeedId, DocumentType, Label, IsMandatory, Status, RequestedBy, RequestedAt, VersionNo, CreatedBy, CreatedAt)
        VALUES (@did, @dt, @lbl, @ism, 'Requested', @cb, SYSDATETIME(), 1, @cb, SYSDATETIME())
      `);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 15. POST /:id/documents/:docId/attach
router.post("/:id/documents/:docId/attach", requirePageRight("crm-sales-deed", "edit"), upload.single('file'), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    const docId = parseInt(req.params.docId, 10);
    const lock = await getDeedBookingLockReason(pool, id);
    if (lock) return res.status(400).json({ error: `Cannot attach file because ${lock}` });

    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const doc = await pool.request().input("docid", sql.Int, docId).input("did", sql.Int, id).query("SELECT Status FROM dbo.CrmSalesDeedDocument WHERE Id = @docid AND SalesDeedId = @did");
    if (!doc.recordset.length) return res.status(404).json({ error: "Document not found" });

    const b64 = req.file.buffer.toString('base64');
    await pool.request()
      .input("docid", sql.Int, docId)
      .input("fn", sql.NVarChar(255), req.file.originalname)
      .input("mt", sql.NVarChar(100), req.file.mimetype)
      .input("fs", sql.Int, req.file.size)
      .input("b64", sql.NVarChar(sql.MAX), b64)
      .input("ub", sql.Int, actorId(req))
      .query(`
        UPDATE dbo.CrmSalesDeedDocument SET
          FileBase64 = @b64, FileName = @fn, MimeType = @mt, FileSize = @fs,
          Status = 'Uploaded', UploadedByType = 'Staff', UploadedAt = SYSDATETIME(),
          UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @docid
      `);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 16. GET /documents/file/:docId
router.get("/documents/file/:docId", async (req, res) => {
  try {
    const pool = getPool();
    const doc = await pool.request().input("docid", sql.Int, parseInt(req.params.docId, 10)).query(`
      SELECT FileName, MimeType, FileBase64 FROM dbo.CrmSalesDeedDocument WHERE Id = @docid
    `);
    if (!doc.recordset.length || !doc.recordset[0].FileBase64) return res.status(404).send("File not found");
    const row = doc.recordset[0];
    const buffer = Buffer.from(row.FileBase64, 'base64');
    res.setHeader('Content-Type', row.MimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${row.FileName || 'document'}"`);
    res.send(buffer);
  } catch (e) {
    res.status(500).send(e.message);
  }
});

// 17. PUT /:id/documents/:docId
// Review a document — the one action that turns "a file exists" into "staff
// actually checked it", which Execution now genuinely depends on
// (assertDeedReadyForExecution above). Validated the same way Agreement's
// equivalent review endpoint is: only a real reviewed state is accepted,
// rejecting requires saying why, and a deed already Executed/Registered
// can't have its documents silently re-reviewed after the fact.
router.put("/:id/documents/:docId", requirePageRight("crm-sales-deed", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    const docId = parseInt(req.params.docId, 10);
    const { Status, Remarks } = req.body;

    if (Status !== undefined && !["Verified", "Rejected"].includes(Status)) {
      return res.status(400).json({ error: "Status must be Verified or Rejected" });
    }
    if (Status === "Rejected" && !Remarks?.trim()) {
      return res.status(400).json({ error: "Remarks are required when rejecting a document" });
    }

    const deed = await pool.request().input("id", sql.Int, id).query("SELECT Status FROM dbo.CrmSalesDeed WHERE Id = @id");
    if (!deed.recordset.length) return res.status(404).json({ error: "Deed not found" });
    if (Status !== undefined && ["Executed", "Registered"].includes(deed.recordset[0].Status)) {
      return res.status(400).json({ error: "Documents can no longer be reviewed once the deed has been Executed" });
    }

    await pool.request()
      .input("docid", sql.Int, docId)
      .input("st", sql.NVarChar(30), Status)
      .input("rem", sql.NVarChar(sql.MAX), Remarks)
      .input("ub", sql.Int, actorId(req))
      .query(`
        UPDATE dbo.CrmSalesDeedDocument SET Status = ISNULL(@st, Status), Remarks = ISNULL(@rem, Remarks), UpdatedBy = @ub, UpdatedAt = SYSDATETIME() WHERE Id = @docid
      `);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 18. DELETE /:id/documents/:docId
router.delete("/:id/documents/:docId", requirePageRight("crm-sales-deed", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    const docId = parseInt(req.params.docId, 10);
    
    const deed = await pool.request().input("id", sql.Int, id).query("SELECT SeniorApprovalStatus FROM dbo.CrmSalesDeed WHERE Id = @id");
    if (!deed.recordset.length) return res.status(404).json({ error: "Deed not found" });
    if (deed.recordset[0].SeniorApprovalStatus === 'Approved') {
      return res.status(400).json({ error: "Cannot delete documents after senior approval" });
    }

    const doc = await pool.request().input("docid", sql.Int, docId).query("SELECT IsMandatory, Status FROM dbo.CrmSalesDeedDocument WHERE Id = @docid");
    if (!doc.recordset.length) return res.status(404).json({ error: "Document not found" });
    
    if (doc.recordset[0].IsMandatory && doc.recordset[0].Status === 'Requested') {
      return res.status(400).json({ error: "Cannot delete a mandatory document request" });
    }
    if (doc.recordset[0].IsMandatory) {
      await pool.request().input("docid", sql.Int, docId).input("ub", sql.Int, actorId(req)).query(`
        UPDATE dbo.CrmSalesDeedDocument SET FileBase64 = NULL, FileName = NULL, MimeType = NULL, FileSize = NULL,
        Status = 'Requested', UploadedByType = NULL, UploadedAt = NULL, UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @docid
      `);
    } else {
      await pool.request().input("docid", sql.Int, docId).query("DELETE FROM dbo.CrmSalesDeedDocument WHERE Id = @docid");
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 19. POST /
router.post("/", requirePageRight("crm-sales-deed", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    if (!b.BookingId) return res.status(400).json({ error: "BookingId is required" });
    const bookingId = parseInt(b.BookingId, 10);

    const activeErr = await requireActiveBooking(pool, bookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });

    const agreement = await pool.request().input("bid", sql.Int, bookingId).query(`
      SELECT TOP 1 Id, Status
      FROM dbo.CrmAgreement
      WHERE BookingId = @bid
      ORDER BY CreatedAt DESC
    `);
    if (!agreement.recordset.length || agreement.recordset[0].Status !== CrmStatus.REGISTERED) {
      return res.status(400).json({ error: "Sale Deed requires the Agreement for Sale to be Registered first" });
    }

    const loanErr = await checkLoanProcessingCleared(pool, bookingId);
    if (loanErr) return res.status(400).json({ error: loanErr });

    const gate = await getProjectSaleGate(pool, bookingId);
    if (gate.requiresHandoverBeforeDeed) {
      const handover = await pool.request().input("bid", sql.Int, bookingId)
        .query("SELECT TOP 1 Status FROM dbo.CrmHandover WHERE BookingId = @bid ORDER BY CreatedAt DESC");
      if (!handover.recordset.length || handover.recordset[0].Status !== "Completed") {
        return res.status(400).json({ error: "For under-construction properties, physical possession (Handover) must be completed before the Sale Deed is prepared" });
      }
    }

    const deedNo = await getNextDocNumber(pool, "DEED", "DEED");

    const result = await pool.request()
      .input("no",      sql.NVarChar(30),      deedNo)
      .input("bid",     sql.Int,               bookingId)
      .input("agid",    sql.Int,               b.AgreementId ? parseInt(b.AgreementId) : (agreement.recordset[0]?.Id || null))
      .input("val",     sql.Decimal(18,2),     b.DeedValue != null && b.DeedValue !== "" ? parseFloat(b.DeedValue) : null)
      .input("stamp",   sql.Decimal(18,2),     b.StampDuty != null && b.StampDuty !== "" ? parseFloat(b.StampDuty) : null)
      .input("regfee",  sql.Decimal(18,2),     b.RegistrationFee != null && b.RegistrationFee !== "" ? parseFloat(b.RegistrationFee) : null)
      .input("credit",  sql.Decimal(18,2),     b.StampDutyCredit != null && b.StampDutyCredit !== "" ? parseFloat(b.StampDutyCredit) : null)
      .input("sro",     sql.NVarChar(255),     b.SubRegistrarOffice || null)
      .input("dt",      sql.Date,              b.DeedDate || null)
      .input("regdl",   sql.Date,              b.RegistrationDeadline || null)
      // ExecutedBy is never accepted here — it's the deed's actual signing
      // event, which the Senior → Customer → Director approval chain exists
      // specifically to clear first (see assertDeedReadyForExecution above).
      // Accepting it at creation would let a deed reach "Executed" the
      // instant it's created, before any approval — the exact bypass this
      // whole gate exists to close. It can only ever be set afterward,
      // through the gated PUT /:id path.
      .input("exby",    sql.NVarChar(200),     null)
      .input("wit",     sql.NVarChar(500),     b.WitnessNames || null)
      .input("note",    sql.NVarChar(sql.MAX), b.Notes || null)
      .input("cb",      sql.Int,               actorId(req))
      .input("st",      sql.NVarChar(30),      deriveDeedStatus({ bookingStatus: null, registrationNo: null, executedBy: null, deedDate: b.DeedDate || null, registrationDeadline: b.RegistrationDeadline || null }))
      .query(`
        INSERT INTO dbo.CrmSalesDeed
          (DeedNo, BookingId, AgreementId, DeedValue, StampDuty, RegistrationFee, StampDutyCredit, SubRegistrarOffice, DeedDate, RegistrationDeadline, ExecutedBy, WitnessNames, Status, Notes, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@no, @bid, @agid, @val, @stamp, @regfee, @credit, @sro, @dt, @regdl, @exby, @wit, @st, @note, @cb, SYSDATETIME())
      `);

    const deedId = result.recordset[0].Id;

    await pool.request()
      .input('did', sql.Int, deedId)
      .input('cb', sql.Int, actorId(req))
      .query(`
        INSERT INTO dbo.CrmSalesDeedDocument
          (SalesDeedId, DocumentType, Label, IsMandatory, Status, RequestedBy, RequestedAt, VersionNo, CreatedBy, CreatedAt)
        VALUES (@did, 'DeedDraft', 'Sale Deed Draft (Physical Legal Document)', 1, 'Requested', @cb, SYSDATETIME(), 1, @cb, SYSDATETIME())
      `);

    try {
      await maybeAutoCreateLegalMilestone(pool, bookingId, actorId(req));
    } catch (e) {
      console.error("[crm-sales-deed] legal milestone auto-start failed:", e.message);
    }

    res.status(201).json({ success: true, id: deedId, DeedNo: deedNo });
  } catch (e) {
    if (e.message?.includes("UNIQUE") || e.message?.includes("unique"))
      return res.status(409).json({ error: "A sale deed already exists for this booking" });
    console.error("[crm-sales-deed] POST error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// 20. PUT /:id/proxy-customer-approve
const PROXY_METHODS_SD = ["Phone", "InPerson", "Email", "WhatsApp", "Other"];
router.put("/:id/proxy-customer-approve", requirePageRight("crm-sales-deed", "edit"), async (req, res) => {
  try {
    const pool  = getPool();
    const id    = parseInt(req.params.id);
    const { ProxyMethod, ProxyRemarks } = req.body;

    if (!ProxyMethod || !PROXY_METHODS_SD.includes(ProxyMethod)) {
      return res.status(400).json({ error: `ProxyMethod is required. Must be one of: ${PROXY_METHODS_SD.join(", ")}` });
    }
    if (!ProxyRemarks?.trim()) return res.status(400).json({ error: "ProxyRemarks are required" });

    const cur = await pool.request().input("id", sql.Int, id)
      .query("SELECT CustomerApprovalStatus, SentToCustomerAt, DeedNo, BookingId FROM dbo.CrmSalesDeed WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "Sales deed not found" });
    const row = cur.recordset[0];
    if (!row.SentToCustomerAt) return res.status(400).json({ error: "Sales deed has not been sent to the customer yet" });
    if (row.CustomerApprovalStatus === CrmStatus.APPROVED) return res.status(400).json({ error: "Sales deed already approved" });

    await pool.request().input("id", sql.Int, id).query(`
      UPDATE dbo.CrmSalesDeed SET
        CustomerApprovalStatus = '${CrmStatus.APPROVED}',
        CustomerApprovedAt = SYSDATETIME(),
        CustomerRecheckRemarks = NULL,
        DirectorApprovalStatus = '${CrmStatus.PENDING}'
      WHERE Id = @id
    `);

    await logCommunication(pool, {
      bookingId: row.BookingId, direction: "Inbound",
      subject: `Customer approved sales deed ${row.DeedNo} (via ${ProxyMethod})`,
      summary: `Staff recorded customer approval on their behalf via ${ProxyMethod}. ${ProxyRemarks.trim()}`,
    });

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 21. PUT /:id/proxy-customer-recheck
router.put("/:id/proxy-customer-recheck", requirePageRight("crm-sales-deed", "edit"), async (req, res) => {
  try {
    const pool  = getPool();
    const id    = parseInt(req.params.id);
    const { ProxyMethod, ProxyRemarks } = req.body;

    if (!ProxyMethod || !PROXY_METHODS_SD.includes(ProxyMethod)) {
      return res.status(400).json({ error: `ProxyMethod is required. Must be one of: ${PROXY_METHODS_SD.join(", ")}` });
    }
    if (!ProxyRemarks?.trim()) return res.status(400).json({ error: "ProxyRemarks (customer's concern) are required for a recheck" });

    const cur = await pool.request().input("id", sql.Int, id)
      .query("SELECT CustomerApprovalStatus, SentToCustomerAt, DeedNo, BookingId FROM dbo.CrmSalesDeed WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "Sales deed not found" });
    const row = cur.recordset[0];
    if (!row.SentToCustomerAt) return res.status(400).json({ error: "Sales deed has not been sent to the customer yet" });
    if (row.CustomerApprovalStatus === CrmStatus.APPROVED) return res.status(400).json({ error: "Sales deed already approved — cannot record a recheck" });

    await pool.request().input("id", sql.Int, id).input("rem", sql.NVarChar(sql.MAX), ProxyRemarks.trim()).query(`
      UPDATE dbo.CrmSalesDeed SET
        CustomerApprovalStatus = 'RecheckRequested',
        CustomerApprovedAt = NULL,
        CustomerRecheckRemarks = @rem
      WHERE Id = @id
    `);

    await logCommunication(pool, {
      bookingId: row.BookingId, direction: "Inbound",
      subject: `Customer requested recheck on sales deed ${row.DeedNo} (via ${ProxyMethod})`,
      summary: `Staff recorded customer recheck request via ${ProxyMethod}. Concern: ${ProxyRemarks.trim()}`,
    });

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 22. PUT /:id/cancel
router.put("/:id/cancel", requirePageRight("crm-sales-deed", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);

    const cur = await pool.request().input("id", sql.Int, id).query(`SELECT Status, BookingId FROM dbo.CrmSalesDeed WHERE Id = @id`);
    if (!cur.recordset.length) return res.status(404).json({ error: "Deed not found" });

    const currentStatus = cur.recordset[0].Status;
    if (['Registered', 'Cancelled'].includes(currentStatus)) {
      return res.status(400).json({ error: `Cannot cancel a deed in status '${currentStatus}'` });
    }

    await pool.request()
      .input("id", sql.Int, id)
      .input("ub", sql.Int, actorId(req))
      .query(`UPDATE dbo.CrmSalesDeed SET Status = 'Cancelled', UpdatedBy = @ub, UpdatedAt = SYSDATETIME() WHERE Id = @id`);

    logDeedApprovalHistory(id, 'Cancelled', 'Sale deed cancelled by staff', actorId(req), 'Staff').catch(e => console.error("Error logging cancellation:", e));

    res.json({ success: true, status: 'Cancelled' });
  } catch (e) {
    console.error("[crm-sales-deed] cancel error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
