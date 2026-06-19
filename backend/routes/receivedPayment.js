const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, validate: false }));
const { getPool, sql } = require("../db");
const {
  lockNextDocNumber,
  backPatchRecordId,
} = require("../utils/docNumberLock");
const { cache, localVersionCache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const { checkPermissionForMethod } = require("../middleware/routePermission");

router.use(checkPermissionForMethod("Finance", "ReceivedPayments"));

// ─── Helpers ──────────────────────────────────────────────────────────────────

// FIX: _hasNewCols was module-scoped, which means it memoizes correctly in
// long-running Node processes but resets to null on every Vercel cold start.
// The sys.columns probe was therefore firing on the first request of every
// cold invocation, adding ~200-400ms before the actual query could run.
//
// Fix: persist the result in Redis with a long TTL (24 h).  Warm requests
// still use the in-process variable (zero overhead).  Cold starts pay one
// Redis GET (~2ms) instead of a SQL Server sys.columns scan (~200ms+).
let _hasNewCols = null;
const HAS_NEW_COLS_REDIS_KEY = "schema:ReceivedPayment:hasRPDocNo";

const MUTATION_CACHE_KEYS = ["received-payment", "brs", "finance-dashboard"];

async function invalidateReceivedPaymentWorkflowCaches() {
  MUTATION_CACHE_KEYS.forEach((key) => localVersionCache.invalidate(key));
  await Promise.all(MUTATION_CACHE_KEYS.map((key) => bumpCacheVersion(key)));
}

async function hasNewColumns(pool) {
  // 1. In-process memo — fastest path for warm requests
  if (_hasNewCols !== null) return _hasNewCols;

  // 2. Redis — survives across cold starts within the same deployment
  try {
    const { redisGet, redisSet } = require("../redis");
    const cached = await redisGet(HAS_NEW_COLS_REDIS_KEY);
    if (cached !== null) {
      _hasNewCols = cached === "1";
      return _hasNewCols;
    }
  } catch {
    // Redis unavailable — fall through to DB probe
  }

  // 3. DB probe — only on true first-ever cold start or after Redis flush
  const r = await pool.request().query(`
    SELECT COUNT(*) AS cnt FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.ReceivedPayment') AND name = 'RPDocNo'
  `);
  _hasNewCols = r.recordset[0].cnt > 0;

  // Store in Redis for 24 h
  try {
    const { redisSet } = require("../redis");
    await redisSet(HAS_NEW_COLS_REDIS_KEY, _hasNewCols ? "1" : "0", 86400);
  } catch {
    // non-fatal
  }

  return _hasNewCols;
}

// ── GET / ─────────────────────────────────────────────────────────────────────
router.get("/", cache("received-payment", 300), async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
    const offset = (page - 1) * limit;
    const pool = getPool();

    // All new schema columns always present (migration 107+)
    const result = await pool
      .request()
      .input("offset", sql.Int, offset)
      .input("limit", sql.Int, limit).query(`
        SELECT
          RPPaymentID, RPCompanyName, RPReceivedFrom, RPProjectName,
          RPDocDate, RPMode, RPAmount, RPBankName, RPTransactionID, RPCheckNumber,
          RPRemarks, RPIsEmi, RPEmiTotal, RPEmiMonths, RPEmiStartDate,
          RPEmiSchedule, RPEmiPaying, RPStatus, RPCreatedBy, RPCreatedAt,
          RPUpdatedBy, RPUpdatedAt, RPApprovedBy, RPApprovedAt,
          RPRejectedBy, RPRejectedAt, RPRejectionNote,
          RPDocNo, RPFinYear, RPDocTypeId, RPCompanyId, RPProjectId,
          RPCustomerName, RPDepositBankId, RPDepositBankName,
          SourceSaleInvoiceId, SourceSaleInvoiceDocNo,
          COUNT(*) OVER() AS _total
        FROM dbo.ReceivedPayment
        ORDER BY RPCreatedAt DESC
        OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
      `);

    const rows = result.recordset;
    const total = rows.length > 0 ? rows[0]._total : 0;
    const data = rows.map(({ _total, ...r }) => r);

    res.json({
      data,
      page,
      totalPages: Math.ceil(total / limit),
      total,
    });
  } catch (err) {
    console.error("GET /received-payment error:", err);
    res.status(500).json({ error: "Failed to fetch received payments" });
  }
});

