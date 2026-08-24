const { requirePageRight } = require("../middleware/requirePageRight");
const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const {
  lockNextDocNumber,
  backPatchRecordId,
} = require("../utils/docNumberLock");
const { cache, localVersionCache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const { checkPermissionForMethod } = require("../middleware/routePermission");
const { postReceivedPaymentApproval } = require("../services/generalLedger");
const { recordGLPosting } = require("../services/approvalService");
const { snapshotRow, recordAmendment } = require("../services/amendmentLog");
const allowRoles = require("../middleware/role");

// Only these roles may approve/reject — mirrors APPROVER_ROLES in the shared
// approval engine (services/approvalService.js). Without this, any user with
// ReceivedPayments "edit" permission could approve a receipt and post it to
// the ledger, because checkPermissionForMethod only checks CanEdit for a PUT.
const APPROVER_ROLES = ["admin", "super_admin", "dba", "accounts_head"];

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

// pdc-report/pdc-due-count feed the PDC report and reminder bell — bumped
// unconditionally on every mutation here (cheap, and simpler than threading
// RPMode through every call site) rather than risk a cheque-mode receipt
// silently going stale in the bell for up to the report's own cache TTL.
const MUTATION_CACHE_KEYS = ["received-payment", "brs", "finance-dashboard", "pdc-report", "pdc-due-count"];

async function invalidateReceivedPaymentWorkflowCaches() {
  MUTATION_CACHE_KEYS.forEach((key) => localVersionCache.invalidate(key));
  await Promise.all(MUTATION_CACHE_KEYS.map((key) => bumpCacheVersion(key)));
}

// ── GET / ─────────────────────────────────────────────────────────────────────
router.get("/", cache("received-payment", 300), async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
    const offset = (page - 1) * limit;
    const companyId = req.query.companyId ? parseInt(req.query.companyId, 10) : null;
    const statusFilter = req.query.status || null;
    const pool = getPool();

    const req2 = pool.request()
      .input("offset", sql.Int, offset)
      .input("limit", sql.Int, limit)
      .input("companyId", sql.Int, companyId)
      .input("status", sql.NVarChar(20), statusFilter);

    // All new schema columns always present (migration 107+)
    const result = await req2.query(`
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
          COUNT(*) OVER() AS _total,
          SUM(RPAmount) OVER() AS _totalAmount,
          SUM(CASE WHEN RPStatus = 'Approved' THEN 1 ELSE 0 END) OVER() AS _approvedCount,
          SUM(CASE WHEN RPStatus = 'Draft' THEN 1 ELSE 0 END) OVER() AS _draftCount,
          SUM(CASE WHEN RPStatus = 'Pending' THEN 1 ELSE 0 END) OVER() AS _pendingCount,
          SUM(CASE WHEN RPStatus = 'Rejected' THEN 1 ELSE 0 END) OVER() AS _rejectedCount
        FROM dbo.ReceivedPayment
        WHERE (@companyId IS NULL OR RPCompanyId = @companyId)
          AND (@status IS NULL OR RPStatus = @status)
        ORDER BY RPCreatedAt DESC
        OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
      `);

    const rows = result.recordset;
    const total = rows.length > 0 ? rows[0]._total : 0;
    const summary = rows.length > 0 ? {
      totalAmount: Number(rows[0]._totalAmount || 0),
      approvedCount: Number(rows[0]._approvedCount || 0),
      draftCount: Number(rows[0]._draftCount || 0),
      pendingCount: Number(rows[0]._pendingCount || 0),
      rejectedCount: Number(rows[0]._rejectedCount || 0),
    } : { totalAmount: 0, approvedCount: 0, draftCount: 0, pendingCount: 0, rejectedCount: 0 };
    const data = rows.map(({ _total, _totalAmount, _approvedCount, _draftCount, _pendingCount, _rejectedCount, ...r }) => r);

    res.json({
      data,
      page,
      totalPages: Math.ceil(total / limit),
      total,
      summary,
    });
  } catch (err) {
    console.error("GET /received-payment error:", err);
    res.status(500).json({ error: "Failed to fetch received payments" });
  }
});

