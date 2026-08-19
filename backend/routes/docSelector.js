/**
 * docSelector.js — GET /api/doc-selector
 *
 * Search-as-you-type lookup of REAL document rows (an actual PO, GRN, Work
 * Order, ...) — not dbo.TypeOfDoc's *definitions*. Used by the Task Master
 * "Document Number" combobox: once a task's Entry Type -> Type of Doc chain
 * resolves to a module (via that TypeOfDoc's links_to label), this endpoint
 * lets the user search real records in that module's table, optionally
 * narrowed by Company/Project.
 *
 * DOC_MODULE_MAP keys match the same "links_to" label strings already used
 * by document-type.js's MODULE_LINKS and approvalService.js's
 * MODULE_DOC_LINKS — real table/column names were verified against the
 * actual INSERT/SELECT statements in each module's own route file (there
 * are no CREATE TABLE migrations for most of these; the base tables predate
 * the migrations folder). Two tables have caveats worth knowing before
 * extending this map:
 *   - GoodsReceiptNotes has no CompanyId/ProjectId of its own — both are
 *     derived by joining to the GRN's originating PurchaseOrders row.
 *   - ExpenseBooking.EProjectName and NewPayment.PProject/PCompany are
 *     free-text NVARCHAR columns, not INT FKs — they're excluded from
 *     company/project filtering (companyCol/projectCol: null) rather than
 *     joined against dbo.enterprise, since a string compare would silently
 *     return wrong/empty results for numeric-looking free text.
 */
const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");

// NOTE: authMiddleware is intentionally NOT included here — already applied
// globally via app.use("/api", authMiddleware) in server.js.

// finYearCol: a direct FK column to dbo.FinYear.FId, when the module's own
// table has one (only Purchase Order does — see purchaseOrders.js's fy_id
// join). Every other module falls back to a date-range join against
// dbo.FinYear (dateCol BETWEEN FStartDate AND FEndDate) below — the same
// "safest/most general" approach grns.js already uses as its own fallback,
// rather than every module needing its own FinYear FK added.
const DOC_MODULE_MAP = {
  "Purchase Order": {
    table: "dbo.PurchaseOrders", alias: "t",
    idCol: "PurchaseOrderID", docNoCol: "PurchaseOrderNo", dateCol: "PODate",
    companyCol: "CompanyId", projectCol: "ProjectId", finYearCol: "fy_id",
    statusCol: "Status", excludeStatuses: ["Rejected", "Deleted"],
  },
  "GRN": {
    table: "dbo.GoodsReceiptNotes", alias: "t",
    idCol: "GRNID", docNoCol: "GRNNo", dateCol: "GRNDate",
    // No company/project columns on GRN itself — derived from its PO.
    companyCol: "CompanyId", projectCol: "ProjectId",
    join: "LEFT JOIN dbo.PurchaseOrders po ON po.PurchaseOrderID = t.POID",
    companyExpr: "po.CompanyId", projectExpr: "po.ProjectId",
    statusCol: "Status", excludeStatuses: ["Rejected"],
  },
  "Work Order": {
    table: "dbo.WorkOrderHeader", alias: "t",
    idCol: "Id", docNoCol: "DocumentNumber", dateCol: "DocumentDate",
    companyCol: "CompanyId", projectCol: "ProjectId",
    statusCol: "Status", excludeStatuses: ["Rejected", "Deleted"],
  },
  "Expense Booking": {
    table: "dbo.ExpenseBooking", alias: "t",
    idCol: "Eid", docNoCol: "EDocNo", dateCol: "EDocDate",
    companyCol: "ECompanyId", projectCol: null, // EProjectName is free text, not an FK
    statusCol: "EStatus", excludeStatuses: ["Deleted"],
  },
  "Payment": {
    table: "dbo.NewPayment", alias: "t",
    idCol: "PPaymentID", docNoCol: "DocNo", dateCol: "PDate",
    companyCol: null, projectCol: null, // PCompany/PProject are free text, not FKs
    statusCol: "Status", excludeStatuses: ["Rejected", "Deleted"],
  },
  "Material Request": {
    table: "dbo.MaterialRequests", alias: "t",
    idCol: "MRId", docNoCol: "DocNo", dateCol: "RequestDate",
    companyCol: "CompanyId", projectCol: "ProjectId",
    statusCol: "Status", excludeStatuses: ["Deleted", "Rejected"],
  },
  "BOQ": {
    table: "dbo.BOQ", alias: "t",
    idCol: "BoqID", docNoCol: "BoqNo", dateCol: "BoqDate",
    companyCol: "CompanyId", projectCol: "ProjectId",
    statusCol: "Status", excludeStatuses: ["Rejected"],
  },
  "Work Done": {
    table: "dbo.WorkDone", alias: "t",
    idCol: "ID", docNoCol: "DocNo", dateCol: "DocDate",
    companyCol: "CompanyId", projectCol: "ProjectId",
    statusCol: "Status", excludeStatuses: ["Rejected", "Deleted"],
  },
};

