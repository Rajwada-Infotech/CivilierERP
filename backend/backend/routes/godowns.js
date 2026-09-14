const allowRoles = require("../middleware/role");
const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const { requireValidId, checkRowsAffected } = require("../utils/routeHelpers");

// Bust cache on startup so the IsProjectDefault computation takes effect immediately
bumpCacheVersion("godowns").catch(() => {});

// ─── GET all godowns ──────────────────────────────────────────────────────────
router.get("/", cache("godowns", 120), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT
        g.GodownID, g.GodownCode, g.GodownName, g.ShortDesc,
        g.Description, g.Remarks,
        g.EnterpriseID, g.ProjectID, g.Location,
        g.IsActive, g.IsDeleted, g.CreatedAt, g.UpdatedAt,
        e.name AS EnterpriseName,
        p.name AS ProjectName,
        -- A project's "default" godown is the one auto-created when the
        -- project itself was created (see projectMaster.js). There's no
        -- dedicated flag for this, but it's always the earliest godown
        -- row for that ProjectID, so we identify it by CreatedAt order.
        -- The singleton IsMain concept was removed (migration 104); this
        -- replaces it with a per-project equivalent.
        CASE
          WHEN g.ProjectID IS NOT NULL AND g.GodownID = (
            SELECT TOP 1 g2.GodownID
            FROM dbo.Godowns g2
            WHERE g2.ProjectID = g.ProjectID AND g2.IsDeleted = 0
            ORDER BY g2.CreatedAt ASC, g2.GodownID ASC
          ) THEN CAST(1 AS BIT)
          ELSE CAST(0 AS BIT)
        END AS IsProjectDefault
      FROM dbo.Godowns g
      LEFT JOIN dbo.enterprise e ON e.id = g.EnterpriseID
      LEFT JOIN dbo.enterprise p ON p.id = g.ProjectID AND p.business_type = 'P'
      WHERE g.IsDeleted = 0
      ORDER BY g.GodownName
    `);
    res.json({ data: result.recordset, total: result.recordset.length });
  } catch (err) {
    console.error("[godowns] GET /:", err.message);
    res
      .status(500)
      .json({ error: "Failed to fetch godowns", message: err.message });
  }
});

// ─── GET single godown ────────────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  try {
    const id = requireValidId(req, res);
    if (!id) return;
    const pool = getPool();
    const result = await pool.request().input("id", sql.Int, id).query(`
        SELECT g.*, e.name AS EnterpriseName, p.name AS ProjectName
        FROM dbo.Godowns g
        LEFT JOIN dbo.enterprise e ON e.id = g.EnterpriseID
        LEFT JOIN dbo.enterprise p ON p.id = g.ProjectID AND p.business_type = 'P'
        WHERE g.GodownID = @id AND g.IsDeleted = 0
      `);
    if (!result.recordset.length)
      return res.status(404).json({ error: "Godown not found" });
    res.json(result.recordset[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST create godown ───────────────────────────────────────────────────────
router.post("/", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  try {
    const {
      GodownCode,
      GodownName,
      ShortDesc,
      Description,
      Remarks,
      EnterpriseID,
      ProjectID,
      Location,
      IsActive = 1,
    } = req.body;

    if (!GodownName?.trim())
      return res.status(400).json({ error: "GodownName is required" });

    const pool = getPool();
    const result = await pool
      .request()
      .input("GodownCode", sql.NVarChar(50), GodownCode?.trim() || null)
      .input("GodownName", sql.NVarChar(255), GodownName.trim())
      .input("ShortDesc", sql.NVarChar(100), ShortDesc?.trim() || null)
      .input("Description", sql.NVarChar(sql.MAX), Description?.trim() || null)
      .input("Remarks", sql.NVarChar(500), Remarks?.trim() || null)
      .input("EnterpriseID", sql.Int, EnterpriseID || null)
      .input("ProjectID", sql.Int, ProjectID || null)
      .input("Location", sql.NVarChar(255), Location?.trim() || null)
      .input("IsActive", sql.Bit, IsActive ? 1 : 0).query(`
        INSERT INTO dbo.Godowns
          (GodownCode, GodownName, ShortDesc, Description, Remarks,
           EnterpriseID, ProjectID, Location, IsMain, IsActive)
        OUTPUT INSERTED.GodownID
        VALUES
          (@GodownCode, @GodownName, @ShortDesc, @Description, @Remarks,
           @EnterpriseID, @ProjectID, @Location, 0, @IsActive)
      `);

    await bumpCacheVersion("godowns");
    res.status(201).json({
      GodownID: result.recordset[0].GodownID,
      message: "Godown created",
    });
  } catch (err) {
    console.error("[godowns] POST /:", err.message);
    res
      .status(500)
      .json({ error: "Failed to create godown", message: err.message });
  }
});

// ─── PUT update godown ────────────────────────────────────────────────────────
router.put("/:id", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  try {
    const id = requireValidId(req, res);
    if (!id) return;
    const {
      GodownCode,
      GodownName,
      ShortDesc,
      Description,
      Remarks,
      EnterpriseID,
      ProjectID,
      Location,
      IsActive,
    } = req.body;

    const pool = getPool();

    // Disallow editing IsMain flag
    const check = await pool
      .request()
      .input("id", sql.Int, id)
      .query(
        "SELECT IsMain FROM dbo.Godowns WHERE GodownID=@id AND IsDeleted=0",
      );
    if (!check.recordset.length)
      return res.status(404).json({ error: "Godown not found" });

    const result = await pool
      .request()
      .input("id", sql.Int, id)
      .input("GodownCode", sql.NVarChar(50), GodownCode?.trim() || null)
      .input("GodownName", sql.NVarChar(255), GodownName?.trim() || null)
      .input("ShortDesc", sql.NVarChar(100), ShortDesc?.trim() || null)
      .input("Description", sql.NVarChar(sql.MAX), Description?.trim() || null)
      .input("Remarks", sql.NVarChar(500), Remarks?.trim() || null)
      .input("EnterpriseID", sql.Int, EnterpriseID || null)
      .input("ProjectID", sql.Int, ProjectID || null)
      .input("Location", sql.NVarChar(255), Location?.trim() || null)
      .input(
        "IsActive",
        sql.Bit,
        IsActive !== undefined ? (IsActive ? 1 : 0) : 1,
      ).query(`
        UPDATE dbo.Godowns SET
          GodownCode   = COALESCE(@GodownCode, GodownCode),
          GodownName   = COALESCE(@GodownName, GodownName),
          ShortDesc    = @ShortDesc,
          Description  = @Description,
          Remarks      = @Remarks,
          EnterpriseID = @EnterpriseID,
          ProjectID    = @ProjectID,
          Location     = @Location,
          IsActive     = @IsActive,
          UpdatedAt    = SYSDATETIME()
        WHERE GodownID = @id AND IsDeleted = 0
      `);
    if (!checkRowsAffected(result, res, "Godown")) return;

    await bumpCacheVersion("godowns");
    res.json({ message: "Godown updated" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE (soft) godown ─────────────────────────────────────────────────────
router.delete("/:id", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  try {
    const id = requireValidId(req, res);
    if (!id) return;
    const pool = getPool();

    const check = await pool
      .request()
      .input("id", sql.Int, id)
      .query(
        "SELECT GodownID FROM dbo.Godowns WHERE GodownID=@id AND IsDeleted=0",
      );
    if (!check.recordset.length)
      return res.status(404).json({ error: "Godown not found" });

    const result = await pool
      .request()
      .input("id", sql.Int, id)
      .query(
        "UPDATE dbo.Godowns SET IsDeleted=1, UpdatedAt=SYSDATETIME() WHERE GodownID=@id",
      );
    if (!checkRowsAffected(result, res, "Godown")) return;

    await bumpCacheVersion("godowns");
    res.json({ message: "Godown deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
