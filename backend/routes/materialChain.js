const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { ebResolvedProjectSql, projectAllowed } = require("../services/projectScope");
const { makeColumnProbe } = require("../services/columnProbe");

// dbo.MaterialRequests.SourceWOId arrives with migration 545; until then there is simply no Work Order link.
const hasMRSourceWO = makeColumnProbe("dbo.MaterialRequests", "SourceWOId");

// The project the starting document of a chain belongs to, so a restricted user
// can't walk the chain of a document from a project they can't see.
const ROOT_PROJECT_SQL = {
  wo: "SELECT ProjectId FROM dbo.WorkOrderHeader WHERE Id = @id",
  qt: "SELECT ProjectId FROM dbo.Quotations WHERE QuotationId = @id",
  mr: "SELECT ProjectId FROM dbo.MaterialRequests WHERE MRId = @id",
  po: "SELECT ProjectId FROM dbo.PurchaseOrders WHERE PurchaseOrderID = @id",
  grn: "SELECT p.ProjectId FROM dbo.GoodsReceiptNotes g JOIN dbo.PurchaseOrders p ON p.PurchaseOrderID = g.POID WHERE g.GRNID = @id",
  vio: "SELECT ProjectID AS ProjectId FROM dbo.VehicleInOut WHERE VehicleInOutID = @id",
  expense: `SELECT ${ebResolvedProjectSql("eb")} AS ProjectId FROM dbo.ExpenseBooking eb WHERE eb.Eid = @id`,
};

// Resolves the full document chain (Work Order → Material Request → Quotation →
// Purchase Order → GRN → Invoice/Expense Booking) around any one document in that chain, so
// every preview can show "where this came from" and "what was generated
// from this" with enough info to render a clickable nav link.
//
// Each chain node: { docType, id, docNo, date, status, label, extra }
// `docType` is one of "wo" | "mr" | "qt" | "po" | "vio" | "grn" | "expense" — the frontend maps
// that to a route + ?view=<id> deep link.

async function getMR(pool, id) {
  const withWO = await hasMRSourceWO(pool);
  const r = await pool.request().input("id", sql.Int, id).query(`
    SELECT mr.MRId AS id, mr.DocNo, mr.RequestDate, mr.Status, mr.CreatedBy,
           mr.ProjectId, pr.name AS ProjectName,
           ${withWO ? "mr.SourceWOId, mr.SourceWODocNo" : "CAST(NULL AS INT) AS SourceWOId, CAST(NULL AS NVARCHAR(100)) AS SourceWODocNo"}
    FROM dbo.MaterialRequests mr
    LEFT JOIN dbo.enterprise pr ON pr.id = mr.ProjectId
    WHERE mr.MRId = @id
  `);
  return r.recordset[0] || null;
}

// POs raised straight from the MR, plus POs raised from one of the MR's quotations.
async function getPOsForMR(pool, mrId) {
  const r = await pool.request().input("mrId", sql.Int, mrId).query(`
    SELECT PurchaseOrderID AS id, PurchaseOrderNo, DocNo, PODate, Status
    FROM dbo.PurchaseOrders
    WHERE SourceMRId = @mrId
       OR SourceQTId IN (SELECT QuotationId FROM dbo.Quotations WHERE SourceMRId = @mrId)
    ORDER BY PurchaseOrderID
  `);
  return r.recordset;
}

async function getQTsForMR(pool, mrId) {
  const r = await pool.request().input("mrId", sql.Int, mrId).query(`
    SELECT QuotationId AS id, DocNo, DocDate, Status, SourceMRId
    FROM dbo.Quotations
    WHERE SourceMRId = @mrId
    ORDER BY QuotationId
  `);
  return r.recordset;
}

async function getQT(pool, id) {
  const r = await pool.request().input("id", sql.Int, id).query(`
    SELECT QuotationId AS id, DocNo, DocDate, Status, SourceMRId
    FROM dbo.Quotations
    WHERE QuotationId = @id
  `);
  return r.recordset[0] || null;
}

async function getPOsForQT(pool, qtId) {
  const r = await pool.request().input("qtId", sql.Int, qtId).query(`
    SELECT PurchaseOrderID AS id, PurchaseOrderNo, DocNo, PODate, Status
    FROM dbo.PurchaseOrders
    WHERE SourceQTId = @qtId
    ORDER BY PurchaseOrderID
  `);
  return r.recordset;
}

async function getWO(pool, id) {
  const r = await pool.request().input("id", sql.Int, id).query(`
    SELECT Id AS id, DocNo, DocumentNumber, DocDate, Status, ProjectId
    FROM dbo.WorkOrderHeader
    WHERE Id = @id
  `);
  return r.recordset[0] || null;
}

