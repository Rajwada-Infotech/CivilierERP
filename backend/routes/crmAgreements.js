const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const apiRateLimit = require("../middleware/apiRateLimit");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId, requireUserEmail } = require("../services/saAccess");
const { getNextDocNumber } = require("../services/docNumber");
const { logCrmAudit } = require("../services/crmAudit");
const { ensurePortalUser } = require("../services/crmPortalProvision");

// Senior approval is gated to admin/super_admin/dba via this shared engine —
// same mechanism BOQ/Purchase Orders/etc. use — instead of any editor being
// able to self-approve on this page.
const { transition: approvalTransition } = require("../services/approvalService");

// Explicit agreement workflow state machine — matches the Status values the
// handover workflow guard (crmHandover.js) already checks for.
const AGREEMENT_TRANSITIONS = {
  Draft:      ["Draft", "Executed", "Cancelled"],
  Executed:   ["Executed", "Registered", "Cancelled"],
  Registered: ["Registered"],
  Cancelled:  ["Cancelled"],
};

router.use(authMiddleware);
router.use(apiRateLimit);

const AGR_SELECT = `
  SELECT
    ag.Id, ag.AgreementNo, ag.BookingId, ag.AgreementDate,
    ag.LegalName, ag.LegalAddress, ag.PanNo, ag.AadhaarNo,
    ag.Status, ag.Notes, ag.CreatedAt, ag.UpdatedAt,
    ag.SeniorApprovalStatus, ag.SeniorApprovedAt, ag.SeniorApprovalRemarks,
    ag.CustomerApprovalStatus, ag.CustomerApprovedAt,
    ag.RecheckCount, ag.LastRecheckRemarks,
    ag.ProposedDateByCompany, ag.ProposedDateByCustomer, ag.SentToCustomerAt,
    b.BookingNo, b.UnitNo, b.ProjectName, b.TotalValue,
    a.ApplicantName, a.Mobile, a.Email,
    cu.name AS CreatedByName
  FROM dbo.CrmAgreement ag
  JOIN  dbo.CrmBooking b     ON b.Id = ag.BookingId
  JOIN  dbo.CrmApplication a ON a.Id = b.ApplicationId
  LEFT JOIN dbo.Users cu     ON cu.id = ag.CreatedBy
`;

