const express = require("express");
const { CrmStatus } = require("../constants/crmStatuses");
const router = express.Router();
const apiRateLimit = require("../middleware/apiRateLimit");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight, requireAnyPageRight } = require("../middleware/requirePageRight");
const { actorId } = require("../services/saAccess");
const { logCrmAudit } = require("../services/crmAudit");
const { guardAndConvertHold, placeHoldIfNeeded, releaseHold } = require("../services/crmHoldService");
const { getNextDocNumber } = require("../services/docNumber");
const { postCrmParkingPaymentToGL } = require("../services/crmLedger");
const { recordGLPosting } = require("../services/approvalService");
const { recalculateRemainingMilestones, isLegalWorkStarted, isSaleDeedRegistered, isBookingPastFirstApproval, requireActiveBooking, isBookingFullySettled, syncParkingPaymentStatus } = require("../services/crmWorkflowGuards");
const { createAmendmentRequest } = require("../services/crmAmendments");
const { recalculateBookingGst } = require("../services/crmGst");

router.use(authMiddleware);
router.use(apiRateLimit);

// Recomputes CrmBooking.ParkingTotal/ExtraChargesTotal/GrandTotal AND the
// fixed HSN-driven GST (which re-prices every active parking allotment to
// the resolved Unit+Parking bracket rate — see crmGst.js) from the live
// allotment/extra-charge rows — never trust an incrementally maintained
// running total, always re-derive from source rows so it can't drift. Only
// meaningful for unit-linked allotments (BookingId set) — a standalone
// parking-only sale has no CrmBooking to roll into.
async function rollupBookingTotals(pool, bookingId) {
  if (!bookingId) return;
  const gst = await recalculateBookingGst(pool, bookingId);

  // GrandTotal just moved — every not-yet-settled milestone's ₹/% needs to
  // be re-derived against the new (truly final, post-repricing) total, or
  // the payment schedule silently stops adding up to what the customer
  // actually owes. Must run AFTER recalculateBookingGst, not before — it
  // reprices parking and can itself move GrandTotal again.
  await recalculateRemainingMilestones(pool, bookingId);

  return gst ? { parkingTotal: gst.parkingTotal, extraTotal: gst.extraChargesTotal } : { parkingTotal: 0, extraTotal: 0 };
}

// A slot can only ever back one active allotment at a time — same rule as a
// unit only ever having one active (non-Cancelled/Rejected) booking.
//
// `db` must be the active transaction (tx.request()), NOT the bare pool.
// The WITH (UPDLOCK, ROWLOCK) hint turns the availability check into a
// lock-acquisition step: the first concurrent request acquires an exclusive
// lock on the matched row (or a key-range lock when no row exists yet),
// blocking any second concurrent request from passing the same check until
// the first transaction commits. Without this, two simultaneous requests
// for the same slot can both read 0 rows and both proceed to INSERT —
// the exact race that was already fixed for Unit bookings in
// services/crmEntityCreation.js (see the UPDLOCK comment there).
async function assertSlotAvailable(db, parkingSlotId) {
  if (!parkingSlotId) return;
  const existing = await db.request().input("sid", sql.Int, parkingSlotId)
    .query("SELECT Id FROM dbo.CrmParkingAllotment WITH (UPDLOCK, ROWLOCK) WHERE ParkingSlotId = @sid AND IsActive = 1");
  if (existing.recordset.length) {
    const err = new Error("This parking slot is already allotted");
    err.status = 409;
    throw err;
  }
}

function parkingError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// Server-side enforcement of "slot-wise, always" for every ParkingType —
// quantity-only sales (no ParkingSlotId) are no longer supported at all,
// including for a type with zero ParkingSlot rows entered yet. Previously
// that zero-inventory case was silently allowed to sell by count as a
// fallback; that let staff sell "phantom" parking with no slot on record
// before Ops had even set up the physical inventory. Now a type with no
// slots simply cannot be sold until slots exist — GET /available already
// reports HasSlots: false for that case, which the wizard and the
// standalone Parking Booking screen use to grey the option out entirely
// (see CrmApplication.tsx ParkingSelectionStep and CrmParkingBooking.tsx)
// before a request ever reaches this check.
function assertSlotSelected(parkingType, parkingSlotId) {
  if (parkingSlotId) return;
  throw parkingError(`${parkingType} parking must be sold against a specific slot — none is available to select.`);
}

// Resolves the rate card row a given (already-picked) slot belongs to —
// ParkingMaster is unique per (ProjectId, BlockId, ParkingType), so this is
// deterministic. Used when converting an Application-stage hold into a real
// allotment, where the caller only has the slot (not the ParkingMasterId the
// original picker sent, since a hold row carries no such field).
async function resolveParkingRateForSlot(pool, parkingSlotId) {
  const slot = await pool.request().input("sid", sql.Int, parkingSlotId)
    .query("SELECT ProjectId, BlockId, ParkingType FROM dbo.ParkingSlot WHERE Id = @sid AND IsActive = 1");
  if (!slot.recordset.length) return null;
  const { ProjectId, BlockId, ParkingType } = slot.recordset[0];
  const rate = await pool.request()
    .input("pid", sql.Int, ProjectId).input("bid", sql.Int, BlockId).input("pt", sql.NVarChar(50), ParkingType)
    .query(`
      SELECT TOP 1 Id, Charge, GstRate FROM dbo.ParkingMaster
      WHERE ProjectId = @pid AND ParkingType = @pt AND IsActive = 1 AND (BlockId = @bid OR BlockId IS NULL)
      ORDER BY CASE WHEN BlockId = @bid THEN 0 ELSE 1 END
    `);
  return rate.recordset[0] || null;
}

// ParkingMaster is LEFT JOIN — unrated allotments (NeedsRate flow) store
// ParkingMasterId = NULL, so an INNER JOIN would silently exclude them.
// ParkingType falls back to the slot's own type for those rows.
const ALLOTMENT_SELECT = `
  SELECT pa.*,
         COALESCE(p.ParkingType, s.ParkingType) AS CurrentParkingType,
         COALESCE(p.ProjectId,   s.ProjectId)   AS ProjectId,
         COALESCE(p.BlockId,     s.BlockId)      AS BlockId,
         s.SlotNo, a.ApplicantName, a.Mobile,
         b.BookingNo, b.Status AS BookingStatus, b.GrandTotal AS BookingGrandTotal,
         ISNULL((SELECT SUM(AmountPaid) FROM dbo.CrmPaymentMilestone WHERE BookingId = b.Id), 0) AS BookingTotalPaid
  FROM dbo.CrmParkingAllotment pa
  LEFT JOIN dbo.ParkingMaster p ON p.Id = pa.ParkingMasterId
  LEFT JOIN dbo.ParkingSlot s ON s.Id = pa.ParkingSlotId
  LEFT JOIN dbo.CrmApplication a ON a.Id = pa.ApplicationId
  LEFT JOIN dbo.CrmBooking b ON b.Id = pa.BookingId
`;

