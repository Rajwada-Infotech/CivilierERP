const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));
const { getPool, sql } = require("../db");
const allowRoles = require("../middleware/role");
const { bumpCacheVersion } = require("../redis");
const { cache } = require("../middleware/cache");

const adminOnly = allowRoles("admin", "super_admin", "dba");
const GST_STATUSES = new Set(["Registered", "Unregistered"]);
const GSTIN_REGEX =
  /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

function normalizeCompanyGst(f) {
  const gstType = f.gstType || "Unregistered";
  if (!GST_STATUSES.has(gstType)) {
    return { error: "GST Status must be Registered or Unregistered" };
  }

  if (gstType === "Unregistered") {
    return { gstType, gstNumber: null, gstDate: null };
  }

  const gstNumber = String(f.gstNumber || "")
    .trim()
    .toUpperCase();
  const gstDate = f.gstDate || null;

  if (!gstNumber) {
    return { error: "GST Number is required for registered companies" };
  }
  if (!gstDate) {
    return {
      error: "GST Registration Date is required for registered companies",
    };
  }
  if (!GSTIN_REGEX.test(gstNumber)) {
    return { error: "Enter a valid GSTIN" };
  }

  return { gstType, gstNumber, gstDate };
}

// GET all — reads from enterprise where business_type = 'C'
router.get(
  "/",
  cache("company-master", 300, { shared: true }),
  async (req, res) => {
    try {
      const pool = getPool();
      const result = await pool.request().query(`
      SELECT
        id                        AS Id,
        business_identity         AS Code,
        name                      AS Name,
        description               AS LegalName,
        short_name                AS ShortName,
        entity_type               AS Type,
        cr_code                   AS Industry,
        date_of_establishment     AS IncorporationDate,
        cin                       AS CIN,
        pan                       AS PAN,
        tan                       AS TAN,
        CASE
          WHEN gst_type IN ('Registered', 'Unregistered') THEN gst_type
          WHEN gst_type IS NOT NULL AND gst_type <> '' AND gst_type <> 'Unregistered' THEN 'Registered'
          WHEN b_sub_identity_type IS NOT NULL OR gst_issue_date IS NOT NULL THEN 'Registered'
          ELSE 'Unregistered'
        END                       AS GSTType,
        b_sub_identity_type       AS GST,
        gst_issue_date            AS GSTDate,
        trade_license             AS TradeLicenseNo,
        rera_date                 AS TradeLicenseDate,
        address                   AS RegisteredAddress,
        address_line2             AS Address2,
        city          AS City,
        state         AS State,
        country       AS Country,
        pincode       AS Pincode,
        phone_number              AS Phone,
        fax                       AS Fax,
        email         AS Email,
        website       AS Website,
        authorized_capital        AS AuthorizedCapital,
        paid_up_capital           AS PaidUpCapital,
        currency,
        fiscal_year_start         AS FiscalYearStart,
        auditor_name              AS AuditorName,
        CASE WHEN discontinue = 1 THEN 0 ELSE 1 END AS IsActive,
        remarks                   AS Remarks,
        logo                      AS LogoUrl,
        status,
        belongs_to
      FROM dbo.enterprise
      WHERE business_type = 'C'
      ORDER BY name
    `);
      res.json(result.recordset);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },
);

// POST — inserts into enterprise with business_type = 'C'
router.post("/", adminOnly, async (req, res) => {
  const f = req.body;
  const gst = normalizeCompanyGst(f);
  if (gst.error) return res.status(400).json({ error: gst.error });

  try {
    const pool = getPool();
    await pool
      .request()
      .input("name", sql.NVarChar(255), f.name || null)
      .input("short_name", sql.NVarChar(100), f.shortName || null)
      .input("business_identity", sql.NVarChar(100), f.code || null)
      .input("business_type", sql.NVarChar(100), "C")
      .input("entity_type", sql.NVarChar(50), f.type || null)
      .input("description", sql.NVarChar(sql.MAX), f.legalName || null)
      .input("cr_code", sql.NVarChar(50), f.industry || null)
      .input("date_of_establishment", sql.Date, f.incorporationDate || null)
      .input("cin", sql.NVarChar(50), f.cinNumber || null)
      .input("pan", sql.NVarChar(20), f.panNumber || null)
      .input("tan", sql.NVarChar(15), f.tanNumber || null)
      .input("gst_type", sql.NVarChar(50), gst.gstType)
      .input("b_sub_identity_type", sql.NVarChar(100), gst.gstNumber)
      .input("gst_issue_date", sql.Date, gst.gstDate)
      .input("trade_license", sql.NVarChar(100), f.tradeLicenseNo || null)
      .input("rera_date", sql.Date, f.tradeLicenseDate || null)
      .input("address", sql.NVarChar(sql.MAX), f.registeredAddress || null)
      .input("city", sql.NVarChar(100), f.city || null)
      .input("state", sql.NVarChar(100), f.state || null)
      .input("country", sql.NVarChar(100), f.country || null)
      .input("pincode", sql.NVarChar(10), f.pincode || null)
      .input("phone_number", sql.NVarChar(20), f.phone || null)
      .input("fax", sql.NVarChar(30), f.fax || null)
      .input("email", sql.NVarChar(255), f.email || null)
      .input("website", sql.NVarChar(255), f.website || null)
      .input(
        "authorized_capital",
        sql.Decimal(18, 2),
        f.authorizedCapital ? parseFloat(f.authorizedCapital) : null,
      )
      .input(
        "paid_up_capital",
        sql.Decimal(18, 2),
        f.paidUpCapital ? parseFloat(f.paidUpCapital) : null,
      )
      .input("currency", sql.NVarChar(10), f.currency || "INR")
      .input("fiscal_year_start", sql.NVarChar(20), f.fiscalYearStart || null)
      .input("auditor_name", sql.NVarChar(255), f.auditorName || null)
      .input("remarks", sql.NVarChar(500), f.remarks || null)
      .input("logo", sql.NVarChar(sql.MAX), f.logoUrl || null)
      .input(
        "belongs_to",
        sql.NVarChar(50),
        f.belongsTo ? String(f.belongsTo) : null,
      )
      .input("discontinue", sql.Bit, f.isActive ? 0 : 1)
      .input("status", sql.NVarChar(50), f.isActive ? "Active" : "Inactive")
      .input("date_of_entry", sql.Date, new Date()).query(`
        INSERT INTO dbo.enterprise (
          name, short_name, business_identity, business_type, entity_type, description,
          cr_code, date_of_establishment, cin, pan, tan, gst_type, b_sub_identity_type, gst_issue_date,
          trade_license, rera_date, address, city, state, country, pincode,
          phone_number, fax, email, website,
          authorized_capital, paid_up_capital, currency, fiscal_year_start, auditor_name,
          remarks, logo, belongs_to, discontinue, status, date_of_entry
        ) VALUES (
          @name, @short_name, @business_identity, @business_type, @entity_type, @description,
          @cr_code, @date_of_establishment, @cin, @pan, @tan, @gst_type, @b_sub_identity_type, @gst_issue_date,
          @trade_license, @rera_date, @address, @city, @state, @country, @pincode,
          @phone_number, @fax, @email, @website,
          @authorized_capital, @paid_up_capital, @currency, @fiscal_year_start, @auditor_name,
          @remarks, @logo, @belongs_to, @discontinue, @status, @date_of_entry
        )
      `);
    await bumpCacheVersion("enterprises");
    await bumpCacheVersion("company-master");
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT — updates enterprise row
router.put("/:id", adminOnly, async (req, res) => {
  const f = req.body;
  const gst = normalizeCompanyGst(f);
  if (gst.error) return res.status(400).json({ error: gst.error });

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
      .input("gst_type", sql.NVarChar(50), gst.gstType)
      .input("b_sub_identity_type", sql.NVarChar(100), gst.gstNumber)
      .input("gst_issue_date", sql.Date, gst.gstDate)
      .input("trade_license", sql.NVarChar(100), f.tradeLicenseNo || null)
      .input("rera_date", sql.Date, f.tradeLicenseDate || null)
      .input("address", sql.NVarChar(sql.MAX), f.registeredAddress || null)
      .input("city", sql.NVarChar(100), f.city || null)
      .input("state", sql.NVarChar(100), f.state || null)
      .input("country", sql.NVarChar(100), f.country || null)
      .input("pincode", sql.NVarChar(10), f.pincode || null)
      .input("phone_number", sql.NVarChar(20), f.phone || null)
      .input("fax", sql.NVarChar(30), f.fax || null)
      .input("email", sql.NVarChar(255), f.email || null)
      .input("website", sql.NVarChar(255), f.website || null)
      .input(
        "authorized_capital",
        sql.Decimal(18, 2),
        f.authorizedCapital ? parseFloat(f.authorizedCapital) : null,
      )
      .input(
        "paid_up_capital",
        sql.Decimal(18, 2),
        f.paidUpCapital ? parseFloat(f.paidUpCapital) : null,
      )
      .input("currency", sql.NVarChar(10), f.currency || "INR")
      .input("fiscal_year_start", sql.NVarChar(20), f.fiscalYearStart || null)
      .input("auditor_name", sql.NVarChar(255), f.auditorName || null)
      .input("remarks", sql.NVarChar(500), f.remarks || null)
      .input("logo", sql.NVarChar(sql.MAX), f.logoUrl || null)
      .input(
        "belongs_to",
        sql.NVarChar(50),
        f.belongsTo ? String(f.belongsTo) : null,
      )
      .input("discontinue", sql.Bit, f.isActive ? 0 : 1)
      .input("status", sql.NVarChar(50), f.isActive ? "Active" : "Inactive")
      .query(`
        UPDATE dbo.enterprise SET
          name=@name, short_name=@short_name, business_identity=@business_identity,
          entity_type=@entity_type, description=@description, cr_code=@cr_code,
          date_of_establishment=@date_of_establishment,
          cin=@cin, pan=@pan, tan=@tan,
          gst_type=@gst_type, b_sub_identity_type=@b_sub_identity_type, gst_issue_date=@gst_issue_date,
          trade_license=@trade_license, rera_date=@rera_date,
          address=@address, city=@city, state=@state, country=@country, pincode=@pincode,
          phone_number=@phone_number, fax=@fax, email=@email, website=@website,
          authorized_capital=@authorized_capital, paid_up_capital=@paid_up_capital,
          currency=@currency, fiscal_year_start=@fiscal_year_start, auditor_name=@auditor_name,
          remarks=@remarks, logo=@logo, belongs_to=@belongs_to, discontinue=@discontinue, status=@status
        WHERE id=@id AND business_type='C'
      `);
    await bumpCacheVersion("enterprises");
    await bumpCacheVersion("company-master");
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
        "UPDATE dbo.enterprise SET discontinue=1 WHERE id=@id AND business_type='C'",
      );
    await bumpCacheVersion("enterprises");
    await bumpCacheVersion("company-master");
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

