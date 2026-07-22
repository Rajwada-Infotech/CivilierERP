"use strict";

/**
 * backend/services/shortClose.js
 *
 * Year-end housekeeping: retires partially-fulfilled Purchase Orders and
 * Material Requests so their remaining pending quantity is permanently
 * cancelled and no further transactions can be raised against them.
 *
 * "Partial" is a derived state for both doc types, not a stored Status:
 *   - PO: SUM(PurchaseOrderItems.Quantity) > SUM(ReceivedQty) > 0
 *         (ReceivedQty is kept in sync from GRNs by syncPOItemReceivedQty)
 *   - MR: Status = 'Partially Fulfilled' (a real stored status — see
 *         services/materialRequestFulfillment.js)
 */

const { getPool, sql } = require("../db");
const { getMRItemFulfillment } = require("./materialRequestFulfillment");

async function searchCandidates(pool, { docType, finYearId, companyId, projectId }) {
  if (docType === "PO") {
    const request = pool.request();
    const conditions = [
      "po.Status NOT IN ('Draft', 'Pending', 'Rejected', 'Cancelled', 'Short Closed')",
      "ia.TotalOrdered > ia.TotalReceived",
      "ia.TotalReceived > 0",
    ];
    if (finYearId) {
      conditions.push("po.fy_id = @finYearId");
      request.input("finYearId", sql.Int, parseInt(finYearId, 10));
    }
    if (companyId) {
      conditions.push("po.CompanyId = @companyId");
      request.input("companyId", sql.Int, parseInt(companyId, 10));
    }
    if (projectId) {
      conditions.push("po.ProjectId = @projectId");
      request.input("projectId", sql.Int, parseInt(projectId, 10));
    }
    const result = await request.query(`
      SELECT
        po.PurchaseOrderID AS DocId, po.DocNo, po.PurchaseOrderNo, po.PODate AS DocDate,
        po.Status, po.fy_id AS FinYearId, po.CompanyId, po.ProjectId,
        ah.LHeadName AS PartyName,
        ia.TotalOrdered, ia.TotalReceived, po.UpdatedAt
      FROM dbo.PurchaseOrders po
      JOIN (
        SELECT PurchaseOrderID, SUM(Quantity) AS TotalOrdered, SUM(ISNULL(ReceivedQty, 0)) AS TotalReceived
        FROM dbo.PurchaseOrderItems
        GROUP BY PurchaseOrderID
      ) ia ON ia.PurchaseOrderID = po.PurchaseOrderID
      LEFT JOIN dbo.AccountHeadMaster ah ON ah.LHeadId = po.SupplierID
      WHERE ${conditions.join(" AND ")}
      ORDER BY po.PurchaseOrderID DESC
    `);
    return result.recordset.map((r) => ({
      docType: "PO",
      docId: r.DocId,
      docNo: r.DocNo || r.PurchaseOrderNo,
      docDate: r.DocDate,
      party: r.PartyName,
      status: r.Status,
      finYearId: r.FinYearId,
      companyId: r.CompanyId,
      projectId: r.ProjectId,
      totalQty: Number(r.TotalOrdered) || 0,
      completedQty: Number(r.TotalReceived) || 0,
      pendingQty: Math.max(0, (Number(r.TotalOrdered) || 0) - (Number(r.TotalReceived) || 0)),
      updatedAt: r.UpdatedAt,
    }));
  }

  // docType === "MR"
  const request = pool.request();
  const conditions = ["mr.Status = 'Partially Fulfilled'"];
  if (finYearId) {
    conditions.push("mr.FinYearId = @finYearId");
    request.input("finYearId", sql.Int, parseInt(finYearId, 10));
  }
  if (companyId) {
    conditions.push("mr.CompanyId = @companyId");
    request.input("companyId", sql.Int, parseInt(companyId, 10));
  }
  if (projectId) {
    conditions.push("mr.ProjectId = @projectId");
    request.input("projectId", sql.Int, parseInt(projectId, 10));
  }
  const result = await request.query(`
    SELECT
      mr.MRId AS DocId, mr.DocNo, mr.RequestDate AS DocDate, mr.Status,
      mr.FinYearId, mr.CompanyId, mr.ProjectId, mr.CreatedBy AS PartyName,
      mr.UpdatedAt
    FROM dbo.MaterialRequests mr
    WHERE ${conditions.join(" AND ")}
    ORDER BY mr.MRId DESC
  `);

  // Per-item fulfillment (requested vs. ordered) is computed the same way
  // the "Pending - N Qty" pill does — reused here rather than re-deriving
  // it in raw SQL, which trips SQL Server's "aggregate on an aggregate"
  // restriction when nested this way.
  const rows = [];
  for (const r of result.recordset) {
    const items = await getMRItemFulfillment(pool, r.DocId);
    const totalRequested = items.reduce((s, i) => s + i.RequestedQty, 0);
    const totalOrdered = items.reduce((s, i) => s + i.OrderedQty, 0);
    rows.push({
      docType: "MR",
      docId: r.DocId,
      docNo: r.DocNo,
      docDate: r.DocDate,
      party: r.PartyName,
      status: r.Status,
      finYearId: r.FinYearId,
      companyId: r.CompanyId,
      projectId: r.ProjectId,
      totalQty: totalRequested,
      completedQty: totalOrdered,
      pendingQty: Math.max(0, totalRequested - totalOrdered),
      updatedAt: r.UpdatedAt,
    });
  }
  return rows;
}

