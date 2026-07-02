const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");

// Resolves the full document chain (Material Request → Purchase Order →
// GRN → Invoice/Expense Booking) around any one document in that chain, so
// every preview can show "where this came from" and "what was generated
// from this" with enough info to render a clickable nav link.
//
// Each chain node: { docType, id, docNo, date, status, label, extra }
// `docType` is one of "mr" | "po" | "grn" | "expense" — the frontend maps
// that to a route + ?view=<id> deep link.

async function getMR(pool, id) {
  const r = await pool.request().input("id", sql.Int, id).query(`
    SELECT mr.MRId AS id, mr.DocNo, mr.RequestDate, mr.Status, mr.CreatedBy,
           mr.ProjectId, pr.name AS ProjectName
    FROM dbo.MaterialRequests mr
    LEFT JOIN dbo.enterprise pr ON pr.id = mr.ProjectId
    WHERE mr.MRId = @id
  `);
  return r.recordset[0] || null;
}

async function getPOsForMR(pool, mrId) {
  const r = await pool.request().input("mrId", sql.Int, mrId).query(`
    SELECT PurchaseOrderID AS id, PurchaseOrderNo, DocNo, PODate, Status
    FROM dbo.PurchaseOrders
    WHERE SourceMRId = @mrId
    ORDER BY PurchaseOrderID
  `);
  return r.recordset;
}

async function getPO(pool, id) {
  const r = await pool.request().input("id", sql.Int, id).query(`
    SELECT po.PurchaseOrderID AS id, po.PurchaseOrderNo, po.DocNo, po.PODate, po.Status,
           po.SourceMRId, po.SourceMRDocNo, po.SupplierID, ahm.LHeadName AS SupplierName
    FROM dbo.PurchaseOrders po
    LEFT JOIN dbo.AccountHeadMaster ahm ON ahm.LHeadId = po.SupplierID
    WHERE po.PurchaseOrderID = @id
  `);
  return r.recordset[0] || null;
}

async function getGRNsForPO(pool, poId) {
  const r = await pool.request().input("poId", sql.Int, poId).query(`
    SELECT grn.GRNID AS id, grn.GRNNo, grn.DocNo, grn.GRNDate, grn.Status,
           grn.SupplierID, ahm.LHeadName AS SupplierName, grn.TotalAmount
    FROM dbo.GoodsReceiptNotes grn
    LEFT JOIN dbo.AccountHeadMaster ahm ON ahm.LHeadId = grn.SupplierID
    WHERE grn.POID = @poId
    ORDER BY grn.GRNID
  `);
  return r.recordset;
}

async function getGRN(pool, id) {
  const r = await pool.request().input("id", sql.Int, id).query(`
    SELECT grn.GRNID AS id, grn.GRNNo, grn.DocNo, grn.GRNDate, grn.Status,
           grn.POID, po.PurchaseOrderNo, po.DocNo AS PODocNo,
           grn.SupplierID, ahm.LHeadName AS SupplierName
    FROM dbo.GoodsReceiptNotes grn
    LEFT JOIN dbo.PurchaseOrders po ON po.PurchaseOrderID = grn.POID
    LEFT JOIN dbo.AccountHeadMaster ahm ON ahm.LHeadId = grn.SupplierID
    WHERE grn.GRNID = @id
  `);
  return r.recordset[0] || null;
}

async function getExpensesForGRN(pool, grnId) {
  const r = await pool.request().input("grnId", sql.Int, parseInt(grnId, 10)).query(`
    SELECT Eid AS id, EDocNo, EDocDate, EStatus, ENetAmount, EVendorInvoiceNo
    FROM dbo.ExpenseBooking
    WHERE ESourceType = 'GRN' AND ESourceId = @grnId
    ORDER BY Eid
  `);
  return r.recordset;
}

async function getExpense(pool, id) {
  const r = await pool.request().input("id", sql.Int, id).query(`
    SELECT Eid AS id, EDocNo, EDocDate, EStatus, ENetAmount, EVendorInvoiceNo,
           ESourceType, ESourceId
    FROM dbo.ExpenseBooking
    WHERE Eid = @id
  `);
  return r.recordset[0] || null;
}

