const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, validate: false }));
const { getPool, sql } = require("../db");

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

  // Fix: regex had typo `[a-zA-Z0_]` — the `0` was erroneous, allowing digit-or-underscore
  // as a first character. Corrected to `[a-zA-Z_]` (letters and underscore only to start).
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
    return res.status(400).json({ error: "Invalid table name format" });
  }

  try {
    const pool = getPool();
    // Fix: removed dead .input("tableName", ...) binding that was never referenced in the query.
    // The validated tableName is safe to interpolate after the regex check above.
    // lgtm[js/sql-injection] — tableName is regex-validated to /^[a-zA-Z_][a-zA-Z0-9_]*$/ above
    const result = await pool.request().query(`
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

  // Allowlist approach: strip SQL comments then require the statement to start
  // with SELECT. A blocklist of dangerous keywords is trivially bypassable
  // (comment injection, hex encoding, sp_executesql, etc.) — a positive check
  // on the first keyword is not. Also disallow semicolons to prevent
  // multi-statement batches (SELECT ... ; DROP ...).
  const stripped = query
    .replace(/--[^\n]*/g, " ")         // strip single-line comments
    .replace(/\/\*[\s\S]*?\*\//g, " ") // strip block comments
    .trim();
  if (!/^SELECT\b/i.test(stripped) || /;/.test(stripped)) {
    return res.status(403).json({
      error: "Only single SELECT statements are allowed through this endpoint.",
    });
  }

  const executedBy = req.user?.name || req.user?.email || "dba";
  const tenantId = req.user?.tenant_id || null;
  let status = "success";
  let errorMessage = null;
  let rowCount = 0;

  try {
    const pool = getPool();
    // lgtm[js/sql-injection] — intentional DBA SQL console, role-gated to dba/admin/director in server.js
    const result = await pool.request().query(query);
    rowCount = result.recordset.length;

    res.json({
      rows: result.recordset,
      rowCount,
      message: "Query executed successfully",
    });
  } catch (err) {
    console.error("Query execution error:", err);
    status = "error";
    errorMessage = err.message;
    res.status(500).json({ error: "Query execution failed" });
  } finally {
    // Persist to audit log regardless of success/failure
    try {
      const pool = getPool();
      await pool
        .request()
        .input("executed_by", sql.NVarChar, executedBy)
        .input("tenant_id", sql.NVarChar, tenantId)
        .input("query_text", sql.NVarChar(sql.MAX), query.substring(0, 4000))
        .input("rows_affected", sql.Int, rowCount)
        .input("status", sql.NVarChar, status)
        .input("error_message", sql.NVarChar, errorMessage).query(`
          INSERT INTO dbo.dba_query_log
            (executed_at, executed_by, tenant_id, query_text, rows_affected, status, error_message)
          VALUES
            (GETDATE(), @executed_by, @tenant_id, @query_text, @rows_affected, @status, @error_message)
        `);
    } catch (_logErr) {
      // Audit log failure is non-fatal
    }
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
    // lgtm[js/sql-injection] — intentional DBA write console, requires confirmed=true and role-gated
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

// GET list of all online databases on this server
router.get("/databases", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT
        name,
        database_id,
        state_desc,
        DB_NAME() AS current_db
      FROM sys.databases
      WHERE state_desc = 'ONLINE'
        AND name NOT IN ('master','tempdb','model','msdb')
      ORDER BY name
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("Error fetching databases:", err);
    res.status(500).json({ error: "Failed to fetch database list" });
  }
});

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

// ─── DBA Control Panel ────────────────────────────────────────────────────────

// GET all tenants for control panel
router.get("/control-panel", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT tenant_id, name, db_name, server, plan, max_users,
             access_level, features, granted_on, expires_on,
             is_trial, trial_ends_on, paid_amount,
             storage_limit, storage_used, status, created_at,
             DATEDIFF(day, GETDATE(), expires_on) AS days_remaining
      FROM dbo.tenants
      ORDER BY created_at DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH tenant access level / suspend / activate
router.patch("/control-panel/:tenantId", async (req, res) => {
  const { access_level, status, expires_on, features, paid_amount } = req.body;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("tenant_id", sql.NVarChar, req.params.tenantId)
      .input("access_level", sql.NVarChar, access_level || null)
      .input("status", sql.NVarChar, status || null)
      .input(
        "expires_on",
        sql.DateTime2,
        expires_on ? new Date(expires_on) : null,
      )
      .input("features", sql.NVarChar, features || null)
      .input("paid_amount", sql.Decimal(18, 2), paid_amount ?? null).query(`
        UPDATE dbo.tenants SET
          access_level = COALESCE(@access_level, access_level),
          status       = COALESCE(@status,       status),
          expires_on   = COALESCE(@expires_on,   expires_on),
          features     = COALESCE(@features,     features),
          paid_amount  = COALESCE(@paid_amount,  paid_amount)
        WHERE tenant_id = @tenant_id
      `);
    res.json({ message: "Tenant updated" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Ads Manager ──────────────────────────────────────────────────────────────

router.get("/ads", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool
      .request()
      .query("SELECT * FROM dbo.DbaAds ORDER BY created_at DESC");
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/ads", async (req, res) => {
  const {
    tenant_id,
    title,
    description,
    budget,
    start_date,
    end_date,
    category,
    creative_type,
  } = req.body;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("tenant_id", sql.NVarChar, tenant_id || null)
      .input("title", sql.NVarChar, title)
      .input("description", sql.NVarChar, description || null)
      .input("budget", sql.Decimal(18, 2), budget || 0)
      .input("start_date", sql.Date, start_date ? new Date(start_date) : null)
      .input("end_date", sql.Date, end_date ? new Date(end_date) : null)
      .input("category", sql.NVarChar, category || null)
      .input("creative_type", sql.NVarChar, creative_type || null)
      .query(`INSERT INTO dbo.DbaAds (tenant_id,title,description,budget,start_date,end_date,category,creative_type,created_at)
              VALUES (@tenant_id,@title,@description,@budget,@start_date,@end_date,@category,@creative_type,GETDATE())`);
    res.status(201).json({ message: "Ad created" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/ads/:id/status", async (req, res) => {
  const { status } = req.body; // 'active' | 'paused' | 'completed'
  try {
    const pool = getPool();
    await pool
      .request()
      .input("Id", sql.Int, parseInt(req.params.id))
      .input("status", sql.NVarChar, status)
      .query(
        "UPDATE dbo.DbaAds SET status=@status, updated_at=GETDATE() WHERE Id=@Id",
      );
    res.json({ message: "Status updated" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Payment Logs ─────────────────────────────────────────────────────────────

router.get("/payment-logs", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT * FROM dbo.DbaPaymentLogs ORDER BY created_at DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/payment-logs", async (req, res) => {
  const {
    txn_id,
    tenant_id,
    tenant_name,
    amount,
    method,
    upi_id,
    bank_ref,
    paid_by,
    paid_on,
    status,
    purpose,
    plan,
    renewal_period,
    remarks,
  } = req.body;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("txn_id", sql.NVarChar, txn_id)
      .input("tenant_id", sql.NVarChar, tenant_id || null)
      .input("tenant_name", sql.NVarChar, tenant_name || null)
      .input("amount", sql.Decimal(18, 2), amount)
      .input("method", sql.NVarChar, method || null)
      .input("upi_id", sql.NVarChar, upi_id || null)
      .input("bank_ref", sql.NVarChar, bank_ref || null)
      .input("paid_by", sql.NVarChar, paid_by || null)
      .input("paid_on", sql.Date, paid_on ? new Date(paid_on) : null)
      .input("status", sql.NVarChar, status || "pending")
      .input("purpose", sql.NVarChar, purpose || null)
      .input("plan", sql.NVarChar, plan || null)
      .input("renewal_period", sql.NVarChar, renewal_period || null)
      .input("remarks", sql.NVarChar, remarks || null)
      .query(`INSERT INTO dbo.DbaPaymentLogs
        (txn_id,tenant_id,tenant_name,amount,method,upi_id,bank_ref,paid_by,paid_on,status,purpose,plan,renewal_period,remarks,created_at)
        VALUES
        (@txn_id,@tenant_id,@tenant_name,@amount,@method,@upi_id,@bank_ref,@paid_by,@paid_on,@status,@purpose,@plan,@renewal_period,@remarks,GETDATE())`);
    res.status(201).json({ message: "Payment log created" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/payment-logs/:id/status", async (req, res) => {
  const { status } = req.body;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("Id", sql.Int, parseInt(req.params.id))
      .input("status", sql.NVarChar, status)
      .query("UPDATE dbo.DbaPaymentLogs SET status=@status WHERE Id=@Id");
    res.json({ message: "Status updated" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GL reconciliation ────────────────────────────────────────────────────────
// Approved documents whose ledger posting was skipped or failed. This is the
// actionable output of the GLPostingLog introduced in migration 154: it turns
// "an approval silently didn't post" into a concrete, filterable work queue.
// Defaults to only skipped/failed; pass ?outcome=all to see every attempt.
router.get("/gl-posting-failures", async (req, res) => {
  try {
    const pool = getPool();
    const showAll = req.query.outcome === "all";
    const result = await pool.request().query(`
      SELECT TOP 500
        LogId, Module, RecordId, Outcome, Reason, ApproverEmail, CreatedAt
      FROM dbo.GLPostingLog
      ${showAll ? "" : "WHERE Outcome IN ('skipped', 'failed')"}
      ORDER BY CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    // Table may not exist yet on an un-migrated DB — degrade to empty list.
    if (String(err.message).includes("Invalid object name")) return res.json([]);
    console.error("Error fetching GL posting failures:", err);
    res.status(500).json({ error: "Failed to fetch GL posting failures" });
  }
});

module.exports = router;



