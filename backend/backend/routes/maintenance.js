const { requirePageRight } = require("../middleware/requirePageRight");
const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");

// Confirmed CrmBooking rows ARE the Maintenance customer directory — no
// separate customer table exists for this module. Contact info comes from
// CrmApplication (b.ApplicationId), same join crmBookings.js's BOOKING_SELECT
// uses. Kept deliberately smaller than BOOKING_SELECT since the directory
// only needs telephone-directory fields, not the full CRM workflow state.
const DIRECTORY_SELECT = `
  SELECT
    b.Id, b.BookingNo, b.BookingDate, b.TotalValue, b.Status,
    a.ApplicantName AS CustomerName, a.Mobile AS ContactNumber, a.Email,
    COALESCE(um.UnitName, b.UnitNo)    AS UnitNo,
    COALESCE(blk.BlockName, b.BlockName) AS BlockName,
    COALESCE(proj.name, b.ProjectName) AS ProjectName,
    comp.name AS CompanyName
  FROM dbo.CrmBooking b
  JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
  LEFT JOIN dbo.UnitMaster um    ON um.Id  = b.UnitId
  LEFT JOIN dbo.BlockMaster blk  ON blk.Id = um.BlockId
  LEFT JOIN dbo.enterprise  proj ON proj.id = b.ProjectId AND proj.business_type = 'P'
  LEFT JOIN dbo.enterprise  comp ON comp.id = b.CompanyId AND comp.business_type = 'C'
`;

