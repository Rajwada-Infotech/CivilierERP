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

// GET all payments
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

// POST - Create payment
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
  } = req.body;

  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;

    const pool = getPool();
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
      .input("PCreatedAt", sql.DateTime, new Date())
      .input("PCreatedBy", sql.NVarChar(100), userEmail)
      .input("PApprovedBy", sql.NVarChar(100), null).query(`
        INSERT INTO dbo.NewPayment (
          PPaymentName, PMode, PAmount, PDocType, PDate,
          PBankID, PBankName, PProject, PCompany, PExpenseRef,
          PCreatedAt, PCreatedBy, PApprovedBy
        ) VALUES (
          @PPaymentName, @PMode, @PAmount, @PDocType, @PDate,
          @PBankID, @PBankName, @PProject, @PCompany, @PExpenseRef,
          @PCreatedAt, @PCreatedBy, @PApprovedBy
        )
      `);
    await bumpCacheVersion("new-payment");
    res.json({ message: "Payment added successfully" });
  } catch (err) {
    console.error("PAYMENT INSERT ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT - Update payment
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
      .input("PUpdatedBy", sql.NVarChar(100), userEmail).query(`
        UPDATE dbo.NewPayment SET
          PPaymentName=@PPaymentName, PMode=@PMode,
          PAmount=@PAmount, PDocType=@PDocType, PDate=@PDate,
          PBankID=@PBankID, PBankName=@PBankName,
          PProject=@PProject, PCompany=@PCompany,
          PExpenseRef=@PExpenseRef
        WHERE PPaymentID=@PPaymentID
      `);
    await bumpCacheVersion("new-payment");
    res.json({ message: "Payment updated successfully" });
  } catch (err) {
    console.error("PAYMENT UPDATE ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE - Remove payment
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

    // If this payment is linked to an EMI installment ref (e.g. CI/WO/000001/2025-2026-EMI-01),
    // mark that installment as Paid in dbo.EmiInstallments so the EMI schedule reflects it.
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
        // Also sync EEmiData JSON on the parent ExpenseBooking
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
      // Non-critical — don't fail the approval if EMI sync fails
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
