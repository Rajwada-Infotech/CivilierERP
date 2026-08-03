const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId } = require("../services/saAccess");
const { logCrmAudit } = require("../services/crmAudit");
const { recalculateRemainingMilestones, isLegalWorkStarted, requireActiveBooking, isBookingFullySettled } = require("../services/crmWorkflowGuards");
const { createAmendmentRequest } = require("../services/crmAmendments");

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

function chargeError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// Add/Edit/Release applied for real — called directly from the route
// handlers below when legal work hasn't started yet, and again from
// crmBookingAmendments.js when an approver signs off on a queued request.

async function applyAddExtraCharge(pool, bookingId, b, actorUserId) {
  const amount = parseFloat(b.Amount);
  if (!b.Description?.trim()) throw chargeError("Description is required");
  if (!Number.isFinite(amount) || amount <= 0) throw chargeError("Amount must be greater than 0");

  const activeErr = await requireActiveBooking(pool, bookingId);
  if (activeErr) throw chargeError(activeErr);

  const booking = await pool.request().input("bid", sql.Int, bookingId)
    .query("SELECT Id FROM dbo.CrmBooking WHERE Id = @bid AND IsActive = 1");
  if (!booking.recordset.length) throw chargeError("Booking not found", 404);

  let gstRate = b.GstRate != null ? parseFloat(b.GstRate) : 18;
  if (b.ExtraChargeMasterId) {
    const master = await pool.request().input("id", sql.Int, parseInt(b.ExtraChargeMasterId))
      .query("SELECT GstRate FROM dbo.ExtraChargeMaster WHERE Id = @id AND IsActive = 1");
    if (!master.recordset.length) throw chargeError("Selected charge type is not active");
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
    .input("cb",   sql.Int, actorUserId)
    .query(`
      INSERT INTO dbo.CrmExtraCharge
        (BookingId, ExtraChargeMasterId, Description, Amount, GstRate, GstAmount, TotalAmount, CreatedBy, CreatedAt)
      OUTPUT INSERTED.Id
      VALUES (@bid, @mid, @desc, @amt, @gstr, @gsta, @tot, @cb, SYSDATETIME())
    `);
  const extraChargeId = result.recordset[0].Id;

  // No longer gets a dedicated milestone of its own — its ₹ value folds
  // straight into the shared %-based milestones via rollupBookingTotals's
  // recalculateRemainingMilestones call below, spreading proportionally
  // across whatever's still open (already-Paid/Waived stages are left
  // untouched). See isBookingFullySettled in crmWorkflowGuards.js for how
  // "has this charge been paid" is now answered without a 1:1 milestone.
  await rollupBookingTotals(pool, bookingId);
  await logCrmAudit(pool, "Booking", bookingId, actorUserId, [
    { field: "ExtraCharge", oldVal: null, newVal: `${b.Description.trim()} = ₹${totalAmount}` },
  ]);

  return { id: extraChargeId, TotalAmount: totalAmount };
}

async function applyEditExtraCharge(pool, id, b, actorUserId) {
  const row = await pool.request().input("id", sql.Int, id)
    .query("SELECT BookingId, Description, TotalAmount FROM dbo.CrmExtraCharge WHERE Id = @id AND IsActive = 1");
  if (!row.recordset.length) throw chargeError("Extra charge not found", 404);
  const { BookingId } = row.recordset[0];

  const activeErr = await requireActiveBooking(pool, BookingId);
  if (activeErr) throw chargeError(activeErr);

  // Legacy shape (created before charges were folded into the shared
  // milestones): a dedicated CrmPaymentMilestone still exists for this
  // charge — keep using ITS Status exactly as before, never touch the new
  // blended model for a booking edited this way. New-shape charges (no
  // linked milestone) fall through to the booking-wide settled check.
  const milestone = await pool.request().input("ecid", sql.Int, id)
    .query("SELECT TOP 1 Id, Status FROM dbo.CrmPaymentMilestone WHERE ExtraChargeId = @ecid ORDER BY Id DESC");
  if (milestone.recordset.length) {
    if (milestone.recordset[0].Status === "Paid") {
      throw chargeError("This charge has already been paid and cannot be edited", 409);
    }
  } else if (await isBookingFullySettled(pool, BookingId)) {
    throw chargeError("This booking is fully paid off — charges can no longer be edited", 409);
  }

  const amount = parseFloat(b.Amount);
  if (!b.Description?.trim()) throw chargeError("Description is required");
  if (!Number.isFinite(amount) || amount <= 0) throw chargeError("Amount must be greater than 0");

  let gstRate = b.GstRate != null ? parseFloat(b.GstRate) : 18;
  if (b.ExtraChargeMasterId) {
    const master = await pool.request().input("id", sql.Int, parseInt(b.ExtraChargeMasterId))
      .query("SELECT GstRate FROM dbo.ExtraChargeMaster WHERE Id = @id AND IsActive = 1");
    if (!master.recordset.length) throw chargeError("Selected charge type is not active");
    gstRate = master.recordset[0].GstRate;
  }
  const gstAmount = Math.round((amount * gstRate) / 100 * 100) / 100;
  const totalAmount = amount + gstAmount;

  await pool.request()
    .input("id",   sql.Int, id)
    .input("mid",  sql.Int, b.ExtraChargeMasterId ? parseInt(b.ExtraChargeMasterId) : null)
    .input("desc", sql.NVarChar(300), b.Description.trim())
    .input("amt",  sql.Decimal(18, 2), amount)
    .input("gstr", sql.Decimal(5, 2), gstRate)
    .input("gsta", sql.Decimal(18, 2), gstAmount)
    .input("tot",  sql.Decimal(18, 2), totalAmount)
    .query(`
      UPDATE dbo.CrmExtraCharge SET
        ExtraChargeMasterId = @mid, Description = @desc, Amount = @amt,
        GstRate = @gstr, GstAmount = @gsta, TotalAmount = @tot
      WHERE Id = @id
    `);

  if (milestone.recordset.length) {
    await pool.request()
      .input("mid",  sql.Int, milestone.recordset[0].Id)
      .input("name", sql.NVarChar(200), b.Description.trim())
      .input("amt",  sql.Decimal(18, 2), totalAmount)
      .query(`UPDATE dbo.CrmPaymentMilestone SET MilestoneName = @name, AmountDue = @amt, UpdatedAt = SYSDATETIME() WHERE Id = @mid`);
  }

  await rollupBookingTotals(pool, BookingId);
  await logCrmAudit(pool, "Booking", BookingId, actorUserId, [
    { field: "ExtraCharge", oldVal: row.recordset[0].Description, newVal: `${b.Description.trim()} = ₹${totalAmount}` },
  ]);

  return { TotalAmount: totalAmount };
}

async function applyReleaseExtraCharge(pool, id) {
  const row = await pool.request().input("id", sql.Int, id)
    .query("SELECT BookingId FROM dbo.CrmExtraCharge WHERE Id = @id AND IsActive = 1");
  if (!row.recordset.length) throw chargeError("Extra charge not found", 404);
  const { BookingId } = row.recordset[0];

  const activeErr = await requireActiveBooking(pool, BookingId);
  if (activeErr) throw chargeError(activeErr);

  const milestone = await pool.request().input("ecid", sql.Int, id)
    .query("SELECT TOP 1 Id, Status FROM dbo.CrmPaymentMilestone WHERE ExtraChargeId = @ecid ORDER BY Id DESC");
  if (milestone.recordset.length) {
    if (milestone.recordset[0].Status === "Paid") {
      throw chargeError("This charge has already been paid and cannot be removed", 409);
    }
  } else if (await isBookingFullySettled(pool, BookingId)) {
    throw chargeError("This booking is fully paid off — charges can no longer be removed", 409);
  }

  await pool.request().input("id", sql.Int, id)
    .query("UPDATE dbo.CrmExtraCharge SET IsActive = 0 WHERE Id = @id");
  if (milestone.recordset.length) {
    await pool.request().input("mid", sql.Int, milestone.recordset[0].Id)
      .query("DELETE FROM dbo.CrmPaymentMilestone WHERE Id = @mid");
  }

  await rollupBookingTotals(pool, BookingId);
  return {};
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
// Once the booking's Agreement has documents under verification, this
// queues a CrmBookingAmendmentRequest instead of applying directly.
router.post("/:bookingId", requirePageRight("crm-bookings", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const bookingId = parseInt(req.params.bookingId);
    const b = req.body;

    const activeErr = await requireActiveBooking(pool, bookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });

    if (await isLegalWorkStarted(pool, bookingId)) {
      if (!b.Reason?.trim()) return res.status(400).json({ error: "A reason is required to request this change — legal documents are already under verification for this booking" });
      const requestId = await createAmendmentRequest(pool, {
        bookingId, changeType: "ExtraCharge", action: "Add", targetId: null,
        proposedChange: b, reason: b.Reason.trim(), requestedBy: actorId(req),
      });
      return res.status(202).json({ pending: true, requestId, message: "Legal documents are already under verification — this change needs approval before it applies." });
    }

    const result = await applyAddExtraCharge(pool, bookingId, b, actorId(req));
    res.status(201).json({ success: true, ...result });
  } catch (e) {
    console.error("[crm-extra-charges] POST error:", e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

// PUT /:id — edit an existing extra charge's description/amount/GST/type.
// Blocked once its linked milestone has been paid (real money already
// collected against the old figure can't be silently redefined). Cascades
// the new total onto the linked milestone via the real ExtraChargeId FK —
// no more re-guessing which milestone belongs to this charge. Gated the
// same way as POST once legal work has started.
router.put("/:id", requirePageRight("crm-bookings", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const b = req.body;

    const row = await pool.request().input("id", sql.Int, id)
      .query("SELECT BookingId FROM dbo.CrmExtraCharge WHERE Id = @id AND IsActive = 1");
    if (!row.recordset.length) return res.status(404).json({ error: "Extra charge not found" });
    const bookingId = row.recordset[0].BookingId;

    const activeErr = await requireActiveBooking(pool, bookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });

    if (await isLegalWorkStarted(pool, bookingId)) {
      if (!b.Reason?.trim()) return res.status(400).json({ error: "A reason is required to request this change — legal documents are already under verification for this booking" });
      const requestId = await createAmendmentRequest(pool, {
        bookingId, changeType: "ExtraCharge", action: "Edit", targetId: id,
        proposedChange: b, reason: b.Reason.trim(), requestedBy: actorId(req),
      });
      return res.status(202).json({ pending: true, requestId, message: "Legal documents are already under verification — this change needs approval before it applies." });
    }

    const result = await applyEditExtraCharge(pool, id, b, actorId(req));
    res.json({ success: true, ...result });
  } catch (e) {
    console.error("[crm-extra-charges] PUT error:", e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

// DELETE /:id — remove an extra charge (soft delete). Blocked once its
// linked milestone has been paid, same guard as crmParking.js. Gated the
// same way as POST/PUT once legal work has started — the Reason and pending
// signal travel via query params here since DELETE has no JSON body in the
// frontend's fetch call.
router.delete("/:id", requirePageRight("crm-bookings", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const reason = req.query.reason || req.body?.Reason;

    const row = await pool.request().input("id", sql.Int, id)
      .query("SELECT BookingId FROM dbo.CrmExtraCharge WHERE Id = @id AND IsActive = 1");
    if (!row.recordset.length) return res.status(404).json({ error: "Extra charge not found" });
    const bookingId = row.recordset[0].BookingId;

    const activeErr = await requireActiveBooking(pool, bookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });

    if (await isLegalWorkStarted(pool, bookingId)) {
      if (!reason?.trim()) return res.status(400).json({ error: "A reason is required to request this change — legal documents are already under verification for this booking" });
      const requestId = await createAmendmentRequest(pool, {
        bookingId, changeType: "ExtraCharge", action: "Release", targetId: id,
        proposedChange: {}, reason: reason.trim(), requestedBy: actorId(req),
      });
      return res.status(202).json({ pending: true, requestId, message: "Legal documents are already under verification — this change needs approval before it applies." });
    }

    const result = await applyReleaseExtraCharge(pool, id);
    res.json({ success: true, ...result });
  } catch (e) {
    console.error("[crm-extra-charges] DELETE error:", e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

module.exports = router;
module.exports.applyAddExtraCharge = applyAddExtraCharge;
module.exports.applyEditExtraCharge = applyEditExtraCharge;
module.exports.applyReleaseExtraCharge = applyReleaseExtraCharge;