// ── POST / ────────────────────────────────────────────────────────────────────
router.post("/", async (req, res) => {
  try {
    const {
      RPCompanyName,
      RPCompanyId,
      RPReceivedFrom,
      RPCustomerName,
      RPProjectName,
      RPProjectId,
      RPDocDate,
      RPFinYear,
      RPDocTypeId,
      RPMode,
      RPAmount,
      RPBankName,
      RPTransactionID,
      RPCheckNumber,
      RPRemarks,
      RPDepositBankId,
      RPDepositBankName,
      RPIsEmi,
      RPEmiTotal,
      RPEmiMonths,
      RPEmiStartDate,
      RPEmiSchedule,
      RPEmiPaying,
      // ── Sale-Order workflow (Migration 111) ──
      SourceSaleInvoiceId,
      SourceSaleInvoiceDocNo,
    } = req.body;

    const createdBy = req.user?.name || req.user?.email || null;
    const pool = getPool();
    let finalDocNo = null;
    if (RPDocTypeId) {
      finalDocNo = await lockNextDocNumber(pool, sql, {
        docTypeId: Number(RPDocTypeId),
        finYear: RPFinYear || null,
        tableName: "ReceivedPayment",
        docNoColumn: "RPDocNo",
        parentDocNo: null,
        rootExBDocNo: null,
      });
    } else if (
      RPRemarks?.includes("[SalePayment]") &&
      RPReceivedFrom?.startsWith("SO-")
    ) {
      // &#9472;&#9472; Sale payment: check for duplicate, then generate SP-YYYYMMDD-NNN &#9472;&#9472;
      const dupCheck = await pool
        .request()
        .input("saleOrderDocNo", sql.NVarChar(255), RPReceivedFrom).query(`
          SELECT COUNT(1) AS cnt FROM dbo.ReceivedPayment
          WHERE RPReceivedFrom = @saleOrderDocNo
            AND RPRemarks LIKE '%[SalePayment]%'
            AND RPStatus NOT IN ('Rejected')
        `);
      if (Number(dupCheck.recordset[0].cnt) > 0) {
        return res.status(409).json({
          error: `A payment against sale order ${RPReceivedFrom} already exists. Only one active payment per sale order is allowed.`,
        });
      }
      const dateStr = (
        RPDocDate || new Date().toISOString().slice(0, 10)
      ).replace(/-/g, "");
      const seqRes = await pool.request().query(`
        SELECT COUNT(1)+1 AS N FROM dbo.ReceivedPayment
        WHERE CAST(RPCreatedAt AS DATE) = CAST(GETDATE() AS DATE)
          AND RPRemarks LIKE '%[SalePayment]%'
      `);
      const seq = String(seqRes.recordset[0].N).padStart(3, "0");
      finalDocNo = `SP-${dateStr}-${seq}`;
    }

    // ── Sale-Invoice workflow validations ─────────────────────────────────────
    if (SourceSaleInvoiceId) {
      const siId = parseInt(SourceSaleInvoiceId, 10);

      // 1. Mode must be Cash
      const effectiveMode = (RPMode || "").trim();
      if (effectiveMode !== "Cash") {
        return res.status(400).json({
          error:
            "Sale Invoice payments must use Cash mode only. Other payment modes are disabled for this workflow.",
        });
      }

      // 2. The deposit bank must be the Dummy Bank
      const dummyBank = await pool
        .request()
        .query(
          "SELECT TOP 1 LHeadId, LHeadName FROM dbo.AccountHeadMaster WHERE LHeadCode = 'DUMMY-BANK' AND Status = 'Approved'",
        );
      if (!dummyBank.recordset.length) {
        return res.status(500).json({
          error:
            "Dummy Bank account not found. Please contact your administrator.",
        });
      }
      const dummyBankId = dummyBank.recordset[0].LHeadId;
      const dummyBankName = dummyBank.recordset[0].LHeadName;

      // Override whatever the client sent — Dummy Bank is always the deposit target
      if (
        RPDepositBankId &&
        parseInt(RPDepositBankId, 10) !== dummyBankId
      ) {
        return res.status(400).json({
          error: `Sale Invoice payments must be deposited to the Dummy Bank (${dummyBankName}). Other deposit accounts are not allowed for this workflow.`,
        });
      }

      // 3. The invoice must exist and not be already Paid
      const siCheck = await pool
        .request()
        .input("SIID", sql.Int, siId)
        .query(
          "SELECT SaleInvoiceID, Amount, AmountReceived, PaymentStatus FROM dbo.SaleInvoices WHERE SaleInvoiceID = @SIID AND IsDeleted = 0",
        );
      if (!siCheck.recordset.length) {
        return res.status(404).json({ error: "Sale Invoice not found." });
      }
      if (siCheck.recordset[0].PaymentStatus === "Paid") {
        return res.status(400).json({
          error: "This Sale Invoice is already fully paid.",
        });
      }

      // Force-set deposit bank to Dummy Bank regardless of client payload
      req.body.RPDepositBankId = dummyBankId;
      req.body.RPDepositBankName = dummyBankName;
    }

    const req2 = pool
      .request()
      .input("RPCompanyName", sql.NVarChar(255), RPCompanyName || null)
      .input("RPReceivedFrom", sql.NVarChar(255), RPReceivedFrom || "")
      .input("RPProjectName", sql.NVarChar(255), RPProjectName || "")
      .input("RPDocDate", sql.Date, RPDocDate || null)
      .input("RPMode", sql.NVarChar(50), RPMode || "Cash")
      .input("RPAmount", sql.Decimal(18, 2), Number(RPAmount) || 0)
      .input("RPBankName", sql.NVarChar(255), RPBankName || null)
      .input("RPTransactionID", sql.NVarChar(255), RPTransactionID || null)
      .input("RPCheckNumber", sql.NVarChar(100), RPCheckNumber || null)
      .input("RPRemarks", sql.NVarChar(sql.MAX), RPRemarks || null)
      .input("RPIsEmi", sql.Bit, RPIsEmi ? 1 : 0)
      .input("RPEmiTotal", sql.Decimal(18, 2), RPEmiTotal || null)
      .input("RPEmiMonths", sql.Int, RPEmiMonths || null)
      .input("RPEmiStartDate", sql.NVarChar(30), RPEmiStartDate || null)
      .input(
        "RPEmiSchedule",
        sql.NVarChar(sql.MAX),
        RPEmiSchedule ? JSON.stringify(RPEmiSchedule) : null,
      )
      .input(
        "RPEmiPaying",
        sql.NVarChar(sql.MAX),
        RPEmiPaying ? JSON.stringify(RPEmiPaying) : null,
      )
      .input("RPCreatedBy", sql.NVarChar(100), createdBy)
      .input("RPDocNo", sql.NVarChar(100), finalDocNo || null)
      .input("RPFinYear", sql.NVarChar(20), RPFinYear || null)
      .input("RPDocTypeId", sql.Int, RPDocTypeId || null)
      .input("RPCompanyId", sql.Int, RPCompanyId || null)
      .input("RPProjectId", sql.Int, RPProjectId || null)
      .input("RPCustomerName", sql.NVarChar(255), RPCustomerName || null)
      .input(
        "RPDepositBankId",
        sql.Int,
        req.body.RPDepositBankId
          ? parseInt(req.body.RPDepositBankId, 10)
          : RPDepositBankId
          ? parseInt(RPDepositBankId, 10)
          : null,
      )
      .input(
        "RPDepositBankName",
        sql.NVarChar(255),
        req.body.RPDepositBankName || RPDepositBankName || null,
      )
      // ── Sale-Order workflow ──────────────────────────────────────────────────
      .input(
        "SourceSaleInvoiceId",
        sql.Int,
        SourceSaleInvoiceId ? parseInt(SourceSaleInvoiceId, 10) : null,
      )
      .input(
        "SourceSaleInvoiceDocNo",
        sql.NVarChar(100),
        SourceSaleInvoiceDocNo || null,
      );

    const extraCols = `, RPDocNo, RPFinYear, RPDocTypeId, RPCompanyId, RPProjectId, RPCustomerName, RPDepositBankId, RPDepositBankName, SourceSaleInvoiceId, SourceSaleInvoiceDocNo`;
    const extraVals = `, @RPDocNo, @RPFinYear, @RPDocTypeId, @RPCompanyId, @RPProjectId, @RPCustomerName, @RPDepositBankId, @RPDepositBankName, @SourceSaleInvoiceId, @SourceSaleInvoiceDocNo`;

    const result = await req2.query(`
      INSERT INTO dbo.ReceivedPayment (
        RPCompanyName, RPReceivedFrom, RPProjectName, RPDocDate, RPMode,
        RPAmount, RPBankName, RPTransactionID, RPCheckNumber, RPRemarks,
        RPIsEmi, RPEmiTotal, RPEmiMonths, RPEmiStartDate, RPEmiSchedule, RPEmiPaying,
        RPStatus, RPCreatedBy, RPCreatedAt ${extraCols}
      )
      OUTPUT INSERTED.*
      VALUES (
        @RPCompanyName, @RPReceivedFrom, @RPProjectName, @RPDocDate, @RPMode,
        @RPAmount, @RPBankName, @RPTransactionID, @RPCheckNumber, @RPRemarks,
        @RPIsEmi, @RPEmiTotal, @RPEmiMonths, @RPEmiStartDate, @RPEmiSchedule, @RPEmiPaying,
        'Pending', @RPCreatedBy, GETDATE() ${extraVals}
      )
    `);

    const row = result.recordset[0];

    if (finalDocNo && row?.RPPaymentID) {
      await backPatchRecordId(pool, sql, finalDocNo, "ReceivedPayment", row.RPPaymentID);
    }

    // ── Recalculate Sale Invoice PaymentStatus ────────────────────────────────
    if (SourceSaleInvoiceId) {
      const { recalcInvoicePaymentStatus } = require("./saleInvoices");
      await recalcInvoicePaymentStatus(pool, parseInt(SourceSaleInvoiceId, 10));
    }

    await invalidateReceivedPaymentWorkflowCaches();
    res.status(201).json(row);
  } catch (err) {
    console.error("POST /received-payment error:", err);
    res.status(500).json({ error: "Failed to create received payment" });
  }
});

