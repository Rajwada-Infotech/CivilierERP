const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const allowRoles = require("../middleware/role");

router.use(authMiddleware);
const adminOnly = allowRoles("admin", "super_admin", "dba");

// ─── GET /api/lookups?type=CURRENCY ──────────────────────────────────────────
// Public to all authenticated users — used by dropdowns throughout the app.
// Returns values as a plain string array for drop-in replacement of hardcoded arrays.
// ?type=CURRENCY          → ["INR","USD","EUR","GBP","AED"]
// ?type=CURRENCY&full=1   → [{ value, label, sortOrder }]
router.get("/", async (req, res) => {
  const { type, full } = req.query;

  if (!type || typeof type !== "string" || !type.trim()) {
    return res.status(400).json({ error: "type query parameter is required" });
  }

  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("Type", sql.NVarChar(50), type.trim().toUpperCase())
      .query(`
        SELECT Value, Label, SortOrder
        FROM dbo.Lookups
        WHERE LookupType = @Type AND IsActive = 1
        ORDER BY SortOrder ASC, Value ASC
      `);

    if (full === "1" || full === "true") {
      return res.json(
        result.recordset.map((r) => ({
          value: r.Value,
          label: r.Label || r.Value,
          sortOrder: r.SortOrder,
        })),
      );
    }

    // Default: plain string array — drop-in replacement for hardcoded const arrays
    res.json(result.recordset.map((r) => r.Value));
  } catch (err) {
    console.error("ERROR in GET /lookups:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/lookups/all  (admin only) ──────────────────────────────────────
// Returns all rows including inactive, grouped by type — for the admin UI.
router.get("/all", adminOnly, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT Id, LookupType, Value, Label, SortOrder, IsActive, UpdatedAt, UpdatedBy
      FROM dbo.Lookups
      ORDER BY LookupType ASC, SortOrder ASC, Value ASC
    `);

    // Group by type for convenience
    const grouped = result.recordset.reduce(
      (acc, row) => {
        if (!acc[row.LookupType]) acc[row.LookupType] = [];
        acc[row.LookupType].push(row);
        return acc;
      },
      {},
    );

    res.json({ lookups: result.recordset, grouped });
  } catch (err) {
    console.error("ERROR in GET /lookups/all:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/lookups  (admin only) ─────────────────────────────────────────
router.post("/", adminOnly, async (req, res) => {
  const { lookupType, value, label, sortOrder } = req.body;

  if (!lookupType?.trim() || !value?.trim()) {
    return res.status(400).json({ error: "lookupType and value are required" });
  }

  const type = lookupType.trim().toUpperCase();
  const updatedBy = req.user?.name || req.user?.email || req.user?.userId || "system";

  try {
    const pool = getPool();

    const existing = await pool
      .request()
      .input("Type",  sql.NVarChar(50),  type)
      .input("Value", sql.NVarChar(100), value.trim())
      .query("SELECT 1 FROM dbo.Lookups WHERE LookupType = @Type AND Value = @Value");

    if (existing.recordset.length > 0) {
      return res.status(409).json({ error: "This value already exists for the given type" });
    }

    const result = await pool
      .request()
      .input("Type",      sql.NVarChar(50),  type)
      .input("Value",     sql.NVarChar(100), value.trim())
      .input("Label",     sql.NVarChar(100), label?.trim() || null)
      .input("SortOrder", sql.Int,           Number(sortOrder) || 0)
      .input("UpdatedBy", sql.NVarChar(100), String(updatedBy))
      .query(`
        INSERT INTO dbo.Lookups (LookupType, Value, Label, SortOrder, IsActive, CreatedAt, UpdatedAt, UpdatedBy)
        OUTPUT INSERTED.*
        VALUES (@Type, @Value, @Label, @SortOrder, 1, GETDATE(), GETDATE(), @UpdatedBy)
      `);

    res.status(201).json({ lookup: result.recordset[0] });
  } catch (err) {
    console.error("ERROR in POST /lookups:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/lookups/:id  (admin only) ──────────────────────────────────────
// Value is mutable (unlike ChannelKey) since lookups aren't used as FKs.
router.put("/:id", adminOnly, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "invalid id" });

  const { value, label, sortOrder, isActive } = req.body;
  const updatedBy = req.user?.name || req.user?.email || req.user?.userId || "system";

  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("Id",        sql.Int,           id)
      .input("Value",     sql.NVarChar(100), value?.trim() ?? null)
      .input("Label",     sql.NVarChar(100), label?.trim() ?? null)
      .input("SortOrder", sql.Int,           sortOrder !== undefined ? Number(sortOrder) : null)
      .input("IsActive",  sql.Bit,           isActive !== undefined ? (isActive ? 1 : 0) : null)
      .input("UpdatedBy", sql.NVarChar(100), String(updatedBy))
      .query(`
        UPDATE dbo.Lookups SET
          Value     = COALESCE(@Value,     Value),
          Label     = COALESCE(@Label,     Label),
          SortOrder = COALESCE(@SortOrder, SortOrder),
          IsActive  = COALESCE(@IsActive,  IsActive),
          UpdatedAt = GETDATE(),
          UpdatedBy = @UpdatedBy
        WHERE Id = @Id;
        SELECT * FROM dbo.Lookups WHERE Id = @Id;
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: "Lookup not found" });
    }
    res.json({ lookup: result.recordset[0] });
  } catch (err) {
    console.error("ERROR in PUT /lookups/:id:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /api/lookups/:id  (admin only — soft delete) ─────────────────────
router.delete("/:id", adminOnly, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "invalid id" });

  const updatedBy = req.user?.name || req.user?.email || req.user?.userId || "system";

  try {
    const pool = getPool();
    await pool
      .request()
      .input("Id",        sql.Int,           id)
      .input("UpdatedBy", sql.NVarChar(100), String(updatedBy))
      .query(`
        UPDATE dbo.Lookups
        SET IsActive = 0, UpdatedAt = GETDATE(), UpdatedBy = @UpdatedBy
        WHERE Id = @Id
      `);
    res.json({ success: true });
  } catch (err) {
    console.error("ERROR in DELETE /lookups/:id:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

