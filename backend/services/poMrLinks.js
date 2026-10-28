"use strict";

/**
 * A Purchase Order raised against one or more Material Requests (migration 585).
 *
 *   dbo.PurchaseOrderMRs          — every MR a PO is tagged to (PurchaseOrders.SourceMRId keeps the first).
 *   dbo.PurchaseOrderItemMRLinks  — how much of each PO line comes from which MR line.
 *   dbo.vw_PurchaseOrderMRItemQty — the quantity each PO line takes from each MR line (links, or MRItemId on lines
 *                                   that have none) — what every "ordered so far" sum reads.
 *
 * Until migration 585 is run, everything falls back to the single SourceMRId / PurchaseOrderItems.MRItemId it
 * replaces, so nothing breaks on a server that hasn't run it yet.
 */

const { sql } = require("../db");

let ready = false;
let checkedAt = 0;
async function multiMrReady(pool) {
  if (ready) return true;
  if (Date.now() - checkedAt < 60_000) return false;
  checkedAt = Date.now();
  const r = await pool.request().query(`
    SELECT CASE WHEN OBJECT_ID('dbo.PurchaseOrderMRs', 'U') IS NOT NULL
                 AND OBJECT_ID('dbo.PurchaseOrderItemMRLinks', 'U') IS NOT NULL
                 AND OBJECT_ID('dbo.vw_PurchaseOrderMRItemQty', 'V') IS NOT NULL THEN 1 ELSE 0 END AS ok`);
  ready = r.recordset[0].ok === 1;
  return ready;
}

/** A row source with PurchaseOrderID, PurchaseOrderItemId, MRItemId, Quantity — one row per PO line per MR line. */
const mrQtySource = (isReady) =>
  isReady
    ? "dbo.vw_PurchaseOrderMRItemQty"
    : "(SELECT PurchaseOrderID, Id AS PurchaseOrderItemId, MRItemId, Quantity FROM dbo.PurchaseOrderItems WHERE MRItemId IS NOT NULL)";

/** SQL condition: PO alias `po` is tagged to the MR whose id is in `param` (e.g. "@MRId"). */
const poTaggedToMr = (isReady, param, alias = "po") =>
  isReady
    ? `(${alias}.SourceMRId = ${param} OR EXISTS (SELECT 1 FROM dbo.PurchaseOrderMRs pom WHERE pom.PurchaseOrderID = ${alias}.PurchaseOrderID AND pom.MRId = ${param}))`
    : `${alias}.SourceMRId = ${param}`;

/** Every MR a PO is tagged to, first (SourceMRId) first. */
async function getPoMrIds(pool, poId) {
  const isReady = await multiMrReady(pool);
  const r = await pool.request().input("id", sql.Int, poId).query(
    isReady
      ? `SELECT DISTINCT x.MRId, CASE WHEN x.MRId = po.SourceMRId THEN 0 ELSE 1 END AS o
         FROM dbo.PurchaseOrders po
         CROSS APPLY (SELECT po.SourceMRId AS MRId UNION SELECT MRId FROM dbo.PurchaseOrderMRs WHERE PurchaseOrderID = po.PurchaseOrderID) x
         WHERE po.PurchaseOrderID = @id AND x.MRId IS NOT NULL
         ORDER BY o, x.MRId`
      : "SELECT SourceMRId AS MRId FROM dbo.PurchaseOrders WHERE PurchaseOrderID = @id AND SourceMRId IS NOT NULL",
  );
  return r.recordset.map((x) => x.MRId);
}

/** Records the MRs a PO is tagged to (inside the caller's transaction `tx`). */
async function savePoMrs(pool, tx, poId, mrs) {
  if (!(await multiMrReady(pool))) return;
  const executor = tx || pool;
  await new sql.Request(executor).input("id", sql.Int, poId).query("DELETE FROM dbo.PurchaseOrderMRs WHERE PurchaseOrderID = @id");
  for (const m of mrs) {
    await new sql.Request(executor)
      .input("id", sql.Int, poId)
      .input("mr", sql.Int, m.id)
      .input("doc", sql.NVarChar(100), m.docNo || null)
      .query("INSERT INTO dbo.PurchaseOrderMRs (PurchaseOrderID, MRId, MRDocNo) VALUES (@id, @mr, @doc)");
  }
}

/**
 * A PO line's MR sources: [{ mrItemId, qty }]. A line built from several MR lines carries `mrSources`; an older one
 * carries a single `mrItemId` (all of its quantity). The line quantity is spread over the sources in order, so a
 * line ordered short of what the MRs asked for takes from the first MR first.
 */
function lineMrSources(line) {
  const qty = parseFloat(line.quantity) || 0;
  const raw = Array.isArray(line.mrSources) && line.mrSources.length
    ? line.mrSources
    : line.mrItemId ? [{ mrItemId: line.mrItemId, qty }] : [];
  let left = qty;
  const out = [];
  raw.forEach((s, i) => {
    const id = parseInt(s.mrItemId, 10);
    if (!Number.isFinite(id) || left <= 0) return;
    const want = i === raw.length - 1 ? left : Math.min(left, parseFloat(s.qty) || 0);
    if (want > 0) { out.push({ mrItemId: id, qty: want }); left -= want; }
  });
  return out;
}

module.exports = { multiMrReady, mrQtySource, poTaggedToMr, getPoMrIds, savePoMrs, lineMrSources };
