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
const { recalculateRemainingMilestones, isLegalWorkStarted, requireActiveBooking } = require("../services/crmWorkflowGuards");
const { createAmendmentRequest } = require("../services/crmAmendments");

router.use(authMiddleware);
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));

// Recomputes CrmBooking.ParkingTotal/ExtraChargesTotal/GrandTotal from the
// live allotment/extra-charge rows — never trust an incrementally maintained
// running total, always re-derive from source rows so it can't drift.
// Only meaningful for unit-linked allotments (BookingId set) — a standalone
// parking-only sale has no CrmBooking to roll into.
async function rollupBookingTotals(pool, bookingId) {
  if (!bookingId) return;
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

  return { parkingTotal, extraTotal };
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
  await assertSlotAvailable(pool, parkingSlotId);
  if (parkingSlotId) await guardAndConvertHold(pool, "Parking", parkingSlotId, booking.recordset[0].ApplicationId);
  let slotNo = b.ParkingSlotNo || null;
  if (parkingSlotId) {
    const slot = await pool.request().input("sid", sql.Int, parkingSlotId)
      .query("SELECT SlotNo FROM dbo.ParkingSlot WHERE Id = @sid AND IsActive = 1");
    if (!slot.recordset.length) throw parkingError("Selected parking slot is not active");
    slotNo = slot.recordset[0].SlotNo;
  }

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

  // A new payable line item — its own milestone, due immediately, not
  // folded into the base unit's staged % milestones.
  const nextNo = await pool.request().input("bid", sql.Int, bookingId)
    .query("SELECT ISNULL(MAX(MilestoneNo), 0) + 1 AS N FROM dbo.CrmPaymentMilestone WHERE BookingId = @bid");
  await pool.request()
    .input("bid", sql.Int, bookingId)
    .input("no",  sql.Int, nextNo.recordset[0].N)
    .input("name",sql.NVarChar(200), `Parking — ${ParkingType}${slotNo ? ` (${slotNo})` : ""}`)
    .input("amt", sql.Decimal(18, 2), totalAmount)
    .input("cb",  sql.Int, actorUserId)
    .input("paid", sql.Int, allotmentId)
    .query(`
      INSERT INTO dbo.CrmPaymentMilestone (BookingId, MilestoneNo, MilestoneName, AmountDue, Status, CreatedBy, CreatedAt, ParkingAllotmentId)
      VALUES (@bid, @no, @name, @amt, 'Pending', @cb, SYSDATETIME(), @paid)
    `);

  await rollupBookingTotals(pool, bookingId);
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

  if (BookingId) await rollupBookingTotals(pool, BookingId);
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

  const milestone = await pool.request().input("paid", sql.Int, id)
    .query("SELECT TOP 1 Id, Status FROM dbo.CrmPaymentMilestone WHERE ParkingAllotmentId = @paid ORDER BY Id DESC");
  if (milestone.recordset.length && milestone.recordset[0].Status === "Paid") {
    throw parkingError("This parking charge has already been paid and cannot be released", 409);
  }

  await pool.request().input("id", sql.Int, id)
    .query("UPDATE dbo.CrmParkingAllotment SET IsActive = 0 WHERE Id = @id");
  if (milestone.recordset.length) {
    await pool.request().input("mid", sql.Int, milestone.recordset[0].Id)
      .query("DELETE FROM dbo.CrmPaymentMilestone WHERE Id = @mid");
  }

  await rollupBookingTotals(pool, BookingId);
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
      .query("SELECT Id, ProjectId FROM dbo.CrmApplication WHERE Id = @aid AND IsActive = 1");
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
    //
    // A quantity-only pick (no ParkingSlotId — "Open" parking sold by count,
    // not tied to one physical slot) has no specific inventory item to
    // reserve, so it's always recorded directly below regardless of mode.
    let slotNo = null;
    if (parkingSlotId) {
      const slot = await pool.request().input("sid", sql.Int, parkingSlotId)
        .query("SELECT SlotNo FROM dbo.ParkingSlot WHERE Id = @sid AND IsActive = 1");
      if (!slot.recordset.length) return res.status(400).json({ error: "Selected parking slot is not active" });
      slotNo = slot.recordset[0].SlotNo;

      if (!b.Immediate) {
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
    }

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
      .query("SELECT EntityType FROM dbo.CrmInventoryHold WHERE Id = @id AND Status = 'Active'");
    if (!row.recordset.length || row.recordset[0].EntityType !== "Parking") {
      return res.status(404).json({ error: "Active parking hold not found" });
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