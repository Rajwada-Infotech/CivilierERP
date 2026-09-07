"use strict";

/**
 * backend/routes/materialRequests.js
 *
 * Material Request routes — multi-item request model.
 *
 * Document numbering:  MR-YYYY-NNNNN
 *
 * Tables touched:
 *   dbo.MaterialRequests      — header (company, project, fin year, date, priority, reason)
 *   dbo.MaterialRequestItems  — line items (item, uom, qty, remarks)
 *   dbo.DocNumberSequence     — doc number locking
 *
 * Status flow: Draft → Pending → Approved | Rejected
 */

const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const authenticateToken = require("../middleware/auth");
const { bumpCacheVersion } = require("../redis");
const {
  lockNextDocNumber,
  backPatchRecordId,
  resolveDocTypeId,
  previewNextDocNumber,
} = require("../utils/docNumberLock");
const { transition } = require("../services/approvalService");
const { snapshotRow, recordAmendment } = require("../services/amendmentLog");
const { requirePageRight } = require("../middleware/requirePageRight");
const { poExistsForMR } = require("../utils/materialChainGuard");
const {
  getMRItemFulfillment,
  summarize,
} = require("../services/materialRequestFulfillment");

// ── Helpers ───────────────────────────────────────────────────────────────────

const requireUser = (req, res) => {
  const name = req.user?.name || req.user?.email;
  if (!name) {
    res.status(401).json({ error: "User context missing" });
    return null;
  }
  return name;
};

async function ensureTablesExist(pool) {
  // Create MaterialRequests header table if it doesn't exist
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'MaterialRequests')
    CREATE TABLE dbo.MaterialRequests (
      MRId          INT IDENTITY(1,1) PRIMARY KEY,
      DocNo         NVARCHAR(50)   NULL,
      DocTypeId     INT            NULL,
      CompanyId     INT            NULL,
      ProjectId     INT            NULL,
      FinYearId     INT            NULL,
      RequestDate   DATE           NOT NULL DEFAULT GETDATE(),
      RequiredByDate DATE          NULL,
      Priority      NVARCHAR(20)   NOT NULL DEFAULT 'Normal',
      Reason        NVARCHAR(MAX)  NOT NULL,
      Remarks       NVARCHAR(MAX)  NULL,
      Status        NVARCHAR(20)   NOT NULL DEFAULT 'Draft',
      CreatedBy     NVARCHAR(200)  NULL,
      UpdatedBy     NVARCHAR(200)  NULL,
      CreatedAt     DATETIME       NOT NULL DEFAULT GETDATE(),
      UpdatedAt     DATETIME       NOT NULL DEFAULT GETDATE()
    )
  `);

  // Create MaterialRequestItems line-items table if it doesn't exist
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'MaterialRequestItems')
    CREATE TABLE dbo.MaterialRequestItems (
      MRItemId    INT IDENTITY(1,1) PRIMARY KEY,
      MRId        INT            NOT NULL REFERENCES dbo.MaterialRequests(MRId) ON DELETE CASCADE,
      ItemId      NVARCHAR(50)   NOT NULL,
      ItemName    NVARCHAR(200)  NULL,
      UOMCode     NVARCHAR(20)   NULL,
      Quantity    DECIMAL(18,4)  NOT NULL DEFAULT 0,
      Remarks     NVARCHAR(MAX)  NULL
    )
  `);
}