// ── PUT /:id ──────────────────────────────────────────────────────────────────
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      RPCompanyName,
      RPCompanyId,
      RPReceivedFrom,
      RPCustomerName,
      RPProjectName,
      RPProjectId,
      RPDocDate,
      RPFinYear,
      RPDocTypeId,
      RPMode,
      RPAmount,
      RPBankName,
      RPTransactionID,
      RPCheckNumber,
      RPRemarks,
      RPDepositBankId,
      RPDepositBankName,
      RPIsEmi,
      RPEmiTotal,
      RPEmiMonths,
      RPEmiStartDate,
      RPEmiSchedule,
      RPEmiPaying,
    } = req.body;

    const updatedBy = req.user?.name || req.user?.email || null;
    const pool = getPool();

    const extraSet = `, RPCompanyId=@RPCompanyId, RPProjectId=@RPProjectId,
      RPCustomerName=@RPCustomerName, RPFinYear=@RPFinYear,
      RPDepositBankId=@RPDepositBankId, RPDepositBankName=@RPDepositBankName`;

    const result = await pool
      .request()
      .input("id", sql.Int, id)
      .input("RPCompanyName", sql.NVarChar(255), RPCompanyName || null)
      .input("RPReceivedFrom", sql.NVarChar(255), RPReceivedFrom || "")
      .input("RPProjectName", sql.NVarChar(255), RPProjectName || "")
      .input("RPDocDate", sql.Date, RPDocDate || null)
      .input("RPMode", sql.NVarChar(50), RPMode || "Cash")
      .input("RPAmount", sql.Decimal(18, 2), Number(RPAmount) || 0)
      .input("RPBankName", sql.NVarChar(255), RPBankName || null)
      .input("RPTransactionID", sql.NVarChar(255), RPTransactionID || null)
      .input("RPCheckNumber", sql.NVarChar(100), RPCheckNumber || null)
      .input("RPRemarks", sql.NVarChar(sql.MAX), RPRemarks || null)
      .input("RPIsEmi", sql.Bit, RPIsEmi ? 1 : 0)
      .input("RPEmiTotal", sql.Decimal(18, 2), RPEmiTotal || null)
      .input("RPEmiMonths", sql.Int, RPEmiMonths || null)
      .input("RPEmiStartDate", sql.NVarChar(30), RPEmiStartDate || null)
      .input(
        "RPEmiSchedule",
        sql.NVarChar(sql.MAX),
        RPEmiSchedule ? JSON.stringify(RPEmiSchedule) : null,
      )
      .input(
        "RPEmiPaying",
        sql.NVarChar(sql.MAX),
        RPEmiPaying ? JSON.stringify(RPEmiPaying) : null,
      )
      .input("RPUpdatedBy", sql.NVarChar(150), updatedBy)
      .input("RPCompanyId", sql.Int, RPCompanyId || null)
      .input("RPProjectId", sql.Int, RPProjectId || null)
      .input("RPCustomerName", sql.NVarChar(255), RPCustomerName || null)
      .input("RPDepositBankId", sql.Int, RPDepositBankId ? parseInt(RPDepositBankId, 10) : null)
      .input("RPDepositBankName", sql.NVarChar(255), RPDepositBankName || null)
      .input("RPFinYear", sql.NVarChar(20), RPFinYear || null).query(`
        UPDATE dbo.ReceivedPayment SET
          RPCompanyName   = @RPCompanyName,
          RPReceivedFrom  = @RPReceivedFrom,
          RPProjectName   = @RPProjectName,
          RPDocDate       = @RPDocDate,
          RPMode          = @RPMode,
          RPAmount        = @RPAmount,
          RPBankName      = @RPBankName,
          RPTransactionID = @RPTransactionID,
          RPCheckNumber   = @RPCheckNumber,
          RPRemarks       = @RPRemarks,
          RPIsEmi         = @RPIsEmi,
          RPEmiTotal      = @RPEmiTotal,
          RPEmiMonths     = @RPEmiMonths,
          RPEmiStartDate  = @RPEmiStartDate,
          RPEmiSchedule   = @RPEmiSchedule,
          RPEmiPaying     = @RPEmiPaying,
          RPUpdatedBy     = @RPUpdatedBy,
          RPUpdatedAt     = GETDATE()
          ${extraSet}
        OUTPUT INSERTED.*
        WHERE RPPaymentID = @id
      `);

    if (result.recordset.length === 0)
      return res.status(404).json({ error: "Not found" });

    // Recalc invoice status if this payment is linked to a sale invoice
    const updated = result.recordset[0];
    if (updated.SourceSaleInvoiceId) {
      const { recalcInvoicePaymentStatus } = require("./saleInvoices");
      await recalcInvoicePaymentStatus(pool, updated.SourceSaleInvoiceId);
    }

    await invalidateReceivedPaymentWorkflowCaches();
    res.json(result.recordset[0]);
  } catch (err) {
    console.error("PUT /received-payment error:", err);
    res.status(500).json({ error: "Failed to update" });
  }
});

