const express = require("express");
const { CrmStatus } = require("../constants/crmStatuses");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight, requireAnyPageRight } = require("../middleware/requirePageRight");
const { actorId } = require("../services/saAccess");
const { logCrmAudit } = require("../services/crmAudit");
const { recalculateRemainingMilestones, isLegalWorkStarted, isSaleDeedRegistered, isBookingPastFirstApproval, requireActiveBooking, isBookingFullySettled } = require("../services/crmWorkflowGuards");
const { createAmendmentRequest } = require("../services/crmAmendments");
const { recalculateBookingGst, EXTRA_WORK_HSN_CODE, getHsnRate } = require("../services/crmGst");

router.use(authMiddleware);
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));

// Same re-derive-from-source pattern as crmParking.js's rollup — delegates
// ParkingTotal/ExtraChargesTotal/GrandTotal AND the fixed HSN-driven GST
// (which re-prices every active parking allotment to the resolved bracket
// rate) to crmGst.js, then redistributes milestones against the truly
// final GrandTotal.
async function rollupBookingTotals(pool, bookingId) {
  await recalculateBookingGst(pool, bookingId);
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

  // GST on every Extra Charge is fixed at the HSN Master's own "Extra Work"
  // rate (9954EXW, 18%) — never taken from ExtraChargeMaster.GstRate or a
  // client-supplied GstRate anymore. ExtraChargeMaster.GstRate is left
  // untouched (other things may still read that column); this route simply
  // stops consuming it, matching "fixed, only editable via HSN Master".
  if (b.ExtraChargeMasterId) {
    const master = await pool.request().input("id", sql.Int, parseInt(b.ExtraChargeMasterId))
      .query("SELECT Id FROM dbo.ExtraChargeMaster WHERE Id = @id AND IsActive = 1");
    if (!master.recordset.length) throw chargeError("Selected charge type is not active");
  }
  const gstRate = await getHsnRate(pool, EXTRA_WORK_HSN_CODE);
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
    .query("SELECT BookingId, ApplicationId, Description, TotalAmount FROM dbo.CrmExtraCharge WHERE Id = @id AND IsActive = 1");
  if (!row.recordset.length) throw chargeError("Extra charge not found", 404);
  const { BookingId, ApplicationId } = row.recordset[0];

  if (BookingId) {
    const activeErr = await requireActiveBooking(pool, BookingId);
    if (activeErr) throw chargeError(activeErr);
  } else if (ApplicationId) {
    const app = await pool.request().input("aid", sql.Int, ApplicationId)
      .query("SELECT Status FROM dbo.CrmApplication WHERE Id = @aid AND IsActive = 1");
    if (app.recordset.length && ![CrmStatus.DRAFT, CrmStatus.PENDING, CrmStatus.REJECTED].includes(app.recordset[0].Status)) {
      throw chargeError(`Cannot change this application's extra work once it is ${app.recordset[0].Status} — this is locked after approval.`);
    }
  }

  // Legacy shape (created before charges were folded into the shared
  // milestones): a dedicated CrmPaymentMilestone still exists for this
  // charge — keep using ITS Status exactly as before, never touch the new
  // blended model for a booking edited this way. New-shape charges (no
  // linked milestone) fall through to the booking-wide settled check.
  const milestone = BookingId
    ? await pool.request().input("ecid", sql.Int, id)
        .query("SELECT TOP 1 Id, Status FROM dbo.CrmPaymentMilestone WHERE ExtraChargeId = @ecid ORDER BY Id DESC")
    : { recordset: [] };
  if (milestone.recordset.length) {
    if (milestone.recordset[0].Status === CrmStatus.PAID) {
      throw chargeError("This charge has already been paid and cannot be edited", 409);
    }
  } else if (BookingId && await isBookingFullySettled(pool, BookingId)) {
    throw chargeError("This booking is fully paid off — charges can no longer be edited", 409);
  }

  const amount = parseFloat(b.Amount);
  if (!b.Description?.trim()) throw chargeError("Description is required");
  if (!Number.isFinite(amount) || amount <= 0) throw chargeError("Amount must be greater than 0");

  // Same fixed HSN-Master rate as applyAddExtraCharge above — never
  // ExtraChargeMaster.GstRate or a client-supplied GstRate.
  if (b.ExtraChargeMasterId) {
    const master = await pool.request().input("id", sql.Int, parseInt(b.ExtraChargeMasterId))
      .query("SELECT Id FROM dbo.ExtraChargeMaster WHERE Id = @id AND IsActive = 1");
    if (!master.recordset.length) throw chargeError("Selected charge type is not active");
  }
  const gstRate = await getHsnRate(pool, EXTRA_WORK_HSN_CODE);
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

  if (BookingId) {
    await rollupBookingTotals(pool, BookingId);
  await logCrmAudit(pool, "Booking", BookingId, actorUserId, [
    { field: "ExtraCharge", oldVal: row.recordset[0].Description, newVal: `${b.Description.trim()} = ₹${totalAmount}` },
    ]);
  } else if (ApplicationId) {
    await logCrmAudit(pool, "Application", ApplicationId, actorUserId, [
      { field: "ExtraWork", oldVal: row.recordset[0].Description, newVal: `${b.Description.trim()} = ${totalAmount}` },
    ]);
  }

  return { TotalAmount: totalAmount };
}

