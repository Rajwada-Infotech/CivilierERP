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
        address               AS Location,
        currency              AS Currency,
        status                AS Status,
        rera_no               AS Priority,
        start_date            AS StartDate,
        end_date              AS EndDate,
        client_name           AS ClientName,
        client_code           AS ClientCode,
        team_size             AS TeamSize,
        pan                   AS Remarks,
        CASE WHEN discontinue = 1 THEN 0 ELSE 1 END AS IsActive,
        logo                  AS ProjectImage,
        belongs_to,
        b_sub_identity_type,
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
      .input("address", sql.NVarChar(sql.MAX), f.location || null)
      .input("currency", sql.NVarChar(10), f.currency || "INR")
      .input("status", sql.NVarChar(50), f.status || "Planning")
      .input("rera_no", sql.NVarChar(100), f.priority || null)
      .input("start_date", sql.Date, f.startDate || null)
      .input("end_date", sql.Date, f.endDate || null)
      .input("client_name", sql.NVarChar(255), f.clientName || null)
      .input("client_code", sql.NVarChar(50), f.clientCode || null)
      .input("team_size", sql.Int, f.teamSize ? parseInt(f.teamSize) : null)
      .input("pan", sql.NVarChar(20), f.remarks || null)
      .input("logo", sql.NVarChar(sql.MAX), f.projectImage || null)
      // Enterprise stored in belongs_to, Company stored in b_sub_identity_type — independent
      .input("belongs_to", sql.NVarChar(255), f.enterpriseName || null)
      .input("b_sub_identity_type", sql.NVarChar(255), f.companyName || null)
      .input("discontinue", sql.Bit, f.isActive ? 0 : 1)
      .input("date_of_entry", sql.Date, new Date()).query(`
        INSERT INTO dbo.enterprise (
          name, short_name, business_identity, business_type, entity_type, description,
          address, currency,
          status, rera_no, start_date, end_date,
          client_name, client_code, team_size, pan,
          logo, belongs_to, b_sub_identity_type, discontinue, date_of_entry
        ) VALUES (
          @name, @short_name, @business_identity, @business_type, @entity_type, @description,
          @address, @currency,
          @status, @rera_no, @start_date, @end_date,
          @client_name, @client_code, @team_size, @pan,
          @logo, @belongs_to, @b_sub_identity_type, @discontinue, @date_of_entry
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
      .input("address", sql.NVarChar(sql.MAX), f.location || null)
      .input("currency", sql.NVarChar(10), f.currency || "INR")
      .input("status", sql.NVarChar(50), f.status || "Planning")
      .input("rera_no", sql.NVarChar(100), f.priority || null)
      .input("start_date", sql.Date, f.startDate || null)
      .input("end_date", sql.Date, f.endDate || null)
      .input("client_name", sql.NVarChar(255), f.clientName || null)
      .input("client_code", sql.NVarChar(50), f.clientCode || null)
      .input("team_size", sql.Int, f.teamSize ? parseInt(f.teamSize) : null)
      .input("pan", sql.NVarChar(20), f.remarks || null)
      .input("logo", sql.NVarChar(sql.MAX), f.projectImage || null)
      // Enterprise stored in belongs_to, Company stored in b_sub_identity_type — independent
      .input("belongs_to", sql.NVarChar(255), f.enterpriseName || null)
      .input("b_sub_identity_type", sql.NVarChar(255), f.companyName || null)
      .input("discontinue", sql.Bit, f.isActive ? 0 : 1).query(`
        UPDATE dbo.enterprise SET
          name=@name, short_name=@short_name, business_identity=@business_identity,
          entity_type=@entity_type, description=@description,
          address=@address, currency=@currency,
          status=@status, rera_no=@rera_no, start_date=@start_date, end_date=@end_date,
          client_name=@client_name, client_code=@client_code, team_size=@team_size, pan=@pan,
          logo=@logo, belongs_to=@belongs_to, b_sub_identity_type=@b_sub_identity_type,
          discontinue=@discontinue
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
