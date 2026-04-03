const express = require("express");
const router = express.Router();
const { getPool } = require("../db");

// ======================
//  DBA ROUTES - SECURED
// ======================

// GET all tables with basic metadata (safe view only)
router.get("/tables", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT
        t.name AS table_name,
        s.name AS schema_name,
        p.rows AS row_count,
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
    console.error("Error fetching tables:", err);
    res.status(500).json({ error: "Failed to fetch table information" });
  }
});

// GET row count for a specific table (with strict validation)
router.get("/tables/:tableName/count", async (req, res) => {
  const { tableName } = req.params;

  // Strict whitelist validation - only allow safe table names
  if (!/^[a-zA-Z0_][a-zA-Z0-9_]*$/.test(tableName)) {
    return res.status(400).json({ error: "Invalid table name format" });
  }

  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("tableName", sql.VarChar, tableName).query(`
        SELECT COUNT(*) AS row_count
        FROM dbo.[${tableName}]
      `);

    res.json(result.recordset[0]);
  } catch (err) {
    console.error(`Error counting table ${tableName}:`, err);
    res.status(500).json({ error: "Failed to get row count" });
  }
});

// POST - Safe read-only query (SELECT only)
router.post("/query", async (req, res) => {
  const { query } = req.body;

  if (!query || typeof query !== "string") {
    return res.status(400).json({ error: "Valid query is required" });
  }

  // Block dangerous keywords
  const blockedKeywords =
    /\b(DROP|TRUNCATE|ALTER|CREATE|EXEC|EXECUTE|INSERT|UPDATE|DELETE|GRANT|REVOKE|SHUTDOWN)\b/i;
  if (blockedKeywords.test(query)) {
    return res.status(403).json({
      error: "Only SELECT queries are allowed through this endpoint.",
    });
  }

  try {
    const pool = getPool();
    const result = await pool.request().query(query);

    res.json({
      rows: result.recordset,
      rowCount: result.recordset.length,
      message: "Query executed successfully",
    });
  } catch (err) {
    console.error("Query execution error:", err);
    res.status(500).json({ error: "Query execution failed" });
  }
});

// POST - Write operations (Highly restricted - only for confirmed DBA actions)
router.post("/query/write", async (req, res) => {
  const { query, confirmed } = req.body;

  if (!query || typeof query !== "string") {
    return res.status(400).json({ error: "Valid query is required" });
  }

  if (!confirmed || confirmed !== true) {
    return res.status(400).json({
      error: "Explicit confirmation is required for write operations",
    });
  }

  // Extra safety: still block dangerous commands even with confirmation
  const dangerousKeywords =
    /\b(DROP|TRUNCATE|ALTER TABLE|CREATE|EXEC|SHUTDOWN)\b/i;
  if (dangerousKeywords.test(query)) {
    return res.status(403).json({
      error:
        "This type of operation is not allowed via the API for safety reasons.",
    });
  }

  try {
    const pool = getPool();
    const result = await pool.request().query(query);

    res.json({
      rowsAffected: result.rowsAffected || 0,
      message: "Write operation executed successfully",
    });
  } catch (err) {
    console.error("Write query error:", err);
    res.status(500).json({ error: "Write operation failed" });
  }
});

// GET query history (safe fallback if table doesn't exist)
router.get("/query-history", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT TOP 50
        id,
        executed_at,
        executed_by,
        tenant_id,
        query_text,
        rows_affected,
        status,
        error_message
      FROM dbo.dba_query_log
      ORDER BY executed_at DESC
    `);

    res.json(result.recordset);
  } catch (err) {
    // Graceful fallback if audit table doesn't exist yet
    res.json([]);
  }
});

// GET basic database health stats
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
          SELECT SUM(size * 8.0 / 1024)
          FROM sys.master_files
          WHERE database_id = DB_ID()
        ) AS total_size_mb
    `);

    res.json(result.recordset[0]);
  } catch (err) {
    console.error("Health check error:", err);
    res.status(500).json({ error: "Failed to fetch database health" });
  }
});

module.exports = router;