// Extra Work, unlike Parking, is never tied to a scarce/exclusive resource
// (no physical slot to hold) — Application-stage rows are created directly
// (ApplicationId set, BookingId NULL) rather than through a hold-then-
// convert flow. Kept in the shared release/add functions below so both the
// Application step and the Booking tab exercise identical logic.
async function applyAddExtraChargeToApplication(pool, applicationId, b, actorUserId) {
  const amount = parseFloat(b.Amount);
  if (!b.Description?.trim()) throw chargeError("Description is required");
  if (!Number.isFinite(amount) || amount <= 0) throw chargeError("Amount must be greater than 0");

  const app = await pool.request().input("aid", sql.Int, applicationId)
    .query("SELECT Id, Status FROM dbo.CrmApplication WHERE Id = @aid AND IsActive = 1");
  if (!app.recordset.length) throw chargeError("Application not found", 404);
  // Same Draft/Pending gate as Parking's Application-stage step
  // (ParkingSelectionStep) — free to change pre-approval, locked after.
  if (![CrmStatus.DRAFT, CrmStatus.PENDING, CrmStatus.REJECTED].includes(app.recordset[0].Status)) {
    throw chargeError(`Cannot change this application's extra work once it is ${app.recordset[0].Status} — this is locked after approval.`);
  }

  if (b.ExtraChargeMasterId) {
    const master = await pool.request().input("id", sql.Int, parseInt(b.ExtraChargeMasterId))
      .query("SELECT Id FROM dbo.ExtraChargeMaster WHERE Id = @id AND IsActive = 1");
    if (!master.recordset.length) throw chargeError("Selected charge type is not active");
  }
  const gstRate = await getHsnRate(pool, EXTRA_WORK_HSN_CODE);
  const gstAmount = Math.round((amount * gstRate) / 100 * 100) / 100;
  const totalAmount = amount + gstAmount;

  const result = await pool.request()
    .input("aid",  sql.Int, applicationId)
    .input("mid",  sql.Int, b.ExtraChargeMasterId ? parseInt(b.ExtraChargeMasterId) : null)
    .input("desc", sql.NVarChar(300), b.Description.trim())
    .input("amt",  sql.Decimal(18, 2), amount)
    .input("gstr", sql.Decimal(5, 2), gstRate)
    .input("gsta", sql.Decimal(18, 2), gstAmount)
    .input("tot",  sql.Decimal(18, 2), totalAmount)
    .input("cb",   sql.Int, actorUserId)
    .query(`
      INSERT INTO dbo.CrmExtraCharge
        (ApplicationId, ExtraChargeMasterId, Description, Amount, GstRate, GstAmount, TotalAmount, CreatedBy, CreatedAt)
      OUTPUT INSERTED.Id
      VALUES (@aid, @mid, @desc, @amt, @gstr, @gsta, @tot, @cb, SYSDATETIME())
    `);
  const extraChargeId = result.recordset[0].Id;

  await logCrmAudit(pool, "Application", applicationId, actorUserId, [
    { field: "ExtraWork", oldVal: null, newVal: `${b.Description.trim()} = ₹${totalAmount}` },
  ]);

  return { id: extraChargeId, TotalAmount: totalAmount };
}

async function shouldQueueExtraChargeAmendment(pool, bookingId) {
  // Queue only when Agreement is Executed/Registered — not at earlier
  // workflow stages like DirectorApproval/Confirmed where values are
  // still being finalised and should flow through without a queue.
  return isLegalWorkStarted(pool, bookingId);
}

