// Resale — a plot (or constructed unit) changing hands between two
// CUSTOMERS, with the developer as facilitator rather than seller.
//
// THE FLOW THIS SERVES
// Plots are sold to buyers. The developer then builds villas on them
// regardless of who owns the plot. Once built, the owner either keeps the villa
// (paying for the construction) or exits, selling the plot on to a new buyer.
// That exit is what this records.
//
// THE ACCOUNTING RULE THAT SHAPES EVERY MONEY FIELD HERE
// The developer is NOT selling the land — the original buyer is. If a buyer
// bought at 20L and exits at 30L, that 10L gain is theirs. Routing it through
// developer income would inflate turnover and create a GST liability on a
// supply the developer never made. So:
//
//   AgreedValue         new buyer -> original buyer.  NEVER developer income.
//   DeveloperFeeAmount  the developer's facilitation fee. The ONLY figure here
//                       that is developer revenue — and being a service, it is
//                       taxable even though the land itself is outside GST.
//
// No GL posting happens from this route for AgreedValue, deliberately. Only the
// fee would ever post, and that is left to the existing invoice path rather
// than invented here.
//
// NOT TO BE CONFUSED WITH (all pre-existing, all different):
//   CrmRebookingTransfer  moves MONEY (a held credit) between bookings
//   CrmMutation           updates the municipal Khata record AFTER a deed
//   CrmCancellation       unwinds a sale; a resale unwinds nothing

const express = require("express");
const { getNextDocNumber } = require("../services/docNumber");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { parseId } = require("../middleware/validateRequest");
const { actorId } = require("../services/saAccess");
const { LineStatus, ResaleStatus } = require("../constants/crmStatuses");

router.use(authMiddleware);
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));

const SELECT = `
  SELECT r.Id, r.PlotId, r.UnitId, r.FromBookingId, r.FromCustomerId, r.ToBookingId, r.ToCustomerId,
         r.ResaleDate, r.AgreedValue, r.OriginalValue,
         r.DeveloperFeeAmount, r.DeveloperFeeGstAmount,
         r.Status, r.Notes, r.CreatedAt,
         p.PlotNo, p.PlotName, p.AreaSqFt AS PlotAreaSqFt,
         u.UnitName,
         fb.BookingNo AS FromBookingNo,
         tb.BookingNo AS ToBookingNo,
         fc.CustomerName AS FromCustomerName,
         tc.CustomerName AS ToCustomerName,
         -- The original buyer's gain, derived rather than stored so it can never
         -- drift from the two figures it comes from.
         (ISNULL(r.AgreedValue, 0) - ISNULL(r.OriginalValue, 0)) AS ResaleGain
  FROM dbo.CrmUnitResale r
  LEFT JOIN dbo.PlotMaster p   ON p.Id  = r.PlotId
  LEFT JOIN dbo.UnitMaster u   ON u.Id  = r.UnitId
  LEFT JOIN dbo.CrmBooking fb  ON fb.Id = r.FromBookingId
  LEFT JOIN dbo.CrmBooking tb  ON tb.Id = r.ToBookingId
  LEFT JOIN dbo.CrmCustomer fc ON fc.Id = r.FromCustomerId
  LEFT JOIN dbo.CrmCustomer tc ON tc.Id = r.ToCustomerId
`;

const num = (v) => (v != null && v !== "" ? Number(v) : null);

router.get("/", requirePageRight("crm-resales", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const r0 = pool.request();
    const conds = ["r.IsActive = 1"];
    if (req.query.plotId) { r0.input("pid", sql.Int, parseInt(req.query.plotId, 10)); conds.push("r.PlotId = @pid"); }
    if (req.query.status) { r0.input("st", sql.NVarChar(30), req.query.status); conds.push("r.Status = @st"); }
    const result = await r0.query(`${SELECT} WHERE ${conds.join(" AND ")} ORDER BY r.CreatedAt DESC`);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-resales] GET:", e.message);
    res.status(500).json({ error: "Failed to load resales" });
  }
});

