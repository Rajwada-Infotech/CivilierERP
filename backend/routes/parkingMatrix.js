const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const apiRateLimit = require("../middleware/apiRateLimit");
const { requirePageRight } = require("../middleware/requirePageRight");
const { cache } = require("../middleware/cache");

router.use(authMiddleware);
router.use(apiRateLimit);

// GET /projects — mirrors unitMatrix.js
router.get("/projects", requirePageRight("crm-parking-matrix", "view"), cache("parking-matrix-projects", 600), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT id AS Id, name AS Name
      FROM dbo.enterprise
      WHERE business_type = 'P' AND ISNULL(discontinue, 0) = 0
      ORDER BY name
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[parking-matrix] GET /projects error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /blocks?projectId=
router.get("/blocks", requirePageRight("crm-parking-matrix", "view"), async (req, res) => {
  const projectId = parseInt(req.query.projectId, 10);
  try {
    const pool = getPool();
    const request = pool.request();
    let query = "SELECT Id, BlockName AS Name FROM dbo.BlockMaster WHERE IsActive = 1";
    if (Number.isFinite(projectId)) {
      request.input("pid", sql.Int, projectId);
      query += " AND ProjectId = @pid";
    }
    query += " ORDER BY BlockName";
    const result = await request.query(query);
    res.json(result.recordset);
  } catch (err) {
    console.error("[parking-matrix] GET /blocks error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET / — the parking matrix. Status is always derived live from
// CrmParkingAllotment (joined by ParkingSlotId), never stored on the slot
// itself — same pattern as unitMatrix.js. A slot is Booked whether it was
// sold alongside a unit booking (BookingId set) or standalone against just
// an Application (BookingId NULL) — either way an active allotment row
// against this slot means it's taken.
router.get("/", requirePageRight("crm-parking-matrix", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const projectId = parseInt(req.query.projectId, 10);
    if (!Number.isFinite(projectId)) return res.status(400).json({ error: "projectId is required" });
    const blockId = parseInt(req.query.blockId, 10);

    const request = pool.request().input("pid", sql.Int, projectId);
    let where = "s.ProjectId = @pid";
    if (Number.isFinite(blockId)) {
      request.input("bid", sql.Int, blockId);
      where += " AND s.BlockId = @bid";
    }

    const result = await request.query(`
      SELECT
        s.Id, s.SlotNo, s.ParkingType, s.BlockId, blk.BlockName, s.IsActive AS SlotIsActive,
        pa.Id AS AllotmentId, pa.BookingId, pa.CreatedAt AS AllotmentDate, b.BookingNo, b.Status AS BookingStatus, b.ConfirmDeadline,
        pa.TotalAmount, pa.PaymentStatus AS AllotmentPaymentStatus, pa.Quantity,
        CASE WHEN pa.BookingId IS NOT NULL AND EXISTS (
          SELECT 1 FROM dbo.CrmPaymentMilestone m WHERE m.BookingId = pa.BookingId AND m.MilestoneNo = 1 AND m.Status = 'Paid'
        ) THEN 1 ELSE 0 END AS Milestone1Paid,
        a.Id AS ApplicationId, a.ApplicationNo, a.ApplicantName, a.Mobile,
        assn.name AS AssignedToName, assn.email AS AssignedToEmail,
        h.Id AS HoldId, h.HoldUntil, h.ApplicationId AS HoldApplicationId,
        ha.ApplicationNo AS HoldApplicationNo, ha.ApplicantName AS HoldApplicantName, ha.Mobile AS HoldMobile,
        hassn.name AS HoldAssignedToName, hassn.email AS HoldAssignedToEmail
      FROM dbo.ParkingSlot s
      LEFT JOIN dbo.BlockMaster blk ON blk.Id = s.BlockId
      LEFT JOIN dbo.CrmParkingAllotment pa ON pa.ParkingSlotId = s.Id AND pa.IsActive = 1
      LEFT JOIN dbo.CrmBooking b ON b.Id = pa.BookingId AND b.IsActive = 1 AND b.Status NOT IN ('Cancelled', 'Rejected', 'Expired')
      LEFT JOIN dbo.CrmApplication a ON a.Id = ISNULL(pa.ApplicationId, b.ApplicationId)
      LEFT JOIN dbo.users assn ON assn.id = a.AssignedTo
      LEFT JOIN dbo.CrmInventoryHold h ON h.EntityType = 'Parking' AND h.EntityId = s.Id AND h.Status = 'Active' AND h.HoldUntil >= SYSDATETIME()
      LEFT JOIN dbo.CrmApplication ha ON ha.Id = h.ApplicationId
      LEFT JOIN dbo.users hassn ON hassn.id = ha.AssignedTo
      WHERE ${where}
      ORDER BY s.SlotNo
    `);

    const slots = result.recordset.map((r) => {
      // Two different "Booked" definitions depending on how this slot was
      // sold (see crmParking.js POST /standalone's Immediate flag):
      //   - Unit-linked (BookingId set): rides the SAME Approved+Milestone1
      //     gate as the unit itself — the parking add-on isn't a separate
      //     sale, it's part of the one Booking.
      //   - Truly standalone (no BookingId, sold directly via
      //     CrmParkingBooking.tsx): its own PaymentStatus is the only signal
      //     there is — there's no Booking to gate on.
      const unitLinkedConfirmed = r.BookingId && r.BookingStatus === "Approved" && r.Milestone1Paid;
      const standaloneConfirmed = r.AllotmentId && !r.BookingId && r.AllotmentPaymentStatus === "Paid";
      const isBooked = !!(unitLinkedConfirmed || standaloneConfirmed);
      const isOnHold = !isBooked && (r.AllotmentId || r.HoldId);
      return {
        Id: r.Id,
        SlotNo: r.SlotNo,
        ParkingType: r.ParkingType,
        BlockId: r.BlockId,
        BlockName: r.BlockName,
        Status: !r.SlotIsActive ? "Blocked" : isBooked ? "Booked" : isOnHold ? "OnHold" : "Available",
        AllotmentId: r.AllotmentId || null,
        BookingId: r.BookingId || null,
        BookingNo: r.BookingNo || null,
        BookingStatus: r.BookingStatus || null,
        AllotmentDate: r.AllotmentDate || null,
        TotalAmount: r.TotalAmount ?? null,
        AllotmentPaymentStatus: r.AllotmentPaymentStatus || null,
        Quantity: r.Quantity ?? null,
        ApplicationId: r.ApplicationId || null,
        ApplicationNo: r.ApplicationNo || null,
        ApplicantName: r.ApplicantName || null,
        Mobile: r.Mobile || null,
        AssignedToName: r.AssignedToName || null,
        AssignedToEmail: r.AssignedToEmail || null,
        HoldId: r.HoldId || null,
        // Unit-linked pending allotment: countdown comes from the parent
        // Booking's own ConfirmDeadline snapshot (its hold already got
        // Converted the moment the allotment was created — see
        // crmEntityCreation.js). A bare pre-Booking hold, or a standalone
        // sale with no deadline concept at all, falls back to the live
        // hold's HoldUntil (or null — "—" on the frontend).
        HoldUntil: r.BookingId ? (r.ConfirmDeadline || null) : (r.HoldUntil || null),
        HoldApplicationId: r.HoldApplicationId || null,
        HoldApplicationNo: r.HoldApplicationNo || null,
        HoldApplicantName: r.HoldApplicantName || null,
        HoldMobile: r.HoldMobile || null,
        HoldAssignedToName: r.HoldAssignedToName || null,
        HoldAssignedToEmail: r.HoldAssignedToEmail || null,
      };
    });

    res.json(slots);
  } catch (err) {
    console.error("[parking-matrix] GET error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
