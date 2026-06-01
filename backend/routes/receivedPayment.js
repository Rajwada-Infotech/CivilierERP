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
const { checkPermissionForMethod } = require("../middleware/routePermission");

router.use(checkPermissionForMethod("Finance", "ReceivedPayments"));

// -- Helpers --------------------------------------------------------------------

// -- GET / ----------------------------------------------------------------------
router.get("/", cache("received-payment", 30), async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const offset = (page - 1) * limit;
    const pool = getPool();
    // All new schema columns always present (migration 017+)
    const result = await pool
      .request()
      .input("offset", sql.Int, offset)
      .input("limit", sql.Int, limit).query(`
        SELECT
          RPPaymentID, RPCompanyName, RPReceivedFrom, RPProjectName,
          RPDocDate, RPMode, RPAmount, RPBankName, RPTransactionId, RPCheckNumber,
          RPRemarks, RPIsEmi, RPEmiTotal, RPEmiMonths, RPEmiStartDate,
          RPEmiSchedule, RPEmiPaying, RPStatus, RPCreatedBy, RPCreatedAt,
          RPUpdatedBy, RPUpdatedAt, RPApprovedBy, RPApprovedAt,
          RPRejectedBy, RPRejectedAt, RPRejectionNote,
          RPDocNo, RPFinYear, RPDocTypeId, RPCompanyId, RPProjectId,
          RPCustomerName, RPDepositBankId, RPDepositBankName,
          COUNT(*) OVER() AS _total
        FROM dbo.ReceivedPayment
        ORDER BY RPCreatedAt DESC
        OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
      `);

    const rows = result.recordset;
    const total = rows.length > 0 ? rows[0]._total : 0;
    // Strip the internal _total column from each row before sending
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

// -- POST / --------------------------------------------------------------------
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
      RPTransactionId,
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
      .input("RPTransactionId", sql.NVarChar(255), RPTransactionId || null)
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
      .input("RPCreatedBy", sql.NVarChar(100), createdBy);

    req2
      .input("RPDocNo", sql.NVarChar(100), finalDocNo || null)
      .input("RPFinYear", sql.NVarChar(20), RPFinYear || null)
      .input("RPDocTypeId", sql.Int, RPDocTypeId || null)
      .input("RPCompanyId", sql.Int, RPCompanyId || null)
      .input("RPProjectId", sql.Int, RPProjectId || null)
      .input("RPCustomerName", sql.NVarChar(255), RPCustomerName || null)
      .input("RPDepositBankId", sql.Int, RPDepositBankId || null)
      .input("RPDepositBankName", sql.NVarChar(255), RPDepositBankName || null);
    const extraCols = `, RPDocNo, RPFinYear, RPDocTypeId, RPCompanyId, RPProjectId, RPCustomerName, RPDepositBankId, RPDepositBankName`;
    const extraVals = `, @RPDocNo, @RPFinYear, @RPDocTypeId, @RPCompanyId, @RPProjectId, @RPCustomerName, @RPDepositBankId, @RPDepositBankName`;

    const result = await req2.query(`
      INSERT INTO dbo.ReceivedPayment (
        RPCompanyName, RPReceivedFrom, RPProjectName, RPDocDate, RPMode, RPAmount,
        RPBankName, RPTransactionId, RPCheckNumber, RPRemarks,
        RPIsEmi, RPEmiTotal, RPEmiMonths, RPEmiStartDate, RPEmiSchedule, RPEmiPaying,
        RPStatus, RPCreatedBy, RPCreatedAt ${extraCols}
      ) OUTPUT INSERTED.* VALUES (
        @RPCompanyName, @RPReceivedFrom, @RPProjectName, @RPDocDate, @RPMode, @RPAmount,
        @RPBankName, @RPTransactionId, @RPCheckNumber, @RPRemarks,
        @RPIsEmi, @RPEmiTotal, @RPEmiMonths, @RPEmiStartDate, @RPEmiSchedule, @RPEmiPaying,
        'Pending', @RPCreatedBy, GETDATE() ${extraVals}
      )
    `);

    const row = result.recordset[0];
    if (finalDocNo && row?.RPPaymentID) {
      await backPatchRecordId(
        pool,
        sql,
        finalDocNo,
        "ReceivedPayment",
        row.RPPaymentID,
      );
    }

    localVersionCache.invalidate("received-payment");
    res.status(201).json(row);
  } catch (err) {
    console.error("POST /received-payment error:", err);
    res.status(500).json({ error: "Failed to create received payment" });
  }
});

