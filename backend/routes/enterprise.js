const allowRoles = require("../middleware/role");
const express = require("express");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");

// GET all
router.get(
  "/",
  cache("enterprises", 60, { shared: true }),
  async (req, res) => {
    try {
      const pool = getPool();
      const request = pool.request();

      // Allow filtering by business_type (e.g. ?business_type=S for suppliers,
      // ?business_type=C for companies). Defaults to 'E' (Enterprises) when omitted.
      const businessType = req.query.business_type
        ? String(req.query.business_type).trim().toUpperCase()
        : "E";

      request.input("businessType", sql.NVarChar(10), businessType);

      const result = await request.query(`
      SELECT
        id, name, short_name, business_identity, entity_type,
        gst_no, belongs_to,
        address, address_line2, address_line3, city, state, country, pincode,
        phone_number, email, website, fax,
        pan_no AS pan, cin, tan, gst_type, gst_issue_date, trade_license,
        currency, fiscal_year_start,
        start_date, start_fin_year, end_date, date_of_entry, date_of_establishment,
        CASE WHEN discontinue = 1 THEN 0 ELSE 1 END AS IsActive,
        discontinue, status, cr_code, rera_no, rera_date,
        latitude, longitude,
        cost_center, profit_center,
        auditor_name, authorized_capital, paid_up_capital,
        client_name, client_code, team_size,
        jv_enabled, jv_company_name,
        remarks, description, tds_limit,
        contact_person, phone,
        business_type,
        logo
      FROM dbo.enterprise WITH (NOLOCK)
      WHERE business_type = @businessType
         OR (business_type IS NULL AND @businessType = 'E')
      ORDER BY name
    `);
      res.json(result.recordset);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },
);

// Bust enterprise cache on module load so pre-existing DB rows are always visible
// after a server restart (avoids serving a stale empty-array from Redis).
bumpCacheVersion("enterprises").catch(() => {});

// ADD
router.post("/", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const {
    name,
    short_name,
    entity_type,
    business_identity,
    belongs_to,
    logo,
    date_of_entry,
    date_of_establishment,
    start_date,
    start_fin_year,
    currency,
    pan,
    pan_no,
    gst_no,
    cin,
    address,
    address_line2,
    city,
    state,
    country,
    pincode,
    email,
    phone_number,
    website,
    latitude,
    longitude,
    tds_limit,
    description,
    gst_type,
    gst_issue_date,
    tan,
    rera_no,
    rera_date,
    trade_license,
    status,
    cr_code,
    discontinue,
    fiscal_year_start,
    cost_center,
    profit_center,
  } = req.body;
  const panValue = pan || pan_no || null;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("name", sql.NVarChar(255), name || null)
      .input("short_name", sql.NVarChar(100), short_name || null)
      .input("entity_type", sql.NVarChar(100), entity_type || null)
      .input("business_identity", sql.NVarChar(100), business_identity || null)
      .input("business_type", sql.NVarChar(100), "E")
      .input("gst_no", sql.NVarChar(50), gst_no ? String(gst_no).trim() : null)
      .input("belongs_to", sql.Int, belongs_to || null)
      .input("logo", sql.NVarChar(sql.MAX), logo || null)
      .input("date_of_entry", sql.Date, date_of_entry || null)
      .input("date_of_establishment", sql.Date, date_of_establishment || null)
      .input("start_date", sql.Date, start_date || null)
      .input("start_fin_year", sql.NVarChar(50), start_fin_year || null)
      .input("currency", sql.NVarChar(10), currency || null)
      .input("pan", sql.NVarChar(20), panValue)
      .input("pan_no", sql.NVarChar(20), panValue)
      .input("cin", sql.NVarChar(50), cin || null)
      .input("address", sql.NVarChar(sql.MAX), address || null)
      .input("address_line2", sql.NVarChar(sql.MAX), address_line2 || null)
      .input("city", sql.NVarChar(100), city || null)
      .input("state", sql.NVarChar(100), state || null)
      .input("country", sql.NVarChar(100), country || null)
      .input("pincode", sql.NVarChar(20), pincode || null)
      .input("email", sql.NVarChar(255), email || null)
      .input("phone_number", sql.NVarChar(20), phone_number || null)
      .input("website", sql.NVarChar(255), website || null)
      .input("latitude", sql.Decimal(10, 7), latitude || null)
      .input("longitude", sql.Decimal(10, 7), longitude || null)
      .input("tds_limit", sql.Decimal(18, 2), tds_limit || null)
      .input("description", sql.NVarChar(sql.MAX), description || null)
      .input("gst_type", sql.NVarChar(50), gst_type || null)
      .input("gst_issue_date", sql.Date, gst_issue_date || null)
      .input("tan", sql.NVarChar(20), tan || null)
      .input("rera_no", sql.NVarChar(100), rera_no || null)
      .input("rera_date", sql.Date, rera_date || null)
      .input("trade_license", sql.NVarChar(100), trade_license || null)
      .input("status", sql.NVarChar(50), status || null)
      .input("cr_code", sql.NVarChar(50), cr_code || null)
      .input("discontinue", sql.Bit, discontinue ? 1 : 0)
      .input("fiscal_year_start", sql.NVarChar(50), fiscal_year_start || null)
      .input("cost_center", sql.NVarChar(100), cost_center || null)
      .input("profit_center", sql.NVarChar(100), profit_center || null).query(`
        INSERT INTO dbo.enterprise (
          name, short_name, entity_type,
          business_identity, business_type, gst_no,
          belongs_to, logo, date_of_entry, date_of_establishment,
          start_date, start_fin_year,
          currency, pan_no, cin, address, address_line2, city, state, country, pincode,
          email, phone_number, website, latitude, longitude,
          tds_limit, description, gst_type, gst_issue_date,
          tan, rera_no, rera_date, trade_license,
          status, cr_code, discontinue,
          fiscal_year_start, cost_center, profit_center
        ) VALUES (
          @name, @short_name, @entity_type,
          @business_identity, @business_type, @gst_no,
          @belongs_to, @logo, @date_of_entry, @date_of_establishment,
          @start_date, @start_fin_year,
          @currency, @pan_no, @cin, @address, @address_line2, @city, @state, @country, @pincode,
          @email, @phone_number, @website, @latitude, @longitude,
          @tds_limit, @description, @gst_type, @gst_issue_date,
          @tan, @rera_no, @rera_date, @trade_license,
          @status, @cr_code, @discontinue,
          @fiscal_year_start, @cost_center, @profit_center
        )
      `);
    await Promise.all([
      bumpCacheVersion("enterprises"),
      bumpCacheVersion("company-master"),
      bumpCacheVersion("project-master"),
    ]);
    res.json({ message: "Enterprise added successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// UPDATE
router.put("/:id", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const { id } = req.params;
  const {
    name,
    short_name,
    entity_type,
    business_identity,
    belongs_to,
    logo,
    date_of_entry,
    date_of_establishment,
    start_date,
    start_fin_year,
    currency,
    pan,
    pan_no,
    gst_no,
    cin,
    address,
    address_line2,
    city,
    state,
    country,
    pincode,
    email,
    phone_number,
    website,
    latitude,
    longitude,
    tds_limit,
    description,
    gst_type,
    gst_issue_date,
    tan,
    rera_no,
    rera_date,
    trade_license,
    status,
    cr_code,
    discontinue,
    fiscal_year_start,
    cost_center,
    profit_center,
  } = req.body;
  const panValue = pan || pan_no || null;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("id", sql.Int, id)
      .input("name", sql.NVarChar(255), name || null)
      .input("short_name", sql.NVarChar(100), short_name || null)
      .input("entity_type", sql.NVarChar(100), entity_type || null)
      .input("business_identity", sql.NVarChar(100), business_identity || null)
      .input("business_type", sql.NVarChar(100), "E")
      .input("gst_no", sql.NVarChar(50), gst_no ? String(gst_no).trim() : null)
      .input("belongs_to", sql.Int, belongs_to || null)
      .input("logo", sql.NVarChar(sql.MAX), logo || null)
      .input("date_of_entry", sql.Date, date_of_entry || null)
      .input("date_of_establishment", sql.Date, date_of_establishment || null)
      .input("start_date", sql.Date, start_date || null)
      .input("start_fin_year", sql.NVarChar(50), start_fin_year || null)
      .input("currency", sql.NVarChar(10), currency || null)
      .input("pan_no", sql.NVarChar(20), panValue)
      .input("cin", sql.NVarChar(50), cin || null)
      .input("address", sql.NVarChar(sql.MAX), address || null)
      .input("address_line2", sql.NVarChar(sql.MAX), address_line2 || null)
      .input("city", sql.NVarChar(100), city || null)
      .input("state", sql.NVarChar(100), state || null)
      .input("country", sql.NVarChar(100), country || null)
      .input("pincode", sql.NVarChar(20), pincode || null)
      .input("email", sql.NVarChar(255), email || null)
      .input("phone_number", sql.NVarChar(20), phone_number || null)
      .input("website", sql.NVarChar(255), website || null)
      .input("latitude", sql.Decimal(10, 7), latitude || null)
      .input("longitude", sql.Decimal(10, 7), longitude || null)
      .input("tds_limit", sql.Decimal(18, 2), tds_limit || null)
      .input("description", sql.NVarChar(sql.MAX), description || null)
      .input("gst_type", sql.NVarChar(50), gst_type || null)
      .input("gst_issue_date", sql.Date, gst_issue_date || null)
      .input("tan", sql.NVarChar(20), tan || null)
      .input("rera_no", sql.NVarChar(100), rera_no || null)
      .input("rera_date", sql.Date, rera_date || null)
      .input("trade_license", sql.NVarChar(100), trade_license || null)
      .input("status", sql.NVarChar(50), status || null)
      .input("cr_code", sql.NVarChar(50), cr_code || null)
      .input("discontinue", sql.Bit, discontinue ? 1 : 0)
      .input("fiscal_year_start", sql.NVarChar(50), fiscal_year_start || null)
      .input("cost_center", sql.NVarChar(100), cost_center || null)
      .input("profit_center", sql.NVarChar(100), profit_center || null).query(`
        UPDATE dbo.enterprise SET
          name=@name, short_name=@short_name, entity_type=@entity_type,
          business_identity=@business_identity, business_type='E',
          gst_no=@gst_no, belongs_to=@belongs_to, logo=@logo,
          date_of_entry=@date_of_entry, date_of_establishment=@date_of_establishment,
          start_date=@start_date, start_fin_year=@start_fin_year,
          currency=@currency, pan_no=@pan_no, cin=@cin,
          address=@address, address_line2=@address_line2, city=@city, state=@state,
          country=@country, pincode=@pincode,
          email=@email, phone_number=@phone_number, website=@website,
          latitude=@latitude, longitude=@longitude,
          tds_limit=@tds_limit, description=@description,
          gst_type=@gst_type, gst_issue_date=@gst_issue_date,
          tan=@tan, rera_no=@rera_no, rera_date=@rera_date, trade_license=@trade_license,
          status=@status, cr_code=@cr_code, discontinue=@discontinue,
          fiscal_year_start=@fiscal_year_start, cost_center=@cost_center, profit_center=@profit_center
        WHERE id=@id AND (business_type='E' OR business_type IS NULL)
      `);
    await Promise.all([
      bumpCacheVersion("enterprises"),
      bumpCacheVersion("company-master"),
      bumpCacheVersion("project-master"),
    ]);
    res.json({ message: "Enterprise updated successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE — blocked if enterprise has linked companies or projects
router.delete("/:id", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id))
    return res.status(400).json({ error: "Invalid enterprise ID" });

  try {
    const pool = getPool();

    // 1. Confirm the record exists
    const entRow = await pool
      .request()
      .input("id", sql.Int, id)
      .query(
        "SELECT id, name FROM dbo.enterprise WHERE id=@id AND (business_type='E' OR business_type IS NULL)",
      );

    if (!entRow.recordset.length)
      return res.status(404).json({ error: "Enterprise not found" });

    // 2. Check for linked companies and projects
    const usageCheck = await pool
      .request()
      .input("EnterpriseId", sql.Int, id)
      .input("EnterpriseName", sql.NVarChar(255), entRow.recordset[0].name)
      .query(`
      SELECT
        (SELECT COUNT(*) FROM dbo.enterprise
         WHERE business_type = 'C'
           AND (
             enterprise_id = @EnterpriseId
             OR LTRIM(RTRIM(ISNULL(belongs_to, ''))) = LTRIM(RTRIM(ISNULL(@EnterpriseName, '')))
           )) AS CompanyCount,
        (SELECT COUNT(*) FROM dbo.enterprise WHERE enterprise_id = @EnterpriseId AND business_type = 'P') AS ProjectCount
    `);

    const { CompanyCount, ProjectCount } = usageCheck.recordset[0];
    const linked = [];
    if (CompanyCount > 0)
      linked.push(`${CompanyCount} Company${CompanyCount > 1 ? "s" : ""}`);
    if (ProjectCount > 0)
      linked.push(`${ProjectCount} Project${ProjectCount > 1 ? "s" : ""}`);

    if (linked.length > 0) {
      return res.status(409).json({
        error: "Cannot delete enterprise",
        reason: `This enterprise has ${linked.join(" and ")} linked to it and cannot be deleted.`,
      });
    }

    // 3. Safe to delete
    await pool
      .request()
      .input("id", sql.Int, id)
      .query(
        "DELETE FROM dbo.enterprise WHERE id=@id AND (business_type='E' OR business_type IS NULL)",
      );

    await bumpCacheVersion("enterprises");
    res.json({ message: "Enterprise deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /by-id/:id — fetch a single enterprise/company record by ID (any business_type)
router.get("/by-id/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  try {
    const { getPool, sql } = require("../db");
    const pool = getPool();
    const result = await pool
      .request()
      .input("id", sql.Int, id)
      .query(
        "SELECT id, name, short_name, logo, email, phone_number, address, address_line2, city, state, pincode, gst_no, gst_type, pan_no AS pan FROM dbo.enterprise WHERE id = @id",
      );
    if (!result.recordset.length)
      return res.status(404).json({ error: "Not found" });
    res.json(result.recordset[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET options for FK dropdowns
// Supports: ?type=<entity_type>  (legacy)
//           ?business_type=C     (filter companies by business_type column)
router.get("/options", async (req, res) => {
  try {
    const pool = getPool();
    const request = pool.request();
    const conditions = [];

    if (req.query.type) {
      conditions.push("entity_type = @entityType");
      request.input("entityType", sql.NVarChar(50), req.query.type);
    }
    if (req.query.business_type) {
      conditions.push("business_type = @businessType");
      request.input("businessType", sql.NVarChar(100), req.query.business_type);
    }
    // Scope projects (business_type=P) to a single parent company — the
    // frontend has always sent this (e.g. GRN.tsx's Company→Project
    // cascade), but it was silently ignored here, so every project showed
    // regardless of which company was selected.
    if (req.query.enterprise_id) {
      conditions.push("company_id = @companyId");
      request.input("companyId", sql.Int, parseInt(req.query.enterprise_id, 10));
    }

    // Always exclude soft-deleted rows from dropdown options
    conditions.push("(discontinue IS NULL OR discontinue = 0)");

    let query =
      "SELECT id, name AS label, belongs_to, company_id, enterprise_id FROM dbo.enterprise";
    query += " WHERE " + conditions.join(" AND ");
    query += " ORDER BY name";

    const result = await request.query(query);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch enterprise options" });
  }
});

module.exports = router;