// Add/Edit/Release applied for real — called directly from the route
// handlers below when legal work hasn't started yet (or the allotment is a
// standalone sale, which never has an Agreement to gate on), and again from
// crmBookingAmendments.js when an approver signs off on a queued request.

async function applyAddParking(pool, bookingId, b, actorUserId) {
  if (!b.ParkingMasterId && !b.ParkingType) throw parkingError("ParkingMasterId or ParkingType is required");
  const qty = b.Quantity != null ? parseInt(b.Quantity) : 1;
  if (!Number.isFinite(qty) || qty < 1) throw parkingError("Quantity must be at least 1");

  const activeErr = await requireActiveBooking(pool, bookingId);
  if (activeErr) throw parkingError(activeErr);

  const booking = await pool.request().input("bid", sql.Int, bookingId)
    .query("SELECT Id, BookingNo, ApplicationId, ProjectId FROM dbo.CrmBooking WHERE Id = @bid AND IsActive = 1");
  if (!booking.recordset.length) throw parkingError("Booking not found", 404);

  let ParkingType, GstRate, Charge;

  if (b.ParkingMasterId) {
    const rate = await pool.request().input("pmid", sql.Int, parseInt(b.ParkingMasterId))
      .query("SELECT Charge, GstRate, ParkingType, ProjectId FROM dbo.ParkingMaster WHERE Id = @pmid AND IsActive = 1");
    if (!rate.recordset.length) throw parkingError("Selected parking rate is not active");
    if (rate.recordset[0].ProjectId !== booking.recordset[0].ProjectId) {
      throw parkingError("This booking is for a different project than the selected parking rate/slot");
    }
    ParkingType = rate.recordset[0].ParkingType;
    GstRate = rate.recordset[0].GstRate;
    // Staff can override the Parking Rate Master's default figure for a genuine
    // one-off negotiated price — falls back to the master rate when omitted.
    Charge = rate.recordset[0].Charge;
    if (b.RateOverride != null && b.RateOverride !== "") {
      const override = parseFloat(b.RateOverride);
      if (!Number.isFinite(override) || override <= 0) throw parkingError("Rate override must be a positive number");
      Charge = override;
    }
  } else {
    // Unrated type — no ParkingMaster row; caller supplies ParkingType + Charge directly.
    if (b.Charge == null || parseFloat(b.Charge) <= 0) throw parkingError("A price is required for unrated parking types");
    ParkingType = b.ParkingType;
    Charge = parseFloat(b.Charge);
    GstRate = b.GstRate != null ? parseFloat(b.GstRate) : 0;
  }

  const parkingSlotId = b.ParkingSlotId ? parseInt(b.ParkingSlotId) : null;
  assertSlotSelected(ParkingType, parkingSlotId);


  const slot = await pool.request().input("sid", sql.Int, parkingSlotId)
    .query("SELECT SlotNo FROM dbo.ParkingSlot WHERE Id = @sid AND IsActive = 1");
  if (!slot.recordset.length) throw parkingError("Selected parking slot is not active");
  const slotNo = slot.recordset[0].SlotNo;

  const lineAmount = Charge * qty;
  const gstAmount = Math.round((lineAmount * GstRate) / 100 * 100) / 100;
  const totalAmount = lineAmount + gstAmount;

  // ── BEGIN ATOMIC SECTION ────────────────────────────────────────────────
  // assertSlotAvailable, guardAndConvertHold, and the INSERT all run inside
  // a single transaction so they are fully atomic:
  //   • assertSlotAvailable (UPDLOCK) locks the slot against concurrent sales.
  //   • guardAndConvertHold converts this application's hold on the same tx
  //     connection — if the INSERT subsequently fails/rolls back, the hold
  //     conversion rolls back too, leaving the slot still held and retryable.
  //     Previously guardAndConvertHold ran outside the tx: a failed INSERT
  //     would permanently orphan the conversion (hold gone, slot unallotted).
  const tx = pool.transaction();
  await tx.begin();
  let allotmentId;
  try {
    await assertSlotAvailable(tx, parkingSlotId);
    await guardAndConvertHold(tx, "Parking", parkingSlotId, booking.recordset[0].ApplicationId);

    const result = await tx.request()
      .input("bid",  sql.Int, bookingId)
      .input("aid",  sql.Int, booking.recordset[0].ApplicationId)
      .input("pmid", sql.Int, b.ParkingMasterId ? parseInt(b.ParkingMasterId) : null)
      .input("sid",  sql.Int, parkingSlotId)
      .input("slot", sql.NVarChar(50), slotNo)
      .input("qty",  sql.Int, qty)
      .input("rate", sql.Decimal(18, 2), Charge)
      .input("gstr", sql.Decimal(5, 2), GstRate)
      .input("gsta", sql.Decimal(18, 2), gstAmount)
      .input("tot",  sql.Decimal(18, 2), totalAmount)
      .input("note", sql.NVarChar(sql.MAX), b.Notes || null)
      .input("cb",   sql.Int, actorUserId)
      .query(`
        INSERT INTO dbo.CrmParkingAllotment
          (BookingId, ApplicationId, ParkingMasterId, ParkingSlotId, ParkingSlotNo, Quantity, RateSnapshot, GstRateSnapshot, GstAmount, TotalAmount, PaymentStatus, Notes, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@bid, @aid, @pmid, @sid, @slot, @qty, @rate, @gstr, @gsta, @tot, 'Pending', @note, @cb, SYSDATETIME())
      `);
    allotmentId = result.recordset[0].Id;
    await tx.commit();
  } catch (txErr) {
    try { await tx.rollback(); } catch (_) { /* already rolled back or connection lost */ }
    throw txErr;
  }
  // ── END ATOMIC SECTION ──────────────────────────────────────────────────

  // No longer gets a dedicated milestone of its own — its ₹ value folds
  // straight into the shared %-based milestones via rollupBookingTotals's
  // recalculateRemainingMilestones call below, spreading proportionally
  // across whatever's still open (already-Paid/Waived stages are left
  // untouched). PaymentStatus is now a synced read of the booking-wide
  // settled state (isBookingFullySettled) rather than tracked per-sale —
  // see crmWorkflowGuards.js.
  await rollupBookingTotals(pool, bookingId);
  await syncParkingPaymentStatus(pool, bookingId);
  await logCrmAudit(pool, "Booking", bookingId, actorUserId, [
    { field: "ParkingAllotment", oldVal: null, newVal: `${ParkingType} x${qty} = ₹${totalAmount}` },
  ]);

  return { id: allotmentId, TotalAmount: totalAmount };
}