async function getMRsForWO(pool, woId) {
  if (!(await hasMRSourceWO(pool))) return [];
  const r = await pool.request().input("woId", sql.Int, woId).query(`
    SELECT mr.MRId AS id, mr.DocNo, mr.RequestDate, mr.Status, mr.CreatedBy,
           mr.ProjectId, pr.name AS ProjectName, mr.SourceWOId, mr.SourceWODocNo
    FROM dbo.MaterialRequests mr
    LEFT JOIN dbo.enterprise pr ON pr.id = mr.ProjectId
    WHERE mr.SourceWOId = @woId
    ORDER BY mr.MRId
  `);
  return r.recordset;
}

// POs created straight from a Work Order (the retired "Create Material PO" button / auto WO-PO) carry
// SourceWOId but no MR, so they hang directly off the Work Order.
async function getLegacyPOsForWO(pool, woId) {
  const r = await pool.request().input("woId", sql.Int, woId).query(`
    SELECT PurchaseOrderID AS id, PurchaseOrderNo, DocNo, PODate, Status
    FROM dbo.PurchaseOrders
    WHERE SourceWOId = @woId AND SourceMRId IS NULL AND SourceQTId IS NULL
    ORDER BY PurchaseOrderID
  `);
  return r.recordset;
}

async function getPO(pool, id) {
  const r = await pool.request().input("id", sql.Int, id).query(`
    SELECT po.PurchaseOrderID AS id, po.PurchaseOrderNo, po.DocNo, po.PODate, po.Status,
           po.SourceMRId, po.SourceMRDocNo, po.SourceQTId, po.SourceQTDocNo, po.SourceWOId,
           po.SupplierID, ahm.LHeadName AS SupplierName
    FROM dbo.PurchaseOrders po
    LEFT JOIN dbo.AccountHeadMaster ahm ON ahm.LHeadId = po.SupplierID
    WHERE po.PurchaseOrderID = @id
  `);
  return r.recordset[0] || null;
}

// A PO created straight from an MR carries SourceMRId itself. A PO created
// from a Quotation does NOT reliably get SourceMRId back-filled (it's only
// set if the PO-creation UI separately passed it) — the real chain is
// MR -> Quotation.SourceMRId -> PO.SourceQTId -> Quotation. So resolve the
// MR the PO is ultimately tagged to via either path, preferring the direct
// link when both happen to be present.
async function getEffectiveMR(pool, po) {
  if (po.SourceMRId) return getMR(pool, po.SourceMRId);
  if (po.SourceQTId) {
    const r = await pool.request().input("qtId", sql.Int, po.SourceQTId).query(`
      SELECT SourceMRId FROM dbo.Quotations WHERE QuotationId = @qtId
    `);
    const qtMrId = r.recordset[0]?.SourceMRId;
    if (qtMrId) return getMR(pool, qtMrId);
  }
  return null;
}

async function getVIO(pool, id) {
  const r = await pool.request().input("id", sql.Int, id).query(`
    SELECT v.VehicleInOutID AS id, v.DocNo, v.DocDate, v.VehicleNo, v.Status, v.POID
    FROM dbo.VehicleInOut v
    WHERE v.VehicleInOutID = @id
  `);
  return r.recordset[0] || null;
}

