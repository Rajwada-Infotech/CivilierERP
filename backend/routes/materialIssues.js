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
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
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
      SELECT id, name, short_name
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

// ── GET /item-options ─────────────────────────────────────────────────────────
router.get("/item-options", authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT img.M_Id, img.M_Name, img.M_Group,
             ISNULL(SUM(CASE WHEN sl.Type='IN'  THEN sl.Qty ELSE 0 END), 0)
           - ISNULL(SUM(CASE WHEN sl.Type='OUT' THEN sl.Qty ELSE 0 END), 0)
             AS AvailableStock,
             COALESCE(MAX(sl.UOM), img.M_BaseUOM) AS DefaultUOM
      FROM   dbo.Item_Master_Group img
      LEFT JOIN dbo.StockLedger sl
        ON  CONVERT(NVARCHAR(50), sl.ItemID) = CONVERT(NVARCHAR(50), img.M_Id)
      WHERE  img.M_IdentityCode = 1
      GROUP  BY img.M_Id, img.M_Name, img.M_Group, img.M_BaseUOM
      ORDER  BY img.M_Name
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("Error fetching item options:", err);
    res.status(500).json({ error: "Failed to fetch items" });
  }
});

// ── GET /stock/:itemId ────────────────────────────────────────────────────────
router.get("/stock/:itemId", authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("ItemID", sql.NVarChar(100), req.params.itemId).query(`
        SELECT
          ISNULL(SUM(CASE WHEN Type='IN'  THEN Qty ELSE 0 END), 0) AS stockIn,
          ISNULL(SUM(CASE WHEN Type='OUT' THEN Qty ELSE 0 END), 0) AS stockOut,
          ISNULL(SUM(CASE WHEN Type='IN'  THEN Qty ELSE -Qty END), 0) AS balance
        FROM dbo.StockLedger
        WHERE CONVERT(NVARCHAR(100), ItemID) = @ItemID
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
      const offset = (page - 1) * limit;

      const request = pool.request();
      let whereClause = "";

      if (search) {
        whereClause = `
        WHERE mi.DocNo   LIKE @search
           OR mi.IssueNo LIKE @search
           OR c.name     LIKE @search
           OR p.name     LIKE @search
      `;
        request.input("search", sql.NVarChar(200), `%${search}%`);
      }

      request.input("offset", sql.Int, offset);
      request.input("limit", sql.Int, limit);

      const countResult = await request.query(`
      SELECT COUNT(*) AS total
      FROM   dbo.MaterialIssues mi
      LEFT JOIN dbo.enterprise c ON mi.CompanyId = c.id
      LEFT JOIN dbo.enterprise p ON mi.ProjectId = p.id
      ${whereClause}
    `);

      const dataResult = await request.query(`
      SELECT
        mi.IssueId, mi.IssueNo, mi.DocNo, mi.Status,
        mi.CompanyId, c.name AS CompanyName,
        mi.ProjectId, p.name AS ProjectName,
        mi.FinYearId, fy.FName AS FinYearName,
        mi.Date, mi.Reason, mi.Remarks, mi.CreatedAt,
        (SELECT COUNT(*) FROM dbo.MaterialIssueItems mii WHERE mii.IssueId = mi.IssueId) AS ItemCount,
        (SELECT ISNULL(SUM(mii.Quantity),0) FROM dbo.MaterialIssueItems mii WHERE mii.IssueId = mi.IssueId) AS TotalQty
      FROM dbo.MaterialIssues mi
      LEFT JOIN dbo.enterprise c  ON mi.CompanyId = c.id
      LEFT JOIN dbo.enterprise p  ON mi.ProjectId = p.id
      LEFT JOIN dbo.FinYear    fy ON mi.FinYearId = fy.FId
      ${whereClause}
      ORDER BY mi.CreatedAt DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);

      res.json({
        data: dataResult.recordset,
        total: countResult.recordset[0].total,
        page,
        limit,
        totalPages: Math.ceil(countResult.recordset[0].total / limit),
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

    const headerResult = await pool.request().input("id", sql.Int, id).query(`
      SELECT mi.*, c.name AS CompanyName, p.name AS ProjectName, fy.FName AS FinYearName
      FROM dbo.MaterialIssues mi
      LEFT JOIN dbo.enterprise c  ON mi.CompanyId = c.id
      LEFT JOIN dbo.enterprise p  ON mi.ProjectId = p.id
      LEFT JOIN dbo.FinYear    fy ON mi.FinYearId = fy.FId
      WHERE mi.IssueId = @id
    `);

    if (headerResult.recordset.length === 0)
      return res.status(404).json({ error: "Issue not found" });

    const itemsResult = await pool.request().input("id", sql.Int, id).query(`
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
router.post("/", authenticateToken, async (req, res) => {
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
    } = req.body;

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

    const docTypeId = await resolveIssueDocTypeId(pool, RootExBDocNo);
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

    const headerReq = pool.request();
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

    const headerResult = await headerReq.query(`
      INSERT INTO dbo.MaterialIssues
        (IssueNo, DocNo, DocTypeId, DocYear, DocSerial,
         ParentDocNo, RootExBDocNo,
         CompanyId, ProjectId, FinYearId, Date,
         Reason, Remarks, CreatedBy)
      OUTPUT INSERTED.*
      VALUES
        (@IssueNo, @DocNo, @DocTypeId, @DocYear, @DocSerial,
         @ParentDocNo, @RootExBDocNo,
         @CompanyId, @ProjectId, @FinYearId, @Date,
         @Reason, @Remarks, @CreatedBy)
    `);

    const newRecord = headerResult.recordset[0];
    const issueId = newRecord.IssueId;

    for (const it of items) {
      const qty = Number(it.Quantity);
      const itemId = String(it.ItemId);
      const uomCode = it.UOMCode || null;

      await pool
        .request()
        .input("IssueId", sql.Int, issueId)
        .input("ItemId", sql.NVarChar(100), itemId)
        .input("UOMCode", sql.NVarChar(20), uomCode)
        .input("Quantity", sql.Decimal(18, 2), qty)
        .input("Remarks", sql.NVarChar(sql.MAX), it.Remarks || null).query(`
          INSERT INTO dbo.MaterialIssueItems (IssueId, ItemId, UOMCode, Quantity, Remarks)
          VALUES (@IssueId, @ItemId, @UOMCode, @Quantity, @Remarks)
        `);

      await pool
        .request()
        .input("ItemID", sql.NVarChar(50), itemId)
        .input("Qty", sql.Decimal(18, 2), qty)
        .input("UOM", sql.NVarChar(20), uomCode)
        .input("Type", sql.NVarChar(10), "OUT")
        .input("RefType", sql.NVarChar(20), "ISS")
        .input("RefID", sql.Int, issueId)
        .input("DocNo", sql.NVarChar(100), docNo).query(`
          INSERT INTO dbo.StockLedger (ItemID, Qty, UOM, Type, RefType, RefID, DocNo, CreatedDate)
          VALUES (@ItemID, @Qty, @UOM, @Type, @RefType, @RefID, @DocNo, GETDATE())
        `);
    }

    await backPatchRecordId(pool, sql, docNo, "MaterialIssues", issueId);
    await bumpCacheVersion("material-issues");
    await bumpCacheVersion("stock-ledger");

    res.status(201).json({ ...newRecord, items });
  } catch (error) {
    console.error("Error creating material issue:", error);
    res.status(500).json({ error: "Failed to create material issue" });
  }
});

// ── PUT /:id ──────────────────────────────────────────────────────────────────
router.put("/:id", authenticateToken, async (req, res) => {
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
    } = req.body;

    if (!Array.isArray(items) || items.length === 0)
      return res.status(400).json({ error: "At least one item is required" });

    const existing = await pool
      .request()
      .input("id", sql.Int, id)
      .query("SELECT DocNo FROM dbo.MaterialIssues WHERE IssueId = @id");
    if (existing.recordset.length === 0)
      return res.status(404).json({ error: "Issue not found" });

    const docNo = existing.recordset[0].DocNo;

    await pool
      .request()
      .input("Id", sql.Int, id)
      .input("CompanyId", sql.Int, CompanyId)
      .input("ProjectId", sql.Int, ProjectId)
      .input("FinYearId", sql.Int, FinYearId || null)
      .input("Date", sql.Date, IssueDate)
      .input("Reason", sql.NVarChar(sql.MAX), Reason)
      .input("Remarks", sql.NVarChar(sql.MAX), Remarks || null).query(`
        UPDATE dbo.MaterialIssues
        SET CompanyId=@CompanyId, ProjectId=@ProjectId, FinYearId=@FinYearId,
            Date=@Date, Reason=@Reason, Remarks=@Remarks, UpdatedAt=GETDATE()
        WHERE IssueId=@Id
      `);

    await pool
      .request()
      .input("Id", sql.Int, id)
      .query("DELETE FROM dbo.MaterialIssueItems WHERE IssueId = @Id");
    await pool
      .request()
      .input("Id", sql.Int, id)
      .query("DELETE FROM dbo.StockLedger WHERE RefType='ISS' AND RefID=@Id");

    for (const it of items) {
      const qty = Number(it.Quantity);
      const itemId = String(it.ItemId);
      const uomCode = it.UOMCode || null;

      await pool
        .request()
        .input("IssueId", sql.Int, id)
        .input("ItemId", sql.NVarChar(100), itemId)
        .input("UOMCode", sql.NVarChar(20), uomCode)
        .input("Quantity", sql.Decimal(18, 2), qty)
        .input("Remarks", sql.NVarChar(sql.MAX), it.Remarks || null).query(`
          INSERT INTO dbo.MaterialIssueItems (IssueId, ItemId, UOMCode, Quantity, Remarks)
          VALUES (@IssueId, @ItemId, @UOMCode, @Quantity, @Remarks)
        `);

      await pool
        .request()
        .input("ItemID", sql.NVarChar(50), itemId)
        .input("Qty", sql.Decimal(18, 2), qty)
        .input("UOM", sql.NVarChar(20), uomCode)
        .input("Type", sql.NVarChar(10), "OUT")
        .input("RefType", sql.NVarChar(20), "ISS")
        .input("RefID", sql.Int, id)
        .input("DocNo", sql.NVarChar(100), docNo).query(`
          INSERT INTO dbo.StockLedger (ItemID, Qty, UOM, Type, RefType, RefID, DocNo, CreatedDate)
          VALUES (@ItemID, @Qty, @UOM, @Type, @RefType, @RefID, @DocNo, GETDATE())
        `);
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
router.delete("/:id", authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
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

module.exports = router;