router.get("/directory", requirePageRight("maintenance-directory", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const search = (req.query.search || "").trim();
    const req0 = pool.request();
    let where = "b.WorkflowStage = 'Confirmed' AND b.IsActive = 1";
    if (search) {
      req0.input("search", sql.NVarChar, `%${search}%`);
      where += ` AND (
        a.ApplicantName LIKE @search OR a.Mobile LIKE @search OR
        b.BookingNo LIKE @search OR COALESCE(um.UnitName, b.UnitNo) LIKE @search
      )`;
    }
    const result = await req0.query(`${DIRECTORY_SELECT} WHERE ${where} ORDER BY a.ApplicantName`);
    res.json(result.recordset);
  } catch (err) {
    console.error("GET DIRECTORY ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get("/customers/:bookingId", requirePageRight("maintenance-directory", "view"), async (req, res) => {
  const bookingId = parseInt(req.params.bookingId, 10);
  if (!Number.isFinite(bookingId)) return res.status(400).json({ error: "Invalid booking id" });
  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("Id", sql.Int, bookingId)
      .query(`${DIRECTORY_SELECT} WHERE b.Id = @Id AND b.WorkflowStage = 'Confirmed' AND b.IsActive = 1`);
    if (!result.recordset.length) return res.status(404).json({ error: "Confirmed booking not found" });
    res.json(result.recordset[0]);
  } catch (err) {
    console.error("GET CUSTOMER ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get("/customers/:bookingId/charges", requirePageRight("maintenance-customer-charges", "view"), async (req, res) => {
  const bookingId = parseInt(req.params.bookingId, 10);
  if (!Number.isFinite(bookingId)) return res.status(400).json({ error: "Invalid booking id" });
  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("BookingId", sql.Int, bookingId)
      .query(`
        SELECT c.Id, c.BookingId, c.ChargeHeadId, c.BaseAmount, c.TaxPct, c.TaxAmount, c.TotalAmount,
               c.Status, c.CreatedAt, ch.Name AS ChargeHeadName
        FROM dbo.MaintenanceCustomerCharge c
        JOIN dbo.MaintenanceChargeHead ch ON ch.Id = c.ChargeHeadId
        WHERE c.BookingId = @BookingId AND c.Status = 1
        ORDER BY ch.Name
      `);
    res.json(result.recordset);
  } catch (err) {
    console.error("GET CHARGES ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Placeholder — no maintenance payment-collection flow exists yet. Kept as
// its own endpoint so the frontend's Payment History section already has a
// stable contract to call once collection is built.
router.get("/customers/:bookingId/payments", requirePageRight("maintenance-directory", "view"), async (req, res) => {
  res.json([]);
});

router.post("/customers/:bookingId/charges", requirePageRight("maintenance-customer-charges", "create"), async (req, res) => {
  const bookingId = parseInt(req.params.bookingId, 10);
  const chargeHeadId = parseInt(req.body?.chargeHeadId, 10);
  if (!Number.isFinite(bookingId)) return res.status(400).json({ error: "Invalid booking id" });
  if (!Number.isFinite(chargeHeadId)) return res.status(400).json({ error: "chargeHeadId is required" });
  const createdBy = req.user?.userId ?? req.user?.id ?? null;
  if (!createdBy) {
    return res.status(401).json({ error: "User context missing — please sign in again." });
  }

  try {
    const pool = getPool();

    const booking = await pool
      .request()
      .input("Id", sql.Int, bookingId)
      .query("SELECT TOP 1 Id FROM dbo.CrmBooking WHERE Id = @Id AND WorkflowStage = 'Confirmed' AND IsActive = 1");
    if (!booking.recordset.length) return res.status(404).json({ error: "Confirmed booking not found" });

    const chargeHead = await pool
      .request()
      .input("Id", sql.Int, chargeHeadId)
      .query("SELECT TOP 1 Id, Rate, TaxPct FROM dbo.MaintenanceChargeHead WHERE Id = @Id AND Status = 1");
    if (!chargeHead.recordset.length) return res.status(404).json({ error: "Charge Head not found or inactive" });

    const existing = await pool
      .request()
      .input("BookingId", sql.Int, bookingId)
      .input("ChargeHeadId", sql.Int, chargeHeadId)
      .query("SELECT TOP 1 1 AS x FROM dbo.MaintenanceCustomerCharge WHERE BookingId = @BookingId AND ChargeHeadId = @ChargeHeadId AND Status = 1");
    if (existing.recordset.length) return res.status(409).json({ error: "This Charge Head is already applied to this customer" });

    const { Rate, TaxPct } = chargeHead.recordset[0];
    const baseAmount = Number(Rate) || 0;
    const taxPct = Number(TaxPct) || 0;
    const taxAmount = Math.round((baseAmount * taxPct) / 100 * 100) / 100;
    const totalAmount = baseAmount + taxAmount;

    const result = await pool
      .request()
      .input("BookingId", sql.Int, bookingId)
      .input("ChargeHeadId", sql.Int, chargeHeadId)
      .input("BaseAmount", sql.Decimal(18, 2), baseAmount)
      .input("TaxPct", sql.Decimal(5, 2), taxPct)
      .input("TaxAmount", sql.Decimal(18, 2), taxAmount)
      .input("TotalAmount", sql.Decimal(18, 2), totalAmount)
      .input("CreatedBy", sql.Int, createdBy)
      .input("CreatedAt", sql.DateTime, new Date())
      .query(`
        INSERT INTO dbo.MaintenanceCustomerCharge
          (BookingId, ChargeHeadId, BaseAmount, TaxPct, TaxAmount, TotalAmount, Status, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@BookingId, @ChargeHeadId, @BaseAmount, @TaxPct, @TaxAmount, @TotalAmount, 1, @CreatedBy, @CreatedAt)
      `);
    res.json({ message: "Maintenance charge added", Id: result.recordset[0]?.Id });
  } catch (err) {
    console.error("POST CHARGE ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.delete("/customers/:bookingId/charges/:chargeId", requirePageRight("maintenance-customer-charges", "delete"), async (req, res) => {
  const chargeId = parseInt(req.params.chargeId, 10);
  if (!Number.isFinite(chargeId)) return res.status(400).json({ error: "Invalid charge id" });
  const updatedBy = req.user?.userId ?? req.user?.id ?? null;

  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("Id", sql.Int, chargeId)
      .input("BookingId", sql.Int, parseInt(req.params.bookingId, 10))
      .input("UpdatedBy", sql.Int, updatedBy)
      .input("UpdatedAt", sql.DateTime, new Date())
      .query(`
        UPDATE dbo.MaintenanceCustomerCharge SET Status = 0, UpdatedBy = @UpdatedBy, UpdatedAt = @UpdatedAt
        WHERE Id = @Id AND BookingId = @BookingId AND Status = 1
      `);
    if (!result.rowsAffected[0]) return res.status(404).json({ error: "Charge not found" });
    res.json({ message: "Charge removed" });
  } catch (err) {
    console.error("DELETE CHARGE ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
