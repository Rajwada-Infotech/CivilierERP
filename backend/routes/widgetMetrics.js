"use strict";

/**
 * backend/routes/widgetMetrics.js
 *
 * A cross-module metrics registry for the generic Widgets page
 * (src/pages/Widgets.tsx) — lets Bar/Line/Pie/Stat Card widgets be pointed
 * at real data from Finance, Material, Engineering, or CRM instead of the
 * one fixed task/user dataset every widget used to be hardcoded to
 * (see widgets.js's GET /dashboard, still used by the widgets that aren't
 * "pick a data source" style — Calendar, Notifications, Activity Feed etc).
 *
 * GET /api/widgets/metrics/catalog — list of {key, label, module, type, unit}
 * GET /api/widgets/metrics/:key    — the metric's actual data, shaped by type:
 *   timeseries → { type, labels: string[], series: [{ name, data, color }] }
 *   breakdown  → { type, slices: [{ name, value, color }] }
 *   stat       → { type, value, label, format }
 *
 * Every query follows the same 14-day zero-fill idiom already used by
 * financeDashboard.js/materialDashboard.js/engineering.js's own trend
 * queries: GROUP BY the date column, then fill every one of the last 14
 * days with 0 so the line/bar chart never has a silent gap.
 */

const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");

// ─── Catalog — the single source of truth for what's selectable ───────────────
const CATALOG = [
  // Finance
  { key: "finance-payments-made-14d", label: "Payments Made — 14 Days", module: "Finance", type: "timeseries", unit: "currency" },
  { key: "finance-received-payments-14d", label: "Received Payments — 14 Days", module: "Finance", type: "timeseries", unit: "currency" },
  { key: "finance-received-payment-status", label: "Received Payments by Status", module: "Finance", type: "breakdown", unit: "count" },
  { key: "finance-cheque-status", label: "Cheques — Active vs Inactive", module: "Finance", type: "breakdown", unit: "count" },
  { key: "finance-payments-this-month", label: "Total Payments This Month", module: "Finance", type: "stat", unit: "currency" },

  // Material
  { key: "material-grn-value-14d", label: "GRN Value — 14 Days", module: "Material", type: "timeseries", unit: "currency" },
  { key: "material-po-value-14d", label: "PO Value — 14 Days", module: "Material", type: "timeseries", unit: "currency" },
  { key: "material-po-status", label: "Purchase Orders by Status", module: "Material", type: "breakdown", unit: "count" },
  { key: "material-request-status", label: "Material Requests by Status", module: "Material", type: "breakdown", unit: "count" },
  { key: "material-open-grn-value", label: "Open GRN Value", module: "Material", type: "stat", unit: "currency" },

  // Engineering
  { key: "engineering-wo-value-14d", label: "Work Order Value — 14 Days", module: "Engineering", type: "timeseries", unit: "currency" },
  { key: "engineering-workdone-value-14d", label: "Work Done Value — 14 Days", module: "Engineering", type: "timeseries", unit: "currency" },
  { key: "engineering-wo-status", label: "Work Orders by Status", module: "Engineering", type: "breakdown", unit: "count" },
  { key: "engineering-workdone-status", label: "Work Done by Status", module: "Engineering", type: "breakdown", unit: "count" },
  { key: "engineering-boq-approved-value", label: "Approved BOQ Value", module: "Engineering", type: "stat", unit: "currency" },

  // CRM
  { key: "crm-application-status", label: "Applications by Status", module: "CRM", type: "breakdown", unit: "count" },
  { key: "crm-booking-status", label: "Bookings by Status", module: "CRM", type: "breakdown", unit: "count" },
  { key: "crm-overdue-milestones", label: "Overdue Payment Milestones", module: "CRM", type: "stat", unit: "count" },
];

const CATALOG_BY_KEY = Object.fromEntries(CATALOG.map((m) => [m.key, m]));

const BREAKDOWN_PALETTE = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#a855f7", "#06b6d4", "#ec4899", "#94a3b8"];

router.get("/catalog", (_req, res) => {
  res.json(CATALOG);
});

// ── Shared helper: zero-fill a 14-day window from a { Day, Amount } recordset
function zeroFill14(recordset, valueKey = "Amount") {
  const byDay = new Map(
    recordset.map((r) => [r.Day.toISOString().slice(0, 10), Number(r[valueKey]) || 0]),
  );
  const labels = [];
  const data = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    labels.push(key);
    data.push(byDay.get(key) ?? 0);
  }
  return { labels, data };
}

function paletteFor(rows) {
  return rows.map((_, i) => BREAKDOWN_PALETTE[i % BREAKDOWN_PALETTE.length]);
}