async function getVIOsForPO(pool, poId) {
  const r = await pool.request().input("poId", sql.Int, poId).query(`
    SELECT VehicleInOutID AS id, DocNo, DocDate, VehicleNo, Status
    FROM dbo.VehicleInOut
    WHERE POID = @poId
    ORDER BY VehicleInOutID DESC
  `);
  return r.recordset;
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

function woNode(wo) {
  return {
    docType: "wo",
    id: wo.id,
    docNo: wo.DocNo || wo.DocumentNumber,
    date: wo.DocDate ? String(wo.DocDate).slice(0, 10) : null,
    status: wo.Status,
    label: "Work Order",
    extra: {},
  };
}
function qtNode(qt) {
  return {
    docType: "qt",
    id: qt.id,
    docNo: qt.DocNo,
    date: qt.DocDate ? String(qt.DocDate).slice(0, 10) : null,
    status: qt.Status,
    label: "Quotation",
    extra: {},
  };
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
function vioNode(v) {
  return {
    docType: "vio",
    id: v.id,
    docNo: v.DocNo,
    date: v.DocDate ? String(v.DocDate).slice(0, 10) : null,
    status: v.Status,
    label: "Vehicle In/Out",
    extra: { vehicleNo: v.VehicleNo },
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

// Everything upstream of a PO, in document order: Work Order -> Material Request -> Quotation.
async function upstreamOfPO(pool, po) {
  const out = [];
  const mr = await getEffectiveMR(pool, po);
  const woId = (mr && mr.SourceWOId) || po.SourceWOId || null;
  if (woId) {
    const wo = await getWO(pool, woId);
    if (wo) out.push(woNode(wo));
  }
  if (mr) out.push(mrNode(mr));
  if (po.SourceQTId) {
    const qt = await getQT(pool, po.SourceQTId);
    if (qt) out.push(qtNode(qt));
  }
  return out;
}

// Everything downstream of a Work Order: its MRs, their quotations and POs, and each PO's GRNs / vehicle
// entries / invoices - one flat, de-duplicated list in document-stage order.
async function downstreamOfWO(pool, woId) {
  const mrs = await getMRsForWO(pool, woId);
  const qts = [];
  const pos = [...(await getLegacyPOsForWO(pool, woId))];
  for (const mr of mrs) {
    qts.push(...(await getQTsForMR(pool, mr.id)));
    pos.push(...(await getPOsForMR(pool, mr.id)));
  }
  const seenPO = new Set();
  const uniquePOs = pos.filter((p) => (seenPO.has(p.id) ? false : (seenPO.add(p.id), true)));
  const vios = [];
  const grns = [];
  for (const po of uniquePOs) {
    vios.push(...(await getVIOsForPO(pool, po.id)));
    grns.push(...(await getGRNsForPO(pool, po.id)));
  }
  const expenses = [];
  for (const grn of grns) expenses.push(...(await getExpensesForGRN(pool, grn.id)));
  return [
    ...mrs.map(mrNode),
    ...qts.map(qtNode),
    ...uniquePOs.map(poNode),
    ...vios.map(vioNode),
    ...grns.map(grnNode),
    ...expenses.map(expenseNode),
  ];
}

router.get("/:type/:id", authMiddleware, async (req, res) => {
  const { type } = req.params;
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });

  try {
    const pool = getPool();
    if (req.projectScope && ROOT_PROJECT_SQL[type]) {
      const root = await pool.request().input("id", sql.Int, id).query(ROOT_PROJECT_SQL[type]);
      if (root.recordset.length && !projectAllowed(req.projectScope, root.recordset[0].ProjectId)) {
        return res.status(403).json({ error: "You don't have access to this project." });
      }
    }
    let current = null;
    let upstream = [];
    let downstream = [];

    if (type === "wo") {
      const wo = await getWO(pool, id);
      if (!wo) return res.status(404).json({ error: "Work Order not found" });
      current = woNode(wo);
      downstream = await downstreamOfWO(pool, id);
    } else if (type === "mr") {
      const mr = await getMR(pool, id);
      if (!mr) return res.status(404).json({ error: "Material Request not found" });
      current = mrNode(mr);
      if (mr.SourceWOId) {
        const wo = await getWO(pool, mr.SourceWOId);
        if (wo) upstream.push(woNode(wo));
      }
      const qts = await getQTsForMR(pool, id);
      const pos = await getPOsForMR(pool, id);
      downstream = [...qts.map(qtNode), ...pos.map(poNode)];
    } else if (type === "qt") {
      const qt = await getQT(pool, id);
      if (!qt) return res.status(404).json({ error: "Quotation not found" });
      current = qtNode(qt);
      if (qt.SourceMRId) {
        const mr = await getMR(pool, qt.SourceMRId);
        if (mr) {
          if (mr.SourceWOId) {
            const wo = await getWO(pool, mr.SourceWOId);
            if (wo) upstream.push(woNode(wo));
          }
          upstream.push(mrNode(mr));
        }
      }
      const pos = await getPOsForQT(pool, id);
      downstream = pos.map(poNode);
    } else if (type === "po") {
      const po = await getPO(pool, id);
      if (!po) return res.status(404).json({ error: "Purchase Order not found" });
      current = poNode(po);
      upstream = await upstreamOfPO(pool, po);
      const vios = await getVIOsForPO(pool, id);
      const grns = await getGRNsForPO(pool, id);
      downstream = [...vios.map(vioNode), ...grns.map(grnNode)];
    } else if (type === "vio") {
      const vio = await getVIO(pool, id);
      if (!vio) return res.status(404).json({ error: "Vehicle In/Out not found" });
      current = vioNode(vio);
      if (vio.POID) {
        const po = await getPO(pool, vio.POID);
        if (po) {
          upstream = [...(await upstreamOfPO(pool, po)), poNode(po)];
        }
      }
    } else if (type === "grn") {
      const grn = await getGRN(pool, id);
      if (!grn) return res.status(404).json({ error: "GRN not found" });
      current = grnNode(grn);
      if (grn.POID) {
        const po = await getPO(pool, grn.POID);
        if (po) {
          upstream = [...(await upstreamOfPO(pool, po)), poNode(po)];
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
            if (po) upstream = [...(await upstreamOfPO(pool, po)), poNode(po), grnNode(grn)];
          }
        }
      } else if ((eb.ESourceType === "PO" || eb.ESourceType === "WO_PO") && eb.ESourceId) {
        const po = await getPO(pool, parseInt(eb.ESourceId, 10));
        if (po) upstream = [...(await upstreamOfPO(pool, po)), poNode(po)];
      }
    } else {
      return res.status(400).json({ error: "type must be one of wo, mr, qt, po, vio, grn, expense" });
    }

    res.json({ current, upstream, downstream });
  } catch (err) {
    console.error("[material-chain] error:", err.message, err.stack);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
