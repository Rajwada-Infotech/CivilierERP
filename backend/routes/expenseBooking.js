const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const { transition, guardEdit } = require("../services/approvalService");

const requireUserEmail = (req, res) => {
  const email = req.user?.email;
  if (!email) {
    res.status(401).json({ error: "User context missing" });
    return null;
  }
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
router.get("/", cache("expense-booking", 60), async (req, res) => {
  try {
    const pool = getPool();
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 100);
    const offset = (page - 1) * limit;

    const countResult = await pool
      .request()
      .query("SELECT COUNT(*) AS total FROM dbo.ExpenseBooking");
    const total = parseInt(countResult.recordset[0].total);

    const result = await pool
      .request()
      .input("offset", sql.Int, offset)
      .input("limit", sql.Int, limit).query(`
        SELECT
          eb.*,
          CASE
            WHEN t.Prefix IS NOT NULL AND t.Description IS NOT NULL
              THEN t.Prefix + ' — ' + t.Description
            WHEN t.Prefix IS NOT NULL THEN t.Prefix
            ELSE NULL
          END AS DocTypeName
        FROM dbo.ExpenseBooking eb
        LEFT JOIN dbo.TypeOfDoc t ON eb.EDocTypeId = t.TypeOfDocId
        ORDER BY eb.Eid DESC
        OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
      `);

    res.json({
      data: result.recordset,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /:id/approval-trail ───────────────────────────────────────────────────
router.get("/:id/approval-trail", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0)
    return res.status(400).json({ error: "Invalid id" });

  try {
    const pool = getPool();

    // Get the workflow configured for expense-booking module
    const wfResult = await pool
      .request()
      .input("Module", sql.NVarChar(100), "expense-booking").query(`
        SELECT TOP 1 Id, Levels, Approvers
        FROM dbo.ApprovalWorkflows
        WHERE Module = @Module AND Status = 'Active'
        ORDER BY CreatedAt DESC
      `);

    const wf = wfResult.recordset[0];

    // Get audit log entries for this record
    const logResult = await pool
      .request()
      .input("RecordId", sql.Int, id)
      .input("TableName", sql.NVarChar(100), "ExpenseBooking").query(`
        SELECT Level, Role, ApproverEmail, ActionStatus, ActionAt, Note
        FROM dbo.ApprovalAuditLog
        WHERE RecordId = @RecordId AND TableName = @TableName
        ORDER BY Level ASC, ActionAt ASC
      `);

    const logs = logResult.recordset;

    // Get current record status
    const recResult = await pool
      .request()
      .input("Eid", sql.Int, id)
      .query("SELECT EStatus FROM dbo.ExpenseBooking WHERE Eid = @Eid");
    const currentStatus = recResult.recordset[0]?.EStatus ?? "Draft";

    if (!wf) {
      return res.json({
        steps: [],
        currentLevel: 0,
        fullyApproved: currentStatus === "Approved",
      });
    }

    const levels = wf.Levels || 1;
    const approverList = (wf.Approvers || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const steps = Array.from({ length: levels }, (_, i) => {
      const lvl = i + 1;
      const log =
        logs.find((l) => l.Level === lvl && l.ActionStatus === "Approved") ||
        logs.find((l) => l.Level === lvl && l.ActionStatus === "Rejected") ||
        logs.find((l) => l.Level === lvl);

      return {
        level: lvl,
        role: log?.Role ?? approverList[i] ?? "Approver",
        approverEmail: log?.ApproverEmail ?? approverList[i] ?? null,
        status: log?.ActionStatus ?? "Pending",
        actionAt: log?.ActionAt ?? null,
        note: log?.Note ?? null,
      };
    });

    const approvedCount = steps.filter((s) => s.status === "Approved").length;
    const currentLevel =
      approvedCount + 1 > levels ? levels : approvedCount + 1;

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
    EProjectName,
    EDocumentType,
    EDocDate,
    EAmount,
    ENetAmount,
    ECgstRate,
    ESgstRate,
    EDiscountData,
    EDocNo,
    EEmiPayment,
    EEmiData,
    EInstallmentCount,
    EEmiAmount,
    EEmiStartDate,
    EReminder,
    ERemarks,
    EStatus,
    ECompanyId,
    // NEW: doc type id and fin year so we can lock the sequence
    EDocTypeId,
    EFinYear,
  } = req.body;

  try {
    const pool = getPool();

    // ── 1. If a doc type was selected, generate + lock the next doc number ──
    // This is the authoritative sequence commit — it prevents duplicates even
    // if two users hit save at the same moment.
    let finalDocNo = EDocNo || null;

    if (EDocTypeId) {
      const typeId = parseInt(EDocTypeId, 10);

      // Fetch doc type config
      const typeResult = await pool
        .request()
        .input("TypeOfDocId", sql.Int, typeId).query(`
          SELECT t.Prefix, t.FullPrefix, t.StartingDocNo
          FROM dbo.TypeOfDoc t
          WHERE t.TypeOfDocId = @TypeOfDocId AND t.IsActive = 1
        `);

      const typeRow = typeResult.recordset[0];
      if (!typeRow) {
        return res
          .status(400)
          .json({ error: "Selected document type not found or inactive." });
      }

      const rawPrefix = typeRow.FullPrefix ?? typeRow.Prefix ?? "";
      const startFrom = typeRow.StartingDocNo ?? 1;

      // Strip trailing digits from FullPrefix (e.g. "PR/REC/000500" → "PR/REC/")
      const prefix = rawPrefix.replace(/\d+$/, "");

      // Find current max sequence for this prefix (only the 6-digit part)
      const maxResult = await pool
        .request()
        .input("TypeOfDocId", sql.Int, typeId)
        .input("Prefix", sql.NVarChar(100), prefix + "%")
        .input(
          "FinYearPattern",
          sql.NVarChar(130),
          EFinYear ? `%/${String(EFinYear).trim()}` : null,
        ).query(`
          SELECT MAX(
            TRY_CAST(
              SUBSTRING(DocNo, LEN(@Prefix) + 1, 6) AS INT
            )
          ) AS MaxSeq
          FROM dbo.DocNumberSequence
          WHERE TypeOfDocId = @TypeOfDocId
            AND DocNo LIKE @Prefix
            AND (@FinYearPattern IS NULL OR DocNo LIKE @FinYearPattern)
        `);

      const maxSeq = maxResult.recordset[0]?.MaxSeq ?? startFrom - 1;
      const nextSeq = Math.max(maxSeq + 1, startFrom);
      const padded = String(nextSeq).padStart(6, "0");

      // Final format: PR/REC/000500/2024-25  (or  PR/REC/000500  without finYear)
      const finYear = (EFinYear || "").toString().trim();
      finalDocNo = finYear
        ? `${prefix}${padded}/${finYear}`
        : `${prefix}${padded}`;

      // Lock this number in DocNumberSequence BEFORE inserting the record
      // Using MERGE to handle the unlikely race where two requests get the same seq
      try {
        await pool
          .request()
          .input("TypeOfDocId", sql.Int, typeId)
          .input("DocNo", sql.NVarChar(100), finalDocNo)
          .input("TableName", sql.NVarChar(100), "ExpenseBooking")
          .input("IssuedBy", sql.NVarChar(200), req.user?.email || null).query(`
            INSERT INTO dbo.DocNumberSequence (TypeOfDocId, DocNo, TableName, IssuedBy)
            VALUES (@TypeOfDocId, @DocNo, @TableName, @IssuedBy)
          `);
      } catch (seqErr) {
        // Unique constraint violation — another request grabbed this number
        // Re-try by re-reading max and bumping by 1 more
        const retryMax = await pool
          .request()
          .input("TypeOfDocId", sql.Int, typeId)
          .input("Prefix", sql.NVarChar(100), prefix + "%")
          .input("FinYearPattern", sql.NVarChar(130), finYear ? `%/${finYear}` : null)
          .query(`
            SELECT MAX(
              TRY_CAST(SUBSTRING(DocNo, LEN(@Prefix) + 1, 6) AS INT)
            ) AS MaxSeq
            FROM dbo.DocNumberSequence
            WHERE TypeOfDocId = @TypeOfDocId
              AND DocNo LIKE @Prefix
              AND (@FinYearPattern IS NULL OR DocNo LIKE @FinYearPattern)
          `);
        const retrySeq = (retryMax.recordset[0]?.MaxSeq ?? nextSeq) + 1;
        const retryPad = String(retrySeq).padStart(6, "0");
        const retryBase = `${prefix}${retryPad}`;
        finalDocNo = finYear ? `${retryBase}/${finYear}` : retryBase;

        await pool
          .request()
          .input("TypeOfDocId", sql.Int, typeId)
          .input("DocNo", sql.NVarChar(100), finalDocNo)
          .input("TableName", sql.NVarChar(100), "ExpenseBooking")
          .input("IssuedBy", sql.NVarChar(200), req.user?.email || null).query(`
            INSERT INTO dbo.DocNumberSequence (TypeOfDocId, DocNo, TableName, IssuedBy)
            VALUES (@TypeOfDocId, @DocNo, @TableName, @IssuedBy)
          `);
      }
    }

    // ── 2. Insert the expense booking with the locked doc number ─────────────
    const insertResult = await pool
      .request()
      .input("EProjectName", sql.NVarChar(150), EProjectName || null)
      .input("EDocumentType", sql.NVarChar(50), EDocumentType || null)
      .input("EDocDate", sql.Date, EDocDate || null)
      .input("EAmount", sql.Decimal(18, 2), EAmount || null)
      .input("ENetAmount", sql.Decimal(18, 2), ENetAmount || null)
      .input("ECgstRate", sql.Decimal(5, 2), ECgstRate ?? 0)
      .input("ESgstRate", sql.Decimal(5, 2), ESgstRate ?? 0)
      .input(
        "EDiscountData",
        sql.NVarChar(sql.MAX),
        EDiscountData ? JSON.stringify(EDiscountData) : null,
      )
      .input("EDocNo", sql.NVarChar(100), finalDocNo)
      .input("EEmiPayment", sql.Bit, EEmiPayment ? 1 : 0)
      .input(
        "EEmiData",
        sql.NVarChar(sql.MAX),
        EEmiData ? JSON.stringify(EEmiData) : null,
      )
      .input("EInstallmentCount", sql.Int, EInstallmentCount || null)
      .input("EEmiAmount", sql.Decimal(18, 2), EEmiAmount || null)
      .input("EEmiStartDate", sql.Date, EEmiStartDate || null)
      .input("EReminder", sql.Date, EReminder || null)
      .input("ERemarks", sql.NVarChar(300), ERemarks || null)
      .input("EStatus", sql.NVarChar(50), EStatus || "Draft")
      .input("ECreatedAt", sql.DateTime2, new Date())
      .input("EUpdatedAt", sql.DateTime2, new Date())
      .input("ECreatedBy", sql.Int, req.user?.userId || null)
      .input("EApprovedBy", sql.Int, null)
      .input("ECompanyId", sql.Int, ECompanyId ? parseInt(ECompanyId, 10) : null)
      .input("EDocTypeId", sql.Int, EDocTypeId ? parseInt(EDocTypeId, 10) : null)
      .input("EFinYear", sql.NVarChar(20), EFinYear || null)
      .query(`
        INSERT INTO dbo.ExpenseBooking (
          EProjectName, EDocumentType, EDocDate, EAmount, ENetAmount,
          ECgstRate, ESgstRate, EDiscountData,
          EDocNo, EEmiPayment, EEmiData, EInstallmentCount, EEmiAmount, EEmiStartDate,
          EReminder, ERemarks, EStatus,
          ECreatedAt, EUpdatedAt, ECreatedBy, EApprovedBy, ECompanyId,
          EDocTypeId, EFinYear
        ) VALUES (
          @EProjectName, @EDocumentType, @EDocDate, @EAmount, @ENetAmount,
          @ECgstRate, @ESgstRate, @EDiscountData,
          @EDocNo, @EEmiPayment, @EEmiData, @EInstallmentCount, @EEmiAmount, @EEmiStartDate,
          @EReminder, @ERemarks, @EStatus,
          @ECreatedAt, @EUpdatedAt, @ECreatedBy, @EApprovedBy, @ECompanyId,
          @EDocTypeId, @EFinYear
        );
        SELECT SCOPE_IDENTITY() AS NewId;
      `);

    // ── 3. Back-patch RecordId into DocNumberSequence now we have the new Eid ─
    if (EDocTypeId && finalDocNo) {
      const newId = insertResult.recordset[0]?.NewId;
      if (newId) {
        await pool
          .request()
          .input("DocNo", sql.NVarChar(100), finalDocNo)
          .input("RecordId", sql.Int, parseInt(newId, 10)).query(`
            UPDATE dbo.DocNumberSequence
            SET RecordId = @RecordId
            WHERE DocNo = @DocNo AND TableName = 'ExpenseBooking'
          `);
      }
    }

    await bumpCacheVersion("expense-booking");
    res.json({ message: "Expense booked successfully", docNo: finalDocNo });
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
    EProjectName,
    EDocumentType,
    EDocDate,
    EAmount,
    ENetAmount,
    ECgstRate,
    ESgstRate,
    EDiscountData,
    EDocNo,
    EEmiPayment,
    EEmiData,
    EInstallmentCount,
    EEmiAmount,
    EEmiStartDate,
    EReminder,
    ERemarks,
    EStatus,
    ECompanyId,
    EDocTypeId,
    EFinYear,
  } = req.body;

  try {
    const pool = getPool();
    await pool
      .request()
      .input("Eid", sql.Int, numericId)
      .input("EProjectName", sql.NVarChar(150), EProjectName || null)
      .input("EDocumentType", sql.NVarChar(50), EDocumentType || null)
      .input("EDocDate", sql.Date, EDocDate || null)
      .input("EAmount", sql.Decimal(18, 2), EAmount || null)
      .input("ENetAmount", sql.Decimal(18, 2), ENetAmount || null)
      .input("ECgstRate", sql.Decimal(5, 2), ECgstRate ?? 0)
      .input("ESgstRate", sql.Decimal(5, 2), ESgstRate ?? 0)
      .input(
        "EDiscountData",
        sql.NVarChar(sql.MAX),
        EDiscountData ? JSON.stringify(EDiscountData) : null,
      )
      .input("EDocNo", sql.NVarChar(100), EDocNo || null)
      .input("EEmiPayment", sql.Bit, EEmiPayment ? 1 : 0)
      .input(
        "EEmiData",
        sql.NVarChar(sql.MAX),
        EEmiData ? JSON.stringify(EEmiData) : null,
      )
      .input("EInstallmentCount", sql.Int, EInstallmentCount || null)
      .input("EEmiAmount", sql.Decimal(18, 2), EEmiAmount || null)
      .input("EEmiStartDate", sql.Date, EEmiStartDate || null)
      .input("EReminder", sql.Date, EReminder || null)
      .input("ERemarks", sql.NVarChar(300), ERemarks || null)
      .input("EStatus", sql.NVarChar(50), EStatus || "Draft")
      .input("EUpdatedAt", sql.DateTime2, new Date())
      .input("ECompanyId", sql.Int, ECompanyId ? parseInt(ECompanyId, 10) : null)
      .input("EDocTypeId", sql.Int, EDocTypeId ? parseInt(EDocTypeId, 10) : null)
      .input("EFinYear", sql.NVarChar(20), EFinYear || null)
      .query(`
        UPDATE dbo.ExpenseBooking SET
          EProjectName=@EProjectName, EDocumentType=@EDocumentType,
          EDocDate=@EDocDate, EAmount=@EAmount, ENetAmount=@ENetAmount,
          ECgstRate=@ECgstRate, ESgstRate=@ESgstRate, EDiscountData=@EDiscountData,
          EDocNo=@EDocNo,
          EEmiPayment=@EEmiPayment, EEmiData=@EEmiData,
          EInstallmentCount=@EInstallmentCount, EEmiAmount=@EEmiAmount, EEmiStartDate=@EEmiStartDate,
          EReminder=@EReminder, ERemarks=@ERemarks,
          EStatus=@EStatus, EUpdatedAt=@EUpdatedAt, ECompanyId=@ECompanyId,
          EDocTypeId=@EDocTypeId, EFinYear=@EFinYear
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
    await pool
      .request()
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
    const result = await transition(
      "expense-booking",
      id,
      "Pending",
      userEmail,
      req.user?.role,
    );
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
    const result = await transition(
      "expense-booking",
      id,
      "Approved",
      userEmail,
      req.user?.role,
    );
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
    const result = await transition(
      "expense-booking",
      id,
      "Rejected",
      userEmail,
      req.user?.role,
      note || null,
    );
    await bumpCacheVersion("expense-booking");
    res.json({ message: "Rejected", ...result });
  } catch (err) {
    const status = err.message.includes("not authorized") ? 403 : 400;
    res.status(status).json({ error: err.message });
  }
});

module.exports = router;
