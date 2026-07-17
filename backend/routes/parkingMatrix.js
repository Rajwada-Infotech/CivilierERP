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
        pa.Id AS AllotmentId, pa.BookingId, b.BookingNo,
        a.ApplicantName, a.Mobile,
        h.Id AS HoldId, h.HoldUntil, h.ApplicationId AS HoldApplicationId,
        ha.ApplicantName AS HoldApplicantName, ha.Mobile AS HoldMobile
      FROM dbo.ParkingSlot s
      LEFT JOIN dbo.BlockMaster blk ON blk.Id = s.BlockId
      LEFT JOIN dbo.CrmParkingAllotment pa ON pa.ParkingSlotId = s.Id AND pa.IsActive = 1
      LEFT JOIN dbo.CrmBooking b ON b.Id = pa.BookingId
      LEFT JOIN dbo.CrmApplication a ON a.Id = ISNULL(pa.ApplicationId, b.ApplicationId)
      LEFT JOIN dbo.CrmInventoryHold h ON h.EntityType = 'Parking' AND h.EntityId = s.Id AND h.Status = 'Active' AND h.HoldUntil >= SYSDATETIME()
      LEFT JOIN dbo.CrmApplication ha ON ha.Id = h.ApplicationId
      WHERE ${where}
      ORDER BY s.SlotNo
    `);

    const slots = result.recordset.map((r) => ({
      Id: r.Id,
      SlotNo: r.SlotNo,
      ParkingType: r.ParkingType,
      BlockId: r.BlockId,
      BlockName: r.BlockName,
      Status: !r.SlotIsActive ? "Blocked" : r.AllotmentId ? "Booked" : r.HoldId ? "OnHold" : "Available",
      AllotmentId: r.AllotmentId || null,
      BookingId: r.BookingId || null,
      BookingNo: r.BookingNo || null,
      ApplicantName: r.ApplicantName || null,
      Mobile: r.Mobile || null,
      HoldId: r.HoldId || null,
      HoldUntil: r.HoldUntil || null,
      HoldApplicationId: r.HoldApplicationId || null,
      HoldApplicantName: r.HoldApplicantName || null,
      HoldMobile: r.HoldMobile || null,
    }));

    res.json(slots);
  } catch (err) {
    console.error("[parking-matrix] GET error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