// ── DELETE /:id ───────────────────────────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: "Invalid payment id" });
  }
  const pool = getPool();
  const tx = new sql.Transaction(pool);
  let txDone = false;

  try {
    await tx.begin();

    const existing = await new sql.Request(tx).input("id", sql.Int, id).query(`
      SELECT RPPaymentID, SourceSaleInvoiceId
      FROM dbo.ReceivedPayment
      WHERE RPPaymentID = @id
    `);

    if (existing.recordset.length === 0) {
      await tx.rollback();
      txDone = true;
      return res.status(404).json({ error: "Received payment not found" });
    }

    const linkedSIId = existing.recordset[0].SourceSaleInvoiceId;

    await new sql.Request(tx).input("id", sql.Int, id).query(`
      DELETE FROM dbo.BankReconciliation
      WHERE SourceType = 'RECEIVED' AND SourceID = @id
    `);

    const deleted = await new sql.Request(tx).input("id", sql.Int, id).query(`
      DELETE FROM dbo.ReceivedPayment
      WHERE RPPaymentID = @id
    `);

    if ((deleted.rowsAffected?.[0] || 0) === 0) {
      await tx.rollback();
      txDone = true;
      return res.status(404).json({ error: "Received payment not found" });
    }

    await tx.commit();
    txDone = true;

    // Recalculate invoice status after deleting the payment
    if (linkedSIId) {
      const { recalcInvoicePaymentStatus } = require("./saleInvoices");
      await recalcInvoicePaymentStatus(pool, linkedSIId);
    }

    await invalidateReceivedPaymentWorkflowCaches();
    res.json({ success: true, message: "Received payment deleted" });
  } catch (err) {
    try {
      if (!txDone) await tx.rollback();
    } catch {}
    console.error("DELETE /received-payment error:", err);
    res.status(500).json({ error: err.message || "Failed to delete" });
  }
});