// ── Metric implementations — one query each, matched 1:1 to the catalog above.
const METRIC_HANDLERS = {
  async "finance-payments-made-14d"(pool) {
    const r = await pool.request().query(`
      SELECT CAST(PDate AS DATE) AS Day, ISNULL(SUM(PAmount), 0) AS Amount
      FROM dbo.NewPayment
      WHERE CAST(PDate AS DATE) >= DATEADD(DAY, -13, CAST(GETDATE() AS DATE))
      GROUP BY CAST(PDate AS DATE)
    `);
    const { labels, data } = zeroFill14(r.recordset);
    return { type: "timeseries", labels, series: [{ name: "Payments Made", data, color: "#f43f5e" }] };
  },

  async "finance-received-payments-14d"(pool) {
    const r = await pool.request().query(`
      SELECT CAST(RPDocDate AS DATE) AS Day, ISNULL(SUM(RPAmount), 0) AS Amount
      FROM dbo.ReceivedPayment
      WHERE CAST(RPDocDate AS DATE) >= DATEADD(DAY, -13, CAST(GETDATE() AS DATE))
      GROUP BY CAST(RPDocDate AS DATE)
    `);
    const { labels, data } = zeroFill14(r.recordset);
    return { type: "timeseries", labels, series: [{ name: "Received Payments", data, color: "#10b981" }] };
  },

  async "finance-received-payment-status"(pool) {
    const r = await pool.request().query(`
      SELECT ISNULL(RPStatus, 'Draft') AS Name, COUNT(1) AS Value
      FROM dbo.ReceivedPayment
      GROUP BY ISNULL(RPStatus, 'Draft')
    `);
    const rows = r.recordset;
    return {
      type: "breakdown",
      slices: rows.map((row, i) => ({ name: row.Name, value: Number(row.Value), color: paletteFor(rows)[i] })),
    };
  },

  async "finance-cheque-status"(pool) {
    const r = await pool.request().query(`
      SELECT
        SUM(CASE WHEN Status = 1 THEN 1 ELSE 0 END) AS ActiveCount,
        SUM(CASE WHEN Status = 0 THEN 1 ELSE 0 END) AS InactiveCount
      FROM dbo.ChequeMaster
    `);
    const row = r.recordset[0] || {};
    return {
      type: "breakdown",
      slices: [
        { name: "Active", value: Number(row.ActiveCount) || 0, color: "#10b981" },
        { name: "Inactive", value: Number(row.InactiveCount) || 0, color: "#94a3b8" },
      ],
    };
  },

  async "finance-payments-this-month"(pool) {
    const r = await pool.request().query(`
      SELECT ISNULL(SUM(PAmount), 0) AS Total
      FROM dbo.NewPayment
      WHERE PDate >= DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1)
    `);
    return { type: "stat", value: Number(r.recordset[0]?.Total) || 0, label: "Total Payments This Month", format: "currency" };
  },

  async "material-grn-value-14d"(pool) {
    const r = await pool.request().query(`
      SELECT CAST(GRNDate AS DATE) AS Day, ISNULL(SUM(TotalAmount), 0) AS Amount
      FROM dbo.GoodsReceiptNotes
      WHERE CAST(GRNDate AS DATE) >= DATEADD(DAY, -13, CAST(GETDATE() AS DATE))
      GROUP BY CAST(GRNDate AS DATE)
    `);
    const { labels, data } = zeroFill14(r.recordset);
    return { type: "timeseries", labels, series: [{ name: "GRN Value", data, color: "#10b981" }] };
  },

  async "material-po-value-14d"(pool) {
    const r = await pool.request().query(`
      SELECT CAST(PODate AS DATE) AS Day, ISNULL(SUM(TotalAmount), 0) AS Amount
      FROM dbo.PurchaseOrders
      WHERE CAST(PODate AS DATE) >= DATEADD(DAY, -13, CAST(GETDATE() AS DATE))
      GROUP BY CAST(PODate AS DATE)
    `);
    const { labels, data } = zeroFill14(r.recordset);
    return { type: "timeseries", labels, series: [{ name: "PO Value", data, color: "#3b82f6" }] };
  },

  async "material-po-status"(pool) {
    const r = await pool.request().query(`
      SELECT ISNULL(Status, 'Draft') AS Name, COUNT(1) AS Value
      FROM dbo.PurchaseOrders
      GROUP BY ISNULL(Status, 'Draft')
    `);
    const rows = r.recordset;
    return {
      type: "breakdown",
      slices: rows.map((row, i) => ({ name: row.Name, value: Number(row.Value), color: paletteFor(rows)[i] })),
    };
  },

  async "material-request-status"(pool) {
    const r = await pool.request().query(`
      SELECT ISNULL(Status, 'Draft') AS Name, COUNT(1) AS Value
      FROM dbo.MaterialRequests
      GROUP BY ISNULL(Status, 'Draft')
    `);
    const rows = r.recordset;
    return {
      type: "breakdown",
      slices: rows.map((row, i) => ({ name: row.Name, value: Number(row.Value), color: paletteFor(rows)[i] })),
    };
  },

  async "material-open-grn-value"(pool) {
    const r = await pool.request().query(`
      SELECT ISNULL(SUM(TotalAmount), 0) AS Total
      FROM dbo.GoodsReceiptNotes
      WHERE ISNULL(Status, 'Draft') NOT IN ('Closed', 'Rejected')
    `);
    return { type: "stat", value: Number(r.recordset[0]?.Total) || 0, label: "Open GRN Value", format: "currency" };
  },

  async "engineering-wo-value-14d"(pool) {
    const r = await pool.request().query(`
      SELECT CAST(DocumentDate AS DATE) AS Day, ISNULL(SUM(TotalAmount), 0) AS Amount
      FROM dbo.WorkOrderHeader
      WHERE CAST(DocumentDate AS DATE) >= DATEADD(DAY, -13, CAST(GETDATE() AS DATE))
      GROUP BY CAST(DocumentDate AS DATE)
    `);
    const { labels, data } = zeroFill14(r.recordset);
    return { type: "timeseries", labels, series: [{ name: "Work Order Value", data, color: "#f97316" }] };
  },

  async "engineering-workdone-value-14d"(pool) {
    const r = await pool.request().query(`
      SELECT CAST(DocDate AS DATE) AS Day, ISNULL(SUM(CertifiedAmount), 0) AS Amount
      FROM dbo.WorkDone
      WHERE CAST(DocDate AS DATE) >= DATEADD(DAY, -13, CAST(GETDATE() AS DATE))
      GROUP BY CAST(DocDate AS DATE)
    `);
    const { labels, data } = zeroFill14(r.recordset);
    return { type: "timeseries", labels, series: [{ name: "Work Done Value", data, color: "#10b981" }] };
  },

  async "engineering-wo-status"(pool) {
    const r = await pool.request().query(`
      SELECT ISNULL(Status, 'Draft') AS Name, COUNT(1) AS Value
      FROM dbo.WorkOrderHeader
      GROUP BY ISNULL(Status, 'Draft')
    `);
    const rows = r.recordset;
    return {
      type: "breakdown",
      slices: rows.map((row, i) => ({ name: row.Name, value: Number(row.Value), color: paletteFor(rows)[i] })),
    };
  },

  async "engineering-workdone-status"(pool) {
    const r = await pool.request().query(`
      SELECT ISNULL(Status, 'Draft') AS Name, COUNT(1) AS Value
      FROM dbo.WorkDone
      GROUP BY ISNULL(Status, 'Draft')
    `);
    const rows = r.recordset;
    return {
      type: "breakdown",
      slices: rows.map((row, i) => ({ name: row.Name, value: Number(row.Value), color: paletteFor(rows)[i] })),
    };
  },

  async "engineering-boq-approved-value"(pool) {
    const r = await pool.request().query(`
      SELECT ISNULL(SUM(TotalAmount), 0) AS Total
      FROM dbo.BOQ
      WHERE Status = 'Approved'
    `);
    return { type: "stat", value: Number(r.recordset[0]?.Total) || 0, label: "Approved BOQ Value", format: "currency" };
  },

  async "crm-application-status"(pool) {
    const r = await pool.request().query(`
      SELECT ISNULL(Status, 'Draft') AS Name, COUNT(1) AS Value
      FROM dbo.CrmApplication
      WHERE IsActive = 1
      GROUP BY ISNULL(Status, 'Draft')
    `);
    const rows = r.recordset;
    return {
      type: "breakdown",
      slices: rows.map((row, i) => ({ name: row.Name, value: Number(row.Value), color: paletteFor(rows)[i] })),
    };
  },

  async "crm-booking-status"(pool) {
    const r = await pool.request().query(`
      SELECT ISNULL(Status, 'Draft') AS Name, COUNT(1) AS Value
      FROM dbo.CrmBooking
      WHERE IsActive = 1
      GROUP BY ISNULL(Status, 'Draft')
    `);
    const rows = r.recordset;
    return {
      type: "breakdown",
      slices: rows.map((row, i) => ({ name: row.Name, value: Number(row.Value), color: paletteFor(rows)[i] })),
    };
  },

  async "crm-overdue-milestones"(pool) {
    const r = await pool.request().query(`
      SELECT COUNT(1) AS Total
      FROM dbo.CrmPaymentMilestone
      WHERE Status = 'Pending' AND DueDate < CAST(GETDATE() AS DATE)
    `);
    return { type: "stat", value: Number(r.recordset[0]?.Total) || 0, label: "Overdue Payment Milestones", format: "count" };
  },
};

router.get("/:key", async (req, res) => {
  const { key } = req.params;
  const def = CATALOG_BY_KEY[key];
  if (!def) return res.status(404).json({ error: `Unknown metric "${key}"` });

  const handler = METRIC_HANDLERS[key];
  if (!handler) return res.status(501).json({ error: `Metric "${key}" has no handler yet` });

  try {
    const pool = getPool();
    const data = await handler(pool);
    res.json({ key, label: def.label, module: def.module, unit: def.unit, ...data });
  } catch (err) {
    console.error(`[widget-metric:${key}]`, err.message);
    res.status(500).json({ error: `Failed to load metric "${key}"` });
  }
});

module.exports = router;
