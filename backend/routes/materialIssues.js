"use strict";

/**
 * backend/routes/materialIssues.js
 *
 * Material / Stock Issue routes — multi-item cart model.
 *
 * Document numbering:
 *   Normal issue  →  ISS-YYYY-NNNNN
 *   Under ExB     →  ExB-ISS-YYYY-NNNNN
 *
 * Tables touched:
 *   dbo.MaterialIssues       — header (company, project, fin year, date, reason)
 *   dbo.MaterialIssueItems   — line items (item, uom, qty, per-line remarks)
 *   dbo.StockLedger          — one OUT row per line item on create
 *   dbo.DocNumberSequence    — doc number locking
 */

const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const authenticateToken = require("../middleware/auth");
const rateLimit = require("express-rate-limit");
const routeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, message: { error: "Too many requests, please try again later." } });
router.use(routeLimiter);
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const { transition } = require("../services/approvalService");
const { requirePageRight } = require("../middleware/requirePageRight");
const {
  lockNextDocNumber,
  backPatchRecordId,
  resolveDocTypeId,
  previewNextDocNumber,
} = require("../utils/docNumberLock");

// ── helpers ───────────────────────────────────────────────────────────────────

async function resolveIssueDocTypeId(pool, rootExBDocNo) {
  const prefix = rootExBDocNo ? "ExB-ISS" : "ISS";
  return resolveDocTypeId(pool, sql, prefix);
}

async function resolveMainGodownId(pool) {
  try {
    const res = await pool
      .request()
      .query(
        "SELECT TOP 1 GodownID FROM dbo.Godowns WHERE IsMain = 1 AND IsDeleted = 0 ORDER BY GodownID",
      );
    return res.recordset[0]?.GodownID || null;
  } catch {
    return null;
  }
}