// ── PATCH /:id/submit ─────────────────────────────────────────────────────────
// Sets status = 'Pending' so it appears in the admin Approval Inbox
router.patch("/:id/submit", async (req, res) => {
  try {
    const { id } = req.params;
    const submittedBy = req.user?.name || req.user?.email || null;
    const pool = getPool();

    const check = await pool
      .request()
      .input("id", sql.Int, id)
      .query(`SELECT RPStatus FROM dbo.ReceivedPayment WHERE RPPaymentID = @id`);

    if (check.recordset.length === 0)
      return res.status(404).json({ error: "Payment not found" });

    const current = check.recordset[0].RPStatus;
    if (current === "Pending")
      return res.json({ success: true, message: "Already pending approval" });
    if (current !== "Draft")
      return res
        .status(400)
        .json({ error: `Cannot submit: status is '${current}'` });

    await pool
      .request()
      .input("id", sql.Int, id)
      .input("by", sql.NVarChar(150), submittedBy).query(`
        UPDATE dbo.ReceivedPayment
        SET RPStatus = 'Pending', RPUpdatedBy = @by, RPUpdatedAt = GETDATE()
        WHERE RPPaymentID = @id
      `);

    await invalidateReceivedPaymentWorkflowCaches();
    res.json({ success: true, message: "Submitted for approval" });
  } catch (err) {
    console.error("PATCH /submit error:", err);
    res.status(500).json({ error: "Submit failed" });
  }
});

