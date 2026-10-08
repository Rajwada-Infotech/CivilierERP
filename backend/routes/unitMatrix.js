const express = require("express");
const { DEAD_BOOKING_SQL } = require("../constants/crmStatuses");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const apiRateLimit = require("../middleware/apiRateLimit");
const { requirePageRight } = require("../middleware/requirePageRight");
const { cache } = require("../middleware/cache");

router.use(authMiddleware);
router.use(apiRateLimit);

// GET /projects — project dropdown (mirrors unitMaster.js /projects)
router.get("/projects", requirePageRight("crm-unit-matrix", "view"), cache("unit-matrix-projects", 600), async (req, res) => {
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
    console.error("[unit-matrix] GET /projects error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /blocks?projectId= — block dropdown for the selected project
router.get("/blocks", requirePageRight("crm-unit-matrix", "view"), async (req, res) => {
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
    console.error("[unit-matrix] GET /blocks error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET / — the matrix itself. Status is always derived live from CrmBooking,
// never stored on UnitMaster, so it can never drift out of sync with the
// actual booking record: an administratively deactivated unit is Blocked,
// one with a live (non-cancelled) booking is Booked, everything else is
// Available.
// Plot availability, in the SAME shape and status vocabulary the unit matrix
// uses, so the matrix screen can render a plotted block without a second mental
// model (Available / OnHold / Booked / Blocked).
//
// WHY THIS EXISTS RATHER THAN REUSING plotMaster.js GET /
// That route already computes plot locks, but it is gated on
// 'crm-auto-project-setup' — a SETUP right. A salesperson who can see the unit
// matrix but was never given setup rights would have had no way to see whether
// a plot is free, which is precisely the question the matrix answers. Same data,
// correct permission.
//
// Plots live in dbo.PlotMaster (migration 511), not UnitMaster, and are held
// through dbo.CrmBookingPlot — so none of the unit query above can see them.
router.get("/plots", requirePageRight("crm-unit-matrix", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const projectId = parseInt(req.query.projectId, 10);
    if (!Number.isFinite(projectId)) return res.status(400).json({ error: "projectId is required" });
    const blockId = parseInt(req.query.blockId, 10);

    const request = pool.request().input("pid", sql.Int, projectId);
    let where = "p.ProjectId = @pid AND p.IsActive = 1";
    if (Number.isFinite(blockId)) {
      request.input("bid", sql.Int, blockId);
      where += " AND p.BlockId = @bid";
    }

    const result = await request.query(`
      SELECT
        p.Id, p.PlotNo, p.PlotName, p.BlockId, blk.BlockName,
        p.AreaSqFt, p.Facing, p.IsCornerPlot, p.RoadWidthFt, p.SurveyNo,
        p.ConvertedUnitId, converted.UnitName AS ConvertedUnitName,
        bk.Id AS BookingId, bk.BookingNo, bk.Status AS BookingStatus, bk.BookingDate,
        bk.TotalValue, bk.GrandTotal, bk.BookingAmount,
        CASE WHEN EXISTS (
          SELECT 1 FROM dbo.CrmPaymentMilestone m WHERE m.BookingId = bk.Id AND m.MilestoneNo = 1 AND m.Status = 'Paid'
        ) THEN 1 ELSE 0 END AS Milestone1Paid,
        a.Id AS ApplicationId, a.ApplicationNo, a.ApplicantName, a.Mobile,
        assn.name AS AssignedToName, assn.email AS AssignedToEmail,
        h.Id AS HoldId, h.HoldUntil
      FROM dbo.PlotMaster p
      LEFT JOIN dbo.BlockMaster blk ON blk.Id = p.BlockId
      LEFT JOIN dbo.UnitMaster converted ON converted.Id = p.ConvertedUnitId
      OUTER APPLY (
        SELECT TOP 1 cb.Id, cb.BookingNo, cb.Status, cb.BookingDate, cb.TotalValue, cb.GrandTotal, cb.BookingAmount, cb.ApplicationId
        FROM dbo.CrmBookingPlot bp
        JOIN dbo.CrmBooking cb ON cb.Id = bp.BookingId
        WHERE bp.PlotId = p.Id AND bp.Status = N'Active' AND cb.IsActive = 1
          AND cb.Status NOT IN (N'Cancelled', N'Rejected', N'Expired', N'Transferred')
      ) bk
      LEFT JOIN dbo.CrmApplication a ON a.Id = bk.ApplicationId
      LEFT JOIN dbo.users assn ON assn.id = a.AssignedTo
      OUTER APPLY (
        SELECT TOP 1 ih.Id, ih.HoldUntil FROM dbo.CrmInventoryHold ih
        WHERE ih.EntityType = N'Plot' AND ih.EntityId = p.Id AND ih.Status = N'Active'
          AND ih.HoldUntil >= SYSDATETIME()
      ) h
      WHERE ${where}
      ORDER BY blk.BlockName, p.PlotName
    `);

    const plots = result.recordset.map((r) => {
      // Identical rule to the unit matrix below: a Booking existing is not
      // enough to call a plot "Booked" — it must have cleared approval AND had
      // its booking-amount milestone paid. Ids of 0 are real in this database,
      // so these are `!= null` checks and never plain truthiness.
      const hasBookingId = r.BookingId != null;
      const hasHoldId = r.HoldId != null;
      const confirmed = hasBookingId && r.BookingStatus === "Approved" && r.Milestone1Paid;
      const isBooked = !!confirmed;
      const isOnHold = !isBooked && (hasBookingId || hasHoldId);
      // A plot already converted into a villa is no longer sellable AS LAND —
      // the constructed unit is what sells now, so it reads as Blocked here
      // rather than dangling as Available.
      const isConverted = r.ConvertedUnitId != null;
      return {
        Id: r.Id,
        UnitName: r.PlotName || r.PlotNo,
        PlotNo: r.PlotNo,
        BlockId: r.BlockId,
        BlockName: r.BlockName,
        Status: isConverted ? "Blocked" : isBooked ? "Booked" : isOnHold ? "OnHold" : "Available",
        AreaSqFt: r.AreaSqFt || null,
        Facing: r.Facing || null,
        IsCornerPlot: r.IsCornerPlot ?? null,
        RoadWidthFt: r.RoadWidthFt ?? null,
        SurveyNo: r.SurveyNo || null,
        ConvertedUnitId: r.ConvertedUnitId != null ? r.ConvertedUnitId : null,
        ConvertedUnitName: r.ConvertedUnitName || null,
        BookingId: hasBookingId ? r.BookingId : null,
        BookingNo: r.BookingNo || null,
        BookingStatus: r.BookingStatus || null,
        BookingDate: r.BookingDate || null,
        TotalValue: r.TotalValue ?? null,
        GrandTotal: r.GrandTotal ?? null,
        BookingAmount: r.BookingAmount ?? null,
        ApplicationId: r.ApplicationId != null ? r.ApplicationId : null,
        ApplicationNo: r.ApplicationNo || null,
        ApplicantName: r.ApplicantName || null,
        Mobile: r.Mobile || null,
        AssignedToName: r.AssignedToName || null,
        AssignedToEmail: r.AssignedToEmail || null,
        HoldId: hasHoldId ? r.HoldId : null,
        HoldUntil: r.HoldUntil || null,
      };
    });

    res.json(plots);
  } catch (e) {
    console.error("[unit-matrix] GET /plots:", e.message);
    res.status(500).json({ error: "Failed to load the plot matrix" });
  }
});

router.get("/", requirePageRight("crm-unit-matrix", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const projectId = parseInt(req.query.projectId, 10);
    if (!Number.isFinite(projectId)) return res.status(400).json({ error: "projectId is required" });
    const blockId = parseInt(req.query.blockId, 10);

    const request = pool.request().input("pid", sql.Int, projectId);
    // Land rows (a plot kept as a unit) are shown once, in the Plots section
    // from /plots, never again as units; a villa retired by "undo convert"
    // (inactive, renamed "~undone <id>") is history, not inventory.
    let where = `u.ProjectId = @pid
      AND NOT EXISTS (SELECT 1 FROM dbo.CrmConstructedAssetKind lk WHERE lk.Code = u.UnitKind AND lk.IsLand = 1)
      AND NOT (u.IsActive = 0 AND u.UnitName LIKE N'%~undone%')`;
    if (Number.isFinite(blockId)) {
      request.input("bid", sql.Int, blockId);
      where += " AND u.BlockId = @bid";
    }

    const commercialCol = (await pool.request().query("SELECT COL_LENGTH('dbo.CrmConstructedAssetKind', 'IsCommercial') AS c")).recordset[0].c != null;
    const result = await request.query(`
      SELECT
        u.Id, u.UnitName, u.FloorNo, u.BlockId, blk.BlockName, u.IsActive AS UnitIsActive,
        -- a villa built on a plot: no tower floor, grouped as "Villas"
        CAST(CASE WHEN EXISTS (SELECT 1 FROM dbo.PlotMaster pl WHERE pl.ConvertedUnitId = u.Id AND pl.IsActive = 1) THEN 1 ELSE 0 END AS BIT) AS IsVilla,
        -- who owns the land under a villa (services/villaLand.js rule): only
        -- that customer can buy it, and only once every plot under it is sold
        land.PlotCount AS VillaPlotCount, land.SoldPlotCount AS VillaSoldPlotCount, land.OwnerName AS VillaLandOwner,
        u.AreaSqFt,
        -- The unit's kind as named in the kind master, and whether it's
        -- commercial — so the matrix can tell shops/offices from flats.
        knd.Name AS KindName, ISNULL(knd.IsCommercial, 0) AS IsCommercial,
        bk.Id AS BookingId, bk.BookingNo, bk.Status AS BookingStatus, bk.BookingDate, bk.ConfirmDeadline,
        bk.TotalValue, bk.GrandTotal, bk.BookingAmount,
        CASE WHEN EXISTS (
          SELECT 1 FROM dbo.CrmPaymentMilestone m WHERE m.BookingId = bk.Id AND m.MilestoneNo = 1 AND m.Status = 'Paid'
        ) THEN 1 ELSE 0 END AS Milestone1Paid,
        a.Id AS ApplicationId, a.ApplicationNo, a.ApplicantName, a.Mobile,
        assn.name AS AssignedToName, assn.email AS AssignedToEmail,
        h.Id AS HoldId, h.HoldUntil, h.ApplicationId AS HoldApplicationId,
        ha.ApplicationNo AS HoldApplicationNo, ha.ApplicantName AS HoldApplicantName, ha.Mobile AS HoldMobile,
        hassn.name AS HoldAssignedToName, hassn.email AS HoldAssignedToEmail
      FROM dbo.UnitMaster u
      LEFT JOIN dbo.BlockMaster blk ON blk.Id = u.BlockId
      OUTER APPLY (
        SELECT COUNT(*) AS PlotCount, COUNT(o.CustomerId) AS SoldPlotCount, MAX(o.CustomerName) AS OwnerName
        FROM dbo.PlotMaster lp
        OUTER APPLY (
          SELECT TOP 1 la.CustomerId, lc.CustomerName
          FROM dbo.CrmBookingPlot lbp
          JOIN dbo.CrmBooking lb ON lb.Id = lbp.BookingId
          JOIN dbo.CrmApplication la ON la.Id = lb.ApplicationId
          LEFT JOIN dbo.CrmCustomer lc ON lc.Id = la.CustomerId
          WHERE lbp.PlotId = lp.Id AND lbp.Status = N'Active' AND lb.IsActive = 1 AND lb.Status NOT IN ${DEAD_BOOKING_SQL}
          ORDER BY lbp.Id DESC
        ) o
        WHERE lp.ConvertedUnitId = u.Id AND lp.IsActive = 1
      ) land
      OUTER APPLY (SELECT TOP 1 k.Name, ${commercialCol ? "k.IsCommercial" : "CAST(0 AS BIT) AS IsCommercial"} FROM dbo.CrmConstructedAssetKind k WHERE k.Code = u.UnitKind) knd
      LEFT JOIN dbo.CrmBooking bk ON bk.UnitId = u.Id AND bk.IsActive = 1 AND bk.Status NOT IN ('Cancelled', 'Rejected', 'Expired', 'Transferred') AND (bk.Status = 'Approved' OR bk.ConfirmDeadline IS NULL OR bk.ConfirmDeadline >= SYSDATETIME())
      LEFT JOIN dbo.CrmApplication a ON a.Id = bk.ApplicationId
      LEFT JOIN dbo.users assn ON assn.id = a.AssignedTo
      LEFT JOIN dbo.CrmInventoryHold h ON h.EntityType = 'Unit' AND h.EntityId = u.Id AND h.Status = 'Active' AND h.HoldUntil >= SYSDATETIME()
      LEFT JOIN dbo.CrmApplication ha ON ha.Id = h.ApplicationId
      LEFT JOIN dbo.users hassn ON hassn.id = ha.AssignedTo
      WHERE ${where}
      ORDER BY u.FloorNo, blk.BlockName, u.UnitName
    `);

    const units = result.recordset.map((r) => {
      // A Booking existing is no longer enough to call a unit "Booked" — it
      // must have actually cleared its own approval gate AND had its
      // booking-amount milestone paid (checkBookingApprovalReadiness in
      // crmBookings.js already requires both before allowing Approve, so
      // checking both here is belt-and-braces, not redundant guesswork).
      // Until then a real Booking sits in the SAME "OnHold" bucket a bare
      // pick does — TileInfoDialog on the frontend already branches on
      // BookingId to show "Booked — Payment Pending" instead of a plain
      // hold, so no frontend change was needed for this.
      // Ids of 0 are real rows here — CrmBooking had historical
      // identity-seed corruption (BKG-2026-00001 is Id 0; see migrations
      // 441-450) — so these must check `!= null`, never plain truthiness.
      // `r.BookingId &&`/`r.BookingId || null` silently treats a real
      // Booking at Id 0 as if none existed, showing a booked unit as
      // Available.
      const hasBookingId = r.BookingId != null;
      const hasHoldId = r.HoldId != null;
      const confirmed = hasBookingId && r.BookingStatus === "Approved" && r.Milestone1Paid;
      const isBooked = !!confirmed;
      const isOnHold = !isBooked && (hasBookingId || hasHoldId);
      return {
        Id: r.Id,
        UnitName: r.UnitName,
        FloorNo: r.FloorNo,
        BlockId: r.BlockId,
        BlockName: r.BlockName,
        Status: !r.UnitIsActive ? "Blocked" : isBooked ? "Booked" : isOnHold ? "OnHold" : "Available",
        AreaSqFt: r.AreaSqFt || null,
        IsVilla: !!r.IsVilla,
        // A villa whose land isn't (fully) sold can't be booked by anyone yet.
        VillaLandSold: r.IsVilla ? r.VillaPlotCount > 0 && r.VillaSoldPlotCount === r.VillaPlotCount : null,
        VillaLandOwner: r.IsVilla ? r.VillaLandOwner || null : null,
        KindName: r.KindName || null,
        IsCommercial: !!r.IsCommercial,
        BookingId: hasBookingId ? r.BookingId : null,
        BookingNo: r.BookingNo || null,
        BookingStatus: r.BookingStatus || null,
        BookingDate: r.BookingDate || null,
        TotalValue: r.TotalValue ?? null,
        GrandTotal: r.GrandTotal ?? null,
        BookingAmount: r.BookingAmount ?? null,
        ApplicationId: r.ApplicationId != null ? r.ApplicationId : null,
        ApplicationNo: r.ApplicationNo || null,
        ApplicantName: r.ApplicantName || null,
        Mobile: r.Mobile || null,
        AssignedToName: r.AssignedToName || null,
        AssignedToEmail: r.AssignedToEmail || null,
        HoldId: hasHoldId ? r.HoldId : null,
        // A still-unconfirmed Booking's countdown comes from its own
        // ConfirmDeadline snapshot (the raw Hold row gets marked
        // 'Converted' the instant the Booking was created, so it can't be
        // relied on afterwards) — a bare pre-Booking hold uses the live
        // hold's HoldUntil as before.
        HoldUntil: hasBookingId ? (r.ConfirmDeadline || null) : (r.HoldUntil || null),
        HoldApplicationId: r.HoldApplicationId || null,
        HoldApplicationNo: r.HoldApplicationNo || null,
        HoldApplicantName: r.HoldApplicantName || null,
        HoldMobile: r.HoldMobile || null,
        HoldAssignedToName: r.HoldAssignedToName || null,
        HoldAssignedToEmail: r.HoldAssignedToEmail || null,
      };
    });

    res.json(units);
  } catch (err) {
    console.error("[unit-matrix] GET error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
