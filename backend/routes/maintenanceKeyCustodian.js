// Maintenance > Key Custodian: units not yet handed over (unsold, or booked but handover not Completed), by project
// and block — who holds their keys until handover — with the unit's confirmed CRM booking (buyer, co-applicants,
// parking, handover) read live. Once handed over, a unit leaves this page (it is the customer's, see Customer
// Directory).
const express = require("express");
const router = express.Router();
const apiRateLimit = require("../middleware/apiRateLimit");
router.use(apiRateLimit);
const { requirePageRight } = require("../middleware/requirePageRight");
const { getPool, sql } = require("../db");
const { projectPredicate, assertProjectAllowed } = require("../services/projectScope");
const { maintenanceEligibleExists } = require("../services/maintenanceEligibility");

const PAGE = "maintenance-key-custodian";
const CUSTODIAN_TYPES = ["Owner", "Co-applicant", "Developer", "Tenant", "Caretaker", "Other"];

// The unit's current confirmed booking: booked as the main unit or as one unit of a multi-unit booking.
const CONFIRMED_BOOKING_APPLY = (unitCol) => `
  OUTER APPLY (
    SELECT TOP 1 b.Id, b.BookingNo, b.ApplicationId
    FROM dbo.CrmBooking b
    WHERE b.IsActive = 1 AND b.WorkflowStage = 'Confirmed'
      AND (b.UnitId = ${unitCol}
           OR EXISTS (SELECT 1 FROM dbo.CrmBookingUnit bu WHERE bu.BookingId = b.Id AND bu.UnitId = ${unitCol} AND bu.Status = N'Active'))
    ORDER BY b.Id DESC
  ) cb`;

