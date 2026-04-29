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
        id          AS Id,
        business_identity AS Code,
        name        AS Name,
        description AS LegalName,
        short_name  AS ShortName,
        entity_type AS Type,
        cr_code     AS Industry,
        date_of_establishment AS IncorporationDate,
        cin         AS CIN,
        pan         AS PAN,
        tan         AS TAN,
        gst_type    AS GSTType,
        business_identity AS GST,
        gst_issue_date AS GSTDate,
        trade_license  AS TradeLicenseNo,
        NULL           AS TradeLicenseDate,
        address        AS RegisteredAddress,
        address_line2  AS Address2,
        city, state, country, pincode,
        phone_number   AS Phone,
        NULL           AS Fax,
        email,
        website,
        NULL           AS AuthorizedCapital,
        NULL           AS PaidUpCapital,
        currency,
        fiscal_year_start AS FiscalYearStart,
        NULL           AS AuditorName,
        CASE WHEN discontinue = 1 THEN 0 ELSE 1 END AS IsActive,
        NULL           AS Remarks,
        logo           AS LogoUrl,
        status,
        belongs_to
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
      .input("business_type", sql.NVarChar(100), "P")
      .input("entity_type", sql.NVarChar(50), f.type || null)
      .input("description", sql.NVarChar(sql.MAX), f.legalName || null)
      .input("cr_code", sql.NVarChar(50), f.industry || null)
      .input("date_of_establishment", sql.Date, f.incorporationDate || null)
      .input("cin", sql.NVarChar(50), f.cinNumber || null)
      .input("pan", sql.NVarChar(20), f.panNumber || null)
      .input("tan", sql.NVarChar(15), f.tanNumber || null)
      .input("gst_type", sql.NVarChar(50), f.gstType || null)
      .input("gst_issue_date", sql.Date, f.gstDate || null)
      .input("trade_license", sql.NVarChar(100), f.tradeLicenseNo || null)
      .input("address", sql.NVarChar(sql.MAX), f.registeredAddress || null)
      .input("city", sql.NVarChar(100), f.city || null)
      .input("state", sql.NVarChar(100), f.state || null)
      .input("country", sql.NVarChar(100), f.country || null)
      .input("pincode", sql.NVarChar(10), f.pincode || null)
      .input("phone_number", sql.NVarChar(20), f.phone || null)
      .input("email", sql.NVarChar(255), f.email || null)
      .input("website", sql.NVarChar(255), f.website || null)
      .input("currency", sql.NVarChar(10), f.currency || "INR")
      .input("fiscal_year_start", sql.NVarChar(20), f.fiscalYearStart || null)
      .input("logo", sql.NVarChar(sql.MAX), f.logoUrl || null)
      .input("belongs_to", sql.NVarChar(50), f.belongsTo || null)
      .input("discontinue", sql.Bit, f.isActive ? 0 : 1)
      .input("date_of_entry", sql.Date, new Date()).query(`
        INSERT INTO dbo.enterprise (
          name, short_name, business_identity, business_type, entity_type, description,
          cr_code, date_of_establishment, cin, pan, tan, gst_type, gst_issue_date,
          trade_license, address, city, state, country, pincode,
          phone_number, email, website, currency, fiscal_year_start,
          logo, belongs_to, discontinue, date_of_entry
        ) VALUES (
          @name, @short_name, @business_identity, @business_type, @entity_type, @description,
          @cr_code, @date_of_establishment, @cin, @pan, @tan, @gst_type, @gst_issue_date,
          @trade_license, @address, @city, @state, @country, @pincode,
          @phone_number, @email, @website, @currency, @fiscal_year_start,
          @logo, @belongs_to, @discontinue, @date_of_entry
        )
      `);
    await bumpCacheVersion("enterprises");
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT — updates enterprise row
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
      .input("description", sql.NVarChar(sql.MAX), f.legalName || null)
      .input("cr_code", sql.NVarChar(50), f.industry || null)
      .input("date_of_establishment", sql.Date, f.incorporationDate || null)
      .input("cin", sql.NVarChar(50), f.cinNumber || null)
      .input("pan", sql.NVarChar(20), f.panNumber || null)
      .input("tan", sql.NVarChar(15), f.tanNumber || null)
      .input("gst_type", sql.NVarChar(50), f.gstType || null)
      .input("gst_issue_date", sql.Date, f.gstDate || null)
      .input("trade_license", sql.NVarChar(100), f.tradeLicenseNo || null)
      .input("address", sql.NVarChar(sql.MAX), f.registeredAddress || null)
      .input("city", sql.NVarChar(100), f.city || null)
      .input("state", sql.NVarChar(100), f.state || null)
      .input("country", sql.NVarChar(100), f.country || null)
      .input("pincode", sql.NVarChar(10), f.pincode || null)
      .input("phone_number", sql.NVarChar(20), f.phone || null)
      .input("email", sql.NVarChar(255), f.email || null)
      .input("website", sql.NVarChar(255), f.website || null)
      .input("currency", sql.NVarChar(10), f.currency || "INR")
      .input("fiscal_year_start", sql.NVarChar(20), f.fiscalYearStart || null)
      .input("logo", sql.NVarChar(sql.MAX), f.logoUrl || null)
      .input("belongs_to", sql.NVarChar(50), f.belongsTo || null)
      .input("discontinue", sql.Bit, f.isActive ? 0 : 1).query(`
        UPDATE dbo.enterprise SET
          name=@name, short_name=@short_name, business_identity=@business_identity,
          entity_type=@entity_type, description=@description, cr_code=@cr_code,
          date_of_establishment=@date_of_establishment, cin=@cin, pan=@pan, tan=@tan,
          gst_type=@gst_type, gst_issue_date=@gst_issue_date, trade_license=@trade_license,
          address=@address, city=@city, state=@state, country=@country, pincode=@pincode,
          phone_number=@phone_number, email=@email, website=@website,
          currency=@currency, fiscal_year_start=@fiscal_year_start,
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
