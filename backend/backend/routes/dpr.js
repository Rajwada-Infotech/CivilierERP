"use strict";

/**
 * backend/routes/dpr.js
 * Daily Progress Report — fetches BOQ, Work Orders, and Work Done
 * records created/updated on a given date, with full detail breakdowns.
 *
 * Mount in server.js:
 *   const dprRoutes = require("./routes/dpr");
 *   app.use("/api/engineering/dpr", dprRoutes);
 */

const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));

const { getPool, sql } = require("../db");
const { checkPermissionForMethod } = require("../middleware/routePermission");

// Reuse Engineering permission guard — DPR is an Engineering report
router.use(checkPermissionForMethod("Engineering", "DPR"));

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns YYYY-MM-DD string for today (server local time). */
const todayStr = () => new Date().toISOString().slice(0, 10);

/** Validate a date string; returns normalised YYYY-MM-DD or null. */
const parseDate = (raw) => {
  if (!raw) return null;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
};

// ─── GET /api/engineering/dpr ─────────────────────────────────────────────────
//
// Query params:
//   date      YYYY-MM-DD  (default: today)
//   companyId number      (optional filter)
//   projectId number      (optional filter)
//
// Response shape:
// {
//   date: "2025-06-03",
//   summary: { boqCount, boqTotal, woCount, woTotal, wdCount, wdTotal, grandTotal },
//   boq: [ { ... full BOQ row ... } ],
//   workOrders: [ { ... full WO header row + activities[] ... } ],
//   workDone: [ { ... full WD row ... } ]
// }
// ─────────────────────────────────────────────────────────────────────────────

