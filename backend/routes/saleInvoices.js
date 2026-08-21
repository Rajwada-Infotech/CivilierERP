const { requirePageRight } = require("../middleware/requirePageRight");
const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const { requireValidId } = require("../utils/routeHelpers");
const {
  lockNextDocNumber,
  backPatchRecordId,
} = require("../utils/docNumberLock");

// Sale Invoices are gated per-route via requirePageRight("sale-invoice", ...)

// ─── Helpers ──────────────────────────────────────────────────────────────────

const requireUserName = (req, res) => {
  const name = req.user?.name || req.user?.email;
  if (!name) {
    res.status(401).json({ error: "User context missing" });
    return null;
  }
  return name;
};

const MUTATION_CACHE_KEYS = ["sale-invoices", "customer-sale-orders"];

async function invalidateCaches() {
  await Promise.all(MUTATION_CACHE_KEYS.map((k) => bumpCacheVersion(k)));
}

// ─── SELECT shared by list + detail ──────────────────────────────────────────

const SI_SELECT = `
  SELECT
    si.SaleInvoiceID,
    si.SaleInvoiceNo                  AS DocNo,
    si.InvoiceDate,
    si.SaleOrderID,
    so.SaleOrderNo                    AS SaleOrderDocNo,
    si.CustomerID,
    ah.LHeadName                      AS CustomerName,
    si.CustomerID                     AS ToCompanyID,
    ah.LHeadName                      AS ToCompanyName,
    si.CompanyId                      AS FromCompanyID,
    co.name                           AS FromCompanyName,
    si.ProjectId                      AS ToProjectID,
    pr.name                           AS ToProjectName,
    si.Amount                         AS TotalAmount,
    si.AmountReceived,
    si.PaymentStatus,
    si.DocTypeId,
    td.Prefix                         AS DocTypePrefix,
    si.fy_id,
    fy.FName                          AS FinYearName,
    si.Remarks,
    si.CreatedBy,
    si.CreatedAt,
    si.UpdatedBy,
    si.UpdatedAt,
    si.IsDeleted,
    -- Running Dummy Bank balance for this invoice (credit − debit)
    ISNULL((
      SELECT SUM(rp.RPAmount)
      FROM   dbo.ReceivedPayment rp
      WHERE  rp.SourceSaleInvoiceId = si.SaleInvoiceID
        AND  ISNULL(rp.RPStatus, '') NOT IN ('Rejected','Deleted')
    ), 0) AS DummyBankCredited,
    ISNULL((
      SELECT SUM(np.PAmount)
      FROM   dbo.NewPayment np
      JOIN   dbo.ExpenseBooking eb ON eb.EDocNo = np.PExpenseRef
      JOIN   dbo.GoodsReceiptNotes grn ON grn.GRNID = eb.ESourceId
                                       AND eb.ESourceType = 'GRN'
      JOIN   dbo.PurchaseOrders po ON po.PurchaseOrderID = grn.POID
      WHERE  po.SourceSaleInvoiceId = si.SaleInvoiceID
        AND  ISNULL(np.PStatus, '') NOT IN ('Rejected','Deleted')
    ), 0) AS DummyBankDebited
  FROM dbo.SaleInvoices si
  LEFT JOIN dbo.CustomerSaleOrders  so ON so.SaleOrderID  = si.SaleOrderID
  LEFT JOIN dbo.AccountHeadMaster   ah ON ah.LHeadId      = si.CustomerID
  LEFT JOIN dbo.enterprise          co ON co.id           = si.CompanyId
  LEFT JOIN dbo.enterprise          pr ON pr.id           = si.ProjectId
  LEFT JOIN dbo.FinYear             fy ON fy.FId          = si.fy_id
  LEFT JOIN dbo.TypeOfDoc           td ON td.TypeOfDocId  = si.DocTypeId
  WHERE si.IsDeleted = 0
`;

