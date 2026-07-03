"use strict";

/**
 * Public (no-auth) aggregate stats shown on the login page.
 * Mounted before auth middleware in server.js.
 * Returns only counts — no sensitive data.
 */

const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 60 * 1000, max: 30, validate: false }));
const { getPool } = require("../db");

router.get("/", async (_req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT
        (SELECT COUNT(*) FROM dbo.enterprise WHERE business_type = 'P') AS TotalProjects,
        (SELECT COUNT(*) FROM dbo.WorkOrderHeader)                       AS TotalWorkOrders,
        (SELECT COUNT(*) FROM dbo.WorkOrderHeader WHERE Status = 'Completed') AS CompletedWorkOrders,
        (SELECT COUNT(*) FROM dbo.GoodsReceiptNotes WHERE Status <> 'Rejected') AS TotalGRNs,
        (SELECT COUNT(*) FROM dbo.AccountHeadMaster WHERE LHeadType = 'S' AND LHeadStatus = 1) AS ActiveSuppliers,
        (SELECT COUNT(*) FROM dbo.Quotations WHERE Status NOT IN ('Draft','Cancelled'))         AS TotalQuotations
    `);

    const row = result.recordset[0] ?? {};
    const woTotal = row.TotalWorkOrders || 0;
    const woCompleted = row.CompletedWorkOrders || 0;
    const completionPct = woTotal > 0 ? Math.round((woCompleted / woTotal) * 100) : 0;

    res.json({
      projects: row.TotalProjects ?? 0,
      workOrders: woTotal,
      workOrderCompletionPct: completionPct,
      grns: row.TotalGRNs ?? 0,
      activeSuppliers: row.ActiveSuppliers ?? 0,
      quotations: row.TotalQuotations ?? 0,
    });
  } catch (err) {
    // Return zeros on error so login page still loads
    res.json({ projects: 0, workOrders: 0, workOrderCompletionPct: 0, grns: 0, activeSuppliers: 0, quotations: 0 });
  }
});

module.exports = router;
