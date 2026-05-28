const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const { transition } = require("../services/approvalService");
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
    const search = req.query.supplier ? req.query.supplier.trim() : "";
    const companyId = req.query.company ? req.query.company.trim() : "";
    const project = req.query.project ? req.query.project.trim() : "";
    const finYear = req.query.finYear ? req.query.finYear.trim() : "";
    const docNumber = req.query.docNumber ? req.query.docNumber.trim() : "";
    const docDate = req.query.docDate ? req.query.docDate.trim() : "";
    const dateParam = req.query.date ? req.query.date.trim() : "";
    const dueDate = req.query.dueDate ? req.query.dueDate.trim() : "";
    const remarks = req.query.remarks ? req.query.remarks.trim() : "";

    const conditions = [];
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
      SELECT * FROM dbo.NewPayment
      ${whereClause}
      ORDER BY PPaymentID DESC
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

// ── GET /cheque-lots — fetch active lots, optionally filtered by bankId ────────
router.get("/cheque-lots", async (req, res) => {
  try {
    const pool = getPool();
    const bankId = req.query.bankId ? parseInt(req.query.bankId) : null;

    const request = pool.request();
    let whereClause = "WHERE cm.Status = 1 AND cm.TotalCheques > 0"; // TotalCheques is computed (ChequeEndNumber - ChequeStartNumber + 1), read-only OK
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
        cm.TotalCheques,
        cm.BankId,
        bm.BName        AS BankName,
        bm.BBranch      AS BankBranch,
        bm.BAccountType AS BankAccountType,
        cm.Remarks,
        -- Compute actually remaining based on NewPayment usage
        cm.TotalCheques - ISNULL((
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
router.post("/deduct-cheque", async (req, res) => {
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
router.post("/", validateBody(paymentBodySchema), async (req, res) => {
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
  } = req.body;

  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;

    const pool = getPool();
    const prefix = rootExBDocNo ? "ExB-PAY" : "PAY";
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

    // Determine Status: digital modes start as Pending (submitted for approval),
    // all others start as Draft.
    const digitalModes = ["NEFT", "UPI", "RTGS", "IMPS"];
    const initialStatus = digitalModes.includes(PMode) ? "Pending" : "Draft";

    const insertResult = await pool
      .request()
      .input("PPaymentName", sql.VarChar, PPaymentName || "")
      .input("PMode", sql.VarChar, PMode || "")
      .input("PAmount", sql.Decimal(18, 2), PAmount || null)
      .input("PDocType", sql.VarChar, PDocType || "N/A")
      .input("PDate", sql.Date, PDate || null)
      .input("PBankID", sql.Int, PBankID || null)
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
          PNeftNumber, PUpiTransactionId, PRtgsReference, PImpsReference,
          DocNo, DocTypeId, DocYear, DocSerial, ParentDocNo, RootExBDocNo,
          PCreatedAt, PCreatedBy, PApprovedBy, Status
        )
        OUTPUT INSERTED.PPaymentID
        VALUES (
          @PPaymentName, @PMode, @PAmount, @PDocType, @PDate,
          @PBankID, @PBankName, @PProject, @PCompany, @PExpenseRef,
          @PChequeNo, @PChequeLotId, @PChequeLotNumber, @PChequeDate,
          @PChequeAccountNumber, @PChequeIfsc, @PIsPostDated,
          @PNeftNumber, @PUpiTransactionId, @PRtgsReference, @PImpsReference,
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
    console.error("PAYMENT INSERT ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /:id — Update payment ─────────────────────────────────────────────────
router.put("/:id", validateBody(paymentBodySchema), async (req, res) => {
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
  } = req.body;

  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;

    const pool = getPool();
    await pool
      .request()
      .input("PPaymentID", sql.Int, id)
      .input("PPaymentName", sql.VarChar, PPaymentName || "")
      .input("PMode", sql.VarChar, PMode || "")
      .input("PAmount", sql.Decimal(18, 2), PAmount || null)
      .input("PDocType", sql.VarChar, PDocType || "N/A")
      .input("PDate", sql.Date, PDate || null)
      .input("PBankID", sql.Int, PBankID || null)
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
          PImpsReference       = @PImpsReference
        WHERE PPaymentID = @PPaymentID
      `);

    await bumpCacheVersion("new-payment");
    res.json({ message: "Payment updated successfully" });
  } catch (err) {
    console.error("PAYMENT UPDATE ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /:id ───────────────────────────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("PPaymentID", sql.Int, id)
      .query("DELETE FROM dbo.NewPayment WHERE PPaymentID=@PPaymentID");
    await bumpCacheVersion("new-payment");
    res.json({ message: "Payment deleted successfully" });
  } catch (err) {
    console.error("PAYMENT DELETE ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /:id/submit — Draft → Pending ─────────────────────────────────────────
router.put("/:id/submit", async (req, res) => {
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
    await bumpCacheVersion("new-payment");
    res.json({ message: "Payment submitted for approval", ...result });
  } catch (err) {
    console.error("Payment submit error:", err.message);
    res.status(400).json({ error: err.message });
  }
});

// ── PUT /:id/approve — Pending → Approved ─────────────────────────────────────
router.put("/:id/approve", async (req, res) => {
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
router.put("/:id/reject", async (req, res) => {
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

module.exports = router;
