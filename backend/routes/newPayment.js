const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const { transition } = require("../services/approvalService");
const { requirePageRight } = require("../middleware/requirePageRight");
const { checkPermissionForMethod } = require("../middleware/routePermission");
const { validateBody } = require("../middleware/validateRequest");
const { paymentBodySchema } = require("../validation/financialRouteSchemas");
const {
  lockNextDocNumber,
  backPatchRecordId,
  resolveDocTypeId,
} = require("../utils/docNumberLock");
const { syncBillStatus } = require("../utils/syncBillStatus");

router.use(checkPermissionForMethod("Finance", "Payments"));

const requireUserEmail = (req, res) => {
  const email = req.user?.email;
  if (!email) {
    res.status(401).json({ error: "User context missing" });
    return null;
  }
  return email;
};

function normalizeBankId(value) {
  const bankId = Number(value);
  return Number.isFinite(bankId) && bankId > 0 ? bankId : null;
}

// Resolves the dbo.FinYear row a payment date falls into — the year in the
// payment's own PDate IS the financial year it belongs to, independent of
// DocYear (which only reflects the calendar year the doc number was issued
// in). Used so direct/manual payments (no linked ExpenseBooking) are still
// correctly filterable/displayable by Financial Year in Reports.
async function resolveFinYearId(pool, pDate) {
  if (!pDate) return null;
  const result = await pool
    .request()
    .input("PDate", sql.Date, pDate)
    .query(`
      SELECT TOP 1 FId FROM dbo.FinYear
      WHERE @PDate >= FStartDate AND @PDate <= FEndDate
      ORDER BY FStartDate DESC
    `);
  return result.recordset[0]?.FId ?? null;
}

// syncBillStatus is imported from ../utils/syncBillStatus
// Wrap to match existing call sites that pass (pool, expenseRef) without sql
const _syncBillStatus = (pool, expenseRef) => syncBillStatus(pool, sql, expenseRef);