// ── GET /companies ────────────────────────────────────────────────────────────
router.get("/companies", authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT id, name, short_name
      FROM   dbo.enterprise
      WHERE  business_type = 'E' AND (status IS NULL OR status = 'Active')
      ORDER  BY name
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /projects ─────────────────────────────────────────────────────────────
router.get("/projects", authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT id, name, short_name, company_id, belongs_to
      FROM   dbo.enterprise
      WHERE  business_type = 'P' AND (discontinue = 0 OR discontinue IS NULL)
      ORDER  BY name
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /fin-years ────────────────────────────────────────────────────────────
router.get("/fin-years", authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT FId AS id, FName AS name, FStartDate AS startDate, FEndDate AS endDate,
             FStatus AS isActive, FisLocked AS isLocked
      FROM   dbo.FinYear
      ORDER  BY FStartDate DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /godowns ──────────────────────────────────────────────────────────────
router.get("/godowns", authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT GodownID AS id, GodownName AS name, GodownCode AS code,
             ShortDesc AS shortDesc, IsMain AS isMain,
             EnterpriseID AS companyId, ProjectID AS projectId
      FROM   dbo.Godowns
      WHERE  IsDeleted = 0
      ORDER  BY IsMain DESC, GodownName
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch godowns" });
  }
});

// ── GET /item-options ─────────────────────────────────────────────────────────
// Optional ?godownId=N filters stock to that godown only.
router.get("/item-options", authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    const godownId = req.query.godownId
      ? parseInt(req.query.godownId, 10)
      : null;

    const colCheck = await pool.request().query(`
      SELECT COUNT(1) AS cnt FROM sys.columns
      WHERE object_id = OBJECT_ID(N'dbo.Item_Master_Group') AND name = N'M_UOM'
    `);
    const hasUOM = colCheck.recordset[0].cnt > 0;

    const req2 = pool.request();
    const godownFilter = godownId
      ? (req2.input("GodownID", sql.Int, godownId),
        "AND sl.GodownID = @GodownID")
      : "";

    const result = await req2.query(`
      SELECT img.M_Id, img.M_Name, img.M_Group,
             ISNULL(SUM(CASE WHEN sl.Type='IN'  THEN sl.Qty ELSE 0 END), 0)
           - ISNULL(SUM(CASE WHEN sl.Type='OUT' THEN sl.Qty ELSE 0 END), 0)
             AS AvailableStock,
             -- Resolve DefaultUOM to a valid UOMCode.
             -- StockLedger.UOM can be a display name (e.g. "Bag") not a code.
             -- Try: 1) exact UOMCode match, 2) UOMName match, 3) item master M_UOM
             COALESCE(
               (SELECT TOP 1 u.UOMCode FROM dbo.UOMMaster u
                WHERE u.UOMCode = MAX(sl.UOM) AND MAX(sl.UOM) IS NOT NULL AND MAX(sl.UOM) <> ''),
               (SELECT TOP 1 u.UOMCode FROM dbo.UOMMaster u
                WHERE u.UOMName = MAX(sl.UOM) AND MAX(sl.UOM) IS NOT NULL AND MAX(sl.UOM) <> ''),
               ${
                 hasUOM
                   ? `(SELECT TOP 1 u.UOMCode FROM dbo.UOMMaster u
                WHERE u.UOMCode = img.M_UOM OR u.UOMName = img.M_UOM)`
                   : "NULL"
               }
             ) AS DefaultUOM
      FROM   dbo.Item_Master_Group img
      LEFT JOIN dbo.StockLedger sl
        ON  CONVERT(NVARCHAR(50), sl.ItemID) = CONVERT(NVARCHAR(50), img.M_Id)
        ${godownFilter}
      WHERE  (img.Parent_Id IS NOT NULL OR img.M_IdentityCode = 1)
      GROUP  BY img.M_Id, img.M_Name, img.M_Group${hasUOM ? ", img.M_UOM" : ""}
      ORDER  BY img.M_Name
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("Error fetching item options:", err);
    res.status(500).json({ error: "Failed to fetch items" });
  }
});

// ── GET /stock/:itemId ────────────────────────────────────────────────────────
// Optional ?godownId=N scopes the balance to a specific godown.
router.get("/stock/:itemId", authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    const godownId = req.query.godownId
      ? parseInt(req.query.godownId, 10)
      : null;
    const stockReq = pool
      .request()
      .input("ItemID", sql.NVarChar(100), req.params.itemId);
    if (godownId) stockReq.input("GodownID", sql.Int, godownId);
    const godownFilter = godownId ? "AND GodownID = @GodownID" : "";
    const result = await stockReq.query(`
        SELECT
          ISNULL(SUM(CASE WHEN Type='IN'  THEN Qty ELSE 0 END), 0) AS stockIn,
          ISNULL(SUM(CASE WHEN Type='OUT' THEN Qty ELSE 0 END), 0) AS stockOut,
          ISNULL(SUM(CASE WHEN Type='IN'  THEN Qty ELSE -Qty END), 0) AS balance
        FROM dbo.StockLedger
        WHERE CONVERT(NVARCHAR(100), ItemID) = @ItemID
        ${godownFilter}
      `);
    res.json(result.recordset[0] || { stockIn: 0, stockOut: 0, balance: 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /next-number ──────────────────────────────────────────────────────────
router.get("/next-number", authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    const prefix = req.query.exb === "true" ? "ExB-ISS" : "ISS";
    const docTypeId = await resolveDocTypeId(pool, sql, prefix);
    const preview = await previewNextDocNumber(pool, sql, docTypeId);
    res.json(preview);
  } catch (error) {
    res.status(500).json({ error: "Failed to preview next ISS number" });
  }
});

// ── GET / ─────────────────────────────────────────────────────────────────────
router.get(
  "/",
  authenticateToken,
  cache("material-issues", 300),
  async (req, res) => {
    try {
      const pool = getPool();
      const page = Math.max(parseInt(req.query.page) || 1, 1);
      const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 100);
      const search = req.query.search ? String(req.query.search).trim() : "";
      const companyId = req.query.companyId ? parseInt(req.query.companyId, 10) : null;
      const offset = (page - 1) * limit;

      const conditions = [];
      const searchParam = search ? `%${search}%` : null;

      if (search) {
        conditions.push("(mi.DocNo LIKE @search OR mi.IssueNo LIKE @search OR c.name LIKE @search OR p.name LIKE @search)");
      }
      if (companyId) {
        conditions.push("mi.CompanyId = @companyId");
      }
      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      // Use a single request with COUNT(*) OVER() to avoid executing the same
      // Request object twice (mssql Request instances are single-use).
      const dataReq = pool.request();
      if (searchParam) dataReq.input("search", sql.NVarChar(200), searchParam);
      if (companyId) dataReq.input("companyId", sql.Int, companyId);
      dataReq.input("offset", sql.Int, offset);
      dataReq.input("limit", sql.Int, limit);

      const dataResult = await dataReq.query(`
      SELECT
        mi.IssueId, mi.IssueNo, mi.DocNo, mi.Status,
        mi.CompanyId, c.name AS CompanyName,
        mi.ProjectId, p.name AS ProjectName,
        mi.FinYearId, fy.FName AS FinYearName,
        mi.Date, mi.Reason, mi.Remarks, mi.CreatedAt,
        mi.GodownId, g.GodownName, g.GodownCode,
        mi.IssuedTo, mi.CostCenter, mi.Purpose,
        (SELECT COUNT(*) FROM dbo.MaterialIssueItems mii WHERE mii.IssueId = mi.IssueId) AS ItemCount,
        (SELECT ISNULL(SUM(mii.Quantity),0) FROM dbo.MaterialIssueItems mii WHERE mii.IssueId = mi.IssueId) AS TotalQty,
        COUNT(*) OVER() AS TotalCount
      FROM dbo.MaterialIssues mi
      LEFT JOIN dbo.enterprise c  ON mi.CompanyId = c.id
      LEFT JOIN dbo.enterprise p  ON mi.ProjectId = p.id
      LEFT JOIN dbo.FinYear    fy ON mi.FinYearId = fy.FId
      LEFT JOIN dbo.Godowns    g  ON mi.GodownId  = g.GodownID
      ${whereClause}
      ORDER BY mi.CreatedAt DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);

      const total =
        dataResult.recordset.length > 0
          ? Number(dataResult.recordset[0].TotalCount)
          : 0;

      res.json({
        data: dataResult.recordset,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      });
    } catch (error) {
      console.error("Error fetching material issues:", error);
      res.status(500).json({ error: "Failed to fetch material issues" });
    }
  },
);

