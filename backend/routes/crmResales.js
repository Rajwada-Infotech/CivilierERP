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
const { releaseBookingInventoryLines } = require("../services/crmWorkflowGuards");
const { getNextDocNumber } = require("../services/docNumber");
const { resolveResaleFeeGst, GstSetupError } = require("../services/crmGst");
const router = express.Router();
// Project access: a restricted user gets 403 on records outside their projects.
// A resale is for a plot or a unit; its project comes from either, else the seller's booking.
{ const { crmProjectGuards } = require("../services/projectScope"); crmProjectGuards(router, `
  SELECT COALESCE(p.ProjectId, u.ProjectId, b.ProjectId) AS ProjectId FROM dbo.CrmUnitResale r
  LEFT JOIN dbo.PlotMaster p ON p.Id = r.PlotId LEFT JOIN dbo.UnitMaster u ON u.Id = r.UnitId
  LEFT JOIN dbo.CrmBooking b ON b.Id = r.FromBookingId WHERE r.Id = @id`); }
const rateLimit = require("../middleware/rateLimiter");
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
         r.DeveloperFeeAmount, r.DeveloperFeeGstAmount, r.DeveloperFeeHsnCode, r.DeveloperFeeGstRate,
         r.Status, r.Notes, r.CreatedAt, r.Kind, r.BookingIds, r.PaidAtTransfer, r.TdsAmount, r.BuyBackGstAmount, r.StampDutyAmount,
         r.ApprovedAt, r.RejectionNote, r.CompletedAt, r.PayoutNewPaymentId,
         p.PlotNo, p.PlotName, p.AreaSqFt AS PlotAreaSqFt,
         u.UnitName,
         fb.BookingNo AS FromBookingNo, fb.ProjectId AS ProjectId,
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
    // A resale's project: its plot's, else its unit's, else the seller's booking's.
    if (req.projectScope) conds.push(require("../services/projectScope").projectPredicate(req.projectScope,
      "COALESCE((SELECT ProjectId FROM dbo.PlotMaster WHERE Id = r.PlotId), (SELECT ProjectId FROM dbo.UnitMaster WHERE Id = r.UnitId), (SELECT ProjectId FROM dbo.CrmBooking WHERE Id = r.FromBookingId))", "").trim());
    if (req.query.status) { r0.input("st", sql.NVarChar(30), req.query.status); conds.push("r.Status = @st"); }
    const result = await r0.query(`${SELECT} WHERE ${conds.join(" AND ")} ORDER BY r.CreatedAt DESC`);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-resales] GET:", e.message);
    res.status(500).json({ error: "Failed to load resales" });
  }
});