// ── GET all payments ──────────────────────────────────────────────────────────
router.get("/", cache("new-payment", 300), async (req, res) => {
  try {
    const pool = getPool();
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 100);
    const offset = (page - 1) * limit;
    // String() coercion guards against Express parsing duplicate params as an
    // array (e.g. ?supplier[]=a&supplier[]=b), which would make .trim() throw.
    const search = req.query.supplier ? String(req.query.supplier).trim() : "";
    const companyId = req.query.company ? String(req.query.company).trim() : "";
    const project = req.query.project ? String(req.query.project).trim() : "";
    const finYear = req.query.finYear ? String(req.query.finYear).trim() : "";
    const docNumber = req.query.docNumber ? String(req.query.docNumber).trim() : "";
    const docDate = req.query.docDate ? String(req.query.docDate).trim() : "";
    const dateParam = req.query.date ? String(req.query.date).trim() : "";
    const dueDate = req.query.dueDate ? String(req.query.dueDate).trim() : "";
    const remarks = req.query.remarks ? String(req.query.remarks).trim() : "";
    const idFilter = req.query.id ? parseInt(req.query.id, 10) : null;

    // Every column here is qualified with np. — the data query joins
    // dbo.GoodsReceiptNotes and dbo.PurchaseOrders, both of which also have a
    // DocNo column, so an unqualified `DocNo LIKE @search`/`DocNo LIKE
    // @docNumber` throws "Ambiguous column name 'DocNo'" the moment the
    // search or docNumber filter is used. The count query below is aliased
    // to match.
    const conditions = [];
    if (idFilter) conditions.push(`np.PPaymentID = @idFilter`);
    if (search) {
      conditions.push(`(np.PPaymentName LIKE @search
          OR np.DocNo LIKE @search
          OR np.PExpenseRef LIKE @search
          OR np.PProject LIKE @search
          OR np.PCompany LIKE @search
          OR np.PBankName LIKE @search)`);
    }
    if (companyId) conditions.push(`np.PCompany = @companyId`);
    if (project) conditions.push(`np.PProject LIKE @project`);
    // Filters by the FinYear the payment's own PDate falls into (PFinYearId
    // — resolved at save time, see resolveFinYearId), matching the same
    // dbo.FinYear.FId the Reports page's FY dropdown sends. NOT DocYear,
    // which is just the calendar year the doc number happened to be issued
    // in and never matches a FinYear.FId.
    if (finYear) conditions.push(`np.PFinYearId = @finYear`);
    if (docNumber) conditions.push(`np.DocNo LIKE @docNumber`);
    if (docDate) conditions.push(`CAST(np.PCreatedAt AS DATE) = @docDate`);
    if (dateParam) conditions.push(`np.PDate = @dateParam`);
    if (dueDate) conditions.push(`np.PChequeDate = @dueDate`);
    if (remarks)
      conditions.push(
        `(np.PPaymentName LIKE @remarks OR np.PExpenseRef LIKE @remarks)`,
      );

    const whereClause = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    const request = pool.request();
    if (idFilter) request.input("idFilter", sql.Int, idFilter);
    if (search) request.input("search", sql.NVarChar(200), `%${search}%`);
    if (companyId) request.input("companyId", sql.NVarChar(50), companyId);
    if (project) request.input("project", sql.NVarChar(200), `%${project}%`);
    if (finYear) request.input("finYear", sql.Int, parseInt(finYear));
    if (docNumber)
      request.input("docNumber", sql.NVarChar(100), `%${docNumber}%`);
    if (docDate) request.input("docDate", sql.Date, docDate);
    if (dateParam) request.input("dateParam", sql.Date, dateParam);
    if (dueDate) request.input("dueDate", sql.Date, dueDate);
    if (remarks) request.input("remarks", sql.NVarChar(200), `%${remarks}%`);

    const countResult = await request.query(
      `SELECT COUNT(*) AS total FROM dbo.NewPayment np ${whereClause}`,
    );
    const total = parseInt(countResult.recordset[0].total);

    const dataRequest = pool
      .request()
      .input("offset", sql.Int, offset)
      .input("limit", sql.Int, limit);
    if (idFilter) dataRequest.input("idFilter", sql.Int, idFilter);
    if (search) dataRequest.input("search", sql.NVarChar(200), `%${search}%`);
    if (companyId) dataRequest.input("companyId", sql.NVarChar(50), companyId);
    if (project)
      dataRequest.input("project", sql.NVarChar(200), `%${project}%`);
    if (finYear) dataRequest.input("finYear", sql.Int, parseInt(finYear));
    if (docNumber)
      dataRequest.input("docNumber", sql.NVarChar(100), `%${docNumber}%`);
    if (docDate) dataRequest.input("docDate", sql.Date, docDate);
    if (dateParam) dataRequest.input("dateParam", sql.Date, dateParam);
    if (dueDate) dataRequest.input("dueDate", sql.Date, dueDate);
    if (remarks)
      dataRequest.input("remarks", sql.NVarChar(200), `%${remarks}%`);

    const result = await dataRequest.query(`
      SELECT
        np.*,
        -- Company name (resolved from enterprise table via PCompany text match)
        ISNULL(ec.name, np.PCompany)                       AS PCompanyName,
        -- Project name (resolved from EB → enterprise, or PO → enterprise)
        COALESCE(ep.name, po_proj.name, np.PProject)       AS PProjectName,
        -- Supplier/contractor name — from the ExpenseBooking resolved chain
        -- when this payment is linked to an invoice, otherwise fall back to
        -- the party (PPartyId) picked directly on a direct/TOD payment.
        COALESCE(
          CASE
            WHEN eb.ESourceType = 'GRN' THEN grn_sup.LHeadName
            WHEN eb.ESourceType = 'PO'  THEN po_sup.LHeadName
            ELSE grn2_sup.LHeadName
          END,
          party_head.LHeadName
        )                                                  AS PSupplierName,
        -- Supplier contact person
        COALESCE(
          CASE
            WHEN eb.ESourceType = 'GRN' THEN grn_sup.LHeadContactPerson
            WHEN eb.ESourceType = 'PO'  THEN po_sup.LHeadContactPerson
            ELSE grn2_sup.LHeadContactPerson
          END,
          party_head.LHeadContactPerson
        )                                                  AS PSupplierContact,
        -- Net Payable (the payment amount already on np.PAmount, but also expose EB net for reference)
        ISNULL(eb.ENetAmount, eb.EAmount)                  AS EBNetPayable,
        -- Tax amount: computed as (ENetAmount - EAmount) when both are set, else 0
        -- EAmount = taxable base, ENetAmount = amount after tax
        CASE
          WHEN eb.ENetAmount IS NOT NULL AND eb.EAmount IS NOT NULL
          THEN ROUND(eb.ENetAmount - eb.EAmount, 2)
          ELSE 0
        END                                                AS TaxAmount,
        -- Taxable / Base amount
        ISNULL(eb.EAmount, 0)                              AS TaxableAmount,
        -- HSN codes from GRN items (comma-separated, via scalar subquery)
        (
          SELECT STRING_AGG(ISNULL(j.hsnCode, j.HsnCode), ', ')
          FROM dbo.GoodsReceiptNotes grn_hsn
          CROSS APPLY OPENJSON(grn_hsn.GRNItems) WITH (
            hsnCode NVARCHAR(50) '$.hsnCode',
            HsnCode NVARCHAR(50) '$.HsnCode'
          ) j
          WHERE grn_hsn.GRNID = TRY_CAST(eb.ESourceId AS INT)
            AND eb.ESourceType = 'GRN'
        )                                                  AS HSNCodes,
        -- Financial year from ExpenseBooking
        -- Financial year: prefer the linked ExpenseBooking's own EFinYear;
        -- for direct/manual payments (no linked EB) fall back to the FinYear
        -- resolved from the payment's own PDate (see resolveFinYearId).
        ISNULL(eb.EFinYear, ISNULL(pfy.FName, ''))         AS EBFinYear,
        -- Ref Doc = the ExpenseBooking DocNo
        eb.EDocNo                                          AS RefDoc,
        -- Expense Booking primary key — used by "Pay Remaining" to pre-fill the form
        eb.Eid                                             AS PExpenseId,
        -- EB DocDate for reference
        eb.EDocDate                                        AS EBDocDate,
        -- Card display info (last 4 digits + network) when PCardId is set
        cmast.card_number                                  AS PCardNumber,
        cmast.card_network                                 AS PCardNetwork,
        cmast.card_holder_name                              AS PCardHolderName,
        -- BRS state
        COALESCE(brc_list.IsMatched, 0)                    AS IsMatched,
        COALESCE(brc_list.IsBounced, 0)                    AS IsBounced,
        brc_list.BounceDate,
        brc_list.BounceReason,
        -- Computed display status (derived from approval status + BRS state + replacement chain)
        CASE
          WHEN EXISTS (
            SELECT 1 FROM dbo.NewPayment r2
            WHERE r2.ReplacesPaymentId = np.PPaymentID
              AND r2.Status NOT IN ('Rejected', 'Deleted')
          ) THEN 'Reissued'
          WHEN COALESCE(brc_list.IsBounced, 0) = 1
            THEN 'Cheque Bounced'
          WHEN COALESCE(brc_list.IsMatched, 0) = 1
            AND np.PMode IN ('Cheque', 'Post-Dated Cheque')
            THEN 'Cheque Cleared'
          WHEN np.Status = 'Approved'
            AND np.PMode IN ('Cheque', 'Post-Dated Cheque')
            THEN 'Cheque Issued'
          WHEN np.Status = 'Approved'
            THEN 'Success'
          WHEN np.Status = 'Pending'
            THEN 'Pending'
          WHEN np.Status = 'Rejected'
            THEN 'Failed'
          WHEN np.Status = 'Deleted'
            THEN 'Cancelled'
          ELSE np.Status
        END                                                AS DisplayStatus
      FROM dbo.NewPayment np
      LEFT JOIN dbo.ExpenseBooking eb ON eb.EDocNo = np.PExpenseRef
      LEFT JOIN dbo.FinYear pfy ON pfy.FId = np.PFinYearId
      LEFT JOIN dbo.card_master cmast ON cmast.id = np.PCardId
      -- Resolve company
      LEFT JOIN dbo.enterprise ec
        ON ec.id = TRY_CAST(np.PCompany AS INT) AND ec.business_type = 'C'
      -- Resolve project from EB
      LEFT JOIN dbo.enterprise ep
        ON ep.id = TRY_CAST(eb.EProjectName AS INT) AND ep.business_type = 'P'
      -- Resolve project via PO when EB source is PO
      LEFT JOIN dbo.PurchaseOrders po
        ON eb.ESourceType = 'PO' AND po.PurchaseOrderID = TRY_CAST(eb.ESourceId AS INT)
      LEFT JOIN dbo.enterprise po_proj
        ON po_proj.id = po.ProjectId AND po_proj.business_type = 'P'
      -- Resolve supplier: GRN path
      LEFT JOIN dbo.GoodsReceiptNotes grn_eb
        ON eb.ESourceType = 'GRN' AND grn_eb.GRNID = TRY_CAST(eb.ESourceId AS INT)
      LEFT JOIN dbo.AccountHeadMaster grn_sup
        ON grn_sup.LHeadId = grn_eb.SupplierID
      -- Resolve supplier: PO path
      LEFT JOIN dbo.AccountHeadMaster po_sup
        ON po_sup.LHeadId = po.SupplierID
      -- Resolve supplier: fallback via GRN linked to PO
      LEFT JOIN dbo.GoodsReceiptNotes grn2
        ON eb.ESourceType NOT IN ('GRN','PO') AND grn2.POID = po.PurchaseOrderID
      LEFT JOIN dbo.AccountHeadMaster grn2_sup
        ON grn2_sup.LHeadId = grn2.SupplierID
      -- Resolve party directly picked on a direct/TOD payment (no linked EB)
      LEFT JOIN dbo.AccountHeadMaster party_head
        ON party_head.LHeadId = np.PPartyId
      -- BRS state for DisplayStatus
      LEFT JOIN dbo.BankReconciliation brc_list
        ON  brc_list.SourceType = 'PAYMENT'
        AND brc_list.SourceID   = np.PPaymentID
      ${whereClause}
      ORDER BY np.PPaymentID DESC
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
    console.error("PAYMENT GET ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:id — full detail for a single payment (used by Trial Balance drill-down) ──
// ── GET /cheque-lots — fetch active lots, optionally filtered by bankId ────────
router.get("/cheque-lots", async (req, res) => {
  try {
    const pool = getPool();
    const bankId = req.query.bankId ? parseInt(req.query.bankId) : null;

    const request = pool.request();
    // ChequeMaster.Status is nvarchar — existing rows store 'Draft' (active)
    // or '0'/'Inactive' (inactive). Migration 121 converts this to BIT, after
    // which active rows become 1. Until then, exclude only explicit inactive values.
    let whereClause =
      "WHERE cm.Status = 1 AND (cm.ChequeEndNumber - cm.ChequeStartNumber + 1) > 0";
    if (bankId) {
      request.input("BankId", sql.Int, bankId);
      whereClause += " AND cm.BankId = @BankId";
    }

    const result = await request.query(`
      SELECT
        cm.CId,
        cm.ChequeLotNumber,
        cm.AccountNumber,
        cm.IFSCCode,
        cm.ChequeStartNumber,
        cm.ChequeEndNumber,
        (cm.ChequeEndNumber - cm.ChequeStartNumber + 1) AS TotalCheques,
        cm.BankId,
        bm.BName        AS BankName,
        bm.BBranch      AS BankBranch,
        bm.BAccountType AS BankAccountType,
        cm.Remarks,
        -- Remaining: explicit arithmetic avoids computed-column resolution issues.
        -- Subtracts both cheques currently attached to an active payment AND
        -- cancelled cheques (dbo.CancelledCheque — permanently blocked from
        -- reissue even though cancellation detaches PChequeLotId from the
        -- originating NewPayment row).
        (cm.ChequeEndNumber - cm.ChequeStartNumber + 1)
          - ISNULL((
              SELECT COUNT(*) FROM dbo.NewPayment np
              WHERE np.PChequeLotId = cm.CId AND np.PChequeNo IS NOT NULL
            ), 0)
          - ISNULL((
              SELECT COUNT(*) FROM dbo.CancelledCheque cc
              WHERE cc.ChequeLotId = cm.CId
            ), 0) AS RemainingCheques
      FROM dbo.ChequeMaster cm
      LEFT JOIN dbo.BankMaster bm ON cm.BankId = bm.BId
      ${whereClause}
      ORDER BY cm.ChequeLotNumber
    `);

    res.json(result.recordset);
  } catch (err) {
    console.error("CHEQUE LOTS GET ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /cheque-numbers/:lotId — list all cheque numbers in a lot with used status ──
router.get("/cheque-numbers/:lotId", async (req, res) => {
  const lotId = parseInt(req.params.lotId);
  if (!lotId) return res.status(400).json({ error: "lotId is required" });

  try {
    const pool = getPool();

    // Fetch lot range
    const lotRes = await pool.request().input("CId", sql.Int, lotId).query(`
      SELECT ChequeStartNumber, ChequeEndNumber
      FROM dbo.ChequeMaster
      WHERE CId = @CId AND Status = 1
    `);

    if (!lotRes.recordset.length) {
      return res
        .status(404)
        .json({ error: "Cheque lot not found or inactive" });
    }

    // mssql returns BIGINT columns as JS strings, not numbers — comparing
    // ("61" <= "100") lexicographically is false, so without Number()
    // coercion the loop below never runs and every lot looks empty.
    const ChequeStartNumber = Number(lotRes.recordset[0].ChequeStartNumber);
    const ChequeEndNumber = Number(lotRes.recordset[0].ChequeEndNumber);

    // Fetch all cheque numbers used from this lot, plus their bounce status
    const usedRes = await pool.request().input("PChequeLotId", sql.Int, lotId)
      .query(`
        SELECT np.PChequeNo, COALESCE(brc.IsBounced, 0) AS IsBounced
        FROM dbo.NewPayment np
        LEFT JOIN dbo.BankReconciliation brc
          ON brc.SourceType = 'PAYMENT' AND brc.SourceID = np.PPaymentID
        WHERE np.PChequeLotId = @PChequeLotId AND np.PChequeNo IS NOT NULL
          AND np.Status NOT IN ('Rejected', 'Deleted')
      `);
    const usedSet    = new Set(usedRes.recordset.map((r) => String(r.PChequeNo)));
    const bouncedSet = new Set(
      usedRes.recordset.filter((r) => r.IsBounced).map((r) => String(r.PChequeNo))
    );

    // Cancelled cheques are permanently blocked from reissue even though
    // cancellation detaches the originating payment's PChequeLotId (so they
    // no longer show up in usedSet above) — see chequeCancellation.js.
    const cancelledRes = await pool.request().input("ChequeLotId", sql.Int, lotId)
      .query(`SELECT ChequeNo FROM dbo.CancelledCheque WHERE ChequeLotId = @ChequeLotId`);
    const cancelledSet = new Set(cancelledRes.recordset.map((r) => String(r.ChequeNo)));

    // Build list of all cheque numbers in range
    const cheques = [];
    for (let n = ChequeStartNumber; n <= ChequeEndNumber; n++) {
      const num = String(n);
      cheques.push({
        number: num,
        used: usedSet.has(num),
        bounced: bouncedSet.has(num),
        cancelled: cancelledSet.has(num),
      });
    }

    res.json(cheques);
  } catch (err) {
    console.error("CHEQUE NUMBERS GET ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /deduct-cheque — validate cheque number selection (no longer auto-assigns) ──
// TotalCheques is a COMPUTED column on ChequeMaster — cannot be updated directly.
// Usage is tracked via NewPayment.PChequeNo records instead.
router.post("/deduct-cheque", requirePageRight("new-payment", "edit"), async (req, res) => {
  const { lotId, chequeNo } = req.body;
  if (!lotId) return res.status(400).json({ error: "lotId is required" });
  if (!chequeNo) return res.status(400).json({ error: "chequeNo is required" });

  try {
    const pool = getPool();

    // Verify lot exists and is active
    const lotRes = await pool.request().input("CId", sql.Int, lotId).query(`
      SELECT CId, ChequeStartNumber, ChequeEndNumber
      FROM dbo.ChequeMaster
      WHERE CId = @CId AND Status = 1
    `);

    if (!lotRes.recordset.length) {
      return res
        .status(404)
        .json({ error: "Cheque lot not found or inactive" });
    }

    // Same string-vs-number BIGINT coercion issue as /cheque-numbers/:lotId.
    const lot = {
      ...lotRes.recordset[0],
      ChequeStartNumber: Number(lotRes.recordset[0].ChequeStartNumber),
      ChequeEndNumber: Number(lotRes.recordset[0].ChequeEndNumber),
    };
    const num = parseInt(chequeNo);
    if (num < lot.ChequeStartNumber || num > lot.ChequeEndNumber) {
      return res.status(400).json({ error: "Cheque number out of lot range" });
    }

    // Check if already used
    const dupRes = await pool
      .request()
      .input("PChequeLotId", sql.Int, lotId)
      .input("PChequeNo", sql.NVarChar(50), String(chequeNo)).query(`
        SELECT COUNT(*) AS cnt FROM dbo.NewPayment
        WHERE PChequeLotId = @PChequeLotId AND PChequeNo = @PChequeNo
          AND Status NOT IN ('Rejected', 'Deleted')
      `);

    if (dupRes.recordset[0].cnt > 0) {
      return res
        .status(409)
        .json({ error: "Cheque number already used in another payment" });
    }

    // Cancelled cheques are permanently blocked — cancellation detaches
    // PChequeLotId from the payment row, so the check above alone wouldn't
    // catch a previously-cancelled number being picked again.
    const cancelledDupRes = await pool
      .request()
      .input("ChequeLotId", sql.Int, lotId)
      .input("ChequeNo", sql.NVarChar(50), String(chequeNo))
      .query(`SELECT COUNT(*) AS cnt FROM dbo.CancelledCheque WHERE ChequeLotId = @ChequeLotId AND ChequeNo = @ChequeNo`);
    if (cancelledDupRes.recordset[0].cnt > 0) {
      return res
        .status(409)
        .json({ error: "This cheque number has been cancelled and cannot be reissued." });
    }

    // Count remaining available cheques (exclude Rejected/Deleted)
    const usedRes = await pool.request().input("PChequeLotId", sql.Int, lotId)
      .query(`
      SELECT COUNT(*) AS usedCount FROM dbo.NewPayment
      WHERE PChequeLotId = @PChequeLotId AND PChequeNo IS NOT NULL
        AND Status NOT IN ('Rejected', 'Deleted')
    `);
    const totalCheques = lot.ChequeEndNumber - lot.ChequeStartNumber + 1;
    const usedCount = usedRes.recordset[0].usedCount;
    const remainingCheques = totalCheques - usedCount - 1; // -1 for this one being taken

    res.json({
      nextChequeNumber: String(chequeNo),
      remainingCheques: Math.max(0, remainingCheques),
    });
  } catch (err) {
    console.error("DEDUCT CHEQUE ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST — Create payment ─────────────────────────────────────────────────────
router.post("/", requirePageRight("new-payment", "create"), validateBody(paymentBodySchema), async (req, res) => {
  const {
    PPaymentName,
    PRemarks,
    PMode,
    PAmount,
    PDocType,
    PDate,
    PBankID,
    PBankName,
    PProject,
    PCompany,
    PExpenseRef,
    parentDocNo,
    rootExBDocNo,
    // Cheque
    PChequeNo,
    PChequeLotId,
    PChequeLotNumber,
    PChequeDate,
    PChequeAccountNumber,
    PChequeIfsc,
    PIsPostDated,
    // Digital
    PNeftNumber,
    PUpiTransactionId,
    PRtgsReference,
    PImpsReference,
    PCardReference,
    PCardId,
    // Inter-Company Stock Transfer workflow — see receivedPayment.js's
    // identical SourceSaleInvoiceId handling for the mirror-image case on
    // the customer/receiving side of that feature.
    IsInterCompanyTransfer,
    // Re-issue: links this payment back to a bounced predecessor
    ReplacesPaymentId,
    // Optional bounce charge added on top of the original amount
    BounceCharge,
    // Contract Master (Migration 176) — see services/contractLedger.js
    ContractId,
    // Party ID (AccountHeadMaster LHeadId) for direct-invoice payments.
    // Migration 180 adds PPartyId column; resolvePartyFromRef reads it as fallback.
    partyId,
    // "Keep the balance on his on account" checkbox — see migration 188.
    oaSkipAutoApply,
  } = req.body;

  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;

    const pool = getPool();

    // Inter-Company Stock Transfer payments must always be deposited to
    // the Dummy Bank — this is a system-generated payment for a stock
    // movement between two projects under different companies, settled
    // without a real bank transaction. Same pattern as
    // receivedPayment.js's SourceSaleInvoiceId handling: reject a
    // mismatched client-supplied bank rather than silently overriding it.
    if (IsInterCompanyTransfer) {
      const dummyBank = await pool
        .request()
        .query(
          "SELECT TOP 1 LHeadId, LHeadName FROM dbo.AccountHeadMaster WHERE LHeadCode = 'DUMMY-BANK' AND Status = 'Approved'",
        );
      if (!dummyBank.recordset.length) {
        return res.status(500).json({
          error: "Dummy Bank account not found. Please contact your administrator.",
        });
      }
      const dummyBankId = dummyBank.recordset[0].LHeadId;
      const dummyBankName = dummyBank.recordset[0].LHeadName;

      if (PBankID && parseInt(PBankID, 10) !== dummyBankId) {
        return res.status(400).json({
          error: `Inter-company transfer payments must be deposited to the Dummy Bank (${dummyBankName}). Other deposit accounts are not allowed for this workflow.`,
        });
      }

      // Force-set deposit bank to Dummy Bank regardless of client payload
      req.body.PBankID = dummyBankId;
      req.body.PBankName = dummyBankName;
    }

    // Enforce: a payment can only be made against an Approved Expense Booking.
    // Skipped for Contract-linked payments — the frontend's Contract picker
    // (Payment.tsx's handleContractSelect) reuses this same PExpenseRef field
    // to hold the Contract's own DocNo (purely so existing "is a source
    // linked?" UI gating keeps working), not a real ExpenseBooking reference,
    // so looking it up against dbo.ExpenseBooking would always 404.
    if (PExpenseRef && !ContractId) {
      const isEmiRef = /-EMI-\d+$/.test(PExpenseRef);
      let ebCheck;
      if (isEmiRef) {
        // EMI installment ref — look up parent expense booking via EmiInstallments
        ebCheck = await pool
          .request()
          .input("RefNumber", sql.NVarChar(200), PExpenseRef)
          .query(`SELECT eb.EStatus FROM dbo.EmiInstallments ei
                  JOIN dbo.ExpenseBooking eb ON eb.Eid = ei.ExpenseBookingId
                  WHERE ei.RefNumber = @RefNumber`);
      } else {
        ebCheck = await pool
          .request()
          .input("EDocNo", sql.NVarChar(100), PExpenseRef)
          .query("SELECT EStatus FROM dbo.ExpenseBooking WHERE EDocNo = @EDocNo");
      }

      if (!ebCheck.recordset.length) {
        return res
          .status(404)
          .json({ error: "Referenced Expense Booking not found." });
      }

      const ebStatus = ebCheck.recordset[0].EStatus;
      if (ebStatus !== "Approved") {
        return res.status(400).json({
          error: `Cannot make payment: Expense Booking is "${ebStatus}". Only Approved Expense Bookings can be paid.`,
        });
      }
    }

    // Always use 'PAY' prefix — TypeOfDoc only has a 'PAY' row.
    // rootExBDocNo is stored on the record for traceability only.
    const prefix = "PAY";
    const docTypeId = await resolveDocTypeId(pool, sql, prefix);
    const finalDocNo = await lockNextDocNumber(pool, sql, {
      docTypeId,
      tableName: "NewPayment",
      docNoColumn: "DocNo",
      issuedBy: userEmail,
      parentDocNo,
      rootExBDocNo,
    });
    const parts = finalDocNo.split("-");
    const docYear = parseInt(parts[parts.length - 2], 10) || null;
    const docSerial = parseInt(parts[parts.length - 1], 10) || null;

    // The financial year a payment belongs to is the one its own PDate falls
    // into — not DocYear (the calendar year the doc number happened to be
    // locked in, always "today"). Resolved once here so it's filterable and
    // displayable via Reports even for direct/manual payments with no
    // linked ExpenseBooking to inherit a fin year from.
    const pFinYearId = await resolveFinYearId(pool, PDate);

    // All new payments auto-submit to Pending for approval — no manual submit step.
    const initialStatus = "Pending";

    const insertResult = await pool
      .request()
      .input("PPaymentName", sql.VarChar, PPaymentName || "")
      .input("PRemarks", sql.NVarChar(1000), PRemarks || null)
      .input("PMode", sql.VarChar, PMode || "")
      .input("PAmount", sql.Decimal(18, 2), PAmount != null ? Number(PAmount) : null)
      .input("PDocType", sql.VarChar, PDocType || "N/A")
      .input("PDate", sql.Date, PDate || null)
      .input("PBankID", sql.Int, normalizeBankId(req.body.PBankID ?? PBankID))
      .input("PBankName", sql.VarChar, req.body.PBankName || PBankName || null)
      .input("PProject", sql.VarChar, PProject || "")
      .input("PCompany", sql.VarChar, PCompany || "")
      .input("PExpenseRef", sql.NVarChar(100), PExpenseRef || null)
      // Cheque fields
      .input("PChequeNo", sql.NVarChar(50), PChequeNo || null)
      .input("PChequeLotId", sql.Int, PChequeLotId || null)
      .input("PChequeLotNumber", sql.NVarChar(100), PChequeLotNumber || null)
      .input("PChequeDate", sql.Date, PChequeDate || null)
      .input(
        "PChequeAccountNumber",
        sql.NVarChar(50),
        PChequeAccountNumber || null,
      )
      .input("PChequeIfsc", sql.NVarChar(20), PChequeIfsc || null)
      .input("PIsPostDated", sql.Bit, PIsPostDated ? 1 : 0)
      // Digital reference fields
      .input("PNeftNumber", sql.NVarChar(50), PNeftNumber || null)
      .input("PUpiTransactionId", sql.NVarChar(100), PUpiTransactionId || null)
      .input("PRtgsReference", sql.NVarChar(100), PRtgsReference || null)
      .input("PImpsReference", sql.NVarChar(100), PImpsReference || null)
      .input("PCardReference", sql.NVarChar(100), PCardReference || null)
      .input("PCardId", sql.Int, PCardId || null)
      // Document numbering
      .input("DocNo", sql.NVarChar(100), finalDocNo)
      .input("DocTypeId", sql.Int, docTypeId)
      .input("DocYear", sql.SmallInt, docYear)
      .input("DocSerial", sql.Int, docSerial)
      .input("PFinYearId", sql.Int, pFinYearId)
      .input("ParentDocNo", sql.NVarChar(100), parentDocNo || null)
      .input("RootExBDocNo", sql.NVarChar(100), rootExBDocNo || null)
      // Audit
      .input("ReplacesPaymentId", sql.Int, ReplacesPaymentId ? parseInt(ReplacesPaymentId) : null)
      .input("BounceCharge", sql.Decimal(18, 2), BounceCharge ? parseFloat(BounceCharge) : null)
      .input("ContractId", sql.Int, ContractId ? parseInt(ContractId, 10) : null)
      .input("PPartyId", sql.Int, partyId ? parseInt(partyId, 10) : null)
      .input("OASkipAutoApply", sql.Bit, oaSkipAutoApply ? 1 : 0)
      .input("PCreatedAt", sql.DateTime, new Date())
      .input("PCreatedBy", sql.NVarChar(100), userEmail)
      .input("PApprovedBy", sql.NVarChar(100), null)
      .input("Status", sql.NVarChar(20), initialStatus).query(`
        INSERT INTO dbo.NewPayment (
          PPaymentName, PRemarks, PMode, PAmount, PDocType, PDate,
          PBankID, PBankName, PProject, PCompany, PExpenseRef,
          PChequeNo, PChequeLotId, PChequeLotNumber, PChequeDate,
          PChequeAccountNumber, PChequeIfsc, PIsPostDated,
          PNeftNumber, PUpiTransactionId, PRtgsReference, PImpsReference, PCardReference, PCardId,
          DocNo, DocTypeId, DocYear, DocSerial, PFinYearId, ParentDocNo, RootExBDocNo,
          ReplacesPaymentId, BounceCharge, ContractId, PPartyId, OASkipAutoApply,
          PCreatedAt, PCreatedBy, PApprovedBy, Status
        )
        OUTPUT INSERTED.PPaymentID
        VALUES (
          @PPaymentName, @PRemarks, @PMode, @PAmount, @PDocType, @PDate,
          @PBankID, @PBankName, @PProject, @PCompany, @PExpenseRef,
          @PChequeNo, @PChequeLotId, @PChequeLotNumber, @PChequeDate,
          @PChequeAccountNumber, @PChequeIfsc, @PIsPostDated,
          @PNeftNumber, @PUpiTransactionId, @PRtgsReference, @PImpsReference, @PCardReference, @PCardId,
          @DocNo, @DocTypeId, @DocYear, @DocSerial, @PFinYearId, @ParentDocNo, @RootExBDocNo,
          @ReplacesPaymentId, @BounceCharge, @ContractId, @PPartyId, @OASkipAutoApply,
          @PCreatedAt, @PCreatedBy, @PApprovedBy, @Status
        )
      `);

    const newId = insertResult.recordset[0]?.PPaymentID;
    await backPatchRecordId(pool, sql, finalDocNo, "NewPayment", newId);

    // Sync bill status on the referenced expense booking
    if (PExpenseRef) await _syncBillStatus(pool, PExpenseRef);

    // NOTE: On Account hooks (excess credit / OA debit) fire on APPROVE, not here.
    // A Pending payment has not moved funds yet, so recording OA at creation would
    // create balances that may never materialise (if the payment is rejected).

    // Contract Master: any payment tagged with a ContractId records an
    // advance against that contract. PExpenseRef isn't a useful signal to
    // gate on here — the frontend's Contract picker sets it to the
    // Contract's own DocNo (see the validation skip above), so it's always
    // truthy whenever ContractId is; ContractId alone is what actually
    // means "this payment is against a contract, not a real invoice".
    if (ContractId) {
      const { recordAdvance } = require("../services/contractLedger");
      await recordAdvance(pool, {
        contractId: parseInt(ContractId, 10),
        sourceType: "NewPayment",
        sourceId: newId,
        sourceDocNo: finalDocNo,
        amount: PAmount != null ? Number(PAmount) : 0,
        createdBy: userEmail,
      });
    }

    await bumpCacheVersion("new-payment");
    res.status(201).json({
      message: "Payment added successfully",
      PPaymentID: newId,
      docNo: finalDocNo,
    });
  } catch (err) {
    // Unique index UX_NewPayment_ChequeLot_ChequeNo — the same cheque number
    // was assigned to another payment (race between two concurrent creates).
    if (
      (err.number === 2601 || err.number === 2627) &&
      String(err.message).includes("UX_NewPayment_ChequeLot_ChequeNo")
    ) {
      return res.status(409).json({
        error: "Cheque number already used in another payment. Pick a different cheque.",
      });
    }
    console.error("PAYMENT INSERT ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /:id — Update payment ─────────────────────────────────────────────────
router.put("/:id", requirePageRight("new-payment", "edit"), validateBody(paymentBodySchema), async (req, res) => {
  const { id } = req.params;
  const {
    PPaymentName,
    PRemarks,
    PMode,
    PAmount,
    PDocType,
    PDate,
    PBankID,
    PBankName,
    PProject,
    PCompany,
    PExpenseRef,
    parentDocNo,
    rootExBDocNo,
    // Cheque
    PChequeNo,
    PChequeLotId,
    PChequeLotNumber,
    PChequeDate,
    PChequeAccountNumber,
    PChequeIfsc,
    PIsPostDated,
    // Digital
    PNeftNumber,
    PUpiTransactionId,
    PRtgsReference,
    PImpsReference,
    PCardReference,
    PCardId,
    // "Keep the balance on his on account" checkbox — see migration 188.
    oaSkipAutoApply,
  } = req.body;

  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;

    const pool = getPool();

    // Enforce: a payment can only be linked to an Approved Expense Booking.
    if (PExpenseRef) {
      const isEmiRef = /-EMI-\d+$/.test(PExpenseRef);
      let ebCheck;
      if (isEmiRef) {
        ebCheck = await pool
          .request()
          .input("RefNumber", sql.NVarChar(200), PExpenseRef)
          .query(`SELECT eb.EStatus FROM dbo.EmiInstallments ei
                  JOIN dbo.ExpenseBooking eb ON eb.Eid = ei.ExpenseBookingId
                  WHERE ei.RefNumber = @RefNumber`);
      } else {
        ebCheck = await pool
          .request()
          .input("EDocNo", sql.NVarChar(100), PExpenseRef)
          .query("SELECT EStatus FROM dbo.ExpenseBooking WHERE EDocNo = @EDocNo");
      }

      if (!ebCheck.recordset.length) {
        return res
          .status(404)
          .json({ error: "Referenced Expense Booking not found." });
      }

      const ebStatus = ebCheck.recordset[0].EStatus;
      if (ebStatus !== "Approved") {
        return res.status(400).json({
          error: `Cannot update payment: Expense Booking is "${ebStatus}". Only Approved Expense Bookings can be paid.`,
        });
      }
    }

    // Re-resolve the Financial Year whenever the payment date is edited — it
    // always tracks the payment's own PDate, same as on create.
    const pFinYearIdUpdate = await resolveFinYearId(pool, PDate);

    await pool
      .request()
      .input("PPaymentID", sql.Int, id)
      .input("PPaymentName", sql.VarChar, PPaymentName || "")
      .input("PRemarks", sql.NVarChar(1000), PRemarks || null)
      .input("PMode", sql.VarChar, PMode || "")
      .input("PAmount", sql.Decimal(18, 2), PAmount != null ? Number(PAmount) : null)
      .input("PDocType", sql.VarChar, PDocType || "N/A")
      .input("PDate", sql.Date, PDate || null)
      .input("PFinYearId", sql.Int, pFinYearIdUpdate)
      .input("PBankID", sql.Int, normalizeBankId(PBankID))
      .input("PBankName", sql.VarChar, PBankName || null)
      .input("PProject", sql.VarChar, PProject || "")
      .input("PCompany", sql.VarChar, PCompany || "")
      .input("PExpenseRef", sql.NVarChar(100), PExpenseRef || null)
      .input("ParentDocNo", sql.NVarChar(100), parentDocNo || null)
      .input("RootExBDocNo", sql.NVarChar(100), rootExBDocNo || null)
      // Cheque
      .input("PChequeNo", sql.NVarChar(50), PChequeNo || null)
      .input("PChequeLotId", sql.Int, PChequeLotId || null)
      .input("PChequeLotNumber", sql.NVarChar(100), PChequeLotNumber || null)
      .input("PChequeDate", sql.Date, PChequeDate || null)
      .input(
        "PChequeAccountNumber",
        sql.NVarChar(50),
        PChequeAccountNumber || null,
      )
      .input("PChequeIfsc", sql.NVarChar(20), PChequeIfsc || null)
      .input("PIsPostDated", sql.Bit, PIsPostDated ? 1 : 0)
      // Digital
      .input("PNeftNumber", sql.NVarChar(50), PNeftNumber || null)
      .input("PUpiTransactionId", sql.NVarChar(100), PUpiTransactionId || null)
      .input("PRtgsReference", sql.NVarChar(100), PRtgsReference || null)
      .input("PImpsReference", sql.NVarChar(100), PImpsReference || null)
      .input("PCardReference", sql.NVarChar(100), PCardReference || null)
      .input("PCardId", sql.Int, PCardId || null)
      .input("OASkipAutoApply", sql.Bit, oaSkipAutoApply === undefined ? null : (oaSkipAutoApply ? 1 : 0))
      .input("PUpdatedBy", sql.NVarChar(100), userEmail).query(`
        UPDATE dbo.NewPayment SET
          PPaymentName         = @PPaymentName,
          PRemarks             = @PRemarks,
          PMode                = @PMode,
          PAmount              = @PAmount,
          PDocType             = @PDocType,
          PDate                = @PDate,
          PBankID              = @PBankID,
          PBankName            = @PBankName,
          PProject             = @PProject,
          PCompany             = @PCompany,
          PExpenseRef          = @PExpenseRef,
          ParentDocNo          = @ParentDocNo,
          RootExBDocNo         = @RootExBDocNo,
          PChequeNo            = @PChequeNo,
          PChequeLotId         = @PChequeLotId,
          PChequeLotNumber     = @PChequeLotNumber,
          PChequeDate          = @PChequeDate,
          PChequeAccountNumber = @PChequeAccountNumber,
          PChequeIfsc          = @PChequeIfsc,
          PIsPostDated         = @PIsPostDated,
          PNeftNumber          = @PNeftNumber,
          PUpiTransactionId    = @PUpiTransactionId,
          PRtgsReference       = @PRtgsReference,
          PImpsReference       = @PImpsReference,
          PCardReference       = @PCardReference,
          PCardId              = @PCardId,
          OASkipAutoApply      = ISNULL(@OASkipAutoApply, OASkipAutoApply)
        WHERE PPaymentID = @PPaymentID
      `);

    // Sync bill status since amount may have changed
    const updatedRef = await pool.request().input("id", sql.Int, id)
      .query("SELECT PExpenseRef FROM dbo.NewPayment WHERE PPaymentID = @id");
    if (updatedRef.recordset[0]?.PExpenseRef) {
      await _syncBillStatus(pool,updatedRef.recordset[0].PExpenseRef);
    }
    await bumpCacheVersion("new-payment");
    res.json({ message: "Payment updated successfully" });
  } catch (err) {
    if (
      (err.number === 2601 || err.number === 2627) &&
      String(err.message).includes("UX_NewPayment_ChequeLot_ChequeNo")
    ) {
      return res.status(409).json({
        error: "Cheque number already used in another payment. Pick a different cheque.",
      });
    }
    console.error("PAYMENT UPDATE ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /:id ───────────────────────────────────────────────────────────────
router.delete("/:id", requirePageRight("new-payment", "delete"), async (req, res) => {
  const { id } = req.params;
  try {
    const pool = getPool();

    // ── Guard: matched in BRS ──────────────────────────────────────────────
    // Mirrors expenseBooking.js's BRS guard — a reconciled payment must be
    // un-matched in the BRS before it can be deleted, not silently dropped.
    const brsCheck = await pool.request().input("PPaymentID", sql.Int, id).query(`
      SELECT COUNT(*) AS cnt FROM dbo.BankReconciliation
      WHERE SourceType = 'PAYMENT' AND SourceID = @PPaymentID AND IsMatched = 1
    `);
    if (Number(brsCheck.recordset[0]?.cnt) > 0) {
      return res.status(409).json({
        error: "brs_matched",
        message: "This payment is matched in the Bank Reconciliation Statement. Unmatch/reverse it in the BRS before deleting.",
      });
    }

    const refRow = await pool.request().input("PPaymentID", sql.Int, id)
      .query("SELECT PExpenseRef FROM dbo.NewPayment WHERE PPaymentID = @PPaymentID");
    const expenseRef = refRow.recordset[0]?.PExpenseRef || null;

    const result = await pool
      .request()
      .input("PPaymentID", sql.Int, id)
      .query("DELETE FROM dbo.NewPayment WHERE PPaymentID=@PPaymentID");
    if (!result.rowsAffected[0]) {
      return res.status(404).json({ error: "Payment not found" });
    }
    if (expenseRef) await _syncBillStatus(pool,expenseRef);
    await bumpCacheVersion("new-payment");
    res.json({ message: "Payment deleted successfully" });
  } catch (err) {
    console.error("PAYMENT DELETE ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /:id/submit — Draft → Pending ─────────────────────────────────────────
router.put("/:id/submit", requirePageRight("new-payment", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;

    const result = await transition(
      "payments",
      id,
      "Pending",
      userEmail,
      req.user?.role,
    );
    await Promise.all([
      bumpCacheVersion("new-payment"),
      bumpCacheVersion("brs"),
    ]);
    res.json({ message: "Payment submitted for approval", ...result });
  } catch (err) {
    console.error("Payment submit error:", err.message);
    res.status(400).json({ error: err.message });
  }
});

// ── PUT /:id/approve — Pending → Approved ─────────────────────────────────────
router.put("/:id/approve", requirePageRight("new-payment", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;

    const pool = getPool();
    const result = await transition(
      "payments",
      id,
      "Approved",
      userEmail,
      req.user?.role,
    );

    // Sync EMI installment if this payment is for an EMI ref
    try {
      const payRec = await pool
        .request()
        .input("PPaymentID", sql.Int, id)
        .query(
          "SELECT PExpenseRef FROM dbo.NewPayment WHERE PPaymentID = @PPaymentID",
        );
      const expenseRef = payRec.recordset[0]?.PExpenseRef || "";
      if (/-EMI-\d+$/.test(expenseRef)) {
        await pool
          .request()
          .input("RefNumber", sql.NVarChar(200), expenseRef)
          .input("PaidBy", sql.NVarChar(200), userEmail)
          .input("PaidAt", sql.DateTime2, new Date()).query(`
            UPDATE dbo.EmiInstallments
            SET Status = 'Paid', PaidBy = @PaidBy, PaidAt = @PaidAt
            WHERE RefNumber = @RefNumber AND Status != 'Paid'
          `);
        const parentRes = await pool
          .request()
          .input("RefNumber", sql.NVarChar(200), expenseRef).query(`
            SELECT ei.ExpenseBookingId, eb.EEmiData
            FROM dbo.EmiInstallments ei
            JOIN dbo.ExpenseBooking eb ON eb.Eid = ei.ExpenseBookingId
            WHERE ei.RefNumber = @RefNumber
          `);
        if (parentRes.recordset.length) {
          const { ExpenseBookingId, EEmiData } = parentRes.recordset[0];
          const schedRes = await pool
            .request()
            .input("ExpenseBookingId", sql.Int, ExpenseBookingId)
            .query(`SELECT InstallmentNo, DueDate, Amount, Status, RefNumber
                    FROM dbo.EmiInstallments
                    WHERE ExpenseBookingId = @ExpenseBookingId
                    ORDER BY InstallmentNo`);
          let emiData = {};
          try {
            emiData = JSON.parse(EEmiData || "{}");
          } catch {}
          emiData.schedule = schedRes.recordset.map((r) => ({
            installmentNo: r.InstallmentNo,
            dueDate: r.DueDate?.toISOString?.().slice(0, 10) ?? r.DueDate,
            amount: parseFloat(r.Amount),
            status: r.Status,
            refNumber: r.RefNumber,
          }));
          await pool
            .request()
            .input("Eid", sql.Int, ExpenseBookingId)
            .input("EEmiData", sql.NVarChar(sql.MAX), JSON.stringify(emiData))
            .query(
              "UPDATE dbo.ExpenseBooking SET EEmiData = @EEmiData WHERE Eid = @Eid",
            );
          await bumpCacheVersion("expense-booking");
        }
      }
    } catch (emiErr) {
      console.warn("EMI sync on approve failed:", emiErr.message);
    }

    await Promise.all([
      bumpCacheVersion("new-payment"),
      bumpCacheVersion("brs"),
    ]);

    // Sync bill status on approval — fetch full payment record and recalculate
    try {
      const approvedPayRec = await pool
        .request()
        .input("PPaymentID", sql.Int, id)
        .query(
          "SELECT PExpenseRef, PAmount, PDate, BounceCharge, DocNo, OASkipAutoApply, PPartyId, PPaymentName, PCompany, PProject FROM dbo.NewPayment WHERE PPaymentID = @PPaymentID",
        );
      const approvedRow = approvedPayRec.recordset[0];
      const approvedRef = approvedRow?.PExpenseRef;
      const effectiveRef = approvedRef && /-EMI-\d+$/.test(approvedRef)
        ? approvedRef.replace(/-EMI-\d+$/, "")
        : approvedRef;

      if (effectiveRef) {
        await _syncBillStatus(pool, effectiveRef);
      }

      // ── On Account hooks: fire on APPROVE (funds have actually moved) ──────
      if (approvedRef && !/-EMI-\d+$/.test(approvedRef) && approvedRow) {
        try {
          const { resolvePartyFromRef } = require("../utils/resolvePartyFromRef");
          const partyTypeLabel = { S: "Supplier", C: "Contractor", A: "Customer" };
          const party = await resolvePartyFromRef(pool, approvedRef);
          if (party?.partyId) {
            // Read invoice AFTER syncBillStatus so ERemainingAmount is current
            const ebRes = await pool.request()
              .input("EDocNo", sql.NVarChar(100), effectiveRef || approvedRef)
              .query(`SELECT TOP 1 ERemainingAmount, ENetAmount, ECompanyId, TRY_CAST(EProjectName AS INT) AS ProjectId FROM dbo.ExpenseBooking WHERE EDocNo = @EDocNo`);
            if (ebRes.recordset.length) {
              const eb = ebRes.recordset[0];
              const netPayable = parseFloat(eb.ENetAmount ?? 0);
              const payAmt     = parseFloat(approvedRow.PAmount) || 0;
              const bounceAmt  = parseFloat(approvedRow.BounceCharge ?? 0);
              const netPaid    = payAmt - bounceAmt;
              const afterApproval = parseFloat(eb.ERemainingAmount ?? 0); // remaining AFTER this approval
              const finalDocNo = approvedRow.DocNo || "";

              // DEBIT: if invoice still has remaining balance, apply existing OA —
              // unless the payer explicitly asked to keep the balance untouched
              // (OASkipAutoApply, set from the payment form's checkbox).
              if (afterApproval > 0.005 && !approvedRow.OASkipAutoApply) {
                const oaBalRes = await pool.request()
                  .input("PartyId", sql.Int, party.partyId)
                  .query(`SELECT ISNULL(OnAccountBalance, 0) AS bal FROM dbo.AccountHeadMaster WHERE LHeadId=@PartyId`);
                const oaBal = parseFloat(oaBalRes.recordset[0]?.bal ?? 0);
                if (oaBal > 0.005) {
                  const applyAmt = Math.min(oaBal, afterApproval);
                  await pool.request()
                    .input("PartyId",     sql.Int,           party.partyId)
                    .input("PartyType",   sql.NVarChar(20),  partyTypeLabel[party.partyType] ?? party.partyType)
                    .input("TxnDate",     sql.Date,          approvedRow.PDate ? new Date(approvedRow.PDate) : new Date())
                    .input("TxnType",     sql.NVarChar(10),  "DEBIT")
                    .input("Amount",      sql.Decimal(18,2), applyAmt)
                    .input("RefType",     sql.NVarChar(30),  "Invoice")
                    .input("RefDocNo",    sql.NVarChar(100), approvedRef)
                    .input("RefId",       sql.Int,           id)
                    .input("AdjRefDocNo", sql.NVarChar(100), finalDocNo)
                    .input("CompanyId",   sql.Int,           eb.ECompanyId ?? null)
                    .input("ProjectId",   sql.Int,           eb.ProjectId ?? null)
                    .input("Notes",       sql.NVarChar(500), `OA auto-applied ₹${applyAmt} to ${approvedRef} via ${finalDocNo}`)
                    .input("CreatedBy",   sql.NVarChar(150), req.user?.email || "system")
                    .query(`
                      INSERT INTO dbo.OnAccountLedger
                        (PartyId,PartyType,TxnDate,TxnType,Amount,RefType,RefDocNo,RefId,AdjRefDocNo,CompanyId,ProjectId,Notes,CreatedBy)
                      VALUES
                        (@PartyId,@PartyType,@TxnDate,@TxnType,@Amount,@RefType,@RefDocNo,@RefId,@AdjRefDocNo,@CompanyId,@ProjectId,@Notes,@CreatedBy);
                      UPDATE dbo.AccountHeadMaster
                        SET OnAccountBalance = OnAccountBalance - @Amount
                        WHERE LHeadId = @PartyId;
                    `);
                  await _syncBillStatus(pool, effectiveRef || approvedRef);
                }
              }

              // CREDIT: if paid amount exceeds net payable, store excess as OA balance
              // pre_remaining = what was owed before this payment = afterApproval + netPaid (capped at netPayable)
              const preRemaining = Math.min(netPayable, afterApproval + netPaid);
              const excess = Math.max(0, netPaid - preRemaining);
              if (excess > 0.005) {
                await pool.request()
                  .input("PartyId",   sql.Int,           party.partyId)
                  .input("PartyType", sql.NVarChar(20),  partyTypeLabel[party.partyType] ?? party.partyType)
                  .input("TxnDate",   sql.Date,          approvedRow.PDate ? new Date(approvedRow.PDate) : new Date())
                  .input("TxnType",   sql.NVarChar(10),  "CREDIT")
                  .input("Amount",    sql.Decimal(18,2), excess)
                  .input("RefType",   sql.NVarChar(30),  "Payment")
                  .input("RefDocNo",  sql.NVarChar(100), finalDocNo)
                  .input("RefId",     sql.Int,           id)
                  .input("CompanyId", sql.Int,           eb.ECompanyId ?? null)
                  .input("ProjectId", sql.Int,           eb.ProjectId ?? null)
                  .input("Notes",     sql.NVarChar(500), `Excess ₹${excess} from ${finalDocNo} on invoice ${approvedRef}`)
                  .input("CreatedBy", sql.NVarChar(150), req.user?.email || "system")
                  .query(`
                    INSERT INTO dbo.OnAccountLedger
                      (PartyId,PartyType,TxnDate,TxnType,Amount,RefType,RefDocNo,RefId,CompanyId,ProjectId,Notes,CreatedBy)
                    VALUES
                      (@PartyId,@PartyType,@TxnDate,@TxnType,@Amount,@RefType,@RefDocNo,@RefId,@CompanyId,@ProjectId,@Notes,@CreatedBy);
                    UPDATE dbo.AccountHeadMaster
                      SET OnAccountBalance = OnAccountBalance + @Amount
                      WHERE LHeadId = @PartyId;
                  `);
              }
            }
          }
        } catch (oaErr) {
          console.warn("[OA] On Account hook on approve failed (non-fatal):", oaErr.message);
        }
      } else if (!approvedRef && approvedRow?.PPartyId) {
        // ── Standalone advance / on-account payment (no invoice or contract linked) ──
        // If the Payment Reason (from Payment Reason Master) marks this as an
        // advance / on-account payment, credit it straight to the party's OA
        // balance so it's immediately available in the On A/C Adjustment page.
        try {
          const reasonNorm = (approvedRow.PPaymentName || "").trim().toLowerCase();
          const isAdvanceReason =
            reasonNorm.includes("advance") ||
            reasonNorm.includes("on a/c") ||
            reasonNorm.includes("on ac") ||
            reasonNorm.includes("on-account") ||
            reasonNorm.includes("on account");
          if (isAdvanceReason) {
            const partyRes = await pool.request()
              .input("PartyId", sql.Int, approvedRow.PPartyId)
              .query(`SELECT LHeadType FROM dbo.AccountHeadMaster WHERE LHeadId = @PartyId`);
            if (partyRes.recordset.length) {
              const partyTypeLabel = { S: "Supplier", C: "Contractor", A: "Customer" };
              const partyType = partyRes.recordset[0].LHeadType;
              const payAmt = parseFloat(approvedRow.PAmount) || 0;
              const bounceAmt = parseFloat(approvedRow.BounceCharge ?? 0);
              const netPaid = payAmt - bounceAmt;
              const finalDocNo = approvedRow.DocNo || "";
              if (netPaid > 0.005) {
                await pool.request()
                  .input("PartyId",   sql.Int,           approvedRow.PPartyId)
                  .input("PartyType", sql.NVarChar(20),  partyTypeLabel[partyType] ?? partyType)
                  .input("TxnDate",   sql.Date,          approvedRow.PDate ? new Date(approvedRow.PDate) : new Date())
                  .input("TxnType",   sql.NVarChar(10),  "CREDIT")
                  .input("Amount",    sql.Decimal(18,2), netPaid)
                  .input("RefType",   sql.NVarChar(30),  "Payment")
                  .input("RefDocNo",  sql.NVarChar(100), finalDocNo)
                  .input("RefId",     sql.Int,           id)
                  .input("CompanyRaw", sql.NVarChar(200), approvedRow.PCompany || null)
                  .input("ProjectRaw", sql.NVarChar(200), approvedRow.PProject || null)
                  .input("Notes",     sql.NVarChar(500), `Standalone ${approvedRow.PPaymentName} ₹${netPaid} via ${finalDocNo}`)
                  .input("CreatedBy", sql.NVarChar(150), req.user?.email || "system")
                  .query(`
                    INSERT INTO dbo.OnAccountLedger
                      (PartyId,PartyType,TxnDate,TxnType,Amount,RefType,RefDocNo,RefId,CompanyId,ProjectId,Notes,CreatedBy)
                    VALUES
                      (@PartyId,@PartyType,@TxnDate,@TxnType,@Amount,@RefType,@RefDocNo,@RefId,TRY_CAST(@CompanyRaw AS INT),TRY_CAST(@ProjectRaw AS INT),@Notes,@CreatedBy);
                    UPDATE dbo.AccountHeadMaster
                      SET OnAccountBalance = OnAccountBalance + @Amount
                      WHERE LHeadId = @PartyId;
                  `);
              }
            }
          }
        } catch (oaErr) {
          console.warn("[OA] Standalone advance OA hook on approve failed (non-fatal):", oaErr.message);
        }
      }
    } catch (syncErr) {
      console.warn("Bill status sync after approve failed:", syncErr.message);
    }

    res.json({ message: "Payment approved", ...result });
  } catch (err) {
    console.error("Payment approve error:", err.message);
    const status = err.message.includes("not authorized") ? 403 : 400;
    res.status(status).json({ error: err.message });
  }
});

// ── PUT /:id/reject — Pending → Rejected ──────────────────────────────────────
router.put("/:id/reject", requirePageRight("new-payment", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { note } = req.body;
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;

    const result = await transition(
      "payments",
      id,
      "Rejected",
      userEmail,
      req.user?.role,
      note || null,
    );
    await Promise.all([
      bumpCacheVersion("new-payment"),
      bumpCacheVersion("brs"),
    ]);
    res.json({ message: "Payment rejected", ...result });
  } catch (err) {
    console.error("Payment reject error:", err.message);
    const status = err.message.includes("not authorized") ? 403 : 400;
    res.status(status).json({ error: err.message });
  }
});

// ── GET /:id — full detail for one payment (Trial Balance Level 3 drill-down) ──
// Must be last so named routes like /cheque-lots aren't captured by this param.
router.get("/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const result = await pool.request().input("id", sql.Int, id).query(`
      SELECT
        np.*,
        ISNULL(ec.name, np.PCompany)                       AS PCompanyName,
        COALESCE(ep.name, po_proj.name, np.PProject)       AS PProjectName,
        COALESCE(
          CASE
            WHEN eb.ESourceType = 'GRN' THEN grn_sup.LHeadName
            WHEN eb.ESourceType = 'PO'  THEN po_sup.LHeadName
            ELSE grn2_sup.LHeadName
          END,
          party_head.LHeadName
        )                                                  AS PSupplierName,
        COALESCE(
          CASE
            WHEN eb.ESourceType = 'GRN' THEN grn_sup.LHeadContactPerson
            WHEN eb.ESourceType = 'PO'  THEN po_sup.LHeadContactPerson
            ELSE grn2_sup.LHeadContactPerson
          END,
          party_head.LHeadContactPerson
        )                                                  AS PSupplierContact,
        ISNULL(eb.ENetAmount, eb.EAmount)                  AS EBNetPayable,
        CASE
          WHEN eb.ENetAmount IS NOT NULL AND eb.EAmount IS NOT NULL
          THEN ROUND(eb.ENetAmount - eb.EAmount, 2)
          ELSE 0
        END                                                AS TaxAmount,
        ISNULL(eb.EAmount, 0)                              AS TaxableAmount,
        ISNULL(eb.EFinYear, ISNULL(pfy.FName, ''))         AS EBFinYear,
        eb.EDocNo                                          AS RefDoc,
        eb.EDocDate                                        AS EBDocDate,
        eb.ERemarks                                        AS EBDescription,
        cmast.card_number                                  AS PCardNumber,
        cmast.card_network                                 AS PCardNetwork,
        cmast.card_holder_name                             AS PCardHolderName,
        ahm.LHeadName                                      AS BankAccountName
      FROM dbo.NewPayment np
      LEFT JOIN dbo.ExpenseBooking eb ON eb.EDocNo = np.PExpenseRef
      LEFT JOIN dbo.FinYear pfy ON pfy.FId = np.PFinYearId
      LEFT JOIN dbo.card_master cmast ON cmast.id = np.PCardId
      LEFT JOIN dbo.enterprise ec
        ON ec.id = TRY_CAST(np.PCompany AS INT) AND ec.business_type = 'C'
      LEFT JOIN dbo.enterprise ep
        ON ep.id = TRY_CAST(eb.EProjectName AS INT) AND ep.business_type = 'P'
      LEFT JOIN dbo.PurchaseOrders po
        ON eb.ESourceType = 'PO' AND po.PurchaseOrderID = TRY_CAST(eb.ESourceId AS INT)
      LEFT JOIN dbo.enterprise po_proj
        ON po_proj.id = po.ProjectId AND po_proj.business_type = 'P'
      LEFT JOIN dbo.GoodsReceiptNotes grn_eb
        ON eb.ESourceType = 'GRN' AND grn_eb.GRNID = TRY_CAST(eb.ESourceId AS INT)
      LEFT JOIN dbo.AccountHeadMaster grn_sup ON grn_sup.LHeadId = grn_eb.SupplierID
      LEFT JOIN dbo.AccountHeadMaster po_sup  ON po_sup.LHeadId  = po.SupplierID
      LEFT JOIN dbo.GoodsReceiptNotes grn2
        ON eb.ESourceType NOT IN ('GRN','PO') AND grn2.POID = po.PurchaseOrderID
      LEFT JOIN dbo.AccountHeadMaster grn2_sup ON grn2_sup.LHeadId = grn2.SupplierID
      LEFT JOIN dbo.AccountHeadMaster party_head ON party_head.LHeadId = np.PPartyId
      LEFT JOIN dbo.AccountHeadMaster ahm ON ahm.LHeadName = np.PBankName AND ahm.LHeadType = 'B'
      WHERE np.PPaymentID = @id
    `);
    if (!result.recordset.length) return res.status(404).json({ error: "Payment not found" });
    res.json(result.recordset[0]);
  } catch (err) {
    console.error("[new-payment/:id]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /recalculate-balances — fix stale EBillStatus on all invoices ────────
// One-time utility: recalculates ETotalPaid / ERemainingAmount / EBillStatus for
// every ExpenseBooking that has at least one NewPayment, using the bounce-aware logic.
router.post("/recalculate-balances", async (req, res) => {
  try {
    const pool = getPool();
    const refs = await pool.request().query(`
      SELECT DISTINCT PExpenseRef FROM dbo.NewPayment
      WHERE PExpenseRef IS NOT NULL AND PExpenseRef <> ''
    `);
    const expenseRefs = refs.recordset.map((r) => r.PExpenseRef);
    let updated = 0;
    for (const ref of expenseRefs) {
      try {
        await syncBillStatus(pool, sql, ref);
        updated++;
      } catch (e) {
        console.warn("recalc failed for", ref, e.message);
      }
    }
    return res.json({ ok: true, processed: expenseRefs.length, updated });
  } catch (err) {
    console.error("recalculate-balances error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ── GET /detail/:id — single payment by PPaymentID (used by ApprovalActions) ──
router.get("/detail/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(404).json({ error: "Not found" });
  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("PPaymentID", sql.Int, id)
      .query(`
        SELECT np.*, eb.EDocNo AS RefDoc, eb.Eid AS PExpenseId,
          COALESCE(brc_list.IsMatched, 0) AS IsMatched,
          COALESCE(brc_list.IsBounced, 0) AS IsBounced,
          CASE
            WHEN EXISTS (SELECT 1 FROM dbo.NewPayment r2 WHERE r2.ReplacesPaymentId = np.PPaymentID AND r2.Status NOT IN ('Rejected','Deleted')) THEN 'Reissued'
            WHEN COALESCE(brc_list.IsBounced, 0) = 1 THEN 'Cheque Bounced'
            WHEN COALESCE(brc_list.IsMatched, 0) = 1 AND np.PMode IN ('Cheque','Post-Dated Cheque') THEN 'Cheque Cleared'
            WHEN np.Status = 'Approved' AND np.PMode IN ('Cheque','Post-Dated Cheque') THEN 'Cheque Issued'
            WHEN np.Status = 'Approved' THEN 'Success'
            WHEN np.Status = 'Pending' THEN 'Pending'
            WHEN np.Status = 'Rejected' THEN 'Failed'
            WHEN np.Status = 'Deleted' THEN 'Cancelled'
            ELSE np.Status
          END AS DisplayStatus
        FROM dbo.NewPayment np
        LEFT JOIN dbo.ExpenseBooking eb ON eb.EDocNo = np.PExpenseRef
        LEFT JOIN dbo.BankReconciliation brc_list
          ON brc_list.SourceType = 'PAYMENT' AND brc_list.SourceID = np.PPaymentID
        WHERE np.PPaymentID = @PPaymentID
      `);
    if (!result.recordset.length) return res.status(404).json({ error: "Payment not found" });
    return res.json(result.recordset[0]);
  } catch (err) {
    console.error("[GET /new-payment/:id]", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── GET /chain/:expenseRef — all payment attempts for one invoice ─────────────
router.get("/chain/:expenseRef", async (req, res) => {
  const expenseRef = req.params.expenseRef;
  if (!expenseRef) return res.status(400).json({ error: "expenseRef is required" });
  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("ExpenseRef", sql.NVarChar(100), expenseRef)
      .query(`
        SELECT
          np.PPaymentID,
          np.DocNo,
          np.PDate,
          np.PAmount,
          np.PMode,
          np.Status,
          np.PChequeNo,
          np.PChequeLotNumber,
          np.PChequeDate,
          np.PChequeIfsc,
          np.PBankName,
          np.PIsChequeCancelled,
          np.ReplacesPaymentId,
          np.BounceCharge,
          np.PCreatedBy,
          np.PCreatedAt,
          np.PApprovedBy,
          -- BRS state
          COALESCE(brc.IsMatched, 0)  AS IsMatched,
          COALESCE(brc.IsBounced, 0)  AS IsBounced,
          brc.BounceDate,
          brc.BounceReason,
          brc.BounceRemarks,
          -- Chain links
          repl.DocNo        AS ReplacementDocNo,
          repl.PPaymentID   AS ReplacementPaymentId,
          orig.DocNo        AS OriginalDocNo,
          -- Computed display status
          CASE
            WHEN EXISTS (
              SELECT 1 FROM dbo.NewPayment r2
              WHERE r2.ReplacesPaymentId = np.PPaymentID
                AND r2.Status NOT IN ('Rejected', 'Deleted')
            ) THEN 'Reissued'
            WHEN COALESCE(brc.IsBounced, 0) = 1
              THEN 'Cheque Bounced'
            WHEN COALESCE(brc.IsMatched, 0) = 1
              AND np.PMode IN ('Cheque', 'Post-Dated Cheque')
              THEN 'Cheque Cleared'
            WHEN np.Status = 'Approved'
              AND np.PMode IN ('Cheque', 'Post-Dated Cheque')
              THEN 'Cheque Issued'
            WHEN np.Status = 'Approved'
              THEN 'Success'
            WHEN np.Status = 'Pending'
              THEN 'Pending'
            WHEN np.Status = 'Rejected'
              THEN 'Failed'
            WHEN np.Status = 'Deleted'
              THEN 'Cancelled'
            ELSE np.Status
          END AS DisplayStatus
        FROM dbo.NewPayment np
        LEFT JOIN dbo.NewPayment repl
          ON  repl.ReplacesPaymentId = np.PPaymentID
          AND repl.Status NOT IN ('Rejected', 'Deleted')
        LEFT JOIN dbo.NewPayment orig
          ON  orig.PPaymentID = np.ReplacesPaymentId
        LEFT JOIN dbo.BankReconciliation brc
          ON  brc.SourceType = 'PAYMENT'
          AND brc.SourceID   = np.PPaymentID
        WHERE np.PExpenseRef = @ExpenseRef
        ORDER BY np.PCreatedAt ASC
      `);

    // Also return the invoice summary from ExpenseBooking
    const ebRes = await pool
      .request()
      .input("EDocNo", sql.NVarChar(100), expenseRef)
      .query(`
        SELECT
          eb.Eid, eb.EDocNo, eb.ENetAmount, eb.EAmount, eb.ESourceType,
          eb.ETotalPaid, eb.ERemainingAmount, eb.EBillStatus,
          COALESCE(proj.name, eb.EProjectName, '') AS ProjectName,
          eb.EName AS PartyName,
          grn.TotalAmount AS GrnTotalAmount
        FROM dbo.ExpenseBooking eb
        LEFT JOIN dbo.enterprise proj ON proj.id = TRY_CAST(eb.EProjectName AS INT)
        LEFT JOIN dbo.GoodsReceiptNotes grn
          ON eb.ESourceType = 'GRN' AND grn.GRNID = TRY_CAST(eb.ESourceId AS INT)
        WHERE eb.EDocNo = @EDocNo
      `);

    res.json({
      invoice: ebRes.recordset[0] ?? null,
      payments: result.recordset,
    });
  } catch (err) {
    console.error("[payment-chain]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Chain-wide Posting: all payments for an invoice ────────────────────────
router.get("/chain-posting/:expenseRef", async (req, res) => {
  const expenseRef = decodeURIComponent(req.params.expenseRef);
  if (!expenseRef) return res.status(400).json({ error: "No expenseRef" });
  try {
    const pool = getPool();

    // All approved payments for this invoice
    const pmtRes = await pool.request()
      .input("PExpenseRef", sql.NVarChar(100), expenseRef)
      .query(`
        SELECT np.PPaymentID, np.DocNo, np.PDate, np.PAmount,
               ISNULL(np.BounceCharge, 0) AS BounceCharge,
               np.PMode, np.Status,
               np.PBankID, np.PBankName,
               bank.LHeadName AS BankLedgerName, bank.LHeadCode AS BankLedgerCode,
               ISNULL(brc.IsBounced, 0) AS IsBounced,
               brc.BounceDate, brc.BounceReason
        FROM dbo.NewPayment np
        LEFT JOIN dbo.AccountHeadMaster bank ON bank.LHeadId = np.PBankID
        LEFT JOIN dbo.BankReconciliation brc
          ON brc.SourceType = 'PAYMENT' AND brc.SourceID = np.PPaymentID
        WHERE np.PExpenseRef = @PExpenseRef AND np.Status = 'Approved'
        ORDER BY np.PDate ASC, np.PPaymentID ASC
      `);

    // Invoice net payable
    const ebRes = await pool.request()
      .input("EDocNo", sql.NVarChar(100), expenseRef)
      .query(`SELECT TOP 1 ENetAmount, EAmount FROM dbo.ExpenseBooking WHERE EDocNo = @EDocNo`);
    const eb = ebRes.recordset[0];
    const invoiceTotal = parseFloat(eb?.ENetAmount ?? eb?.EAmount ?? 0) || 0;

    // GL accounts
    const ledRes = await pool.request().query(`
      SELECT LHeadId, LHeadName, LHeadCode FROM dbo.AccountHeadMaster
      WHERE LHeadStatus = 1 AND (
        (LHeadType = 'GL' AND IsSystemGenerated = 1)
        OR LHeadName LIKE '%Bank Charge%'
        OR LHeadName LIKE '%bank charge%'
      )
    `);
    const leds = ledRes.recordset;
    const findLed = (fn) => { const r = leds.find(fn); return r ? { id: r.LHeadId, label: r.LHeadName, code: r.LHeadCode ?? null } : null; };
    const supplierLed = findLed((l) => l.LHeadName.toLowerCase().includes("supplier") || l.LHeadName.toLowerCase().includes("creditor"));
    const bankChargesLed = findLed((l) => l.LHeadName.toLowerCase().includes("bank charge"));

    // Check posted status for payment and bounce-charge entries
    const pmtIds = pmtRes.recordset.map((p) => p.PPaymentID);
    const postedMap = {};
    const bouncePostedMap = {};
    if (pmtIds.length) {
      const pIds = pmtIds.join(",");
      const postedRes = await pool.request().query(
        `SELECT SourceId, VoucherNo FROM dbo.GeneralLedgerEntry WHERE SourceType='PaymentPosting' AND SourceId IN (${pIds}) AND IsReversed=0`
      );
      postedRes.recordset.forEach((r) => { postedMap[r.SourceId] = r.VoucherNo; });

      const bPostedRes = await pool.request().query(
        `SELECT SourceId, VoucherNo FROM dbo.GeneralLedgerEntry WHERE SourceType='BounceChargePosting' AND SourceId IN (${pIds}) AND IsReversed=0`
      );
      bPostedRes.recordset.forEach((r) => { bouncePostedMap[r.SourceId] = r.VoucherNo; });
    }

    const toDateStr = (v) => {
      if (!v) return null;
      if (v instanceof Date) return v.toISOString().slice(0, 10);
      return String(v).slice(0, 10);
    };

    const entries = [];
    for (const p of pmtRes.recordset) {
      const bankLed = p.PBankID
        ? { id: p.PBankID, label: p.BankLedgerName || p.PBankName, code: p.BankLedgerCode ?? null }
        : null;
      const pmtAmt = parseFloat(p.PAmount) || 0;
      const bounceCharge = parseFloat(p.BounceCharge) || 0;
      const netAmt = Math.max(0, pmtAmt - bounceCharge);

      // Always include payment entry — isBounced flag controls frontend postability
      entries.push({
        date: toDateStr(p.PDate),
        docNo: p.DocNo,
        pmtId: p.PPaymentID,
        type: "payment",
        amount: netAmt,
        mode: p.PMode,
        isBounced: !!p.IsBounced,
        bounceReason: p.BounceReason ?? null,
        accounts: { supplier: supplierLed, bank: bankLed },
        isPosted: !!postedMap[p.PPaymentID],
        jvNo: postedMap[p.PPaymentID] ?? null,
      });

      // Bounce charge: Bank Charges Dr / Bank Cr (on bounce date)
      if (bounceCharge > 0) {
        entries.push({
          date: toDateStr(p.BounceDate) ?? toDateStr(p.PDate),
          docNo: p.DocNo,
          pmtId: p.PPaymentID,
          type: "bounce_charge",
          amount: bounceCharge,
          mode: p.PMode,
          bounceReason: p.BounceReason,
          accounts: { bankCharges: bankChargesLed, bank: bankLed },
          isPosted: !!bouncePostedMap[p.PPaymentID],
          jvNo: bouncePostedMap[p.PPaymentID] ?? null,
        });
      }
    }

    // Sort all entries by date ascending
    entries.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "") || a.pmtId - b.pmtId);

    res.json({ expenseRef, invoiceTotal, entries });
  } catch (err) {
    console.error("Chain posting error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Bounce Charge: post to GL ────────────────────────────────────────────────
router.post("/:id/post-bounce-charge-to-gl", async (req, res) => {
  const pmtId = parseInt(req.params.id, 10);
  if (!pmtId) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const userEmail = req.user?.email || req.user?.upn || "system";
    const { postVoucher } = require("../services/generalLedger");

    const pmtRes = await pool.request().input("PPaymentID", sql.Int, pmtId).query(`
      SELECT np.PPaymentID, np.DocNo, np.PExpenseRef, np.PBankID, np.PBankName,
             ISNULL(np.BounceCharge, 0) AS BounceCharge,
             brc.BounceDate,
             eb.ECompanyId AS CompanyId, TRY_CAST(eb.EProjectName AS INT) AS ProjectId
      FROM dbo.NewPayment np
      LEFT JOIN dbo.ExpenseBooking eb ON eb.EDocNo = np.PExpenseRef
      LEFT JOIN dbo.BankReconciliation brc ON brc.SourceType='PAYMENT' AND brc.SourceID=np.PPaymentID
      WHERE np.PPaymentID = @PPaymentID
    `);
    if (!pmtRes.recordset.length) return res.status(404).json({ error: "Payment not found" });
    const pmt = pmtRes.recordset[0];

    const bounceCharge = parseFloat(pmt.BounceCharge) || 0;
    if (bounceCharge <= 0) return res.status(400).json({ error: "No bounce charge to post." });

    const already = await pool.request().input("SrcId", sql.Int, pmtId)
      .query(`SELECT TOP 1 EntryId FROM dbo.GeneralLedgerEntry WHERE SourceType='BounceChargePosting' AND SourceId=@SrcId AND IsReversed=0`);
    if (already.recordset.length) return res.status(409).json({ error: "Bounce charge already posted." });

    const ledRes = await pool.request().query(`
      SELECT LHeadId, LHeadName FROM dbo.AccountHeadMaster
      WHERE LHeadStatus=1 AND (LHeadName LIKE '%Bank Charge%' OR LHeadName LIKE '%bank charge%')
    `);
    const bankChargesId = ledRes.recordset[0]?.LHeadId;
    if (!bankChargesId) return res.status(422).json({ error: "Bank Charges ledger not configured." });

    const bankId = pmt.PBankID ? parseInt(pmt.PBankID, 10) : null;
    if (!bankId) return res.status(422).json({ error: "No bank account on this payment." });

    const narration = `Bounce charge: ${pmt.DocNo}`;
    const legs = [
      { lHeadId: bankChargesId, debit: bounceCharge, credit: 0, narration },
      { lHeadId: bankId,        debit: 0, credit: bounceCharge, narration },
    ];

    // lockNextDocNumber takes a single options object, not positional args —
    // calling it positionally (as this used to) silently failed every time.
    const { lockNextDocNumber, resolveDocTypeId } = require("../utils/docNumberLock");
    const dtId = await resolveDocTypeId(pool, sql, "JV").catch(() => null);
    const finalDocNo = dtId
      ? await lockNextDocNumber(pool, sql, {
          docTypeId: dtId,
          tableName: "JournalVoucher",
          docNoColumn: "JVNo",
          issuedBy: userEmail,
        }).catch(() => null)
      : null;

    await postVoucher(pool, {
      voucherNo: finalDocNo || `JV-BNC${pmtId}`,
      voucherDate: pmt.BounceDate || new Date(),
      sourceType: "BounceChargePosting",
      sourceId: pmtId,
      companyId: pmt.CompanyId ?? null,
      projectId: pmt.ProjectId ?? null,
      createdBy: userEmail,
      legs,
    });

    res.json({ jvNo: finalDocNo, message: "Bounce charge posted." });
  } catch (err) {
    console.error("Bounce charge posting error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Payment Posting: preview ────────────────────────────────────────────────
router.get("/:id/posting", async (req, res) => {
  const pmtId = parseInt(req.params.id, 10);
  if (!pmtId) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();

    // Payment row + bank ledger
    const pmtRes = await pool.request().input("PPaymentID", sql.Int, pmtId).query(`
      SELECT np.PPaymentID, np.DocNo, np.PAmount, np.PMode, np.PExpenseRef,
             np.PBankID, np.PBankName, np.ContractId, np.PPartyId,
             bank.LHeadName AS BankLedgerName, bank.LHeadCode AS BankLedgerCode,
             np.Status
      FROM dbo.NewPayment np
      LEFT JOIN dbo.AccountHeadMaster bank ON bank.LHeadId = np.PBankID
      WHERE np.PPaymentID = @PPaymentID
    `);
    if (!pmtRes.recordset.length) return res.status(404).json({ error: "Payment not found" });
    const pmt = pmtRes.recordset[0];

    // Determine payment type: "on-account" if no invoice ref, else "direct"
    const isOnAccount = !pmt.PExpenseRef;

    // Invoice details (if linked)
    let invoiceTotal = parseFloat(pmt.PAmount) || 0;
    let supplierName = null;
    if (!isOnAccount) {
      const ebRes = await pool.request().input("EDocNo", sql.NVarChar(100), pmt.PExpenseRef).query(`
        SELECT TOP 1 eb.ENetAmount, eb.EAmount, eb.ESourceType, eb.ESourceId, eb.EName,
                     grn.TotalAmount AS GrnTotalAmount
        FROM dbo.ExpenseBooking eb
        LEFT JOIN dbo.GoodsReceiptNotes grn ON eb.ESourceType='GRN' AND grn.GRNID=TRY_CAST(eb.ESourceId AS INT)
        WHERE eb.EDocNo = @EDocNo
      `);
      if (ebRes.recordset.length) {
        const eb = ebRes.recordset[0];
        supplierName = eb.EName;
        const grnTotal = eb.ESourceType === "GRN" && parseFloat(eb.GrnTotalAmount) > 0
          ? parseFloat(eb.GrnTotalAmount)
          : parseFloat(eb.ENetAmount || eb.EAmount || 0);
        invoiceTotal = grnTotal || parseFloat(pmt.PAmount) || 0;
      }
    }

    // Supplier/Creditor — this payment's own resolved counter-account
    // (Contract → linked ExpenseBooking's supplier → PPartyId), not a
    // system-generated placeholder (there isn't one; every vendor has
    // their own ledger). The row label stays generic; only the LHeadId
    // determines which specific account the posting actually lands in.
    const { resolvePaymentSupplierHeadId } = require("../services/generalLedger");
    const resolvedSupplierId = await resolvePaymentSupplierHeadId(pool, pmt);
    const accounts = {
      supplier: resolvedSupplierId ? { id: resolvedSupplierId, label: "Supplier / Creditor A/c", code: null } : null,
      bank: pmt.PBankID ? { id: pmt.PBankID, label: pmt.BankLedgerName || pmt.PBankName, code: pmt.BankLedgerCode ?? null } : null,
    };

    // Check if already posted
    const postedRes = await pool.request().input("SrcId", sql.Int, pmtId)
      .query(`SELECT TOP 1 EntryId, VoucherNo FROM dbo.GeneralLedgerEntry WHERE SourceType='PaymentPosting' AND SourceId=@SrcId AND IsReversed=0`);
    const isPosted = postedRes.recordset.length > 0;

    res.json({
      isOnAccount,
      amount: parseFloat(pmt.PAmount) || 0,
      invoiceTotal,
      paymentMode: pmt.PMode,
      expenseRef: pmt.PExpenseRef,
      supplierName,
      accounts,
      isPosted,
      jvNo: isPosted ? postedRes.recordset[0].VoucherNo : null,
    });
  } catch (err) {
    console.error("Payment posting preview error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Payment Posting: post to GL ─────────────────────────────────────────────
router.post("/:id/post-to-gl", async (req, res) => {
  const pmtId = parseInt(req.params.id, 10);
  if (!pmtId) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const userEmail = req.user?.email || req.user?.upn || "system";
    const { postVoucher, resolvePaymentSupplierHeadId } = require("../services/generalLedger");

    const pmtRes = await pool.request().input("PPaymentID", sql.Int, pmtId).query(`
      SELECT np.PPaymentID, np.DocNo, np.PAmount, np.PMode, np.PExpenseRef,
             np.PBankID, np.PBankName, np.ContractId, np.PPartyId,
             eb.ECompanyId AS CompanyId, TRY_CAST(eb.EProjectName AS INT) AS ProjectId
      FROM dbo.NewPayment np
      LEFT JOIN dbo.ExpenseBooking eb ON eb.EDocNo = np.PExpenseRef
      WHERE np.PPaymentID = @PPaymentID
    `);
    if (!pmtRes.recordset.length) return res.status(404).json({ error: "Payment not found" });
    const pmt = pmtRes.recordset[0];

    // Already posted?
    const alreadyPosted = await pool.request().input("SrcId", sql.Int, pmtId)
      .query(`SELECT TOP 1 EntryId FROM dbo.GeneralLedgerEntry WHERE SourceType='PaymentPosting' AND SourceId=@SrcId AND IsReversed=0`);
    if (alreadyPosted.recordset.length) return res.status(409).json({ error: "This payment has already been posted to GL." });

    const amount = parseFloat(pmt.PAmount) || 0;
    if (amount <= 0) return res.status(400).json({ error: "No amount to post." });

    // The payment's own resolved counter-account (Contract → linked
    // ExpenseBooking's supplier → PPartyId) — not a system-generated
    // "supplier"/"creditor" placeholder, which doesn't exist.
    const supplierId = await resolvePaymentSupplierHeadId(pool, pmt);
    const bankId = pmt.PBankID ? parseInt(pmt.PBankID, 10) : null;

    if (!supplierId) return res.status(422).json({ error: "Could not resolve this payment's supplier/party account." });
    if (!bankId) return res.status(422).json({ error: "No bank account linked to this payment." });

    const narrationRef = pmt.PExpenseRef ? `${pmt.DocNo} (${pmt.PExpenseRef})` : pmt.DocNo;
    const legs = [
      { lHeadId: supplierId, debit: amount, credit: 0, narration: `Payment: ${narrationRef} — Supplier/Creditor` },
      { lHeadId: bankId,     debit: 0, credit: amount, narration: `Payment: ${narrationRef} — Bank (${pmt.PBankName || pmt.PMode})` },
    ];

    // lockNextDocNumber takes a single options object, not positional args —
    // calling it positionally (as this used to) silently failed every time,
    // leaving VoucherNo as undefined and the frontend showing "Posted as ."
    const { lockNextDocNumber, resolveDocTypeId } = require("../utils/docNumberLock");
    const dtId = await resolveDocTypeId(pool, sql, "JV").catch(() => null);
    const finalDocNo = dtId
      ? await lockNextDocNumber(pool, sql, {
          docTypeId: dtId,
          tableName: "JournalVoucher",
          docNoColumn: "JVNo",
          issuedBy: userEmail,
        }).catch(() => null)
      : null;

    await postVoucher(pool, {
      voucherNo: finalDocNo || `JV-PMT${pmtId}`,
      voucherDate: new Date(),
      sourceType: "PaymentPosting",
      sourceId: pmtId,
      companyId: pmt.CompanyId ?? null,
      projectId: pmt.ProjectId ?? null,
      createdBy: userEmail,
      legs,
    });

    res.json({ jvNo: finalDocNo, message: "Posted successfully." });
  } catch (err) {
    console.error("Payment post-to-gl error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.syncBillStatus = syncBillStatus;