// GET / — all agreements
router.get("/", requirePageRight("crm-agreements", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const { status } = req.query;
    const req0 = pool.request();
    const conds = [];
    if (status) { req0.input("st", sql.NVarChar(30), status); conds.push("ag.Status = @st"); }
    const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
    const result = await req0.query(`${AGR_SELECT} ${where} ORDER BY ag.CreatedAt DESC`);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-agreements] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /:id — agreement with documents
router.get("/:id", requirePageRight("crm-agreements", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const [agRes, docRes] = await Promise.all([
      pool.request().input("id", sql.Int, id).query(`${AGR_SELECT} WHERE ag.Id = @id`),
      pool.request().input("id", sql.Int, id).query(
        `SELECT d.*, cu.name AS CreatedByName FROM dbo.CrmAgreementDocument d LEFT JOIN dbo.Users cu ON cu.id = d.CreatedBy WHERE d.AgreementId = @id ORDER BY d.CreatedAt`),
    ]);
    if (!agRes.recordset[0]) return res.status(404).json({ error: "Agreement not found" });
    res.json({ agreement: agRes.recordset[0], documents: docRes.recordset });
  } catch (e) {
    console.error("[crm-agreements] GET /:id error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST / — create agreement for a booking (one per booking, enforced by UNIQUE on BookingId)
router.post("/", requirePageRight("crm-agreements", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    if (!b.BookingId) return res.status(400).json({ error: "BookingId is required" });

    // System-assigned unique agreement number
    const agNo = await getNextDocNumber(pool, "AGR", "AGR");

    // Status always starts Draft — it is never accepted from the request body,
    // here or in PUT below. It only ever advances via /:id/mark-executed,
    // /:id/mark-registered, /:id/cancel — each gated on the real workflow
    // step (approvals, dates) actually having happened, not a free choice.
    const result = await pool.request()
      .input("agno",  sql.NVarChar(50),  agNo)
      .input("bid",   sql.Int,           parseInt(b.BookingId))
      .input("adt",   sql.Date,          b.AgreementDate || null)
      .input("lname", sql.NVarChar(300), b.LegalName     || null)
      .input("laddr", sql.NVarChar(sql.MAX), b.LegalAddress  || null)
      .input("pan",   sql.NVarChar(20),  b.PanNo         || null)
      .input("aadh",  sql.NVarChar(20),  b.AadhaarNo     || null)
      .input("note",  sql.NVarChar(sql.MAX), b.Notes || null)
      .input("cb",    sql.Int,           actorId(req))
      .query(`
        INSERT INTO dbo.CrmAgreement
          (AgreementNo, BookingId, AgreementDate, LegalName, LegalAddress, PanNo, AadhaarNo, Status, Notes, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@agno, @bid, @adt, @lname, @laddr, @pan, @aadh, 'Draft', @note, @cb, SYSDATETIME())
      `);
    const agreementId = result.recordset[0].Id;

    // Parallel: auto-create the customer portal login the moment agreement
    // preparation begins, so the customer can start tracking progress.
    const appRow = await pool.request().input("bid", sql.Int, parseInt(b.BookingId))
      .query("SELECT ApplicationId FROM dbo.CrmBooking WHERE Id = @bid");
    let portalInfo = null;
    if (appRow.recordset.length) {
      portalInfo = await ensurePortalUser(pool, appRow.recordset[0].ApplicationId);
    }

    res.status(201).json({ success: true, id: agreementId, AgreementNo: agNo, portal: portalInfo });
  } catch (e) {
    if (e.message?.includes("UNIQUE") || e.message?.includes("unique"))
      return res.status(409).json({ error: "An agreement already exists for this booking" });
    console.error("[crm-agreements] POST error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id/submit — Rejected -> Pending. Lets staff resubmit a senior-rejected
// agreement for another approval pass (no role restriction — this is not
// an approval action).
router.put("/:id/submit", requirePageRight("crm-agreements", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;
    const result = await approvalTransition("crm-agreements", id, "Pending", userEmail, req.user?.role);
    res.json({ success: true, status: result.newStatus });
  } catch (e) {
    console.error("[crm-agreements] submit error:", e.message);
    res.status(e.status || 400).json({ error: e.message });
  }
});

// PUT /:id/approve — senior approval. Admin/super_admin/dba only, enforced
// inside approvalTransition(). Only reachable from the Admin Approval Inbox
// now — there is no self-approve button on the agreement page anymore.
router.put("/:id/approve", requirePageRight("crm-agreements", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;
    const remarks = req.body?.Remarks || null;
    const result = await approvalTransition("crm-agreements", id, "Approved", userEmail, req.user?.role, remarks);

    await logApprovalHistory(id, "SeniorApprove", remarks, actorId(req));
    res.json({ success: true, status: result.newStatus });
  } catch (e) {
    console.error("[crm-agreements] approve error:", e.message);
    res.status(e.status || (e.message.includes("not authorized") ? 403 : 400)).json({ error: e.message });
  }
});

// PUT /:id/reject — senior rejection. Admin/super_admin/dba only.
router.put("/:id/reject", requirePageRight("crm-agreements", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;
    const remarks = req.body?.Remarks || null;
    const result = await approvalTransition("crm-agreements", id, "Rejected", userEmail, req.user?.role, remarks);

    await logApprovalHistory(id, "SeniorReject", remarks, actorId(req));
    res.json({ success: true, status: result.newStatus });
  } catch (e) {
    console.error("[crm-agreements] reject error:", e.message);
    res.status(e.status || (e.message.includes("not authorized") ? 403 : 400)).json({ error: e.message });
  }
});

// CRM-specific friendly approval history (SendToCustomer/CustomerApprove/
// CustomerRecheck live here too) — separate from, and in addition to, the
// generic ApprovalAuditLog the engine above writes for security purposes.
async function logApprovalHistory(agreementId, action, remarks, actorIdVal) {
  const pool = getPool();
  await pool.request()
    .input("agid", sql.Int, agreementId)
    .input("act",  sql.NVarChar(30), action)
    .input("rem",  sql.NVarChar(sql.MAX), remarks || null)
    .input("aid",  sql.Int, actorIdVal)
    .query(`
      INSERT INTO dbo.CrmAgreementApprovalLog (AgreementId, Action, Remarks, ActorType, ActorId, CreatedAt)
      VALUES (@agid, @act, @rem, 'Staff', @aid, SYSDATETIME())
    `);
}

// PUT /:id/send-to-customer — publish the agreement to the customer portal
// for their approval; requires senior approval first.
router.put("/:id/send-to-customer", requirePageRight("crm-agreements", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const { proposedDate } = req.body;

    const ag = await pool.request().input("id", sql.Int, id)
      .query("SELECT SeniorApprovalStatus, BookingId FROM dbo.CrmAgreement WHERE Id = @id");
    if (!ag.recordset.length) return res.status(404).json({ error: "Agreement not found" });
    if (ag.recordset[0].SeniorApprovalStatus !== "Approved") {
      return res.status(400).json({ error: "Agreement must receive senior approval before it can be sent to the customer" });
    }

    await pool.request()
      .input("id",  sql.Int, id)
      .input("pdc", sql.Date, proposedDate || null)
      .query(`
        UPDATE dbo.CrmAgreement SET
          SentToCustomerAt = SYSDATETIME(),
          CustomerApprovalStatus = 'Pending',
          ProposedDateByCompany = ISNULL(@pdc, ProposedDateByCompany)
        WHERE Id = @id
      `);

    await pool.request()
      .input("agid", sql.Int, id)
      .input("aid",  sql.Int, actorId(req))
      .query(`
        INSERT INTO dbo.CrmAgreementApprovalLog (AgreementId, Action, ActorType, ActorId, CreatedAt)
        VALUES (@agid, 'SendToCustomer', 'Staff', @aid, SYSDATETIME())
      `);

    res.json({ success: true });
  } catch (e) {
    console.error("[crm-agreements] PUT /:id/send-to-customer error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id — update agreement
// Generic PUT never accepts Status — it is auto-derived, never freely chosen.
// Status only ever advances via /:id/mark-executed, /:id/mark-registered,
// /:id/cancel below, each gated on the real workflow step having happened.
router.put("/:id", requirePageRight("crm-agreements", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    const id = parseInt(req.params.id);
    const actor = actorId(req);

    const old = await pool.request().input("id", sql.Int, id)
      .query("SELECT Status FROM dbo.CrmAgreement WHERE Id = @id");
    if (!old.recordset.length) return res.status(404).json({ error: "Agreement not found" });

    await pool.request()
      .input("id",    sql.Int,           id)
      .input("adt",   sql.Date,          b.AgreementDate || null)
      .input("lname", sql.NVarChar(300), b.LegalName     || null)
      .input("laddr", sql.NVarChar(sql.MAX), b.LegalAddress  || null)
      .input("pan",   sql.NVarChar(20),  b.PanNo         || null)
      .input("aadh",  sql.NVarChar(20),  b.AadhaarNo     || null)
      .input("note",  sql.NVarChar(sql.MAX), b.Notes || null)
      .input("ub",    sql.Int,           actor)
      .query(`
        UPDATE dbo.CrmAgreement SET
          AgreementDate = ISNULL(@adt, AgreementDate), LegalName = ISNULL(@lname, LegalName),
          LegalAddress = @laddr, PanNo = @pan, AadhaarNo = @aadh,
          Notes = @note, UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);

    res.json({ success: true });
  } catch (e) {
    console.error("[crm-agreements] PUT error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id/mark-executed — Draft -> Executed. Gated on the real-world facts
// that make an agreement "executed": both senior and customer approvals
// already granted, and an AgreementDate on record (provided now if missing).
router.put("/:id/mark-executed", requirePageRight("crm-agreements", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const b = req.body || {};
    const actor = actorId(req);

    const cur = await pool.request().input("id", sql.Int, id).query(`
      SELECT Status, AgreementDate, SeniorApprovalStatus, CustomerApprovalStatus
      FROM dbo.CrmAgreement WHERE Id = @id
    `);
    if (!cur.recordset.length) return res.status(404).json({ error: "Agreement not found" });
    const row = cur.recordset[0];

    if (row.Status !== "Draft") {
      return res.status(400).json({ error: `Cannot mark-executed from status '${row.Status}'` });
    }
    if (row.SeniorApprovalStatus !== "Approved" || row.CustomerApprovalStatus !== "Approved") {
      return res.status(400).json({ error: "Both senior and customer approval must be Approved before execution" });
    }
    if (!row.AgreementDate && !b.AgreementDate) {
      return res.status(400).json({ error: "AgreementDate is required to mark the agreement executed" });
    }

    await pool.request()
      .input("id",  sql.Int, id)
      .input("adt", sql.Date, b.AgreementDate || null)
      .input("ub",  sql.Int, actor)
      .query(`
        UPDATE dbo.CrmAgreement SET
          Status = 'Executed', AgreementDate = ISNULL(@adt, AgreementDate),
          UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);

    await logCrmAudit(pool, "Agreement", id, actor, [
      { field: "Status", oldVal: "Draft", newVal: "Executed" },
    ]);

    res.json({ success: true, status: "Executed" });
  } catch (e) {
    console.error("[crm-agreements] mark-executed error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id/mark-registered — Executed -> Registered. Gated on the linked
// CrmSalesDeed actually carrying a RegistrationNo — the real evidence of
// registration, not a free-form pick.
router.put("/:id/mark-registered", requirePageRight("crm-agreements", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const actor = actorId(req);

    const cur = await pool.request().input("id", sql.Int, id)
      .query("SELECT Status FROM dbo.CrmAgreement WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "Agreement not found" });
    if (cur.recordset[0].Status !== "Executed") {
      return res.status(400).json({ error: `Cannot mark-registered from status '${cur.recordset[0].Status}'` });
    }

    const deed = await pool.request().input("id", sql.Int, id)
      .query("SELECT TOP 1 RegistrationNo FROM dbo.CrmSalesDeed WHERE AgreementId = @id");
    if (!deed.recordset.length || !deed.recordset[0].RegistrationNo) {
      return res.status(400).json({ error: "A Sales Deed with a Registration No. must exist before this agreement can be marked Registered" });
    }

    await pool.request()
      .input("id", sql.Int, id)
      .input("ub", sql.Int, actor)
      .query(`
        UPDATE dbo.CrmAgreement SET Status = 'Registered', UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);

    await logCrmAudit(pool, "Agreement", id, actor, [
      { field: "Status", oldVal: "Executed", newVal: "Registered" },
    ]);

    res.json({ success: true, status: "Registered" });
  } catch (e) {
    console.error("[crm-agreements] mark-registered error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id/cancel — Draft/Executed -> Cancelled. Business action (matches
// crmCancellations.js / crmNoc.js pattern), not admin-approval-gated — a
// forward-only terminal transition, blocked once already Registered.
router.put("/:id/cancel", requirePageRight("crm-agreements", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const actor = actorId(req);

    const cur = await pool.request().input("id", sql.Int, id)
      .query("SELECT Status FROM dbo.CrmAgreement WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "Agreement not found" });
    const allowed = AGREEMENT_TRANSITIONS[cur.recordset[0].Status] || [];
    if (!allowed.includes("Cancelled")) {
      return res.status(400).json({ error: `Cannot cancel an agreement in status '${cur.recordset[0].Status}'` });
    }

    await pool.request()
      .input("id", sql.Int, id)
      .input("ub", sql.Int, actor)
      .query(`
        UPDATE dbo.CrmAgreement SET Status = 'Cancelled', UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);

    await logCrmAudit(pool, "Agreement", id, actor, [
      { field: "Status", oldVal: cur.recordset[0].Status, newVal: "Cancelled" },
    ]);

    res.json({ success: true, status: "Cancelled" });
  } catch (e) {
    console.error("[crm-agreements] cancel error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /:id/documents — add a document to an agreement
router.post("/:id/documents", requirePageRight("crm-documents", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    const agreementId = parseInt(req.params.id);
    const DOC_TYPES = ["SaleAgreement","AllotmentLetter","PossessionLetter","RegistrationDoc","NOC","IdentityProof","Other"];
    if (!DOC_TYPES.includes(b.DocumentType))
      return res.status(400).json({ error: `Invalid DocumentType. Must be: ${DOC_TYPES.join(", ")}` });
    await pool.request()
      .input("agid",  sql.Int,            agreementId)
      .input("dtype", sql.NVarChar(100),  b.DocumentType)
      .input("url",   sql.NVarChar(2000), b.DocumentUrl  || null)
      .input("fname", sql.NVarChar(300),  b.FileName     || null)
      .input("iby",   sql.NVarChar(200),  b.IssuedBy     || null)
      .input("st",    sql.NVarChar(30),   b.Status || "Uploaded")
      .input("rem",   sql.NVarChar(sql.MAX), b.Remarks   || null)
      .input("uat",   sql.DateTime2(3),   b.UploadedAt   || null)
      .input("cb",    sql.Int,            actorId(req))
      .query(`
        INSERT INTO dbo.CrmAgreementDocument
          (AgreementId, DocumentType, DocumentUrl, FileName, IssuedBy, Status, Remarks, UploadedAt, CreatedBy, CreatedAt)
        VALUES (@agid, @dtype, @url, @fname, @iby, @st, @rem, ISNULL(@uat, SYSDATETIME()), @cb, SYSDATETIME())
      `);
    res.status(201).json({ success: true });
  } catch (e) {
    console.error("[crm-agreements] POST documents error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id/documents/:docId — update document status
router.put("/:id/documents/:docId", requirePageRight("crm-documents", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    await pool.request()
      .input("id",  sql.Int,          parseInt(req.params.docId))
      .input("st",  sql.NVarChar(30), b.Status || null)
      .input("rem", sql.NVarChar(sql.MAX), b.Remarks || null)
      .input("url", sql.NVarChar(2000), b.DocumentUrl || null)
      .query(`
        UPDATE dbo.CrmAgreementDocument SET
          Status = ISNULL(@st, Status), Remarks = @rem, DocumentUrl = ISNULL(@url, DocumentUrl)
        WHERE Id = @id
      `);
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-agreements] PUT document error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