async function applyReleaseExtraCharge(pool, id) {
  const row = await pool.request().input("id", sql.Int, id)
    .query("SELECT BookingId, ApplicationId FROM dbo.CrmExtraCharge WHERE Id = @id AND IsActive = 1");
  if (!row.recordset.length) throw chargeError("Extra charge not found", 404);
  const { BookingId, ApplicationId } = row.recordset[0];

  // Application-stage row (no Booking yet) — gate on the Application's own
  // Draft/Pending status instead of requireActiveBooking (which would
  // wrongly report "Booking not found" for a BookingId that was never
  // supposed to exist yet), and there's no milestone/GST rollup to redo.
  if (!BookingId) {
    if (ApplicationId) {
      const app = await pool.request().input("aid", sql.Int, ApplicationId)
        .query("SELECT Status FROM dbo.CrmApplication WHERE Id = @aid AND IsActive = 1");
      if (app.recordset.length && ![CrmStatus.DRAFT, CrmStatus.PENDING, CrmStatus.REJECTED].includes(app.recordset[0].Status)) {
        throw chargeError(`Cannot change this application's extra work once it is ${app.recordset[0].Status} — this is locked after approval.`);
      }
    }
    await pool.request().input("id", sql.Int, id).query("UPDATE dbo.CrmExtraCharge SET IsActive = 0 WHERE Id = @id");
    return {};
  }

  const activeErr = await requireActiveBooking(pool, BookingId);
  if (activeErr) throw chargeError(activeErr);

  const milestone = await pool.request().input("ecid", sql.Int, id)
    .query("SELECT TOP 1 Id, Status FROM dbo.CrmPaymentMilestone WHERE ExtraChargeId = @ecid ORDER BY Id DESC");
  if (milestone.recordset.length) {
    if (milestone.recordset[0].Status === CrmStatus.PAID) {
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

// GET /application/:applicationId — Extra Work added at the Application
// stage (BookingId still NULL). Registered BEFORE GET /:bookingId
// deliberately — same single-segment greedy-match issue crmParking.js's
// POST /standalone documents ("/application" would otherwise be parsed as
// a bookingId and 404 with a misleading "not found").
router.get("/application/:applicationId", requirePageRight("crm-applications", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const applicationId = parseInt(req.params.applicationId);
    const result = await pool.request().input("aid", sql.Int, applicationId).query(`
      SELECT c.*, m.ChargeName AS MasterChargeName
      FROM dbo.CrmExtraCharge c
      LEFT JOIN dbo.ExtraChargeMaster m ON m.Id = c.ExtraChargeMasterId
      WHERE c.ApplicationId = @aid AND c.IsActive = 1
      ORDER BY c.CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-extra-charges] GET /application error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /application/:applicationId — add Extra Work at the Application
// stage. Non-mandatory, same Draft/Pending lock as Parking's own
// Application-stage step (applyAddExtraChargeToApplication above).
router.post("/application/:applicationId", requirePageRight("crm-applications", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const applicationId = parseInt(req.params.applicationId);
    const result = await applyAddExtraChargeToApplication(pool, applicationId, req.body, actorId(req));
    res.status(201).json({ success: true, ...result });
  } catch (e) {
    console.error("[crm-extra-charges] POST /application error:", e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

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

    if (await isSaleDeedRegistered(pool, bookingId))
      return res.status(409).json({ error: "The Sale Deed for this booking has been registered with the government. Extra charges in a registered Sale Deed are a legal property right and cannot be modified through the ERP. Any changes require a Deed of Rectification at the Sub-Registrar's office." });

    if (await shouldQueueExtraChargeAmendment(pool, bookingId)) {
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
router.put("/:id", requireAnyPageRight(["crm-bookings", "crm-applications"], "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const b = req.body;

    const row = await pool.request().input("id", sql.Int, id)
      .query("SELECT BookingId FROM dbo.CrmExtraCharge WHERE Id = @id AND IsActive = 1");
    if (!row.recordset.length) return res.status(404).json({ error: "Extra charge not found" });
    const bookingId = row.recordset[0].BookingId;

    if (!bookingId) {
      const result = await applyEditExtraCharge(pool, id, b, actorId(req));
      return res.json({ success: true, ...result });
    }

    const activeErr = await requireActiveBooking(pool, bookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });

    if (await isSaleDeedRegistered(pool, bookingId))
      return res.status(409).json({ error: "The Sale Deed for this booking has been registered with the government. Extra charges in a registered Sale Deed are a legal property right and cannot be modified through the ERP. Any changes require a Deed of Rectification at the Sub-Registrar's office." });

    if (await shouldQueueExtraChargeAmendment(pool, bookingId)) {
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
router.delete("/:id", requireAnyPageRight(["crm-bookings", "crm-applications"], "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const reason = req.query.reason || req.body?.Reason;

    const row = await pool.request().input("id", sql.Int, id)
      .query("SELECT BookingId FROM dbo.CrmExtraCharge WHERE Id = @id AND IsActive = 1");
    if (!row.recordset.length) return res.status(404).json({ error: "Extra charge not found" });
    const bookingId = row.recordset[0].BookingId;

    // Application-stage row — no Booking exists yet, so none of the
    // booking-specific guards below apply. applyReleaseExtraCharge itself
    // gates on the Application's own Draft/Pending status instead.
    if (!bookingId) {
      const result = await applyReleaseExtraCharge(pool, id);
      return res.json({ success: true, ...result });
    }

    const activeErr = await requireActiveBooking(pool, bookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });

    if (await isSaleDeedRegistered(pool, bookingId))
      return res.status(409).json({ error: "The Sale Deed for this booking has been registered with the government. Extra charges in a registered Sale Deed are a legal property right and cannot be modified through the ERP. Any changes require a Deed of Rectification at the Sub-Registrar's office." });

    if (await shouldQueueExtraChargeAmendment(pool, bookingId)) {
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
module.exports.applyAddExtraChargeToApplication = applyAddExtraChargeToApplication;
