const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId, requireUserEmail } = require("../services/saAccess");
const { getNextDocNumber } = require("../services/docNumber");
const { logCommunication } = require("../services/crmCommunicationLog");
const { requireActiveBooking } = require("../services/crmWorkflowGuards");
const { transition: approvalTransition, recordGLPosting } = require("../services/approvalService");
const { emitNotification } = require("../services/notify");
const { postCrmSalesDeedStatutoryToGL } = require("../services/crmLedger");

router.use(authMiddleware);
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));

const DEED_SELECT = `
  SELECT d.*, b.BookingNo, b.UnitNo, b.TotalValue AS BookingValue, b.Status AS BookingStatus, a.ApplicantName, a.Mobile
  FROM dbo.CrmSalesDeed d
  JOIN dbo.CrmBooking b ON b.Id = d.BookingId
  JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
`;

// Status is never a free pick — it is derived, level by level, from the
// actual data on record: RegistrationNo present -> Registered; else
// ExecutedBy present -> Executed; else the deed date having already passed
// -> Overdue; else Draft. A cancelled booking always wins (Cancelled).
function deriveDeedStatus({ bookingStatus, registrationNo, executedBy, deedDate }) {
  if (bookingStatus === "Cancelled") return "Cancelled";
  if (registrationNo) return "Registered";
  if (executedBy) return "Executed";
  if (deedDate && new Date(deedDate) < new Date(new Date().toDateString())) return "Overdue";
  return "Draft";
}

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
      }),
    }));
    res.json(status ? rows.filter((r) => r.Status === status) : rows);
  } catch (e) {
    console.error("[crm-sales-deed] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

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
    if (!agreement.recordset.length || agreement.recordset[0].Status !== "Executed") {
      return res.status(400).json({ error: "Agreement must be executed before a sales deed can be prepared" });
    }

    const pendingMilestones = await pool.request().input("bid", sql.Int, bookingId).query(`
      SELECT COUNT(*) AS PendingCount
      FROM dbo.CrmPaymentMilestone
      WHERE BookingId = @bid AND Status NOT IN ('Paid', 'Waived')
    `);
    if (pendingMilestones.recordset[0]?.PendingCount > 0) {
      return res.status(400).json({ error: "All payment milestones must be paid or waived before sales deed preparation" });
    }

    const deedNo = await getNextDocNumber(pool, "DEED", "DEED");

    const result = await pool.request()
      .input("no",   sql.NVarChar(30),  deedNo)
      .input("bid",  sql.Int,           bookingId)
      .input("agid", sql.Int,           b.AgreementId ? parseInt(b.AgreementId) : agreement.recordset[0].Id)
      .input("val",  sql.Decimal(18,2), b.DeedValue != null ? parseFloat(b.DeedValue) : null)
      .input("stamp",sql.Decimal(18,2), b.StampDuty != null ? parseFloat(b.StampDuty) : null)
      .input("regfee",sql.Decimal(18,2), b.RegistrationFee != null ? parseFloat(b.RegistrationFee) : null)
      .input("sro",  sql.NVarChar(255), b.SubRegistrarOffice || null)
      .input("dt",   sql.Date,          b.DeedDate || null)
      .input("exby", sql.NVarChar(200), b.ExecutedBy || null)
      .input("wit",  sql.NVarChar(500), b.WitnessNames || null)
      .input("note", sql.NVarChar(sql.MAX), b.Notes || null)
      .input("cb",   sql.Int,           actorId(req))
      .input("st",   sql.NVarChar(30),  deriveDeedStatus({ bookingStatus: null, registrationNo: null, executedBy: b.ExecutedBy || null, deedDate: b.DeedDate || null }))
      .query(`
        INSERT INTO dbo.CrmSalesDeed
          (DeedNo, BookingId, AgreementId, DeedValue, StampDuty, RegistrationFee, SubRegistrarOffice, DeedDate, ExecutedBy, WitnessNames, Status, Notes, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@no, @bid, @agid, @val, @stamp, @regfee, @sro, @dt, @exby, @wit, @st, @note, @cb, SYSDATETIME())
      `);
    res.status(201).json({ success: true, id: result.recordset[0].Id, DeedNo: deedNo });
  } catch (e) {
    if (e.message?.includes("UNIQUE") || e.message?.includes("unique"))
      return res.status(409).json({ error: "A sale deed already exists for this booking" });
    console.error("[crm-sales-deed] POST error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id/send-to-customer - publish the sales deed to the portal for the
// customer's approval. Registration still depends on the legal registration
// fields; this only records the customer-facing approval checkpoint.
router.put("/:id/send-to-customer", requirePageRight("crm-sales-deed", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    const deed = await pool.request().input("id", sql.Int, id).query(`
      SELECT d.Id, d.Status, ag.Status AS AgreementStatus
      FROM dbo.CrmSalesDeed d
      LEFT JOIN dbo.CrmAgreement ag ON ag.Id = d.AgreementId
      WHERE d.Id = @id
    `);
    if (!deed.recordset.length) return res.status(404).json({ error: "Sale deed not found" });
    const bookingRow = await pool.request().input("id", sql.Int, id).query(`
      SELECT d.BookingId FROM dbo.CrmSalesDeed d WHERE d.Id = @id
    `);
    const activeErr = await requireActiveBooking(pool, bookingRow.recordset[0].BookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });
    if (deed.recordset[0].AgreementStatus !== "Executed") {
      return res.status(400).json({ error: "Agreement must be executed before sending the sales deed to the customer" });
    }
    if (deed.recordset[0].Status === "Registered") {
      return res.status(400).json({ error: "Registered sales deed cannot be resent for customer approval" });
    }

    await pool.request()
      .input("id", sql.Int, id)
      .input("ub", sql.Int, actorId(req))
      .query(`
        UPDATE dbo.CrmSalesDeed SET
          SentToCustomerAt = SYSDATETIME(),
          CustomerApprovalStatus = 'Pending',
          CustomerApprovedAt = NULL,
          CustomerRecheckRemarks = NULL,
          UpdatedBy = @ub,
          UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);

    res.json({ success: true });
  } catch (e) {
    console.error("[crm-sales-deed] send-to-customer error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id/director/approve — the third and final sign-off gate: "SALES
// DEED -> APPROVAL FROM BOTH SIDES -> DIRECTOR APPROVAL -> SALES DEED
// COMPLETE -> KEY HANDOVER". Restricted to super_admin only via
// approvalService's MODULE_APPROVER_ROLE_OVERRIDES + the seeded
// LevelsData — same "hardcoded for now, reassignable later with zero code
// change" pattern used for Senior Approval and the Agreement Date gate.
router.put("/:id/director/approve", requirePageRight("crm-sales-deed", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const pool0 = getPool();
    const deedBooking = await pool0.request().input("id", sql.Int, id).query("SELECT BookingId, CustomerApprovalStatus FROM dbo.CrmSalesDeed WHERE Id = @id");
    if (!deedBooking.recordset.length) return res.status(404).json({ error: "Sale deed not found" });
    const activeErr0 = await requireActiveBooking(pool0, deedBooking.recordset[0].BookingId);
    if (activeErr0) return res.status(400).json({ error: activeErr0 });

    // The stated sequence is Agreement Executed -> Customer Approval ->
    // Director Approval ("the third and final sign-off gate") -- enforced
    // here, not just described in a comment, the same way CrmBooking.tsx's
    // getNextStep() requires both SeniorApprovalStatus and
    // CustomerApprovalStatus to be 'Approved' before the Agreement step is
    // considered done. Without this, a director could approve (and trigger
    // the handover-ready notification below) a deed the customer hasn't
    // approved yet -- or hasn't even been sent to.
    if (deedBooking.recordset[0].CustomerApprovalStatus !== "Approved") {
      return res.status(400).json({ error: `Customer must approve the sales deed before director approval (current status: ${deedBooking.recordset[0].CustomerApprovalStatus || "not sent"})` });
    }

    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;
    const remarks = req.body?.Remarks || null;
    const result = await approvalTransition("crm-sales-deed-director", id, "Approved", userEmail, req.user?.role, remarks, actorId(req));
    if (result.newStatus === "Approved") {
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
      const row = info.recordset[0];
      if (row?.AssignedTo) {
        await emitNotification(pool, row.AssignedTo, "crm_sales_deed_director_approved",
          "Sales Deed Director-Approved",
          `${row.DeedNo} (${row.BookingNo}) has been director-approved — handover can now be scheduled.`,
          id, "crm_sales_deed");
      }
      await logCommunication(pool, {
        bookingId: row?.BookingId, direction: "Outbound",
        subject: `Sales deed ${row?.DeedNo} director-approved`,
        summary: "Director approval complete — handover can now proceed.",
        createdBy: actorId(req),
      });
    }
    res.json({ success: true, status: result.newStatus, ...result });
  } catch (e) {
    console.error("[crm-sales-deed] director/approve error:", e.message);
    res.status(e.status || (e.message.includes("not authorized") ? 403 : 400)).json({ error: e.message });
  }
});

// PUT /:id/director/reject — sends it back for rework; staff must re-submit
// once the concern is addressed (mirrors the Senior Approval reject shape).
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
    const result = await approvalTransition("crm-sales-deed-director", id, "Rejected", userEmail, req.user?.role, remarks);
    const pool = getPool();
    await pool.request()
      .input("id", sql.Int, id)
      .input("rem", sql.NVarChar(sql.MAX), remarks)
      .query("UPDATE dbo.CrmSalesDeed SET DirectorApprovalRemarks = @rem WHERE Id = @id");
    res.json({ success: true, status: result.newStatus });
  } catch (e) {
    console.error("[crm-sales-deed] director/reject error:", e.message);
    res.status(e.status || (e.message.includes("not authorized") ? 403 : 400)).json({ error: e.message });
  }
});

// Status is never accepted from the request body — it is recomputed from
// the resulting data (RegistrationNo, ExecutedBy, DeedDate, booking Status)
// after every update via deriveDeedStatus().
router.put("/:id", requirePageRight("crm-sales-deed", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    const id = parseInt(req.params.id);

    const cur = await pool.request().input("id", sql.Int, id).query(`
      SELECT d.RegistrationNo, d.ExecutedBy, d.DeedDate, d.BookingId, d.DeedNo, b.Status AS BookingStatus
      FROM dbo.CrmSalesDeed d JOIN dbo.CrmBooking b ON b.Id = d.BookingId
      WHERE d.Id = @id
    `);
    if (!cur.recordset.length) return res.status(404).json({ error: "Sale deed not found" });
    const row = cur.recordset[0];

    const activeErr = await requireActiveBooking(pool, row.BookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });

    const newStatus = deriveDeedStatus({
      bookingStatus: row.BookingStatus,
      registrationNo: b.RegistrationNo || row.RegistrationNo,
      executedBy: b.ExecutedBy || row.ExecutedBy,
      deedDate: b.DeedDate || row.DeedDate,
    });

    await pool.request()
      .input("id",    sql.Int,  id)
      .input("regno", sql.NVarChar(100), b.RegistrationNo || null)
      .input("bookno",sql.NVarChar(100), b.BookNo || null)
      .input("partno",sql.NVarChar(100), b.PartNo || null)
      .input("regdt", sql.Date, b.RegistrationDate || null)
      .input("posdt", sql.Date, b.PossessionDate || null)
      .input("exby",  sql.NVarChar(200), b.ExecutedBy || null)
      .input("st",    sql.NVarChar(30), newStatus)
      .input("note",  sql.NVarChar(sql.MAX), b.Notes || null)
      .input("ub",    sql.Int,  actorId(req))
      .query(`
        UPDATE dbo.CrmSalesDeed SET
          RegistrationNo = ISNULL(@regno, RegistrationNo), BookNo = ISNULL(@bookno, BookNo),
          PartNo = ISNULL(@partno, PartNo), RegistrationDate = ISNULL(@regdt, RegistrationDate),
          PossessionDate = ISNULL(@posdt, PossessionDate), ExecutedBy = ISNULL(@exby, ExecutedBy),
          Status = @st, Notes = @note, UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);

    // Auto-flow: "LAST MILESTONE -> SALES DEED -> CUSTOMER APPROVAL" — the
    // moment the deed becomes legally Executed (ExecutedBy just filled in),
    // it's ready to show the customer. No separate manual "send" click
    // needed, same as the agreement's auto-send on senior approval.
    if (newStatus === "Executed") {
      const sent = await pool.request().input("id", sql.Int, id).query("SELECT SentToCustomerAt FROM dbo.CrmSalesDeed WHERE Id = @id");
      if (!sent.recordset[0].SentToCustomerAt) {
        await pool.request().input("id", sql.Int, id).query(`
          UPDATE dbo.CrmSalesDeed SET SentToCustomerAt = SYSDATETIME(), CustomerApprovalStatus = 'Pending', CustomerApprovedAt = NULL
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

    // "REGISTERED -> STATUTORY COST INCURRED" — the moment RegistrationNo is
    // filed, stamp duty + registration fee are real money the company has
    // paid the Sub-Registrar Office. Never blocks the update itself if GL
    // posting fails — same try/catch + recordGLPosting pattern used for
    // CRM payments/brokerage/cancellations.
    if (newStatus === "Registered" && !row.RegistrationNo) {
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
    console.error("[crm-sales-deed] PUT error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;