async function applyEditParking(pool, id, b) {
  const qty = b.Quantity != null ? parseInt(b.Quantity) : null;
  if (!qty || qty < 1) throw parkingError("Quantity must be at least 1");

  const row = await pool.request().input("id", sql.Int, id)
    .query("SELECT BookingId, PaymentStatus, RateSnapshot, GstRateSnapshot FROM dbo.CrmParkingAllotment WHERE Id = @id AND IsActive = 1");
  if (!row.recordset.length) throw parkingError("Allotment not found", 404);
  const { BookingId, PaymentStatus, RateSnapshot, GstRateSnapshot } = row.recordset[0];
  if (PaymentStatus === CrmStatus.PAID) throw parkingError("This parking sale has already been paid and cannot be edited", 409);
  if (BookingId) {
    const activeErr = await requireActiveBooking(pool, BookingId);
    if (activeErr) throw parkingError(activeErr);
  }

  const milestone = BookingId
    ? await pool.request().input("paid", sql.Int, id)
        .query("SELECT TOP 1 Id, Status FROM dbo.CrmPaymentMilestone WHERE ParkingAllotmentId = @paid ORDER BY Id DESC")
    : { recordset: [] };
  if (milestone.recordset.length && milestone.recordset[0].Status === CrmStatus.PAID) {
    throw parkingError("This parking charge has already been paid and cannot be edited", 409);
  }

  // If the caller supplies a RateOverride, validate it and use it as the new
  // effective per-unit rate; otherwise fall back to the existing RateSnapshot.
  let effectiveRate = Number(RateSnapshot);
  let newRateSnapshot = null; // null means "no change to RateSnapshot column"
  if (b.RateOverride != null && b.RateOverride !== "") {
    const override = parseFloat(b.RateOverride);
    if (isNaN(override) || override < 0) throw parkingError("RateOverride must be a non-negative number");
    effectiveRate = override;
    newRateSnapshot = override;
  }

  const lineAmount = effectiveRate * qty;
  const gstAmount = Math.round((lineAmount * Number(GstRateSnapshot)) / 100 * 100) / 100;
  const totalAmount = lineAmount + gstAmount;

  await pool.request()
    .input("id",   sql.Int, id)
    .input("qty",  sql.Int, qty)
    .input("rate", sql.Decimal(18, 2), newRateSnapshot)
    .input("gsta", sql.Decimal(18, 2), gstAmount)
    .input("tot",  sql.Decimal(18, 2), totalAmount)
    .input("note", sql.NVarChar(sql.MAX), b.Notes !== undefined ? (b.Notes || null) : undefined)
    .query(`
      UPDATE dbo.CrmParkingAllotment SET
        Quantity = @qty,
        RateSnapshot = ISNULL(@rate, RateSnapshot),
        GstAmount = @gsta, TotalAmount = @tot,
        Notes = ISNULL(@note, Notes)
      WHERE Id = @id
    `);

  if (milestone.recordset.length) {
    await pool.request()
      .input("mid", sql.Int, milestone.recordset[0].Id)
      .input("amt", sql.Decimal(18, 2), totalAmount)
      .query(`UPDATE dbo.CrmPaymentMilestone SET AmountDue = @amt, UpdatedAt = SYSDATETIME() WHERE Id = @mid`);
  }

  if (BookingId) {
    await rollupBookingTotals(pool, BookingId);
    await syncParkingPaymentStatus(pool, BookingId);
  }
  return { TotalAmount: totalAmount, RateSnapshot: effectiveRate };
}

async function shouldQueueParkingAmendment(pool, bookingId) {
  // Queue an amendment only when the Agreement is Executed or Registered
  // (physically signed). Before that — even at DirectorApproval/Confirmed
  // workflow stages — parking changes are still in flux and must flow through
  // directly without an approval queue.
  return isLegalWorkStarted(pool, bookingId);
}