// GET /fee-gst?amount= — what GST the fee will carry, from the GST rules and
// HSN masters, so the form shows the same figure the server will store.
router.get("/fee-gst", requirePageRight("crm-resales", "view"), async (req, res) => {
  try {
    res.json(await resolveResaleFeeGst(getPool(), req.query.amount, { landSale: req.query.plot === "1" }));
  } catch (e) {
    if (e instanceof GstSetupError) return res.status(400).json({ error: e.message });
    console.error("[crm-resales] GET /fee-gst:", e.message);
    res.status(500).json({ error: "Failed to work out the fee GST" });
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
          AND bk.IsActive = 1 AND bk.Status NOT IN (N'Cancelled', N'Rejected', N'Expired', N'Transferred')
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
        WHERE p.Id = @p AND vb.IsActive = 1 AND vb.Status NOT IN (N'Cancelled', N'Rejected', N'Expired', N'Transferred')`);
      if (villaBooked.recordset.length)
        return res.status(409).json({ error: `The villa on this plot is already booked (${villaBooked.recordset[0].BookingNo}). A plot with a booked villa can't be resold as bare land.` });
      // An open application or hold on the villa is a claim made under the
      // current owner — it has to be closed before the land changes hands.
      const villaClaim = (await pool.request().input("p", sql.Int, plotId).query(`
        SELECT TOP 1 COALESCE(a.ApplicationNo, N'a hold') AS Ref
        FROM dbo.PlotMaster p
        LEFT JOIN dbo.CrmApplication a ON a.PreferredUnitId = p.ConvertedUnitId AND a.IsActive = 1
          AND a.Status NOT IN (N'Rejected', N'Cancelled', N'Expired', N'Converted')
        LEFT JOIN dbo.CrmInventoryHold h ON h.EntityType = N'Unit' AND h.EntityId = p.ConvertedUnitId
          AND h.Status = N'Active' AND h.HoldUntil >= SYSDATETIME()
        WHERE p.Id = @p AND p.ConvertedUnitId IS NOT NULL AND (a.Id IS NOT NULL OR h.Id IS NOT NULL)`)).recordset[0];
      if (villaClaim)
        return res.status(409).json({ error: `The villa on this plot has an open application or hold (${villaClaim.Ref}). Close it before reselling the plot.` });
      fromBookingId = row.BookingId;
      fromCustomerId = row.CustomerId;
      // Snapshotted so a later rate change cannot restate an already-agreed gain.
      originalValue = row.AllocatedValue;
    } else {
      // A unit resale is the villa built on a plot (see /complete) — never a
      // flat or shop, which this flow can't transfer. The seller is whoever
      // holds the villa now, read from the live booking like a plot's.
      const held = await pool.request().input("u", sql.Int, unitId).query(`
        SELECT TOP 1 bk.Id AS BookingId, bk.TotalValue, a.CustomerId
        FROM dbo.CrmBooking bk
        JOIN dbo.CrmApplication a ON a.Id = bk.ApplicationId
        WHERE bk.UnitId = @u AND bk.IsActive = 1 AND bk.Status NOT IN (N'Cancelled', N'Rejected', N'Expired', N'Transferred')
        ORDER BY bk.Id DESC`);
      const onPlot = (await pool.request().input("u", sql.Int, unitId)
        .query("SELECT COUNT(*) AS n FROM dbo.PlotMaster WHERE ConvertedUnitId = @u")).recordset[0].n > 0;
      if (!onPlot)
        return res.status(400).json({ error: "Only a villa built on a plot can be resold here — this unit isn't one." });
      const row = held.recordset[0];
      if (!row)
        return res.status(400).json({ error: "That villa is not currently held by anyone — there is nothing to resell." });
      fromBookingId = row.BookingId;
      fromCustomerId = row.CustomerId;
      originalValue = row.TotalValue;
    }

    // The fee's GST comes from the masters, never from the request.
    let feeGst;
    try {
      feeGst = await resolveResaleFeeGst(pool, num(b.DeveloperFeeAmount), { landSale: plotId != null });
    } catch (e) {
      if (e instanceof GstSetupError) return res.status(400).json({ error: e.message });
      throw e;
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
      .input("feeGst", sql.Decimal(18, 2), feeGst.gstAmount)
      .input("feeHsn", sql.VarChar(20), feeGst.hsnCode)
      .input("feeRate", sql.Decimal(5, 2), feeGst.rate)
      .input("notes", sql.NVarChar(1000), b.Notes || null)
      .input("by", sql.Int, actorId(req))
      .query(`
        INSERT INTO dbo.CrmUnitResale
          (PlotId, UnitId, FromBookingId, FromCustomerId, ToCustomerId, ResaleDate,
           AgreedValue, OriginalValue, DeveloperFeeAmount, DeveloperFeeGstAmount, DeveloperFeeHsnCode, DeveloperFeeGstRate,
           Status, Notes, CreatedBy)
        OUTPUT INSERTED.Id
        VALUES (@plot, @unit, @fb, @fc, @tc, @date,
                @agreed, @orig, @fee, @feeGst, @feeHsn, @feeRate,
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
      .query("SELECT Id, PlotId, UnitId, FromBookingId, ToCustomerId, ResaleDate, Status, BookingIds FROM dbo.CrmUnitResale WHERE Id = @id AND IsActive = 1");
    const resale = cur.recordset[0];
    if (!resale) return res.status(404).json({ error: "Resale not found" });
    if (resale.Status === ResaleStatus.COMPLETED) return res.status(400).json({ error: "This resale is already completed" });
    if (resale.Status === ResaleStatus.CANCELLED) return res.status(400).json({ error: "This resale was cancelled" });
    if (resale.BookingIds) return res.status(400).json({ error: "Complete this one from Resale & Buy-back — it passes the booking to the new buyer" });

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

    // The seller's booking closes as 'Transferred' once nothing is left on it —
    // its villa, or its last plot, now belongs to the buyer. Not 'Cancelled':
    // the sale stands and nothing is refunded. Every "is this booking live"
    // check treats Transferred as closed (no dues, no workflow, no ownership);
    // money already received from the seller still shows in their history.
    if (resale.FromBookingId != null) {
      const closed = await tx.request().input("b", sql.Int, resale.FromBookingId).input("rid", sql.Int, id).input("by", sql.Int, actorId(req))
        .query(`UPDATE dbo.CrmBooking SET Status = N'Transferred', UpdatedBy = @by, UpdatedAt = SYSDATETIME()
                WHERE Id = @b AND IsActive = 1 AND Status NOT IN (N'Cancelled', N'Rejected', N'Expired', N'Transferred')
                  AND NOT EXISTS (SELECT 1 FROM dbo.CrmBookingPlot bp WHERE bp.BookingId = @b AND bp.Status = N'${LineStatus.ACTIVE}')
                  AND (UnitId IS NULL OR UnitId = (SELECT r.UnitId FROM dbo.CrmUnitResale r WHERE r.Id = @rid))`);
      if (closed.rowsAffected[0]) await releaseBookingInventoryLines(tx, resale.FromBookingId, "Transferred");
    }

    await tx.commit();

    // The developer's fee posts after the resale is committed, like every
    // other CRM posting: a ledger failure is recorded (GLPostingLog) and
    // surfaced, never allowed to undo the transfer that already happened.
    let ledgerWarning = null;
    try {
      const { postCrmResaleFeeToGL } = require("../services/crmLedger");
      const { recordGLPosting } = require("../services/approvalService");
      const actor = req.user?.email || req.user?.name || String(actorId(req));
      const outcome = await postCrmResaleFeeToGL(pool, id, actor);
      await recordGLPosting("crm-resale", id, outcome, actor);
      if (outcome && outcome.posted === false) ledgerWarning = outcome.reason;
    } catch (glErr) {
      ledgerWarning = `Resale fee was not posted to the ledger: ${glErr.message}`;
      console.error("[crm-resales] resale fee GL posting failed for", id, "—", glErr.message);
    }
    res.json({ success: true, ToBookingId: toBookingId, holdingCreated: !!holding, ledgerWarning });
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

// ── Resale & Buy-back (migration 550) ─────────────────────────────────────
// Any sold property: a plot, a villa (with the plot under it), a flat, a shop.

async function bumpResales(...keys) {
  const { bumpCacheVersion } = require("../redis");
  for (const k of ["crm-resales", ...keys]) {
    try { await bumpCacheVersion(k); } catch { /* cache bump is best-effort */ }
  }
}

// GET /holdings — live bookings that can change hands, one row per property
// (a plot and the villa on it, held by one buyer, are one row).
router.get("/holdings", requirePageRight("crm-resales", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const r0 = pool.request();
    const conds = ["b.IsActive = 1", "b.Status NOT IN (N'Cancelled', N'Rejected', N'Expired', N'Transferred')"];
    if (req.projectScope) conds.push(require("../services/projectScope").projectPredicate(req.projectScope, "b.ProjectId", "").trim());
    if (req.query.projectId) { r0.input("pid", sql.Int, parseInt(req.query.projectId, 10)); conds.push("b.ProjectId = @pid"); }
    const rows = (await r0.query(`
      SELECT b.Id AS BookingId, b.BookingNo, b.UnitNo, b.ProjectId, b.ProjectName, b.BlockName, b.TotalValue, b.Status,
             a.CustomerId, c.CustomerName, c.Mobile,
             CASE WHEN EXISTS (SELECT 1 FROM dbo.CrmBookingPlot x WHERE x.BookingId = b.Id AND x.Status = N'Active') THEN N'Plot'
                  WHEN EXISTS (SELECT 1 FROM dbo.PlotMaster p WHERE p.ConvertedUnitId = b.UnitId AND p.IsActive = 1) THEN N'Villa'
                  ELSE ISNULL(u.UnitKind, N'Unit') END AS Kind,
             (SELECT ISNULL(SUM(AmountPaid), 0) FROM dbo.CrmPaymentMilestone WHERE BookingId = b.Id)
               + (SELECT ISNULL(SUM(Amount - ISNULL(AppliedAmount, 0)), 0) FROM dbo.CrmOnAccountPayment WHERE BookingId = b.Id) AS Paid
      FROM dbo.CrmBooking b
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      LEFT JOIN dbo.CrmCustomer c ON c.Id = a.CustomerId
      LEFT JOIN dbo.UnitMaster u ON u.Id = b.UnitId
      WHERE ${conds.join(" AND ")}
      ORDER BY b.ProjectName, b.UnitNo`)).recordset;
    // A villa's land booking folds into the villa's row.
    const { propertyOfBooking } = require("../services/villaLand");
    const seen = new Set();
    const out = [];
    for (const r of rows) {
      if (seen.has(r.BookingId)) continue;
      const p = r.Kind === "Plot" || r.Kind === "Villa" ? await propertyOfBooking(pool, r.BookingId) : null;
      const group = p && p.combined ? rows.filter((x) => p.bookings.some((b) => b.Id === x.BookingId)) : [r];
      group.forEach((g) => seen.add(g.BookingId));
      const lead = group.find((g) => g.Kind === "Villa") || group[0];
      out.push({
        ...lead,
        Kind: group.length > 1 ? "Plot + Villa" : lead.Kind,
        BookingIds: group.map((g) => g.BookingId),
        BookingNos: group.map((g) => g.BookingNo).join(" + "),
        UnitNo: group.map((g) => g.UnitNo).join(" + "),
        TotalValue: group.reduce((s2, g) => s2 + Number(g.TotalValue || 0), 0),
        Paid: Math.round(group.reduce((s2, g) => s2 + Number(g.Paid || 0), 0) * 100) / 100,
      });
    }
    const { openResaleOn } = require("../services/crmResaleTransfer");
    for (const o of out) o.OpenDeal = await openResaleOn(pool, o.BookingIds);
    res.json(out);
  } catch (e) {
    console.error("[crm-resales] GET /holdings:", e.message);
    res.status(500).json({ error: "Failed to load the properties" });
  }
});

// POST /deal — record a resale (to another buyer) or a buy-back (to us). The
// seller and the bookings are read from the live booking, never trusted from the request.
router.post("/deal", requirePageRight("crm-resales", "create"), async (req, res) => {
  const b = req.body || {};
  const kind = b.Kind === "BuyBack" ? "BuyBack" : "Resale";
  const bookingId = parseInt(b.FromBookingId, 10);
  if (!Number.isInteger(bookingId)) return res.status(400).json({ error: "Choose the property that is changing hands" });
  const toCustomerId = b.ToCustomerId != null && b.ToCustomerId !== "" ? parseInt(b.ToCustomerId, 10) : null;
  if (kind === "Resale" && !Number.isInteger(toCustomerId)) return res.status(400).json({ error: "Choose the new buyer" });
  const agreed = num(b.AgreedValue);
  if (kind === "BuyBack" && !(agreed > 0)) return res.status(400).json({ error: "Enter the agreed buy-back price" });
  try {
    const pool = getPool();
    const { movingBookings, openResaleOn } = require("../services/crmResaleTransfer");
    const bookings = await movingBookings(pool, bookingId);
    if (!bookings.length) return res.status(400).json({ error: "That booking is not live — nothing to resell" });
    const seller = bookings[0].CustomerId;
    if (bookings.some((x) => x.CustomerId !== seller)) return res.status(409).json({ error: "The plot and villa are held by different customers — they can't change hands as one" });
    if (kind === "Resale" && toCustomerId === seller) return res.status(400).json({ error: "The new buyer is the same customer as the seller" });
    const open = await openResaleOn(pool, bookings.map((x) => x.Id));
    if (open) return res.status(409).json({ error: `This property already has an open ${open.Kind === "BuyBack" ? "buy-back" : "resale"} (#${open.Id})` });
    // The row names one thing (PlotId or UnitId): the villa or unit, else the plot.
    const ids = bookings.map((x) => x.Id);
    const target = (await pool.request().query(`
      SELECT TOP 1 b.UnitId, (SELECT TOP 1 bp.PlotId FROM dbo.CrmBookingPlot bp WHERE bp.BookingId = b.Id AND bp.Status = N'Active' ORDER BY bp.IsPrimary DESC, bp.Id) AS PlotId
      FROM dbo.CrmBooking b WHERE b.Id IN (${ids.join(",")}) ORDER BY CASE WHEN b.UnitId IS NOT NULL THEN 0 ELSE 1 END, b.Id`)).recordset[0] || {};
    const unitId = target.UnitId ?? null;
    const plotId = unitId == null ? target.PlotId ?? null : null;
    if (unitId == null && plotId == null) return res.status(400).json({ error: "That booking has no unit or plot on it" });
    const paid = Math.round(bookings.reduce((s2, x) => s2 + Number(x.Paid || 0), 0) * 100) / 100;
    let feeGst = { gstAmount: null, hsnCode: null, rate: null };
    if (kind === "Resale" && num(b.DeveloperFeeAmount) > 0) {
      try { feeGst = await resolveResaleFeeGst(pool, num(b.DeveloperFeeAmount), { landSale: unitId == null }); }
      catch (e) { if (e instanceof GstSetupError) return res.status(400).json({ error: e.message }); throw e; }
    }
    const r = await pool.request()
      .input("kind", sql.NVarChar(10), kind).input("plot", sql.Int, plotId).input("unit", sql.Int, unitId)
      .input("fb", sql.Int, bookings[0].Id).input("ids", sql.NVarChar(200), ids.join(","))
      .input("fc", sql.Int, seller).input("tc", sql.Int, kind === "Resale" ? toCustomerId : null)
      .input("date", sql.Date, b.ResaleDate || null).input("agreed", sql.Decimal(18, 2), agreed)
      .input("orig", sql.Decimal(18, 2), paid)
      .input("fee", sql.Decimal(18, 2), kind === "Resale" ? num(b.DeveloperFeeAmount) : null)
      .input("feeGst", sql.Decimal(18, 2), feeGst.gstAmount).input("feeHsn", sql.VarChar(20), feeGst.hsnCode).input("feeRate", sql.Decimal(5, 2), feeGst.rate)
      .input("tds", sql.Decimal(18, 2), kind === "BuyBack" ? num(b.TdsAmount) : null)
      .input("bbGst", sql.Decimal(18, 2), kind === "BuyBack" ? num(b.BuyBackGstAmount) : null)
      .input("stamp", sql.Decimal(18, 2), kind === "BuyBack" ? num(b.StampDutyAmount) : null)
      .input("notes", sql.NVarChar(1000), b.Notes || null).input("by", sql.Int, actorId(req))
      .query(`INSERT INTO dbo.CrmUnitResale
                (Kind, PlotId, UnitId, FromBookingId, BookingIds, FromCustomerId, ToCustomerId, ResaleDate, AgreedValue, OriginalValue,
                 DeveloperFeeAmount, DeveloperFeeGstAmount, DeveloperFeeHsnCode, DeveloperFeeGstRate,
                 TdsAmount, BuyBackGstAmount, StampDutyAmount, Status, Notes, CreatedBy)
              OUTPUT INSERTED.Id
              VALUES (@kind, @plot, @unit, @fb, @ids, @fc, @tc, @date, @agreed, @orig,
                      @fee, @feeGst, @feeHsn, @feeRate, @tds, @bbGst, @stamp, N'${ResaleStatus.PENDING}', @notes, @by)`);
    await bumpResales();
    res.status(201).json({ success: true, id: r.recordset[0].Id, message: "Recorded — waiting for approval in the Approval Inbox" });
  } catch (e) {
    console.error("[crm-resales] POST /deal:", e.message);
    res.status(500).json({ error: "Failed to record it" });
  }
});

// PUT /:id/approve, /:id/reject — the shared approval engine, so the levels
// (CRM head, then Finance) are set in Approval Setup like every module.
router.put("/:id/approve", requirePageRight("crm-resales", "edit"), async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  try {
    const email = req.user?.email || req.user?.name;
    if (!email) return res.status(401).json({ error: "Sign in again" });
    const { transition } = require("../services/approvalService");
    const result = await transition("crm-resales", id, "Approved", email, req.user?.role, null, req.user?.userId ?? null);
    if (result.newStatus === "Approved") {
      await getPool().request().input("id", sql.Int, id).input("by", sql.Int, actorId(req))
        .query("UPDATE dbo.CrmUnitResale SET ApprovedBy = @by, ApprovedAt = SYSDATETIME(), UpdatedAt = SYSDATETIME() WHERE Id = @id");
    }
    await bumpResales();
    res.json({ success: true, status: result.newStatus });
  } catch (e) {
    res.status(e.message?.includes("not authorized") ? 403 : 400).json({ error: e.message });
  }
});

router.put("/:id/reject", requirePageRight("crm-resales", "edit"), async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  try {
    const email = req.user?.email || req.user?.name;
    if (!email) return res.status(401).json({ error: "Sign in again" });
    const { transition } = require("../services/approvalService");
    const result = await transition("crm-resales", id, "Rejected", email, req.user?.role, req.body?.note || null);
    await getPool().request().input("id", sql.Int, id).input("n", sql.NVarChar(500), req.body?.note || "Rejected")
      .query("UPDATE dbo.CrmUnitResale SET RejectionNote = @n, UpdatedAt = SYSDATETIME() WHERE Id = @id");
    await bumpResales();
    res.json({ success: true, status: result.newStatus });
  } catch (e) {
    res.status(e.message?.includes("not authorized") ? 403 : 400).json({ error: e.message });
  }
});

