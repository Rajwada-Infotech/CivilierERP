#!/usr/bin/env node
"use strict";

/**
 * Rate of an item (default: sand) on purchase orders — every PO line whose item name matches, with its rate, and a
 * summary (latest, lowest, highest, quantity-weighted average) per item and unit. Read only.
 *
 *   node scripts/poItemRate.js                         all POs, item name containing "sand"
 *   node scripts/poItemRate.js --item "m sand"         another item (name contains this text)
 *   node scripts/poItemRate.js --project 1012          one project (enterprise id)
 *   node scripts/poItemRate.js --from 2026-04-01 --to 2026-11-30
 *   node scripts/poItemRate.js --all                   include draft / rejected POs (default: approved-type only)
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env"), quiet: true });
const { connectDB, getPool, sql } = require("../db");

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const item = arg("item") || "sand";
const project = arg("project") ? Number(arg("project")) : null;
const from = arg("from") || null;
const to = arg("to") || null;
const all = args.includes("--all");

(async () => {
  await connectDB();
  const pool = getPool();
  const r = await pool
    .request()
    .input("item", sql.NVarChar(200), `%${item}%`)
    .input("project", sql.Int, project)
    .input("from", sql.Date, from)
    .input("to", sql.Date, to)
    .input("all", sql.Bit, all ? 1 : 0).query(`
      SELECT po.PurchaseOrderID, COALESCE(po.DocNo, po.PurchaseOrderNo) AS poNo, CAST(po.PODate AS DATE) AS poDate,
             po.Status AS status, pr.name AS project, ah.LHeadName AS supplier,
             i.ItemName AS itemName, i.UomName AS uom, i.Quantity AS qty, i.Rate AS rate,
             i.Discount AS discount, i.TaxPct AS taxPct, i.LineAmount AS lineAmount
      FROM dbo.PurchaseOrderItems i
      JOIN dbo.PurchaseOrders po ON po.PurchaseOrderID = i.PurchaseOrderID
      LEFT JOIN dbo.enterprise pr ON pr.id = po.ProjectId
      LEFT JOIN dbo.AccountHeadMaster ah ON ah.LHeadId = po.SupplierID
      WHERE (i.ItemName LIKE @item OR i.Description LIKE @item)
        AND (@project IS NULL OR po.ProjectId = @project)
        AND (@from IS NULL OR CAST(po.PODate AS DATE) >= @from)
        AND (@to IS NULL OR CAST(po.PODate AS DATE) <= @to)
        AND (@all = 1 OR ISNULL(po.Status, '') NOT IN ('Draft', 'Rejected', 'Cancelled'))
      ORDER BY po.PODate DESC, po.PurchaseOrderID DESC`);

  const rows = r.recordset;
  if (!rows.length) {
    console.log(`No PO lines found for "${item}".`);
    process.exit(0);
  }

  console.log(`\nPO lines for "${item}" (${rows.length}):\n`);
  console.table(
    rows.map((x) => ({
      PO: x.poNo,
      Date: x.poDate?.toISOString().slice(0, 10),
      Status: x.status,
      Project: x.project,
      Supplier: x.supplier,
      Item: x.itemName,
      Qty: Number(x.qty),
      UOM: x.uom,
      Rate: Number(x.rate),
    })),
  );

  // Summary per item + unit (rates in different units aren't comparable).
  const groups = new Map();
  for (const x of rows) {
    const key = `${x.itemName} | ${x.uom || "-"}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(x);
  }
  const summary = [...groups].map(([key, list]) => {
    const rates = list.map((x) => Number(x.rate) || 0);
    const qty = list.reduce((t, x) => t + (Number(x.qty) || 0), 0);
    const weighted = qty > 0 ? list.reduce((t, x) => t + (Number(x.qty) || 0) * (Number(x.rate) || 0), 0) / qty : 0;
    return {
      "Item | UOM": key,
      POs: list.length,
      "Latest rate": rates[0],
      "Latest PO": `${list[0].poNo} (${list[0].poDate?.toISOString().slice(0, 10)})`,
      Lowest: Math.min(...rates),
      Highest: Math.max(...rates),
      "Avg (qty-weighted)": Math.round(weighted * 100) / 100,
      "Total qty": qty,
    };
  });
  console.log("\nSummary:\n");
  console.table(summary);
  process.exit(0);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