router.post("/", requirePageRight("crm-resales", "create"), async (req, res) => {
  const b = req.body || {};
  const plotId = b.PlotId != null && b.PlotId !== "" ? parseInt(b.PlotId, 10) : null;
  const unitId = b.UnitId != null && b.UnitId !== "" ? parseInt(b.UnitId, 10) : null;

  // Mirrors CK_CrmUnitResale_OneTarget so the caller gets a readable message
  // instead of a raw constraint violation.
  if ((plotId == null) === (unitId == null))
    return res.status(400).json({ error: "Name exactly one of PlotId or UnitId — a resale changes hands for one thing." });

  try {
    const pool = getPool();

    // The outgoing side is derived from the live booking rather than trusted
    // from the request: whoever currently holds the plot IS the seller, and
    // letting a caller name someone else would silently reassign ownership.
    let fromBookingId = null;
    let fromCustomerId = null;
    let originalValue = null;
    if (plotId != null) {
      const held = await pool.request().input("p", sql.Int, plotId).query(`
        SELECT TOP 1 bp.BookingId, bp.AllocatedValue, a.CustomerId
        FROM dbo.CrmBookingPlot bp
        JOIN dbo.CrmBooking bk ON bk.Id = bp.BookingId
        JOIN dbo.CrmApplication a ON a.Id = bk.ApplicationId
        WHERE bp.PlotId = @p AND bp.Status = N'${LineStatus.ACTIVE}'
          AND bk.IsActive = 1 AND bk.Status NOT IN (N'Cancelled', N'Rejected', N'Expired')
        ORDER BY bp.Id DESC
      `);
      const row = held.recordset[0];
      if (!row)
        return res.status(400).json({ error: "That plot is not currently held by anyone — there is nothing to resell." });
      // Once the owner has bought the villa on this plot, the plot alone can't
      // change hands: the villa contract would be left with the old owner on
      // land they no longer hold. Moving a villa contract is a separate flow.
      const villaBooked = await pool.request().input("p", sql.Int, plotId).query(`
        SELECT TOP 1 vb.BookingNo
        FROM dbo.PlotMaster p
        JOIN dbo.CrmBooking vb ON vb.UnitId = p.ConvertedUnitId
        WHERE p.Id = @p AND vb.IsActive = 1 AND vb.Status NOT IN (N'Cancelled', N'Rejected', N'Expired')`);
      if (villaBooked.recordset.length)
        return res.status(409).json({ error: `The villa on this plot is already booked (${villaBooked.recordset[0].BookingNo}). A plot with a booked villa can't be resold as bare land.` });
      fromBookingId = row.BookingId;
      fromCustomerId = row.CustomerId;
      // Snapshotted so a later rate change cannot restate an already-agreed gain.
      originalValue = row.AllocatedValue;
    }

    const result = await pool.request()
      .input("plot", sql.Int, plotId)
      .input("unit", sql.Int, unitId)
      .input("fb", sql.Int, fromBookingId)
      .input("fc", sql.Int, fromCustomerId)
      .input("tc", sql.Int, b.ToCustomerId != null && b.ToCustomerId !== "" ? parseInt(b.ToCustomerId, 10) : null)
      .input("date", sql.Date, b.ResaleDate || null)
      .input("agreed", sql.Decimal(18, 2), num(b.AgreedValue))
      .input("orig", sql.Decimal(18, 2), originalValue != null ? originalValue : num(b.OriginalValue))
      .input("fee", sql.Decimal(18, 2), num(b.DeveloperFeeAmount))
      .input("feeGst", sql.Decimal(18, 2), num(b.DeveloperFeeGstAmount))
      .input("notes", sql.NVarChar(1000), b.Notes || null)
      .input("by", sql.Int, actorId(req))
      .query(`
        INSERT INTO dbo.CrmUnitResale
          (PlotId, UnitId, FromBookingId, FromCustomerId, ToCustomerId, ResaleDate,
           AgreedValue, OriginalValue, DeveloperFeeAmount, DeveloperFeeGstAmount,
           Status, Notes, CreatedBy)
        OUTPUT INSERTED.Id
        VALUES (@plot, @unit, @fb, @fc, @tc, @date,
                @agreed, @orig, @fee, @feeGst,
                N'${ResaleStatus.PENDING}', @notes, @by)
      `);
    res.status(201).json({ success: true, id: result.recordset[0].Id });
  } catch (e) {
    console.error("[crm-resales] POST:", e.message);
    res.status(500).json({ error: "Failed to record the resale" });
  }
});

