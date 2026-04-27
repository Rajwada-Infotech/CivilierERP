const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const { transition, guardEdit } = require("../services/approvalService");

const requireUserEmail = (req, res) => {
  const email = req.user?.email;
  if (!email) { res.status(401).json({ error: "User context missing" }); return null; }
  return email;
};

// ─── /options ── must stay before /:id ────────────────────────────────────────
router.get("/options", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT
        Eid AS id,
        Eid AS value,
        CONCAT(ISNULL(EDocNo,'N/A'),' — ',ISNULL(EProjectName,''),' (₹',ISNULL(CAST(EAmount AS VARCHAR(20)),'0'),')') AS label,
        ECreatedAt
      FROM dbo.ExpenseBooking
      ORDER BY ECreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET all ──────────────────────────────────────────────────────────────────
router.get("/", cache("expense-booking", 300), async (req, res) => {
  try {
    const pool = getPool();
    const page  = Math.max(parseInt(req.query.page)  || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 100);
    const offset = (page - 1) * limit;

    const countResult = await pool.request().query("SELECT COUNT(*) AS total FROM dbo.ExpenseBooking");
    const total = parseInt(countResult.recordset[0].total);

    const result = await pool.request()
      .input("offset", sql.Int, offset)
      .input("limit",  sql.Int, limit)
      .query(`
        SELECT * FROM dbo.ExpenseBooking
        ORDER BY Eid DESC
        OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
      `);

    res.json({ data: result.recordset, page, limit, total, totalPages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /:id/approval-trail ───────────────────────────────────────────────────
router.get("/:id/approval-trail", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });

  try {
    const pool = getPool();

    // Get the workflow configured for expense-booking module
    const wfResult = await pool.request()
      .input("Module", sql.NVarChar(100), "expense-booking")
      .query(`
        SELECT TOP 1 Id, Levels, Approvers
        FROM dbo.ApprovalWorkflows
        WHERE Module = @Module AND Status = 'Active'
        ORDER BY CreatedAt DESC
      `);

    const wf = wfResult.recordset[0];

    // Get audit log entries for this record
    const logResult = await pool.request()
      .input("RecordId",  sql.Int,          id)
      .input("TableName", sql.NVarChar(100), "ExpenseBooking")
      .query(`
        SELECT Level, Role, ApproverEmail, ActionStatus, ActionAt, Note
        FROM dbo.ApprovalAuditLog
        WHERE RecordId = @RecordId AND TableName = @TableName
        ORDER BY Level ASC, ActionAt ASC
      `);

    const logs = logResult.recordset;

    // Get current record status
    const recResult = await pool.request()
      .input("Eid", sql.Int, id)
      .query("SELECT EStatus FROM dbo.ExpenseBooking WHERE Eid = @Eid");
    const currentStatus = recResult.recordset[0]?.EStatus ?? "Draft";

    if (!wf) {
      return res.json({ steps: [], currentLevel: 0, fullyApproved: currentStatus === "Approved" });
    }

    const levels = wf.Levels || 1;
    const approverList = (wf.Approvers || "").split(",").map((s) => s.trim()).filter(Boolean);

    const steps = Array.from({ length: levels }, (_, i) => {
      const lvl = i + 1;
      const log = logs.find((l) => l.Level === lvl && l.ActionStatus === "Approved")
                || logs.find((l) => l.Level === lvl && l.ActionStatus === "Rejected")
                || logs.find((l) => l.Level === lvl);

      return {
        level: lvl,
        role: log?.Role ?? approverList[i] ?? "Approver",
        approverEmail: log?.ApproverEmail ?? approverList[i] ?? null,
        status: (log?.ActionStatus ?? "Pending"),
        actionAt: log?.ActionAt ?? null,
        note: log?.Note ?? null,
      };
    });

    const approvedCount = steps.filter((s) => s.status === "Approved").length;
    const currentLevel = approvedCount + 1 > levels ? levels : approvedCount + 1;

    res.json({
      steps,
      currentLevel,
      fullyApproved: currentStatus === "Approved",
    });
  } catch (err) {
    console.error("Approval trail error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST — create ────────────────────────────────────────────────────────────
router.post("/", async (req, res) => {
  const {
    EProjectName, EDocumentType, EDocDate, EAmount, ENetAmount,
    ECgstRate, ESgstRate, EDiscountData,
    EDocNo, EEmiPayment, EEmiData, EInstallmentCount, EEmiAmount, EEmiStartDate,
    EReminder, ERemarks, EStatus, ECompanyId,
  } = req.body;

  try {
    const pool = getPool();
    await pool.request()
      .input("EProjectName",    sql.NVarChar(150),  EProjectName    || null)
      .input("EDocumentType",   sql.NVarChar(50),   EDocumentType   || null)
      .input("EDocDate",        sql.Date,           EDocDate        || null)
      .input("EAmount",         sql.Decimal(18, 2), EAmount         || null)
      .input("ENetAmount",      sql.Decimal(18, 2), ENetAmount      || null)
      .input("ECgstRate",       sql.Decimal(5, 2),  ECgstRate       ?? 0)
      .input("ESgstRate",       sql.Decimal(5, 2),  ESgstRate       ?? 0)
      .input("EDiscountData",   sql.NVarChar(sql.MAX), EDiscountData ? JSON.stringify(EDiscountData) : null)
      .input("EDocNo",          sql.NVarChar(50),   EDocNo          || null)
      .input("EEmiPayment",     sql.Bit,            EEmiPayment ? 1 : 0)
      .input("EEmiData",        sql.NVarChar(sql.MAX), EEmiData ? JSON.stringify(EEmiData) : null)
      .input("EInstallmentCount", sql.Int,          EInstallmentCount || null)
      .input("EEmiAmount",      sql.Decimal(18, 2), EEmiAmount      || null)
      .input("EEmiStartDate",   sql.Date,           EEmiStartDate   || null)
      .input("EReminder",       sql.Date,           EReminder       || null)
      .input("ERemarks",        sql.NVarChar(300),  ERemarks        || null)
      .input("EStatus",         sql.NVarChar(50),   EStatus         || "Draft")
      .input("ECreatedAt",      sql.DateTime2,      new Date())
      .input("EUpdatedAt",      sql.DateTime2,      new Date())
      .input("ECreatedBy",      sql.Int,            req.user?.userId || null)
      .input("EApprovedBy",     sql.Int,            null)
      .input("ECompanyId",      sql.Int,            ECompanyId ? parseInt(ECompanyId, 10) : null)
      .query(`
        INSERT INTO dbo.ExpenseBooking (
          EProjectName, EDocumentType, EDocDate, EAmount, ENetAmount,
          ECgstRate, ESgstRate, EDiscountData,
          EDocNo, EEmiPayment, EEmiData, EInstallmentCount, EEmiAmount, EEmiStartDate,
          EReminder, ERemarks, EStatus,
          ECreatedAt, EUpdatedAt, ECreatedBy, EApprovedBy, ECompanyId
        ) VALUES (
          @EProjectName, @EDocumentType, @EDocDate, @EAmount, @ENetAmount,
          @ECgstRate, @ESgstRate, @EDiscountData,
          @EDocNo, @EEmiPayment, @EEmiData, @EInstallmentCount, @EEmiAmount, @EEmiStartDate,
          @EReminder, @ERemarks, @EStatus,
          @ECreatedAt, @EUpdatedAt, @ECreatedBy, @EApprovedBy, @ECompanyId
        )
      `);
    await bumpCacheVersion("expense-booking");
    res.json({ message: "Expense booked successfully" });
  } catch (err) {
    console.error("EXPENSE INSERT ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /:id — update ────────────────────────────────────────────────────────
router.put("/:id", async (req, res) => {
  const numericId = parseInt(req.params.id, 10);
  if (!Number.isFinite(numericId) || numericId <= 0)
    return res.status(400).json({ error: "Invalid record id" });

  try {
    await guardEdit("expense-booking", req.params.id);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const {
    EProjectName, EDocumentType, EDocDate, EAmount, ENetAmount,
    ECgstRate, ESgstRate, EDiscountData,
    EDocNo, EEmiPayment, EEmiData, EInstallmentCount, EEmiAmount, EEmiStartDate,
    EReminder, ERemarks, EStatus, ECompanyId,
  } = req.body;

  try {
    const pool = getPool();
    await pool.request()
      .input("Eid",             sql.Int,            numericId)
      .input("EProjectName",    sql.NVarChar(150),  EProjectName    || null)
      .input("EDocumentType",   sql.NVarChar(50),   EDocumentType   || null)
      .input("EDocDate",        sql.Date,           EDocDate        || null)
      .input("EAmount",         sql.Decimal(18, 2), EAmount         || null)
      .input("ENetAmount",      sql.Decimal(18, 2), ENetAmount      || null)
      .input("ECgstRate",       sql.Decimal(5, 2),  ECgstRate       ?? 0)
      .input("ESgstRate",       sql.Decimal(5, 2),  ESgstRate       ?? 0)
      .input("EDiscountData",   sql.NVarChar(sql.MAX), EDiscountData ? JSON.stringify(EDiscountData) : null)
      .input("EDocNo",          sql.NVarChar(50),   EDocNo          || null)
      .input("EEmiPayment",     sql.Bit,            EEmiPayment ? 1 : 0)
      .input("EEmiData",        sql.NVarChar(sql.MAX), EEmiData ? JSON.stringify(EEmiData) : null)
      .input("EInstallmentCount", sql.Int,          EInstallmentCount || null)
      .input("EEmiAmount",      sql.Decimal(18, 2), EEmiAmount      || null)
      .input("EEmiStartDate",   sql.Date,           EEmiStartDate   || null)
      .input("EReminder",       sql.Date,           EReminder       || null)
      .input("ERemarks",        sql.NVarChar(300),  ERemarks        || null)
      .input("EStatus",         sql.NVarChar(50),   EStatus         || "Draft")
      .input("EUpdatedAt",      sql.DateTime2,      new Date())
      .input("ECompanyId",      sql.Int,            ECompanyId ? parseInt(ECompanyId, 10) : null)
      .query(`
        UPDATE dbo.ExpenseBooking SET
          EProjectName=@EProjectName, EDocumentType=@EDocumentType,
          EDocDate=@EDocDate, EAmount=@EAmount, ENetAmount=@ENetAmount,
          ECgstRate=@ECgstRate, ESgstRate=@ESgstRate, EDiscountData=@EDiscountData,
          EDocNo=@EDocNo,
          EEmiPayment=@EEmiPayment, EEmiData=@EEmiData,
          EInstallmentCount=@EInstallmentCount, EEmiAmount=@EEmiAmount, EEmiStartDate=@EEmiStartDate,
          EReminder=@EReminder, ERemarks=@ERemarks,
          EStatus=@EStatus, EUpdatedAt=@EUpdatedAt, ECompanyId=@ECompanyId
        WHERE Eid=@Eid
      `);
    await bumpCacheVersion("expense-booking");
    res.json({ message: "Expense updated successfully" });
  } catch (err) {
    console.error("EXPENSE UPDATE ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /:id ──────────────────────────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  const numericId = parseInt(req.params.id, 10);
  if (!Number.isFinite(numericId) || numericId <= 0)
    return res.status(400).json({ error: "Invalid record id" });

  try {
    const pool = getPool();
    await pool.request()
      .input("Eid", sql.Int, numericId)
      .query("DELETE FROM dbo.ExpenseBooking WHERE Eid=@Eid");
    await bumpCacheVersion("expense-booking");
    res.json({ message: "Expense deleted successfully" });
  } catch (err) {
    console.error("EXPENSE DELETE ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Approval transitions ──────────────────────────────────────────────────────
router.put("/:id/submit", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;
    const result = await transition("expense-booking", id, "Pending", userEmail, req.user?.role);
    await bumpCacheVersion("expense-booking");
    res.json({ message: "Submitted for approval", ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put("/:id/approve", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;
    const result = await transition("expense-booking", id, "Approved", userEmail, req.user?.role);
    await bumpCacheVersion("expense-booking");
    res.json({ message: "Approved", ...result });
  } catch (err) {
    const status = err.message.includes("not authorized") ? 403 : 400;
    res.status(status).json({ error: err.message });
  }
});

router.put("/:id/reject", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { note } = req.body;
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;
    const result = await transition("expense-booking", id, "Rejected", userEmail, req.user?.role, note || null);
    await bumpCacheVersion("expense-booking");
    res.json({ message: "Rejected", ...result });
  } catch (err) {
    const status = err.message.includes("not authorized") ? 403 : 400;
    res.status(status).json({ error: err.message });
  }
});

module.exports = router;
