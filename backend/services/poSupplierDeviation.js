"use strict";

/**
 * A PO going to a supplier other than the lowest (L1) one on the quotation raised for its Material Request.
 *
 *   findL1Deviations — the quotations (the PO's own SourceQTId, and any raised for its MRs) whose L1 supplier is not
 *                      the PO's supplier. L1 is worked out like the L1 chart: among suppliers who submitted a rate for
 *                      every item, the lowest total. A quotation with no such supplier has no L1 and is skipped.
 *   notifyDirectors  — tells every active user with the "director" role which MR, which supplier, how much, against
 *                      which L1, and why: a toast on any Civilier page they have open (socket "po:supplier-change"),
 *                      and a push to their phones (Admin app). Not kept in the notification bell.
 *
 * MRs with no quotation, or whose quotation has no complete submission yet, are not affected: the plain MR → PO flow
 * is unchanged.
 */

const { sql } = require("../db");
const { makeColumnProbe } = require("./columnProbe");
const { getIo } = require("../socket");
const { sendToUsers } = require("./pushNotifications");

const hasReasonColumn = makeColumnProbe("dbo.PurchaseOrders", "SupplierChangeReason");

const inr = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (d) => {
  if (!d) return "";
  const x = new Date(new Date(d).getTime() + 330 * 60_000); // IST
  return `${String(x.getUTCDate()).padStart(2, "0")} ${MONTHS[x.getUTCMonth()]} ${x.getUTCFullYear()}`;
};

async function findL1Deviations(pool, { mrIds = [], qtId = null, supplierId }) {
  const sup = parseInt(supplierId, 10);
  const mrs = [...new Set(mrIds.map((x) => parseInt(x, 10)).filter(Number.isFinite))];
  const qt = parseInt(qtId, 10);
  if (!Number.isFinite(sup) || (!mrs.length && !Number.isFinite(qt))) return [];

  const r = pool.request().input("sup", sql.Int, sup);
  const conds = [];
  if (Number.isFinite(qt)) { r.input("qt", sql.Int, qt); conds.push("q.QuotationId = @qt"); }
  if (mrs.length) {
    mrs.forEach((id, i) => r.input(`mr${i}`, sql.Int, id));
    conds.push(`q.SourceMRId IN (${mrs.map((_, i) => `@mr${i}`).join(", ")})`);
  }
  // Per quotation and submitted supplier: how many items priced and the total; then the lowest complete total.
  const rows = (await r.query(`
    WITH qs AS (
      SELECT q.QuotationId, q.DocNo AS QtDocNo, q.SourceMRId,
             (SELECT COUNT(*) FROM dbo.QuotationItems qi WHERE qi.QuotationId = q.QuotationId) AS ItemCount
      FROM dbo.Quotations q
      WHERE ${conds.join(" OR ")}
    ),
    tot AS (
      SELECT qs.QuotationId, s.SupplierLHeadId,
             COUNT(p.Rate) AS Priced,
             SUM(ISNULL(p.Rate, 0) * ISNULL(qi.Quantity, 0)) AS Total
      FROM qs
      JOIN dbo.QuotationSuppliers s ON s.QuotationId = qs.QuotationId AND s.Status = 'Submitted'
      JOIN dbo.QuotationItems qi ON qi.QuotationId = qs.QuotationId
      LEFT JOIN dbo.QuotationSupplierPrices p
        ON p.QuotationItemId = qi.QuotationItemId AND p.SupplierLHeadId = s.SupplierLHeadId AND p.Rate IS NOT NULL
      GROUP BY qs.QuotationId, s.SupplierLHeadId
    ),
    l1 AS (
      SELECT t.QuotationId, t.SupplierLHeadId, t.Total,
             ROW_NUMBER() OVER (PARTITION BY t.QuotationId ORDER BY t.Total, t.SupplierLHeadId) AS rn
      FROM tot t JOIN qs ON qs.QuotationId = t.QuotationId
      WHERE qs.ItemCount > 0 AND t.Priced = qs.ItemCount
    )
    SELECT qs.QuotationId, qs.QtDocNo, qs.SourceMRId, mr.DocNo AS MrDocNo, mr.RequestDate AS MrDate,
           l1.SupplierLHeadId AS L1SupplierId, ISNULL(ah.DisplayName, ah.LHeadName) AS L1SupplierName, l1.Total AS L1Total,
           (SELECT t.Total FROM tot t WHERE t.QuotationId = qs.QuotationId AND t.SupplierLHeadId = @sup) AS ChosenQuoteTotal
    FROM qs
    JOIN l1 ON l1.QuotationId = qs.QuotationId AND l1.rn = 1
    LEFT JOIN dbo.MaterialRequests mr ON mr.MRId = qs.SourceMRId
    LEFT JOIN dbo.AccountHeadMaster ah ON ah.LHeadId = l1.SupplierLHeadId
    WHERE l1.SupplierLHeadId <> @sup
    ORDER BY qs.QuotationId`)).recordset;

  return rows.map((x) => ({
    quotationId: x.QuotationId,
    quotationDocNo: x.QtDocNo,
    mrId: x.SourceMRId,
    mrDocNo: x.MrDocNo,
    mrDate: x.MrDate,
    l1SupplierId: x.L1SupplierId,
    l1SupplierName: x.L1SupplierName,
    l1Total: Number(x.L1Total) || 0,
    chosenQuoteTotal: x.ChosenQuoteTotal == null ? null : Number(x.ChosenQuoteTotal),
  }));
}

