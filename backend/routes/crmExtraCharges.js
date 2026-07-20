const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId } = require("../services/saAccess");
const { logCrmAudit } = require("../services/crmAudit");
const { recalculateRemainingMilestones } = require("../services/crmWorkflowGuards");

router.use(authMiddleware);
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));

// Same re-derive-from-source pattern as crmParking.js's rollup.
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

  // GrandTotal just moved — every not-yet-settled milestone's ₹/% needs to
  // be re-derived against the new total, or the payment schedule silently
  // stops adding up to what the customer actually owes.
  await recalculateRemainingMilestones(pool, bookingId);
}

// GET /:bookingId — list extra charges for a booking
router.get("/:bookingId", requirePageRight("crm-bookings", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const bookingId = parseInt(req.params.bookingId);
    const result = await pool.request().input("bid", sql.Int, bookingId).query(`
      SELECT c.*, m.ChargeName AS MasterChargeName
      FROM dbo.CrmExtraCharge c
      LEFT JOIN dbo.ExtraChargeMaster m ON m.Id = c.ExtraChargeMasterId
      WHERE c.BookingId = @bid AND c.IsActive = 1
      ORDER BY c.CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-extra-charges] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /:bookingId — add a custom/company-required extra charge. Either
// picks a defined charge type (ExtraChargeMasterId, whose GstRate is used)
// or is a fully custom one-off (freeform Description + Amount + GstRate).
router.post("/:bookingId", requirePageRight("crm-bookings", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const bookingId = parseInt(req.params.bookingId);
    const b = req.body;
    const amount = parseFloat(b.Amount);
    if (!b.Description?.trim()) return res.status(400).json({ error: "Description is required" });
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: "Amount must be greater than 0" });

    const booking = await pool.request().input("bid", sql.Int, bookingId)
      .query("SELECT Id FROM dbo.CrmBooking WHERE Id = @bid AND IsActive = 1");
    if (!booking.recordset.length) return res.status(404).json({ error: "Booking not found" });

    let gstRate = b.GstRate != null ? parseFloat(b.GstRate) : 18;
    if (b.ExtraChargeMasterId) {
      const master = await pool.request().input("id", sql.Int, parseInt(b.ExtraChargeMasterId))
        .query("SELECT GstRate FROM dbo.ExtraChargeMaster WHERE Id = @id AND IsActive = 1");
      if (!master.recordset.length) return res.status(400).json({ error: "Selected charge type is not active" });
      gstRate = master.recordset[0].GstRate;
    }
    const gstAmount = Math.round((amount * gstRate) / 100 * 100) / 100;
    const totalAmount = amount + gstAmount;

    const result = await pool.request()
      .input("bid",  sql.Int, bookingId)
      .input("mid",  sql.Int, b.ExtraChargeMasterId ? parseInt(b.ExtraChargeMasterId) : null)
      .input("desc", sql.NVarChar(300), b.Description.trim())
      .input("amt",  sql.Decimal(18, 2), amount)
      .input("gstr", sql.Decimal(5, 2), gstRate)
      .input("gsta", sql.Decimal(18, 2), gstAmount)
      .input("tot",  sql.Decimal(18, 2), totalAmount)
      .input("cb",   sql.Int, actorId(req))
      .query(`
        INSERT INTO dbo.CrmExtraCharge
          (BookingId, ExtraChargeMasterId, Description, Amount, GstRate, GstAmount, TotalAmount, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@bid, @mid, @desc, @amt, @gstr, @gsta, @tot, @cb, SYSDATETIME())
      `);

    const nextNo = await pool.request().input("bid", sql.Int, bookingId)
      .query("SELECT ISNULL(MAX(MilestoneNo), 0) + 1 AS N FROM dbo.CrmPaymentMilestone WHERE BookingId = @bid");
    await pool.request()
      .input("bid", sql.Int, bookingId)
      .input("no",  sql.Int, nextNo.recordset[0].N)
      .input("name",sql.NVarChar(200), b.Description.trim())
      .input("amt", sql.Decimal(18, 2), totalAmount)
      .input("cb",  sql.Int, actorId(req))
      .query(`
        INSERT INTO dbo.CrmPaymentMilestone (BookingId, MilestoneNo, MilestoneName, AmountDue, Status, CreatedBy, CreatedAt)
        VALUES (@bid, @no, @name, @amt, 'Pending', @cb, SYSDATETIME())
      `);

    await rollupBookingTotals(pool, bookingId);
    await logCrmAudit(pool, "Booking", bookingId, actorId(req), [
      { field: "ExtraCharge", oldVal: null, newVal: `${b.Description.trim()} = ₹${totalAmount}` },
    ]);

    res.status(201).json({ success: true, id: result.recordset[0].Id, TotalAmount: totalAmount });
  } catch (e) {
    console.error("[crm-extra-charges] POST error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /:id — remove an extra charge (soft delete). Blocked once its
// matching milestone has been paid, same guard as crmParking.js.
router.delete("/:id", requirePageRight("crm-bookings", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);

    const row = await pool.request().input("id", sql.Int, id)
      .query("SELECT BookingId, Description, TotalAmount FROM dbo.CrmExtraCharge WHERE Id = @id AND IsActive = 1");
    if (!row.recordset.length) return res.status(404).json({ error: "Extra charge not found" });
    const { BookingId, Description, TotalAmount } = row.recordset[0];

    const milestone = await pool.request().input("bid", sql.Int, BookingId)
      .input("name", sql.NVarChar(200), Description).input("amt", sql.Decimal(18,2), TotalAmount)
      .query("SELECT TOP 1 Id, Status FROM dbo.CrmPaymentMilestone WHERE BookingId = @bid AND MilestoneName = @name AND AmountDue = @amt ORDER BY Id DESC");
    if (milestone.recordset.length && milestone.recordset[0].Status === "Paid") {
      return res.status(409).json({ error: "This charge has already been paid and cannot be removed" });
    }

    await pool.request().input("id", sql.Int, id)
      .query("UPDATE dbo.CrmExtraCharge SET IsActive = 0 WHERE Id = @id");
    if (milestone.recordset.length) {
      await pool.request().input("mid", sql.Int, milestone.recordset[0].Id)
        .query("DELETE FROM dbo.CrmPaymentMilestone WHERE Id = @mid");
    }

    await rollupBookingTotals(pool, BookingId);
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-extra-charges] DELETE error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
