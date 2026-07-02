const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, validate: false }));
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

// ── syncBillStatus — recalculate and persist EBillStatus on ExpenseBooking ────
// Called after any payment is created or approved against an expense booking.
// Matches via PExpenseRef = EDocNo (approved payments only).
async function syncBillStatus(pool, expenseRef) {
  if (!expenseRef) return;
  try {
    // Find the matching ExpenseBooking by EDocNo
    const ebRes = await pool
      .request()
      .input("EDocNo", sql.NVarChar(100), expenseRef)
      .query(
        "SELECT Eid, ENetAmount, EAmount FROM dbo.ExpenseBooking WHERE EDocNo = @EDocNo",
      );
    if (!ebRes.recordset.length) return;

    const { Eid, ENetAmount, EAmount } = ebRes.recordset[0];
    const netAmount = parseFloat(ENetAmount ?? EAmount ?? 0) || 0;

    // Sum only Approved payments
    const payRes = await pool
      .request()
      .input("PExpenseRef", sql.NVarChar(100), expenseRef)
      .query(
        "SELECT ISNULL(SUM(PAmount), 0) AS TotalPaid FROM dbo.NewPayment WHERE PExpenseRef = @PExpenseRef AND Status = 'Approved'",
      );
    const totalPaid = parseFloat(payRes.recordset[0].TotalPaid) || 0;
    const remaining = Math.max(0, netAmount - totalPaid);

    let billStatus;
    if (totalPaid <= 0) {
      billStatus = "Payment Due";
    } else if (totalPaid >= netAmount) {
      billStatus = "Paid";
    } else {
      billStatus = "Partially Paid";
    }

    await pool
      .request()
      .input("Eid", sql.Int, Eid)
      .input("EBillStatus", sql.NVarChar(20), billStatus)
      .input("ETotalPaid", sql.Decimal(18, 2), totalPaid)
      .input("ERemainingAmount", sql.Decimal(18, 2), remaining)
      .query(
        "UPDATE dbo.ExpenseBooking SET EBillStatus=@EBillStatus, ETotalPaid=@ETotalPaid, ERemainingAmount=@ERemainingAmount WHERE Eid=@Eid",
      );

    await bumpCacheVersion("expense-booking");
  } catch (err) {
    console.warn("syncBillStatus failed:", err.message);
  }
}

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

    const conditions = [];
    if (idFilter) conditions.push(`PPaymentID = @idFilter`);
    if (search) {
      conditions.push(`(PPaymentName LIKE @search
          OR DocNo LIKE @search
          OR PExpenseRef LIKE @search
          OR PProject LIKE @search
          OR PCompany LIKE @search
          OR PBankName LIKE @search)`);
    }
    if (companyId) conditions.push(`PCompany = @companyId`);
    if (project) conditions.push(`PProject LIKE @project`);
    if (finYear) conditions.push(`DocYear  = @finYear`);
    if (docNumber) conditions.push(`DocNo LIKE @docNumber`);
    if (docDate) conditions.push(`CAST(PCreatedAt AS DATE) = @docDate`);
    if (dateParam) conditions.push(`PDate = @dateParam`);
    if (dueDate) conditions.push(`PChequeDate = @dueDate`);
    if (remarks)
      conditions.push(
        `(PPaymentName LIKE @remarks OR PExpenseRef LIKE @remarks)`,
      );

    const whereClause = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    const request = pool.request();
    if (idFilter) request.input("idFilter", sql.Int, idFilter);
    if (search) request.input("search", sql.NVarChar(200), `%${search}%`);
    if (companyId) request.input("companyId", sql.NVarChar(50), companyId);
    if (project) request.input("project", sql.NVarChar(200), `%${project}%`);
    if (finYear) request.input("finYear", sql.SmallInt, parseInt(finYear));
    if (docNumber)
      request.input("docNumber", sql.NVarChar(100), `%${docNumber}%`);
    if (docDate) request.input("docDate", sql.Date, docDate);
    if (dateParam) request.input("dateParam", sql.Date, dateParam);
    if (dueDate) request.input("dueDate", sql.Date, dueDate);
    if (remarks) request.input("remarks", sql.NVarChar(200), `%${remarks}%`);

    const countResult = await request.query(
      `SELECT COUNT(*) AS total FROM dbo.NewPayment ${whereClause}`,
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
    if (finYear) dataRequest.input("finYear", sql.SmallInt, parseInt(finYear));
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
        -- Supplier name from ExpenseBooking resolved chain
        CASE
          WHEN eb.ESourceType = 'GRN' THEN grn_sup.LHeadName
          WHEN eb.ESourceType = 'PO'  THEN po_sup.LHeadName
          ELSE grn2_sup.LHeadName
        END                                                AS PSupplierName,
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
        ISNULL(eb.EFinYear, '')                            AS EBFinYear,
        -- Ref Doc = the ExpenseBooking DocNo
        eb.EDocNo                                          AS RefDoc,
        -- EB DocDate for reference
        eb.EDocDate                                        AS EBDocDate,
        -- Card display info (last 4 digits + network) when PCardId is set
        cmast.card_number                                  AS PCardNumber,
        cmast.card_network                                 AS PCardNetwork,
        cmast.card_holder_name                              AS PCardHolderName
      FROM dbo.NewPayment np
      LEFT JOIN dbo.ExpenseBooking eb ON eb.EDocNo = np.PExpenseRef
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
        -- Remaining: explicit arithmetic avoids computed-column resolution issues
        (cm.ChequeEndNumber - cm.ChequeStartNumber + 1) - ISNULL((
          SELECT COUNT(*) FROM dbo.NewPayment np
          WHERE np.PChequeLotId = cm.CId AND np.PChequeNo IS NOT NULL
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

    const { ChequeStartNumber, ChequeEndNumber } = lotRes.recordset[0];

    // Fetch all cheque numbers already used from this lot in NewPayment
    const usedRes = await pool.request().input("PChequeLotId", sql.Int, lotId)
      .query(`
      SELECT PChequeNo FROM dbo.NewPayment
      WHERE PChequeLotId = @PChequeLotId AND PChequeNo IS NOT NULL
    `);
    const usedSet = new Set(usedRes.recordset.map((r) => String(r.PChequeNo)));

    // Build list of all cheque numbers in range
    const cheques = [];
    for (let n = ChequeStartNumber; n <= ChequeEndNumber; n++) {
      cheques.push({ number: String(n), used: usedSet.has(String(n)) });
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

    const lot = lotRes.recordset[0];
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
      `);

    if (dupRes.recordset[0].cnt > 0) {
      return res
        .status(409)
        .json({ error: "Cheque number already used in another payment" });
    }

    // Count remaining available cheques
    const usedRes = await pool.request().input("PChequeLotId", sql.Int, lotId)
      .query(`
      SELECT COUNT(*) AS usedCount FROM dbo.NewPayment
      WHERE PChequeLotId = @PChequeLotId AND PChequeNo IS NOT NULL
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
  } = req.body;

  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;

    const pool = getPool();

    // Enforce: a payment can only be made against an Approved Expense Booking.
    if (PExpenseRef) {
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

    // All new payments auto-submit to Pending for approval — no manual submit step.
    const initialStatus = "Pending";

    const insertResult = await pool
      .request()
      .input("PPaymentName", sql.VarChar, PPaymentName || "")
      .input("PMode", sql.VarChar, PMode || "")
      .input("PAmount", sql.Decimal(18, 2), PAmount != null ? Number(PAmount) : null)
      .input("PDocType", sql.VarChar, PDocType || "N/A")
      .input("PDate", sql.Date, PDate || null)
      .input("PBankID", sql.Int, normalizeBankId(PBankID))
      .input("PBankName", sql.VarChar, PBankName || "N/A")
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
      .input("ParentDocNo", sql.NVarChar(100), parentDocNo || null)
      .input("RootExBDocNo", sql.NVarChar(100), rootExBDocNo || null)
      // Audit
      .input("PCreatedAt", sql.DateTime, new Date())
      .input("PCreatedBy", sql.NVarChar(100), userEmail)
      .input("PApprovedBy", sql.NVarChar(100), null)
      .input("Status", sql.NVarChar(20), initialStatus).query(`
        INSERT INTO dbo.NewPayment (
          PPaymentName, PMode, PAmount, PDocType, PDate,
          PBankID, PBankName, PProject, PCompany, PExpenseRef,
          PChequeNo, PChequeLotId, PChequeLotNumber, PChequeDate,
          PChequeAccountNumber, PChequeIfsc, PIsPostDated,
          PNeftNumber, PUpiTransactionId, PRtgsReference, PImpsReference, PCardReference, PCardId,
          DocNo, DocTypeId, DocYear, DocSerial, ParentDocNo, RootExBDocNo,
          PCreatedAt, PCreatedBy, PApprovedBy, Status
        )
        OUTPUT INSERTED.PPaymentID
        VALUES (
          @PPaymentName, @PMode, @PAmount, @PDocType, @PDate,
          @PBankID, @PBankName, @PProject, @PCompany, @PExpenseRef,
          @PChequeNo, @PChequeLotId, @PChequeLotNumber, @PChequeDate,
          @PChequeAccountNumber, @PChequeIfsc, @PIsPostDated,
          @PNeftNumber, @PUpiTransactionId, @PRtgsReference, @PImpsReference, @PCardReference, @PCardId,
          @DocNo, @DocTypeId, @DocYear, @DocSerial, @ParentDocNo, @RootExBDocNo,
          @PCreatedAt, @PCreatedBy, @PApprovedBy, @Status
        )
      `);

    const newId = insertResult.recordset[0]?.PPaymentID;
    await backPatchRecordId(pool, sql, finalDocNo, "NewPayment", newId);

    // Sync bill status on the referenced expense booking
    if (PExpenseRef) await syncBillStatus(pool, PExpenseRef);

    await bumpCacheVersion("new-payment");
    res.json({
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

    await pool
      .request()
      .input("PPaymentID", sql.Int, id)
      .input("PPaymentName", sql.VarChar, PPaymentName || "")
      .input("PMode", sql.VarChar, PMode || "")
      .input("PAmount", sql.Decimal(18, 2), PAmount != null ? Number(PAmount) : null)
      .input("PDocType", sql.VarChar, PDocType || "N/A")
      .input("PDate", sql.Date, PDate || null)
      .input("PBankID", sql.Int, normalizeBankId(PBankID))
      .input("PBankName", sql.VarChar, PBankName || "N/A")
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
      .input("PUpdatedBy", sql.NVarChar(100), userEmail).query(`
        UPDATE dbo.NewPayment SET
          PPaymentName         = @PPaymentName,
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
          PCardId              = @PCardId
        WHERE PPaymentID = @PPaymentID
      `);

    // Sync bill status since amount may have changed
    const updatedRef = await pool.request().input("id", sql.Int, id)
      .query("SELECT PExpenseRef FROM dbo.NewPayment WHERE PPaymentID = @id");
    if (updatedRef.recordset[0]?.PExpenseRef) {
      await syncBillStatus(pool, updatedRef.recordset[0].PExpenseRef);
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
    if (expenseRef) await syncBillStatus(pool, expenseRef);
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

    // Sync bill status on approval — fetch PExpenseRef and recalculate
    try {
      const approvedPayRec = await pool
        .request()
        .input("PPaymentID", sql.Int, id)
        .query(
          "SELECT PExpenseRef FROM dbo.NewPayment WHERE PPaymentID = @PPaymentID",
        );
      const approvedRef = approvedPayRec.recordset[0]?.PExpenseRef;
      if (approvedRef && !/-EMI-\d+$/.test(approvedRef)) {
        await syncBillStatus(pool, approvedRef);
      } else if (approvedRef && /-EMI-\d+$/.test(approvedRef)) {
        // For EMI payments, sync the parent booking by matching EDocNo prefix
        const parentRef = approvedRef.replace(/-EMI-\d+$/, "");
        await syncBillStatus(pool, parentRef);
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
        CASE
          WHEN eb.ESourceType = 'GRN' THEN grn_sup.LHeadName
          WHEN eb.ESourceType = 'PO'  THEN po_sup.LHeadName
          ELSE grn2_sup.LHeadName
        END                                                AS PSupplierName,
        ISNULL(eb.ENetAmount, eb.EAmount)                  AS EBNetPayable,
        CASE
          WHEN eb.ENetAmount IS NOT NULL AND eb.EAmount IS NOT NULL
          THEN ROUND(eb.ENetAmount - eb.EAmount, 2)
          ELSE 0
        END                                                AS TaxAmount,
        ISNULL(eb.EAmount, 0)                              AS TaxableAmount,
        ISNULL(eb.EFinYear, '')                            AS EBFinYear,
        eb.EDocNo                                          AS RefDoc,
        eb.EDocDate                                        AS EBDocDate,
        eb.ERemarks                                        AS EBDescription,
        cmast.card_number                                  AS PCardNumber,
        cmast.card_network                                 AS PCardNetwork,
        cmast.card_holder_name                             AS PCardHolderName,
        ahm.LHeadName                                      AS BankAccountName
      FROM dbo.NewPayment np
      LEFT JOIN dbo.ExpenseBooking eb ON eb.EDocNo = np.PExpenseRef
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

module.exports = router;

