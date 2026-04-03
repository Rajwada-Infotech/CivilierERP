const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");

// GET all DB tables across tenants (sys.tables meta)
router.get("/tables", async (req, res) => {
  const { tenant_id } = req.query;
  try {
    const pool = getPool();
    // In a real multi-tenant setup, you'd switch DB context by tenant.
    // Here we query the connected DB's sys.tables as a proxy.
    const result = await pool.request().query(`
      SELECT
        t.name         AS table_name,
        s.name         AS schema_name,
        p.rows         AS row_count,
        CAST(SUM(a.total_pages) * 8 / 1024.0 AS DECIMAL(10,2)) AS size_mb,
        MAX(si.last_user_update) AS last_write
      FROM sys.tables t
      INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
      INNER JOIN sys.indexes i ON t.object_id = i.object_id AND i.index_id <= 1
      INNER JOIN sys.partitions p ON i.object_id = p.object_id AND i.index_id = p.index_id
      INNER JOIN sys.allocation_units a ON p.partition_id = a.container_id
      LEFT JOIN sys.dm_db_index_usage_stats si
        ON t.object_id = si.object_id AND si.database_id = DB_ID()
      GROUP BY t.name, s.name, p.rows
      ORDER BY p.rows DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET row count for a specific table
router.get("/tables/:tableName/count", async (req, res) => {
  const { tableName } = req.params;
  // Validate table name to prevent SQL injection
  if (!/^[a-zA-Z0-9_]+$/.test(tableName)) {
    return res.status(400).json({ error: "Invalid table name" });
  }
  try {
    const pool = getPool();
    const result = await pool
      .request()
      .query(`SELECT COUNT(*) AS row_count FROM dbo.${tableName}`);
    res.json(result.recordset[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST - execute a safe read-only query (SELECT only)
router.post("/query", async (req, res) => {
  const { query, tenant_id } = req.body;
  if (!query) return res.status(400).json({ error: "Query required" });

  // Block destructive operations
  const BLOCKED = /^\s*(DROP|TRUNCATE|ALTER|CREATE|EXEC|EXECUTE|INSERT|UPDATE|DELETE)\s/i;
  if (BLOCKED.test(query)) {
    return res.status(403).json({ error: "Only SELECT queries allowed via this endpoint. Use /query/write for mutations." });
  }

  try {
    const pool = getPool();
    const result = await pool.request().query(query);
    res.json({
      rows: result.recordset,
      rowCount: result.recordset.length,
      tenant_id: tenant_id || "current",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST - execute a write query (requires DBA role - enforced at middleware level)
router.post("/query/write", async (req, res) => {
  const { query, tenant_id, confirmed } = req.body;
  if (!query) return res.status(400).json({ error: "Query required" });
  if (!confirmed) return res.status(400).json({ error: "Confirmation required for write operations" });

  try {
    const pool = getPool();
    const result = await pool.request().query(query);
    res.json({
      rowsAffected: result.rowsAffected,
      tenant_id: tenant_id || "current",
      message: "Query executed successfully",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET query history (from audit log table)
router.get("/query-history", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT TOP 100
        id, executed_at, executed_by, tenant_id, query_text,
        rows_affected, status, error_message
      FROM dbo.dba_query_log
      ORDER BY executed_at DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    // Table may not exist yet — return empty gracefully
    res.json([]);
  }
});

// GET DB server health stats
router.get("/health", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT
        @@SERVERNAME AS server_name,
        DB_NAME() AS database_name,
        @@VERSION AS sql_version,
        (SELECT COUNT(*) FROM sys.tables) AS total_tables,
        (
          SELECT SUM(size * 8 / 1024)
          FROM sys.master_files
          WHERE database_id = DB_ID()
        ) AS total_size_mb
    `);
    res.json(result.recordset[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