// ── GET /companies ─────────────────────────────────────────────────────────────
router.get("/companies", authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT id, name, short_name
      FROM   dbo.enterprise
      WHERE  business_type = 'C' AND (status IS NULL OR status = 'Active')
      ORDER  BY name
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /projects ──────────────────────────────────────────────────────────────
router.get("/projects", authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT id, name, short_name, company_id
      FROM   dbo.enterprise
      WHERE  business_type = 'P' AND (discontinue = 0 OR discontinue IS NULL)
      ORDER  BY name
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /fin-years ─────────────────────────────────────────────────────────────
router.get("/fin-years", authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT FId AS id, FName AS name, FStartDate AS startDate,
             FEndDate AS endDate, FStatus AS isActive, FisLocked AS isLocked
      FROM   dbo.FinYear
      ORDER  BY FStartDate DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /item-options ──────────────────────────────────────────────────────────
// Optional query param: ?projectId=<id>
// When projectId is supplied the stock calculation is scoped to godowns that
// belong to that project (Godowns.ProjectID = projectId).  When no projectId
// is given — or no matching godown is found — stock is summed across ALL
// godowns (no godown filter) so the item list is never empty.
router.get("/item-options", authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    const requestedProjectId = req.query.projectId
      ? parseInt(req.query.projectId, 10)
      : null;

    // Detect optional columns (same pattern as inventoryMaster.js)
    const [hasUOM, hasGodownCol, hasCreatedDate, hasEntryDate] =
      await Promise.all([
        pool
          .request()
          .query(
            `SELECT COUNT(1) AS cnt FROM sys.columns
             WHERE object_id = OBJECT_ID(N'dbo.Item_Master_Group') AND name = N'M_UOM'`,
          )
          .then((r) => r.recordset[0].cnt > 0),
        pool
          .request()
          .query(
            `SELECT COUNT(1) AS cnt FROM sys.columns
             WHERE object_id = OBJECT_ID(N'dbo.StockLedger') AND name = N'GodownID'`,
          )
          .then((r) => r.recordset[0].cnt > 0),
        pool
          .request()
          .query(
            `SELECT COUNT(1) AS cnt FROM sys.columns
             WHERE object_id = OBJECT_ID(N'dbo.StockLedger') AND name = N'CreatedDate'`,
          )
          .then((r) => r.recordset[0].cnt > 0),
        pool
          .request()
          .query(
            `SELECT COUNT(1) AS cnt FROM sys.columns
             WHERE object_id = OBJECT_ID(N'dbo.StockLedger') AND name = N'EntryDate'`,
          )
          .then((r) => r.recordset[0].cnt > 0),
      ]);

    // Resolve godown filter:
    //  1. If a projectId was given, find all godowns for that project.
    //  2. Fall back to no filter (all godowns) if none found.
    let godownFilter = "";
    if (hasGodownCol && requestedProjectId) {
      try {
        const gdRes = await pool
          .request()
          .input("ProjectID", sql.Int, requestedProjectId)
          .query(
            "SELECT GodownID FROM dbo.Godowns WHERE ProjectID = @ProjectID AND IsDeleted = 0 AND IsActive = 1",
          );
        const ids = gdRes.recordset.map((r) => r.GodownID).filter(Boolean);
        if (ids.length > 0) {
          godownFilter = `AND sl.GodownID IN (${ids.join(",")})`;
        }
        // If ids is empty we intentionally leave godownFilter = "" so all stock
        // is shown — the project may not have a dedicated godown yet.
      } catch {
        /* non-fatal — fall through with no filter */
      }
    }

    // Date expression for the ledger rows (same logic as inventoryMaster.js)
    const ledgerDateExpr =
      hasCreatedDate && hasEntryDate
        ? "COALESCE(sl.CreatedDate, sl.EntryDate)"
        : hasCreatedDate
          ? "sl.CreatedDate"
          : hasEntryDate
            ? "sl.EntryDate"
            : null;

    // Only count ledger rows up to and including today
    const dateFilter = ledgerDateExpr
      ? `AND (${ledgerDateExpr} IS NULL OR CAST(${ledgerDateExpr} AS DATE) <= CAST(GETDATE() AS DATE))`
      : "";

    const result = await pool.request().query(`
      SELECT  img.M_Id,
              img.M_Name,
              img.M_Type,
              grp.M_Name AS M_Group,
              ${hasUOM ? "img.M_UOM AS DefaultUOM," : "NULL AS DefaultUOM,"}
              uom.UOMName  AS DefaultUOMName,
              uom.Symbol   AS DefaultUOMSymbol,
              ISNULL(SUM(CASE WHEN sl.Type = 'IN'  THEN sl.Qty ELSE 0 END), 0)
            - ISNULL(SUM(CASE WHEN sl.Type = 'OUT' THEN sl.Qty ELSE 0 END), 0)
              AS AvailableStock
      FROM    dbo.Item_Master_Group img
      LEFT JOIN dbo.Item_Master_Group grp ON grp.M_Id = img.Parent_Id
      LEFT JOIN dbo.StockLedger sl
        ON  CONVERT(NVARCHAR(50), sl.ItemID) = CONVERT(NVARCHAR(50), img.M_Id)
        ${dateFilter}
        ${godownFilter}
      ${hasUOM ? "LEFT JOIN dbo.UOMMaster uom ON uom.UOMCode = img.M_UOM" : "LEFT JOIN dbo.UOMMaster uom ON 1=0"}
      WHERE (img.Parent_Id IS NOT NULL OR img.M_IdentityCode = 1)
      GROUP BY img.M_Id, img.M_Name, img.M_Type, grp.M_Name
               ${hasUOM ? ", img.M_UOM" : ""},
               uom.UOMName, uom.Symbol
      ORDER BY img.M_Name
    `);

    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /uom-options ───────────────────────────────────────────────────────────
router.get("/uom-options", authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT UOMCode, UOMName, Symbol, IsActive, UOMCategory, BaseFactor
      FROM   dbo.UOMMaster
      ORDER  BY UOMName
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /preview-next-number ───────────────────────────────────────────────────
router.get("/preview-next-number", authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    let dtId = null;
    try {
      dtId = await resolveDocTypeId(pool, sql, "REQ");
    } catch {
      /* no MR doc type configured */
    }
    if (!dtId) return res.json({ nextDocNo: null });
    const preview = await previewNextDocNumber(pool, sql, dtId);
    res.json({ nextDocNo: preview });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET / (list) ───────────────────────────────────────────────────────────────
router.get("/", authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    await ensureTablesExist(pool);

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(500, parseInt(req.query.limit) || 10);
    const offset = (page - 1) * limit;
    const search = req.query.search || "";
    const statusFilter = req.query.status || ""; // exact status filter from dashboard
    const companyId = parseInt(req.query.companyId, 10) || null;

    const request = pool.request();
    request.input("offset", sql.Int, offset);
    request.input("limit", sql.Int, limit);
    request.input("search", sql.NVarChar, `%${search}%`);
    request.input("statusFilter", sql.NVarChar, statusFilter);
    request.input("companyId", sql.Int, companyId);

    const result = await request.query(`
      SELECT
        mr.MRId, mr.DocNo, mr.Status, mr.Priority,
        mr.RequestDate, mr.RequiredByDate,
        mr.Reason, mr.Remarks, mr.CreatedBy, mr.CreatedAt,
        ec.name  AS CompanyName,
        ep.name  AS ProjectName,
        fy.FName AS FinYearName,
        COUNT(mri.MRItemId)      AS ItemCount,
        SUM(mri.Quantity)        AS TotalQty,
        COUNT(*)  OVER ()        AS _total
      FROM       dbo.MaterialRequests mr WITH (NOLOCK)
      LEFT JOIN  dbo.enterprise  ec  WITH (NOLOCK) ON ec.id  = mr.CompanyId
      LEFT JOIN  dbo.enterprise  ep  WITH (NOLOCK) ON ep.id  = mr.ProjectId
      LEFT JOIN  dbo.FinYear     fy  WITH (NOLOCK) ON fy.FId = mr.FinYearId
      LEFT JOIN  dbo.MaterialRequestItems mri WITH (NOLOCK) ON mri.MRId = mr.MRId
      WHERE (@search = '%%' OR mr.DocNo LIKE @search OR ec.name LIKE @search OR mr.Status LIKE @search)
        AND (@statusFilter = '' OR mr.Status = @statusFilter)
        AND (@companyId IS NULL OR mr.CompanyId = @companyId)
      GROUP BY mr.MRId, mr.DocNo, mr.Status, mr.Priority,
               mr.RequestDate, mr.RequiredByDate,
               mr.Reason, mr.Remarks, mr.CreatedBy, mr.CreatedAt,
               ec.name, ep.name, fy.FName
      ORDER BY mr.CreatedAt DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);

    const total = result.recordset[0]?._total ?? 0;
    const data = result.recordset.map(({ _total, ...row }) => row);
    res.json({
      data,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /approved-list ────────────────────────────────────────────────────────
// Returns a lightweight list of all Approved MRs for use in dropdown pickers.
// Optional query params: ?companyId=<id>&projectId=<id>
router.get("/approved-list", authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    const request = pool.request();
    const conditions = [
      "mr.Status IN ('Approved', 'Partially Fulfilled')",
      "mr.DocNo IS NOT NULL",
    ];

    if (req.query.companyId) {
      conditions.push("mr.CompanyId = @companyId");
      request.input("companyId", sql.Int, parseInt(req.query.companyId, 10));
    }
    if (req.query.projectId) {
      conditions.push("mr.ProjectId = @projectId");
      request.input("projectId", sql.Int, parseInt(req.query.projectId, 10));
    }
    if (req.query.finYearId) {
      conditions.push("mr.FinYearId = @finYearId");
      request.input("finYearId", sql.Int, parseInt(req.query.finYearId, 10));
    }

    const result = await request.query(`
      SELECT
        mr.MRId, mr.DocNo, mr.FinYearId,
        mr.CompanyId, mr.ProjectId,
        fy.FName  AS FinYearName,
        ec.name   AS CompanyName,
        ep.name   AS ProjectName
      FROM      dbo.MaterialRequests mr
      LEFT JOIN dbo.FinYear    fy ON fy.FId = mr.FinYearId
      LEFT JOIN dbo.enterprise ec ON ec.id  = mr.CompanyId
      LEFT JOIN dbo.enterprise ep ON ep.id  = mr.ProjectId
      WHERE ${conditions.join(" AND ")}
      ORDER BY mr.CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /by-docno/:docNo ───────────────────────────────────────────────────────
// Look up an Approved MR by its document number and return PO prefill data.
// Used by the PO form's "Load from MR" input.
router.get("/by-docno/:docNo", authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    const docNo = (req.params.docNo || "").trim().toUpperCase();
    if (!docNo) return res.status(400).json({ error: "docNo is required" });

    const lookup = await pool.request().input("docNo", sql.NVarChar(50), docNo)
      .query(`
        SELECT mr.MRId
        FROM   dbo.MaterialRequests mr
        WHERE  UPPER(mr.DocNo) = @docNo
      `);

    if (!lookup.recordset.length)
      return res.status(404).json({
        error: `No Material Request found with doc number "${docNo}"`,
      });

    const mrId = lookup.recordset[0].MRId;

    const header = await pool.request().input("id", sql.Int, mrId).query(`
        SELECT
          mr.MRId, mr.DocNo, mr.Status,
          mr.CompanyId, e_co.name  AS CompanyName,
          mr.ProjectId, e_pr.name  AS ProjectName,
          mr.FinYearId,
          mr.Remarks
        FROM dbo.MaterialRequests mr
        LEFT JOIN dbo.enterprise      e_co ON e_co.id = mr.CompanyId
        LEFT JOIN dbo.enterprise      e_pr ON e_pr.id = mr.ProjectId
        WHERE mr.MRId = @id
      `);

    if (!header.recordset.length)
      return res.status(404).json({ error: "Material Request not found" });

    const mr = header.recordset[0];
    if (!["Approved", "Partially Fulfilled"].includes(mr.Status))
      return res.status(400).json({
        error: `MR is ${mr.Status}. Only Approved or Partially Fulfilled MRs can generate a Normal PO.`,
      });

    const items = await pool.request().input("id", sql.Int, mrId).query(`
        SELECT
          mri.MRItemId,
          mri.ItemId,
          mri.ItemName,
          mri.UOMCode,
          u.UOMName,
          mri.Quantity,
          mri.Remarks,
          im.M_CGST,
          im.M_SGST,
          im.M_IGST
        FROM dbo.MaterialRequestItems mri
        LEFT JOIN dbo.UOMMaster  u  ON u.UOMCode = mri.UOMCode
        LEFT JOIN dbo.Item_Master_Group im ON CONVERT(NVARCHAR(50), im.M_Id) = CONVERT(NVARCHAR(50), mri.ItemId)
        WHERE mri.MRId = @id
      `);

    const fulfillment = await getMRItemFulfillment(pool, mrId);
    const pendingByItem = new Map(fulfillment.map((f) => [f.MRItemId, f]));
    const itemsWithPending = items.recordset
      .map((it) => {
        const f = pendingByItem.get(it.MRItemId);
        return {
          ...it,
          OrderedQty: f?.OrderedQty ?? 0,
          PendingQty: f ? f.PendingQty : it.Quantity,
        };
      })
      .filter((it) => it.PendingQty > 0);

    res.json({
      MRId: mr.MRId,
      DocNo: mr.DocNo,
      CompanyId: mr.CompanyId,
      CompanyName: mr.CompanyName,
      ProjectId: mr.ProjectId,
      ProjectName: mr.ProjectName,
      FinYearId: mr.FinYearId,
      Remarks: mr.Remarks,
      items: itemsWithPending,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /pending-summary ──────────────────────────────────────────────────────
// Bulk per-MR requested/ordered/pending totals for every MR that's reached
// the fulfillment lifecycle (Approved/Partially Fulfilled/Completed) — powers
// the pill in the MR list without an N+1 fetch per row.
// Must be registered before "/:id" — otherwise Express matches "/:id" first
// with id="pending-summary" and this never gets hit.
router.get("/pending-summary", authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT
        mri.MRId,
        SUM(mri.Quantity) AS TotalRequested,
        SUM(ISNULL((
          SELECT SUM(poi.Quantity)
          FROM dbo.PurchaseOrderItems poi
          JOIN dbo.PurchaseOrders po ON po.PurchaseOrderID = poi.PurchaseOrderID
          WHERE poi.MRItemId = mri.MRItemId
            AND ISNULL(po.Status, '') NOT IN ('Deleted', 'Rejected')
        ), 0)) AS TotalOrdered
      FROM dbo.MaterialRequestItems mri
      JOIN dbo.MaterialRequests mr ON mr.MRId = mri.MRId
      WHERE mr.Status IN ('Approved', 'Partially Fulfilled', 'Completed')
      GROUP BY mri.MRId
    `);
    res.json(
      result.recordset.map((r) => {
        const requested = Number(r.TotalRequested) || 0;
        const ordered = Math.min(Number(r.TotalOrdered) || 0, requested);
        return {
          MRId: r.MRId,
          totalRequested: requested,
          totalOrdered: ordered,
          totalPending: Math.max(0, requested - ordered),
        };
      }),
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /pending-report ───────────────────────────────────────────────────────
// One row per outstanding MR line item — powers the "Pending MR Report".
// Only MRs still in the fulfillment lifecycle with something left to order
// (Approved / Partially Fulfilled, PendingQty > 0) are included; Draft,
// Pending-approval, Rejected, and fully Completed MRs never appear.
// Must be registered before "/:id" — same route-ordering requirement as
// the other literal-path GETs above.
router.get("/pending-report", authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    const request = pool.request();
    const conditions = [
      "mr.Status IN ('Approved', 'Partially Fulfilled')",
    ];

    if (req.query.companyId) {
      conditions.push("mr.CompanyId = @companyId");
      request.input("companyId", sql.Int, parseInt(req.query.companyId, 10));
    }
    if (req.query.projectId) {
      conditions.push("mr.ProjectId = @projectId");
      request.input("projectId", sql.Int, parseInt(req.query.projectId, 10));
    }
    if (req.query.requestor) {
      conditions.push("mr.CreatedBy LIKE @requestor");
      request.input("requestor", sql.NVarChar(200), `%${req.query.requestor}%`);
    }
    if (req.query.docNo) {
      conditions.push("mr.DocNo LIKE @docNo");
      request.input("docNo", sql.NVarChar(100), `%${req.query.docNo}%`);
    }
    if (req.query.dateFrom) {
      conditions.push("mr.RequestDate >= @dateFrom");
      request.input("dateFrom", sql.Date, req.query.dateFrom);
    }
    if (req.query.dateTo) {
      conditions.push("mr.RequestDate <= @dateTo");
      request.input("dateTo", sql.Date, req.query.dateTo);
    }

    const result = await request.query(`
      SELECT
        mr.MRId, mr.DocNo, mr.RequestDate, mr.Status, mr.CreatedBy,
        ec.name AS CompanyName, ep.name AS ProjectName,
        mri.MRItemId, mri.ItemName, mri.UOMCode, mri.Quantity AS RequestedQty,
        ISNULL((
          SELECT SUM(poi.Quantity)
          FROM dbo.PurchaseOrderItems poi
          JOIN dbo.PurchaseOrders po ON po.PurchaseOrderID = poi.PurchaseOrderID
          WHERE poi.MRItemId = mri.MRItemId
            AND ISNULL(po.Status, '') NOT IN ('Deleted', 'Rejected')
        ), 0) AS OrderedQty,
        (
          SELECT STRING_AGG(po2.DocNo, ', ')
          FROM dbo.PurchaseOrders po2
          WHERE po2.SourceMRId = mr.MRId
            AND ISNULL(po2.Status, '') NOT IN ('Deleted', 'Rejected')
        ) AS LinkedPOs
      FROM dbo.MaterialRequests mr
      JOIN dbo.MaterialRequestItems mri ON mri.MRId = mr.MRId
      LEFT JOIN dbo.enterprise ec ON ec.id = mr.CompanyId
      LEFT JOIN dbo.enterprise ep ON ep.id = mr.ProjectId
      WHERE ${conditions.join(" AND ")}
      ORDER BY mr.MRId DESC, mri.MRItemId ASC
    `);

    const rows = result.recordset
      .map((r) => {
        const requested = Number(r.RequestedQty) || 0;
        const ordered = Math.min(Number(r.OrderedQty) || 0, requested);
        return {
          MRId: r.MRId,
          DocNo: r.DocNo,
          RequestDate: r.RequestDate,
          Status: r.Status,
          Requestor: r.CreatedBy,
          CompanyName: r.CompanyName,
          ProjectName: r.ProjectName,
          ItemName: r.ItemName,
          UOMCode: r.UOMCode,
          RequestedQty: requested,
          FulfilledQty: ordered,
          PendingQty: Math.max(0, requested - ordered),
          LinkedPOs: r.LinkedPOs || "",
        };
      })
      .filter((r) => r.PendingQty > 0);

    if (req.query.status) {
      const statusFilter = String(req.query.status).toLowerCase();
      res.json(rows.filter((r) => r.Status.toLowerCase() === statusFilter));
      return;
    }
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:id ───────────────────────────────────────────────────────────────────
router.get("/:id", authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    await ensureTablesExist(pool);

    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const hdr = await pool.request().input("id", sql.Int, id).query(`
        SELECT mr.*, ec.name AS CompanyName, ep.name AS ProjectName, fy.FName AS FinYearName
        FROM   dbo.MaterialRequests mr
        LEFT JOIN dbo.enterprise ec ON ec.id  = mr.CompanyId
        LEFT JOIN dbo.enterprise ep ON ep.id  = mr.ProjectId
        LEFT JOIN dbo.FinYear    fy ON fy.FId = mr.FinYearId
        WHERE mr.MRId = @id
      `);

    if (!hdr.recordset.length)
      return res.status(404).json({ error: "Not found" });

    const items = await pool.request().input("id", sql.Int, id).query(`
        SELECT mri.*, u.UOMName, u.Symbol AS UOMSymbol
        FROM   dbo.MaterialRequestItems mri
        LEFT JOIN dbo.UOMMaster u ON u.UOMCode = mri.UOMCode
        WHERE  mri.MRId = @id
        ORDER  BY mri.MRItemId
      `);

    res.json({ ...hdr.recordset[0], items: items.recordset });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST / ─────────────────────────────────────────────────────────────────────
router.post("/", authenticateToken, requirePageRight("material-request", "create"), async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;

  try {
    const pool = getPool();
    await ensureTablesExist(pool);

    const {
      CompanyId,
      ProjectId,
      FinYearId,
      RequestDate,
      RequiredByDate,
      Priority = "Normal",
      Reason,
      Remarks,
      DocTypeId: clientDocTypeId,
      items = [],
    } = req.body;

    if (!Reason?.trim())
      return res.status(400).json({ error: "Reason is required" });
    if (!items.length)
      return res.status(400).json({ error: "At least one item required" });

    let dtId = clientDocTypeId ? parseInt(clientDocTypeId, 10) : null;
    if (!dtId) {
      try {
        dtId = await resolveDocTypeId(pool, sql, "REQ");
      } catch {
        /* no MR doc type — proceed without numbering */
      }
    }
    let lockedDocNo = null;
    if (dtId) {
      try {
        lockedDocNo = await lockNextDocNumber(pool, sql, {
          docTypeId: dtId,
          tableName: "MaterialRequests",
          docNoColumn: "DocNo",
          issuedBy: user,
        });
      } catch (lockErr) {
        // numbering failed — save without doc number rather than aborting
        lockedDocNo = null;
      }
    }

    // Header + items must be one atomic unit — previously each ran on the
    // plain pool (auto-committing individually), so a failure partway
    // through the item loop (bad ItemId, transient connection blip, etc.)
    // left a MaterialRequests header permanently committed with only some
    // of its intended items, and no rollback to clean it up. Found during
    // a systematic pass over multi-step write routes.
    const tx = pool.transaction();
    await tx.begin();
    let newId;
    try {
      const insertHdr = await tx
        .request()
        .input("CompanyId", sql.Int, CompanyId || null)
        .input("ProjectId", sql.Int, ProjectId || null)
        .input("FinYearId", sql.Int, FinYearId || null)
        .input("RequestDate", sql.Date, RequestDate || new Date())
        .input("RequiredByDate", sql.Date, RequiredByDate || null)
        .input("Priority", sql.NVarChar(20), Priority)
        .input("Reason", sql.NVarChar(sql.MAX), Reason)
        .input("Remarks", sql.NVarChar(sql.MAX), Remarks || null)
        .input("DocTypeId", sql.Int, dtId || null)
        .input("DocNo", sql.NVarChar(50), lockedDocNo || null)
        .input("CreatedBy", sql.NVarChar(200), user).query(`
          INSERT INTO dbo.MaterialRequests
            (CompanyId, ProjectId, FinYearId, RequestDate, RequiredByDate,
             Priority, Reason, Remarks, Status, DocTypeId, DocNo, CreatedBy, UpdatedBy)
          OUTPUT INSERTED.MRId
          VALUES (@CompanyId, @ProjectId, @FinYearId, @RequestDate, @RequiredByDate,
                  @Priority, @Reason, @Remarks, 'Draft', @DocTypeId, @DocNo, @CreatedBy, @CreatedBy)
        `);

      newId = insertHdr.recordset[0].MRId;

      for (const item of items) {
        await tx
          .request()
          .input("MRId", sql.Int, newId)
          .input("ItemId", sql.NVarChar(50), String(item.ItemId))
          .input("ItemName", sql.NVarChar(200), item.ItemName || null)
          .input("UOMCode", sql.NVarChar(20), item.UOMCode || null)
          .input("Quantity", sql.Decimal(18, 4), parseFloat(item.Quantity) || 0)
          .input("Remarks", sql.NVarChar(sql.MAX), item.Remarks || null).query(`
            INSERT INTO dbo.MaterialRequestItems (MRId, ItemId, ItemName, UOMCode, Quantity, Remarks)
            VALUES (@MRId, @ItemId, @ItemName, @UOMCode, @Quantity, @Remarks)
          `);
      }

      await tx.commit();
    } catch (txErr) {
      try {
        await tx.rollback();
      } catch {
        /* best-effort — original error is what propagates */
      }
      throw txErr;
    }

    // Record the RecordId back in DocNumberSequence for lineage tracing —
    // best-effort, after commit, matching the pattern used elsewhere
    // (grns.js, materialIssues.js): a failure here shouldn't roll back an
    // already-successful, fully-committed material request.
    if (lockedDocNo) {
      await backPatchRecordId(
        pool,
        sql,
        lockedDocNo,
        "MaterialRequests",
        newId,
      );
    }

    await bumpCacheVersion("material-requests");

    // Auto-submit: transition Draft → Pending immediately so no manual
    // "Submit" step is required after creation.
    try {
      await transition(
        "material-requests",
        newId,
        "Pending",
        req.user?.email || user,
        req.user?.role,
      );
    } catch (submitErr) {
      // Non-fatal — record is saved; log and continue.
      console.warn("MR auto-submit failed (non-fatal):", submitErr.message);
    }

    const created = await pool
      .request()
      .input("id", sql.Int, newId)
      .query("SELECT DocNo, Status FROM dbo.MaterialRequests WHERE MRId = @id");

    res.status(201).json({
      MRId: newId,
      DocNo: created.recordset[0]?.DocNo,
      Status: created.recordset[0]?.Status,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /:id ───────────────────────────────────────────────────────────────────
router.put("/:id", authenticateToken, requirePageRight("material-request", "edit"), async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;

  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const {
      CompanyId,
      ProjectId,
      FinYearId,
      RequestDate,
      RequiredByDate,
      Priority = "Normal",
      Reason,
      Remarks,
      Status,
      items = [],
    } = req.body;

    // Guard against editing a Pending/Rejected MR — Draft is normal editing,
    // Approved is allowed too (logged as an amendment below) so an approved
    // request doesn't become permanently frozen.
    const statusCheck = await pool
      .request()
      .input("id", sql.Int, id)
      .query("SELECT Status FROM dbo.MaterialRequests WHERE MRId=@id");
    if (!statusCheck.recordset.length)
      return res.status(404).json({ error: "Not found" });
    const currentMRStatus = statusCheck.recordset[0].Status;
    if (!["Draft", "Approved"].includes(currentMRStatus))
      return res.status(409).json({
        error: `Cannot edit a Material Request with status "${currentMRStatus}". Only Draft or Approved requests can be edited.`,
      });
    const wasApproved = currentMRStatus === "Approved";
    const beforeSnapshot = wasApproved
      ? await snapshotRow(pool, "dbo.MaterialRequests", "MRId", id)
      : null;

    // Chain guard: a Purchase Order already raised against this MR must be
    // deleted first — editing quantities/items here after a PO exists would
    // silently drift the MR out of sync with what the PO already locked in.
    const blockingPO = await poExistsForMR(pool, id);
    if (blockingPO)
      return res.status(409).json({
        error: `Cannot edit: ${blockingPO} is linked to this Material Request. Delete it first, then edit the request.`,
      });

    // Header update + item replacement must be one atomic unit — previously
    // each ran on the plain pool (auto-committing individually). The item
    // replacement in particular DELETEs all existing items before
    // re-inserting the new set, so a failure partway through the insert
    // loop used to leave the request with neither its old nor its complete
    // new items — active data loss, not just a missing-items gap. Found
    // during a systematic pass over multi-step write routes.
    const tx = pool.transaction();
    await tx.begin();
    try {
      const updateResult = await tx
        .request()
        .input("id", sql.Int, id)
        .input("CompanyId", sql.Int, CompanyId || null)
        .input("ProjectId", sql.Int, ProjectId || null)
        .input("FinYearId", sql.Int, FinYearId || null)
        .input("RequestDate", sql.Date, RequestDate || new Date())
        .input("RequiredByDate", sql.Date, RequiredByDate || null)
        .input("Priority", sql.NVarChar(20), Priority)
        .input("Reason", sql.NVarChar(sql.MAX), Reason)
        .input("Remarks", sql.NVarChar(sql.MAX), Remarks || null)
        // The edit form never actually sends Status back (it only edits
        // header/item fields), so this must preserve whatever status the
        // record already has via COALESCE rather than overwrite it — an
        // unconditional overwrite would silently revert an Approved
        // request to Draft on every post-approval edit.
        .input("Status", sql.NVarChar(20), Status || null)
        .input("UpdatedBy", sql.NVarChar(200), user).query(`
          UPDATE dbo.MaterialRequests
          SET CompanyId=@CompanyId, ProjectId=@ProjectId, FinYearId=@FinYearId,
              RequestDate=@RequestDate, RequiredByDate=@RequiredByDate,
              Priority=@Priority, Reason=@Reason, Remarks=@Remarks,
              Status=COALESCE(@Status, Status), UpdatedBy=@UpdatedBy, UpdatedAt=GETDATE()
          WHERE MRId=@id AND Status IN ('Draft', 'Approved')
        `);

      // Race-condition guard: if another request approved/submitted this MR
      // between our status check and the UPDATE, rowsAffected will be 0.
      if (updateResult.rowsAffected[0] === 0) {
        await tx.rollback();
        return res.status(409).json({
          error:
            "Update failed: the request status changed before the update could be applied.",
        });
      }

      // Replace items
      await tx
        .request()
        .input("id", sql.Int, id)
        .query("DELETE FROM dbo.MaterialRequestItems WHERE MRId=@id");

      for (const item of items) {
        await tx
          .request()
          .input("MRId", sql.Int, id)
          .input("ItemId", sql.NVarChar(50), String(item.ItemId))
          .input("ItemName", sql.NVarChar(200), item.ItemName || null)
          .input("UOMCode", sql.NVarChar(20), item.UOMCode || null)
          .input("Quantity", sql.Decimal(18, 4), parseFloat(item.Quantity) || 0)
          .input("Remarks", sql.NVarChar(sql.MAX), item.Remarks || null).query(`
            INSERT INTO dbo.MaterialRequestItems (MRId, ItemId, ItemName, UOMCode, Quantity, Remarks)
            VALUES (@MRId, @ItemId, @ItemName, @UOMCode, @Quantity, @Remarks)
          `);
      }

      await tx.commit();
    } catch (txErr) {
      try {
        await tx.rollback();
      } catch {
        /* best-effort — original error is what propagates */
      }
      throw txErr;
    }

    await bumpCacheVersion("material-requests");

    if (wasApproved && beforeSnapshot) {
      try {
        const afterSnapshot = await snapshotRow(pool, "dbo.MaterialRequests", "MRId", id);
        await recordAmendment({
          refDocType: "material-request",
          refDocId: id,
          refDocNo: afterSnapshot?.DocNo || beforeSnapshot.DocNo,
          projectName: null,
          companyName: null,
          changedBy: user,
          before: beforeSnapshot,
          after: afterSnapshot,
        });
      } catch (logErr) {
        console.error("Amendment log error (material-request):", logErr.message);
      }
    }

    res.json({ message: "Material request updated" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /:id ────────────────────────────────────────────────────────────────
router.delete("/:id", authenticateToken, requirePageRight("material-request", "delete"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    // Check status — only Draft can be deleted
    const check = await pool
      .request()
      .input("id", sql.Int, id)
      .query("SELECT Status FROM dbo.MaterialRequests WHERE MRId=@id");
    if (!check.recordset.length)
      return res.status(404).json({ error: "Not found" });

    // Block deletion if a PO has been raised against this MR
    const poCheck = await pool
      .request()
      .input("id", sql.Int, id)
      .query(
        "SELECT TOP 1 DocNo FROM dbo.PurchaseOrders WHERE SourceMRId = @id",
      );
    if (poCheck.recordset.length)
      return res.status(409).json({
        error: `Cannot delete: Purchase Order ${poCheck.recordset[0].DocNo} is linked to this Material Request.`,
      });

    await pool
      .request()
      .input("id", sql.Int, id)
      .query("DELETE FROM dbo.MaterialRequests WHERE MRId=@id");

    await bumpCacheVersion("material-requests");
    res.json({ message: "Material request deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /:id/submit ────────────────────────────────────────────────────────────
router.put("/:id/submit", authenticateToken, requirePageRight("material-request", "edit"), async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    await pool
      .request()
      .input("id", sql.Int, id)
      .input("user", sql.NVarChar(200), user)
      .query(
        `UPDATE dbo.MaterialRequests SET Status='Pending', UpdatedBy=@user, UpdatedAt=GETDATE() WHERE MRId=@id AND Status='Draft'`,
      );
    await bumpCacheVersion("material-requests");
    res.json({ message: "Submitted for approval" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:id/create-po-prefill ─────────────────────────────────────────────────
// Returns MR header + items shaped for the PO form.
// Only Approved MRs can generate a Normal PO.
router.get("/:id/create-po-prefill", authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const header = await pool.request().input("id", sql.Int, id).query(`
        SELECT
          mr.MRId, mr.DocNo, mr.Status,
          mr.CompanyId, e_co.name  AS CompanyName,
          mr.ProjectId, e_pr.name  AS ProjectName,
          mr.FinYearId, fy.FName AS FinYearName,
          mr.Remarks
        FROM dbo.MaterialRequests mr
        LEFT JOIN dbo.enterprise      e_co ON e_co.id = mr.CompanyId
        LEFT JOIN dbo.enterprise      e_pr ON e_pr.id = mr.ProjectId
        LEFT JOIN dbo.FinYear         fy   ON fy.FId = mr.FinYearId
        WHERE mr.MRId = @id
      `);

    if (!header.recordset.length)
      return res.status(404).json({ error: "Material Request not found" });

    const mr = header.recordset[0];
    if (!["Approved", "Partially Fulfilled"].includes(mr.Status))
      return res.status(400).json({
        error: `MR is ${mr.Status}. Only Approved or Partially Fulfilled MRs can generate a Normal PO.`,
      });

    const items = await pool.request().input("id", sql.Int, id).query(`
        SELECT
          mri.MRItemId,
          mri.ItemId,
          mri.ItemName,
          mri.UOMCode,
          u.UOMName,
          mri.Quantity,
          mri.Remarks,
          im.M_CGST,
          im.M_SGST,
          im.M_IGST
        FROM dbo.MaterialRequestItems mri
        LEFT JOIN dbo.UOMMaster  u  ON u.UOMCode = mri.UOMCode
        LEFT JOIN dbo.Item_Master_Group im ON CONVERT(NVARCHAR(50), im.M_Id) = CONVERT(NVARCHAR(50), mri.ItemId)
        WHERE mri.MRId = @id
      `);

    const fulfillment = await getMRItemFulfillment(pool, id);
    const pendingByItem = new Map(fulfillment.map((f) => [f.MRItemId, f]));
    const itemsWithPending = items.recordset
      .map((it) => {
        const f = pendingByItem.get(it.MRItemId);
        return {
          ...it,
          OrderedQty: f?.OrderedQty ?? 0,
          PendingQty: f ? f.PendingQty : it.Quantity,
        };
      })
      .filter((it) => it.PendingQty > 0);

    res.json({
      MRId: mr.MRId,
      DocNo: mr.DocNo,
      CompanyId: mr.CompanyId,
      CompanyName: mr.CompanyName,
      ProjectId: mr.ProjectId,
      ProjectName: mr.ProjectName,
      FinYearId: mr.FinYearId,
      FinYearName: mr.FinYearName,
      Remarks: mr.Remarks,
      items: itemsWithPending,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:id/pending-summary ──────────────────────────────────────────────────
// Per-item requested/ordered/pending quantities for a single MR — powers the
// "Pending - N Qty" pill and the item-level fulfillment breakdown on the MR
// detail page. Read-only — doesn't touch Status.
router.get("/:id/pending-summary", authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const items = await getMRItemFulfillment(pool, id);
    const totals = summarize(items);
    res.json({ MRId: id, items, ...totals });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:id/linked-pos ────────────────────────────────────────────────────────
// Every Purchase Order raised against this MR, newest first, each annotated
// with the MR's overall remaining balance immediately AFTER that PO was
// created — same "audit trail" pattern as GRN ↔ Vehicle In/Out.
router.get("/:id/linked-pos", authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const totalReqRes = await pool.request().input("MRId", sql.Int, id).query(
      "SELECT ISNULL(SUM(Quantity), 0) AS TotalRequested FROM dbo.MaterialRequestItems WHERE MRId = @MRId",
    );
    const totalRequested = Number(totalReqRes.recordset[0]?.TotalRequested) || 0;

    const poRes = await pool.request().input("MRId", sql.Int, id).query(`
      SELECT
        po.PurchaseOrderID, po.PurchaseOrderNo, po.DocNo, po.PODate, po.Status,
        ISNULL(SUM(poi.Quantity), 0) AS OrderedQty
      FROM dbo.PurchaseOrders po
      LEFT JOIN dbo.PurchaseOrderItems poi
        ON poi.PurchaseOrderID = po.PurchaseOrderID AND poi.MRItemId IS NOT NULL
      WHERE po.SourceMRId = @MRId
      GROUP BY po.PurchaseOrderID, po.PurchaseOrderNo, po.DocNo, po.PODate, po.Status
      ORDER BY po.PurchaseOrderID ASC
    `);

    let cumulativeOrdered = 0;
    const ascending = poRes.recordset.map((r) => {
      const isVoid = ["Deleted", "Rejected"].includes(r.Status);
      if (!isVoid) cumulativeOrdered += Number(r.OrderedQty) || 0;
      return {
        purchaseOrderId: r.PurchaseOrderID,
        poNumber: r.DocNo || r.PurchaseOrderNo,
        date: r.PODate,
        status: r.Status,
        orderedQty: Number(r.OrderedQty) || 0,
        remainingQtyAfter: Math.max(0, totalRequested - cumulativeOrdered),
      };
    });

    res.json(ascending.reverse());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /:id/approve ──────────────────────────────────────────────────────────
router.put("/:id/approve", authenticateToken, async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const result = await transition(
      "material-requests",
      id,
      "Approved",
      user,
      req.user?.role,
    );
    await bumpCacheVersion("material-requests");
    res.json({ message: "Material Request approved", ...result });
  } catch (err) {
    res
      .status(err.message.includes("not authorized") ? 403 : 400)
      .json({ error: err.message });
  }
});

// ── PUT /:id/reject ───────────────────────────────────────────────────────────
router.put("/:id/reject", authenticateToken, async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const { note } = req.body;
    const result = await transition(
      "material-requests",
      id,
      "Rejected",
      user,
      req.user?.role,
      note || null,
    );
    await bumpCacheVersion("material-requests");
    res.json({ message: "Material Request rejected", ...result });
  } catch (err) {
    res
      .status(err.message.includes("not authorized") ? 403 : 400)
      .json({ error: err.message });
  }
});

// ── PUT /:id/mark-ordered ──────────────────────────────────────────────────────
// Called by the PO creation flow after a Normal PO is saved against this MR.
router.put("/:id/mark-ordered", authenticateToken, requirePageRight("material-request", "edit"), async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    // Idempotent: Approved → Ordered; Partially Ordered → Ordered
    await pool
      .request()
      .input("id", sql.Int, id)
      .input("user", sql.NVarChar(200), user).query(`
        UPDATE dbo.MaterialRequests
        SET    Status = 'Ordered', UpdatedBy = @user, UpdatedAt = GETDATE()
        WHERE  MRId = @id AND Status IN ('Approved', 'Partially Ordered')
      `);

    await bumpCacheVersion("material-requests");
    res.json({ message: "MR marked as Ordered" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
