const express = require("express");
const router = express.Router();
const { poolPromise, sql } = require("../db");
const { authenticateToken } = require("../middleware/auth");

router.get("/", async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const offset = (page - 1) * limit;
    const pool = await poolPromise;
    const countResult = await pool.request().query(`SELECT COUNT(*) AS total FROM dbo.ReceivedPayment`);
    const total = countResult.recordset[0].total;
    const result = await pool.request()
      .input("offset", sql.Int, offset)
      .input("limit",  sql.Int, limit)
      .query(`
        SELECT RPPaymentID, RPCompanyName, RPReceivedFrom, RPProjectName,
          RPDocDate, RPMode, RPAmount, RPBankName, RPTransactionId, RPCheckNumber,
          RPRemarks, RPIsEmi, RPEmiTotal, RPEmiMonths, RPEmiStartDate,
          RPEmiSchedule, RPEmiPaying, RPStatus, RPCreatedBy, RPCreatedAt,
          RPUpdatedBy, RPUpdatedAt, RPApprovedBy, RPApprovedAt,
          RPRejectedBy, RPRejectedAt, RPRejectionNote
        FROM dbo.ReceivedPayment
        ORDER BY RPCreatedAt DESC
        OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
      `);
    res.json({ data: result.recordset, page, totalPages: Math.ceil(total / limit), total });
  } catch (err) {
    console.error("GET /received-payment error:", err);
    res.status(500).json({ error: "Failed to fetch received payments" });
  }
});

