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
    const finYear = (req.query.finYear || "").toString().trim() || null;

    // Regular bookings: exclude EMI-enabled ones (they are paid via installments)
    // and exclude any already linked to an active DebitNote
    const bookingsResult = await pool
      .request()
      .input("FinYear", sql.NVarChar(20), finYear).query(`
        SELECT
          eb.Eid                          AS id,
          eb.Eid                          AS value,
          ISNULL(eb.EDocNo, 'N/A')        AS docNo,
          ISNULL(eb.EProjectName, '')     AS projectName,
          ISNULL(eb.ENetAmount, ISNULL(eb.EAmount, 0)) AS amount,
          ISNULL(eb.ECompanyId, 0)        AS companyId,
          eb.EEmiPayment                  AS emiEnabled,
          CONCAT(
            ISNULL(eb.EDocNo,'N/A'),
            N' — ',
            ISNULL(eb.EProjectName,''),
            N' (₹',
            CAST(CAST(ISNULL(eb.ENetAmount, ISNULL(eb.EAmount,0)) AS BIGINT) AS NVARCHAR(20)),
            ')'
          ) AS label
        FROM dbo.ExpenseBooking eb
        WHERE
          (eb.EEmiPayment = 0 OR eb.EEmiPayment IS NULL)
          AND NOT EXISTS (
            SELECT 1 FROM dbo.DebitNote dn
            WHERE dn.bill_id = eb.Eid AND dn.is_active = 1
          )
          AND (@FinYear IS NULL OR eb.EFinYear = @FinYear)
        ORDER BY eb.Eid DESC
      `);

    // EMI installments: only show Pending ones
    const emiResult = await pool
      .request()
      .input("FinYear", sql.NVarChar(20), finYear).query(`
        SELECT
          ei.Id                        AS id,
          ei.ExpenseBookingId          AS expenseBookingId,
          ei.InstallmentNo             AS installmentNo,
          ei.RefNumber                 AS refNumber,
          ei.DueDate                   AS dueDate,
          ei.Amount                    AS amount,
          ei.Status                    AS status,
          eb.EProjectName              AS projectName,
          eb.ECompanyId                AS companyId,
          eb.EDocNo                    AS parentDocNo,
          CONCAT(
            ISNULL(ei.RefNumber, CONCAT('EMI-', RIGHT('00' + CAST(ei.InstallmentNo AS VARCHAR), 2))),
            N' — ',
            ISNULL(eb.EProjectName, ''),
            N' (₹',
            CAST(CAST(ISNULL(ei.Amount,0) AS BIGINT) AS NVARCHAR(20)),
            N') — Installment #',
            CAST(ei.InstallmentNo AS NVARCHAR(10))
          ) AS label
        FROM dbo.EmiInstallments ei
        INNER JOIN dbo.ExpenseBooking eb ON eb.Eid = ei.ExpenseBookingId
        WHERE
          eb.EEmiPayment = 1
          AND ei.Status = 'Pending'
          AND NOT EXISTS (
            SELECT 1 FROM dbo.DebitNote dn
            WHERE dn.bill_id = ei.Id AND dn.is_active = 1
          )
          AND (@FinYear IS NULL OR eb.EFinYear = @FinYear)
        ORDER BY ei.ExpenseBookingId DESC, ei.InstallmentNo ASC
      `);

    const bookingOptions = bookingsResult.recordset.map((r) => ({
      id: String(r.id),
      value: String(r.value),
      label: r.label,
      type: "booking",
      expenseBookingId: r.id,
      docNo: r.docNo,
      projectName: r.projectName,
      amount: parseFloat(r.amount) || 0,
      companyId: r.companyId || null,
    }));

    const emiOptions = emiResult.recordset.map((r) => ({
      id: `emi-${r.expenseBookingId}-${r.installmentNo}`,
      value: `emi-${r.expenseBookingId}-${r.installmentNo}`,
      label: r.label,
      type: "emi",
      expenseBookingId: r.expenseBookingId,
      installmentNo: r.installmentNo,
      refNumber: r.refNumber,
      dueDate: r.dueDate ? String(r.dueDate).slice(0, 10) : null,
      docNo: r.refNumber || r.parentDocNo,
      projectName: r.projectName,
      amount: parseFloat(r.amount) || 0,
      companyId: r.companyId || null,
      status: r.status,
      parentDocNo: r.parentDocNo,
    }));

    res.json([...bookingOptions, ...emiOptions]);
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
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
    const offset = (page - 1) * limit;

    const result = await pool
      .request()
      .input("offset", sql.Int, offset)
      .input("limit", sql.Int, limit).query(`
        SELECT
          eb.Eid, eb.Eid AS id,
          eb.EProjectName, eb.EDocumentType, eb.EDocDate,
          eb.EAmount, eb.ENetAmount, eb.ECgstRate, eb.ESgstRate,
          eb.EDocNo, eb.EEmiPayment, eb.EInstallmentCount, eb.EEmiAmount,
          eb.EEmiStartDate, eb.EReminder, eb.ERemarks, eb.EStatus,
          eb.ECreatedAt, eb.EUpdatedAt, eb.ECompanyId, eb.EDocTypeId,
          eb.EFinYear, eb.ECreatedBy,
          CASE
            WHEN t.Prefix IS NOT NULL AND t.Description IS NOT NULL THEN t.Prefix + N' — ' + t.Description
            WHEN t.Prefix IS NOT NULL THEN t.Prefix
            ELSE NULL
          END AS DocTypeName,
          COUNT(*) OVER() AS _total
        FROM dbo.ExpenseBooking eb
        LEFT JOIN dbo.TypeOfDoc t ON eb.EDocTypeId = t.TypeOfDocId
        ORDER BY eb.Eid DESC
        OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
      `);

    const rows = result.recordset;
    const total = rows.length > 0 ? parseInt(rows[0]._total) : 0;

    res.json({
      data: rows.map(({ _total, ...r }) => r),
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    });
  } catch (err) {
    console.error("List error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /:id ─────────────────────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0)
    return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const result = await pool.request().input("Eid", sql.Int, id).query(`
        SELECT eb.*,
               eb.Eid AS id,
               CASE
                 WHEN t.Prefix IS NOT NULL AND t.Description IS NOT NULL THEN t.Prefix + ' — ' + t.Description
                 WHEN t.Prefix IS NOT NULL THEN t.Prefix
            ELSE NULL
          END AS DocTypeName
        FROM dbo.ExpenseBooking eb
        LEFT JOIN dbo.TypeOfDoc t ON eb.EDocTypeId = t.TypeOfDocId
        WHERE eb.Eid = @Eid
      `);
    if (!result.recordset.length)
      return res.status(404).json({ error: "Not found" });
    res.json(result.recordset[0]);
  } catch (err) {
    console.error("Get by id error:", err.message);
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

// ─── POST Create ──────────────────────────────────────────────────────────────
router.post("/", async (req, res) => {
  const {
    EName,
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

      // Count globally across ALL fin years — fin year is only a suffix
      const maxResult = await transaction
        .request()
        .input("TypeOfDocId", sql.Int, typeId)
        .input("Prefix", sql.NVarChar(100), prefix + "%").query(`
          SELECT MAX(TRY_CAST(SUBSTRING(DocNo, LEN(@Prefix) + 1, 6) AS INT)) AS MaxSeq
          FROM dbo.DocNumberSequence WITH (UPDLOCK, HOLDLOCK)
          WHERE TypeOfDocId = @TypeOfDocId
            AND DocNo LIKE @Prefix
        `);

      // Also check ExpenseBooking across ALL fin years
      const ebMaxResult = await transaction
        .request()
        .input("EDocTypeId2", sql.Int, typeId)
        .input("Prefix2", sql.NVarChar(100), prefix + "%").query(`
          SELECT MAX(TRY_CAST(SUBSTRING(EDocNo, LEN(@Prefix2) + 1, 6) AS INT)) AS MaxSeq
          FROM dbo.ExpenseBooking WITH (UPDLOCK, HOLDLOCK)
          WHERE EDocTypeId = @EDocTypeId2
            AND EDocNo LIKE @Prefix2
        `);

      const seqFromDNS = maxResult.recordset[0]?.MaxSeq ?? null;
      const seqFromEB = ebMaxResult.recordset[0]?.MaxSeq ?? null;
      const combinedMax = Math.max(seqFromDNS ?? 0, seqFromEB ?? 0);
      const maxSeq = combinedMax > 0 ? combinedMax : startFrom - 1;
      const nextSeq = Math.max(maxSeq + 1, startFrom);
      const padded = String(nextSeq).padStart(6, "0");

      finalDocNo = finYear
        ? `${prefix}${padded}/${finYear}`
        : `${prefix}${padded}`;

      // The preview endpoint may have already reserved this doc number (RecordId IS NULL).
      // Reuse it if unassigned; bump if already committed to another record.
      const existingSeq = await transaction
        .request()
        .input("DocNoCheck", sql.NVarChar(100), finalDocNo).query(`
          SELECT RecordId FROM dbo.DocNumberSequence WHERE DocNo = @DocNoCheck
        `);

      if (existingSeq.recordset.length > 0) {
        if (existingSeq.recordset[0]?.RecordId) {
          // Already committed — bump by 1 and insert fresh
          const bumpPadded = String(nextSeq + 1).padStart(6, "0");
          finalDocNo = finYear
            ? `${prefix}${bumpPadded}/${finYear}`
            : `${prefix}${bumpPadded}`;
          await transaction
            .request()
            .input("TypeOfDocId", sql.Int, typeId)
            .input("DocNo", sql.NVarChar(100), finalDocNo)
            .input("TableName", sql.NVarChar(100), "ExpenseBooking")
            .input("IssuedBy", sql.NVarChar(200), req.user?.email || null)
            .query(`
              INSERT INTO dbo.DocNumberSequence (TypeOfDocId, DocNo, TableName, IssuedBy)
              VALUES (@TypeOfDocId, @DocNo, @TableName, @IssuedBy)
            `);
        }
        // else: reserved by preview (RecordId IS NULL) — reuse as-is
      } else {
        // Not yet reserved — insert fresh
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
    }

    const insertResult = await transaction
      .request()
      .input("EName", sql.NVarChar(200), EName || null)
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
          EName, EProjectName, EDocumentType, EDocDate, EAmount, ENetAmount,
          ECgstRate, ESgstRate, EDiscountData, EDocNo,
          EEmiPayment, EEmiData, EInstallmentCount, EEmiAmount, EEmiStartDate,
          EReminder, ERemarks, EStatus,
          ECreatedAt, EUpdatedAt, ECreatedBy, EApprovedBy,
          ECompanyId, EDocTypeId, EFinYear
        ) VALUES (
          @EName, @EProjectName, @EDocumentType, @EDocDate, @EAmount, @ENetAmount,
          @ECgstRate, @ESgstRate, @EDiscountData, @EDocNo,
          @EEmiPayment, @EEmiData, @EInstallmentCount, @EEmiAmount, @EEmiStartDate,
          @EReminder, @ERemarks, @EStatus,
          @ECreatedAt, @EUpdatedAt, @ECreatedBy, @EApprovedBy,
          @ECompanyId, @EDocTypeId, @EFinYear
        );
        SELECT SCOPE_IDENTITY() AS NewId;
      `);

    const newExpenseId = insertResult.recordset[0]?.NewId;

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
          if (!row.dueDate) {
            console.warn(
              `EMI row ${row.installmentNo} skipped — missing dueDate`,
            );
            continue;
          }
          await pool
            .request()
            .input("ExpenseBookingId", sql.Int, newExpenseId)
            .input("InstallmentNo", sql.Int, row.installmentNo)
            .input("RefNumber", sql.NVarChar(200), row.refNumber || null)
            .input("DueDate", sql.Date, row.dueDate)
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

// ─── PUT Toggle EMI off ───────────────────────────────────────────────────────
router.put("/:id/emi-toggle", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0)
    return res.status(400).json({ error: "Invalid id" });

  const { enabled, deleteUnpaid = true } = req.body;

  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;

    const pool = getPool();

    const stats = await pool.request().input("ExpenseBookingId", sql.Int, id)
      .query(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN Status = 'Paid' THEN 1 ELSE 0 END) AS paid,
          SUM(CASE WHEN Status = 'Paid' THEN Amount ELSE 0 END) AS paidAmount,
          SUM(CASE WHEN Status != 'Paid' THEN Amount ELSE 0 END) AS remainingAmount
        FROM dbo.EmiInstallments
        WHERE ExpenseBookingId = @ExpenseBookingId
      `);

    const { total, paid, paidAmount, remainingAmount } = stats.recordset[0];

    if (!enabled) {
      if (deleteUnpaid) {
        await pool.request().input("ExpenseBookingId", sql.Int, id).query(`
            DELETE FROM dbo.EmiInstallments
            WHERE ExpenseBookingId = @ExpenseBookingId AND Status != 'Paid'
          `);
      }

      const existingRes = await pool
        .request()
        .input("Eid", sql.Int, id)
        .query("SELECT EEmiData FROM dbo.ExpenseBooking WHERE Eid = @Eid");
      let emiData = {};
      try {
        emiData = JSON.parse(existingRes.recordset[0]?.EEmiData || "{}");
      } catch {}
      emiData.enabled = false;
      if (deleteUnpaid && Array.isArray(emiData.schedule)) {
        emiData.schedule = emiData.schedule.filter((r) => r.status === "Paid");
      }

      await pool
        .request()
        .input("Eid", sql.Int, id)
        .input("EEmiPayment", sql.Bit, 0)
        .input("EEmiData", sql.NVarChar(sql.MAX), JSON.stringify(emiData))
        .query(`
          UPDATE dbo.ExpenseBooking
          SET EEmiPayment = @EEmiPayment, EEmiData = @EEmiData
          WHERE Eid = @Eid
        `);
    } else {
      await pool
        .request()
        .input("Eid", sql.Int, id)
        .input("EEmiPayment", sql.Bit, 1)
        .query(
          "UPDATE dbo.ExpenseBooking SET EEmiPayment = @EEmiPayment WHERE Eid = @Eid",
        );
    }

    await bumpCacheVersion("expense-booking");
    await bumpCacheVersion("expense-booking-options");

    res.json({
      message: enabled ? "EMI re-enabled" : "EMI disabled",
      stats: {
        total: parseInt(total) || 0,
        paid: parseInt(paid) || 0,
        paidAmount: parseFloat(paidAmount) || 0,
        remainingAmount: parseFloat(remainingAmount) || 0,
      },
    });
  } catch (err) {
    console.error("EMI toggle error:", err.message);
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
    EName,
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
    const result = await pool
      .request()
      .input("Eid", sql.Int, numericId)
      .input("EName", sql.NVarChar(200), EName || null)
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
          EName=@EName, EProjectName=@EProjectName, EDocumentType=@EDocumentType, EDocDate=@EDocDate,
          EAmount=@EAmount, ENetAmount=@ENetAmount, ECgstRate=@ECgstRate, ESgstRate=@ESgstRate,
          EDiscountData=@EDiscountData, EDocNo=@EDocNo, EEmiPayment=@EEmiPayment,
          EEmiData=@EEmiData, EInstallmentCount=@EInstallmentCount, EEmiAmount=@EEmiAmount,
          EEmiStartDate=@EEmiStartDate, EReminder=@EReminder, ERemarks=@ERemarks,
          EStatus=@EStatus, EUpdatedAt=@EUpdatedAt, ECompanyId=@ECompanyId,
          EDocTypeId=@EDocTypeId, EFinYear=@EFinYear
        WHERE Eid = @Eid
      `);

    if (!result.rowsAffected?.[0]) {
      return res.status(404).json({ error: "Expense booking not found" });
    }

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

// ─── Approval Routes ──────────────────────────────────────────────────────────
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
