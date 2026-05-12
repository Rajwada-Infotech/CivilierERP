const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const allowRoles = require("../middleware/role");
const { bumpCacheVersion } = require("../redis");
const { cache } = require("../middleware/cache");

router.use(authMiddleware);
const adminOnly = allowRoles("admin", "super_admin", "dba");

// ── GET all projects ──────────────────────────────────────────────────────────
router.get(
  "/",
  cache("project-master", 300, { shared: true }),
  async (req, res) => {
    try {
      const pool = getPool();
      const result = await pool.request().query(`
      SELECT
        id                    AS Id,
        business_identity     AS Code,
        name                  AS Name,
        short_name            AS ShortName,
        entity_type           AS Type,
        description           AS Description,
        address               AS AddressLine1,
        address_line2         AS AddressLine2,
        address_line3         AS AddressLine3,
        pincode               AS ZipCode,
        latitude              AS Latitude,
        longitude             AS Longitude,
        currency              AS Currency,
        status                AS Status,
        rera_no               AS Priority,
        start_date            AS StartDate,
        end_date              AS EndDate,
        team_size             AS TeamSize,
        pan                   AS Remarks,
        CASE WHEN discontinue = 1 THEN 0 ELSE 1 END AS IsActive,
        logo                  AS ProjectImage,
        belongs_to,
        b_sub_identity_type,
        ISNULL(jv_enabled, 0) AS JvEnabled,
        jv_company_name       AS JvCompanyName,
        date_of_entry         AS CreatedAt
      FROM dbo.enterprise
      WHERE business_type = 'P'
      ORDER BY name
    `);
      res.json(result.recordset);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },
);

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
      .input("belongs_to", sql.NVarChar(255), f.enterpriseName || null)
      .input("b_sub_identity_type", sql.NVarChar(255), f.companyName || null)
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
          logo, belongs_to, b_sub_identity_type,
          jv_enabled, jv_company_name, discontinue, date_of_entry
        ) VALUES (
          @name, @short_name, @business_identity, @business_type, @entity_type, @description,
          @address, @address_line2, @address_line3, @pincode, @latitude, @longitude,
          @currency, @status, @rera_no, @start_date, @end_date, @team_size, @pan,
          @logo, @belongs_to, @b_sub_identity_type,
          @jv_enabled, @jv_company_name, @discontinue, @date_of_entry
        )
      `);
    await bumpCacheVersion("enterprises");
    await bumpCacheVersion("project-master");
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
      .input("belongs_to", sql.NVarChar(255), f.enterpriseName || null)
      .input("b_sub_identity_type", sql.NVarChar(255), f.companyName || null)
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
          logo=@logo, belongs_to=@belongs_to, b_sub_identity_type=@b_sub_identity_type,
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

// ── DELETE — soft delete ──────────────────────────────────────────────────────
router.delete("/:id", adminOnly, async (req, res) => {
  try {
    const pool = getPool();
    await pool
      .request()
      .input("id", sql.Int, parseInt(req.params.id))
      .query(
        "UPDATE dbo.enterprise SET discontinue=1 WHERE id=@id AND business_type='P'",
      );
    await bumpCacheVersion("enterprises");
    await bumpCacheVersion("project-master");
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