router.post("/", async (req, res) => {
  try {
    const { RPCompanyName, RPReceivedFrom, RPProjectName, RPDocDate, RPMode, RPAmount,
      RPBankName, RPTransactionId, RPCheckNumber, RPRemarks,
      RPIsEmi, RPEmiTotal, RPEmiMonths, RPEmiStartDate, RPEmiSchedule, RPEmiPaying } = req.body;
    const createdBy = req.user?.name || req.user?.email || null;
    const pool = await poolPromise;
    const result = await pool.request()
      .input("RPCompanyName",   sql.NVarChar(255), RPCompanyName  || null)
      .input("RPReceivedFrom",  sql.NVarChar(255), RPReceivedFrom || "")
      .input("RPProjectName",   sql.NVarChar(255), RPProjectName  || "")
      .input("RPDocDate",       sql.Date,          RPDocDate      || null)
      .input("RPMode",          sql.NVarChar(50),  RPMode         || "Cash")
      .input("RPAmount",        sql.Decimal(18,2), Number(RPAmount) || 0)
      .input("RPBankName",      sql.NVarChar(255), RPBankName     || null)
      .input("RPTransactionId", sql.NVarChar(255), RPTransactionId|| null)
      .input("RPCheckNumber",   sql.NVarChar(100), RPCheckNumber  || null)
      .input("RPRemarks",       sql.NVarChar(sql.MAX), RPRemarks  || null)
      .input("RPIsEmi",         sql.Bit,           RPIsEmi ? 1 : 0)
      .input("RPEmiTotal",      sql.Decimal(18,2), RPEmiTotal     || null)
      .input("RPEmiMonths",     sql.Int,           RPEmiMonths    || null)
      .input("RPEmiStartDate",  sql.NVarChar(30),  RPEmiStartDate || null)
      .input("RPEmiSchedule",   sql.NVarChar(sql.MAX), RPEmiSchedule ? JSON.stringify(RPEmiSchedule) : null)
      .input("RPEmiPaying",     sql.NVarChar(sql.MAX), RPEmiPaying ? JSON.stringify(RPEmiPaying) : null)
      .input("RPCreatedBy",     sql.NVarChar(100), createdBy)
      .query(`
        INSERT INTO dbo.ReceivedPayment (
          RPCompanyName, RPReceivedFrom, RPProjectName, RPDocDate, RPMode, RPAmount,
          RPBankName, RPTransactionId, RPCheckNumber, RPRemarks,
          RPIsEmi, RPEmiTotal, RPEmiMonths, RPEmiStartDate, RPEmiSchedule, RPEmiPaying,
          RPStatus, RPCreatedBy, RPCreatedAt
        ) OUTPUT INSERTED.* VALUES (
          @RPCompanyName, @RPReceivedFrom, @RPProjectName, @RPDocDate, @RPMode, @RPAmount,
          @RPBankName, @RPTransactionId, @RPCheckNumber, @RPRemarks,
          @RPIsEmi, @RPEmiTotal, @RPEmiMonths, @RPEmiStartDate, @RPEmiSchedule, @RPEmiPaying,
          'Draft', @RPCreatedBy, GETDATE()
        )
      `);
    res.status(201).json(result.recordset[0]);
  } catch (err) {
    console.error("POST /received-payment error:", err);
    res.status(500).json({ error: "Failed to create received payment" });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { RPCompanyName, RPReceivedFrom, RPProjectName, RPDocDate, RPMode, RPAmount,
      RPBankName, RPTransactionId, RPCheckNumber, RPRemarks,
      RPIsEmi, RPEmiTotal, RPEmiMonths, RPEmiStartDate, RPEmiSchedule, RPEmiPaying } = req.body;
    const updatedBy = req.user?.name || req.user?.email || null;
    const pool = await poolPromise;
    const result = await pool.request()
      .input("id",              sql.Int,           id)
      .input("RPCompanyName",   sql.NVarChar(255), RPCompanyName  || null)
      .input("RPReceivedFrom",  sql.NVarChar(255), RPReceivedFrom || "")
      .input("RPProjectName",   sql.NVarChar(255), RPProjectName  || "")
      .input("RPDocDate",       sql.Date,          RPDocDate      || null)
      .input("RPMode",          sql.NVarChar(50),  RPMode         || "Cash")
      .input("RPAmount",        sql.Decimal(18,2), Number(RPAmount) || 0)
      .input("RPBankName",      sql.NVarChar(255), RPBankName     || null)
      .input("RPTransactionId", sql.NVarChar(255), RPTransactionId|| null)
      .input("RPCheckNumber",   sql.NVarChar(100), RPCheckNumber  || null)
      .input("RPRemarks",       sql.NVarChar(sql.MAX), RPRemarks  || null)
      .input("RPIsEmi",         sql.Bit,           RPIsEmi ? 1 : 0)
      .input("RPEmiTotal",      sql.Decimal(18,2), RPEmiTotal     || null)
      .input("RPEmiMonths",     sql.Int,           RPEmiMonths    || null)
      .input("RPEmiStartDate",  sql.NVarChar(30),  RPEmiStartDate || null)
      .input("RPEmiSchedule",   sql.NVarChar(sql.MAX), RPEmiSchedule ? JSON.stringify(RPEmiSchedule) : null)
      .input("RPEmiPaying",     sql.NVarChar(sql.MAX), RPEmiPaying ? JSON.stringify(RPEmiPaying) : null)
      .input("RPUpdatedBy",     sql.NVarChar(150), updatedBy)
      .query(`
        UPDATE dbo.ReceivedPayment SET
          RPCompanyName=@RPCompanyName, RPReceivedFrom=@RPReceivedFrom,
          RPProjectName=@RPProjectName, RPDocDate=@RPDocDate, RPMode=@RPMode,
          RPAmount=@RPAmount, RPBankName=@RPBankName, RPTransactionId=@RPTransactionId,
          RPCheckNumber=@RPCheckNumber, RPRemarks=@RPRemarks, RPIsEmi=@RPIsEmi,
          RPEmiTotal=@RPEmiTotal, RPEmiMonths=@RPEmiMonths, RPEmiStartDate=@RPEmiStartDate,
          RPEmiSchedule=@RPEmiSchedule, RPEmiPaying=@RPEmiPaying,
          RPUpdatedBy=@RPUpdatedBy, RPUpdatedAt=GETDATE()
        OUTPUT INSERTED.* WHERE RPPaymentID=@id
      `);
    if (result.recordset.length === 0) return res.status(404).json({ error: "Not found" });
    res.json(result.recordset[0]);
  } catch (err) {
    console.error("PUT /received-payment error:", err);
    res.status(500).json({ error: "Failed to update" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const pool = await poolPromise;
    await pool.request().input("id", sql.Int, id)
      .query(`DELETE FROM dbo.ReceivedPayment WHERE RPPaymentID=@id`);
    res.json({ success: true });
  } catch (err) {
    console.error("DELETE /received-payment error:", err);
    res.status(500).json({ error: "Failed to delete" });
  }
});

router.patch("/:id/approve", async (req, res) => {
  try {
    const { id } = req.params;
    const { action, rejectionNote } = req.body;
    const actor = req.user?.name || req.user?.email || null;
    const pool = await poolPromise;
    if (action === "approve") {
      await pool.request().input("id", sql.Int, id).input("by", sql.NVarChar(150), actor)
        .query(`UPDATE dbo.ReceivedPayment SET RPStatus='Approved', RPApprovedBy=@by, RPApprovedAt=GETDATE() WHERE RPPaymentID=@id`);
    } else {
      await pool.request().input("id", sql.Int, id).input("by", sql.NVarChar(150), actor)
        .input("note", sql.NVarChar(500), rejectionNote || null)
        .query(`UPDATE dbo.ReceivedPayment SET RPStatus='Rejected', RPRejectedBy=@by, RPRejectedAt=GETDATE(), RPRejectionNote=@note WHERE RPPaymentID=@id`);
    }
    res.json({ success: true });
  } catch (err) {
    console.error("PATCH approve error:", err);
    res.status(500).json({ error: "Approval failed" });
  }
});

module.exports = router;