// GET /units — every active unit not yet handed over, with its block and project, its confirmed booking (if any)
// and its custodian.
router.get("/units", requirePageRight(PAGE, "view"), async (req, res) => {
  try {
    const pool = getPool();
    const rows = (await pool.request().query(`
      SELECT um.Id AS UnitId, um.UnitName, um.BlockId, blk.BlockName, um.ProjectId, pr.name AS ProjectName,
             cb.Id AS BookingId, cb.BookingNo, a.ApplicantName,
             kc.CustodianName, kc.CustodianType, kc.HandedOverOn
      FROM dbo.UnitMaster um
      JOIN dbo.BlockMaster blk ON blk.Id = um.BlockId
      LEFT JOIN dbo.enterprise pr ON pr.id = um.ProjectId
      ${CONFIRMED_BOOKING_APPLY("um.Id")}
      LEFT JOIN dbo.CrmApplication a ON a.Id = cb.ApplicationId
      LEFT JOIN dbo.MaintenanceKeyCustodian kc ON kc.UnitId = um.Id
      WHERE um.IsActive = 1 AND ISNULL(blk.IsActive, 1) = 1
        AND (cb.Id IS NULL OR NOT ${maintenanceEligibleExists("cb")})${projectPredicate(req.projectScope, "um.ProjectId")}
      ORDER BY pr.name, blk.BlockName, um.UnitName
    `)).recordset;
    res.json(rows);
  } catch (err) {
    console.error("GET key-custodian units:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /units/:unitId — the unit, its confirmed booking's details, and the custodian record.
router.get("/units/:unitId", requirePageRight(PAGE, "view"), async (req, res) => {
  const unitId = parseInt(req.params.unitId, 10);
  if (!Number.isFinite(unitId)) return res.status(400).json({ error: "Invalid unit id" });
  try {
    const pool = getPool();
    const unit = (await pool.request().input("U", sql.Int, unitId).query(`
      SELECT um.Id AS UnitId, um.UnitName, um.BlockId, blk.BlockName, um.ProjectId, pr.name AS ProjectName, cb.Id AS BookingId
      FROM dbo.UnitMaster um
      JOIN dbo.BlockMaster blk ON blk.Id = um.BlockId
      LEFT JOIN dbo.enterprise pr ON pr.id = um.ProjectId
      ${CONFIRMED_BOOKING_APPLY("um.Id")}
      WHERE um.Id = @U
    `)).recordset[0];
    if (!unit) return res.status(404).json({ error: "Unit not found" });
    if (!assertProjectAllowed(req, res, unit.ProjectId)) return;

    let booking = null, coApplicants = [], parking = [], handover = null;
    if (unit.BookingId) {
      const B = unit.BookingId;
      booking = (await pool.request().input("B", sql.Int, B).query(`
        SELECT b.Id, b.BookingNo, b.BookingDate, b.ConfirmedAt, b.ConfirmedBy, b.Status, b.WorkflowStage,
               b.FloorName, COALESCE(um.UnitType, b.UnitType) AS UnitType,
               b.CarpetAreaSqFt, b.BuiltUpAreaSqFt, b.SuperBuiltUpAreaSqFt, b.AreaSqFt,
               b.TotalValue, b.GrandTotal, comp.name AS CompanyName,
               a.ApplicationNo, a.ApplicantName, a.Mobile, a.AltMobile, a.Email
        FROM dbo.CrmBooking b
        JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
        LEFT JOIN dbo.UnitMaster um ON um.Id = b.UnitId
        LEFT JOIN dbo.enterprise comp ON comp.id = b.CompanyId AND comp.business_type = 'C'
        WHERE b.Id = @B
      `)).recordset[0] || null;
      coApplicants = (await pool.request().input("B", sql.Int, B).query(`
        SELECT Name, Relation, Mobile, Email FROM dbo.CrmCoApplicant WHERE BookingId = @B AND IsActive = 1 ORDER BY Id
      `)).recordset;
      parking = (await pool.request().input("B", sql.Int, B).query(`
        SELECT pa.ParkingSlotNo, pa.Quantity, pm.ParkingType
        FROM dbo.CrmParkingAllotment pa LEFT JOIN dbo.ParkingMaster pm ON pm.Id = pa.ParkingMasterId
        WHERE pa.BookingId = @B AND pa.IsActive = 1 ORDER BY pa.Id
      `)).recordset;
      handover = (await pool.request().input("B", sql.Int, B).query(`
        SELECT ho.Status, ho.ScheduledDate, ho.ActualHandoverDate, u.name AS KeyHandoverByName
        FROM dbo.CrmHandover ho LEFT JOIN dbo.Users u ON u.id = ho.KeyHandoverBy
        WHERE ho.BookingId = @B
      `)).recordset[0] || null;
    }
    const custodian = (await pool.request().input("U", sql.Int, unitId).query(`
      SELECT CustodianType, CustodianName, CustodianPhone, KeyCount, KeyTagNo, HandedOverOn, HandedOverBy, Remarks,
             UpdatedBy, UpdatedAt, CreatedBy, CreatedAt
      FROM dbo.MaintenanceKeyCustodian WHERE UnitId = @U
    `)).recordset[0] || null;

    const handedOver = handover?.Status === "Completed";
    res.json({ unit, booking, coApplicants, parking, handover, handedOver, custodian, custodianTypes: CUSTODIAN_TYPES });
  } catch (err) {
    console.error("GET key-custodian unit:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /units/:unitId — save who holds the unit's keys (creates the record the first time).
router.put("/units/:unitId", requirePageRight(PAGE, "edit"), async (req, res) => {
  const unitId = parseInt(req.params.unitId, 10);
  if (!Number.isFinite(unitId)) return res.status(400).json({ error: "Invalid unit id" });
  const b = req.body || {};
  const type = String(b.CustodianType || "").trim();
  const name = String(b.CustodianName || "").trim();
  if (!CUSTODIAN_TYPES.includes(type)) return res.status(400).json({ error: `Custodian type must be one of: ${CUSTODIAN_TYPES.join(", ")}` });
  if (!name) return res.status(400).json({ error: "Custodian name is required" });
  const keyCount = b.KeyCount === "" || b.KeyCount == null ? null : parseInt(b.KeyCount, 10);
  if (keyCount != null && (!Number.isFinite(keyCount) || keyCount < 0 || keyCount > 999)) return res.status(400).json({ error: "Number of keys must be between 0 and 999" });
  const date = b.HandedOverOn && /^\d{4}-\d{2}-\d{2}$/.test(String(b.HandedOverOn).slice(0, 10)) ? String(b.HandedOverOn).slice(0, 10) : null;
  const user = req.user?.email || req.user?.name || "unknown";
  try {
    const pool = getPool();
    const unit = (await pool.request().input("U", sql.Int, unitId).query(`
      SELECT um.ProjectId, cb.Id AS BookingId,
             CASE WHEN cb.Id IS NOT NULL AND ${maintenanceEligibleExists("cb")} THEN 1 ELSE 0 END AS HandedOver
      FROM dbo.UnitMaster um ${CONFIRMED_BOOKING_APPLY("um.Id")} WHERE um.Id = @U
    `)).recordset[0];
    if (!unit) return res.status(404).json({ error: "Unit not found" });
    if (!assertProjectAllowed(req, res, unit.ProjectId)) return;
    if (unit.HandedOver) return res.status(409).json({ error: "This unit has been handed over — its keys are with the customer now." });
    await pool.request()
      .input("U", sql.Int, unitId)
      .input("B", sql.Int, unit.BookingId || null)
      .input("T", sql.NVarChar(30), type)
      .input("N", sql.NVarChar(200), name.slice(0, 200))
      .input("P", sql.NVarChar(20), b.CustodianPhone ? String(b.CustodianPhone).trim().slice(0, 20) : null)
      .input("K", sql.Int, keyCount)
      .input("Tag", sql.NVarChar(50), b.KeyTagNo ? String(b.KeyTagNo).trim().slice(0, 50) : null)
      .input("D", sql.Date, date)
      .input("HB", sql.NVarChar(150), b.HandedOverBy ? String(b.HandedOverBy).trim().slice(0, 150) : null)
      .input("R", sql.NVarChar(1000), b.Remarks ? String(b.Remarks).trim().slice(0, 1000) : null)
      .input("By", sql.NVarChar(150), user)
      .query(`
        MERGE dbo.MaintenanceKeyCustodian WITH (HOLDLOCK) AS t
        USING (SELECT @U AS UnitId) AS s ON t.UnitId = s.UnitId
        WHEN MATCHED THEN UPDATE SET BookingId = @B, CustodianType = @T, CustodianName = @N, CustodianPhone = @P, KeyCount = @K,
          KeyTagNo = @Tag, HandedOverOn = @D, HandedOverBy = @HB, Remarks = @R, UpdatedBy = @By, UpdatedAt = SYSDATETIME()
        WHEN NOT MATCHED THEN INSERT (UnitId, BookingId, CustodianType, CustodianName, CustodianPhone, KeyCount, KeyTagNo, HandedOverOn, HandedOverBy, Remarks, CreatedBy)
          VALUES (@U, @B, @T, @N, @P, @K, @Tag, @D, @HB, @R, @By);
      `);
    res.json({ ok: true });
  } catch (err) {
    console.error("PUT key-custodian unit:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