// ── GET /  ────────────────────────────────────────────────────────────────────
router.get(
  "/",
  requirePageRight("sale-invoice", "view"),
  cache("sale-invoices", 300, { shared: true }),
  async (req, res) => {
    try {
      const pool = getPool();
      const page = Math.max(parseInt(req.query.page) || 1, 1);
      const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 500);
      const offset = (page - 1) * limit;

      const paymentStatus = req.query.paymentStatus
        ? req.query.paymentStatus.toString().trim()
        : null;
      const saleOrderId = req.query.saleOrderId
        ? parseInt(req.query.saleOrderId, 10)
        : null;
      const customerId = req.query.customerId
        ? parseInt(req.query.customerId, 10)
        : null;
      const companyId = req.query.companyId
        ? parseInt(req.query.companyId, 10) || null
        : null;

      const where = [];
      if (paymentStatus) where.push("si.PaymentStatus = @paymentStatus");
      if (saleOrderId) where.push("si.SaleOrderID = @saleOrderId");
      if (customerId) where.push("si.CustomerID = @customerId");
      if (companyId) where.push("si.CompanyId = @companyId");
      const extraWhere = where.length ? `AND ${where.join(" AND ")}` : "";

      const result = await pool
        .request()
        .input("offset", sql.Int, offset)
        .input("limit", sql.Int, limit)
        .input("paymentStatus", sql.NVarChar(50), paymentStatus)
        .input("saleOrderId", sql.Int, saleOrderId)
        .input("customerId", sql.Int, customerId)
        .input("companyId", sql.Int, companyId).query(`
          SELECT *, COUNT(*) OVER() AS _total FROM (
            ${SI_SELECT}
            ${extraWhere}
          ) _si
          ORDER BY _si.SaleInvoiceID DESC
          OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
        `);

      const total = result.recordset[0]?._total ?? 0;
      res.json({
        data: result.recordset.map(({ _total, ...r }) => r),
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      });
    } catch (err) {
      console.error("GET SaleInvoices error:", err);
      res.status(500).json({ error: err.message });
    }
  },
);