// PUT /:id/transfer — an approved resale: the booking(s) pass to the new buyer.
router.put("/:id/transfer", requirePageRight("crm-resales", "edit"), async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  const pool = getPool();
  const tx = new sql.Transaction(pool);
  try {
    await tx.begin();
    const resale = (await tx.request().input("id", sql.Int, id).query(
      "SELECT * FROM dbo.CrmUnitResale WITH (UPDLOCK, HOLDLOCK) WHERE Id = @id AND IsActive = 1")).recordset[0];
    if (!resale) { await tx.rollback(); return res.status(404).json({ error: "Not found" }); }
    if (resale.Kind !== "Resale") { await tx.rollback(); return res.status(400).json({ error: "A buy-back completes when Finance pays it" }); }
    if (resale.Status !== "Approved") { await tx.rollback(); return res.status(400).json({ error: `Approve it first (it is ${resale.Status})` }); }
    const { endorseToBuyer } = require("../services/crmResaleTransfer");
    const done = await endorseToBuyer(tx, resale, actorId(req));
    await tx.commit();
    const actor = req.user?.email || req.user?.name || String(actorId(req));
    const warnings = [];
    const { postCrmResaleTransferToGL, postCrmResaleFeeToGL } = require("../services/crmLedger");
    const { recordGLPosting } = require("../services/approvalService");
    for (const [key, fn] of [["crm-resale-transfer", postCrmResaleTransferToGL], ["crm-resale", postCrmResaleFeeToGL]]) {
      try {
        const outcome = await fn(pool, id, actor);
        await recordGLPosting(key, id, outcome, actor);
        if (outcome && outcome.posted === false) warnings.push(outcome.reason);
      } catch (glErr) {
        warnings.push(`Ledger: ${glErr.message}`);
        console.error("[crm-resales] GL posting failed for", id, "—", glErr.message);
      }
    }
    await bumpResales("crm-bookings", "crm-applications");
    res.json({ success: true, paid: done.paid, message: "Transferred — the property and what was paid now sit with the new buyer", ledgerWarning: warnings.join("; ") || null });
  } catch (e) {
    try { await tx.rollback(); } catch { /* already rolled back */ }
    console.error("[crm-resales] PUT /:id/transfer:", e.message);
    res.status(e.status || 500).json({ error: e.status ? e.message : "Failed to transfer the property" });
  }
});