// ── GET /:id — single record, for deep links (Trial Balance's ledger
// drill-down navigates here as /received-payments?view=<id>) ────────────────
router.get("/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const result = await pool.request().input("id", sql.Int, id).query(`
        SELECT
          RPPaymentID, RPCompanyName, RPReceivedFrom, RPProjectName,
          RPDocDate, RPMode, RPAmount, RPBankName, RPTransactionID, RPCheckNumber,
          RPChequeDate, RPIsPostDated, RPRemarks, RPIsEmi, RPEmiTotal, RPEmiMonths, RPEmiStartDate,
          RPEmiSchedule, RPEmiPaying, RPStatus, RPCreatedBy, RPCreatedAt,
          RPUpdatedBy, RPUpdatedAt, RPApprovedBy, RPApprovedAt,
          RPRejectedBy, RPRejectedAt, RPRejectionNote,
          RPDocNo, RPFinYear, RPDocTypeId, RPCompanyId, RPProjectId,
          RPCustomerName, RPDepositBankId, RPDepositBankName,
          SourceSaleInvoiceId, SourceSaleInvoiceDocNo
        FROM dbo.ReceivedPayment
        WHERE RPPaymentID = @id
      `);
    if (!result.recordset.length) return res.status(404).json({ error: "Received payment not found" });
    res.json(result.recordset[0]);
  } catch (err) {
    console.error("GET /received-payment/:id error:", err);
    res.status(500).json({ error: "Failed to fetch received payment" });
  }
});

// ── POST / ────────────────────────────────────────────────────────────────────
// ─── Internal creation function ──────────────────────────────────────────────
// Extracted from POST / so other server-side callers (the Inter-Company
// Stock Transfer orchestrator) can create a real, fully-validated Received
// Payment in-process without duplicating this validation/numbering/insert
// logic or making an HTTP self-call. Mechanical extraction — the POST route
// below now just calls this and maps thrown errors to a response; behavior
// is unchanged. Thrown errors carry a `.status` for the HTTP code to use.
async function createReceivedPaymentInternal(pool, payload, createdBy) {
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
      RPChequeDate,
      RPIsPostDated,
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
      // ── Contract Master (Migration 176) — see services/contractLedger.js ──
      ContractId,
      // ── CRM (Migration 269) — see routes/crmPayments.js createReceiptForMilestone ──
      CrmMilestoneId,
      CrmBookingId,
      CrmApplicationId,
    } = payload;
    const body = { ...payload };
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
      // ── Sale payment: check for duplicate, then generate SP-YYYYMMDD-NNN ──
      const dupCheck = await pool
        .request()
        .input("saleOrderDocNo", sql.NVarChar(255), RPReceivedFrom).query(`
          SELECT COUNT(1) AS cnt FROM dbo.ReceivedPayment
          WHERE RPReceivedFrom = @saleOrderDocNo
            AND RPRemarks LIKE '%[SalePayment]%'
            AND RPStatus NOT IN ('Rejected')
        `);
      if (Number(dupCheck.recordset[0].cnt) > 0) {
        const err = new Error(
          `A payment against sale order ${RPReceivedFrom} already exists. Only one active payment per sale order is allowed.`,
        );
        err.status = 409;
        throw err;
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
        const err = new Error(
          "Sale Invoice payments must use Cash mode only. Other payment modes are disabled for this workflow.",
        );
        err.status = 400;
        throw err;
      }

      // 2. The deposit bank must be the Dummy Bank
      const dummyBank = await pool
        .request()
        .query(
          "SELECT TOP 1 LHeadId, LHeadName FROM dbo.AccountHeadMaster WHERE LHeadCode = 'DUMMY-BANK' AND Status = 'Approved'",
        );
      if (!dummyBank.recordset.length) {
        const err = new Error(
          "Dummy Bank account not found. Please contact your administrator.",
        );
        err.status = 500;
        throw err;
      }
      const dummyBankId = dummyBank.recordset[0].LHeadId;
      const dummyBankName = dummyBank.recordset[0].LHeadName;

      // Override whatever the client sent — Dummy Bank is always the deposit target
      if (
        RPDepositBankId &&
        parseInt(RPDepositBankId, 10) !== dummyBankId
      ) {
        const err = new Error(
          `Sale Invoice payments must be deposited to the Dummy Bank (${dummyBankName}). Other deposit accounts are not allowed for this workflow.`,
        );
        err.status = 400;
        throw err;
      }

      // 3. The invoice must exist and not be already Paid
      const siCheck = await pool
        .request()
        .input("SIID", sql.Int, siId)
        .query(
          "SELECT SaleInvoiceID, Amount, AmountReceived, PaymentStatus FROM dbo.SaleInvoices WHERE SaleInvoiceID = @SIID AND IsDeleted = 0",
        );
      if (!siCheck.recordset.length) {
        const err = new Error("Sale Invoice not found.");
        err.status = 404;
        throw err;
      }
      if (siCheck.recordset[0].PaymentStatus === "Paid") {
        const err = new Error("This Sale Invoice is already fully paid.");
        err.status = 400;
        throw err;
      }

      // Force-set deposit bank to Dummy Bank regardless of client payload
      body.RPDepositBankId = dummyBankId;
      body.RPDepositBankName = dummyBankName;
    }

    const req2 = pool
      .request()
      .input("RPCompanyName", sql.NVarChar(255), RPCompanyName || null)
      .input("RPReceivedFrom", sql.NVarChar(255), RPReceivedFrom || "")
      .input("RPProjectName", sql.NVarChar(255), RPProjectName || "")
      // RPDocDate is NOT NULL — a caller that omits it (e.g. CRM's
      // createReceiptForMilestone when the payment form doesn't collect a
      // date) must not crash the insert; default to today, same fallback
      // already used for the SalePayment doc-number branch above. Bug: this
      // previously inserted NULL, 500-ing the whole request before the
      // ReceivedPayment row (and thus the approval-queue entry) was ever
      // created — CRM payment submissions silently never reached approval.
      .input("RPDocDate", sql.Date, RPDocDate || new Date().toISOString().slice(0, 10))
      .input("RPMode", sql.NVarChar(50), RPMode || "Cash")
      .input("RPAmount", sql.Decimal(18, 2), Number(RPAmount) || 0)
      .input("RPBankName", sql.NVarChar(255), RPBankName || null)
      .input("RPTransactionID", sql.NVarChar(255), RPTransactionID || null)
      .input("RPCheckNumber", sql.NVarChar(100), RPCheckNumber || null)
      .input("RPChequeDate", sql.Date, RPChequeDate || null)
      .input("RPIsPostDated", sql.Bit, RPIsPostDated ? 1 : 0)
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
        body.RPDepositBankId
          ? parseInt(body.RPDepositBankId, 10)
          : RPDepositBankId
          ? parseInt(RPDepositBankId, 10)
          : null,
      )
      .input(
        "RPDepositBankName",
        sql.NVarChar(255),
        body.RPDepositBankName || RPDepositBankName || null,
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
      )
      .input("ContractId", sql.Int, ContractId ? parseInt(ContractId, 10) : null)
      .input("CrmMilestoneId", sql.Int, CrmMilestoneId ? parseInt(CrmMilestoneId, 10) : null)
      .input("CrmBookingId", sql.Int, CrmBookingId ? parseInt(CrmBookingId, 10) : null)
      .input("CrmApplicationId", sql.Int, CrmApplicationId ? parseInt(CrmApplicationId, 10) : null);

    const extraCols = `, RPDocNo, RPFinYear, RPDocTypeId, RPCompanyId, RPProjectId, RPCustomerName, RPDepositBankId, RPDepositBankName, SourceSaleInvoiceId, SourceSaleInvoiceDocNo, ContractId, RPChequeDate, RPIsPostDated, CrmMilestoneId, CrmBookingId, CrmApplicationId`;
    const extraVals = `, @RPDocNo, @RPFinYear, @RPDocTypeId, @RPCompanyId, @RPProjectId, @RPCustomerName, @RPDepositBankId, @RPDepositBankName, @SourceSaleInvoiceId, @SourceSaleInvoiceDocNo, @ContractId, @RPChequeDate, @RPIsPostDated, @CrmMilestoneId, @CrmBookingId, @CrmApplicationId`;

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
        'Draft', @RPCreatedBy, GETDATE() ${extraVals}
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

    // ── Contract Master: record as an advance ONLY when this payment isn't
    // already tied to a specific invoice — a payment against a real invoice
    // settles that invoice directly and has nothing to allocate later.
    if (ContractId && !SourceSaleInvoiceId) {
      const { recordAdvance } = require("../services/contractLedger");
      await recordAdvance(pool, {
        contractId: parseInt(ContractId, 10),
        sourceType: "ReceivedPayment",
        sourceId: row.RPPaymentID,
        sourceDocNo: row.RPDocNo,
        amount: Number(RPAmount) || 0,
        createdBy,
      });
    }

    return row;
}

router.post("/", requirePageRight("received-payment", "create"), async (req, res) => {
  try {
    const createdBy = req.user?.name || req.user?.email || null;
    const pool = getPool();
    const row = await createReceivedPaymentInternal(pool, req.body, createdBy);
    await invalidateReceivedPaymentWorkflowCaches();
    res.status(201).json(row);
  } catch (err) {
    console.error("POST /received-payment error:", err);
    res.status(err.status || 500).json({ error: err.status ? err.message : "Failed to create received payment" });
  }
});

// ── PUT /:id ──────────────────────────────────────────────────────────────────
router.put("/:id", requirePageRight("received-payment", "edit"), async (req, res) => {
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
      RPMode,
      RPAmount,
      RPBankName,
      RPTransactionID,
      RPCheckNumber,
      RPChequeDate,
      RPIsPostDated,
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
    const beforeSnapshot = await snapshotRow(pool, "dbo.ReceivedPayment", "RPPaymentID", id);
    const wasApproved = beforeSnapshot?.RPStatus === "Approved";

    const extraSet = `, RPCompanyId=@RPCompanyId, RPProjectId=@RPProjectId,
      RPCustomerName=@RPCustomerName, RPFinYear=@RPFinYear,
      RPDepositBankId=@RPDepositBankId, RPDepositBankName=@RPDepositBankName`;

    const result = await pool
      .request()
      .input("id", sql.Int, id)
      .input("RPCompanyName", sql.NVarChar(255), RPCompanyName || null)
      .input("RPReceivedFrom", sql.NVarChar(255), RPReceivedFrom || "")
      .input("RPProjectName", sql.NVarChar(255), RPProjectName || "")
      // RPDocDate is NOT NULL — an edit that omits it must not blank out the
      // date the record was originally created with; COALESCE against the
      // existing value in the SET clause below instead of overwriting it.
      .input("RPDocDate", sql.Date, RPDocDate || null)
      .input("RPMode", sql.NVarChar(50), RPMode || "Cash")
      .input("RPAmount", sql.Decimal(18, 2), Number(RPAmount) || 0)
      .input("RPBankName", sql.NVarChar(255), RPBankName || null)
      .input("RPTransactionID", sql.NVarChar(255), RPTransactionID || null)
      .input("RPCheckNumber", sql.NVarChar(100), RPCheckNumber || null)
      .input("RPChequeDate", sql.Date, RPChequeDate || null)
      .input("RPIsPostDated", sql.Bit, RPIsPostDated ? 1 : 0)
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
          RPDocDate       = COALESCE(@RPDocDate, RPDocDate),
          RPMode          = @RPMode,
          RPAmount        = @RPAmount,
          RPBankName      = @RPBankName,
          RPTransactionID = @RPTransactionID,
          RPCheckNumber   = @RPCheckNumber,
          RPChequeDate    = @RPChequeDate,
          RPIsPostDated   = @RPIsPostDated,
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

    if (wasApproved && beforeSnapshot) {
      try {
        await recordAmendment({
          refDocType: "received-payment",
          refDocId: parseInt(id, 10),
          refDocNo: updated.RPDocNo || String(id),
          projectName: updated.RPProjectName || beforeSnapshot.RPProjectName,
          companyName: updated.RPCompanyName || beforeSnapshot.RPCompanyName,
          changedBy: updatedBy,
          before: beforeSnapshot,
          after: updated,
        });
      } catch (logErr) {
        console.error("Amendment log error (received-payment):", logErr.message);
      }
    }

    res.json(result.recordset[0]);
  } catch (err) {
    console.error("PUT /received-payment error:", err);
    res.status(500).json({ error: "Failed to update" });
  }
});

// ── DELETE /:id ───────────────────────────────────────────────────────────────
router.delete("/:id", requirePageRight("received-payment", "delete"), async (req, res) => {
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
router.patch("/:id/submit", requirePageRight("received-payment", "edit"), async (req, res) => {
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

// ── PUT /:id/approve (approver roles only — called from Approval Inbox) ──────
router.put("/:id/approve", allowRoles(...APPROVER_ROLES), async (req, res) => {
  const pid = parseInt(req.params.id, 10);
  if (!Number.isFinite(pid))
    return res.status(400).json({ error: "Invalid id" });
  const actor = req.user?.name || req.user?.email || null;
  const actorUserId = Number(req.user?.userId ?? req.user?.id) || null;
  const pool = getPool();

  // Lock + guard the status change: only a Pending receipt can be approved,
  // and the row lock serialises concurrent approvals so the same receipt
  // can't be approved twice (which would otherwise re-run GL posting).
  // CRM-linked rows (see migration 269) also get their predecessor-milestone
  // rule re-checked here, INSIDE this same transaction — a second payment
  // approved before its own predecessor's approval must be refused outright
  // (RPStatus stays Pending, rolled back with a clear reason) rather than
  // silently approved into a milestone schedule that's still out of order.
  const tx = new sql.Transaction(pool);
  let crmRow = null;
  try {
    await tx.begin();
    const cur = await tx.request().input("id", sql.Int, pid).query(`
      SELECT RPStatus, RPAmount, RPDocDate, RPMode, RPTransactionID, RPChequeDate, RPRemarks,
             RPDepositBankId, RPDepositBankName, CrmMilestoneId, CrmBookingId, CrmApplicationId
      FROM dbo.ReceivedPayment WITH (UPDLOCK, HOLDLOCK)
      WHERE RPPaymentID=@id
    `);
    if (!cur.recordset.length) {
      await tx.rollback();
      return res.status(404).json({ error: "Received payment not found" });
    }
    const status = cur.recordset[0].RPStatus;
    if (status !== "Pending") {
      await tx.rollback();
      return res
        .status(400)
        .json({ error: `Cannot approve from status "${status}"` });
    }

    if (cur.recordset[0].CrmMilestoneId) {
      const predecessor = await tx.request()
        .input("mid", sql.Int, cur.recordset[0].CrmMilestoneId).query(`
          SELECT TOP 1 p.MilestoneName
          FROM dbo.CrmPaymentMilestone m
          JOIN dbo.CrmPaymentMilestone p ON p.BookingId = m.BookingId AND p.MilestoneNo < m.MilestoneNo
          WHERE m.Id = @mid AND p.Status NOT IN ('Paid', 'Waived')
          ORDER BY p.MilestoneNo
        `);
      if (predecessor.recordset.length) {
        await tx.rollback();
        return res.status(400).json({ error: `Cannot approve — "${predecessor.recordset[0].MilestoneName}" is still due first` });
      }
    }

    await tx
      .request()
      .input("id", sql.Int, pid)
      .input("by", sql.NVarChar(150), actor).query(`
        UPDATE dbo.ReceivedPayment
        SET RPStatus='Approved', RPApprovedBy=@by, RPApprovedAt=GETDATE()
        WHERE RPPaymentID=@id
      `);
    crmRow = { RPPaymentID: pid, ...cur.recordset[0] };
    await tx.commit();
  } catch (err) {
    try {
      await tx.rollback();
    } catch {
      /* best-effort */
    }
    console.error("PUT /:id/approve error:", err);
    return res.status(500).json({ error: "Approval failed" });
  }

  // CRM-linked rows never go through the generic postReceivedPaymentApproval
  // GL path below — applyCrmMilestonePaymentApproval does the CRM-specific
  // receipt/rollup/GL posting instead (crmLedger.js's postCrmReceiptToGL,
  // not the generic customer-name-matched GL posting), same as when
  // createReceiptForMilestone posted directly before this approval detour
  // existed. Never allowed to fail the approval itself; outcome logged the
  // same way GL posting failures already are everywhere else.
  if (crmRow?.CrmMilestoneId) {
    let brokerWarning = null;
    try {
      const { applyCrmMilestonePaymentApproval } = require("./crmPayments");
      const outcome = await applyCrmMilestonePaymentApproval(pool, crmRow, actorUserId, actor);
      brokerWarning = outcome?.brokerWarning || null;
      await recordGLPosting("crm-received-payment", pid, outcome, actor);
    } catch (crmErr) {
      await recordGLPosting("crm-received-payment", pid, { failed: true, reason: crmErr.message }, actor);
    }
    await invalidateReceivedPaymentWorkflowCaches();
    return res.json({ success: true, brokerWarning });
  }

  // CrmBookingId set but no CrmMilestoneId — a manual on-account deposit
  // (POST /booking/:id/on-account in crmPayments.js), not a payment against
  // a specific milestone. Same detour as the branch above: the real
  // CrmOnAccountPayment insert/GL/auto-sweep only happens here, once
  // approved, instead of when it was originally submitted.
  if (crmRow?.CrmBookingId) {
    try {
      const { applyCrmOnAccountPaymentApproval } = require("./crmPayments");
      const outcome = await applyCrmOnAccountPaymentApproval(pool, crmRow, actorUserId, actor);
      await recordGLPosting("crm-received-payment", pid, outcome, actor);
    } catch (crmErr) {
      await recordGLPosting("crm-received-payment", pid, { failed: true, reason: crmErr.message }, actor);
    }
    await invalidateReceivedPaymentWorkflowCaches();
    return res.json({ success: true });
  }

  // GL posting AFTER the status commit (postVoucher has its own transaction),
  // with the outcome recorded so an approved-but-unposted receipt is findable
  // (dbo.GLPostingLog — see migration 154), mirroring the approval engine.
  try {
    const outcome = await postReceivedPaymentApproval(pool, pid, actor);
    await recordGLPosting("received-payment", pid, outcome, actor);
  } catch (glErr) {
    await recordGLPosting(
      "received-payment",
      pid,
      { failed: true, reason: glErr.message },
      actor,
    );
  }

  await invalidateReceivedPaymentWorkflowCaches();
  res.json({ success: true });
});

// ── PUT /:id/reject (approver roles only — called from Approval Inbox) ───────
router.put("/:id/reject", allowRoles(...APPROVER_ROLES), async (req, res) => {
  const pid = parseInt(req.params.id, 10);
  if (!Number.isFinite(pid))
    return res.status(400).json({ error: "Invalid id" });
  const { note } = req.body;
  const actor = req.user?.name || req.user?.email || null;
  const pool = getPool();

  const tx = new sql.Transaction(pool);
  try {
    await tx.begin();
    const cur = await tx.request().input("id", sql.Int, pid).query(`
      SELECT RPStatus FROM dbo.ReceivedPayment WITH (UPDLOCK, HOLDLOCK)
      WHERE RPPaymentID=@id
    `);
    if (!cur.recordset.length) {
      await tx.rollback();
      return res.status(404).json({ error: "Received payment not found" });
    }
    const status = cur.recordset[0].RPStatus;
    // A receipt already posted to the ledger must not be silently rejected —
    // that would strand the GL entry. Only Pending can be rejected.
    if (status !== "Pending") {
      await tx.rollback();
      return res
        .status(400)
        .json({ error: `Cannot reject from status "${status}"` });
    }
    await tx
      .request()
      .input("id", sql.Int, pid)
      .input("by", sql.NVarChar(150), actor)
      .input("note", sql.NVarChar(500), note || null).query(`
        UPDATE dbo.ReceivedPayment
        SET RPStatus='Rejected', RPRejectedBy=@by, RPRejectedAt=GETDATE(), RPRejectionNote=@note
        WHERE RPPaymentID=@id
      `);
    await tx.commit();
  } catch (err) {
    try {
      await tx.rollback();
    } catch {
      /* best-effort */
    }
    console.error("PUT /:id/reject error:", err);
    return res.status(500).json({ error: "Rejection failed" });
  }

  await invalidateReceivedPaymentWorkflowCaches();

  // If this ReceivedPayment is the one a CRM Money Receipt was generated
  // from (Booking Amount / Milestone #1 submissions — see
  // crmPayments.js's createReceiptForMilestone), its status is derived live
  // from RPStatus, so rejecting here IS that receipt going Bounced. Best-
  // effort PDF regen only, so a re-download shows the bounce reason
  // immediately instead of a stale "Pending Approval" copy.
  try {
    const { getMoneyReceiptByReceivedPaymentId, generateMoneyReceiptPdf } = require("../services/moneyReceiptPdf");
    const mr = await getMoneyReceiptByReceivedPaymentId(pool, pid);
    if (mr) await generateMoneyReceiptPdf(pool, mr.Id);
  } catch (mrErr) {
    console.error("[received-payment] Money Receipt PDF regeneration on reject failed:", mrErr.message);
  }

  res.json({ success: true });
});

module.exports = router;
module.exports.createReceivedPaymentInternal = createReceivedPaymentInternal;