const RESULT_LIMIT = 50;

// ── GET /modules — which module labels this endpoint can search ──────────────
// The frontend uses this to decide whether the Doc Selector should even be
// enabled for a given TypeOfDoc's links_to value, vs. showing "No documents
// required for this entry type".
router.get("/modules", (req, res) => {
  res.json(Object.keys(DOC_MODULE_MAP));
});

// ── GET /?module=Purchase Order&companyId=&projectId=&search= ────────────────
// ── GET /?module=Purchase Order&id=123 ────────────────────────────────────────
// The `id` form is an exact lookup for one already-picked record (e.g. a
// task's linked doc re-resolving on Edit-open, or re-resolving after a
// change) — it bypasses status/company/project filtering and `search`
// entirely, since the caller already knows exactly which record it wants.
router.get("/", async (req, res) => {
  const moduleLabel = (req.query.module || "").toString();
  const cfg = DOC_MODULE_MAP[moduleLabel];
  if (!cfg) return res.status(400).json({ error: "Unsupported or missing document module" });

  const idParam = req.query.id ? parseInt(req.query.id, 10) : null;
  const search = (req.query.search || "").toString().trim();
  const companyId = req.query.companyId ? parseInt(req.query.companyId, 10) : null;
  const projectId = req.query.projectId ? parseInt(req.query.projectId, 10) : null;

  try {
    const pool = getPool();
    const request = pool.request();
    const conditions = [];

    if (idParam) {
      request.input("Id", sql.Int, idParam);
      conditions.push(`t.${cfg.idCol} = @Id`);
    } else {
      if (cfg.excludeStatuses?.length) {
        const names = cfg.excludeStatuses.map((v, i) => {
          request.input(`ex${i}`, sql.NVarChar(30), v);
          return `@ex${i}`;
        });
        conditions.push(`ISNULL(t.${cfg.statusCol}, '') NOT IN (${names.join(", ")})`);
      }
      if (search) {
        request.input("Search", sql.NVarChar(100), `%${search}%`);
        conditions.push(`t.${cfg.docNoCol} LIKE @Search`);
      }
    }
    const companyExpr = cfg.companyExpr || (cfg.companyCol ? `t.${cfg.companyCol}` : null);
    const projectExpr = cfg.projectExpr || (cfg.projectCol ? `t.${cfg.projectCol}` : null);
    if (!idParam) {
      if (companyId && companyExpr) {
        request.input("CompanyId", sql.Int, companyId);
        conditions.push(`${companyExpr} = @CompanyId`);
      }
      if (projectId && projectExpr) {
        request.input("ProjectId", sql.Int, projectId);
        conditions.push(`${projectExpr} = @ProjectId`);
      }
    }

    const finYearJoin = cfg.finYearCol
      ? `LEFT JOIN dbo.FinYear fy ON fy.FId = t.${cfg.finYearCol}`
      : `LEFT JOIN dbo.FinYear fy ON t.${cfg.dateCol} BETWEEN fy.FStartDate AND fy.FEndDate`;

    const query = `
      SELECT TOP ${RESULT_LIMIT}
        t.${cfg.idCol} AS Id,
        t.${cfg.docNoCol} AS DocNo,
        t.${cfg.dateCol} AS DocDate,
        ${companyExpr ?? "NULL"} AS CompanyId,
        ${projectExpr ?? "NULL"} AS ProjectId,
        co.name AS CompanyName,
        pr.name AS ProjectName,
        fy.FId AS FinYearId,
        fy.FName AS FinYearName
      FROM ${cfg.table} t
      ${cfg.join || ""}
      LEFT JOIN dbo.enterprise co ON co.id = ${companyExpr ?? "NULL"} AND co.business_type = 'C'
      LEFT JOIN dbo.enterprise pr ON pr.id = ${projectExpr ?? "NULL"} AND pr.business_type = 'P'
      ${finYearJoin}
      ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
      ORDER BY t.${cfg.dateCol} DESC
    `;
    const result = await request.query(query);
    res.json(
      result.recordset.map((r) => ({
        id: r.Id,
        label: r.DocNo,
        date: r.DocDate,
        companyId: r.CompanyId,
        projectId: r.ProjectId,
        company: r.CompanyName,
        project: r.ProjectName,
        finYearId: r.FinYearId,
        finYearName: r.FinYearName,
      })),
    );
  } catch (err) {
    console.error("DOC SELECTOR ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