/** 400 unless a reason is given when the PO doesn't go to the L1 supplier. Returns the deviations found. */
async function assertReasonIfDeviating(pool, args, reason) {
  const deviations = await findL1Deviations(pool, args);
  if (deviations.length && !String(reason || "").trim()) {
    const d = deviations[0];
    const err = new Error(
      `${d.l1SupplierName || "Another supplier"} is the lowest (L1) on ${d.quotationDocNo}${d.mrDocNo ? ` for ${d.mrDocNo}` : ""}. ` +
        "Give a reason for choosing a different supplier.",
    );
    err.status = 400;
    err.code = "supplier_change_reason_required";
    err.deviations = deviations;
    throw err;
  }
  return deviations;
}

/** Store the reason on the PO (its own column after migration 586, else appended to Remarks). */
async function saveReason(pool, poId, reason) {
  const text = String(reason || "").trim().slice(0, 1000);
  if (!text) return;
  const req = pool.request().input("id", sql.Int, poId).input("reason", sql.NVarChar(1000), text);
  if (await hasReasonColumn(pool)) {
    await req.query("UPDATE dbo.PurchaseOrders SET SupplierChangeReason = @reason WHERE PurchaseOrderID = @id");
  } else {
    await req.query(`
      UPDATE dbo.PurchaseOrders
      SET Remarks = LEFT(CONCAT(NULLIF(CAST(Remarks AS NVARCHAR(MAX)), '') + CHAR(10), N'Supplier changed from L1: ', @reason), 4000)
      WHERE PurchaseOrderID = @id`);
  }
}

async function notifyDirectors(pool, poId, deviations, reason) {
  if (!deviations.length) return 0;
  const po = (await pool.request().input("id", sql.Int, poId).query(`
    SELECT po.PurchaseOrderNo, po.TotalAmount, ISNULL(ah.DisplayName, ah.LHeadName) AS SupplierName,
           STUFF((SELECT ', ' + ISNULL(pi.ItemName, pi.Description) FROM dbo.PurchaseOrderItems pi
                  WHERE pi.PurchaseOrderID = po.PurchaseOrderID ORDER BY pi.SortOrder FOR XML PATH(''), TYPE)
                 .value('.', 'NVARCHAR(MAX)'), 1, 2, '') AS Items
    FROM dbo.PurchaseOrders po
    LEFT JOIN dbo.AccountHeadMaster ah ON ah.LHeadId = po.SupplierID
    WHERE po.PurchaseOrderID = @id`)).recordset[0];
  if (!po) return 0;

  const directors = (await pool.request().query(`
    SELECT u.id FROM dbo.users u JOIN dbo.Role r ON r.RId = u.RoleId
    WHERE LOWER(r.RName) = 'director' AND ISNULL(u.discontinue, 0) = 0`)).recordset.map((x) => Number(x.id));
  if (!directors.length) return 0;

  let sent = 0;
  for (const d of deviations) {
    const mr = d.mrDocNo ? `${d.mrDocNo}${d.mrDate ? ` dated ${day(d.mrDate)}` : ""}` : d.quotationDocNo;
    const title = `Different supplier chosen for ${mr}`.slice(0, 200);
    const body = (
      `${po.PurchaseOrderNo} is made in ${po.SupplierName || "another supplier"}'s name for ${inr(po.TotalAmount)}` +
      ` instead of L1 ${d.l1SupplierName || ""} (${inr(d.l1Total)} on ${d.quotationDocNo}).` +
      (po.Items ? ` Items: ${po.Items}.` : "") +
      ` Reason: ${String(reason || "").trim()}`
    ).slice(0, 500);
    for (const uid of directors) {
      try {
        getIo().to(`user:${uid}`).emit("po:supplier-change", { title, body, poId, poNo: po.PurchaseOrderNo });
      } catch { /* socket may not be initialised in tests */ }
    }
    await sendToUsers(directors, { title, body, data: { type: "po_supplier_change", refId: poId, refType: "purchase_order" } }, { apps: ["admin"] });
    sent += directors.length;
  }
  return sent;
}

module.exports = { findL1Deviations, assertReasonIfDeviating, saveReason, notifyDirectors, hasReasonColumn };
