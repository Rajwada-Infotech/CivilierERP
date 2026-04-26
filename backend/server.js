require("dotenv").config();

const isDev = process.env.NODE_ENV === "development";

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const compression = require("compression");

const { connectDB } = require("./db");
const authMiddleware = require("./middleware/auth");
const rateLimit = require("express-rate-limit");
const { RedisStore } = require("rate-limit-redis");

const logger = require("./logger");
const requestLogger = require("./requestLogger");
const { ipKeyGenerator } = require("express-rate-limit");

const { safeLoadRoutes, printRoutesSummary } = require("./utils/loadRoutes");

const {
  getRedis,
  redisZScore,
  incrGlobalRequests,
  pfaddActiveUser,
  getSystemMetrics,
  trackHourLoad,
  getPredictedRPM,
  getDynamicLimit,
} = require("./redis");

const ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:8080",
  "http://localhost:8081",
  "http://localhost:5173",
  "http://[::1]:3000",
  "http://[::1]:8080",
  "http://[::1]:8081",
  "http://[::1]:5173",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173",
  "https://civiliererp.vercel.app",
  "https://civiliererp.in",
];

function printBanner(port) {
  if (!isDev) return;
  logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  logger.info(" [APP] CivilierERP API");
  logger.info(` [URL] http://localhost:${port}`);
  logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

// Helper to create Redis-backed rate limit store (safe with lazyConnect)
function makeStore(prefix) {
  return new RedisStore({
    prefix,
    // Proper async wrapper for ioredis + lazyConnect
    sendCommand: (...args) => getRedis().then((client) => client.call(...args)),
  });
}

async function startServer() {
  try {
    logger.info("[DB] Connecting to database...");
    await connectDB();
    logger.info("[OK] Database connected");

    // Rate limiters
    const loginLimiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 10,
      message: { error: "Too many login attempts. Try again later." },
      store: makeStore("rl:login:"),
      standardHeaders: true,
      legacyHeaders: false,
    });

    const apiLimiter = rateLimit({
      windowMs: 60 * 1000,
      max: async (req) => {
        if (!req.user?.userId) return 1000;

        try {
          const score = Number(
            (await redisZScore("engagement:score", req.user.userId)) || 0,
          );
          const metrics = await getSystemMetrics();
          const predictedRPM = await getPredictedRPM();

          return getDynamicLimit(
            score,
            predictedRPM || metrics.rpm,
            metrics.memoryUsage,
          );
        } catch (err) {
          logger.warn(
            { event: "RATE_LIMIT_FALLBACK", err },
            "Using default limit due to Redis issue",
          );
          return 500; // safe fallback
        }
      },
      store: makeStore("rl:api:"),
      skip: (req) => req.path.startsWith("/api/user-activity"),
      keyGenerator: (req) => `${req.user?.userId || ipKeyGenerator(req)}`,
      standardHeaders: true,
      legacyHeaders: false,
    });

    const app = express();

    app.disable("x-powered-by");
    app.use(requestLogger);

    app.use((req, res, next) => {
      res.setHeader("X-Request-Id", req.id);
      next();
    });

    app.use(express.json({ limit: "10mb" }));
    app.use(express.urlencoded({ extended: true, limit: "10mb" }));

    app.use(helmet());
    app.use(
      cors({
        origin: (origin, callback) => {
          if (!origin || ALLOWED_ORIGINS.includes(origin)) {
            callback(null, true);
          } else {
            logger.warn(`[BLOCK] CORS rejected: ${origin}`);
            callback(new Error("Not allowed by CORS"));
          }
        },
        credentials: true,
        methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
        allowedHeaders: [
          "Content-Type",
          "Authorization",
          "X-Requested-With",
          "X-Request-Id",
        ],
        optionsSuccessStatus: 204,
      }),
    );

    app.use(compression());

    // Global request tracking (non-blocking)
    app.use(async (req, res, next) => {
      incrGlobalRequests().catch(() => {});
      trackHourLoad().catch(() => {});
      next();
    });

    // Apply limiters
    app.use("/api/users/login", loginLimiter);
    app.use("/api", apiLimiter);

    app.get("/", (req, res) => res.send("CivilierERP API running"));
    app.get("/health", (req, res) => res.json({ status: "ok" }));

    app.use("/api/users", require("./routes/users"));

    // Active user tracking (after auth)
    app.use("/api", authMiddleware, async (req, res, next) => {
      if (req.user?.userId) {
        pfaddActiveUser(req.user.userId).catch(() => {});
      }
      next();
    });

    logger.info("[ROUTES] Loading routes...");

    const routes = [
      { path: "/api/roles", file: "./routes/roles" },
      { path: "/api/user-rights", file: "./routes/userRights" },
      { path: "/api/account-group", file: "./routes/accountGroup" },
      { path: "/api/account-head", file: "./routes/accountHeadMaster" },
      { path: "/api/activity-master", file: "./routes/activityMaster" },
      { path: "/api/bank-master", file: "./routes/bankMaster" },
      { path: "/api/billing-terms", file: "./routes/billingTerms" },
      { path: "/api/card-master", file: "./routes/cardMaster" },
      { path: "/api/cheque-master", file: "./routes/chequeMaster" },
      { path: "/api/document-type", file: "./routes/documentType" },
      { path: "/api/fin-year", file: "./routes/finYear" },
      { path: "/api/general-ledger", file: "./routes/generalLedger" },
      { path: "/api/hsn", file: "./routes/hsn" },
      { path: "/api/item-groups", file: "./routes/itemGroup" },
      { path: "/api/item-master", file: "./routes/itemMaster" },
      { path: "/api/tds-master", file: "./routes/tdsMaster" },
      { path: "/api/enterprises", file: "./routes/enterprise" },
      { path: "/api/entry-type", file: "./routes/entryType" },
      { path: "/api/expense-booking", file: "./routes/expenseBooking" },
      { path: "/api/new-payment", file: "./routes/newPayment" },
      { path: "/api/received-payment", file: "./routes/receivedPayment" },
      { path: "/api/purchase-orders", file: "./routes/purchaseOrders" },
      { path: "/api/tenants", file: "./routes/tenants" },
      { path: "/api/work-orders", file: "./routes/workOrder" },
      { path: "/api/user-profile", file: "./routes/userProfile" },
      { path: "/api/uom-master", file: "./routes/uomMaster" },
      { path: "/api/debit-note", file: "./routes/debitNote" },
      { path: "/api/tc-master", file: "./routes/tcMaster" },
      { path: "/api/transactions", file: "./routes/transactions" },
      { path: "/api/grns", file: "./routes/grns" },
      { path: "/api/stock-ledger", file: "./routes/stockLedger" },
      { path: "/api/brs", file: "./routes/brs" },
      { path: "/api/reports", file: "./routes/reports" },
      { path: "/api/finance-dashboard", file: "./routes/financeDashboard" },
      { path: "/api/material-dashboard", file: "./routes/materialDashboard" },
      { path: "/api/admin-dashboard", file: "./routes/adminDashboard" },
      { path: "/api/user-activity", file: "./routes/userActivity" },
      { path: "/api/cheque-leaf", file: "./routes/chequeLeaf" },
      { path: "/api/contractor-category", file: "./routes/contractorCategory" },
      { path: "/api/approval-workflows", file: "./routes/approvalWorkflows" },
      { path: "/api/approval-inbox", file: "./routes/approvalInbox" },
      { path: "/api/tasks", file: "./routes/tasks" },
      { path: "/api/widgets", file: "./routes/widgets" },
      { path: "/api/tenant-reminders", file: "./routes/tenantReminders" },
      { path: "/api/reminders", file: "./routes/tenantReminders" },
      { path: "/api/company-master", file: "./routes/companyMaster" },
      { path: "/api/project-master", file: "./routes/projectMaster" },
      { path: "/api/signatures", file: "./routes/signatures" },
      { path: "/api/communicator", file: "./routes/communicator" },
    ];

    const routeResults = await safeLoadRoutes(app, routes, {
      baseDir: __dirname,
      logger,
      failFast: false,
      verbose: isDev,
    });

    // DBA route (admin only)
    try {
      app.use(
        "/api/dba",
        authMiddleware,
        require("./middleware/role")("dba", "admin", "director"),
        require("./routes/dba"),
      );
      routeResults.loaded.push("dba");
    } catch (err) {
      logger.error(`[ERR] Route failed [dba]: ${err.message}`);
      routeResults.failed.push({ label: "dba", error: err.message });
    }

    printRoutesSummary(routeResults, logger);
    logger.info(`[OK] Routes loaded: ${routeResults.loaded.length}`);

    // System metrics endpoint
    app.get("/api/system/metrics", authMiddleware, async (req, res) => {
      try {
        const metrics = await getSystemMetrics();
        const predictedRPM = await getPredictedRPM();
        metrics.predictedRPM = predictedRPM;

        const topEngagedUsers = await getRedis().then((r) =>
          r.zrevrange("engagement:score", 0, 9, "WITHSCORES"),
        );

        metrics.topEngagedUsers = topEngagedUsers;

        if (req.user) {
          metrics.avgLimit = getDynamicLimit(
            (await redisZScore("engagement:score", req.user.userId)) || 0,
            predictedRPM || metrics.rpm,
            metrics.memoryUsage,
          );
        }

        res.json(metrics);
      } catch (err) {
        logger.error({ event: "METRICS_ERROR", err });
        res.status(500).json({ error: "Failed to fetch metrics" });
      }
    });

    // Global error handler
    app.use((err, req, res, next) => {
      req.log?.error(`
[ERR] ERROR: ${err.message}
   -> ${req.method} ${req.url}
   -> user: ${req.user?.userId || "anonymous"}
`);
      res.status(500).json({
        error: "Internal Server Error",
        requestId: req.id,
      });
    });

    const PORT = process.env.PORT || 5000;

    app.listen(PORT, () => {
      printBanner(PORT);
      logger.info(`[START] Server ready on port ${PORT}`);
    });

    return app;
  } catch (err) {
    logger.error(`[FATAL] Server failed to start: ${err.message}`);
    process.exit(1);
  }
}

// For Vercel / serverless compatibility
const appPromise = startServer();

module.exports = async (req, res) => {
  const app = await appPromise;
  return app(req, res);
};
