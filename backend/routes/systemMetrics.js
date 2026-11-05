const express = require("express");
const router = express.Router();
const apiRateLimit = require("../middleware/apiRateLimit");
router.use(apiRateLimit);

const { getPool } = require("../db");
const authMiddleware = require("../middleware/auth");
const worker = require("../worker");
const {
  getRedis,
  redisZScore,
  getSystemMetrics: getRedisMetrics,
  getPredictedRPM,
  getDynamicLimit,
} = require("../redis");

router.use(authMiddleware);

const { requirePageRight } = require("../middleware/requirePageRight");

// Admin-tier roles and directors always; anyone else holding the Live Metrics page right (metrics-dashboard,
// ticked in Menu Rights) too — the page itself already opens on that right, so its data should load with it.
const METRICS_ROLES = new Set(["admin", "super_admin", "dba", "director"]);
const metricsByRight = requirePageRight("metrics-dashboard", "view");
const metricsOnly = (req, res, next) =>
  METRICS_ROLES.has(String(req.user?.role || "").toLowerCase()) ? next() : metricsByRight(req, res, next);

// Engagement is scored per user id; the reply swaps each id for the person's name (flat [name, score, ...] pairs).
async function getTopEngagedUsers() {
  try {
    const redis = await getRedis();
    const flat = await redis.zrevrange("engagement:score", 0, 9, "WITHSCORES");
    const ids = flat.filter((_, i) => i % 2 === 0).map(Number).filter(Number.isInteger);
    if (ids.length === 0) return flat;
    const names = new Map(
      (await getPool().request().query(`SELECT id, name FROM dbo.users WHERE id IN (${ids.join(",")})`)).recordset.map(
        (r) => [String(r.id), r.name],
      ),
    );
    return flat.map((v, i) => (i % 2 === 0 ? names.get(String(v)) || `User ${v}` : v));
  } catch {
    return [];
  }
}

async function getDatabaseMetrics() {
  const pool = getPool();
  // One missing table (e.g. dbo.tenants on a single-tenant install) blanks only its own section.
  const safe = (q) =>
    pool
      .request()
      .query(q)
      .catch((err) => {
        console.warn("[system-metrics] query skipped:", err.message);
        return { recordset: [] };
      });

  const [
    usersResult,
    tenantsResult,
    tablesResult,
    expenseResult,
    purchaseResult,
    workOrderResult,
  ] = await Promise.all([
    safe(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN ISNULL(discontinue, 0) = 0 THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN ISNULL(discontinue, 0) = 1 THEN 1 ELSE 0 END) AS inactive
      FROM dbo.users
    `),
    // dbo.tenants only exists on multi-tenant installs.
    safe(`
      IF OBJECT_ID('dbo.tenants', 'U') IS NULL
        SELECT 0 AS total, 0 AS active, 0 AS suspended
      ELSE
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN LOWER(ISNULL(status, 'active')) = 'active' THEN 1 ELSE 0 END) AS active,
          SUM(CASE WHEN LOWER(ISNULL(status, '')) = 'suspended' THEN 1 ELSE 0 END) AS suspended
        FROM dbo.tenants
    `),
    safe(`
      SELECT TOP 10
        t.name AS tableName,
        SUM(CASE WHEN p.index_id IN (0, 1) THEN p.rows ELSE 0 END) AS RowCnt,
        SUM(a.total_pages) * 8 AS totalKB,
        SUM(a.used_pages) * 8 AS usedKB
      FROM sys.tables t
      INNER JOIN sys.indexes i
        ON t.object_id = i.object_id
      INNER JOIN sys.partitions p
        ON i.object_id = p.object_id
       AND i.index_id = p.index_id
      INNER JOIN sys.allocation_units a
        ON p.partition_id = a.container_id
      WHERE t.is_ms_shipped = 0
      GROUP BY t.name
      ORDER BY RowCnt DESC, t.name ASC
    `),
    safe(`
      SELECT
        ISNULL(EStatus, 'Draft') AS status,
        COUNT(*) AS count
      FROM dbo.ExpenseBooking
      GROUP BY ISNULL(EStatus, 'Draft')
      ORDER BY count DESC, status ASC
    `),
    safe(`
      SELECT
        ISNULL(Status, 'Draft') AS status,
        COUNT(*) AS count
      FROM dbo.PurchaseOrders
      GROUP BY ISNULL(Status, 'Draft')
      ORDER BY count DESC, status ASC
    `),
    safe(`
      SELECT
        ISNULL(Status, 'Draft') AS status,
        COUNT(*) AS count
      FROM dbo.WorkOrderHeader
      GROUP BY ISNULL(Status, 'Draft')
      ORDER BY count DESC, status ASC
    `),
  ]);

  return {
    users: {
      total: Number(usersResult.recordset[0]?.total || 0),
      active: Number(usersResult.recordset[0]?.active || 0),
      inactive: Number(usersResult.recordset[0]?.inactive || 0),
    },
    tenants: {
      total: Number(tenantsResult.recordset[0]?.total || 0),
      active: Number(tenantsResult.recordset[0]?.active || 0),
      suspended: Number(tenantsResult.recordset[0]?.suspended || 0),
    },
    tables: (tablesResult.recordset || []).map((row) => ({
      name: row.tableName,
      rows: Number(row.RowCnt || 0),
      totalKB: Number(row.totalKB || 0),
      usedKB: Number(row.usedKB || 0),
    })),
    modules: {
      expenseBooking: (expenseResult.recordset || []).map((row) => ({
        status: row.status,
        count: Number(row.count || 0),
      })),
      purchaseOrders: (purchaseResult.recordset || []).map((row) => ({
        status: row.status,
        count: Number(row.count || 0),
      })),
      workOrders: (workOrderResult.recordset || []).map((row) => ({
        status: row.status,
        count: Number(row.count || 0),
      })),
    },
  };
}

router.get("/", metricsOnly, async (req, res) => {
  try {
    const [redisMetrics, predictedRPM, topEngagedUsers, dbMetrics] =
      await Promise.all([
        getRedisMetrics(),
        getPredictedRPM(),
        getTopEngagedUsers(),
        getDatabaseMetrics(),
      ]);

    const uptimeSeconds = Math.floor(process.uptime());
    const response = {
      ...redisMetrics,
      workerOk: worker.isRunning(),
      predictedRPM,
      topEngagedUsers,
      users: dbMetrics.users,
      tenants: dbMetrics.tenants,
      tables: dbMetrics.tables,
      modules: dbMetrics.modules,
      server: {
        uptimeSeconds,
        uptimeHours: Number((uptimeSeconds / 3600).toFixed(2)),
        nodeVersion: process.version,
        rssMemoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
        heapUsedMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        environment: process.env.NODE_ENV || "development",
      },
    };

    if (req.user?.userId) {
      response.avgLimit = getDynamicLimit(
        (await redisZScore("engagement:score", req.user.userId)) || 0,
        predictedRPM || redisMetrics.rpm,
        redisMetrics.memoryUsage,
      );
    }

    res.json(response);
  } catch (err) {
    console.error("[system-metrics] failed:", err);
    res.status(500).json({ error: "Failed to fetch metrics" });
  }
});

module.exports = router;