// ── GET /:id ──────────────────────────────────────────────────────────────────
router.get("/:id", authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);

    // Check for optional columns that may not be migrated yet
    const colCheckReq = pool.request();
    const colCheck = await colCheckReq.query(`
      SELECT name FROM sys.columns
      WHERE object_id = OBJECT_ID('dbo.MaterialIssues')
        AND name IN ('IssuedTo','CostCenter','Purpose')
    `);
    const extraCols = colCheck.recordset.map((r) => r.name);
    const issuedToCol   = extraCols.includes("IssuedTo")   ? "mi.IssuedTo,"   : "NULL AS IssuedTo,";
    const costCenterCol = extraCols.includes("CostCenter")  ? "mi.CostCenter," : "NULL AS CostCenter,";
    const purposeCol    = extraCols.includes("Purpose")     ? "mi.Purpose,"    : "NULL AS Purpose,";

    const headerResult = await pool.request().input("id", sql.Int, id).query(`
      SELECT
        mi.IssueId, mi.IssueNo, mi.DocNo, mi.DocTypeId, mi.DocYear, mi.DocSerial,
        mi.ParentDocNo, mi.RootExBDocNo,
        mi.CompanyId, mi.ProjectId, mi.FinYearId,
        mi.Date, mi.Reason, mi.Remarks, mi.Status,
        mi.GodownId, mi.CreatedBy, mi.CreatedAt, mi.UpdatedAt,
        mi.ItemId, mi.Quantity,
        ${issuedToCol}
        ${costCenterCol}
        ${purposeCol}
        c.name   AS CompanyName,
        p.name   AS ProjectName,
        fy.FName AS FinYearName,
        g.GodownName, g.GodownCode
      FROM dbo.MaterialIssues mi
      LEFT JOIN dbo.enterprise c  ON mi.CompanyId = c.id
      LEFT JOIN dbo.enterprise p  ON mi.ProjectId = p.id
      LEFT JOIN dbo.FinYear    fy ON mi.FinYearId = fy.FId
      LEFT JOIN dbo.Godowns    g  ON mi.GodownId  = g.GodownID
      WHERE mi.IssueId = @id
    `);

    if (headerResult.recordset.length === 0)
      return res.status(404).json({ error: "Issue not found" });

    // Scope CurrentBalance to the godown this issue was raised against.
    // Without the GodownID filter we'd sum across all godowns and show the
    // wrong balance in the detail view.
    const issueGodownId = headerResult.recordset[0]?.GodownId ?? null;
    const itemsReq = pool.request().input("id", sql.Int, id);
    if (issueGodownId) itemsReq.input("GodownID", sql.Int, issueGodownId);
    const godownJoin = issueGodownId ? "AND sl.GodownID = @GodownID" : "";
    const itemsResult = await itemsReq.query(`
      SELECT
        mii.IssueItemId, mii.ItemId, mii.UOMCode, mii.Quantity, mii.Remarks,
        img.M_Name AS ItemName, img.M_Group AS ItemGroup,
        uom.UOMName, uom.Symbol AS UOMSymbol,
        ISNULL(SUM(CASE WHEN sl.Type='IN'  THEN sl.Qty ELSE 0 END),0)
      - ISNULL(SUM(CASE WHEN sl.Type='OUT' THEN sl.Qty ELSE 0 END),0)
        AS CurrentBalance
      FROM dbo.MaterialIssueItems mii
      LEFT JOIN dbo.Item_Master_Group img
        ON CONVERT(NVARCHAR(100), img.M_Id) = mii.ItemId
      LEFT JOIN dbo.UOMMaster uom ON uom.UOMCode = mii.UOMCode
      LEFT JOIN dbo.StockLedger sl
        ON CONVERT(NVARCHAR(100), sl.ItemID) = mii.ItemId
        ${godownJoin}
      WHERE mii.IssueId = @id
      GROUP BY mii.IssueItemId, mii.ItemId, mii.UOMCode, mii.Quantity, mii.Remarks,
               img.M_Name, img.M_Group, uom.UOMName, uom.Symbol
    `);

    res.json({ ...headerResult.recordset[0], items: itemsResult.recordset });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch issue" });
  }
});

