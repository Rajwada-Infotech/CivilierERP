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
      WHERE  business_type = 'E' AND (status IS NULL OR status = 'Active')
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
router.get("/item-options", authenticateToken, async (req, res) => {
  try {
    const pool = getPool();

    const colCheck = await pool.request().query(`
      SELECT COUNT(1) AS cnt FROM sys.columns
      WHERE object_id = OBJECT_ID(N'dbo.Item_Master_Group') AND name = N'M_UOM'
    `);
    const hasUOM = colCheck.recordset[0].cnt > 0;

    const result = await pool.request().query(`
      SELECT  img.M_Id, img.M_Name, ig.I_Name AS M_Group,
              ${hasUOM ? "img.M_UOM AS DefaultUOM," : "NULL AS DefaultUOM,"}
              ISNULL(SUM(sl.TotalQuantity), 0) AS AvailableStock
      FROM    dbo.Item_Master_Group img
      LEFT JOIN dbo.ItemGroup ig ON ig.I_Id = img.I_Id
      LEFT JOIN (
        SELECT  ItemId,
                SUM(CASE WHEN TranType = 'IN'  THEN Quantity ELSE 0 END) -
                SUM(CASE WHEN TranType = 'OUT' THEN Quantity ELSE 0 END) AS TotalQuantity
        FROM    dbo.StockLedger
        GROUP BY ItemId
      ) sl ON sl.ItemId = img.M_Id
      GROUP BY img.M_Id, img.M_Name, ig.I_Name${hasUOM ? ", img.M_UOM" : ""}
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
      SELECT UOMCode, UOMName, Symbol, IsActive
      FROM   dbo.UOM_Master
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
    const dtId = await resolveDocTypeId(pool, sql, "MR");
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
    const limit = Math.min(100, parseInt(req.query.limit) || 10);
    const offset = (page - 1) * limit;
    const search = req.query.search || "";

    const request = pool.request();
    request.input("offset", sql.Int, offset);
    request.input("limit", sql.Int, limit);
    request.input("search", sql.NVarChar, `%${search}%`);

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
      FROM       dbo.MaterialRequests mr
      LEFT JOIN  dbo.enterprise  ec  ON ec.id  = mr.CompanyId
      LEFT JOIN  dbo.enterprise  ep  ON ep.id  = mr.ProjectId
      LEFT JOIN  dbo.FinYear     fy  ON fy.FId = mr.FinYearId
      LEFT JOIN  dbo.MaterialRequestItems mri ON mri.MRId = mr.MRId
      WHERE (@search = '%%' OR mr.DocNo LIKE @search OR ec.name LIKE @search OR mr.Status LIKE @search)
      GROUP BY mr.MRId, mr.DocNo, mr.Status, mr.Priority,
               mr.RequestDate, mr.RequiredByDate,
               mr.Reason, mr.Remarks, mr.CreatedBy, mr.CreatedAt,
               ec.name, ep.name, fy.FName
      ORDER BY mr.CreatedAt DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);

    const total = result.recordset[0]?._total ?? 0;
    const data = result.recordset.map(({ _total, ...row }) => row);
    res.json({ data, page, limit, total, totalPages: Math.ceil(total / limit) });
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

    const hdr = await pool.request()
      .input("id", sql.Int, id)
      .query(`
        SELECT mr.*, ec.name AS CompanyName, ep.name AS ProjectName, fy.FName AS FinYearName
        FROM   dbo.MaterialRequests mr
        LEFT JOIN dbo.enterprise ec ON ec.id  = mr.CompanyId
        LEFT JOIN dbo.enterprise ep ON ep.id  = mr.ProjectId
        LEFT JOIN dbo.FinYear    fy ON fy.FId = mr.FinYearId
        WHERE mr.MRId = @id
      `);

    if (!hdr.recordset.length) return res.status(404).json({ error: "Not found" });

    const items = await pool.request()
      .input("id", sql.Int, id)
      .query(`
        SELECT mri.*, u.UOMName, u.Symbol AS UOMSymbol
        FROM   dbo.MaterialRequestItems mri
        LEFT JOIN dbo.UOM_Master u ON u.UOMCode = mri.UOMCode
        WHERE  mri.MRId = @id
        ORDER  BY mri.MRItemId
      `);

    res.json({ ...hdr.recordset[0], items: items.recordset });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST / ─────────────────────────────────────────────────────────────────────
router.post("/", authenticateToken, async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;

  try {
    const pool = getPool();
    await ensureTablesExist(pool);

    const {
      CompanyId, ProjectId, FinYearId,
      RequestDate, RequiredByDate,
      Priority = "Normal",
      Reason, Remarks,
      items = [],
    } = req.body;

    if (!Reason?.trim()) return res.status(400).json({ error: "Reason is required" });
    if (!items.length)   return res.status(400).json({ error: "At least one item required" });

    const dtId = await resolveDocTypeId(pool, sql, "MR");
    const { token } = dtId ? await lockNextDocNumber(pool, sql, dtId) : { token: null };

    const insertHdr = await pool.request()
      .input("CompanyId",     sql.Int,           CompanyId     || null)
      .input("ProjectId",     sql.Int,           ProjectId     || null)
      .input("FinYearId",     sql.Int,           FinYearId     || null)
      .input("RequestDate",   sql.Date,          RequestDate   || new Date())
      .input("RequiredByDate",sql.Date,          RequiredByDate|| null)
      .input("Priority",      sql.NVarChar(20),  Priority)
      .input("Reason",        sql.NVarChar(sql.MAX), Reason)
      .input("Remarks",       sql.NVarChar(sql.MAX), Remarks || null)
      .input("DocTypeId",     sql.Int,           dtId          || null)
      .input("CreatedBy",     sql.NVarChar(200), user)
      .query(`
        INSERT INTO dbo.MaterialRequests
          (CompanyId, ProjectId, FinYearId, RequestDate, RequiredByDate,
           Priority, Reason, Remarks, Status, DocTypeId, CreatedBy, UpdatedBy)
        OUTPUT INSERTED.MRId
        VALUES (@CompanyId, @ProjectId, @FinYearId, @RequestDate, @RequiredByDate,
                @Priority, @Reason, @Remarks, 'Draft', @DocTypeId, @CreatedBy, @CreatedBy)
      `);

    const newId = insertHdr.recordset[0].MRId;

    if (token) await backPatchRecordId(pool, sql, token, newId);

    for (const item of items) {
      await pool.request()
        .input("MRId",     sql.Int,              newId)
        .input("ItemId",   sql.NVarChar(50),     String(item.ItemId))
        .input("ItemName", sql.NVarChar(200),    item.ItemName  || null)
        .input("UOMCode",  sql.NVarChar(20),     item.UOMCode   || null)
        .input("Quantity", sql.Decimal(18, 4),   parseFloat(item.Quantity) || 0)
        .input("Remarks",  sql.NVarChar(sql.MAX), item.Remarks  || null)
        .query(`
          INSERT INTO dbo.MaterialRequestItems (MRId, ItemId, ItemName, UOMCode, Quantity, Remarks)
          VALUES (@MRId, @ItemId, @ItemName, @UOMCode, @Quantity, @Remarks)
        `);
    }

    await bumpCacheVersion("material-requests");
    const created = await pool.request()
      .input("id", sql.Int, newId)
      .query("SELECT DocNo FROM dbo.MaterialRequests WHERE MRId = @id");

    res.status(201).json({ MRId: newId, DocNo: created.recordset[0]?.DocNo });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /:id ───────────────────────────────────────────────────────────────────
router.put("/:id", authenticateToken, async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;

  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const {
      CompanyId, ProjectId, FinYearId,
      RequestDate, RequiredByDate,
      Priority = "Normal",
      Reason, Remarks, Status,
      items = [],
    } = req.body;

    await pool.request()
      .input("id",            sql.Int,           id)
      .input("CompanyId",     sql.Int,           CompanyId      || null)
      .input("ProjectId",     sql.Int,           ProjectId      || null)
      .input("FinYearId",     sql.Int,           FinYearId      || null)
      .input("RequestDate",   sql.Date,          RequestDate    || new Date())
      .input("RequiredByDate",sql.Date,          RequiredByDate || null)
      .input("Priority",      sql.NVarChar(20),  Priority)
      .input("Reason",        sql.NVarChar(sql.MAX), Reason)
      .input("Remarks",       sql.NVarChar(sql.MAX), Remarks || null)
      .input("Status",        sql.NVarChar(20),  Status || "Draft")
      .input("UpdatedBy",     sql.NVarChar(200), user)
      .query(`
        UPDATE dbo.MaterialRequests
        SET CompanyId=@CompanyId, ProjectId=@ProjectId, FinYearId=@FinYearId,
            RequestDate=@RequestDate, RequiredByDate=@RequiredByDate,
            Priority=@Priority, Reason=@Reason, Remarks=@Remarks,
            Status=@Status, UpdatedBy=@UpdatedBy, UpdatedAt=GETDATE()
        WHERE MRId=@id
      `);

    // Replace items
    await pool.request().input("id", sql.Int, id)
      .query("DELETE FROM dbo.MaterialRequestItems WHERE MRId=@id");

    for (const item of items) {
      await pool.request()
        .input("MRId",     sql.Int,              id)
        .input("ItemId",   sql.NVarChar(50),     String(item.ItemId))
        .input("ItemName", sql.NVarChar(200),    item.ItemName  || null)
        .input("UOMCode",  sql.NVarChar(20),     item.UOMCode   || null)
        .input("Quantity", sql.Decimal(18, 4),   parseFloat(item.Quantity) || 0)
        .input("Remarks",  sql.NVarChar(sql.MAX), item.Remarks  || null)
        .query(`
          INSERT INTO dbo.MaterialRequestItems (MRId, ItemId, ItemName, UOMCode, Quantity, Remarks)
          VALUES (@MRId, @ItemId, @ItemName, @UOMCode, @Quantity, @Remarks)
        `);
    }

    await bumpCacheVersion("material-requests");
    res.json({ message: "Material request updated" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /:id ────────────────────────────────────────────────────────────────
router.delete("/:id", authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    // Check status — only Draft can be deleted
    const check = await pool.request().input("id", sql.Int, id)
      .query("SELECT Status FROM dbo.MaterialRequests WHERE MRId=@id");
    if (!check.recordset.length) return res.status(404).json({ error: "Not found" });
    if (check.recordset[0].Status !== "Draft")
      return res.status(400).json({ error: "Only Draft requests can be deleted" });

    await pool.request().input("id", sql.Int, id)
      .query("DELETE FROM dbo.MaterialRequests WHERE MRId=@id");

    await bumpCacheVersion("material-requests");
    res.json({ message: "Material request deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /:id/submit ────────────────────────────────────────────────────────────
router.put("/:id/submit", authenticateToken, async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    await pool.request()
      .input("id", sql.Int, id).input("user", sql.NVarChar(200), user)
      .query(`UPDATE dbo.MaterialRequests SET Status='Pending', UpdatedBy=@user, UpdatedAt=GETDATE() WHERE MRId=@id AND Status='Draft'`);
    await bumpCacheVersion("material-requests");
    res.json({ message: "Submitted for approval" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