// Completing a resale is what actually moves the plot: the outgoing booking
// line becomes 'Transferred' and the incoming booking takes it over.
//
// 'Transferred', not 'Cancelled' — nothing was undone. The original sale stands
// and the original buyer was paid; the plot simply has a new owner. Cancelling it
// would misstate history and, for a cancelled booking, could trigger refund
// handling for money that was never refunded.
router.put("/:id/complete", requirePageRight("crm-resales", "edit"), async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  let toBookingId = req.body?.ToBookingId != null && req.body.ToBookingId !== "" ? parseInt(req.body.ToBookingId, 10) : null;
  if (toBookingId != null && !Number.isFinite(toBookingId))
    return res.status(400).json({ error: "Invalid ToBookingId" });

  const pool = getPool();
  const tx = new sql.Transaction(pool);
  try {
    const cur = await pool.request().input("id", sql.Int, id)
      .query("SELECT Id, PlotId, UnitId, FromBookingId, ToCustomerId, ResaleDate, Status FROM dbo.CrmUnitResale WHERE Id = @id AND IsActive = 1");
    const resale = cur.recordset[0];
    if (!resale) return res.status(404).json({ error: "Resale not found" });
    if (resale.Status === ResaleStatus.COMPLETED) return res.status(400).json({ error: "This resale is already completed" });
    if (resale.Status === ResaleStatus.CANCELLED) return res.status(400).json({ error: "This resale was cancelled" });

    // The new buyer's ownership record. They paid the original buyer for the
    // land, not the developer, so it carries no value owed to the developer
    // and no payment schedule — it exists so the plot has an owner on record,
    // and so that owner can then buy the villa (services/villaLand.js).
    // Created here because the plot cannot be booked by anyone else while the
    // original buyer still holds it: requiring the booking first could never
    // be satisfied.
    let holding = null;
    if (toBookingId == null) {
      if (resale.PlotId == null)
        return res.status(400).json({ error: "ToBookingId is required — a villa resale needs the new buyer's villa booking." });
      if (resale.ToCustomerId == null)
        return res.status(400).json({ error: "Name the new buyer on the resale before completing it." });
      const ctx = (await pool.request().input("p", sql.Int, resale.PlotId).input("c", sql.Int, resale.ToCustomerId).query(`
        SELECT p.PlotName, p.ProjectId, p.BlockId, p.AreaSqFt, blk.BlockName, proj.name AS ProjectName, proj.company_id AS CompanyId,
               c.CustomerName, c.Mobile, c.Email
        FROM dbo.PlotMaster p
        LEFT JOIN dbo.BlockMaster blk ON blk.Id = p.BlockId
        LEFT JOIN dbo.enterprise proj ON proj.id = p.ProjectId
        JOIN dbo.CrmCustomer c ON c.Id = @c
        WHERE p.Id = @p`)).recordset[0];
      if (!ctx) return res.status(400).json({ error: "The new buyer's customer record was not found." });
      // getNextDocNumber takes its own lock and must run on the pool, before the transaction.
      holding = { ...ctx, appNo: await getNextDocNumber(pool, "APP", "APP"), bookingNo: await getNextDocNumber(pool, "BKG", "BKG") };
    }

    await tx.begin();

    // The seller's application line for the plot moves with the land too:
    // one Active application line per plot is enforced, and the plot is no
    // longer the seller's to apply under.
    if (resale.PlotId != null) {
      await tx.request().input("p", sql.Int, resale.PlotId).input("b", sql.Int, resale.FromBookingId)
        .query(`UPDATE ap SET Status = N'${LineStatus.TRANSFERRED}'
                FROM dbo.CrmApplicationPlot ap
                JOIN dbo.CrmBooking fb ON fb.ApplicationId = ap.ApplicationId
                WHERE ap.PlotId = @p AND ap.Status = N'Active' AND fb.Id = @b`);
    }

    if (holding) {
      const note = `Plot ${holding.PlotName} held by resale — land bought from the original buyer, nothing owed to the developer.`;
      const app = await tx.request()
        .input("no", sql.NVarChar(50), holding.appNo).input("name", sql.NVarChar(200), holding.CustomerName)
        .input("mob", sql.NVarChar(20), holding.Mobile || null).input("email", sql.NVarChar(200), holding.Email || null)
        .input("cid", sql.Int, resale.ToCustomerId).input("pid", sql.Int, holding.ProjectId).input("co", sql.Int, holding.CompanyId)
        .input("proj", sql.NVarChar(200), holding.ProjectName).input("unit", sql.NVarChar(200), holding.PlotName)
        .input("note", sql.NVarChar(sql.MAX), note).input("by", sql.Int, actorId(req)).input("date", sql.Date, resale.ResaleDate || new Date())
        .query(`INSERT INTO dbo.CrmApplication (ApplicationNo, ApplicantName, Mobile, Email, CustomerId, ProjectId, CompanyId,
                  InterestedProject, InterestedUnit, Source, Status, Notes, DateOfApply, CreatedBy, AssignedTo, AssignedBy)
                OUTPUT INSERTED.Id
                VALUES (@no, @name, @mob, @email, @cid, @pid, @co, @proj, @unit, N'Other', N'Pending', @note, @date, @by, @by, @by)`);
      const appId = app.recordset[0].Id;
      await tx.request().input("a", sql.Int, appId).input("p", sql.Int, resale.PlotId).input("by", sql.Int, actorId(req))
        .query(`INSERT INTO dbo.CrmApplicationPlot (ApplicationId, PlotId, Status, IsPrimary, CreatedBy) VALUES (@a, @p, N'Active', 1, @by)`);
      const bk = await tx.request()
        .input("no", sql.NVarChar(50), holding.bookingNo).input("a", sql.Int, appId)
        .input("pid", sql.Int, holding.ProjectId).input("pname", sql.NVarChar(200), holding.ProjectName).input("co", sql.Int, holding.CompanyId)
        .input("blk", sql.Int, holding.BlockId).input("blkName", sql.NVarChar(100), holding.BlockName)
        .input("unit", sql.NVarChar(200), holding.PlotName).input("area", sql.Decimal(18, 2), holding.AreaSqFt)
        .input("date", sql.Date, resale.ResaleDate || new Date()).input("note", sql.NVarChar(sql.MAX), note).input("by", sql.Int, actorId(req))
        .query(`INSERT INTO dbo.CrmBooking (BookingNo, ApplicationId, UnitId, ProjectId, ProjectName, CompanyId, BlockId, BlockName, UnitNo,
                  AreaSqFt, TotalValue, GrandTotal, BookingAmount, BookingDate, Status, WorkflowStage, ConfirmedAt, ConfirmedBy, Notes, CreatedBy, AssignedTo)
                OUTPUT INSERTED.Id
                VALUES (@no, @a, NULL, @pid, @pname, @co, @blk, @blkName, @unit,
                  @area, 0, 0, 0, @date, N'Approved', N'Confirmed', SYSDATETIME(), @by, @note, @by, @by)`);
      toBookingId = bk.recordset[0].Id;
    }

    if (resale.PlotId != null) {
      // Release the outgoing line first. The unique index allows one Active
      // line per plot, so the order matters: transferring before inserting
      // keeps the invariant true at every point, and the transaction means a
      // failure half-way leaves the plot with its original owner rather than
      // with none.
      await tx.request().input("p", sql.Int, resale.PlotId).input("b", sql.Int, resale.FromBookingId)
        .query(`UPDATE dbo.CrmBookingPlot SET Status = N'${LineStatus.TRANSFERRED}'
                WHERE PlotId = @p AND Status = N'${LineStatus.ACTIVE}' AND (@b IS NULL OR BookingId = @b)`);

      const prior = await tx.request().input("p", sql.Int, resale.PlotId)
        .query("SELECT TOP 1 AreaSqFt, RatePerSqFt, AllocatedValue FROM dbo.CrmBookingPlot WHERE PlotId = @p ORDER BY Id DESC");
      const pr = prior.recordset[0] || {};

      await tx.request()
        .input("b", sql.Int, toBookingId)
        .input("p", sql.Int, resale.PlotId)
        .input("a", sql.Decimal(18, 2), pr.AreaSqFt ?? null)
        .input("r", sql.Decimal(18, 2), pr.RatePerSqFt ?? null)
        .input("v", sql.Decimal(18, 2), pr.AllocatedValue ?? null)
        .query(`INSERT INTO dbo.CrmBookingPlot (BookingId, PlotId, AreaSqFt, RatePerSqFt, AllocatedValue, Status, IsPrimary)
                VALUES (@b, @p, @a, @r, @v, N'${LineStatus.ACTIVE}', 0)`);
    }

    await tx.request().input("id", sql.Int, id).input("tb", sql.Int, toBookingId).input("by", sql.Int, actorId(req))
      .query(`UPDATE dbo.CrmUnitResale
              SET Status = N'${ResaleStatus.COMPLETED}', ToBookingId = @tb, UpdatedBy = @by, UpdatedAt = SYSDATETIME()
              WHERE Id = @id`);

    await tx.commit();
    res.json({ success: true, ToBookingId: toBookingId, holdingCreated: !!holding });
  } catch (e) {
    try { await tx.rollback(); } catch { /* already rolled back */ }
    console.error("[crm-resales] PUT /:id/complete:", e.message);
    res.status(500).json({ error: "Failed to complete the resale" });
  }
});

router.put("/:id/cancel", requirePageRight("crm-resales", "edit"), async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const r = await pool.request().input("id", sql.Int, id).input("by", sql.Int, actorId(req))
      .query(`UPDATE dbo.CrmUnitResale SET Status = N'${ResaleStatus.CANCELLED}', UpdatedBy = @by, UpdatedAt = SYSDATETIME()
              WHERE Id = @id AND IsActive = 1 AND Status <> N'${ResaleStatus.COMPLETED}'`);
    if (!r.rowsAffected[0])
      return res.status(400).json({ error: "Not found, or already completed — a completed resale has already moved the plot and cannot be cancelled here." });
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-resales] PUT /:id/cancel:", e.message);
    res.status(500).json({ error: "Failed to cancel the resale" });
  }
});

module.exports = router;
