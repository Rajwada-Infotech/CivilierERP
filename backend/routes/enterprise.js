const express = require("express");
const { cache } = require("../middleware/cache");
const { redisDelPattern } = require("../redis");
const router = express.Router();
const { getPool, sql } = require("../db");

// GET all
router.get("/", cache("enterprises", 300), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query("SELECT * FROM dbo.enterprise");
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ADD
router.post("/", async (req, res) => {
  const {
    name,
    business_identity,
    business_type,
    b_sub_identity_type,
    belongs_to,
    logo,
    date_of_entry,
    date_of_establishment,
    currency,
    pan,
    cin,
    address,
    email,
    phone_number,
    tds_limit,
    description,
    gst_type,
    status,
    cr_code,
    discontinue,
  } = req.body;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("name", sql.NVarChar, name || null)
      .input("business_identity", sql.NVarChar, business_identity || null)
      .input("business_type", sql.NVarChar, business_type || null)
      .input("b_sub_identity_type", sql.NVarChar, b_sub_identity_type || null)
      .input("belongs_to", sql.Int, belongs_to || null)
      .input("logo", sql.NVarChar, logo || null)
      .input("date_of_entry", sql.Date, date_of_entry || null)
      .input("date_of_establishment", sql.Date, date_of_establishment || null)
      .input("currency", sql.NVarChar, currency || null)
      .input("pan", sql.NVarChar, pan || null)
      .input("cin", sql.NVarChar, cin || null)
      .input("address", sql.NVarChar, address || null)
      .input("email", sql.NVarChar, email || null)
      .input("phone_number", sql.NVarChar, phone_number || null)
      .input("tds_limit", sql.Decimal(18, 2), tds_limit || null)
      .input("description", sql.NVarChar, description || null)
      .input("gst_type", sql.NVarChar, gst_type || null)
      .input("status", sql.NVarChar, status || null)
      .input("cr_code", sql.NVarChar, cr_code || null)
      .input("discontinue", sql.Bit, discontinue ? 1 : 0).query(`
        INSERT INTO dbo.enterprise (
          name, business_identity, business_type, b_sub_identity_type,
          belongs_to, logo, date_of_entry, date_of_establishment,
          currency, pan, cin, address, email, phone_number,
          tds_limit, description, gst_type, status, cr_code, discontinue
        ) VALUES (
          @name, @business_identity, @business_type, @b_sub_identity_type,
          @belongs_to, @logo, @date_of_entry, @date_of_establishment,
          @currency, @pan, @cin, @address, @email, @phone_number,
          @tds_limit, @description, @gst_type, @status, @cr_code, @discontinue
        )
      `);
    await redisDelPattern("cache:enterprises:*");

    res.json({ message: "Enterprise added successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// UPDATE
router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const {
    name,
    business_identity,
    business_type,
    b_sub_identity_type,
    belongs_to,
    logo,
    date_of_entry,
    date_of_establishment,
    currency,
    pan,
    cin,
    address,
    email,
    phone_number,
    tds_limit,
    description,
    gst_type,
    status,
    cr_code,
    discontinue,
  } = req.body;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("id", sql.Int, id)
      .input("name", sql.NVarChar, name || null)
      .input("business_identity", sql.NVarChar, business_identity || null)
      .input("business_type", sql.NVarChar, business_type || null)
      .input("b_sub_identity_type", sql.NVarChar, b_sub_identity_type || null)
      .input("belongs_to", sql.Int, belongs_to || null)
      .input("logo", sql.NVarChar, logo || null)
      .input("date_of_entry", sql.Date, date_of_entry || null)
      .input("date_of_establishment", sql.Date, date_of_establishment || null)
      .input("currency", sql.NVarChar, currency || null)
      .input("pan", sql.NVarChar, pan || null)
      .input("cin", sql.NVarChar, cin || null)
      .input("address", sql.NVarChar, address || null)
      .input("email", sql.NVarChar, email || null)
      .input("phone_number", sql.NVarChar, phone_number || null)
      .input("tds_limit", sql.Decimal(18, 2), tds_limit || null)
      .input("description", sql.NVarChar, description || null)
      .input("gst_type", sql.NVarChar, gst_type || null)
      .input("status", sql.NVarChar, status || null)
      .input("cr_code", sql.NVarChar, cr_code || null)
      .input("discontinue", sql.Bit, discontinue ? 1 : 0).query(`
        UPDATE dbo.enterprise SET
          name=@name, business_identity=@business_identity,
          business_type=@business_type, b_sub_identity_type=@b_sub_identity_type,
          belongs_to=@belongs_to, logo=@logo,
          date_of_entry=@date_of_entry, date_of_establishment=@date_of_establishment,
          currency=@currency, pan=@pan, cin=@cin, address=@address,
          email=@email, phone_number=@phone_number, tds_limit=@tds_limit,
          description=@description, gst_type=@gst_type, status=@status,
          cr_code=@cr_code, discontinue=@discontinue
        WHERE id=@id
      `);
    await redisDelPattern("cache:enterprises:*");

    res.json({ message: "Enterprise updated successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE
router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("id", sql.Int, id)
      .query("DELETE FROM dbo.enterprise WHERE id=@id");
    await redisDelPattern("cache:enterprises:*");

    res.json({ message: "Enterprise deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SEED — inserts 5 fake enterprises if fewer than 5 rows exist (safe to call multiple times)
router.post("/seed", async (req, res) => {
  try {
    const pool = getPool();

    // Check how many rows already exist
    const countResult = await pool
      .request()
      .query("SELECT COUNT(*) AS cnt FROM dbo.enterprise");
    const existing = countResult.recordset[0].cnt;

    if (existing >= 5) {
      // Already has enough rows — return existing IDs so frontend can sync
      const rows = await pool
        .request()
        .query("SELECT TOP 5 id, name FROM dbo.enterprise ORDER BY id");
      return res.json({ message: "Already seeded.", rows: rows.recordset });
    }

    // Insert without forcing IDs — let IDENTITY assign them naturally
    const seeds = [
      { name: "Civilier Infrastructure Pvt Ltd", business_type: "Company" },
      { name: "Apex Constructions Ltd", business_type: "Company" },
      { name: "SiteCraft Engineers", business_type: "Firm" },
      { name: "Raj Builders & Co", business_type: "Firm" },
      { name: "Metro Rail Project", business_type: "Project" },
    ];

    for (const s of seeds) {
      // Only insert if name doesn't already exist
      await pool
        .request()
        .input("name", sql.NVarChar, s.name)
        .input("business_type", sql.NVarChar, s.business_type).query(`
          IF NOT EXISTS (SELECT 1 FROM dbo.enterprise WHERE name = @name)
            INSERT INTO dbo.enterprise (name, business_type) VALUES (@name, @business_type)
        `);
    }

    // Return the actual IDs assigned by the DB
    const rows = await pool
      .request()
      .query(
        "SELECT id, name FROM dbo.enterprise WHERE name IN ('Civilier Infrastructure Pvt Ltd','Apex Constructions Ltd','SiteCraft Engineers','Raj Builders & Co','Metro Rail Project') ORDER BY id",
      );

    res.json({ message: "Seed complete.", rows: rows.recordset });
  } catch (err) {
    console.error("SEED ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET just id+name for FK dropdowns
router.get("/options", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool
      .request()
      .query("SELECT id, name AS label FROM dbo.enterprise ORDER BY id");
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