// ── GET /:id/paid-invoices-for-po  ────────────────────────────────────────────
// Returns Sale Invoices that are fully paid and not yet linked to a PO —
// used by the Purchase Order form to populate the "Source Sale Invoice" picker.
router.get("/paid-for-po", requirePageRight("sale-invoice", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT
        si.SaleInvoiceID,
        si.SaleInvoiceNo,
        si.InvoiceDate,
        si.Amount,
        si.CustomerID,
        ah.LHeadName AS CustomerName,
        so.SaleOrderID,
        so.SaleOrderNo
      FROM dbo.SaleInvoices si
      LEFT JOIN dbo.CustomerSaleOrders so ON so.SaleOrderID = si.SaleOrderID
      LEFT JOIN dbo.AccountHeadMaster  ah ON ah.LHeadId     = si.CustomerID
      WHERE si.PaymentStatus = 'Paid'
        AND si.IsDeleted = 0
        AND NOT EXISTS (
          SELECT 1 FROM dbo.PurchaseOrders po
          WHERE po.SourceSaleInvoiceId = si.SaleInvoiceID
            AND ISNULL(po.Status,'') NOT IN ('Deleted','Rejected')
        )
      ORDER BY si.SaleInvoiceID DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("GET paid-for-po error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:id  ─────────────────────────────────────────────────────────────────
router.get("/:id", requirePageRight("sale-invoice", "view"), async (req, res) => {
  try {
    const id = requireValidId(req, res);
    if (!id) return;
    const pool = getPool();

    const result = await pool
      .request()
      .input("SaleInvoiceID", sql.Int, id)
      .query(`${SI_SELECT} AND si.SaleInvoiceID = @SaleInvoiceID`);

    if (!result.recordset.length)
      return res.status(404).json({ error: "Sale invoice not found" });

    // Also return any Purchase Orders raised against this invoice
    const pos = await pool.request().input("SIID", sql.Int, id).query(`
        SELECT PurchaseOrderID, PurchaseOrderNo, Status, TotalAmount, PODate
        FROM   dbo.PurchaseOrders
        WHERE  SourceSaleInvoiceId = @SIID
          AND  ISNULL(Status,'') NOT IN ('Deleted')
      `);

    res.json({
      ...result.recordset[0],
      LinkedPurchaseOrders: pos.recordset,
    });
  } catch (err) {
    console.error("GET SaleInvoice by id error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /  (Create Sale Invoice from a Sale Order) ───────────────────────────
//
// Business rules enforced here:
//  1. The Sale Order must exist and must not already have an unpaid/active invoice.
//  2. Invoice amount defaults to the Sale Order's TotalAmount when not provided.
//  3. PaymentStatus starts as "Pending Payment".
//
// ─── Internal creation function ──────────────────────────────────────────────
// Extracted from POST / so other server-side callers (the Inter-Company
// Stock Transfer orchestrator) can create a real, fully-validated Sale
// Invoice in-process without duplicating this validation/numbering/insert
// logic or making an HTTP self-call. Mechanical extraction — the POST route
// below now just calls this and maps thrown errors to a response; behavior
// is unchanged. Thrown errors carry a `.status` for the HTTP code to use.
async function createSaleInvoiceInternal(pool, payload, userEmail, issuedByEmail) {
  const { SaleOrderID, InvoiceDate, Amount, DocTypeId, RPFinYear: finYear, Remarks, ContractId } = payload;

  if (!SaleOrderID) {
    const err = new Error("SaleOrderID is required.");
    err.status = 400;
    throw err;
  }

  // ── Guard: Sale Order must exist ─────────────────────────────────────────
  const soCheck = await pool
    .request()
    .input("SaleOrderID", sql.Int, parseInt(SaleOrderID, 10)).query(`
      SELECT SaleOrderID, SaleOrderNo, CustomerID, CompanyId, ProjectId,
             TotalAmount, fy_id, Status
      FROM   dbo.CustomerSaleOrders
      WHERE  SaleOrderID = @SaleOrderID AND IsDeleted = 0
    `);

  if (!soCheck.recordset.length) {
    const err = new Error("Sale Order not found.");
    err.status = 404;
    throw err;
  }

  const so = soCheck.recordset[0];

  // ── Guard: no existing active invoice for this SO ────────────────────────
  const dupCheck = await pool
    .request()
    .input("SaleOrderID", sql.Int, so.SaleOrderID).query(`
      SELECT COUNT(*) AS cnt
      FROM   dbo.SaleInvoices
      WHERE  SaleOrderID = @SaleOrderID
        AND  PaymentStatus NOT IN ('Cancelled')
        AND  IsDeleted = 0
    `);

  if (Number(dupCheck.recordset[0]?.cnt) > 0) {
    const err = new Error(
      "An active Sale Invoice already exists for this Sale Order. Only one active invoice per Sale Order is allowed.",
    );
    err.status = 409;
    throw err;
  }

  // Resolve FinYear
  let fyId = so.fy_id;
  if (finYear) {
    const fyRow = await pool
      .request()
      .input("FName", sql.NVarChar, finYear)
      .query("SELECT FId FROM dbo.FinYear WHERE FName = @FName");
    fyId = fyRow.recordset[0]?.FId ?? fyId;
  }

  const invoiceAmount = parseFloat(Amount) || parseFloat(so.TotalAmount) || 0;

  const transaction = pool.transaction();
  await transaction.begin();

  try {
    // Generate doc number
    // SaleInvoice.tsx doesn't yet have a doc-type selector UI, so DocTypeId
    // is usually not sent from the frontend — resolve a sensible default
    // (the active TypeOfDoc row tagged for Sale Invoice) rather than hard
    // failing every invoice creation until that UI exists.
    let resolvedDocTypeId = DocTypeId ? parseInt(DocTypeId, 10) : null;
    if (!resolvedDocTypeId) {
      const defaultDocType = await pool.request().query(`
        SELECT TOP 1 TypeOfDocId FROM dbo.TypeOfDoc
        WHERE IsActive = 1
          AND (DocNoPrefix = 'SI' OR links_to LIKE '%Sale Invoice%')
        ORDER BY TypeOfDocId
      `);
      resolvedDocTypeId = defaultDocType.recordset[0]?.TypeOfDocId ?? null;
    }

    let finalDocNo = null;
    if (resolvedDocTypeId) {
      finalDocNo = await lockNextDocNumber(pool, sql, {
        docTypeId: resolvedDocTypeId,
        finYear,
        tableName: "SaleInvoices",
        docNoColumn: "SaleInvoiceNo",
        issuedBy: issuedByEmail,
      });
    }
    if (!finalDocNo) {
      const err = new Error(
        "SaleInvoiceNo could not be generated. Select a document type with SI prefix.",
      );
      err.status = 400;
      throw err;
    }

    const result = await transaction
      .request()
      .input("SaleInvoiceNo", sql.NVarChar(100), finalDocNo)
      .input("InvoiceDate", sql.Date, InvoiceDate || new Date())
      .input("SaleOrderID", sql.Int, so.SaleOrderID)
      .input("CustomerID", sql.Int, so.CustomerID)
      .input("CompanyId", sql.Int, so.CompanyId)
      .input("ProjectId", sql.Int, so.ProjectId)
      .input("Amount", sql.Decimal(18, 2), invoiceAmount)
      .input("AmountReceived", sql.Decimal(18, 2), 0)
      .input("PaymentStatus", sql.NVarChar(20), "Pending Payment")
      .input("DocTypeId", sql.Int, resolvedDocTypeId)
      .input("FyId", sql.Int, fyId)
      .input("Remarks", sql.NVarChar(sql.MAX), Remarks || null)
      .input("CreatedBy", sql.NVarChar(100), userEmail)
      .input("CreatedAt", sql.DateTime2, new Date())
      .input("ContractId", sql.Int, ContractId ? parseInt(ContractId, 10) : null).query(`
        INSERT INTO dbo.SaleInvoices
          (SaleInvoiceNo, InvoiceDate, SaleOrderID, CustomerID,
           CompanyId, ProjectId, Amount, AmountReceived, PaymentStatus,
           DocTypeId, fy_id, Remarks, CreatedBy, CreatedAt, ContractId)
        OUTPUT INSERTED.SaleInvoiceID
        VALUES
          (@SaleInvoiceNo, @InvoiceDate, @SaleOrderID, @CustomerID,
           @CompanyId, @ProjectId, @Amount, @AmountReceived, @PaymentStatus,
           @DocTypeId, @FyId, @Remarks, @CreatedBy, @CreatedAt, @ContractId)
      `);

    const newId = result.recordset[0].SaleInvoiceID;

    await transaction.commit();
    await backPatchRecordId(pool, sql, finalDocNo, "SaleInvoices", newId);

    // ── Contract Master: auto-allocate (FIFO) any available advance ─────────
    // Runs AFTER commit — the invoice itself must exist first, and this
    // mirrors the already-established pattern where a real ReceivedPayment
    // settles an invoice: we create a real (system-generated, Dummy-Bank)
    // ReceivedPayment row so the invoice's PaymentStatus is recomputed by
    // the SAME recalcInvoicePaymentStatus() every real payment uses —
    // never a second, parallel "how much has this invoice received"
    // calculation that could silently drift from the real one.
    if (ContractId) {
      const { autoAllocateFIFO } = require("../services/contractLedger");
      const allocation = await autoAllocateFIFO(pool, {
        contractId: parseInt(ContractId, 10),
        sourceType: "SaleInvoice",
        sourceId: newId,
        sourceDocNo: finalDocNo,
        documentAmount: invoiceAmount,
        createdBy: userEmail,
      });

      if (allocation.allocatedAmount > 0) {
        const dummyBank = await pool.request().query(
          "SELECT TOP 1 LHeadId, LHeadName FROM dbo.AccountHeadMaster WHERE LHeadCode = 'DUMMY-BANK' AND Status = 'Approved'",
        );
        if (dummyBank.recordset.length) {
          await pool
            .request()
            .input("RPCompanyName", sql.NVarChar(255), null)
            .input("RPReceivedFrom", sql.NVarChar(255), `Contract Advance (${finalDocNo})`)
            .input("RPProjectName", sql.NVarChar(255), "")
            .input("RPDocDate", sql.Date, new Date())
            .input("RPMode", sql.NVarChar(50), "Cash")
            .input("RPAmount", sql.Decimal(18, 2), allocation.allocatedAmount)
            .input("RPDepositBankId", sql.Int, dummyBank.recordset[0].LHeadId)
            .input("RPDepositBankName", sql.NVarChar(255), dummyBank.recordset[0].LHeadName)
            .input("RPRemarks", sql.NVarChar(sql.MAX), `Auto-adjusted from Contract advance against ${finalDocNo}`)
            .input("SourceSaleInvoiceId", sql.Int, newId)
            .input("SourceSaleInvoiceDocNo", sql.NVarChar(100), finalDocNo)
            .input("ContractId", sql.Int, parseInt(ContractId, 10))
            .input("RPCreatedBy", sql.NVarChar(100), userEmail).query(`
              INSERT INTO dbo.ReceivedPayment
                (RPCompanyName, RPReceivedFrom, RPProjectName, RPDocDate, RPMode, RPAmount,
                 RPDepositBankId, RPDepositBankName, RPRemarks,
                 SourceSaleInvoiceId, SourceSaleInvoiceDocNo, ContractId,
                 RPStatus, RPCreatedBy, RPCreatedAt)
              VALUES
                (@RPCompanyName, @RPReceivedFrom, @RPProjectName, @RPDocDate, @RPMode, @RPAmount,
                 @RPDepositBankId, @RPDepositBankName, @RPRemarks,
                 @SourceSaleInvoiceId, @SourceSaleInvoiceDocNo, @ContractId,
                 'Approved', @RPCreatedBy, GETDATE())
            `);
          await recalcInvoicePaymentStatus(pool, newId);
        }
      }
    }

    return {
      SaleInvoiceID: newId,
      DocNo: finalDocNo,
      SaleInvoiceNo: finalDocNo,
      TotalAmount: invoiceAmount,
      PaymentStatus: "Pending Payment",
      ...(ContractId ? { ContractId: parseInt(ContractId, 10) } : {}),
    };
  } catch (err) {
    try {
      await transaction.rollback();
    } catch {
      /* already rolled back */
    }
    throw err;
  }
}

router.post("/", requirePageRight("sale-invoice", "create"), async (req, res) => {
  try {
    const userEmail = requireUserName(req, res);
    if (!userEmail) return;

    const pool = getPool();
    const result = await createSaleInvoiceInternal(pool, req.body, userEmail, req.user?.email);
    await invalidateCaches();

    res.status(201).json({ ...result, message: "Sale invoice created successfully" });
  } catch (err) {
    console.error("POST SaleInvoice error:", err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── Internal helper: recalculate and persist PaymentStatus after a payment ───
// Called by receivedPayment.js after creating/deleting a receipt that links
// to a SaleInvoice (SourceSaleInvoiceId).  Not an HTTP route.
async function recalcInvoicePaymentStatus(pool, saleInvoiceId) {
  if (!saleInvoiceId) return;
  try {
    await pool.request().input("SIID", sql.Int, saleInvoiceId).query(`
      UPDATE dbo.SaleInvoices
      SET
        AmountReceived = (
          SELECT ISNULL(SUM(RPAmount), 0)
          FROM   dbo.ReceivedPayment
          WHERE  SourceSaleInvoiceId = @SIID
            AND  ISNULL(RPStatus,'') NOT IN ('Rejected','Deleted')
        ),
        PaymentStatus = CASE
          WHEN (
            SELECT ISNULL(SUM(RPAmount), 0)
            FROM   dbo.ReceivedPayment
            WHERE  SourceSaleInvoiceId = @SIID
              AND  ISNULL(RPStatus,'') NOT IN ('Rejected','Deleted')
          ) >= Amount THEN 'Paid'
          WHEN (
            SELECT ISNULL(SUM(RPAmount), 0)
            FROM   dbo.ReceivedPayment
            WHERE  SourceSaleInvoiceId = @SIID
              AND  ISNULL(RPStatus,'') NOT IN ('Rejected','Deleted')
          ) > 0 THEN 'Partially Paid'
          ELSE 'Pending Payment'
        END,
        UpdatedAt = GETDATE()
      WHERE SaleInvoiceID = @SIID
    `);
  } catch (err) {
    console.error(
      "recalcInvoicePaymentStatus failed (non-fatal):",
      err.message,
    );
  }
}

module.exports = router;
module.exports.recalcInvoicePaymentStatus = recalcInvoicePaymentStatus;
module.exports.createSaleInvoiceInternal = createSaleInvoiceInternal;