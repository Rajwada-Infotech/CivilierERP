const express = require("express");
const router = express.Router();

const { getPool, sql } = require("../db");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const { transition, guardEdit } = require("../services/approvalService");

// Helper: Require authenticated user email
const requireUserEmail = (req, res) => {
  const email = req.user?.email;
  if (!email) {
    res.status(401).json({ error: "User context missing" });
    return null;
  }
  return email;
};

// ─── GET /options ─────────────────────────────────────────────────────────────
router.get("/options", async (req, res) => {
  try {
    const pool = getPool();
const result = await pool.request().query(`
      SELECT DISTINCT
        Eid AS id,
        Eid AS value,
CONCAT(
          ISNULL(EDocNo,'N/A'),
          ' — ',
          ISNULL(EProjectName,''),
          ' (₹',
          FORMAT(ISNULL(EAmount,0), 'N0'),
          ')'
        ) AS label,
        ECreatedAt
      FROM dbo.ExpenseBooking
      ORDER BY ECreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("Options error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET all (paginated) ──────────────────────────────────────────────────────
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
            WHEN t.Prefix IS NOT NULL AND t.Description IS NOT NULL THEN t.Prefix + ' — ' + t.Description
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
    console.error("List error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /:id/approval-trail ──────────────────────────────────────────────────
router.get("/:id/approval-trail", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0)
    return res.status(400).json({ error: "Invalid id" });

  try {
    const pool = getPool();

    const wfResult = await pool
      .request()
      .input("Module", sql.NVarChar(100), "expense-booking").query(`
        SELECT TOP 1 Id, Levels, Approvers
        FROM dbo.ApprovalWorkflows
        WHERE Module = @Module AND Status = 'Active'
        ORDER BY CreatedAt DESC
      `);

    const wf = wfResult.recordset[0];

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
      const log = logs.find((l) => l.Level === lvl);
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

// ─── POST Create (Fixed with Proper Transaction) ──────────────────────────────
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
    EStatus = "Draft",
    ECompanyId,
    EDocTypeId,
    EFinYear,
  } = req.body;

  const pool = getPool();
  const transaction = pool.transaction();

  let finalDocNo = EDocNo || null;

  try {
    await transaction.begin();

    // 1. Generate and lock Document Number inside transaction
    if (EDocTypeId) {
      const typeId = parseInt(EDocTypeId, 10);
      const finYear = (EFinYear || "").toString().trim();

      const typeResult = await transaction
        .request()
        .input("TypeOfDocId", sql.Int, typeId).query(`
          SELECT Prefix, FullPrefix, StartingDocNo
          FROM dbo.TypeOfDoc
          WHERE TypeOfDocId = @TypeOfDocId AND IsActive = 1
        `);

      const typeRow = typeResult.recordset[0];
      if (!typeRow) {
        await transaction.rollback();
        return res
          .status(400)
          .json({ error: "Selected document type not found or inactive." });
      }

      const rawPrefix = typeRow.FullPrefix ?? typeRow.Prefix ?? "";
      const prefix = rawPrefix.replace(/\d+$/, "");
      const startFrom = typeRow.StartingDocNo ?? 1;

      // Get next sequence with lock
      const maxResult = await transaction
        .request()
        .input("TypeOfDocId", sql.Int, typeId)
        .input("Prefix", sql.NVarChar(100), prefix + "%")
        .input(
          "FinYearPattern",
          sql.NVarChar(130),
          finYear ? `%/${finYear}` : null,
        ).query(`
          SELECT MAX(TRY_CAST(SUBSTRING(DocNo, LEN(@Prefix) + 1, 6) AS INT)) AS MaxSeq
          FROM dbo.DocNumberSequence WITH (UPDLOCK, HOLDLOCK)
          WHERE TypeOfDocId = @TypeOfDocId
            AND DocNo LIKE @Prefix
            AND (@FinYearPattern IS NULL OR DocNo LIKE @FinYearPattern)
        `);

      const maxSeq = maxResult.recordset[0]?.MaxSeq ?? startFrom - 1;
      const nextSeq = Math.max(maxSeq + 1, startFrom);
      const padded = String(nextSeq).padStart(6, "0");

      finalDocNo = finYear
        ? `${prefix}${padded}/${finYear}`
        : `${prefix}${padded}`;

      // Insert into DocNumberSequence (locked inside transaction)
      await transaction
        .request()
        .input("TypeOfDocId", sql.Int, typeId)
        .input("DocNo", sql.NVarChar(100), finalDocNo)
        .input("TableName", sql.NVarChar(100), "ExpenseBooking")
        .input("IssuedBy", sql.NVarChar(200), req.user?.email || null).query(`
          INSERT INTO dbo.DocNumberSequence (TypeOfDocId, DocNo, TableName, IssuedBy)
          VALUES (@TypeOfDocId, @DocNo, @TableName, @IssuedBy)
        `);
    }

    // 2. Insert Expense Booking
    const insertResult = await transaction
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
      .input("EStatus", sql.NVarChar(50), EStatus)
      .input("ECreatedAt", sql.DateTime2, new Date())
      .input("EUpdatedAt", sql.DateTime2, new Date())
      .input("ECreatedBy", sql.Int, req.user?.userId || null)
      .input("EApprovedBy", sql.Int, null)
      .input(
        "ECompanyId",
        sql.Int,
        ECompanyId ? parseInt(ECompanyId, 10) : null,
      )
      .input(
        "EDocTypeId",
        sql.Int,
        EDocTypeId ? parseInt(EDocTypeId, 10) : null,
      )
      .input("EFinYear", sql.NVarChar(20), EFinYear || null).query(`
        INSERT INTO dbo.ExpenseBooking (
          EProjectName, EDocumentType, EDocDate, EAmount, ENetAmount,
          ECgstRate, ESgstRate, EDiscountData, EDocNo,
          EEmiPayment, EEmiData, EInstallmentCount, EEmiAmount, EEmiStartDate,
          EReminder, ERemarks, EStatus,
          ECreatedAt, EUpdatedAt, ECreatedBy, EApprovedBy,
          ECompanyId, EDocTypeId, EFinYear
        ) VALUES (
          @EProjectName, @EDocumentType, @EDocDate, @EAmount, @ENetAmount,
          @ECgstRate, @ESgstRate, @EDiscountData, @EDocNo,
          @EEmiPayment, @EEmiData, @EInstallmentCount, @EEmiAmount, @EEmiStartDate,
          @EReminder, @ERemarks, @EStatus,
          @ECreatedAt, @EUpdatedAt, @ECreatedBy, @EApprovedBy,
          @ECompanyId, @EDocTypeId, @EFinYear
        );
        SELECT SCOPE_IDENTITY() AS NewId;
      `);

    const newExpenseId = insertResult.recordset[0]?.NewId;

    // 3. Back-patch RecordId into DocNumberSequence
    if (finalDocNo && newExpenseId) {
      await transaction
        .request()
        .input("DocNo", sql.NVarChar(100), finalDocNo)
        .input("RecordId", sql.Int, parseInt(newExpenseId, 10)).query(`
          UPDATE dbo.DocNumberSequence
          SET RecordId = @RecordId
          WHERE DocNo = @DocNo AND TableName = 'ExpenseBooking'
        `);
    }

    await transaction.commit();

    // 4. Insert EMI Installments (after commit - non-critical)
    if (EEmiPayment && EEmiData && newExpenseId) {
      let schedule = [];
      try {
        const parsed =
          typeof EEmiData === "string" ? JSON.parse(EEmiData) : EEmiData;
        schedule = parsed?.schedule ?? [];
      } catch (e) {
        console.warn("Failed to parse EMI data");
      }

      for (const row of schedule) {
        try {
          await pool
            .request()
            .input("ExpenseBookingId", sql.Int, newExpenseId)
            .input("InstallmentNo", sql.Int, row.installmentNo)
            .input("RefNumber", sql.NVarChar(150), row.refNumber || null)
            .input("DueDate", sql.Date, row.dueDate || null)
            .input("Amount", sql.Decimal(18, 2), row.amount || 0)
            .input("Status", sql.NVarChar(20), row.status || "Pending").query(`
              INSERT INTO dbo.EmiInstallments
              (ExpenseBookingId, InstallmentNo, RefNumber, DueDate, Amount, Status)
              VALUES (@ExpenseBookingId, @InstallmentNo, @RefNumber, @DueDate, @Amount, @Status)
            `);
        } catch (rowErr) {
          console.warn("EMI insert warning:", rowErr.message);
        }
      }
    }

    await bumpCacheVersion("expense-booking");

    res.status(201).json({
      message: "Expense booked successfully",
      id: newExpenseId,
      docNo: finalDocNo,
    });
  } catch (err) {
    try {
      await transaction.rollback();
    } catch (rbErr) {
      console.error("Transaction rollback failed:", rbErr.message);
    }
    console.error("EXPENSE INSERT ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /:id/emi-schedule ────────────────────────────────────────────────────
router.get("/:id/emi-schedule", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0)
    return res.status(400).json({ error: "Invalid id" });

  try {
    const pool = getPool();
    const result = await pool.request().input("ExpenseBookingId", sql.Int, id)
      .query(`
        SELECT * FROM dbo.EmiInstallments
        WHERE ExpenseBookingId = @ExpenseBookingId
        ORDER BY InstallmentNo ASC
      `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT Pay EMI Installment ──────────────────────────────────────────────────
router.put("/:id/emi-schedule/:no/pay", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const no = parseInt(req.params.no, 10);
  const { paymentRef } = req.body;

  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;

    const pool = getPool();

    await pool
      .request()
      .input("ExpenseBookingId", sql.Int, id)
      .input("InstallmentNo", sql.Int, no)
      .input("PaymentRef", sql.NVarChar(200), paymentRef || null)
      .input("PaidAt", sql.DateTime2, new Date())
      .input("PaidBy", sql.NVarChar(200), userEmail).query(`
        UPDATE dbo.EmiInstallments
        SET Status = 'Paid', PaymentRef = @PaymentRef, PaidAt = @PaidAt, PaidBy = @PaidBy
        WHERE ExpenseBookingId = @ExpenseBookingId AND InstallmentNo = @InstallmentNo
      `);

    // Sync back to EEmiData JSON
    const schedRes = await pool.request().input("ExpenseBookingId", sql.Int, id)
      .query(`SELECT InstallmentNo, DueDate, Amount, Status, RefNumber
              FROM dbo.EmiInstallments
              WHERE ExpenseBookingId = @ExpenseBookingId
              ORDER BY InstallmentNo`);

    const schedule = schedRes.recordset.map((r) => ({
      installmentNo: r.InstallmentNo,
      dueDate: r.DueDate?.toISOString?.().slice(0, 10) ?? r.DueDate,
      amount: parseFloat(r.Amount),
      status: r.Status,
      refNumber: r.RefNumber,
    }));

    const existing = await pool
      .request()
      .input("Eid", sql.Int, id)
      .query("SELECT EEmiData FROM dbo.ExpenseBooking WHERE Eid = @Eid");

    let emiData = {};
    try {
      emiData = JSON.parse(existing.recordset[0]?.EEmiData || "{}");
    } catch {}

    emiData.schedule = schedule;

    await pool
      .request()
      .input("Eid", sql.Int, id)
      .input("EEmiData", sql.NVarChar(sql.MAX), JSON.stringify(emiData))
      .query(
        "UPDATE dbo.ExpenseBooking SET EEmiData = @EEmiData WHERE Eid = @Eid",
      );

    await bumpCacheVersion("expense-booking");
    res.json({ message: "Installment marked as paid" });
  } catch (err) {
    console.error("EMI pay error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT Update ───────────────────────────────────────────────────────────────
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
      // ... all other inputs (same as before)
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
      .input(
        "ECompanyId",
        sql.Int,
        ECompanyId ? parseInt(ECompanyId, 10) : null,
      )
      .input(
        "EDocTypeId",
        sql.Int,
        EDocTypeId ? parseInt(EDocTypeId, 10) : null,
      )
      .input("EFinYear", sql.NVarChar(20), EFinYear || null).query(`
        UPDATE dbo.ExpenseBooking SET
          EProjectName=@EProjectName, EDocumentType=@EDocumentType, EDocDate=@EDocDate,
          EAmount=@EAmount, ENetAmount=@ENetAmount, ECgstRate=@ECgstRate, ESgstRate=@ESgstRate,
          EDiscountData=@EDiscountData, EDocNo=@EDocNo, EEmiPayment=@EEmiPayment,
          EEmiData=@EEmiData, EInstallmentCount=@EInstallmentCount, EEmiAmount=@EEmiAmount,
          EEmiStartDate=@EEmiStartDate, EReminder=@EReminder, ERemarks=@ERemarks,
          EStatus=@EStatus, EUpdatedAt=@EUpdatedAt, ECompanyId=@ECompanyId,
          EDocTypeId=@EDocTypeId, EFinYear=@EFinYear
        WHERE Eid = @Eid
      `);

    await bumpCacheVersion("expense-booking");
    res.json({ message: "Expense updated successfully" });
  } catch (err) {
    console.error("Update error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE ───────────────────────────────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  const numericId = parseInt(req.params.id, 10);
  if (!Number.isFinite(numericId) || numericId <= 0)
    return res.status(400).json({ error: "Invalid record id" });

  try {
    const pool = getPool();
    await pool
      .request()
      .input("Eid", sql.Int, numericId)
      .query("DELETE FROM dbo.ExpenseBooking WHERE Eid = @Eid");

    await bumpCacheVersion("expense-booking");
    res.json({ message: "Expense deleted successfully" });
  } catch (err) {
    console.error("Delete error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Approval Routes (kept as-is, minor cleanup)
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
