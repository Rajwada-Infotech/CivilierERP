require("./config/env").loadEnv();

const isDev = process.env.NODE_ENV === "development";
const isTest = process.env.NODE_ENV === "test";

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const compression = require("compression");

const { connectDB, closeDB } = require("./db");
const authMiddleware = require("./middleware/auth");
const rateLimit = require("express-rate-limit");
const { RedisStore } = require("rate-limit-redis");

const logger = require("./logger");
const requestLogger = require("./requestLogger");
const {
  addRequestTiming,
  requestTimeout,
} = require("./middleware/requestObservability");

const { ipKeyGenerator } = require("express-rate-limit");
const { safeLoadRoutes, printRoutesSummary } = require("./utils/loadRoutes");
const http = require("http");
const { initSocket } = require("./socket");

const {
  getRedis,
  closeRedis,
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
  "http://127.0.0.1:8080",
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

function makeStore(prefix) {
  return new RedisStore({
    prefix,
    sendCommand: (...args) => getRedis().then((client) => client.call(...args)),
  });
}

// ─── ALL routes ─────────────────────────────────────────────────────────────
const ALL_ROUTES = [
  { path: "/api/roles", file: "./routes/roles" },
  { path: "/api/user-rights", file: "./routes/userRights" },
  { path: "/api/account-group", file: "./routes/accountGroup" },
  { path: "/api/account-head", file: "./routes/accountHeadMaster" },
  { path: "/api/activity-master", file: "./routes/activityMaster" },
  { path: "/api/bank-master", file: "./routes/bankMaster" },
  { path: "/api/billing-terms", file: "./routes/billingTerms" },
  { path: "/api/card-master", file: "./routes/cardMaster" },
  { path: "/api/cheque-master", file: "./routes/chequeMaster" },
  { path: "/api/document-type", file: "./routes/document-type" },
  { path: "/api/fin-year", file: "./routes/finYear" },
  { path: "/api/general-ledger", file: "./routes/generalLedger" },
  { path: "/api/hsn", file: "./routes/hsn" },
  { path: "/api/item-groups", file: "./routes/itemGroup" },
  { path: "/api/item-master", file: "./routes/itemMaster" },
  { path: "/api/tds-master", file: "./routes/tdsMaster" },
  { path: "/api/enterprises", file: "./routes/enterprise" },
  { path: "/api/entry-type", file: "./routes/entryType" },
  { path: "/api/expense-booking", file: "./routes/expenseBooking" },
  { path: "/api/amendments", file: "./routes/amendments" },
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
  { path: "/api/inventory-master", file: "./routes/inventoryMaster" },
  { path: "/api/brs", file: "./routes/brs" },
  { path: "/api/reports", file: "./routes/reports" },
  { path: "/api/finance-dashboard", file: "./routes/financeDashboard" },
  { path: "/api/material-dashboard", file: "./routes/materialDashboard" },
  { path: "/api/engineering", file: "./routes/engineering" },
  { path: "/api/material-issues", file: "./routes/materialIssues" },
  { path: "/api/material-requests", file: "./routes/materialRequests" },
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
  { path: "/api/followup-log", file: "./routes/followupLog" },
  { path: "/api/followup-applicants", file: "./routes/followupApplicants" },
  { path: "/api/followup-unit-selections", file: "./routes/followupUnitSelections" },
  { path: "/api/followup-agreements", file: "./routes/followupAgreements" },
  { path: "/api/followup-noc", file: "./routes/followupNoc" },
  { path: "/api/followup-sales-deed", file: "./routes/followupSalesDeed" },
  { path: "/api/followup-handover", file: "./routes/followupHandover" },
  { path: "/api/followup-construction-updates", file: "./routes/followupConstructionUpdates" },
  { path: "/api/company-master", file: "./routes/companyMaster" },
  { path: "/api/project-master", file: "./routes/projectMaster" },
  { path: "/api/business", file: "./routes/businessRoutes" },
  { path: "/api/tickets", file: "./routes/ticketRoutes" },
  { path: "/api/signatures", file: "./routes/signatures" },
  { path: "/api/communicator", file: "./routes/communicator" },
  { path: "/api/system/metrics", file: "./routes/systemMetrics" },
  { path: "/api/menu-master", file: "./routes/menuMaster" },
  { path: "/api/menu-type", file: "./routes/menuType" },
  { path: "/api/menu-types", file: "./routes/menuType" },
  { path: "/api/typeofdoc", file: "./routes/typeofdoc" },
  { path: "/api/boq", file: "./routes/boq" },
  { path: "/api/app-version", file: "./routes/appVersion" },
  { path: "/api/godowns", file: "./routes/godowns" },
  { path: "/api/stock-transfers", file: "./routes/stockTransfers" },
];

// ─── createApp ──────────────────────────────────────────────────────────────
async function createApp() {
  const app = express();
  app.locals.startupTime = new Date().toISOString();

  app.disable("x-powered-by");
  app.use(requestLogger);
  app.use(addRequestTiming);
  app.use(requestTimeout());

  app.use((req, res, next) => {
    res.setHeader("X-Request-Id", req.id || "test");
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

  // Ticket attachments are served through /api/tickets/file/:filename after auth.
  // Do not expose backend/uploads/tickets statically.
  // Global request tracking
  if (!isTest) {
    app.use(async (req, res, next) => {
      incrGlobalRequests().catch(() => {});
      trackHourLoad().catch(() => {});
      next();
    });
  }

  // ── Rate limiters ──────────────────────────────────────────────────────────
  // Registered inside createApp() so they apply in ALL environments,
  // including the Vercel serverless entry point (api/index.js) which calls
  // createApp() directly and never goes through startServer().
  if (!isTest) {
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
          return 500;
        }
      },
      store: makeStore("rl:api:"),
      skip: (req) => req.path.startsWith("/api/user-activity"),
      keyGenerator: (req) => `${req.user?.userId || ipKeyGenerator(req)}`,
      standardHeaders: true,
      legacyHeaders: false,
    });

    app.use("/api/users/login", loginLimiter);
    app.use("/api", apiLimiter);
  }

  app.get("/", (req, res) => res.send("CivilierERP API running"));
  app.use("/health", require("./routes/health"));

  app.use("/api/users", require("./routes/users"));

  // Active user tracking
  app.use("/api", authMiddleware, async (req, res, next) => {
    if (req.user?.userId) {
      pfaddActiveUser(req.user.userId).catch(() => {});
    }
    next();
  });

  if (!isTest) logger.info("[ROUTES] Loading routes...");

  const routeResults = await safeLoadRoutes(app, ALL_ROUTES, {
    baseDir: __dirname,
    logger,
    failFast: false,
    verbose: isDev,
  });

  // DBA route
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

  if (!isTest) {
    printRoutesSummary(routeResults, logger);
    logger.info(`[OK] Routes loaded: ${routeResults.loaded.length}`);
  }

  // ==================== IMPROVED GLOBAL ERROR HANDLER ====================
  app.use((err, req, res, next) => {
    const statusCode = err.status || err.statusCode || 500;

    // Log full error with Pino
    req.log?.error(
      {
        err, // This passes the real error + stack
        requestId: req.id,
        method: req.method,
        url: req.originalUrl || req.url,
        userId: req.user?.userId,
      },
      `Unhandled error ${statusCode} on ${req.method} ${req.url}`,
    );

    // Extra console output in development
    if (isDev) {
      console.error("\n🔥 UNHANDLED ERROR 🔥");
      console.error(err);
      console.error(`→ ${req.method} ${req.originalUrl || req.url}`);
      console.error("────────────────────────────────────\n");
    }

    // Help pino-http show the real error instead of generic message
    res.err = err;

    res.status(statusCode).json({
      success: false,
      error: "Internal Server Error",
      message: isDev ? err.message : "Something went wrong",
      requestId: req.id,
    });
  });

  return app;
}

