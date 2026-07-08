const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId } = require("../services/saAccess");
const { logCrmAudit } = require("../services/crmAudit");

router.use(authMiddleware);

// Recomputes CrmBooking.ParkingTotal/ExtraChargesTotal/GrandTotal from the
// live allotment/extra-charge rows — never trust an incrementally maintained
// running total, always re-derive from source rows so it can't drift.
async function rollupBookingTotals(pool, bookingId) {
  const parking = await pool.request().input("bid", sql.Int, bookingId)
    .query("SELECT ISNULL(SUM(TotalAmount), 0) AS Total FROM dbo.CrmParkingAllotment WHERE BookingId = @bid AND IsActive = 1");
  const extra = await pool.request().input("bid", sql.Int, bookingId)
    .query("SELECT ISNULL(SUM(TotalAmount), 0) AS Total FROM dbo.CrmExtraCharge WHERE BookingId = @bid AND IsActive = 1");
  const parkingTotal = parking.recordset[0].Total;
  const extraTotal = extra.recordset[0].Total;

  await pool.request()
    .input("bid", sql.Int, bookingId)
    .input("pt", sql.Decimal(18, 2), parkingTotal)
    .input("et", sql.Decimal(18, 2), extraTotal)
    .query(`
      UPDATE dbo.CrmBooking SET
        ParkingTotal = @pt, ExtraChargesTotal = @et,
        GrandTotal = ISNULL(TotalValue, 0) + @pt + @et
      WHERE Id = @bid
    `);

  return { parkingTotal, extraTotal };
}

