const express = require("express");
const { cache } = require("../middleware/cache");
const { redisDelPattern, bumpCacheVersion } = require("../redis");
const router = express.Router();
const { getPool, sql } = require("../db");

// GET all with pagination
router.get("/", cache("business-units", 300), async (req, res) => {
  try {
    const pool = getPool();
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 100);
    const offset = (page - 1) * limit;
    const search = (req.query.search || '').toString().trim();

    const params = new pool.Request();
    params.input('offset', sql.Int, offset);
    params.input('limit', sql.Int, limit);
    params.input('search', sql.NVarChar(200), `%${search}%`);

    // Count total
    const countResult = await params.query(`
      SELECT COUNT(*) AS total
      FROM BusinessUnit 
      WHERE (@search = '' OR Name LIKE @search OR Code LIKE @search)
    `);
    const total = parseInt(countResult.recordset[0].total);

    // Paginated data
    const result = await params.query(`
      SELECT 
        BusinessUnitID AS id,
        Name,
        Code,
        Description,
        IsActive,
        CreatedAt,
        UpdatedAt
      FROM BusinessUnit 
      WHERE (@search = '' OR Name LIKE @search OR Code LIKE @search)
      ORDER BY Name
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);

    res.json({
      data: result.recordset,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    });
  } catch (err) {
    console.error('GET BusinessUnit ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST create
router.post("/", async (req, res) => {
  const { Name, Code, Description, IsActive = true } = req.body;
  
  if (!Name?.trim()) {
    return res.status(400).json({ error: 'Name is required' });
  }

  try {
    const pool = getPool();
    const result = await pool.request()
      .input('Name', sql.NVarChar(200), Name.trim())
      .input('Code', sql.NVarChar(50), Code?.trim() || null)
      .input('Description', sql.NVarChar(500), Description?.trim() || null)
      .input('IsActive', sql.Bit, IsActive)
      .query(`
        INSERT INTO BusinessUnit (Name, Code, Description, IsActive)
        OUTPUT INSERTED.BusinessUnitID, INSERTED.Name, INSERTED.Code
        VALUES (@Name, @Code, @Description, @IsActive)
      `);

    await bumpCacheVersion('business-units');
    res.status(201).json({ 
      message: 'Business Unit created successfully', 
      data: result.recordset[0] 
    });
  } catch (err) {
    console.error('POST BusinessUnit ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT update
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { Name, Code, Description, IsActive } = req.body;

  try {
    const pool = getPool();
    const result = await pool.request()
      .input('id', sql.Int, parseInt(id))
      .input('Name', sql.NVarChar(200), Name?.trim() || null)
      .input('Code', sql.NVarChar(50), Code?.trim() || null)
      .input('Description', sql.NVarChar(500), Description?.trim() || null)
      .input('IsActive', sql.Bit, IsActive)
      .input('UpdatedAt', sql.DateTime2, new Date())
      .query(`
        UPDATE BusinessUnit 
        SET Name = @Name, Code = @Code, Description = @Description, 
            IsActive = @IsActive, UpdatedAt = @UpdatedAt
        OUTPUT INSERTED.BusinessUnitID, INSERTED.Name, INSERTED.Code, INSERTED.IsActive
        WHERE BusinessUnitID = @id
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Business Unit not found' });
    }

    await bumpCacheVersion('business-units');
    res.json({ 
      message: 'Business Unit updated successfully', 
      data: result.recordset[0] 
    });
  } catch (err) {
    console.error('PUT BusinessUnit ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE
router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const pool = getPool();
    const result = await pool.request()
      .input('id', sql.Int, parseInt(id))
      .query('DELETE FROM BusinessUnit WHERE BusinessUnitID = @id');

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: 'Business Unit not found' });
    }

    await bumpCacheVersion('business-units');
    res.json({ message: 'Business Unit deleted successfully' });
  } catch (err) {
    console.error('DELETE BusinessUnit ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET options for dropdowns
router.get('/options', async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT BusinessUnitID AS id, Name AS label, Code
      FROM BusinessUnit 
      WHERE IsActive = 1
      ORDER BY Name
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error('GET BusinessUnit options ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

