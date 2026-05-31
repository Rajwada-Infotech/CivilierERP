const express = require("express");
const router = express.Router();

const { getPool } = require("../db");
const authMiddleware = require("../middleware/auth");
const allowRoles = require("../middleware/role");
const {
  getRedis,
  redisZScore,
  getSystemMetrics: getRedisMetrics,
  getPredictedRPM,
  getDynamicLimit,
} = require("../redis");

router.use(authMiddleware);

const metricsOnly = allowRoles("admin", "super_admin", "dba", "director");

async function getTopEngagedUsers() {
  try {
    const redis = await getRedis();
    return await redis.zrevrange("engagement:score", 0, 9, "WITHSCORES");
  } catch {
    return [];
  }
}

async function getDatabaseMetrics() {
  const pool = getPool();

  const [
    usersResult,
    tenantsResult,
    tablesResult,
    expenseResult,
    purchaseResult,
    workOrderResult,
  ] = await Promise.all([
    pool.request().query(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN ISNULL(discontinue, 0) = 0 THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN ISNULL(discontinue, 0) = 1 THEN 1 ELSE 0 END) AS inactive
      FROM dbo.users
    `),
    pool.request().query(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN LOWER(ISNULL(status, 'active')) = 'active' THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN LOWER(ISNULL(status, '')) = 'suspended' THEN 1 ELSE 0 END) AS suspended
      FROM dbo.tenants
    `),
    pool.request().query(`
      SELECT TOP 10
        t.name AS tableName,
        SUM(CASE WHEN p.index_id IN (0, 1) THEN p.rows ELSE 0 END) AS rowCount,
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
      ORDER BY rowCount DESC, t.name ASC
    `),
    pool.request().query(`
      SELECT
        ISNULL(EStatus, 'Draft') AS status,
        COUNT(*) AS count
      FROM dbo.ExpenseBooking
      GROUP BY ISNULL(EStatus, 'Draft')
      ORDER BY count DESC, status ASC
    `),
    pool.request().query(`
      SELECT
        ISNULL(Status, 'Draft') AS status,
        COUNT(*) AS count
      FROM dbo.PurchaseOrders
      GROUP BY ISNULL(Status, 'Draft')
      ORDER BY count DESC, status ASC
    `),
    pool.request().query(`
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
      rows: Number(row.rowCount || 0),
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
    res.status(500).json({ error: "Failed to fetch metrics" });
  }
});

module.exports = router;