// ── PUT /:id/approve (admin only — called from Approval Inbox) ───────────────
router.put("/:id/approve", async (req, res) => {
  try {
    const { id } = req.params;
    const actor = req.user?.name || req.user?.email || null;
    const pool = getPool();

    await pool
      .request()
      .input("id", sql.Int, id)
      .input("by", sql.NVarChar(150), actor).query(`
        UPDATE dbo.ReceivedPayment
        SET RPStatus='Approved', RPApprovedBy=@by, RPApprovedAt=GETDATE()
        WHERE RPPaymentID=@id
      `);

    await invalidateReceivedPaymentWorkflowCaches();
    res.json({ success: true });
  } catch (err) {
    console.error("PUT /:id/approve error:", err);
    res.status(500).json({ error: "Approval failed" });
  }
});

// ── PUT /:id/reject (admin only — called from Approval Inbox) ────────────────
router.put("/:id/reject", async (req, res) => {
  try {
    const { id } = req.params;
    const { note } = req.body;
    const actor = req.user?.name || req.user?.email || null;
    const pool = getPool();

    await pool
      .request()
      .input("id", sql.Int, id)
      .input("by", sql.NVarChar(150), actor)
      .input("note", sql.NVarChar(500), note || null).query(`
        UPDATE dbo.ReceivedPayment
        SET RPStatus='Rejected', RPRejectedBy=@by, RPRejectedAt=GETDATE(), RPRejectionNote=@note
        WHERE RPPaymentID=@id
      `);

    await invalidateReceivedPaymentWorkflowCaches();
    res.json({ success: true });
  } catch (err) {
    console.error("PUT /:id/reject error:", err);
    res.status(500).json({ error: "Rejection failed" });
  }
});

module.exports = router;