router.get("/", async (req, res) => {
  try {
    const pool = getPool();

    const date = parseDate(req.query.date) ?? todayStr();
    const companyId = parseInt(req.query.companyId, 10) || null;
    const projectId = parseInt(req.query.projectId, 10) || null;

    // ── 1. BOQ ────────────────────────────────────────────────────────────────
    const boqReq = pool
      .request()
      .input("Date", sql.Date, date)
      .input("CompanyId", sql.Int, companyId)
      .input("ProjectId", sql.Int, projectId);

    const boqResult = await boqReq.query(`
      SELECT
        b.BoqID,
        COALESCE(b.DocNo, b.BoqNo)   AS DocNo,
        b.BoqNo,
        b.BoqDate,
        b.CompanyId,
        co.name                       AS CompanyName,
        b.ProjectId,
        pr.name                       AS ProjectName,
        b.Description,
        b.TotalAmount,
        b.Status,
        b.Remarks,
        b.CreatedBy,
        b.CreatedAt,
        b.UpdatedAt,
        b.UpdatedBy,
        b.DocTypeId,
        td.Prefix                     AS DocTypePrefix,
        td.Description                AS DocTypeDescription
      FROM dbo.BOQ b
      LEFT JOIN dbo.enterprise co ON co.id = b.CompanyId
      LEFT JOIN dbo.enterprise pr ON pr.id = b.ProjectId
      LEFT JOIN dbo.TypeOfDoc  td ON td.TypeOfDocId = b.DocTypeId
      WHERE
        CAST(DATEADD(MINUTE, 330, b.CreatedAt) AS DATE) = @Date
        AND (@CompanyId IS NULL OR b.CompanyId = @CompanyId)
        AND (@ProjectId IS NULL OR b.ProjectId = @ProjectId)
      ORDER BY b.BoqID DESC
    `);

    // ── 2. Work Orders ────────────────────────────────────────────────────────
    const woReq = pool
      .request()
      .input("Date", sql.Date, date)
      .input("CompanyId", sql.Int, companyId)
      .input("ProjectId", sql.Int, projectId);

    const woResult = await woReq.query(`
      SELECT
        h.Id,
        COALESCE(h.DocNo, h.DocumentNumber)  AS DocNo,
        h.DocumentNumber,
        h.DocumentDate,
        h.TotalAmount,
        h.Status,
        h.CompanyId,
        ec.name                              AS CompanyName,
        h.ProjectId,
        ep.name                              AS ProjectName,
        h.ContractorId,
        ahm.LHeadName                        AS ContractorName,
        h.SupplierId,
        ams.LHeadName                        AS SupplierName,
        h.Remarks,
        h.TermsAndConditions,
        h.GST,
        h.BoqID,
        COALESCE(b.DocNo, b.BoqNo)           AS BoqDocNo,
        h.DocTypeId,
        h.DocNo                              AS RawDocNo,
        td.Prefix                            AS DocTypePrefix,
        td.Description                       AS DocTypeDescription,
        h.CreatedBy,
        h.CreatedAt,
        h.UpdatedAt,
        h.UpdatedBy,
        COUNT(DISTINCT act.Id)               AS ActivityCount
      FROM dbo.WorkOrderHeader h
      LEFT JOIN dbo.enterprise        ec  ON ec.id       = h.CompanyId
      LEFT JOIN dbo.enterprise        ep  ON ep.id       = h.ProjectId
      LEFT JOIN dbo.AccountHeadMaster ahm ON ahm.LHeadId = h.ContractorId
      LEFT JOIN dbo.AccountHeadMaster ams ON ams.LHeadId = h.SupplierId
      LEFT JOIN dbo.WorkOrderActivities act ON act.WorkOrderHeaderId = h.Id
      LEFT JOIN dbo.TypeOfDoc         td  ON td.TypeOfDocId = h.DocTypeId
      LEFT JOIN dbo.BOQ               b   ON b.BoqID = h.BoqID
      WHERE
        CAST(DATEADD(MINUTE, 330, h.CreatedAt) AS DATE) = @Date
        AND (@CompanyId IS NULL OR h.CompanyId = @CompanyId)
        AND (@ProjectId IS NULL OR h.ProjectId = @ProjectId)
      GROUP BY
        h.Id, h.DocumentNumber, h.DocumentDate, h.TotalAmount, h.Status,
        h.CompanyId, h.ProjectId, h.ContractorId, h.SupplierId,
        h.Remarks, h.TermsAndConditions, h.GST, h.BoqID,
        h.DocTypeId, h.DocNo, h.CreatedBy, h.CreatedAt, h.UpdatedAt, h.UpdatedBy,
        ec.name, ep.name, ahm.LHeadName, ams.LHeadName,
        b.DocNo, b.BoqNo, td.Prefix, td.Description
      ORDER BY h.Id DESC
    `);

    // Fetch activities for each WO (batch query — parameterized IN list)
    let woActivities = [];
    const woIds = woResult.recordset.map((r) => r.Id);
    if (woIds.length > 0) {
      const actReq = pool.request();
      const actParams = woIds.map((id, i) => {
        actReq.input(`wid${i}`, sql.Int, id);
        return `@wid${i}`;
      });
      const actResult = await actReq.query(`
        SELECT
          a.Id,
          a.WorkOrderHeaderId,
          a.ActivityGroupId,
          ag.activity_name  AS ActivityGroupName,
          a.ActivityId,
          act.activity_name AS ActivityName,
          a.UOMId,
          uom.UOMName,
          a.Area              AS Quantity,
          a.Rate,
          a.GrandTotal        AS Amount,
          NULL                AS CompletionPercentage,
          a.Remarks
        FROM dbo.WorkOrderActivities a
        LEFT JOIN dbo.ActivityMaster ag  ON ag.id  = a.ActivityGroupId
        LEFT JOIN dbo.ActivityMaster act ON act.id = a.ActivityId
        LEFT JOIN dbo.UOMMaster      uom ON uom.Id  = a.UOMId
        WHERE a.WorkOrderHeaderId IN (${actParams.join(",")})
        ORDER BY a.WorkOrderHeaderId, a.Id
      `);
      woActivities = actResult.recordset;
    }

    // Group activities by WO id
    const activitiesMap = {};
    for (const a of woActivities) {
      if (!activitiesMap[a.WorkOrderHeaderId])
        activitiesMap[a.WorkOrderHeaderId] = [];
      activitiesMap[a.WorkOrderHeaderId].push(a);
    }

    const workOrders = woResult.recordset.map((h) => {
      // Safely parse GST JSON (same pattern as existing routes)
      let gst = h.GST;
      if (typeof gst === "string") {
        try {
          gst = JSON.parse(gst);
        } catch {
          gst = null;
        }
      }
      return {
        ...h,
        GST: gst,
        activities: activitiesMap[h.Id] ?? [],
      };
    });

    // ── 3. Work Done ──────────────────────────────────────────────────────────
    const wdReq = pool
      .request()
      .input("Date", sql.Date, date)
      .input("CompanyId", sql.Int, companyId)
      .input("ProjectId", sql.Int, projectId);

    const wdResult = await wdReq.query(`
      SELECT
        wd.ID,
        wd.DocNo,
        wd.DocTypeId,
        wd.DocDate,
        wd.CompanyId,
        co.name                          AS CompanyName,
        wd.ProjectId,
        pr.name                          AS ProjectName,
        wd.FinYear,
        wd.SupplierId,
        sup.LHeadName                    AS SupplierName,
        wd.WorkOrderID,
        COALESCE(woh.DocNo, woh.DocumentNumber) AS WorkOrderNo,
        ctr.LHeadName                    AS ContractorName,
        wd.PeriodFrom,
        wd.PeriodTo,
        wd.DescriptionOfWork,
        wd.QuantityDone,
        COALESCE(wd.Unit, wo_uom.UOMName) AS Unit,
        wd.RatePerUnit,
        wd.GrossAmount,
        wd.Deductions,
        wd.CertifiedAmount,
        wd.Status,
        wd.Remarks,
        wd.CreatedAt,
        wd.CreatedBy,
        wd.UpdatedAt,
        wd.UpdatedBy,
        td.Prefix                        AS DocTypePrefix,
        td.Description                   AS DocTypeDescription
      FROM dbo.WorkDone wd
      LEFT JOIN dbo.enterprise        co  ON co.id       = wd.CompanyId
      LEFT JOIN dbo.enterprise        pr  ON pr.id       = wd.ProjectId
      LEFT JOIN dbo.AccountHeadMaster sup ON sup.LHeadId = wd.SupplierId
      LEFT JOIN dbo.WorkOrderHeader   woh ON woh.Id      = wd.WorkOrderID
      LEFT JOIN dbo.AccountHeadMaster ctr ON ctr.LHeadId = woh.ContractorId
      LEFT JOIN dbo.TypeOfDoc         td  ON td.TypeOfDocId = wd.DocTypeId
      LEFT JOIN (
        SELECT woa.WorkOrderHeaderId, MIN(uom.UOMName) AS UOMName
        FROM dbo.WorkOrderActivities woa
        LEFT JOIN dbo.UOMMaster uom ON uom.Id = woa.UOMId
        WHERE uom.UOMName IS NOT NULL
        GROUP BY woa.WorkOrderHeaderId
      ) wo_uom ON wo_uom.WorkOrderHeaderId = wd.WorkOrderID
      WHERE
        CAST(DATEADD(MINUTE, 330, wd.CreatedAt) AS DATE) = @Date
        AND (@CompanyId IS NULL OR wd.CompanyId = @CompanyId)
        AND (@ProjectId IS NULL OR wd.ProjectId = @ProjectId)
      ORDER BY wd.ID DESC
    `);

    // ── 4. Aggregate summary ──────────────────────────────────────────────────
    const boqRows = boqResult.recordset;
    const wdRows = wdResult.recordset;

    const boqTotal = boqRows.reduce((s, r) => s + (r.TotalAmount ?? 0), 0);
    const woTotal = workOrders.reduce((s, r) => s + (r.TotalAmount ?? 0), 0);
    const wdTotal = wdRows.reduce((s, r) => s + (r.CertifiedAmount ?? 0), 0);

    res.json({
      date,
      summary: {
        boqCount: boqRows.length,
        boqTotal,
        woCount: workOrders.length,
        woTotal,
        wdCount: wdRows.length,
        wdTotal,
        grandTotal: boqTotal + woTotal + wdTotal,
      },
      boq: boqRows,
      workOrders,
      workDone: wdRows,
    });
  } catch (err) {
    console.error("[GET /api/engineering/dpr]", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
