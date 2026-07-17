const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight, requireAnyPageRight } = require("../middleware/requirePageRight");
const { actorId } = require("../services/saAccess");
const { logCrmAudit } = require("../services/crmAudit");
const { guardAndConvertHold } = require("../services/crmHoldService");
const { getNextDocNumber } = require("../services/docNumber");
const { postCrmParkingPaymentToGL } = require("../services/crmLedger");
const { recordGLPosting } = require("../services/approvalService");

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

const ALLOTMENT_SELECT = `
  SELECT pa.*, p.ParkingType AS CurrentParkingType, p.ProjectId, p.BlockId,
         s.SlotNo, a.ApplicantName, a.Mobile, b.BookingNo
  FROM dbo.CrmParkingAllotment pa
  JOIN dbo.ParkingMaster p ON p.Id = pa.ParkingMasterId
  LEFT JOIN dbo.ParkingSlot s ON s.Id = pa.ParkingSlotId
  LEFT JOIN dbo.CrmApplication a ON a.Id = pa.ApplicationId
  LEFT JOIN dbo.CrmBooking b ON b.Id = pa.BookingId
`;

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
// holds, whether sold alongside a unit booking or bought standalone. This
// is the "one customer, unit + parking together" view.
router.get("/application/:applicationId", requireAnyPageRight(["crm-bookings", "crm-parking-booking"], "view"), async (req, res) => {
  try {
    const pool = getPool();
    const applicationId = parseInt(req.params.applicationId);
    const result = await pool.request().input("aid", sql.Int, applicationId)
      .query(`${ALLOTMENT_SELECT} WHERE pa.ApplicationId = @aid AND pa.IsActive = 1 ORDER BY pa.CreatedAt DESC`);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-parking] GET /application error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /standalone — buy parking only, no unit booking involved at all.
// Payment is tracked directly on the allotment row (PaymentStatus) since
// there's no CrmBooking/CrmPaymentMilestone schedule to hang it off of.
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
      .query("SELECT Id FROM dbo.CrmApplication WHERE Id = @aid AND IsActive = 1");
    if (!application.recordset.length) return res.status(404).json({ error: "Application not found" });

    const rate = await pool.request().input("pmid", sql.Int, parseInt(b.ParkingMasterId))
      .query("SELECT Charge, GstRate, ParkingType FROM dbo.ParkingMaster WHERE Id = @pmid AND IsActive = 1");
    if (!rate.recordset.length) return res.status(400).json({ error: "Selected parking rate is not active" });
    const { Charge, GstRate, ParkingType } = rate.recordset[0];

    const parkingSlotId = b.ParkingSlotId ? parseInt(b.ParkingSlotId) : null;
    await assertSlotAvailable(pool, parkingSlotId);
    if (parkingSlotId) await guardAndConvertHold(pool, "Parking", parkingSlotId, parseInt(b.ApplicationId));
    let slotNo = b.ParkingSlotNo || null;
    if (parkingSlotId) {
      const slot = await pool.request().input("sid", sql.Int, parkingSlotId)
        .query("SELECT SlotNo FROM dbo.ParkingSlot WHERE Id = @sid AND IsActive = 1");
      if (!slot.recordset.length) return res.status(400).json({ error: "Selected parking slot is not active" });
      slotNo = slot.recordset[0].SlotNo;
    }

    const lineAmount = Charge * qty;
    const gstAmount = Math.round((lineAmount * GstRate) / 100 * 100) / 100;
    const totalAmount = lineAmount + gstAmount;

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

// POST /:bookingId — allot parking alongside a unit booking. Rate/GST are
// always snapshotted from ParkingMaster at allotment time (never re-read
// live), and a matching payment milestone is created so it's payable on its
// own line within that booking's schedule.
router.post("/:bookingId", requirePageRight("crm-bookings", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const bookingId = parseInt(req.params.bookingId);
    const b = req.body;
    if (!b.ParkingMasterId) return res.status(400).json({ error: "ParkingMasterId is required" });
    const qty = b.Quantity != null ? parseInt(b.Quantity) : 1;
    if (!Number.isFinite(qty) || qty < 1) return res.status(400).json({ error: "Quantity must be at least 1" });

    const booking = await pool.request().input("bid", sql.Int, bookingId)
      .query("SELECT Id, BookingNo, ApplicationId FROM dbo.CrmBooking WHERE Id = @bid AND IsActive = 1");
    if (!booking.recordset.length) return res.status(404).json({ error: "Booking not found" });

    const rate = await pool.request().input("pmid", sql.Int, parseInt(b.ParkingMasterId))
      .query("SELECT Charge, GstRate, ParkingType FROM dbo.ParkingMaster WHERE Id = @pmid AND IsActive = 1");
    if (!rate.recordset.length) return res.status(400).json({ error: "Selected parking rate is not active" });
    const { Charge, GstRate, ParkingType } = rate.recordset[0];

    const parkingSlotId = b.ParkingSlotId ? parseInt(b.ParkingSlotId) : null;
    await assertSlotAvailable(pool, parkingSlotId);
    if (parkingSlotId) await guardAndConvertHold(pool, "Parking", parkingSlotId, booking.recordset[0].ApplicationId);
    let slotNo = b.ParkingSlotNo || null;
    if (parkingSlotId) {
      const slot = await pool.request().input("sid", sql.Int, parkingSlotId)
        .query("SELECT SlotNo FROM dbo.ParkingSlot WHERE Id = @sid AND IsActive = 1");
      if (!slot.recordset.length) return res.status(400).json({ error: "Selected parking slot is not active" });
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
      .input("cb",   sql.Int, actorId(req))
      .query(`
        INSERT INTO dbo.CrmParkingAllotment
          (BookingId, ApplicationId, ParkingMasterId, ParkingSlotId, ParkingSlotNo, Quantity, RateSnapshot, GstRateSnapshot, GstAmount, TotalAmount, PaymentStatus, Notes, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@bid, @aid, @pmid, @sid, @slot, @qty, @rate, @gstr, @gsta, @tot, 'Pending', @note, @cb, SYSDATETIME())
      `);

    // A new payable line item — its own milestone, due immediately, not
    // folded into the base unit's staged % milestones.
    const nextNo = await pool.request().input("bid", sql.Int, bookingId)
      .query("SELECT ISNULL(MAX(MilestoneNo), 0) + 1 AS N FROM dbo.CrmPaymentMilestone WHERE BookingId = @bid");
    await pool.request()
      .input("bid", sql.Int, bookingId)
      .input("no",  sql.Int, nextNo.recordset[0].N)
      .input("name",sql.NVarChar(200), `Parking — ${ParkingType}${slotNo ? ` (${slotNo})` : ""}`)
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
    res.status(e.status || 500).json({ error: e.message });
  }
});

// PUT /:id/mark-paid — record payment for a standalone (non-unit-linked)
// parking sale. Unit-linked allotments are paid through the booking's own
// CrmPaymentMilestone instead — this is only for the standalone path.
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
// blocked the same way.
router.delete("/:id", requireAnyPageRight(["crm-bookings", "crm-parking-booking"], "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);

    const row = await pool.request().input("id", sql.Int, id)
      .query("SELECT BookingId, TotalAmount, PaymentStatus FROM dbo.CrmParkingAllotment WHERE Id = @id AND IsActive = 1");
    if (!row.recordset.length) return res.status(404).json({ error: "Allotment not found" });
    const { BookingId, TotalAmount, PaymentStatus } = row.recordset[0];

    if (!BookingId) {
      if (PaymentStatus === "Paid") {
        return res.status(409).json({ error: "This parking sale has already been paid and cannot be released" });
      }
      await pool.request().input("id", sql.Int, id)
        .query("UPDATE dbo.CrmParkingAllotment SET IsActive = 0 WHERE Id = @id");
      return res.json({ success: true });
    }

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
// Reused by crmEntityCreation.js's createCrmBookingRecord to recompute
// ParkingTotal/GrandTotal right after backfilling Application-stage parking
// allotments onto the newly created Booking.
module.exports.rollupBookingTotals = rollupBookingTotals;