// ── POST / ────────────────────────────────────────────────────────────────────
router.post("/", authenticateToken, requirePageRight("material-issues", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const {
      CompanyId,
      ProjectId,
      FinYearId = null,
      Date: IssueDate,
      Reason,
      Remarks,
      items = [],
      ParentDocNo = null,
      RootExBDocNo = null,
      IssuedTo = null,
      CostCenter = null,
      Purpose = null,
      GodownId = null,
      DocTypeId: clientDocTypeId = null,
    } = req.body;

    // CompanyId, ProjectId, Date and Reason are NOT NULL columns with no
    // fallback default below — omitting any of them used to reach the
    // INSERT and crash with an unhandled SQL error (caught by the generic
    // catch block as an opaque 500 "Failed to create material issue")
    // instead of a clean, specific validation message. Same bug class found
    // and fixed in purchaseOrders.js, expenseBooking.js, and workOrder.js.
    if (!CompanyId) {
      return res.status(400).json({ error: "CompanyId is required." });
    }
    if (!ProjectId) {
      return res.status(400).json({ error: "ProjectId is required." });
    }
    if (!IssueDate) {
      return res.status(400).json({ error: "Date is required." });
    }
    if (!Reason) {
      return res.status(400).json({ error: "Reason is required." });
    }

    if (!Array.isArray(items) || items.length === 0)
      return res.status(400).json({ error: "At least one item is required" });

    for (const it of items) {
      if (!it.ItemId || !it.Quantity || Number(it.Quantity) <= 0)
        return res
          .status(400)
          .json({ error: "Each item must have ItemId and Quantity > 0" });
    }

    const userId = req.user?.id || null;
    const issuedBy = req.user?.email || null;

    // Resolve the godown: use the one sent from the client, else fall back to main godown
    const resolvedGodownId = GodownId
      ? parseInt(GodownId, 10)
      : await resolveMainGodownId(pool);

    const docTypeId = clientDocTypeId
      ? parseInt(clientDocTypeId, 10)
      : await resolveIssueDocTypeId(pool, RootExBDocNo);
    const docNo = await lockNextDocNumber(pool, sql, {
      docTypeId,
      tableName: "MaterialIssues",
      docNoColumn: "DocNo",
      issuedBy,
      parentDocNo: ParentDocNo,
      rootExBDocNo: RootExBDocNo,
    });

    const parts = docNo.split("-");
    const docYear = parseInt(parts[parts.length - 2], 10) || null;
    const docSerial = parseInt(parts[parts.length - 1], 10) || null;

    // All writes (header + per-item rows + stock-ledger OUT rows) must be one
    // atomic unit: a failure partway through the item loop otherwise leaves a
    // header with only some of its stock movements posted, corrupting the
    // ledger balance for those items.
    const tx = new sql.Transaction(pool);
    await tx.begin();
    let newRecord;
    let issueId;
    try {
      // Enforce stock availability before issuing — an issue must not drive
      // ledger stock negative. Quantities are aggregated per item so repeated
      // lines for the same item are checked against a single balance. Read
      // inside the transaction so it's consistent with the OUT rows written
      // below. (Note: this closes the gross case — issuing more than exists —
      // but two truly-simultaneous issues could still race; a per-item lock
      // would be needed to close that, matching the sale-order limitation.)
      const requestedByItem = new Map();
      for (const it of items) {
        const key = String(it.ItemId);
        requestedByItem.set(
          key,
          (requestedByItem.get(key) || 0) + Number(it.Quantity),
        );
      }
      for (const [checkItemId, requestedQty] of requestedByItem) {
        const availRes = await tx
          .request()
          .input("itemId", sql.NVarChar(100), checkItemId)
          .input("godownId", sql.Int, resolvedGodownId).query(`
            SELECT ISNULL(SUM(CASE WHEN Type='IN' THEN Qty ELSE -Qty END), 0) AS Available
            FROM dbo.StockLedger
            WHERE CONVERT(NVARCHAR(100), ItemID) = @itemId AND GodownID = @godownId
          `);
        const available = Number(availRes.recordset[0].Available || 0);
        if (available < requestedQty) {
          const err = new Error(
            `Insufficient stock for item ${checkItemId} in this godown: available ${available}, requested ${requestedQty}.`,
          );
          err.statusCode = 400;
          throw err;
        }
      }

      const headerReq = tx.request();
      headerReq.input("IssueNo", sql.VarChar(100), docNo);
      headerReq.input("DocNo", sql.NVarChar(100), docNo);
      headerReq.input("DocTypeId", sql.Int, docTypeId);
      headerReq.input("DocYear", sql.SmallInt, docYear);
      headerReq.input("DocSerial", sql.Int, docSerial);
      headerReq.input("ParentDocNo", sql.NVarChar(100), ParentDocNo);
      headerReq.input("RootExBDocNo", sql.NVarChar(100), RootExBDocNo);
      headerReq.input("CompanyId", sql.Int, CompanyId);
      headerReq.input("ProjectId", sql.Int, ProjectId);
      headerReq.input("FinYearId", sql.Int, FinYearId || null);
      headerReq.input("Date", sql.Date, IssueDate);
      headerReq.input("Reason", sql.NVarChar(sql.MAX), Reason);
      headerReq.input("Remarks", sql.NVarChar(sql.MAX), Remarks || null);
      headerReq.input("CreatedBy", sql.Int, userId);
      headerReq.input("GodownId", sql.Int, resolvedGodownId);
      headerReq.input("IssuedTo", sql.NVarChar(200), IssuedTo || null);
      headerReq.input("CostCenter", sql.NVarChar(200), CostCenter || null);
      headerReq.input("Purpose", sql.NVarChar(500), Purpose || null);
      // Legacy NOT NULL columns — populate from first item
      headerReq.input("ItemId", sql.NVarChar(100), String(items[0].ItemId));
      headerReq.input(
        "Quantity",
        sql.Decimal(18, 2),
        parseFloat(items[0].Quantity) || 0,
      );

      const headerResult = await headerReq.query(`
        INSERT INTO dbo.MaterialIssues
          (IssueNo, DocNo, DocTypeId, DocYear, DocSerial,
           ParentDocNo, RootExBDocNo,
           CompanyId, ProjectId, FinYearId, Date,
           Reason, Remarks, CreatedBy,
           GodownId, IssuedTo, CostCenter, Purpose, ItemId, Quantity)
        OUTPUT INSERTED.*
        VALUES
          (@IssueNo, @DocNo, @DocTypeId, @DocYear, @DocSerial,
           @ParentDocNo, @RootExBDocNo,
           @CompanyId, @ProjectId, @FinYearId, @Date,
           @Reason, @Remarks, @CreatedBy,
           @GodownId, @IssuedTo, @CostCenter, @Purpose, @ItemId, @Quantity)
      `);

      newRecord = headerResult.recordset[0];
      issueId = newRecord.IssueId;

      for (const it of items) {
        const qty = Number(it.Quantity);
        const itemId = String(it.ItemId);
        const uomCode = it.UOMCode || null;

        await tx
          .request()
          .input("IssueId", sql.Int, issueId)
          .input("ItemId", sql.NVarChar(100), itemId)
          .input("UOMCode", sql.NVarChar(20), uomCode)
          .input("Quantity", sql.Decimal(18, 2), qty)
          .input("Remarks", sql.NVarChar(sql.MAX), it.Remarks || null).query(`
          INSERT INTO dbo.MaterialIssueItems (IssueId, ItemId, UOMCode, Quantity, Remarks)
          VALUES (@IssueId, @ItemId, @UOMCode, @Quantity, @Remarks)
        `);

        await tx
          .request()
          .input("ItemID", sql.NVarChar(50), itemId)
          .input("Qty", sql.Decimal(18, 2), qty)
          .input("UOM", sql.NVarChar(20), uomCode)
          .input("Type", sql.NVarChar(10), "OUT")
          .input("RefType", sql.NVarChar(20), "ISS")
          .input("RefID", sql.Int, issueId)
          .input("DocNo", sql.NVarChar(100), docNo)
          .input("GodownID", sql.Int, resolvedGodownId).query(`
          INSERT INTO dbo.StockLedger (ItemID, Qty, UOM, Type, RefType, RefID, DocNo, GodownID, CreatedDate)
          VALUES (@ItemID, @Qty, @UOM, @Type, @RefType, @RefID, @DocNo, @GodownID, GETDATE())
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

    await backPatchRecordId(pool, sql, docNo, "MaterialIssues", issueId);
    await bumpCacheVersion("material-issues");
    await bumpCacheVersion("stock-ledger");

    // Auto-submit: transition → Pending immediately after creation.
    try {
      await transition(
        "material-issues",
        issueId,
        "Pending",
        req.user?.email,
        req.user?.role,
      );
    } catch (submitErr) {
      console.warn(
        "Material Issue auto-submit failed (non-fatal):",
        submitErr.message,
      );
    }

    res.status(201).json({ ...newRecord, items, status: "Pending" });
  } catch (error) {
    // Client-side errors (e.g. insufficient stock) carry a statusCode and a
    // user-facing message; surface those instead of a generic 500.
    if (error.statusCode === 400) {
      return res.status(400).json({ error: error.message });
    }
    console.error("Error creating material issue:", error);
    res.status(500).json({ error: "Failed to create material issue" });
  }
});

// ── PUT /:id ──────────────────────────────────────────────────────────────────
router.put("/:id", authenticateToken, requirePageRight("material-issues", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    const {
      CompanyId,
      ProjectId,
      FinYearId = null,
      Date: IssueDate,
      Reason,
      Remarks,
      items = [],
      GodownId = null,
      IssuedTo = null,
      CostCenter = null,
      Purpose = null,
    } = req.body;

    // Same NOT NULL columns as POST / — this UPDATE overwrites them
    // unconditionally (not a COALESCE-style partial update), so omitting
    // any of them here would null out the existing value and crash the
    // same way the create path did before the fix above.
    if (!CompanyId) {
      return res.status(400).json({ error: "CompanyId is required." });
    }
    if (!ProjectId) {
      return res.status(400).json({ error: "ProjectId is required." });
    }
    if (!IssueDate) {
      return res.status(400).json({ error: "Date is required." });
    }
    if (!Reason) {
      return res.status(400).json({ error: "Reason is required." });
    }

    if (!Array.isArray(items) || items.length === 0)
      return res.status(400).json({ error: "At least one item is required" });

    const existing = await pool
      .request()
      .input("id", sql.Int, id)
      .query("SELECT DocNo, Status FROM dbo.MaterialIssues WHERE IssueId = @id");
    if (existing.recordset.length === 0)
      return res.status(404).json({ error: "Issue not found" });

    const { DocNo: docNo, Status: currentStatus } = existing.recordset[0];
    if (!["Draft", "Rejected"].includes(currentStatus)) {
      return res.status(400).json({
        error: `Cannot edit an issue with status "${currentStatus}". Only Draft or Rejected issues can be edited.`,
      });
    }

    const resolvedGodownId = GodownId
      ? parseInt(GodownId, 10)
      : await resolveMainGodownId(pool);

    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      await tx
        .request()
        .input("Id", sql.Int, id)
        .input("CompanyId", sql.Int, CompanyId)
        .input("ProjectId", sql.Int, ProjectId)
        .input("FinYearId", sql.Int, FinYearId || null)
        .input("Date", sql.Date, IssueDate)
        .input("Reason", sql.NVarChar(sql.MAX), Reason)
        .input("Remarks", sql.NVarChar(sql.MAX), Remarks || null)
        .input("GodownId", sql.Int, resolvedGodownId)
        .input("IssuedTo", sql.NVarChar(200), IssuedTo || null)
        .input("CostCenter", sql.NVarChar(200), CostCenter || null)
        .input("Purpose", sql.NVarChar(500), Purpose || null).query(`
          UPDATE dbo.MaterialIssues
          SET CompanyId=@CompanyId, ProjectId=@ProjectId, FinYearId=@FinYearId,
              Date=@Date, Reason=@Reason, Remarks=@Remarks, UpdatedAt=GETDATE(),
              GodownId=@GodownId,
              IssuedTo=@IssuedTo, CostCenter=@CostCenter, Purpose=@Purpose
          WHERE IssueId=@Id
        `);

      await tx
        .request()
        .input("Id", sql.Int, id)
        .query("DELETE FROM dbo.MaterialIssueItems WHERE IssueId = @Id");
      await tx
        .request()
        .input("Id", sql.Int, id)
        .query("DELETE FROM dbo.StockLedger WHERE RefType='ISS' AND RefID=@Id");

      for (const it of items) {
        const qty = Number(it.Quantity);
        const itemId = String(it.ItemId);
        const uomCode = it.UOMCode || null;

        await tx
          .request()
          .input("IssueId", sql.Int, id)
          .input("ItemId", sql.NVarChar(100), itemId)
          .input("UOMCode", sql.NVarChar(20), uomCode)
          .input("Quantity", sql.Decimal(18, 2), qty)
          .input("Remarks", sql.NVarChar(sql.MAX), it.Remarks || null).query(`
            INSERT INTO dbo.MaterialIssueItems (IssueId, ItemId, UOMCode, Quantity, Remarks)
            VALUES (@IssueId, @ItemId, @UOMCode, @Quantity, @Remarks)
          `);

        await tx
          .request()
          .input("ItemID", sql.NVarChar(50), itemId)
          .input("Qty", sql.Decimal(18, 2), qty)
          .input("UOM", sql.NVarChar(20), uomCode)
          .input("Type", sql.NVarChar(10), "OUT")
          .input("RefType", sql.NVarChar(20), "ISS")
          .input("RefID", sql.Int, id)
          .input("DocNo", sql.NVarChar(100), docNo)
          .input("GodownID", sql.Int, resolvedGodownId).query(`
            INSERT INTO dbo.StockLedger (ItemID, Qty, UOM, Type, RefType, RefID, DocNo, GodownID, CreatedDate)
            VALUES (@ItemID, @Qty, @UOM, @Type, @RefType, @RefID, @DocNo, @GodownID, GETDATE())
          `);
      }

      await tx.commit();
    } catch (txErr) {
      await tx.rollback();
      throw txErr;
    }

    await bumpCacheVersion("material-issues");
    await bumpCacheVersion("stock-ledger");
    res.json({ message: "Issue updated successfully" });
  } catch (error) {
    console.error("Error updating material issue:", error);
    res.status(500).json({ error: "Failed to update material issue" });
  }
});

// ── DELETE /:id ───────────────────────────────────────────────────────────────
router.delete("/:id", authenticateToken, requirePageRight("material-issues", "delete"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);

    // Bug 6a — guard against NaN id (e.g. non-numeric route segment)
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    // Bug 6b — existence + status check: only Draft or Rejected issues may be deleted.
    // Deleting an Approved/Pending issue would silently reverse stock movements
    // without any audit trail.
    const existing = await pool
      .request()
      .input("id", sql.Int, id)
      .query("SELECT Status FROM dbo.MaterialIssues WHERE IssueId = @id");

    if (existing.recordset.length === 0)
      return res.status(404).json({ error: "Issue not found" });

    const { Status } = existing.recordset[0];
    if (!["Draft", "Rejected"].includes(Status))
      return res.status(409).json({
        error: `Cannot delete an issue with status "${Status}". Only Draft or Rejected issues can be deleted.`,
      });

    await pool
      .request()
      .input("id", sql.Int, id)
      .query("DELETE FROM dbo.StockLedger WHERE RefType='ISS' AND RefID=@id");
    await pool
      .request()
      .input("id", sql.Int, id)
      .query("DELETE FROM dbo.MaterialIssues WHERE IssueId = @id");
    await bumpCacheVersion("material-issues");
    await bumpCacheVersion("stock-ledger");
    res.json({ message: "Issue deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete issue" });
  }
});

// ── GET /reference-list/grn ───────────────────────────────────────────────────
router.get("/reference-list/grn", authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT TOP 100
        grn.GRNID AS id,
        COALESCE(grn.DocNo, grn.GRNNo) AS docNo
      FROM dbo.GoodsReceiptNotes grn
      ORDER BY grn.CreatedDate DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /reference-list/mr ────────────────────────────────────────────────────
router.get("/reference-list/mr", authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT TOP 100
        mr.MRId  AS id,
        mr.DocNo AS docNo,
        mr.Status
      FROM dbo.MaterialRequests mr
      ORDER BY mr.CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /prefill/:type/:id ────────────────────────────────────────────────────
// Returns items pre-filled from a GRN, MR, or Work Done record.
// :id can be a numeric DB id OR a doc number string (e.g. GRN-2026-00004)
router.get("/prefill/:type/:id", authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    const type = (req.params.type || "").toUpperCase();
    const raw = (req.params.id || "").trim();
    if (!raw) return res.status(400).json({ error: "Invalid source id" });

    const numericId = parseInt(raw, 10);
    const byDocNo = !Number.isFinite(numericId) || numericId <= 0;

    if (type === "GRN") {
      // GRN items are stored as JSON in the GRNItems column on GoodsReceiptNotes
      // CompanyId/ProjectId come from the linked PurchaseOrder
      const hdrReq = pool.request();
      let hdrWhere;
      if (byDocNo) {
        hdrReq.input("docNo", sql.NVarChar(100), raw);
        hdrWhere = "(grn.GRNNo = @docNo OR grn.DocNo = @docNo)";
      } else {
        hdrReq.input("id", sql.Int, numericId);
        hdrWhere = "grn.GRNID = @id";
      }

      const hdr = await hdrReq.query(`
        SELECT grn.GRNID, grn.GRNNo, grn.DocNo, grn.GRNItems, grn.GRNDate,
               p.CompanyId, p.ProjectId,
               -- Resolve the FinYearId from the GRN date via the FinYear table
               (SELECT TOP 1 fy.FId
                FROM dbo.FinYear fy
                WHERE grn.GRNDate >= fy.FStartDate
                  AND grn.GRNDate <= fy.FEndDate) AS FinYearId
        FROM   dbo.GoodsReceiptNotes grn
        LEFT JOIN dbo.PurchaseOrders p ON grn.POID = p.PurchaseOrderID
        WHERE  ${hdrWhere}
      `);
      if (!hdr.recordset.length)
        return res.status(404).json({ error: "GRN not found" });

      const h = hdr.recordset[0];

      // Parse GRNItems JSON column
      let rawItems = [];
      try {
        rawItems =
          typeof h.GRNItems === "string"
            ? JSON.parse(h.GRNItems)
            : h.GRNItems || [];
      } catch {
        rawItems = [];
      }

      // GRN JSON items are stored camelCase: { itemId, itemName, receivedQty, uom }
      // Support both camelCase (current app) and PascalCase (legacy) field names
      const items = await Promise.all(
        rawItems
          .filter((it) => {
            const qty = Number(
              it.receivedQty ??
                it.acceptedQty ??
                it.AcceptedQty ??
                it.ReceivedQty ??
                it.Quantity ??
                it.quantity ??
                0,
            );
            return qty > 0;
          })
          .map(async (it) => {
            const itemId = String(
              it.itemId ?? it.ItemCode ?? it.ItemId ?? it.M_Id ?? "",
            );
            const qty = Number(
              it.receivedQty ??
                it.acceptedQty ??
                it.AcceptedQty ??
                it.ReceivedQty ??
                it.Quantity ??
                it.quantity ??
                0,
            );
            const grnUOM = it.uom || it.UOM || it.UOMCode || "";

            let availableStock = 0;
            let resolvedName =
              it.itemName || it.ItemName || it.M_Name || it.Description || "";
            let resolvedUOM = grnUOM;

            if (itemId) {
              try {
                // Enrich: item name, stock balance, and UOMCode resolution.
                // GRN JSON stores uom as the display name (e.g. "Bag"), NOT the UOMCode.
                // We resolve: first try matching UOMMaster by UOMName, then by UOMCode,
                // then fall back to StockLedger's UOM column.
                const enrichRes = await pool
                  .request()
                  .input("itemId", sql.NVarChar(100), itemId)
                  .input("grnUOMRaw", sql.NVarChar(50), grnUOM || "").query(`
                    SELECT
                      img.M_Name,
                      -- Prefer UOMCode matched by UOMName (GRN stores display name)
                      COALESCE(
                        (SELECT TOP 1 u.UOMCode FROM dbo.UOMMaster u
                         WHERE u.UOMName = @grnUOMRaw AND @grnUOMRaw <> ''),
                        (SELECT TOP 1 u.UOMCode FROM dbo.UOMMaster u
                         WHERE u.UOMCode = @grnUOMRaw AND @grnUOMRaw <> ''),
                        MAX(sl.UOM),
                        NULL
                      ) AS ResolvedUOMCode,
                      ISNULL(SUM(CASE WHEN sl.Type='IN'  THEN sl.Qty ELSE 0 END),0)
                    - ISNULL(SUM(CASE WHEN sl.Type='OUT' THEN sl.Qty ELSE 0 END),0)
                      AS AvailableStock
                    FROM dbo.Item_Master_Group img
                    LEFT JOIN dbo.StockLedger sl
                      ON CONVERT(NVARCHAR(100), sl.ItemID) = CONVERT(NVARCHAR(100), img.M_Id)
                    WHERE CONVERT(NVARCHAR(100), img.M_Id) = @itemId
                    GROUP BY img.M_Name
                  `);
                if (enrichRes.recordset.length > 0) {
                  const row = enrichRes.recordset[0];
                  if (!resolvedName) resolvedName = row.M_Name || "";
                  resolvedUOM = row.ResolvedUOMCode || resolvedUOM || "";
                  availableStock = Number(row.AvailableStock ?? 0);
                }
              } catch {
                /* leave defaults */
              }
            }
            return {
              ItemId: itemId,
              ItemName: resolvedName,
              UOMCode: resolvedUOM,
              Quantity: String(qty),
              AvailableStock: availableStock,
            };
          }),
      );

      return res.json({
        referenceType: "GRN",
        referenceId: h.GRNID,
        referenceDocNo: h.DocNo || h.GRNNo,
        companyId: h.CompanyId,
        projectId: h.ProjectId,
        finYearId: h.FinYearId || null, // derived from GRN date matched against FinYear table
        items,
      });
    }

    if (type === "MR") {
      const mrReq = pool.request();
      let mrWhere;
      if (byDocNo) {
        mrReq.input("docNo", sql.NVarChar(100), raw);
        mrWhere = "UPPER(mr.DocNo) = UPPER(@docNo)";
      } else {
        mrReq.input("id", sql.Int, numericId);
        mrWhere = "mr.MRId = @id";
      }

      const hdr = await mrReq.query(`
        SELECT mr.MRId, mr.DocNo, mr.CompanyId, mr.ProjectId, mr.Status, mr.FinYearId
        FROM   dbo.MaterialRequests mr
        WHERE  ${mrWhere}
      `);
      if (!hdr.recordset.length)
        return res.status(404).json({ error: "Material Request not found" });
      // No approval gate on prefill — approval enforced at PO creation

      const h = hdr.recordset[0];
      // MR items are PascalCase in dbo.MaterialRequestItems (ItemId, ItemName, UOMCode, Quantity).
      // Join Item_Master_Group to fill gaps in name/UOM and get current stock.
      const items = await pool.request().input("mrId", sql.Int, h.MRId).query(`
        SELECT
          mri.ItemId,
          mri.Quantity,
          COALESCE(NULLIF(mri.ItemName, ''), img.M_Name, '')             AS ItemName,
          COALESCE(NULLIF(mri.UOMCode,  ''), MAX(sl.UOM), '')           AS UOMCode,
          ISNULL(SUM(CASE WHEN sl.Type='IN'  THEN sl.Qty ELSE 0 END),0)
        - ISNULL(SUM(CASE WHEN sl.Type='OUT' THEN sl.Qty ELSE 0 END),0) AS AvailableStock
        FROM   dbo.MaterialRequestItems mri
        LEFT JOIN dbo.Item_Master_Group img
          ON CONVERT(NVARCHAR(100), img.M_Id) = CONVERT(NVARCHAR(100), mri.ItemId)
        LEFT JOIN dbo.StockLedger sl
          ON CONVERT(NVARCHAR(100), sl.ItemID) = CONVERT(NVARCHAR(100), mri.ItemId)
        WHERE  mri.MRId = @mrId
        GROUP BY mri.ItemId, mri.ItemName, mri.UOMCode, mri.Quantity, img.M_Name
      `);

      return res.json({
        referenceType: "MR",
        referenceId: h.MRId,
        referenceDocNo: h.DocNo,
        companyId: h.CompanyId,
        projectId: h.ProjectId,
        finYearId: h.FinYearId || null, // carry over fin year from the MR
        items: items.recordset.map((r) => ({
          ItemId: String(r.ItemId),
          ItemName: r.ItemName || "",
          UOMCode: r.UOMCode || "",
          Quantity: String(r.Quantity || ""),
          AvailableStock: Number(r.AvailableStock),
        })),
      });
    }

    return res.status(400).json({ error: "type must be GRN or MR" });
  } catch (err) {
    console.error("Issue prefill error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /:id/submit — Pending re-submission after rejection ───────────────────
router.put("/:id/submit", authenticateToken, requirePageRight("material-issues", "edit"), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const userEmail = req.user?.email;
    const result = await transition(
      "material-issues",
      id,
      "Pending",
      userEmail,
      req.user?.role,
    );
    res.json({ message: "Material Issue submitted for approval", ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── PUT /:id/approve ──────────────────────────────────────────────────────────
router.put("/:id/approve", authenticateToken, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const result = await transition(
      "material-issues",
      id,
      "Approved",
      req.user?.email,
      req.user?.role,
      req.body?.note ?? null,
    );
    await bumpCacheVersion("material-issues");
    res.json({ message: "Material Issue approved", ...result });
  } catch (err) {
    // Matches the newPayment.js/receivedPayment.js convention: an
    // authorization failure from transition()'s role gate is a 403, not a
    // generic 400 validation error.
    const status = err.message.includes("not authorized") ? 403 : 400;
    res.status(status).json({ error: err.message });
  }
});

// ── PUT /:id/reject ───────────────────────────────────────────────────────────
router.put("/:id/reject", authenticateToken, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const result = await transition(
      "material-issues",
      id,
      "Rejected",
      req.user?.email,
      req.user?.role,
      req.body?.note ?? null,
    );
    await bumpCacheVersion("material-issues");
    res.json({ message: "Material Issue rejected", ...result });
  } catch (err) {
    const status = err.message.includes("not authorized") ? 403 : 400;
    res.status(status).json({ error: err.message });
  }
});
module.exports = router;
