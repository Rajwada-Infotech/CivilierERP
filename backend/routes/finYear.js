const express = require("express");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, validate: false }));
const { getPool, sql } = require("../db");
const { validateBody } = require("../middleware/validateRequest");
const { requirePageRight } = require("../middleware/requirePageRight");
const {
  finYearCreateSchema,
  finYearUpdateSchema,
} = require("../validation/finYearSchemas");

router.get("/", cache("fin-year", 300), async (req, res) => {
  try {
    const pool = getPool();
    // ?all=true → return every row (used by the admin FinYear management page)
    // default   → only unlocked + active rows (used by all transaction dropdowns)
    const showAll = req.query.all === "true";
    const query = showAll
      ? "SELECT * FROM dbo.FinYear ORDER BY FStartDate DESC"
      : "SELECT * FROM dbo.FinYear WHERE FStatus = 1 AND FisLocked = 0 ORDER BY FStartDate DESC";
    const result = await pool.request().query(query);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/", requirePageRight("financial-year-master", "create"), validateBody(finYearCreateSchema), async (req, res) => {
  const { fy_label, start_date, end_date, is_active, is_locked } = req.body;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("FName", sql.NVarChar, fy_label || null)
      .input("FStartDate", sql.Date, start_date || null)
      .input("FEndDate", sql.Date, end_date || null)
      .input("FStatus", sql.Bit, is_active !== false ? 1 : 0)
      .input("FisLocked", sql.Bit, is_locked ? 1 : 0)
      .input("FCreatedBy", sql.Int, req.user.userId ?? req.user.id)
      .input("FCreatedAt", sql.DateTime2, new Date()).query(`
        INSERT INTO dbo.FinYear (FName, FStartDate, FEndDate, FStatus, FisLocked, FCreatedBy, FCreatedAt)
        VALUES (@FName, @FStartDate, @FEndDate, @FStatus, @FisLocked, @FCreatedBy, @FCreatedAt)
      `);
    await bumpCacheVersion("fin-year");
    res.json({ message: "Financial year added" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Partial UPDATE — only columns present in req.body are modified.
router.put("/:id", requirePageRight("financial-year-master", "edit"), validateBody(finYearUpdateSchema), async (req, res) => {
  const { fy_label, start_date, end_date, is_active, is_locked } = req.body;
  try {
    const pool = getPool();

    const setClauses = [];
    const request = pool.request().input("FId", sql.Int, req.params.id);

    if (fy_label !== undefined) {
      setClauses.push("FName=@FName");
      request.input("FName", sql.NVarChar, fy_label);
    }
    if (start_date !== undefined) {
      setClauses.push("FStartDate=@FStartDate");
      request.input("FStartDate", sql.Date, start_date);
    }
    if (end_date !== undefined) {
      setClauses.push("FEndDate=@FEndDate");
      request.input("FEndDate", sql.Date, end_date);
    }
    if (is_active !== undefined) {
      setClauses.push("FStatus=@FStatus");
      request.input("FStatus", sql.Bit, is_active ? 1 : 0);
    }
    if (is_locked !== undefined) {
      setClauses.push("FisLocked=@FisLocked");
      request.input("FisLocked", sql.Bit, is_locked ? 1 : 0);
    }

    setClauses.push("FUpdatedBy=@FUpdatedBy", "FUpdatedAt=@FUpdatedAt");
    request.input("FUpdatedBy", sql.Int, req.user.userId ?? req.user.id);
    request.input("FUpdatedAt", sql.DateTime2, new Date());

    if (setClauses.length === 2) {
      return res.json({ message: "Nothing to update" });
    }

    await request.query(`
      UPDATE dbo.FinYear
      SET ${setClauses.join(", ")}
      WHERE FId=@FId
    `);

    await bumpCacheVersion("fin-year");
    res.json({ message: "Financial year updated" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:id", requirePageRight("financial-year-master", "delete"), async (req, res) => {
  try {
    const pool = getPool();
    await pool
      .request()
      .input("FId", sql.Int, req.params.id)
      .query("DELETE FROM dbo.FinYear WHERE FId=@FId");
    await bumpCacheVersion("fin-year");
    res.json({ message: "Financial year deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
