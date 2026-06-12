const express = require("express");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, validate: false }));
const { getPool, sql } = require("../db");

router.get("/", cache("account-group", 300), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT ag.AGId,
             ISNULL(ag.Name, CONCAT('Unnamed-', ag.AGId)) AS Name,
             ag.Code, ag.ParentGroupId, ag.Status,
             ag.CreatedAt, ag.UpdatedAt,
             parent.Name AS ParentName
      FROM dbo.AccountGroup ag
      LEFT JOIN dbo.AccountGroup parent ON parent.AGId = ag.ParentGroupId
      ORDER BY ag.Name ASC
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/", async (req, res) => {
  const { Name, Code, ParentGroupId, Status } = req.body;
  try {
    const userId = req.user?.id ?? req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: "User context missing" });
    }

    const parentId = ParentGroupId != null ? parseInt(ParentGroupId, 10) : null;
    if (ParentGroupId != null && !Number.isFinite(parentId)) {
      return res.status(400).json({ error: "ParentGroupId must be a valid integer" });
    }

    const pool = getPool();
    await pool
      .request()
      .input("Name", sql.NVarChar, Name || null)
      .input("Code", sql.NVarChar, Code || null)
      .input("ParentGroupId", sql.Int, parentId)
      .input("Status", sql.Bit, Status ? 1 : 0)
      .input("CreatedBy", sql.Int, userId)
      .input("CreatedAt", sql.DateTime2, new Date()).query(`
        INSERT INTO dbo.AccountGroup (Name, Code, ParentGroupId, Status, CreatedBy, CreatedAt)
        VALUES (@Name, @Code, @ParentGroupId, @Status, @CreatedBy, @CreatedAt)
      `);
    await bumpCacheVersion("account-group");

    res.json({ message: "Account group added" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/:id", async (req, res) => {
  const { Name, Code, ParentGroupId, Status } = req.body;
  try {
    const userId = req.user?.id ?? req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: "User context missing" });
    }

    const agId = parseInt(req.params.id, 10);
    if (!Number.isFinite(agId)) {
      return res.status(400).json({ error: "Invalid account group ID" });
    }

    const parentId = ParentGroupId != null ? parseInt(ParentGroupId, 10) : null;
    if (ParentGroupId != null && !Number.isFinite(parentId)) {
      return res.status(400).json({ error: "ParentGroupId must be a valid integer" });
    }

    const pool = getPool();
    await pool
      .request()
      .input("AGId", sql.Int, agId)
      .input("Name", sql.NVarChar, Name || null)
      .input("Code", sql.NVarChar, Code || null)
      .input("ParentGroupId", sql.Int, parentId)
      .input("Status", sql.Bit, Status ? 1 : 0)
      .input("UpdatedBy", sql.Int, userId)
      .input("UpdatedAt", sql.DateTime2, new Date()).query(`
        UPDATE dbo.AccountGroup SET
          Name=@Name, Code=@Code, ParentGroupId=@ParentGroupId,
          Status=@Status, UpdatedBy=@UpdatedBy, UpdatedAt=@UpdatedAt
        WHERE AGId=@AGId
      `);
    await bumpCacheVersion("account-group");

    res.json({ message: "Account group updated" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const agId = parseInt(req.params.id, 10);
    if (!Number.isFinite(agId)) {
      return res.status(400).json({ error: "Invalid account group ID" });
    }

    const pool = getPool();
    await pool
      .request()
      .input("AGId", sql.Int, agId)
      .query("DELETE FROM dbo.AccountGroup WHERE AGId=@AGId");
    await bumpCacheVersion("account-group");

    res.json({ message: "Account group deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;




