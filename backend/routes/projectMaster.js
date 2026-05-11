const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const allowRoles = require("../middleware/role");
const { bumpCacheVersion } = require("../redis");

router.use(authMiddleware);
const adminOnly = allowRoles("admin", "super_admin", "dba");

// GET all — reads from enterprise where business_type = 'P'
router.get("/", async (req, res) => {
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
        cr_code               AS BusinessUnit,
        address               AS Location,
        city,
        state,
        country,
        pincode,
        phone_number          AS Phone,
        email,
        website,
        currency,
        status                AS Status,
        rera_no               AS Priority,
        start_date            AS StartDate,
        rera_date             AS EndDate,
        trade_license         AS ClientName,
        tan                   AS ClientCode,
        cin                   AS TeamSize,
        pan                   AS Remarks,
        CASE WHEN discontinue = 1 THEN 0 ELSE 1 END AS IsActive,
        logo                  AS ProjectImage,
        belongs_to,
        date_of_entry         AS CreatedAt
      FROM dbo.enterprise
      WHERE business_type = 'P'
      ORDER BY name
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST — inserts into enterprise with business_type = 'P'
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
      // project-specific field mappings onto enterprise columns
      .input("cr_code", sql.NVarChar(200), f.businessUnit || null)
      .input("address", sql.NVarChar(sql.MAX), f.location || null)
      .input("city", sql.NVarChar(100), f.city || null)
      .input("state", sql.NVarChar(100), f.state || null)
      .input("country", sql.NVarChar(100), f.country || null)
      .input("pincode", sql.NVarChar(10), f.pincode || null)
      .input("phone_number", sql.NVarChar(20), f.phone || null)
      .input("email", sql.NVarChar(255), f.email || null)
      .input("website", sql.NVarChar(255), f.website || null)
      .input("currency", sql.NVarChar(10), f.currency || "INR")
      .input("status", sql.NVarChar(50), f.status || "Planning")
      .input("rera_no", sql.NVarChar(100), f.priority || null)
      .input("start_date", sql.Date, f.startDate || null)
      .input("rera_date", sql.Date, f.endDate || null)
      .input("trade_license", sql.NVarChar(200), f.clientName || null)
      .input("tan", sql.NVarChar(15), f.clientCode || null)
      .input("cin", sql.NVarChar(50), f.teamSize ? String(f.teamSize) : null)
      .input("pan", sql.NVarChar(20), f.remarks || null)
      .input("logo", sql.NVarChar(sql.MAX), f.projectImage || null)
      .input("belongs_to", sql.NVarChar(255), f.belongsTo || null)
      .input("discontinue", sql.Bit, f.isActive ? 0 : 1)
      .input("date_of_entry", sql.Date, new Date()).query(`
        INSERT INTO dbo.enterprise (
          name, short_name, business_identity, business_type, entity_type, description,
          cr_code, address, city, state, country, pincode,
          phone_number, email, website, currency,
          status, rera_no, start_date, rera_date,
          trade_license, tan, cin, pan,
          logo, belongs_to, discontinue, date_of_entry
        ) VALUES (
          @name, @short_name, @business_identity, @business_type, @entity_type, @description,
          @cr_code, @address, @city, @state, @country, @pincode,
          @phone_number, @email, @website, @currency,
          @status, @rera_no, @start_date, @rera_date,
          @trade_license, @tan, @cin, @pan,
          @logo, @belongs_to, @discontinue, @date_of_entry
        )
      `);
    await bumpCacheVersion("enterprises");
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT — updates enterprise row (project)
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
      .input("cr_code", sql.NVarChar(200), f.businessUnit || null)
      .input("address", sql.NVarChar(sql.MAX), f.location || null)
      .input("city", sql.NVarChar(100), f.city || null)
      .input("state", sql.NVarChar(100), f.state || null)
      .input("country", sql.NVarChar(100), f.country || null)
      .input("pincode", sql.NVarChar(10), f.pincode || null)
      .input("phone_number", sql.NVarChar(20), f.phone || null)
      .input("email", sql.NVarChar(255), f.email || null)
      .input("website", sql.NVarChar(255), f.website || null)
      .input("currency", sql.NVarChar(10), f.currency || "INR")
      .input("status", sql.NVarChar(50), f.status || "Planning")
      .input("rera_no", sql.NVarChar(100), f.priority || null)
      .input("start_date", sql.Date, f.startDate || null)
      .input("rera_date", sql.Date, f.endDate || null)
      .input("trade_license", sql.NVarChar(200), f.clientName || null)
      .input("tan", sql.NVarChar(15), f.clientCode || null)
      .input("cin", sql.NVarChar(50), f.teamSize ? String(f.teamSize) : null)
      .input("pan", sql.NVarChar(20), f.remarks || null)
      .input("logo", sql.NVarChar(sql.MAX), f.projectImage || null)
      .input("belongs_to", sql.NVarChar(255), f.belongsTo || null)
      .input("discontinue", sql.Bit, f.isActive ? 0 : 1).query(`
        UPDATE dbo.enterprise SET
          name=@name, short_name=@short_name, business_identity=@business_identity,
          entity_type=@entity_type, description=@description,
          cr_code=@cr_code, address=@address, city=@city, state=@state,
          country=@country, pincode=@pincode, phone_number=@phone_number,
          email=@email, website=@website, currency=@currency,
          status=@status, rera_no=@rera_no, start_date=@start_date, rera_date=@rera_date,
          trade_license=@trade_license, tan=@tan, cin=@cin, pan=@pan,
          logo=@logo, belongs_to=@belongs_to, discontinue=@discontinue
        WHERE id=@id AND business_type='P'
      `);
    await bumpCacheVersion("enterprises");
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE — soft delete via discontinue flag
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
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