// Processes each id independently — a failure on one doc doesn't block the
// rest. Re-validates the "still Partial" condition right before writing
// (the same predicate searchCandidates used), guarding against another user
// having changed the document in between search and confirm.
async function processShortClose(pool, { docType, ids, remarks, userEmail }) {
  const results = [];
  for (const rawId of ids) {
    const docId = parseInt(rawId, 10);
    if (!docId) {
      results.push({ docId: rawId, ok: false, reason: "Invalid id" });
      continue;
    }
    try {
      const table = docType === "PO" ? "dbo.PurchaseOrders" : "dbo.MaterialRequests";
      const idCol = docType === "PO" ? "PurchaseOrderID" : "MRId";
      const candidates = await searchCandidates(pool, {
        docType,
        finYearId: null,
        companyId: null,
        projectId: null,
      });
      const match = candidates.find((c) => c.docId === docId);
      if (!match) {
        results.push({
          docId,
          ok: false,
          reason: "No longer in Partial status — skipped (may have changed since search).",
        });
        continue;
      }

      const previousStatus = match.status;
      await pool
        .request()
        .input("Id", sql.Int, docId)
        .input("ShortClosedAt", sql.DateTime2, new Date())
        .input("ShortClosedBy", sql.NVarChar(200), userEmail || null)
        .input("Remarks", sql.NVarChar(sql.MAX), remarks || null).query(`
          UPDATE ${table}
          SET Status = 'Short Closed',
              ShortClosedAt = @ShortClosedAt,
              ShortClosedBy = @ShortClosedBy,
              ShortCloseRemarks = @Remarks,
              UpdatedAt = @ShortClosedAt
          WHERE ${idCol} = @Id
        `);

      await pool
        .request()
        .input("DocType", sql.NVarChar(10), docType)
        .input("DocId", sql.Int, docId)
        .input("DocNo", sql.NVarChar(100), match.docNo || null)
        .input("FinYearId", sql.Int, match.finYearId || null)
        .input("CompanyId", sql.Int, match.companyId || null)
        .input("ProjectId", sql.Int, match.projectId || null)
        .input("PreviousStatus", sql.NVarChar(50), previousStatus || null)
        .input("CompletedQty", sql.Decimal(18, 4), match.completedQty)
        .input("CancelledQty", sql.Decimal(18, 4), match.pendingQty)
        .input("PerformedBy", sql.NVarChar(200), userEmail || null)
        .input("Remarks", sql.NVarChar(sql.MAX), remarks || null).query(`
          INSERT INTO dbo.ShortCloseAuditLog
            (DocType, DocId, DocNo, FinYearId, CompanyId, ProjectId,
             PreviousStatus, NewStatus, CompletedQty, CancelledQty, PerformedBy, Remarks)
          VALUES
            (@DocType, @DocId, @DocNo, @FinYearId, @CompanyId, @ProjectId,
             @PreviousStatus, 'Short Closed', @CompletedQty, @CancelledQty, @PerformedBy, @Remarks)
        `);

      results.push({ docId, ok: true, docNo: match.docNo });
    } catch (err) {
      results.push({ docId, ok: false, reason: err.message });
    }
  }
  return results;
}

module.exports = { searchCandidates, processShortClose };