// ─── startServer ────────────────────────────────────────────────────────────
async function startServer() {
  try {
    logger.info("[DB] Connecting to database...");
    await connectDB();
    const worker = require("./worker"); // Redis engagement decay + cleanup worker
    await worker.startWorker();

    logger.info("[OK] Database connected");

    const app = await createApp();

    // Rate limiters are registered inside createApp() — no duplication needed here.

    const PORT = process.env.PORT || 5000;

    const httpServer = http.createServer(app);
    initSocket(httpServer);

    const server = httpServer.listen(PORT, () => {
      printBanner(PORT);
      logger.info(`[START] Server ready on port ${PORT}`);
    });

    setupGracefulShutdown(server, worker);

    return app;
  } catch (err) {
    logger.error(`[FATAL] Server failed to start: ${err.message}`);
    process.exit(1);
  }
}

function setupGracefulShutdown(server, worker) {
  let shuttingDown = false;

  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.warn(
      { event: "SHUTDOWN_START", signal },
      "Graceful shutdown started",
    );

    const forceExitTimer = setTimeout(
      () => {
        logger.fatal(
          { event: "SHUTDOWN_FORCE_EXIT", signal },
          "Graceful shutdown timed out",
        );
        process.exit(1);
      },
      Number(process.env.SHUTDOWN_TIMEOUT_MS || 10000),
    );
    forceExitTimer.unref();

    server.close(async (err) => {
      if (err) {
        logger.error(
          { event: "HTTP_SERVER_CLOSE_ERROR", err },
          "HTTP close failed",
        );
      }

      try {
        worker?.stopWorker?.();
        await closeRedis();
        await closeDB();
        logger.info(
          { event: "SHUTDOWN_DONE", signal },
          "Graceful shutdown complete",
        );
        process.exit(err ? 1 : 0);
      } catch (closeErr) {
        logger.error(
          { event: "SHUTDOWN_CLOSE_ERROR", err: closeErr },
          "Graceful shutdown failed",
        );
        process.exit(1);
      }
    });
  }

  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
}

// ─── Exports ────────────────────────────────────────────────────────────────
module.exports = { startServer, createApp };

// Auto-start in non-test mode
if (!isTest) {
  startServer().then((serverApp) => {
    module.exports.app = serverApp;
  });
}