// PUT /:id/send-to-finance — an approved buy-back: its payout voucher goes to
// Finance -> Payments. Approving that voucher brings the property back to stock.
router.put("/:id/send-to-finance", requirePageRight("crm-resales", "edit"), async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  const bankId = req.body?.BankLHeadId != null && req.body.BankLHeadId !== "" ? parseInt(req.body.BankLHeadId, 10) : null;
  const pool = getPool();
  const tx = new sql.Transaction(pool);
  try {
    await tx.begin();
    const resale = (await tx.request().input("id", sql.Int, id).query(
      "SELECT * FROM dbo.CrmUnitResale WITH (UPDLOCK, HOLDLOCK) WHERE Id = @id AND IsActive = 1")).recordset[0];
    if (!resale) { await tx.rollback(); return res.status(404).json({ error: "Not found" }); }
    if (resale.Kind !== "BuyBack") { await tx.rollback(); return res.status(400).json({ error: "Only a buy-back is paid by Finance" }); }
    if (resale.Status !== "Approved") { await tx.rollback(); return res.status(400).json({ error: `Approve it first (it is ${resale.Status})` }); }
    if (resale.PayoutNewPaymentId) { await tx.rollback(); return res.status(409).json({ error: "Its payout voucher is already with Finance" }); }
    const { raiseBuyBackVoucher } = require("../services/crmResaleTransfer");
    const v = await raiseBuyBackVoucher(tx, resale, {
      bankId: Number.isInteger(bankId) ? bankId : null,
      paymentMode: req.body?.PaymentMode || "",
      actorEmail: req.user?.email || req.user?.name || String(actorId(req)),
    });
    await tx.commit();
    await bumpResales("new-payment");
    res.json({ success: true, newPaymentId: v.newPaymentId, message: `Payout voucher ${v.docNo} is with Finance in Payments` });
  } catch (e) {
    try { await tx.rollback(); } catch { /* already rolled back */ }
    console.error("[crm-resales] PUT /:id/send-to-finance:", e.message);
    res.status(e.status || 500).json({ error: e.status ? e.message : "Failed to send it to Finance" });
  }
});

// GET /:id — one resale / buy-back, with the bookings moving (for the review panel).
router.get("/:id", requirePageRight("crm-resales", "view"), async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  try {
    const row = (await getPool().request().input("id", sql.Int, id).query(`${SELECT} WHERE r.Id = @id AND r.IsActive = 1`)).recordset[0];
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(row);
  } catch (e) {
    console.error("[crm-resales] GET /:id:", e.message);
    res.status(500).json({ error: "Failed to load it" });
  }
});

module.exports = router;