function mrNode(mr) {
  return {
    docType: "mr",
    id: mr.id,
    docNo: mr.DocNo,
    date: mr.RequestDate ? String(mr.RequestDate).slice(0, 10) : null,
    status: mr.Status,
    label: "Material Request",
    extra: { requestedBy: mr.CreatedBy, project: mr.ProjectName },
  };
}
function poNode(po) {
  return {
    docType: "po",
    id: po.id,
    docNo: po.DocNo || po.PurchaseOrderNo,
    date: po.PODate ? String(po.PODate).slice(0, 10) : null,
    status: po.Status,
    label: "Purchase Order",
    extra: { supplier: po.SupplierName },
  };
}
function grnNode(grn) {
  return {
    docType: "grn",
    id: grn.id,
    docNo: grn.DocNo || grn.GRNNo,
    date: grn.GRNDate ? String(grn.GRNDate).slice(0, 10) : null,
    status: grn.Status,
    label: "GRN",
    extra: { supplier: grn.SupplierName, totalAmount: grn.TotalAmount },
  };
}
function expenseNode(eb) {
  return {
    docType: "expense",
    id: eb.id,
    docNo: eb.EDocNo,
    date: eb.EDocDate ? String(eb.EDocDate).slice(0, 10) : null,
    status: eb.EStatus,
    label: "Purchase Invoice",
    extra: { netAmount: eb.ENetAmount, vendorInvoiceNo: eb.EVendorInvoiceNo },
  };
}

router.get("/:type/:id", authMiddleware, async (req, res) => {
  const { type } = req.params;
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });

  try {
    const pool = getPool();
    let current = null;
    let upstream = [];
    let downstream = [];

    if (type === "mr") {
      const mr = await getMR(pool, id);
      if (!mr) return res.status(404).json({ error: "Material Request not found" });
      current = mrNode(mr);
      const pos = await getPOsForMR(pool, id);
      downstream = pos.map(poNode);
    } else if (type === "po") {
      const po = await getPO(pool, id);
      if (!po) return res.status(404).json({ error: "Purchase Order not found" });
      current = poNode(po);
      if (po.SourceMRId) {
        const mr = await getMR(pool, po.SourceMRId);
        if (mr) upstream.push(mrNode(mr));
      }
      const grns = await getGRNsForPO(pool, id);
      downstream = grns.map(grnNode);
    } else if (type === "grn") {
      const grn = await getGRN(pool, id);
      if (!grn) return res.status(404).json({ error: "GRN not found" });
      current = grnNode(grn);
      if (grn.POID) {
        const po = await getPO(pool, grn.POID);
        if (po) {
          upstream.push(poNode(po));
          if (po.SourceMRId) {
            const mr = await getMR(pool, po.SourceMRId);
            if (mr) upstream.unshift(mrNode(mr));
          }
        }
      }
      const expenses = await getExpensesForGRN(pool, id);
      downstream = expenses.map(expenseNode);
    } else if (type === "expense") {
      const eb = await getExpense(pool, id);
      if (!eb) return res.status(404).json({ error: "Invoice / Expense Booking not found" });
      current = expenseNode(eb);
      if (eb.ESourceType === "GRN" && eb.ESourceId) {
        const grn = await getGRN(pool, parseInt(eb.ESourceId, 10));
        if (grn) {
          upstream.push(grnNode(grn));
          if (grn.POID) {
            const po = await getPO(pool, grn.POID);
            if (po) {
              upstream.unshift(poNode(po));
              if (po.SourceMRId) {
                const mr = await getMR(pool, po.SourceMRId);
                if (mr) upstream.unshift(mrNode(mr));
              }
            }
          }
        }
      } else if ((eb.ESourceType === "PO" || eb.ESourceType === "WO_PO") && eb.ESourceId) {
        const po = await getPO(pool, parseInt(eb.ESourceId, 10));
        if (po) {
          upstream.push(poNode(po));
          if (po.SourceMRId) {
            const mr = await getMR(pool, po.SourceMRId);
            if (mr) upstream.unshift(mrNode(mr));
          }
        }
      }
    } else {
      return res.status(400).json({ error: "type must be one of mr, po, grn, expense" });
    }

    res.json({ current, upstream, downstream });
  } catch (err) {
    console.error("[material-chain] error:", err.message, err.stack);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