// actorUserId/reason are optional so the internal cancellation-cascade
// callers below (releaseAllParkingForApplication) keep working unchanged —
// but the DELETE /:id route always supplies both, since a super_admin-only,
// audit-logged release is the whole point of that endpoint.
// force=true is used only by the amendment-approval path (post-Agreement,
// pre-Sale-Deed-Registration). It bypasses the "already paid" guards because
// an admin has explicitly reviewed and approved this change. If the parking's
// milestone was already paid, it is removed and the credit amount is returned
// so the caller can surface it to the accounts team for refund processing.
async function applyReleaseParking(pool, id, actorUserId = null, reason = null, force = false) {
  const row = await pool.request().input("id", sql.Int, id)
    .query("SELECT BookingId, PaymentStatus FROM dbo.CrmParkingAllotment WHERE Id = @id AND IsActive = 1");
  if (!row.recordset.length) throw parkingError("Allotment not found", 404);
  const { BookingId, PaymentStatus } = row.recordset[0];

  if (!BookingId) {
    if (!force && PaymentStatus === CrmStatus.PAID) {
      throw parkingError("This parking sale has already been paid and cannot be released", 409);
    }
    await pool.request().input("id", sql.Int, id)
      .query("UPDATE dbo.CrmParkingAllotment SET IsActive = 0 WHERE Id = @id");
    if (actorUserId) {
      await logCrmAudit(pool, "ParkingAllotment", id, actorUserId, [
        { field: "Released", oldVal: CrmStatus.ACTIVE, newVal: reason ? `Released — ${reason}` : "Released" },
      ]);
    }
    return {};
  }

  const activeErr = await requireActiveBooking(pool, BookingId);
  if (activeErr) throw parkingError(activeErr);

  // Legacy shape: a dedicated milestone still exists for this sale — keep
  // using its own Status, same as before. New-shape sales (no linked
  // milestone) fall back to the booking-wide settled check instead, since
  // their value has no isolated "paid" point of its own once blended.
  const milestone = await pool.request().input("paid", sql.Int, id)
    .query("SELECT TOP 1 Id, Status, Amount FROM dbo.CrmPaymentMilestone WHERE ParkingAllotmentId = @paid ORDER BY Id DESC");

  let creditAmount = 0;

  if (milestone.recordset.length) {
    if (!force && milestone.recordset[0].Status === CrmStatus.PAID) {
      throw parkingError("This parking charge has already been paid and cannot be released", 409);
    }
    // force path: milestone was paid — record the credit amount for the
    // caller to surface to the accounts team, then remove the milestone so
    // the booking total is recalculated without it.
    if (milestone.recordset[0].Status === CrmStatus.PAID) {
      creditAmount = Number(milestone.recordset[0].Amount || 0);
    }
    await pool.request().input("mid", sql.Int, milestone.recordset[0].Id)
      .query("DELETE FROM dbo.CrmPaymentMilestone WHERE Id = @mid");
  } else if (!force && await isBookingFullySettled(pool, BookingId)) {
    throw parkingError("This booking is fully paid off — parking can no longer be released", 409);
  }

  await pool.request().input("id", sql.Int, id)
    .query("UPDATE dbo.CrmParkingAllotment SET IsActive = 0 WHERE Id = @id");

  await rollupBookingTotals(pool, BookingId);
  await syncParkingPaymentStatus(pool, BookingId);
  if (actorUserId) {
    await logCrmAudit(pool, "Booking", BookingId, actorUserId, [
      { field: "ParkingAllotment", oldVal: CrmStatus.ACTIVE, newVal: reason ? `Released — ${reason}` : "Released" },
    ]);
  }
  return creditAmount > 0 ? { creditAmount, creditNote: `Parking released post-Agreement — ₹${creditAmount.toLocaleString("en-IN")} overpaid. Refund to be processed by accounts team.` } : {};
}

// Cancellation-time release — unlike applyReleaseParking() above, this is
// NOT blocked by an already-Paid milestone: a cancelled booking's slot must
// come back to available inventory regardless of what was already collected
// (that money is accounted for separately in the cancellation's refund
// figures). A Paid milestone is left standing as the historical payment
// record; only a still-open one is removed, same as the normal release path.
// Called from crmCancellations.js right after a cancellation is approved —
// this is the fix for parking slots staying permanently stuck "unavailable"
// on a booking that's already dead.
async function releaseAllParkingForBooking(pool, bookingId) {
  const rows = await pool.request().input("bid", sql.Int, bookingId)
    .query("SELECT Id FROM dbo.CrmParkingAllotment WHERE BookingId = @bid AND IsActive = 1");
  for (const row of rows.recordset) {
    await pool.request().input("id", sql.Int, row.Id)
      .query("UPDATE dbo.CrmParkingAllotment SET IsActive = 0 WHERE Id = @id");
    const milestone = await pool.request().input("paid", sql.Int, row.Id)
      .query("SELECT Id, Status FROM dbo.CrmPaymentMilestone WHERE ParkingAllotmentId = @paid");
    if (milestone.recordset.length && milestone.recordset[0].Status !== CrmStatus.PAID) {
      await pool.request().input("mid", sql.Int, milestone.recordset[0].Id)
        .query("DELETE FROM dbo.CrmPaymentMilestone WHERE Id = @mid");
    }
  }
  // Recalculate booking totals so GrandTotal and remaining milestones reflect
  // the released parking — important for accurate refund figures in the
  // cancellation UI and for audit records.
  if (rows.recordset.length > 0) {
    await rollupBookingTotals(pool, bookingId);
  }
  return { released: rows.recordset.length };
}

// Called from crmApplications.js's Cancel/Reject actions — the Application-
// stage equivalent of releaseAllParkingForBooking() above. Without this,
// cancelling or rejecting an Application released the picked Unit's hold
// (crmHoldService.js) but left any standalone parking slot picked during the
// wizard's Attachments step (a real, permanent CrmParkingAllotment row —
// see POST /standalone below) permanently stuck as "Booked" in the parking
// matrix forever, since nothing ever deactivated it. In practice this only
// ever finds BookingId-IS-NULL rows: the calling routes already refuse to
// cancel/reject an Application that has an active Booking, so anything
// still ApplicationId-linked with a real BookingId at this point is already-
// dead history under a Cancelled/Rejected Booking, cleaned up when that
// Booking itself was cancelled. Reuses applyReleaseParking() per row so the
// existing Paid-guard and milestone cleanup stay identical to every other
// release path — a still-Paid standalone sale is left standing (logged, not
// silently wiped) rather than blocking the whole Application cancellation.
async function releaseAllParkingForApplication(pool, applicationId) {
  const rows = await pool.request().input("aid", sql.Int, applicationId)
    .query("SELECT Id FROM dbo.CrmParkingAllotment WHERE ApplicationId = @aid AND IsActive = 1");
  let released = 0;
  for (const row of rows.recordset) {
    try {
      await applyReleaseParking(pool, row.Id);
      released++;
    } catch (e) {
      console.error("[crm-parking] releaseAllParkingForApplication failed for allotment", row.Id, e.message);
    }
  }
  return { released };
}

