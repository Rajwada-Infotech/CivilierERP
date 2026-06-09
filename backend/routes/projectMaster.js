const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, validate: false }));
const { getPool, sql } = require("../db");
const allowRoles = require("../middleware/role");
const { bumpCacheVersion } = require("../redis");

const adminOnly = allowRoles("admin", "super_admin", "dba");

// ── GET all projects ──────────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT
        p.id                    AS Id,
        p.business_identity     AS Code,
        p.name                  AS Name,
        p.short_name            AS ShortName,
        p.entity_type           AS Type,
        p.description           AS Description,
        p.address               AS AddressLine1,
        p.address_line2         AS AddressLine2,
        p.address_line3         AS AddressLine3,
        p.pincode               AS ZipCode,
        p.latitude              AS Latitude,
        p.longitude             AS Longitude,
        p.currency              AS Currency,
        p.status                AS Status,
        p.rera_no               AS Priority,
        p.start_date            AS StartDate,
        p.end_date              AS EndDate,
        p.team_size             AS TeamSize,
        p.pan                   AS Remarks,
        CASE WHEN p.discontinue = 1 THEN 0 ELSE 1 END AS IsActive,
        p.logo                  AS ProjectImage,
        -- enterprise FK
        p.enterprise_id         AS EnterpriseId,
        e.name                  AS EnterpriseName,
        -- company FK
        p.company_id            AS CompanyId,
        c.name                  AS CompanyName,
        c.b_sub_identity_type   AS CompanyGST,
        c.gst_issue_date        AS CompanyGSTDate,
        c.pan                   AS CompanyPAN,
        c.tan                   AS CompanyTAN,
        c.trade_license         AS CompanyTradeLicenseNo,
        -- jv
        ISNULL(p.jv_enabled, 0) AS JvEnabled,
        p.jv_company_name       AS JvCompanyName,
        p.date_of_entry         AS CreatedAt
      FROM dbo.enterprise p
      LEFT JOIN dbo.enterprise e ON e.id = p.enterprise_id
      LEFT JOIN dbo.enterprise c ON c.id = p.company_id
      WHERE p.business_type = 'P'
      ORDER BY p.name
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /company/:id — fetch compliance fields from linked Company ─────────────
router.get("/company/:id", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("id", sql.Int, parseInt(req.params.id)).query(`
        SELECT
          id                  AS Id,
          name                AS Name,
          b_sub_identity_type AS GST,
          gst_issue_date      AS GSTDate,
          pan                 AS PAN,
          tan                 AS TAN,
          trade_license       AS TradeLicenseNo
        FROM dbo.enterprise
        WHERE id = @id AND business_type = 'C'
      `);
    if (!result.recordset.length)
      return res.status(404).json({ error: "Company not found" });
    res.json(result.recordset[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST — create project ─────────────────────────────────────────────────────
router.post("/", adminOnly, async (req, res) => {
  const f = req.body;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("name", sql.NVarChar(255), f.name || null)
      .input("short_name", sql.NVarChar(100), f.shortName || null)
      .input("business_identity", sql.NVarChar(100), f.code || null)
      .input("business_type", sql.NVarChar(10), "P")
      .input("entity_type", sql.NVarChar(50), f.type || null)
      .input("description", sql.NVarChar(sql.MAX), f.description || null)
      .input("address", sql.NVarChar(sql.MAX), f.addressLine1 || null)
      .input("address_line2", sql.NVarChar(500), f.addressLine2 || null)
      .input("address_line3", sql.NVarChar(500), f.addressLine3 || null)
      .input("pincode", sql.NVarChar(20), f.zipCode || null)
      .input(
        "latitude",
        sql.Decimal(10, 7),
        f.latitude ? parseFloat(f.latitude) : null,
      )
      .input(
        "longitude",
        sql.Decimal(10, 7),
        f.longitude ? parseFloat(f.longitude) : null,
      )
      .input("currency", sql.NVarChar(10), f.currency || "INR")
      .input("status", sql.NVarChar(50), f.status || "Planning")
      .input("rera_no", sql.NVarChar(100), f.priority || null)
      .input("start_date", sql.Date, f.startDate || null)
      .input("end_date", sql.Date, f.endDate || null)
      .input("team_size", sql.Int, f.teamSize ? parseInt(f.teamSize) : null)
      .input("pan", sql.NVarChar(20), f.remarks || null)
      .input("logo", sql.NVarChar(sql.MAX), f.projectImage || null)
      // ── proper FK ids (replaces the old string-based belongs_to / b_sub_identity_type) ──
      .input(
        "enterprise_id",
        sql.Int,
        f.enterpriseId ? parseInt(f.enterpriseId) : null,
      )
      .input("company_id", sql.Int, f.companyId ? parseInt(f.companyId) : null)
      .input("jv_enabled", sql.Bit, f.jvEnabled ? 1 : 0)
      .input(
        "jv_company_name",
        sql.NVarChar(255),
        f.jvEnabled && f.jvCompanyName ? f.jvCompanyName : null,
      )
      .input("discontinue", sql.Bit, f.isActive ? 0 : 1)
      .input("date_of_entry", sql.Date, new Date()).query(`
        INSERT INTO dbo.enterprise (
          name, short_name, business_identity, business_type, entity_type, description,
          address, address_line2, address_line3, pincode, latitude, longitude,
          currency, status, rera_no, start_date, end_date, team_size, pan,
          logo, enterprise_id, company_id,
          jv_enabled, jv_company_name, discontinue, date_of_entry
        ) VALUES (
          @name, @short_name, @business_identity, @business_type, @entity_type, @description,
          @address, @address_line2, @address_line3, @pincode, @latitude, @longitude,
          @currency, @status, @rera_no, @start_date, @end_date, @team_size, @pan,
          @logo, @enterprise_id, @company_id,
          @jv_enabled, @jv_company_name, @discontinue, @date_of_entry
        )
      `);
    await bumpCacheVersion("enterprises");
    await bumpCacheVersion("project-master");

    // Auto-create a dedicated godown for this project
    try {
      const projectRow = await pool
        .request()
        .input("name", sql.NVarChar(255), f.name || null)
        .input("btype", sql.NVarChar(10), "P")
        .query(
          "SELECT TOP 1 id FROM dbo.enterprise WHERE name=@name AND business_type=@btype ORDER BY id DESC",
        );
      const newProjectId = projectRow.recordset[0]?.id;
      if (newProjectId) {
        const code = (f.code || f.name || "PRJ")
          .replace(/\s+/g, "_")
          .toUpperCase()
          .slice(0, 40);
        const godownCode = `PRJ-${code}-${newProjectId}`;
        const godownName = `${f.name} Godown`;
        // Only create if no godown already linked to this project
        const existing = await pool
          .request()
          .input("pid", sql.Int, newProjectId)
          .query(
            "SELECT TOP 1 GodownID FROM dbo.Godowns WHERE ProjectID=@pid AND IsDeleted=0",
          );
        if (existing.recordset.length === 0) {
          await pool
            .request()
            .input("GodownCode", sql.NVarChar(50), godownCode)
            .input("GodownName", sql.NVarChar(255), godownName)
            .input("ShortDesc", sql.NVarChar(100), f.shortName || f.name)
            .input("ProjectID", sql.Int, newProjectId)
            .input(
              "EnterpriseID",
              sql.Int,
              f.enterpriseId ? parseInt(f.enterpriseId) : null,
            ).query(`
              INSERT INTO dbo.Godowns (GodownCode, GodownName, ShortDesc, ProjectID, EnterpriseID, IsMain, IsActive, IsDeleted)
              VALUES (@GodownCode, @GodownName, @ShortDesc, @ProjectID, @EnterpriseID, 0, 1, 0)
            `);
        }
      }
    } catch (godownErr) {
      // Non-fatal — project was created, godown creation failed
      console.warn(
        "[projectMaster] Auto-godown creation failed:",
        godownErr.message,
      );
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT — update project ──────────────────────────────────────────────────────
router.put("/:id", adminOnly, async (req, res) => {
  const f = req.body;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("id", sql.Int, parseInt(req.params.id))
      .input("name", sql.NVarChar(255), f.name || null)
      .input("short_name", sql.NVarChar(100), f.shortName || null)
      .input("business_identity", sql.NVarChar(100), f.code || null)
      .input("entity_type", sql.NVarChar(50), f.type || null)
      .input("description", sql.NVarChar(sql.MAX), f.description || null)
      .input("address", sql.NVarChar(sql.MAX), f.addressLine1 || null)
      .input("address_line2", sql.NVarChar(500), f.addressLine2 || null)
      .input("address_line3", sql.NVarChar(500), f.addressLine3 || null)
      .input("pincode", sql.NVarChar(20), f.zipCode || null)
      .input(
        "latitude",
        sql.Decimal(10, 7),
        f.latitude ? parseFloat(f.latitude) : null,
      )
      .input(
        "longitude",
        sql.Decimal(10, 7),
        f.longitude ? parseFloat(f.longitude) : null,
      )
      .input("currency", sql.NVarChar(10), f.currency || "INR")
      .input("status", sql.NVarChar(50), f.status || "Planning")
      .input("rera_no", sql.NVarChar(100), f.priority || null)
      .input("start_date", sql.Date, f.startDate || null)
      .input("end_date", sql.Date, f.endDate || null)
      .input("team_size", sql.Int, f.teamSize ? parseInt(f.teamSize) : null)
      .input("pan", sql.NVarChar(20), f.remarks || null)
      .input("logo", sql.NVarChar(sql.MAX), f.projectImage || null)
      // ── proper FK ids ──
      .input(
        "enterprise_id",
        sql.Int,
        f.enterpriseId ? parseInt(f.enterpriseId) : null,
      )
      .input("company_id", sql.Int, f.companyId ? parseInt(f.companyId) : null)
      .input("jv_enabled", sql.Bit, f.jvEnabled ? 1 : 0)
      .input(
        "jv_company_name",
        sql.NVarChar(255),
        f.jvEnabled && f.jvCompanyName ? f.jvCompanyName : null,
      )
      .input("discontinue", sql.Bit, f.isActive ? 0 : 1).query(`
        UPDATE dbo.enterprise SET
          name=@name, short_name=@short_name, business_identity=@business_identity,
          entity_type=@entity_type, description=@description,
          address=@address, address_line2=@address_line2, address_line3=@address_line3,
          pincode=@pincode, latitude=@latitude, longitude=@longitude,
          currency=@currency, status=@status, rera_no=@rera_no,
          start_date=@start_date, end_date=@end_date, team_size=@team_size, pan=@pan,
          logo=@logo, enterprise_id=@enterprise_id, company_id=@company_id,
          jv_enabled=@jv_enabled, jv_company_name=@jv_company_name,
          discontinue=@discontinue
        WHERE id=@id AND business_type='P'
      `);
    await bumpCacheVersion("enterprises");
    await bumpCacheVersion("project-master");
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE — blocked if project is linked to a company, enterprise, PO, WO, or GRN ──
router.delete("/:id", adminOnly, async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid project ID" });

  try {
    const pool = getPool();

    // 1. Check if the project itself has a parent company or enterprise set
    const projectRow = await pool
      .request()
      .input("id", sql.Int, id)
      .query(
        "SELECT id, name, enterprise_id, company_id FROM dbo.enterprise WHERE id=@id AND business_type='P'",
      );

    if (!projectRow.recordset.length)
      return res.status(404).json({ error: "Project not found" });

    const proj = projectRow.recordset[0];

    if (proj.enterprise_id || proj.company_id) {
      return res.status(409).json({
        error: "Cannot delete project",
        reason:
          "This project is linked to a parent " +
          [proj.enterprise_id && "enterprise", proj.company_id && "company"]
            .filter(Boolean)
            .join(" and ") +
          ". Unlink it first before deleting.",
      });
    }

    // 2. Check for any Purchase Orders, Work Orders, or GRNs referencing this project
    const usageCheck = await pool.request().input("ProjectId", sql.Int, id)
      .query(`
      SELECT
        (SELECT COUNT(*) FROM dbo.PurchaseOrders   WHERE ProjectId = @ProjectId) AS POCount,
        (SELECT COUNT(*) FROM dbo.WorkOrderHeader        WHERE ProjectId = @ProjectId) AS WOCount,
        (SELECT COUNT(*) FROM dbo.GoodsReceiptNotes grn
           INNER JOIN dbo.PurchaseOrders po ON po.PurchaseOrderID = grn.POID
           WHERE po.ProjectId = @ProjectId)                                        AS GRNCount
    `);

    const { POCount, WOCount, GRNCount } = usageCheck.recordset[0];
    const linked = [];
    if (POCount > 0)
      linked.push(`${POCount} Purchase Order${POCount > 1 ? "s" : ""}`);
    if (WOCount > 0)
      linked.push(`${WOCount} Work Order${WOCount > 1 ? "s" : ""}`);
    if (GRNCount > 0) linked.push(`${GRNCount} GRN${GRNCount > 1 ? "s" : ""}`);

    if (linked.length > 0) {
      return res.status(409).json({
        error: "Cannot delete project",
        reason: `This project has ${linked.join(", ")} linked to it and cannot be deleted.`,
      });
    }

    // 3. Safe to delete
    await pool
      .request()
      .input("id", sql.Int, id)
      .query("DELETE FROM dbo.enterprise WHERE id=@id AND business_type='P'");

    await bumpCacheVersion("enterprises");
    await bumpCacheVersion("project-master");
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
