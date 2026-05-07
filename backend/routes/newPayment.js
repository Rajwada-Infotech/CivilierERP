const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const { transition } = require("../services/approvalService");

const requireUserEmail = (req, res) => {
  const email = req.user?.email;
  if (!email) {
    res.status(401).json({ error: "User context missing" });
    return null;
  }
  return email;
};

// ── GET all payments ──────────────────────────────────────────────────────────
router.get("/", cache("new-payment", 300), async (req, res) => {
  try {
    const pool = getPool();
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 100);
    const offset = (page - 1) * limit;

    const countResult = await pool
      .request()
      .query("SELECT COUNT(*) AS total FROM dbo.NewPayment");
    const total = parseInt(countResult.recordset[0].total);

    const result = await pool
      .request()
      .input("offset", sql.Int, offset)
      .input("limit", sql.Int, limit).query(`
        SELECT * FROM dbo.NewPayment
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
router.post("/", async (req, res) => {
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

    // Determine Status: digital modes start as Pending (submitted for approval),
    // all others start as Draft.
    const digitalModes = ["NEFT", "UPI", "RTGS", "IMPS"];
    const initialStatus = digitalModes.includes(PMode) ? "Pending" : "Draft";

    await pool
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
          PCreatedAt, PCreatedBy, PApprovedBy, Status
        ) VALUES (
          @PPaymentName, @PMode, @PAmount, @PDocType, @PDate,
          @PBankID, @PBankName, @PProject, @PCompany, @PExpenseRef,
          @PChequeNo, @PChequeLotId, @PChequeLotNumber, @PChequeDate,
          @PChequeAccountNumber, @PChequeIfsc, @PIsPostDated,
          @PNeftNumber, @PUpiTransactionId, @PRtgsReference, @PImpsReference,
          @PCreatedAt, @PCreatedBy, @PApprovedBy, @Status
        )
      `);

    await bumpCacheVersion("new-payment");
    res.json({ message: "Payment added successfully" });
  } catch (err) {
    console.error("PAYMENT INSERT ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /:id — Update payment ─────────────────────────────────────────────────
router.put("/:id", async (req, res) => {
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
    await bumpCacheVersion("payments");
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

    await bumpCacheVersion("new-payment");
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
    await bumpCacheVersion("payments");
    res.json({ message: "Payment rejected", ...result });
  } catch (err) {
    console.error("Payment reject error:", err.message);
    const status = err.message.includes("not authorized") ? 403 : 400;
    res.status(status).json({ error: err.message });
  }
});

module.exports = router;
