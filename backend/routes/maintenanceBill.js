const { requirePageRight } = require("../middleware/requirePageRight");
const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const { getNextDocNumber } = require("../services/docNumber");

const LIST_SELECT = `
  SELECT
    b.Id, b.BillNo, b.BillDate, b.Subtotal, b.TotalTax, b.GrandTotal, b.Status,
    b.CancelReason, b.CreatedAt,
    a.ApplicantName AS CustomerName,
    COALESCE(um.UnitName, cb.UnitNo) AS UnitNo,
    COALESCE(blk.BlockName, cb.BlockName) AS BlockName,
    cb.Id AS BookingId, cb.BookingNo
  FROM dbo.MaintenanceBill b
  JOIN dbo.CrmBooking cb ON cb.Id = b.BookingId
  JOIN dbo.CrmApplication a ON a.Id = cb.ApplicationId
  LEFT JOIN dbo.UnitMaster um   ON um.Id  = cb.UnitId
  LEFT JOIN dbo.BlockMaster blk ON blk.Id = um.BlockId
`;

router.get("/", requirePageRight("maintenance-bills", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const { search, bookingId, status, dateFrom, dateTo } = req.query;
    const req0 = pool.request();
    const conds = [];

    if (search) {
      req0.input("search", sql.NVarChar, `%${search}%`);
      conds.push(`(
        b.BillNo LIKE @search OR a.ApplicantName LIKE @search OR
        COALESCE(um.UnitName, cb.UnitNo) LIKE @search
      )`);
    }
    if (bookingId) {
      req0.input("bookingId", sql.Int, parseInt(bookingId, 10));
      conds.push("b.BookingId = @bookingId");
    }
    if (status) {
      req0.input("status", sql.NVarChar, status);
      conds.push("b.Status = @status");
    }
    if (dateFrom) {
      req0.input("dateFrom", sql.Date, dateFrom);
      conds.push("b.BillDate >= @dateFrom");
    }
    if (dateTo) {
      req0.input("dateTo", sql.Date, dateTo);
      conds.push("b.BillDate <= @dateTo");
    }

    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const result = await req0.query(`${LIST_SELECT} ${where} ORDER BY b.CreatedAt DESC`);
    res.json(result.recordset);
  } catch (err) {
    console.error("GET BILLS ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get("/:id", requirePageRight("maintenance-bills", "view"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid bill id" });
  try {
    const pool = getPool();
    const billResult = await pool
      .request()
      .input("Id", sql.Int, id)
      .query(`${LIST_SELECT} WHERE b.Id = @Id`);
    if (!billResult.recordset.length) return res.status(404).json({ error: "Bill not found" });

    const itemsResult = await pool
      .request()
      .input("BillId", sql.Int, id)
      .query(`
        SELECT Id, ChargeHeadId, ChargeHeadName, HsnId, HsnCode, Rate, TaxPct, TaxAmount, TotalAmount
        FROM dbo.MaintenanceBillItem
        WHERE BillId = @BillId
        ORDER BY Id
      `);

    res.json({ ...billResult.recordset[0], items: itemsResult.recordset });
  } catch (err) {
    console.error("GET BILL ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Shared by create/update — pulls each Charge Head's current Rate/TaxPct/HSN
// (the snapshot to freeze onto the bill line) and returns the computed totals.
async function resolveBillItems(pool, chargeHeadIds) {
  if (!Array.isArray(chargeHeadIds) || chargeHeadIds.length === 0) {
    throw new Error("At least one Charge Head is required");
  }
  const uniqueIds = [...new Set(chargeHeadIds.map((n) => parseInt(n, 10)))];
  if (uniqueIds.some((n) => !Number.isFinite(n))) {
    throw new Error("Invalid Charge Head id in list");
  }

  const result = await pool
    .request()
    .query(`
      SELECT ch.Id, ch.Name, ch.Rate, ch.TaxPct, ch.HsnId, ch.Status, h.HCode
      FROM dbo.MaintenanceChargeHead ch
      LEFT JOIN dbo.HSN h ON h.HId = ch.HsnId
      WHERE ch.Id IN (${uniqueIds.join(",")})
    `);

  const byId = new Map(result.recordset.map((r) => [r.Id, r]));
  const items = uniqueIds.map((id) => {
    const ch = byId.get(id);
    if (!ch) throw new Error(`Charge Head #${id} not found`);
    if (!ch.Status) throw new Error(`Charge Head "${ch.Name}" is inactive`);
    const rate = Number(ch.Rate) || 0;
    const taxPct = Number(ch.TaxPct) || 0;
    const taxAmount = Math.round(((rate * taxPct) / 100) * 100) / 100;
    return {
      chargeHeadId: ch.Id,
      chargeHeadName: ch.Name,
      hsnId: ch.HsnId || null,
      hsnCode: ch.HCode || null,
      rate,
      taxPct,
      taxAmount,
      totalAmount: rate + taxAmount,
    };
  });

  const subtotal = items.reduce((s, i) => s + i.rate, 0);
  const totalTax = items.reduce((s, i) => s + i.taxAmount, 0);
  const grandTotal = subtotal + totalTax;
  return { items, subtotal, totalTax, grandTotal };
}

router.post("/", requirePageRight("maintenance-bills", "create"), async (req, res) => {
  const bookingId = parseInt(req.body?.bookingId, 10);
  const chargeHeadIds = req.body?.chargeHeadIds;
  if (!Number.isFinite(bookingId)) return res.status(400).json({ error: "bookingId is required" });
  const createdBy = req.user?.userId ?? req.user?.id ?? null;
  if (!createdBy) return res.status(401).json({ error: "User context missing — please sign in again." });

  const pool = getPool();

  try {
    const booking = await pool
      .request()
      .input("Id", sql.Int, bookingId)
      .query("SELECT TOP 1 Id FROM dbo.CrmBooking WHERE Id = @Id AND WorkflowStage = 'Confirmed' AND IsActive = 1");
    if (!booking.recordset.length) return res.status(404).json({ error: "Confirmed booking not found" });

    const { items, subtotal, totalTax, grandTotal } = await resolveBillItems(pool, chargeHeadIds);
    const billNo = await getNextDocNumber(pool, "MAINTBILL", "MB");

    const tx = pool.transaction();
    await tx.begin();
    try {
      const billResult = await tx
        .request()
        .input("BillNo", sql.NVarChar, billNo)
        .input("BookingId", sql.Int, bookingId)
        .input("BillDate", sql.Date, new Date())
        .input("Subtotal", sql.Decimal(18, 2), subtotal)
        .input("TotalTax", sql.Decimal(18, 2), totalTax)
        .input("GrandTotal", sql.Decimal(18, 2), grandTotal)
        .input("CreatedBy", sql.Int, createdBy)
        .input("CreatedAt", sql.DateTime, new Date())
        .query(`
          INSERT INTO dbo.MaintenanceBill
            (BillNo, BookingId, BillDate, Subtotal, TotalTax, GrandTotal, Status, CreatedBy, CreatedAt)
          OUTPUT INSERTED.Id
          VALUES (@BillNo, @BookingId, @BillDate, @Subtotal, @TotalTax, @GrandTotal, 'Active', @CreatedBy, @CreatedAt)
        `);
      const billId = billResult.recordset[0].Id;

      for (const it of items) {
        await tx
          .request()
          .input("BillId", sql.Int, billId)
          .input("ChargeHeadId", sql.Int, it.chargeHeadId)
          .input("ChargeHeadName", sql.NVarChar, it.chargeHeadName)
          .input("HsnId", sql.Int, it.hsnId)
          .input("HsnCode", sql.NVarChar, it.hsnCode)
          .input("Rate", sql.Decimal(18, 2), it.rate)
          .input("TaxPct", sql.Decimal(5, 2), it.taxPct)
          .input("TaxAmount", sql.Decimal(18, 2), it.taxAmount)
          .input("TotalAmount", sql.Decimal(18, 2), it.totalAmount)
          .query(`
            INSERT INTO dbo.MaintenanceBillItem
              (BillId, ChargeHeadId, ChargeHeadName, HsnId, HsnCode, Rate, TaxPct, TaxAmount, TotalAmount)
            VALUES (@BillId, @ChargeHeadId, @ChargeHeadName, @HsnId, @HsnCode, @Rate, @TaxPct, @TaxAmount, @TotalAmount)
          `);
      }

      await tx.commit();
      res.json({ message: "Bill created", Id: billId, BillNo: billNo });
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  } catch (err) {
    console.error("POST BILL ERROR:", err.message);
    res.status(400).json({ error: err.message });
  }
});

router.put("/:id", requirePageRight("maintenance-bills", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const chargeHeadIds = req.body?.chargeHeadIds;
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid bill id" });
  const updatedBy = req.user?.userId ?? req.user?.id ?? null;

  const pool = getPool();
  try {
    const existing = await pool
      .request()
      .input("Id", sql.Int, id)
      .query("SELECT TOP 1 Id, Status FROM dbo.MaintenanceBill WHERE Id = @Id");
    if (!existing.recordset.length) return res.status(404).json({ error: "Bill not found" });
    if (existing.recordset[0].Status === "Cancelled") {
      return res.status(409).json({ error: "A cancelled bill cannot be edited" });
    }

    const { items, subtotal, totalTax, grandTotal } = await resolveBillItems(pool, chargeHeadIds);

    const tx = pool.transaction();
    await tx.begin();
    try {
      await tx.request().input("BillId", sql.Int, id).query("DELETE FROM dbo.MaintenanceBillItem WHERE BillId = @BillId");

      for (const it of items) {
        await tx
          .request()
          .input("BillId", sql.Int, id)
          .input("ChargeHeadId", sql.Int, it.chargeHeadId)
          .input("ChargeHeadName", sql.NVarChar, it.chargeHeadName)
          .input("HsnId", sql.Int, it.hsnId)
          .input("HsnCode", sql.NVarChar, it.hsnCode)
          .input("Rate", sql.Decimal(18, 2), it.rate)
          .input("TaxPct", sql.Decimal(5, 2), it.taxPct)
          .input("TaxAmount", sql.Decimal(18, 2), it.taxAmount)
          .input("TotalAmount", sql.Decimal(18, 2), it.totalAmount)
          .query(`
            INSERT INTO dbo.MaintenanceBillItem
              (BillId, ChargeHeadId, ChargeHeadName, HsnId, HsnCode, Rate, TaxPct, TaxAmount, TotalAmount)
            VALUES (@BillId, @ChargeHeadId, @ChargeHeadName, @HsnId, @HsnCode, @Rate, @TaxPct, @TaxAmount, @TotalAmount)
          `);
      }

      await tx
        .request()
        .input("Id", sql.Int, id)
        .input("Subtotal", sql.Decimal(18, 2), subtotal)
        .input("TotalTax", sql.Decimal(18, 2), totalTax)
        .input("GrandTotal", sql.Decimal(18, 2), grandTotal)
        .input("UpdatedBy", sql.Int, updatedBy)
        .input("UpdatedAt", sql.DateTime, new Date())
        .query(`
          UPDATE dbo.MaintenanceBill SET
            Subtotal = @Subtotal, TotalTax = @TotalTax, GrandTotal = @GrandTotal,
            UpdatedBy = @UpdatedBy, UpdatedAt = @UpdatedAt
          WHERE Id = @Id
        `);

      await tx.commit();
      res.json({ message: "Bill updated" });
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  } catch (err) {
    console.error("PUT BILL ERROR:", err.message);
    res.status(400).json({ error: err.message });
  }
});

// Cancel, never hard-delete — matches the app-wide convention for
// financial documents (see loanSanction.js's DELETE for the same pattern).
router.delete("/:id", requirePageRight("maintenance-bills", "delete"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid bill id" });
  const cancelledBy = req.user?.userId ?? req.user?.id ?? null;
  const reason = req.body?.reason || null;

  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("Id", sql.Int, id)
      .input("CancelledBy", sql.Int, cancelledBy)
      .input("CancelledAt", sql.DateTime, new Date())
      .input("CancelReason", sql.NVarChar, reason)
      .query(`
        UPDATE dbo.MaintenanceBill SET
          Status = 'Cancelled', CancelledBy = @CancelledBy, CancelledAt = @CancelledAt, CancelReason = @CancelReason
        WHERE Id = @Id AND Status <> 'Cancelled'
      `);
    if (!result.rowsAffected[0]) return res.status(404).json({ error: "Bill not found or already cancelled" });
    res.json({ message: "Bill cancelled" });
  } catch (err) {
    console.error("DELETE BILL ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