// -- PUT /:id -------------------------------------------------------------------
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
      RPMode,
      RPAmount,
      RPBankName,
      RPTransactionId,
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
    const req2 = pool
      .request()
      .input("id", sql.Int, id)
      .input("RPCompanyName", sql.NVarChar(255), RPCompanyName || null)
      .input("RPReceivedFrom", sql.NVarChar(255), RPReceivedFrom || "")
      .input("RPProjectName", sql.NVarChar(255), RPProjectName || "")
      .input("RPDocDate", sql.Date, RPDocDate || null)
      .input("RPMode", sql.NVarChar(50), RPMode || "Cash")
      .input("RPAmount", sql.Decimal(18, 2), Number(RPAmount) || 0)
      .input("RPBankName", sql.NVarChar(255), RPBankName || null)
      .input("RPTransactionId", sql.NVarChar(255), RPTransactionId || null)
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
      .input("RPUpdatedBy", sql.NVarChar(150), updatedBy);

    req2
      .input("RPCompanyId", sql.Int, RPCompanyId || null)
      .input("RPProjectId", sql.Int, RPProjectId || null)
      .input("RPCustomerName", sql.NVarChar(255), RPCustomerName || null)
      .input("RPDepositBankId", sql.Int, RPDepositBankId || null)
      .input("RPDepositBankName", sql.NVarChar(255), RPDepositBankName || null)
      .input("RPFinYear", sql.NVarChar(20), RPFinYear || null);
    const extraSet = `RPCompanyId=@RPCompanyId, RPProjectId=@RPProjectId,
                RPCustomerName=@RPCustomerName, RPFinYear=@RPFinYear,
                RPDepositBankId=@RPDepositBankId, RPDepositBankName=@RPDepositBankName,`;

    const result = await req2.query(`
      UPDATE dbo.ReceivedPayment SET
        RPCompanyName=@RPCompanyName, RPReceivedFrom=@RPReceivedFrom,
        RPProjectName=@RPProjectName, RPDocDate=@RPDocDate, RPMode=@RPMode,
        RPAmount=@RPAmount, RPBankName=@RPBankName, RPTransactionId=@RPTransactionId,
        RPCheckNumber=@RPCheckNumber, RPRemarks=@RPRemarks, RPIsEmi=@RPIsEmi,
        RPEmiTotal=@RPEmiTotal, RPEmiMonths=@RPEmiMonths, RPEmiStartDate=@RPEmiStartDate,
        RPEmiSchedule=@RPEmiSchedule, RPEmiPaying=@RPEmiPaying,
        ${extraSet}
        RPUpdatedBy=@RPUpdatedBy, RPUpdatedAt=GETDATE()
      OUTPUT INSERTED.*
      WHERE RPPaymentID=@id
    `);
    if (result.recordset.length === 0)
      return res.status(404).json({ error: "Not found" });
    localVersionCache.invalidate("received-payment");
    res.json(result.recordset[0]);
  } catch (err) {
    console.error("PUT /received-payment error:", err);
    res.status(500).json({ error: "Failed to update" });
  }
});

// -- DELETE /:id ----------------------------------------------------------------
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const pool = getPool();
    await pool
      .request()
      .input("id", sql.Int, id)
      .query(`DELETE FROM dbo.ReceivedPayment WHERE RPPaymentID=@id`);
    localVersionCache.invalidate("received-payment");
    res.json({ success: true });
  } catch (err) {
    console.error("DELETE /received-payment error:", err);
    res.status(500).json({ error: "Failed to delete" });
  }
});

// -- PATCH /:id/submit ---------------------------------------------------------
// Sets status = 'Pending' so it appears in the admin Approval Inbox
router.patch("/:id/submit", async (req, res) => {
  try {
    const { id } = req.params;
    const submittedBy = req.user?.name || req.user?.email || null;
    const pool = getPool();

    const check = await pool
      .request()
      .input("id", sql.Int, id)
      .query(`SELECT RPStatus FROM dbo.ReceivedPayment WHERE RPPaymentID=@id`);

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

    localVersionCache.invalidate("received-payment");
    res.json({ success: true, message: "Submitted for approval" });
  } catch (err) {
    console.error("PATCH /submit error:", err);
    res.status(500).json({ error: "Submit failed" });
  }
});

// -- PUT /:id/approve (admin only &#65533; called from Approval Inbox) ---------------
router.put("/:id/approve", async (req, res) => {
  try {
    const { id } = req.params;
    const actor = req.user?.name || req.user?.email || null;
    const pool = getPool();
    await pool
      .request()
      .input("id", sql.Int, id)
      .input("by", sql.NVarChar(150), actor)
      .query(
        `UPDATE dbo.ReceivedPayment SET RPStatus='Approved', RPApprovedBy=@by, RPApprovedAt=GETDATE() WHERE RPPaymentID=@id`,
      );
    localVersionCache.invalidate("received-payment");
    res.json({ success: true });
  } catch (err) {
    console.error("PUT /:id/approve error:", err);
    res.status(500).json({ error: "Approval failed" });
  }
});

// -- PUT /:id/reject (admin only &#65533; called from Approval Inbox) ----------------
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
      .input("note", sql.NVarChar(500), note || null)
      .query(
        `UPDATE dbo.ReceivedPayment SET RPStatus='Rejected', RPRejectedBy=@by, RPRejectedAt=GETDATE(), RPRejectionNote=@note WHERE RPPaymentID=@id`,
      );
    localVersionCache.invalidate("received-payment");
    res.json({ success: true });
  } catch (err) {
    console.error("PUT /:id/reject error:", err);
    res.status(500).json({ error: "Rejection failed" });
  }
});

module.exports = router;