// GET /:bookingId — list parking allotments for a booking
router.get("/:bookingId", requirePageRight("crm-bookings", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const bookingId = parseInt(req.params.bookingId);
    const result = await pool.request().input("bid", sql.Int, bookingId).query(`
      SELECT a.*, p.ParkingType AS CurrentParkingType, p.ProjectId, p.BlockId
      FROM dbo.CrmParkingAllotment a
      JOIN dbo.ParkingMaster p ON p.Id = a.ParkingMasterId
      WHERE a.BookingId = @bid AND a.IsActive = 1
      ORDER BY a.CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-parking] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /:bookingId — allot a parking slot to a booking. Rate/GST are always
// snapshotted from ParkingMaster at allotment time (never re-read live), and
// a matching payment milestone is created so it's payable on its own line.
router.post("/:bookingId", requirePageRight("crm-bookings", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const bookingId = parseInt(req.params.bookingId);
    const b = req.body;
    if (!b.ParkingMasterId) return res.status(400).json({ error: "ParkingMasterId is required" });
    const qty = b.Quantity != null ? parseInt(b.Quantity) : 1;
    if (!Number.isFinite(qty) || qty < 1) return res.status(400).json({ error: "Quantity must be at least 1" });

    const booking = await pool.request().input("bid", sql.Int, bookingId)
      .query("SELECT Id, BookingNo FROM dbo.CrmBooking WHERE Id = @bid AND IsActive = 1");
    if (!booking.recordset.length) return res.status(404).json({ error: "Booking not found" });

    const rate = await pool.request().input("pmid", sql.Int, parseInt(b.ParkingMasterId))
      .query("SELECT Charge, GstRate, ParkingType FROM dbo.ParkingMaster WHERE Id = @pmid AND IsActive = 1");
    if (!rate.recordset.length) return res.status(400).json({ error: "Selected parking rate is not active" });
    const { Charge, GstRate, ParkingType } = rate.recordset[0];

    const lineAmount = Charge * qty;
    const gstAmount = Math.round((lineAmount * GstRate) / 100 * 100) / 100;
    const totalAmount = lineAmount + gstAmount;

    const result = await pool.request()
      .input("bid",  sql.Int, bookingId)
      .input("pmid", sql.Int, parseInt(b.ParkingMasterId))
      .input("slot", sql.NVarChar(50), b.ParkingSlotNo || null)
      .input("qty",  sql.Int, qty)
      .input("rate", sql.Decimal(18, 2), Charge)
      .input("gstr", sql.Decimal(5, 2), GstRate)
      .input("gsta", sql.Decimal(18, 2), gstAmount)
      .input("tot",  sql.Decimal(18, 2), totalAmount)
      .input("note", sql.NVarChar(sql.MAX), b.Notes || null)
      .input("cb",   sql.Int, actorId(req))
      .query(`
        INSERT INTO dbo.CrmParkingAllotment
          (BookingId, ParkingMasterId, ParkingSlotNo, Quantity, RateSnapshot, GstRateSnapshot, GstAmount, TotalAmount, Notes, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@bid, @pmid, @slot, @qty, @rate, @gstr, @gsta, @tot, @note, @cb, SYSDATETIME())
      `);

    // A new payable line item — its own milestone, due immediately, not
    // folded into the base unit's staged % milestones.
    const nextNo = await pool.request().input("bid", sql.Int, bookingId)
      .query("SELECT ISNULL(MAX(MilestoneNo), 0) + 1 AS N FROM dbo.CrmPaymentMilestone WHERE BookingId = @bid");
    await pool.request()
      .input("bid", sql.Int, bookingId)
      .input("no",  sql.Int, nextNo.recordset[0].N)
      .input("name",sql.NVarChar(200), `Parking — ${ParkingType}${b.ParkingSlotNo ? ` (${b.ParkingSlotNo})` : ""}`)
      .input("amt", sql.Decimal(18, 2), totalAmount)
      .input("cb",  sql.Int, actorId(req))
      .query(`
        INSERT INTO dbo.CrmPaymentMilestone (BookingId, MilestoneNo, MilestoneName, AmountDue, Status, CreatedBy, CreatedAt)
        VALUES (@bid, @no, @name, @amt, 'Pending', @cb, SYSDATETIME())
      `);

    await rollupBookingTotals(pool, bookingId);
    await logCrmAudit(pool, "Booking", bookingId, actorId(req), [
      { field: "ParkingAllotment", oldVal: null, newVal: `${ParkingType} x${qty} = ₹${totalAmount}` },
    ]);

    res.status(201).json({ success: true, id: result.recordset[0].Id, TotalAmount: totalAmount });
  } catch (e) {
    console.error("[crm-parking] POST error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /:id — release a parking allotment (soft delete). Also removes the
// matching un-paid milestone; a milestone that's already been paid against
// blocks the release so money already collected can't silently vanish.
router.delete("/:id", requirePageRight("crm-bookings", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);

    const row = await pool.request().input("id", sql.Int, id)
      .query("SELECT BookingId, TotalAmount FROM dbo.CrmParkingAllotment WHERE Id = @id AND IsActive = 1");
    if (!row.recordset.length) return res.status(404).json({ error: "Allotment not found" });
    const { BookingId, TotalAmount } = row.recordset[0];

    const milestone = await pool.request().input("bid", sql.Int, BookingId).input("amt", sql.Decimal(18,2), TotalAmount)
      .query("SELECT TOP 1 Id, Status FROM dbo.CrmPaymentMilestone WHERE BookingId = @bid AND MilestoneName LIKE 'Parking%' AND AmountDue = @amt ORDER BY Id DESC");
    if (milestone.recordset.length && milestone.recordset[0].Status === "Paid") {
      return res.status(409).json({ error: "This parking charge has already been paid and cannot be released" });
    }

    await pool.request().input("id", sql.Int, id)
      .query("UPDATE dbo.CrmParkingAllotment SET IsActive = 0 WHERE Id = @id");
    if (milestone.recordset.length) {
      await pool.request().input("mid", sql.Int, milestone.recordset[0].Id)
        .query("DELETE FROM dbo.CrmPaymentMilestone WHERE Id = @mid");
    }

    await rollupBookingTotals(pool, BookingId);
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-parking] DELETE error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
