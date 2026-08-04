const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight, requireAnyPageRight } = require("../middleware/requirePageRight");
const { actorId } = require("../services/saAccess");
const { logCrmAudit } = require("../services/crmAudit");
const { guardAndConvertHold, placeHoldIfNeeded, releaseHold } = require("../services/crmHoldService");
const { getNextDocNumber } = require("../services/docNumber");
const { postCrmParkingPaymentToGL } = require("../services/crmLedger");
const { recordGLPosting } = require("../services/approvalService");
const { recalculateRemainingMilestones, isLegalWorkStarted, requireActiveBooking, isBookingFullySettled, syncParkingPaymentStatus } = require("../services/crmWorkflowGuards");
const { createAmendmentRequest } = require("../services/crmAmendments");
const { recalculateBookingGst } = require("../services/crmGst");

router.use(authMiddleware);
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));

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
async function assertSlotAvailable(pool, parkingSlotId) {
  if (!parkingSlotId) return;
  const existing = await pool.request().input("sid", sql.Int, parkingSlotId)
    .query("SELECT Id FROM dbo.CrmParkingAllotment WHERE ParkingSlotId = @sid AND IsActive = 1");
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

const ALLOTMENT_SELECT = `
  SELECT pa.*, p.ParkingType AS CurrentParkingType, p.ProjectId, p.BlockId,
         s.SlotNo, a.ApplicantName, a.Mobile, b.BookingNo
  FROM dbo.CrmParkingAllotment pa
  JOIN dbo.ParkingMaster p ON p.Id = pa.ParkingMasterId
  LEFT JOIN dbo.ParkingSlot s ON s.Id = pa.ParkingSlotId
  LEFT JOIN dbo.CrmApplication a ON a.Id = pa.ApplicationId
  LEFT JOIN dbo.CrmBooking b ON b.Id = pa.BookingId
`;

// Add/Edit/Release applied for real — called directly from the route
// handlers below when legal work hasn't started yet (or the allotment is a
// standalone sale, which never has an Agreement to gate on), and again from
// crmBookingAmendments.js when an approver signs off on a queued request.

async function applyAddParking(pool, bookingId, b, actorUserId) {
  if (!b.ParkingMasterId) throw parkingError("ParkingMasterId is required");
  const qty = b.Quantity != null ? parseInt(b.Quantity) : 1;
  if (!Number.isFinite(qty) || qty < 1) throw parkingError("Quantity must be at least 1");

  const activeErr = await requireActiveBooking(pool, bookingId);
  if (activeErr) throw parkingError(activeErr);

  const booking = await pool.request().input("bid", sql.Int, bookingId)
    .query("SELECT Id, BookingNo, ApplicationId, ProjectId FROM dbo.CrmBooking WHERE Id = @bid AND IsActive = 1");
  if (!booking.recordset.length) throw parkingError("Booking not found", 404);

  const rate = await pool.request().input("pmid", sql.Int, parseInt(b.ParkingMasterId))
    .query("SELECT Charge, GstRate, ParkingType, ProjectId FROM dbo.ParkingMaster WHERE Id = @pmid AND IsActive = 1");
  if (!rate.recordset.length) throw parkingError("Selected parking rate is not active");
  const { Charge, GstRate, ParkingType } = rate.recordset[0];

  // Same rule already enforced for standalone parking sales (POST
  // /standalone below) and hold placement (crmHoldService.js placeHold) —
  // without it, parking from one Project's rate card could get sold onto a
  // Booking for a different Project entirely, a nonsensical record that'd
  // never reconcile against real inventory. This unit-linked path was
  // missing the check both of its siblings already have.
  if (rate.recordset[0].ProjectId !== booking.recordset[0].ProjectId) {
    throw parkingError("This booking is for a different project than the selected parking rate/slot");
  }

  const parkingSlotId = b.ParkingSlotId ? parseInt(b.ParkingSlotId) : null;
  assertSlotSelected(ParkingType, parkingSlotId);
  await assertSlotAvailable(pool, parkingSlotId);
  await guardAndConvertHold(pool, "Parking", parkingSlotId, booking.recordset[0].ApplicationId);
  const slot = await pool.request().input("sid", sql.Int, parkingSlotId)
    .query("SELECT SlotNo FROM dbo.ParkingSlot WHERE Id = @sid AND IsActive = 1");
  if (!slot.recordset.length) throw parkingError("Selected parking slot is not active");
  const slotNo = slot.recordset[0].SlotNo;

  const lineAmount = Charge * qty;
  const gstAmount = Math.round((lineAmount * GstRate) / 100 * 100) / 100;
  const totalAmount = lineAmount + gstAmount;

  const result = await pool.request()
    .input("bid",  sql.Int, bookingId)
    .input("aid",  sql.Int, booking.recordset[0].ApplicationId)
    .input("pmid", sql.Int, parseInt(b.ParkingMasterId))
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
  const allotmentId = result.recordset[0].Id;

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
  if (PaymentStatus === "Paid") throw parkingError("This parking sale has already been paid and cannot be edited", 409);
  if (BookingId) {
    const activeErr = await requireActiveBooking(pool, BookingId);
    if (activeErr) throw parkingError(activeErr);
  }

  const milestone = BookingId
    ? await pool.request().input("paid", sql.Int, id)
        .query("SELECT TOP 1 Id, Status FROM dbo.CrmPaymentMilestone WHERE ParkingAllotmentId = @paid ORDER BY Id DESC")
    : { recordset: [] };
  if (milestone.recordset.length && milestone.recordset[0].Status === "Paid") {
    throw parkingError("This parking charge has already been paid and cannot be edited", 409);
  }

  const lineAmount = Number(RateSnapshot) * qty;
  const gstAmount = Math.round((lineAmount * Number(GstRateSnapshot)) / 100 * 100) / 100;
  const totalAmount = lineAmount + gstAmount;

  await pool.request()
    .input("id",   sql.Int, id)
    .input("qty",  sql.Int, qty)
    .input("gsta", sql.Decimal(18, 2), gstAmount)
    .input("tot",  sql.Decimal(18, 2), totalAmount)
    .input("note", sql.NVarChar(sql.MAX), b.Notes !== undefined ? (b.Notes || null) : undefined)
    .query(`
      UPDATE dbo.CrmParkingAllotment SET
        Quantity = @qty, GstAmount = @gsta, TotalAmount = @tot,
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
  return { TotalAmount: totalAmount };
}

async function applyReleaseParking(pool, id) {
  const row = await pool.request().input("id", sql.Int, id)
    .query("SELECT BookingId, PaymentStatus FROM dbo.CrmParkingAllotment WHERE Id = @id AND IsActive = 1");
  if (!row.recordset.length) throw parkingError("Allotment not found", 404);
  const { BookingId, PaymentStatus } = row.recordset[0];

  if (!BookingId) {
    if (PaymentStatus === "Paid") {
      throw parkingError("This parking sale has already been paid and cannot be released", 409);
    }
    await pool.request().input("id", sql.Int, id)
      .query("UPDATE dbo.CrmParkingAllotment SET IsActive = 0 WHERE Id = @id");
    return {};
  }

  const activeErr = await requireActiveBooking(pool, BookingId);
  if (activeErr) throw parkingError(activeErr);

  // Legacy shape: a dedicated milestone still exists for this sale — keep
  // using its own Status, same as before. New-shape sales (no linked
  // milestone) fall back to the booking-wide settled check instead, since
  // their value has no isolated "paid" point of its own once blended.
  const milestone = await pool.request().input("paid", sql.Int, id)
    .query("SELECT TOP 1 Id, Status FROM dbo.CrmPaymentMilestone WHERE ParkingAllotmentId = @paid ORDER BY Id DESC");
  if (milestone.recordset.length) {
    if (milestone.recordset[0].Status === "Paid") {
      throw parkingError("This parking charge has already been paid and cannot be released", 409);
    }
  } else if (await isBookingFullySettled(pool, BookingId)) {
    throw parkingError("This booking is fully paid off — parking can no longer be released", 409);
  }

  await pool.request().input("id", sql.Int, id)
    .query("UPDATE dbo.CrmParkingAllotment SET IsActive = 0 WHERE Id = @id");
  if (milestone.recordset.length) {
    await pool.request().input("mid", sql.Int, milestone.recordset[0].Id)
      .query("DELETE FROM dbo.CrmPaymentMilestone WHERE Id = @mid");
  }

  await rollupBookingTotals(pool, BookingId);
  await syncParkingPaymentStatus(pool, BookingId);
  return {};
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
    if (milestone.recordset.length && milestone.recordset[0].Status !== "Paid") {
      await pool.request().input("mid", sql.Int, milestone.recordset[0].Id)
        .query("DELETE FROM dbo.CrmPaymentMilestone WHERE Id = @mid");
    }
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
router.get("/available", requireAnyPageRight(["crm-bookings", "crm-parking-booking"], "view"), async (req, res) => {
  try {
    const pool = getPool();
    const projectId = parseInt(req.query.projectId);
    const blockId = req.query.blockId ? parseInt(req.query.blockId) : null;
    if (!projectId) return res.status(400).json({ error: "projectId is required" });

    const rates = await pool.request()
      .input("pid", sql.Int, projectId).input("bid", sql.Int, blockId)
      .query(`
        SELECT Id, ParkingType, Charge, GstRate, BlockId
        FROM dbo.ParkingMaster
        WHERE ProjectId = @pid AND IsActive = 1 AND (BlockId IS NULL OR @bid IS NULL OR BlockId = @bid)
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
          SELECT EntityId FROM dbo.CrmInventoryHold WHERE EntityType = 'Parking' AND Status = 'Active' AND HoldUntil >= SYSDATETIME()
        )
        ORDER BY s.SlotNo
      `);

    const slotsByType = new Map();
    for (const s of slots.recordset) {
      if (!slotsByType.has(s.ParkingType)) slotsByType.set(s.ParkingType, []);
      slotsByType.get(s.ParkingType).push({ Id: s.Id, SlotNo: s.SlotNo });
    }

    // Project-wide free-slot count per type, ignoring the block filter
    // entirely — used only to tell "genuinely sold out across the whole
    // project" apart from "just not available in this specific block" (the
    // block-scoped `AvailableSlots` above can be empty while slots of the
    // same type still sit free in a different block — e.g. Basement parking
    // reserved per-tower). Same exclusion rule (no active allotment/hold) as
    // the block-scoped query, just without the BlockId condition.
    const slotsAnyBlock = await pool.request().input("pid", sql.Int, projectId)
      .query(`
        SELECT s.ParkingType, COUNT(*) AS FreeCount
        FROM dbo.ParkingSlot s
        WHERE s.ProjectId = @pid AND s.IsActive = 1
        AND s.Id NOT IN (
          SELECT ParkingSlotId FROM dbo.CrmParkingAllotment WHERE IsActive = 1 AND ParkingSlotId IS NOT NULL
          UNION
          SELECT EntityId FROM dbo.CrmInventoryHold WHERE EntityType = 'Parking' AND Status = 'Active' AND HoldUntil >= SYSDATETIME()
        )
        GROUP BY s.ParkingType
      `);
    const freeCountByType = new Map(slotsAnyBlock.recordset.map((r) => [r.ParkingType, r.FreeCount]));

    // A rate type with fixed slot inventory has HasSlots true even when
    // currently zero-available (0 available is still meaningfully different
    // from "sold by count, no fixed inventory at all") — that distinction
    // comes from whether ANY ParkingSlot row of this type exists for the
    // project at all, active-and-free or not.
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
        // No ParkingSlot rows exist for this type in the project at all yet
        // (Ops hasn't set up inventory in Parking Slot Master) — distinct
        // from "sold out" (SoldOutProjectWide below), which means slots
        // exist but are all taken. Quantity-only selling is no longer
        // supported for either case; the frontend greys the option out with
        // a different message for each.
        NoInventory: !hasInventory,
        AvailableSlots: blockScoped,
        // True only when zero slots of this type are free ANYWHERE in the
        // project — distinguishes real sold-out inventory from "just none
        // left in this particular block" (freeAnyBlock > blockScoped.length
        // when a block filter was applied and other blocks still have some).
        SoldOutProjectWide: blockId != null && freeAnyBlock === 0,
        FreeCountProjectWide: freeAnyBlock,
      };
    });

    // Types with real ParkingSlot inventory but no ParkingMaster rate at
    // all — the "slots exist but nobody priced them" gap. Surfaced
    // separately from `out` (which is driven entirely by rates) so the
    // frontend can tell staff exactly what's missing instead of a flat
    // "no parking rates configured" that reads as "no parking exists" even
    // when the slots clearly do.
    const ratedTypes = new Set(rates.recordset.map((r) => r.ParkingType));
    const unratedTypesWithInventory = [...typesWithInventory].filter((t) => !ratedTypes.has(t));

    res.json({ rates: out, unratedTypesWithInventory });
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
router.get("/application/:applicationId", requireAnyPageRight(["crm-bookings", "crm-parking-booking"], "view"), async (req, res) => {
  try {
    const pool = getPool();
    const applicationId = parseInt(req.params.applicationId);
    const result = await pool.request().input("aid", sql.Int, applicationId)
      .query(`${ALLOTMENT_SELECT} WHERE pa.ApplicationId = @aid AND pa.IsActive = 1 ORDER BY pa.CreatedAt DESC`);
    const allotments = result.recordset.map((r) => ({ ...r, Kind: "Allotment" }));

    const holdRows = await pool.request().input("aid", sql.Int, applicationId).query(`
      SELECT h.Id, h.EntityId AS ParkingSlotId, h.HoldUntil, s.SlotNo, s.ParkingType, s.ProjectId, s.BlockId
      FROM dbo.CrmInventoryHold h
      JOIN dbo.ParkingSlot s ON s.Id = h.EntityId
      WHERE h.EntityType = 'Parking' AND h.ApplicationId = @aid AND h.Status = 'Active' AND h.HoldUntil >= SYSDATETIME()
    `);
    const holds = [];
    for (const h of holdRows.recordset) {
      const rate = await resolveParkingRateForSlot(pool, h.ParkingSlotId);
      const lineAmount = rate ? rate.Charge : 0;
      const gstAmount = rate ? Math.round((lineAmount * rate.GstRate) / 100 * 100) / 100 : 0;
      holds.push({
        Id: h.Id, Kind: "Hold", ParkingSlotId: h.ParkingSlotId, SlotNo: h.SlotNo,
        CurrentParkingType: h.ParkingType, Quantity: 1,
        // RateSnapshot exposed here too (real Allotment rows already carry
        // their own via pa.* in ALLOTMENT_SELECT) so the frontend GST
        // preview can sum a clean pre-tax base across both shapes without
        // having to invert a tax-inclusive TotalAmount.
        RateSnapshot: lineAmount,
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
// Payment is tracked directly on the allotment row (PaymentStatus) since
// there's no CrmBooking/CrmPaymentMilestone schedule to hang it off of.
// Never gated by legal work — a standalone sale has no CrmBooking/Agreement.
//
// Registered BEFORE POST /:bookingId deliberately — Express matches routes
// in registration order, and "/:bookingId" is a single-segment param that
// would otherwise greedily match the literal path "/standalone" too (as if
// "standalone" were a bookingId), which is exactly what happened before this
// reordering: every request here was silently swallowed by the other
// handler, parsed "standalone" as NaN, and returned a misleading 404
// "Booking not found" — this endpoint was unreachable dead code until now.
router.post("/standalone", requireAnyPageRight(["crm-bookings", "crm-parking-booking"], "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    if (!b.ApplicationId) return res.status(400).json({ error: "ApplicationId is required — parking must be sold to a real customer/applicant" });
    if (!b.ParkingMasterId) return res.status(400).json({ error: "ParkingMasterId is required" });
    const qty = b.Quantity != null ? parseInt(b.Quantity) : 1;
    if (!Number.isFinite(qty) || qty < 1) return res.status(400).json({ error: "Quantity must be at least 1" });

    const application = await pool.request().input("aid", sql.Int, parseInt(b.ApplicationId))
      .query("SELECT Id, ProjectId, Status FROM dbo.CrmApplication WHERE Id = @aid AND IsActive = 1");
    if (!application.recordset.length) return res.status(404).json({ error: "Application not found" });

    const rate = await pool.request().input("pmid", sql.Int, parseInt(b.ParkingMasterId))
      .query("SELECT Charge, GstRate, ParkingType, ProjectId FROM dbo.ParkingMaster WHERE Id = @pmid AND IsActive = 1");
    if (!rate.recordset.length) return res.status(400).json({ error: "Selected parking rate is not active" });
    const { Charge, GstRate, ParkingType } = rate.recordset[0];

    // The matrix's own dropdown lists every Application system-wide with no
    // project filter — without this, parking in one Project could get sold
    // to a customer whose actual Application is for a different Project
    // entirely, a nonsensical record that'd never reconcile against real
    // inventory. Same rule enforced for hold placement (crmHoldService.js).
    if (rate.recordset[0].ProjectId !== application.recordset[0].ProjectId) {
      return res.status(400).json({ error: "This Application is for a different project than the selected parking rate/slot" });
    }

    const parkingSlotId = b.ParkingSlotId ? parseInt(b.ParkingSlotId) : null;
    assertSlotSelected(ParkingType, parkingSlotId);

    const lineAmount = Charge * qty;
    const gstAmount = Math.round((lineAmount * GstRate) / 100 * 100) / 100;
    const totalAmount = lineAmount + gstAmount;

    // A specific slot is real, exclusive inventory — same as a Unit, picking
    // it here must only place a temporary hold (placeHoldIfNeeded, same 3-day
    // window Units get on submit), not a permanent sale, UNLESS the caller
    // explicitly says this is a genuinely standalone sale with `Immediate:
    // true` (see CrmParkingBooking.tsx — a dedicated "sell parking with no
    // unit" page where no Booking will ever exist later to convert a hold
    // into a real allotment, so holding first would leave the "sale" stuck
    // as a hold that just expires in 3 days). The Application wizard's
    // Parking step is the default (hold-first) caller — the real allotment
    // there only gets created once the Application's Booking actually
    // exists, via the hold-conversion loop in crmEntityCreation.js's
    // createCrmBookingRecord.
    const slot = await pool.request().input("sid", sql.Int, parkingSlotId)
      .query("SELECT SlotNo FROM dbo.ParkingSlot WHERE Id = @sid AND IsActive = 1");
    if (!slot.recordset.length) return res.status(400).json({ error: "Selected parking slot is not active" });
    const slotNo = slot.recordset[0].SlotNo;

    if (!b.Immediate) {
      // Hold-first path — this is the Application wizard's own Parking step
      // (see CrmApplication.tsx ParkingSelectionStep), the parking-side twin
      // of the Company/Project/Unit lock on the Application itself (see
      // PUT /:id's changingUnitSelection check in crmApplications.js). A
      // slot picked here is still just a hold until the Application's
      // Booking is created, so it can move freely pre-approval but never
      // after — same reasoning, same Draft/Pending gate. The dedicated
      // standalone sale page (Immediate: true, CrmParkingBooking.tsx) is a
      // separate, independent sale and is deliberately NOT gated by this —
      // it never depends on its linked Application's own approval state.
      if (!["Draft", "Pending"].includes(application.recordset[0].Status)) {
        return res.status(400).json({
          error: `Cannot change this application's parking selection once it is ${application.recordset[0].Status} — this is locked after approval.`,
        });
      }

      const hold = await placeHoldIfNeeded(pool, {
        entityType: "Parking", entityId: parkingSlotId, applicationId: parseInt(b.ApplicationId),
        holdDays: 3, reason: "Application — parking slot selected", userId: actorId(req),
      });

      await logCrmAudit(pool, "Application", parseInt(b.ApplicationId), actorId(req), [
        { field: "ParkingHold", oldVal: null, newVal: `${ParkingType} ${slotNo} held until ${hold.holdUntil}` },
      ]);

      return res.status(201).json({
        success: true, hold: true, id: hold.id, holdUntil: hold.holdUntil,
        SlotNo: slotNo, TotalAmount: totalAmount,
      });
    }

    await assertSlotAvailable(pool, parkingSlotId);
    await guardAndConvertHold(pool, "Parking", parkingSlotId, parseInt(b.ApplicationId));

    const result = await pool.request()
      .input("aid",  sql.Int, parseInt(b.ApplicationId))
      .input("pmid", sql.Int, parseInt(b.ParkingMasterId))
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

    await logCrmAudit(pool, "Application", parseInt(b.ApplicationId), actorId(req), [
      { field: "StandaloneParkingAllotment", oldVal: null, newVal: `${ParkingType} x${qty} = ₹${totalAmount}` },
    ]);

    res.status(201).json({ success: true, id: result.recordset[0].Id, TotalAmount: totalAmount });
  } catch (e) {
    console.error("[crm-parking] POST /standalone error:", e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

// DELETE /hold/:holdId — release an Application-stage parking hold (a slot
// picked in the wizard but not yet converted into a real allotment). Same
// broad permission set as the rest of this file, unlike the stricter
// "crm-bookings"-only crmHolds.js generic release route — staff who only
// have crm-parking-booking rights can already add/remove parking here, so
// removing a not-yet-converted hold must stay in that same permission
// bracket. Scoped to EntityType='Parking' so this can't be pointed at a
// Unit hold by mistake.
router.delete("/hold/:holdId", requireAnyPageRight(["crm-bookings", "crm-parking-booking"], "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const holdId = parseInt(req.params.holdId);
    const row = await pool.request().input("id", sql.Int, holdId)
      .query("SELECT EntityType, ApplicationId FROM dbo.CrmInventoryHold WHERE Id = @id AND Status = 'Active'");
    if (!row.recordset.length || row.recordset[0].EntityType !== "Parking") {
      return res.status(404).json({ error: "Active parking hold not found" });
    }
    // Same Draft/Pending lock as picking one in the first place (see POST
    // /standalone above) — once the linked Application is Approved (or
    // beyond), this hold either already converted into a real allotment or
    // is about to, so it can no longer be pulled back out from here.
    if (row.recordset[0].ApplicationId) {
      const app = await pool.request().input("aid", sql.Int, row.recordset[0].ApplicationId)
        .query("SELECT Status FROM dbo.CrmApplication WHERE Id = @aid AND IsActive = 1");
      if (app.recordset.length && !["Draft", "Pending"].includes(app.recordset[0].Status)) {
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

// POST /:bookingId — allot parking alongside a unit booking. Rate/GST are
// always snapshotted from ParkingMaster at allotment time (never re-read
// live), and a matching payment milestone is created so it's payable on its
// own line within that booking's schedule. Once the booking's Agreement has
// documents under verification, this queues a CrmBookingAmendmentRequest
// instead of applying directly.
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

// PUT /:id — edit an existing allotment's quantity (re-rates against the
// same ParkingMaster rate snapshot). Blocked once its linked milestone has
// been paid, or once the standalone sale itself is Paid. Slot/rate/type are
// NOT editable here — changing those is a release-and-re-add, since a
// different rate card or slot is really a different allotment, not an edit
// of this one. Gated once legal work has started (unit-linked only —
// standalone sales have no Agreement to gate on).
router.put("/:id", requirePageRight("crm-bookings", "edit"), async (req, res) => {
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

    if (bookingId && await isLegalWorkStarted(pool, bookingId)) {
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

// PUT /:id/mark-paid — record payment for a standalone (non-unit-linked)
// parking sale. Unit-linked allotments are paid through the booking's own
// CrmPaymentMilestone instead — this is only for the standalone path. Never
// gated: recording a real payment received is not a definition change.
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
          PaymentStatus = 'Paid', ReceiptNo = @no, PaymentMode = @mode,
          PaymentReceivedDate = ISNULL(@dt, CAST(SYSDATETIME() AS DATE))
        WHERE Id = @id
      `);

    // Real cash received — post to GL instead of leaving this as a status
    // flag with zero financial trail. Never blocks the payment confirmation
    // itself if GL posting fails — same try/catch + recordGLPosting pattern
    // used across the rest of CRM.
    const actorEmail = req.user?.name || req.user?.email || "system";
    try {
      const outcome = await postCrmParkingPaymentToGL(pool, id, actorEmail);
      await recordGLPosting("crm-parking-payment", id, outcome, actorEmail);
    } catch (glErr) {
      console.error("[crm-parking] GL posting failed:", glErr.message);
      await recordGLPosting("crm-parking-payment", id, { failed: true, reason: glErr.message }, actorEmail);
    }

    res.json({ success: true, status: "Paid", ReceiptNo: receiptNo });
  } catch (e) {
    console.error("[crm-parking] mark-paid error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /:id — release a parking allotment (soft delete). For a unit-linked
// allotment, also removes the matching un-paid milestone; a milestone that's
// already been paid blocks the release so money already collected can't
// silently vanish. For a standalone sale, an already-Paid allotment is
// blocked the same way. Gated once legal work has started (unit-linked only).
router.delete("/:id", requireAnyPageRight(["crm-bookings", "crm-parking-booking"], "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const reason = req.query.reason || req.body?.Reason;

    const row = await pool.request().input("id", sql.Int, id)
      .query("SELECT BookingId FROM dbo.CrmParkingAllotment WHERE Id = @id AND IsActive = 1");
    if (!row.recordset.length) return res.status(404).json({ error: "Allotment not found" });
    const bookingId = row.recordset[0].BookingId;

    if (bookingId) {
      const activeErr = await requireActiveBooking(pool, bookingId);
      if (activeErr) return res.status(400).json({ error: activeErr });
    }

    if (bookingId && await isLegalWorkStarted(pool, bookingId)) {
      if (!reason?.trim()) return res.status(400).json({ error: "A reason is required to request this change — legal documents are already under verification for this booking" });
      const requestId = await createAmendmentRequest(pool, {
        bookingId, changeType: "ParkingAllotment", action: "Release", targetId: id,
        proposedChange: {}, reason: reason.trim(), requestedBy: actorId(req),
      });
      return res.status(202).json({ pending: true, requestId, message: "Legal documents are already under verification — this change needs approval before it applies." });
    }

    const result = await applyReleaseParking(pool, id);
    res.json({ success: true, ...result });
  } catch (e) {
    console.error("[crm-parking] DELETE error:", e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

module.exports = router;
// Reused by crmEntityCreation.js's createCrmBookingRecord to recompute
// ParkingTotal/GrandTotal right after backfilling Application-stage parking
// allotments onto the newly created Booking.
module.exports.rollupBookingTotals = rollupBookingTotals;
module.exports.applyAddParking = applyAddParking;
module.exports.applyEditParking = applyEditParking;
module.exports.applyReleaseParking = applyReleaseParking;
module.exports.releaseAllParkingForBooking = releaseAllParkingForBooking;
module.exports.releaseAllParkingForApplication = releaseAllParkingForApplication;