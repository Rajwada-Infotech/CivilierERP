const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const allowRoles = require("../middleware/role");
const { bumpCacheVersion } = require("../redis");
const { cache } = require("../middleware/cache");

const adminOnly = allowRoles("admin", "super_admin", "dba");
const GST_STATUSES = new Set(["Registered", "Unregistered"]);
const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

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
router.get("/", cache("company-master", 60, { shared: true }), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT
        c.id                        AS Id,
        c.business_identity         AS Code,
        c.name                      AS Name,
        c.description               AS LegalName,
        c.short_name                AS ShortName,
        c.entity_type               AS Type,
        c.cr_code                   AS Industry,
        c.date_of_establishment     AS IncorporationDate,
        c.cin                       AS CIN,
        c.pan_no                    AS PAN,
        c.tan                       AS TAN,
        CASE
          WHEN c.gst_type IN ('Registered', 'Unregistered') THEN c.gst_type
          WHEN c.gst_type IS NOT NULL AND c.gst_type <> '' AND c.gst_type <> 'Unregistered' THEN 'Registered'
          WHEN c.gst_no IS NOT NULL OR c.gst_issue_date IS NOT NULL THEN 'Registered'
          ELSE 'Unregistered'
        END                       AS GSTType,
        c.gst_no                  AS GST,
        c.gst_issue_date            AS GSTDate,
        c.trade_license             AS TradeLicenseNo,
        c.rera_date                 AS TradeLicenseDate,
        c.address                   AS RegisteredAddress,
        c.address_line2             AS Address2,
        c.city          AS City,
        c.state         AS State,
        c.country       AS Country,
        c.pincode       AS Pincode,
        c.phone_number              AS Phone,
        c.fax                       AS Fax,
        c.email         AS Email,
        c.website       AS Website,
        c.authorized_capital        AS AuthorizedCapital,
        c.paid_up_capital           AS PaidUpCapital,
        c.currency,
        c.fiscal_year_start         AS FiscalYearStart,
        c.auditor_name              AS AuditorName,
        CASE WHEN c.discontinue = 1 THEN 0 ELSE 1 END AS IsActive,
        c.remarks                   AS Remarks,
        c.logo                      AS LogoUrl,
        c.status,
        COALESCE(parent.id, c.enterprise_id)     AS EnterpriseId,
        COALESCE(parent.name, c.belongs_to)      AS belongs_to
      FROM dbo.enterprise c WITH (NOLOCK)
      LEFT JOIN dbo.enterprise parent WITH (NOLOCK)
        ON parent.id = c.enterprise_id AND parent.business_type = 'E'
      WHERE c.business_type = 'C'
        AND (c.discontinue IS NULL OR c.discontinue = 0)
      ORDER BY c.name
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST — inserts into enterprise with business_type = 'C'
router.post("/", adminOnly, async (req, res) => {
  const f = req.body;
  const gst = normalizeCompanyGst(f);
  if (gst.error) return res.status(400).json({ error: gst.error });

  try {
    const pool = getPool();
    const enterpriseId = f.belongsTo ? parseInt(f.belongsTo, 10) : null;
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
      .input("pan_no", sql.NVarChar(20), f.panNumber || null)
      .input("tan", sql.NVarChar(15), f.tanNumber || null)
      .input("gst_type", sql.NVarChar(50), gst.gstType)
      .input("gst_no", sql.NVarChar(20), gst.gstNumber)
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
        "enterprise_id",
        sql.Int,
        Number.isInteger(enterpriseId) ? enterpriseId : null,
      )
      .input("discontinue", sql.Bit, f.isActive ? 0 : 1)
      .input("status", sql.NVarChar(50), f.isActive ? "Active" : "Inactive")
      .input("date_of_entry", sql.Date, new Date()).query(`
        INSERT INTO dbo.enterprise (
          name, short_name, business_identity, business_type, entity_type, description,
          cr_code, date_of_establishment, cin, pan_no, tan, gst_type, gst_no, gst_issue_date,
          trade_license, rera_date, address, city, state, country, pincode,
          phone_number, fax, email, website,
          authorized_capital, paid_up_capital, currency, fiscal_year_start, auditor_name,
          remarks, logo, enterprise_id, belongs_to, discontinue, status, date_of_entry
        ) VALUES (
          @name, @short_name, @business_identity, @business_type, @entity_type, @description,
          @cr_code, @date_of_establishment, @cin, @pan_no, @tan, @gst_type, @gst_no, @gst_issue_date,
          @trade_license, @rera_date, @address, @city, @state, @country, @pincode,
          @phone_number, @fax, @email, @website,
          @authorized_capital, @paid_up_capital, @currency, @fiscal_year_start, @auditor_name,
          @remarks, @logo, @enterprise_id,
          (SELECT name FROM dbo.enterprise WITH (NOLOCK) WHERE id = @enterprise_id AND business_type = 'E'),
          @discontinue, @status, @date_of_entry
        )
      `);
    await bumpCacheVersion("enterprises");
    await bumpCacheVersion("company-master");

    // Auto-generate capital account structure based on entity type
    if (f.type) {
      try {
        const { ensureCapitalStructure } = require("../services/capitalSystemGenerator");
        await ensureCapitalStructure(pool, f.type);
      } catch (capErr) {
        console.warn("[CompanyMaster] Capital structure generation warning:", capErr.message);
      }
    }

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
    const enterpriseId = f.belongsTo ? parseInt(f.belongsTo, 10) : null;
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
      .input("pan_no", sql.NVarChar(20), f.panNumber || null)
      .input("tan", sql.NVarChar(15), f.tanNumber || null)
      .input("gst_type", sql.NVarChar(50), gst.gstType)
      .input("gst_no", sql.NVarChar(20), gst.gstNumber)
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
        "enterprise_id",
        sql.Int,
        Number.isInteger(enterpriseId) ? enterpriseId : null,
      )
      .input("discontinue", sql.Bit, f.isActive ? 0 : 1)
      .input("status", sql.NVarChar(50), f.isActive ? "Active" : "Inactive")
      .query(`
        UPDATE dbo.enterprise SET
          name=@name, short_name=@short_name, business_identity=@business_identity,
          entity_type=@entity_type, description=@description, cr_code=@cr_code,
          date_of_establishment=@date_of_establishment,
          cin=@cin, pan_no=@pan_no, tan=@tan,
          gst_type=@gst_type, gst_no=@gst_no, gst_issue_date=@gst_issue_date,
          trade_license=@trade_license, rera_date=@rera_date,
          address=@address, city=@city, state=@state, country=@country, pincode=@pincode,
          phone_number=@phone_number, fax=@fax, email=@email, website=@website,
          authorized_capital=@authorized_capital, paid_up_capital=@paid_up_capital,
          currency=@currency, fiscal_year_start=@fiscal_year_start, auditor_name=@auditor_name,
          remarks=@remarks, logo=@logo,
          enterprise_id=@enterprise_id,
          belongs_to=(SELECT name FROM dbo.enterprise WHERE id = @enterprise_id AND business_type = 'E'),
          discontinue=@discontinue, status=@status
        WHERE id=@id AND business_type='C'
      `);
    await bumpCacheVersion("enterprises");
    await bumpCacheVersion("company-master");

    // Auto-generate capital account structure based on entity type
    if (f.type) {
      try {
        const { ensureCapitalStructure } = require("../services/capitalSystemGenerator");
        await ensureCapitalStructure(pool, f.type);
      } catch (capErr) {
        console.warn("[CompanyMaster] Capital structure generation warning:", capErr.message);
      }
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE — blocked if company has linked projects, POs, or WOs
router.delete("/:id", adminOnly, async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid company ID" });

  try {
    const pool = getPool();

    // 1. Confirm the record exists
    const companyRow = await pool
      .request()
      .input("id", sql.Int, id)
      .query(
        "SELECT id, name FROM dbo.enterprise WHERE id=@id AND business_type='C'",
      );

    if (!companyRow.recordset.length)
      return res.status(404).json({ error: "Company not found" });

    // 2. Check for linked projects, POs, and WOs
    const usageCheck = await pool.request().input("CompanyId", sql.Int, id)
      .query(`
      SELECT
        (SELECT COUNT(*) FROM dbo.enterprise      WHERE company_id   = @CompanyId AND business_type = 'P') AS ProjectCount,
        (SELECT COUNT(*) FROM dbo.PurchaseOrders  WHERE CompanyId    = @CompanyId) AS POCount,
        (SELECT COUNT(*) FROM dbo.WorkOrderHeader      WHERE CompanyId    = @CompanyId) AS WOCount
    `);

    const { ProjectCount, POCount, WOCount } = usageCheck.recordset[0];
    const linked = [];
    if (ProjectCount > 0)
      linked.push(`${ProjectCount} Project${ProjectCount > 1 ? "s" : ""}`);
    if (POCount > 0)
      linked.push(`${POCount} Purchase Order${POCount > 1 ? "s" : ""}`);
    if (WOCount > 0)
      linked.push(`${WOCount} Work Order${WOCount > 1 ? "s" : ""}`);

    if (linked.length > 0) {
      return res.status(409).json({
        error: "Cannot delete company",
        reason: `This company has ${linked.join(", ")} linked to it and cannot be deleted.`,
      });
    }

    // 3. Safe to soft-delete
    await pool
      .request()
      .input("id", sql.Int, id)
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
