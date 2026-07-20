const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");

const cleanStr = (v, len = 255) => {
  if (!v || String(v).trim() === "") return null;
  return String(v).trim().slice(0, len);
};

// GET /options — active reasons for dropdowns
router.get("/options", authMiddleware, async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT ReasonId AS id, ReasonName AS name, ReasonDesc AS description
      FROM dbo.PaymentReasonMaster
      WHERE IsActive = 1
      ORDER BY ReasonName ASC
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET / — full list for management UI
router.get("/", authMiddleware, async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT ReasonId AS id, ReasonName AS name, ReasonDesc AS description,
             IsActive AS isActive, CreatedBy AS createdBy, CreatedAt AS createdAt,
             UpdatedBy AS updatedBy, UpdatedAt AS updatedAt
      FROM dbo.PaymentReasonMaster
      ORDER BY ReasonName ASC
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST / — create
router.post("/", authMiddleware, requirePageRight("payment-reason-master", "create"), async (req, res) => {
  const { name, description, isActive = true } = req.body;
  const actor = req.user?.email || req.user?.name || "system";
  const rName = cleanStr(name, 200);
  if (!rName) return res.status(400).json({ error: "Reason Name is required" });

  try {
    const pool = await getPool();
    const dup = await pool.request()
      .input("name", sql.NVarChar(200), rName)
      .query(`SELECT ReasonId FROM dbo.PaymentReasonMaster WHERE ReasonName = @name`);
    if (dup.recordset.length > 0)
      return res.status(409).json({ error: "A reason with this name already exists" });

    const result = await pool.request()
      .input("name",      sql.NVarChar(200),  rName)
      .input("desc",      sql.NVarChar(sql.MAX), cleanStr(description, 2000) || null)
      .input("isActive",  sql.Bit,            isActive ? 1 : 0)
      .input("createdBy", sql.NVarChar(200),  actor)
      .query(`
        INSERT INTO dbo.PaymentReasonMaster (ReasonName, ReasonDesc, IsActive, CreatedBy)
        OUTPUT INSERTED.ReasonId AS id
        VALUES (@name, @desc, @isActive, @createdBy)
      `);
    res.status(201).json({ success: true, id: result.recordset[0].id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /:id — update
router.put("/:id", authMiddleware, requirePageRight("payment-reason-master", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
  const { name, description, isActive } = req.body;
  const actor = req.user?.email || req.user?.name || "system";
  const rName = cleanStr(name, 200);
  if (!rName) return res.status(400).json({ error: "Reason Name is required" });

  try {
    const pool = await getPool();
    const existing = await pool.request().input("id", sql.Int, id)
      .query(`SELECT ReasonId FROM dbo.PaymentReasonMaster WHERE ReasonId = @id`);
    if (!existing.recordset.length) return res.status(404).json({ error: "Reason not found" });

    const dup = await pool.request()
      .input("name", sql.NVarChar(200), rName)
      .input("id",   sql.Int,           id)
      .query(`SELECT ReasonId FROM dbo.PaymentReasonMaster WHERE ReasonName = @name AND ReasonId != @id`);
    if (dup.recordset.length > 0)
      return res.status(409).json({ error: "Another reason with this name already exists" });

    await pool.request()
      .input("id",        sql.Int,            id)
      .input("name",      sql.NVarChar(200),  rName)
      .input("desc",      sql.NVarChar(sql.MAX), cleanStr(description, 2000) || null)
      .input("isActive",  sql.Bit,            isActive !== undefined ? (isActive ? 1 : 0) : 1)
      .input("updatedBy", sql.NVarChar(200),  actor)
      .query(`
        UPDATE dbo.PaymentReasonMaster SET
          ReasonName = @name, ReasonDesc = @desc, IsActive = @isActive,
          UpdatedBy = @updatedBy, UpdatedAt = SYSDATETIME()
        WHERE ReasonId = @id
      `);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /:id — soft delete
router.delete("/:id", authMiddleware, requirePageRight("payment-reason-master", "delete"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
  const actor = req.user?.email || req.user?.name || "system";

  try {
    const pool = await getPool();
    const existing = await pool.request().input("id", sql.Int, id)
      .query(`SELECT ReasonId FROM dbo.PaymentReasonMaster WHERE ReasonId = @id`);
    if (!existing.recordset.length) return res.status(404).json({ error: "Reason not found" });

    await pool.request()
      .input("id",        sql.Int,           id)
      .input("updatedBy", sql.NVarChar(200), actor)
      .query(`
        UPDATE dbo.PaymentReasonMaster SET IsActive = 0, UpdatedBy = @updatedBy, UpdatedAt = SYSDATETIME()
        WHERE ReasonId = @id
      `);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
