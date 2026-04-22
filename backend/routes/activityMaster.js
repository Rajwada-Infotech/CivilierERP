const express = require("express");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const router = express.Router();
const { getPool, sql } = require("../db");

router.get("/", cache("activity-master", 300), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(
      `SELECT id, activity_name, short_description, activity_type, group_id, is_active
       FROM dbo.ActivityMaster`,
    );
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/", async (req, res) => {
  const {
    activity_name,
    short_description,
    activity_type,
    group_id,
    is_active,
  } = req.body;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("activity_name", sql.NVarChar, activity_name || null)
      .input("short_description", sql.NVarChar, short_description || null)
      .input("activity_type", sql.TinyInt, activity_type || null)
      .input("group_id", sql.Int, group_id || null)
      .input("is_active", sql.Bit, is_active !== false ? 1 : 0)
      .input("created_by", sql.Int, 1)
      .input("created_datetime", sql.DateTime2, new Date()).query(`
        INSERT INTO dbo.ActivityMaster
          (activity_name, short_description, activity_type, group_id, is_active, created_by, created_datetime)
        VALUES
          (@activity_name, @short_description, @activity_type, @group_id, @is_active, @created_by, @created_datetime)
      `);
    await bumpCacheVersion("activity-master");

    res.json({ message: "Activity added" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/:id", async (req, res) => {
  const {
    activity_name,
    short_description,
    activity_type,
    group_id,
    is_active,
  } = req.body;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("id", sql.Int, req.params.id)
      .input("activity_name", sql.NVarChar, activity_name || null)
      .input("short_description", sql.NVarChar, short_description || null)
      .input("activity_type", sql.TinyInt, activity_type || null)
      .input("group_id", sql.Int, group_id || null)
      .input("is_active", sql.Bit, is_active !== false ? 1 : 0)
      .input("updated_by", sql.Int, 1)
      .input("updated_at", sql.DateTime2, new Date()).query(`
        UPDATE dbo.ActivityMaster SET
          activity_name=@activity_name, short_description=@short_description,
          activity_type=@activity_type, group_id=@group_id, is_active=@is_active,
          updated_by=@updated_by, updated_at=@updated_at
        WHERE id=@id
      `);
    await bumpCacheVersion("activity-master");

    res.json({ message: "Activity updated" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const pool = getPool();
    await pool
      .request()
      .input("id", sql.Int, req.params.id)
      .query("DELETE FROM dbo.ActivityMaster WHERE id=@id");
    await bumpCacheVersion("activity-master");

    res.json({ message: "Activity deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