// GET / — every parking allotment system-wide (both unit-linked and
// standalone sales) for the dedicated Parking Booking page. Optional
// ?status= filters by PaymentStatus.
router.get("/", requirePageRight("crm-parking-booking", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const { status } = req.query;
    const req0 = pool.request();
    const conds = ["pa.IsActive = 1"];
    if (status) { req0.input("st", sql.NVarChar(20), status); conds.push("pa.PaymentStatus = @st"); }
    const result = await req0.query(`${ALLOTMENT_SELECT} WHERE ${conds.join(" AND ")} ORDER BY pa.CreatedAt DESC`);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-parking] GET / error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /available — every parking rate applicable to a Project(+Block), each
// with the slots that are ACTUALLY free right now: not already a real
// CrmParkingAllotment anywhere in the system, and not sitting under anyone's
// still-Active CrmInventoryHold (any application's — not just the caller's
// own). This is the fix for the Application wizard's old client-side
// approach, which only ever excluded ITS OWN application's picks (from GET
// /application/:applicationId) and so showed every other application's
// booked/held slots as if they were still free. Types sold by count rather
// than a fixed slot (e.g. "Open") come back with HasSlots: false and no cap.
//
// Registered BEFORE GET /:bookingId deliberately — same single-segment
// greedy-match issue documented on POST /standalone above ("/available"
// would otherwise be parsed as a bookingId).
router.get("/available", requireAnyPageRight(["crm-bookings", "crm-parking-booking", "crm-applications"], "view"), async (req, res) => {
  try {
    const pool = getPool();
    const projectId = parseInt(req.query.projectId);
    const blockId = req.query.blockId ? parseInt(req.query.blockId) : null;
    if (!projectId) return res.status(400).json({ error: "projectId is required" });

    const rates = await pool.request()
      .input("pid", sql.Int, projectId).input("bid", sql.Int, blockId)
      .query(`
        WITH RankedRates AS (
          SELECT Id, ParkingType, Charge, GstRate, BlockId,
            ROW_NUMBER() OVER(
              PARTITION BY ParkingType 
              ORDER BY CASE WHEN BlockId = @bid THEN 0 ELSE 1 END
            ) as rn
          FROM dbo.ParkingMaster
          WHERE ProjectId = @pid AND IsActive = 1 
            AND (BlockId = @bid OR BlockId IS NULL)
        )
        SELECT Id, ParkingType, Charge, GstRate, BlockId
        FROM RankedRates
        WHERE rn = 1
      `);

    const slots = await pool.request()
      .input("pid", sql.Int, projectId).input("bid", sql.Int, blockId)
      .query(`
        SELECT s.Id, s.SlotNo, s.ParkingType
        FROM dbo.ParkingSlot s
        WHERE s.ProjectId = @pid AND s.IsActive = 1 AND (@bid IS NULL OR s.BlockId IS NULL OR s.BlockId = @bid)
        AND s.Id NOT IN (
          SELECT ParkingSlotId FROM dbo.CrmParkingAllotment WHERE IsActive = 1 AND ParkingSlotId IS NOT NULL
          UNION
          SELECT EntityId FROM dbo.CrmInventoryHold WHERE EntityType = 'Parking' AND Status = '${CrmStatus.ACTIVE}' AND HoldUntil >= SYSDATETIME()
        )
        ORDER BY s.SlotNo
      `);

    const slotsByType = new Map();
    for (const s of slots.recordset) {
      if (!slotsByType.has(s.ParkingType)) slotsByType.set(s.ParkingType, []);
      slotsByType.get(s.ParkingType).push({ Id: s.Id, SlotNo: s.SlotNo });
    }

    const slotsAnyBlock = await pool.request().input("pid", sql.Int, projectId)
      .query(`
        SELECT s.ParkingType, COUNT(*) AS FreeCount
        FROM dbo.ParkingSlot s
        WHERE s.ProjectId = @pid AND s.IsActive = 1
        AND s.Id NOT IN (
          SELECT ParkingSlotId FROM dbo.CrmParkingAllotment WHERE IsActive = 1 AND ParkingSlotId IS NOT NULL
          UNION
          SELECT EntityId FROM dbo.CrmInventoryHold WHERE EntityType = 'Parking' AND Status = '${CrmStatus.ACTIVE}' AND HoldUntil >= SYSDATETIME()
        )
        GROUP BY s.ParkingType
      `);
    const freeCountByType = new Map(slotsAnyBlock.recordset.map((r) => [r.ParkingType, r.FreeCount]));

    const anySlotOfType = await pool.request().input("pid", sql.Int, projectId).query(`
      SELECT DISTINCT ParkingType FROM dbo.ParkingSlot WHERE ProjectId = @pid AND IsActive = 1
    `);
    const typesWithInventory = new Set(anySlotOfType.recordset.map((r) => r.ParkingType));

    const out = rates.recordset.map((r) => {
      const hasInventory = typesWithInventory.has(r.ParkingType);
      const blockScoped = slotsByType.get(r.ParkingType) || [];
      const freeAnyBlock = freeCountByType.get(r.ParkingType) || 0;
      return {
        ParkingMasterId: r.Id, ParkingType: r.ParkingType, Charge: r.Charge, GstRate: r.GstRate,
        HasSlots: hasInventory,
        NoInventory: !hasInventory,
        AvailableSlots: blockScoped,
        SoldOutProjectWide: blockId != null && freeAnyBlock === 0,
        FreeCountProjectWide: freeAnyBlock,
      };
    });

    const ratedTypes = new Set(rates.recordset.map((r) => r.ParkingType));
    const unratedTypesWithInventory = [...typesWithInventory].filter((t) => !ratedTypes.has(t));

    // Include unrated types so staff can still select them and enter a price manually.
    const unratedOut = unratedTypesWithInventory.map((type) => {
      const blockScoped = slotsByType.get(type) || [];
      const freeAnyBlock = freeCountByType.get(type) || 0;
      return {
        ParkingMasterId: null, ParkingType: type, Charge: null, GstRate: 0,
        HasSlots: true, NoInventory: false, NeedsRate: true,
        AvailableSlots: blockScoped,
        SoldOutProjectWide: blockId != null && freeAnyBlock === 0,
        FreeCountProjectWide: freeAnyBlock,
      };
    });

    res.json({ rates: [...out, ...unratedOut], unratedTypesWithInventory });
  } catch (e) {
    console.error("[crm-parking] GET /available error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /:bookingId — list parking allotments for a booking (unit-linked view)
router.get("/:bookingId", requirePageRight("crm-bookings", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const bookingId = parseInt(req.params.bookingId);
    const result = await pool.request().input("bid", sql.Int, bookingId)
      .query(`${ALLOTMENT_SELECT} WHERE pa.BookingId = @bid AND pa.IsActive = 1 ORDER BY pa.CreatedAt DESC`);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-parking] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /application/:applicationId — every parking allotment a customer
// holds, whether sold alongside a unit booking or bought standalone, PLUS
// any still-Active Application-stage holds on a specific slot that haven't
// converted into a real allotment yet (see POST /standalone below). Both
// shapes are merged into one array — real rows carry Kind: 'Allotment',
// pending picks carry Kind: 'Hold' — so this stays the single "one
// customer, unit + parking together" view the Application wizard's Parking
// step (and takenSlotIds availability check) reads from.
router.get("/application/:applicationId", requireAnyPageRight(["crm-bookings", "crm-parking-booking", "crm-applications"], "view"), async (req, res) => {
  try {
    const pool = getPool();
    const applicationId = parseInt(req.params.applicationId);
    const result = await pool.request().input("aid", sql.Int, applicationId)
      .query(`${ALLOTMENT_SELECT} WHERE pa.ApplicationId = @aid AND pa.IsActive = 1 ORDER BY pa.CreatedAt DESC`);
    const allotments = result.recordset.map((r) => ({ ...r, Kind: "Allotment" }));

    const holdRows = await pool.request().input("aid", sql.Int, applicationId).query(`
      SELECT h.Id, h.EntityId AS ParkingSlotId, h.HoldUntil, h.RateOverride, s.SlotNo, s.ParkingType, s.ProjectId, s.BlockId
      FROM dbo.CrmInventoryHold h
      JOIN dbo.ParkingSlot s ON s.Id = h.EntityId
      WHERE h.EntityType = 'Parking' AND h.ApplicationId = @aid AND h.Status = '${CrmStatus.ACTIVE}' AND h.HoldUntil >= SYSDATETIME()
    `);
    const holds = [];
    for (const h of holdRows.recordset) {
      const rate = await resolveParkingRateForSlot(pool, h.ParkingSlotId);
      // A staff-typed RateOverride (see POST /standalone) always wins over
      // the master rate — same "defaults but overridable" figure the real
      // allotment will snapshot once this hold converts at booking creation.
      const lineAmount = h.RateOverride != null ? Number(h.RateOverride) : (rate ? rate.Charge : 0);
      const gstRate = rate ? rate.GstRate : 0;
      const gstAmount = Math.round((lineAmount * gstRate) / 100 * 100) / 100;
      holds.push({
        Id: h.Id, Kind: "Hold", ParkingSlotId: h.ParkingSlotId, SlotNo: h.SlotNo,
        CurrentParkingType: h.ParkingType, Quantity: 1,
        RateSnapshot: lineAmount, DefaultRate: rate ? rate.Charge : 0,
        TotalAmount: lineAmount + gstAmount, HoldUntil: h.HoldUntil,
      });
    }

    res.json([...allotments, ...holds]);
  } catch (e) {
    console.error("[crm-parking] GET /application error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /standalone — buy parking only, no unit booking involved at all.
// Registered BEFORE POST /:bookingId deliberately — Express matches routes
// in registration order, and "/:bookingId" is a single-segment param that
// would otherwise greedily match the literal path "/standalone" too.
router.post("/standalone", requireAnyPageRight(["crm-bookings", "crm-parking-booking", "crm-applications"], "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    if (!b.ApplicationId) return res.status(400).json({ error: "ApplicationId is required — parking must be sold to a real customer/applicant" });
    if (!b.ParkingMasterId && !b.ParkingType) return res.status(400).json({ error: "ParkingMasterId or ParkingType is required" });
    const qty = b.Quantity != null ? parseInt(b.Quantity) : 1;
    if (!Number.isFinite(qty) || qty < 1) return res.status(400).json({ error: "Quantity must be at least 1" });

    const application = await pool.request().input("aid", sql.Int, parseInt(b.ApplicationId))
      .query("SELECT Id, ProjectId, Status FROM dbo.CrmApplication WHERE Id = @aid AND IsActive = 1");
    if (!application.recordset.length) return res.status(404).json({ error: "Application not found" });

    let ParkingType, Charge, GstRate;

    if (b.ParkingMasterId) {
      const rate = await pool.request().input("pmid", sql.Int, parseInt(b.ParkingMasterId))
        .query("SELECT Charge, GstRate, ParkingType, ProjectId FROM dbo.ParkingMaster WHERE Id = @pmid AND IsActive = 1");
      if (!rate.recordset.length) return res.status(400).json({ error: "Selected parking rate is not active" });
      if (rate.recordset[0].ProjectId !== application.recordset[0].ProjectId) {
        return res.status(400).json({ error: "This Application is for a different project than the selected parking rate/slot" });
      }
      ParkingType = rate.recordset[0].ParkingType;
      GstRate = rate.recordset[0].GstRate;
      // Defaults to the Parking Rate Master's own figure — staff can type a
      // different amount for a genuine one-off negotiated price.
      Charge = rate.recordset[0].Charge;
      if (b.RateOverride != null && b.RateOverride !== "") {
        const override = parseFloat(b.RateOverride);
        if (!Number.isFinite(override) || override <= 0) return res.status(400).json({ error: "Rate override must be a positive number" });
        Charge = override;
      }
    } else {
      // Unrated parking type — no ParkingMaster row exists yet; price is mandatory.
      if (b.RateOverride == null || b.RateOverride === "") {
        return res.status(400).json({ error: "A price is required for parking types without a configured rate" });
      }
      const override = parseFloat(b.RateOverride);
      if (!Number.isFinite(override) || override <= 0) return res.status(400).json({ error: "Price must be a positive number" });
      ParkingType = b.ParkingType;
      Charge = override;
      GstRate = 0;
    }

    const parkingSlotId = b.ParkingSlotId ? parseInt(b.ParkingSlotId) : null;
    assertSlotSelected(ParkingType, parkingSlotId);

    const lineAmount = Charge * qty;
    const gstAmount = Math.round((lineAmount * GstRate) / 100 * 100) / 100;
    const totalAmount = lineAmount + gstAmount;

    const slot = await pool.request().input("sid", sql.Int, parkingSlotId)
      .query("SELECT SlotNo FROM dbo.ParkingSlot WHERE Id = @sid AND IsActive = 1");
    if (!slot.recordset.length) return res.status(400).json({ error: "Selected parking slot is not active" });
    const slotNo = slot.recordset[0].SlotNo;

    if (!b.Immediate) {
      if (![CrmStatus.DRAFT, CrmStatus.PENDING, CrmStatus.REJECTED].includes(application.recordset[0].Status)) {
        return res.status(400).json({
          error: `Cannot change this application's parking selection once it is ${application.recordset[0].Status} — this is locked after approval.`,
        });
      }

      const hold = await placeHoldIfNeeded(pool, {
        entityType: "Parking", entityId: parkingSlotId, applicationId: parseInt(b.ApplicationId),
        holdDays: 3, reason: "Application — parking slot selected", userId: actorId(req),
      });

      // placeHold's own INSERT is shared with Unit holds (no rate concept
      // there), so the override is stamped on afterward rather than
      // threaded through it — has to survive on the hold row until the
      // Booking is created, where crmEntityCreation.js reads it back to
      // carry the same figure into the real CrmParkingAllotment.
      if (b.RateOverride != null && b.RateOverride !== "") {
        await pool.request().input("id", sql.Int, hold.id).input("ov", sql.Decimal(18, 2), Charge)
          .query("UPDATE dbo.CrmInventoryHold SET RateOverride = @ov WHERE Id = @id");
      }

      await logCrmAudit(pool, "Application", parseInt(b.ApplicationId), actorId(req), [
        { field: "ParkingHold", oldVal: null, newVal: `${ParkingType} ${slotNo} held until ${hold.holdUntil}` },
      ]);

      return res.status(201).json({
        success: true, hold: true, id: hold.id, holdUntil: hold.holdUntil,
        SlotNo: slotNo, TotalAmount: totalAmount,
      });
    }

    // ── BEGIN ATOMIC SECTION ──────────────────────────────────────────────
    // assertSlotAvailable (UPDLOCK), guardAndConvertHold, and the INSERT all
    // run on the same transaction connection:
    //   • assertSlotAvailable locks the slot against concurrent sales.
    //   • guardAndConvertHold converts this application's hold atomically —
    //     if the INSERT fails, the conversion rolls back, leaving the slot
    //     still held and the application able to retry cleanly.
    const tx = pool.transaction();
    await tx.begin();
    let newId;
    try {
      await assertSlotAvailable(tx, parkingSlotId);
      await guardAndConvertHold(tx, "Parking", parkingSlotId, parseInt(b.ApplicationId));

      const result = await tx.request()
        .input("aid",  sql.Int, parseInt(b.ApplicationId))
        .input("pmid", sql.Int, b.ParkingMasterId ? parseInt(b.ParkingMasterId) : null)
        .input("sid",  sql.Int, parkingSlotId)
        .input("slot", sql.NVarChar(50), slotNo)
        .input("qty",  sql.Int, qty)
        .input("rate", sql.Decimal(18, 2), Charge)
        .input("gstr", sql.Decimal(5, 2), GstRate)
        .input("gsta", sql.Decimal(18, 2), gstAmount)
        .input("tot",  sql.Decimal(18, 2), totalAmount)
        .input("note", sql.NVarChar(sql.MAX), b.Notes || null)
        .input("cb",   sql.Int, actorId(req))
        .query(`
          INSERT INTO dbo.CrmParkingAllotment
            (BookingId, ApplicationId, ParkingMasterId, ParkingSlotId, ParkingSlotNo, Quantity, RateSnapshot, GstRateSnapshot, GstAmount, TotalAmount, PaymentStatus, Notes, CreatedBy, CreatedAt)
          OUTPUT INSERTED.Id
          VALUES (NULL, @aid, @pmid, @sid, @slot, @qty, @rate, @gstr, @gsta, @tot, 'Pending', @note, @cb, SYSDATETIME())
        `);
      newId = result.recordset[0].Id;
      await tx.commit();
    } catch (txErr) {
      try { await tx.rollback(); } catch (_) { /* already rolled back or connection lost */ }
      throw txErr;
    }
    // ── END ATOMIC SECTION ────────────────────────────────────────────────

    await logCrmAudit(pool, "Application", parseInt(b.ApplicationId), actorId(req), [
      { field: "StandaloneParkingAllotment", oldVal: null, newVal: `${ParkingType} x${qty} = ₹${totalAmount}` },
    ]);

    res.status(201).json({ success: true, id: newId, TotalAmount: totalAmount });
  } catch (e) {
    console.error("[crm-parking] POST /standalone error:", e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

// DELETE /hold/:holdId — release an Application-stage parking hold.
router.delete("/hold/:holdId", requireAnyPageRight(["crm-bookings", "crm-parking-booking", "crm-applications"], "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const holdId = parseInt(req.params.holdId);
    const row = await pool.request().input("id", sql.Int, holdId)
      .query("SELECT EntityType, ApplicationId FROM dbo.CrmInventoryHold WHERE Id = @id AND Status = 'Active'");
    if (!row.recordset.length || row.recordset[0].EntityType !== "Parking") {
      return res.status(404).json({ error: "Active parking hold not found" });
    }
    if (row.recordset[0].ApplicationId) {
      const app = await pool.request().input("aid", sql.Int, row.recordset[0].ApplicationId)
        .query("SELECT Status FROM dbo.CrmApplication WHERE Id = @aid AND IsActive = 1");
      if (app.recordset.length && ![CrmStatus.DRAFT, CrmStatus.PENDING, CrmStatus.REJECTED].includes(app.recordset[0].Status)) {
        return res.status(400).json({
          error: `Cannot change this application's parking selection once it is ${app.recordset[0].Status} — this is locked after approval.`,
        });
      }
    }
    await releaseHold(pool, holdId, actorId(req));
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-parking] DELETE /hold error:", e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

// POST /:bookingId — allot parking alongside a unit booking.
router.post("/:bookingId", requirePageRight("crm-bookings", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const bookingId = parseInt(req.params.bookingId);
    const b = req.body;

    const activeErr = await requireActiveBooking(pool, bookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });

    if (await isSaleDeedRegistered(pool, bookingId))
      return res.status(409).json({ error: "The Sale Deed for this booking has been registered with the government. Parking allotments in a registered Sale Deed are a legal property right and cannot be modified through the ERP. Any changes require a Deed of Rectification at the Sub-Registrar's office." });

    if (await shouldQueueParkingAmendment(pool, bookingId)) {
      if (!b.Reason?.trim()) return res.status(400).json({ error: "A reason is required to request this change — legal documents are already under verification for this booking" });
      const requestId = await createAmendmentRequest(pool, {
        bookingId, changeType: "ParkingAllotment", action: "Add", targetId: null,
        proposedChange: b, reason: b.Reason.trim(), requestedBy: actorId(req),
      });
      return res.status(202).json({ pending: true, requestId, message: "Legal documents are already under verification — this change needs approval before it applies." });
    }

    const result = await applyAddParking(pool, bookingId, b, actorId(req));
    res.status(201).json({ success: true, ...result });
  } catch (e) {
    console.error("[crm-parking] POST error:", e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

// PUT /:id — edit an existing allotment's quantity.
router.put("/:id", requireAnyPageRight(["crm-bookings", "crm-parking-booking", "crm-applications"], "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const b = req.body || {};

    const existing = await pool.request().input("id", sql.Int, id)
      .query("SELECT BookingId FROM dbo.CrmParkingAllotment WHERE Id = @id AND IsActive = 1");
    if (!existing.recordset.length) return res.status(404).json({ error: "Allotment not found" });
    const bookingId = existing.recordset[0].BookingId;

    if (bookingId) {
      const activeErr = await requireActiveBooking(pool, bookingId);
      if (activeErr) return res.status(400).json({ error: activeErr });
    }

    if (bookingId && await isSaleDeedRegistered(pool, bookingId))
      return res.status(409).json({ error: "The Sale Deed for this booking has been registered with the government. Parking allotments in a registered Sale Deed are a legal property right and cannot be modified through the ERP. Any changes require a Deed of Rectification at the Sub-Registrar's office." });

    if (bookingId && await shouldQueueParkingAmendment(pool, bookingId)) {
      if (!b.Reason?.trim()) return res.status(400).json({ error: "A reason is required to request this change — legal documents are already under verification for this booking" });
      const requestId = await createAmendmentRequest(pool, {
        bookingId, changeType: "ParkingAllotment", action: "Edit", targetId: id,
        proposedChange: b, reason: b.Reason.trim(), requestedBy: actorId(req),
      });
      return res.status(202).json({ pending: true, requestId, message: "Legal documents are already under verification — this change needs approval before it applies." });
    }

    const result = await applyEditParking(pool, id, b);
    res.json({ success: true, ...result });
  } catch (e) {
    console.error("[crm-parking] PUT error:", e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

// PUT /:id/mark-paid — record payment for a standalone parking sale only.
router.put("/:id/mark-paid", requireAnyPageRight(["crm-bookings", "crm-parking-booking"], "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const b = req.body || {};
    const row = await pool.request().input("id", sql.Int, id)
      .query("SELECT BookingId, PaymentStatus FROM dbo.CrmParkingAllotment WHERE Id = @id AND IsActive = 1");
    if (!row.recordset.length) return res.status(404).json({ error: "Allotment not found" });
    if (row.recordset[0].BookingId) {
      return res.status(400).json({ error: "This parking sale is linked to a booking — record payment through the booking's payment schedule instead" });
    }

    const receiptNo = await getNextDocNumber(pool, "PARK", "PARK");
    await pool.request()
      .input("id", sql.Int, id)
      .input("no", sql.NVarChar(30), receiptNo)
      .input("mode", sql.NVarChar(50), b.PaymentMode || null)
      .input("dt", sql.Date, b.ReceivedDate || null)
      .query(`
        UPDATE dbo.CrmParkingAllotment SET
          PaymentStatus = '${CrmStatus.PAID}', ReceiptNo = @no, PaymentMode = @mode,
          PaymentReceivedDate = ISNULL(@dt, CAST(SYSDATETIME() AS DATE))
        WHERE Id = @id
      `);

    const actorEmail = req.user?.name || req.user?.email || "system";
    try {
      const outcome = await postCrmParkingPaymentToGL(pool, id, actorEmail);
      await recordGLPosting("crm-parking-payment", id, outcome, actorEmail);
    } catch (glErr) {
      console.error("[crm-parking] GL posting failed:", glErr.message);
      await recordGLPosting("crm-parking-payment", id, { failed: true, reason: glErr.message }, actorEmail);
    }

    res.json({ success: true, status: CrmStatus.PAID, ReceiptNo: receiptNo });
  } catch (e) {
    console.error("[crm-parking] mark-paid error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /:id — release a parking allotment (soft delete).
//
// Restricted to super_admin at the API level — not just hidden in the UI.
// requireAnyPageRight alone is held by ordinary Sales/CRM staff, so without
// this server-side check anyone with edit rights could call this endpoint
// directly and bypass the frontend gate entirely.
//
// Reason is required only when routing through the amendment queue (agreement
// Executed/Registered). For direct releases (normal booking workflow) it is
// optional — recorded in the audit trail when supplied, silent when not.
router.delete("/:id", requireAnyPageRight(["crm-bookings", "crm-parking-booking", "crm-applications"], "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const reason = (req.query.reason || req.body?.Reason || "").trim();

    const row = await pool.request().input("id", sql.Int, id)
      .query("SELECT BookingId FROM dbo.CrmParkingAllotment WHERE Id = @id AND IsActive = 1");
    if (!row.recordset.length) return res.status(404).json({ error: "Allotment not found" });
    const bookingId = row.recordset[0].BookingId;

    if (bookingId) {
      const activeErr = await requireActiveBooking(pool, bookingId);
      if (activeErr) return res.status(400).json({ error: activeErr });
    }

    if (bookingId && await isSaleDeedRegistered(pool, bookingId))
      return res.status(409).json({ error: "The Sale Deed for this booking has been registered with the government. Parking allotments in a registered Sale Deed are a legal property right and cannot be modified through the ERP. Any changes require a Deed of Rectification at the Sub-Registrar's office." });

    if (bookingId && await shouldQueueParkingAmendment(pool, bookingId)) {
      if (!reason) return res.status(400).json({ error: "A reason is required — the Agreement is executed and this change must go through the amendment queue" });
      const requestId = await createAmendmentRequest(pool, {
        bookingId, changeType: "ParkingAllotment", action: "Release", targetId: id,
        proposedChange: {}, reason, requestedBy: actorId(req),
      });
      return res.status(202).json({ pending: true, requestId, message: "Legal documents are already under verification — this change needs approval before it applies." });
    }

    const result = await applyReleaseParking(pool, id, actorId(req), reason);
    res.json({ success: true, ...result });
  } catch (e) {
    console.error("[crm-parking] DELETE error:", e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

module.exports = router;
module.exports.rollupBookingTotals = rollupBookingTotals;
module.exports.applyAddParking = applyAddParking;
module.exports.applyEditParking = applyEditParking;
module.exports.applyReleaseParking = applyReleaseParking;
module.exports.releaseAllParkingForBooking = releaseAllParkingForBooking;
module.exports.releaseAllParkingForApplication = releaseAllParkingForApplication;
