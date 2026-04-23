require("dotenv").config();
const isDev = process.env.NODE_ENV === "development";

const express = require("express");
const helmet = require("helmet");
const morgan = require("morgan");
const cors = require("cors");
const compression = require("compression");
const { connectDB } = require("./db");
const authMiddleware = require("./middleware/auth");
const rateLimit = require("express-rate-limit");
const logger = require("./logger");
const { ipKeyGenerator } = require("express-rate-limit");

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

async function startServer() {
  try {
    await connectDB();

    function makeStore(prefix) {
      try {
        const { RedisStore } = require("rate-limit-redis");
        return new RedisStore({
          prefix,
          sendCommand: (...args) => getRedis().call(...args),
        });
      } catch {
        return undefined;
      }
    }

    const loginLimiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 10,
      message: { error: "Too many login attempts. Try again later." },
      store: makeStore("rl:login:"),
    });

    const apiLimiter = rateLimit({
      windowMs: 60 * 1000,
      max: async (req) => {
        if (!req.user || !req.user.userId) return 1000;
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
      },
      store: makeStore("rl:api:"),
      skip: (req) => req.path.startsWith("/api/user-activity"),
      keyGenerator: (req) => `${req.user?.userId || ipKeyGenerator(req)}`,
    });

    const app = express();

    app.disable("x-powered-by");

    // ====================== MIDDLEWARE ======================
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use(helmet());
    app.use(morgan("tiny"));

    // CORS
    app.use(
      cors({
        origin: (origin, callback) => {
          if (!origin || ALLOWED_ORIGINS.includes(origin)) {
            callback(null, true);
          } else {
            console.warn(`CORS rejected origin: ${origin}`);
            callback(new Error("Not allowed by CORS"));
          }
        },
        credentials: true,
        methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
        optionsSuccessStatus: 204,
      }),
    );

    app.use(compression());

    // Request logger
    app.use((req, res, next) => {
      const start = Date.now();
      res.on("finish", () => {
        const duration = Date.now() - start;
        logger.info({
          method: req.method,
          url: req.originalUrl,
          status: res.statusCode,
          time: `${duration}ms`,
        });
      });
      next();
    });

    // Global request tracking
    app.use(async (req, res, next) => {
      try {
        await incrGlobalRequests();
        await trackHourLoad();
      } catch {}
      next();
    });

    // ====================== RATE LIMITERS ======================
    app.use("/api/users/login", loginLimiter);
    app.use("/api", apiLimiter);

    // ====================== PUBLIC ROUTES (no auth) ======================
    app.get("/", (req, res) => res.send("CivilierERP API running"));
    app.get("/health", (req, res) => res.json({ status: "ok" }));

    app.use("/api/users", require("./routes/users"));


    // ====================== AUTH + ACTIVE USER TRACKING ======================
    app.use("/api", authMiddleware, async (req, res, next) => {
      if (req.user?.userId) {
        pfaddActiveUser(req.user.userId).catch(() => {});
      }
      next();
    });

    // ====================== PROTECTED ROUTES ======================
    const routes = [
{ path: "/api/roles",         file: "./routes/roles" },
  { path: "/api/user-rights",        file: "./routes/userRights" },
      { path: "/api/account-group",      file: "./routes/accountGroup" },
      { path: "/api/account-head",       file: "./routes/accountHeadMaster" },
      { path: "/api/activity-master",    file: "./routes/activityMaster" },
      { path: "/api/bank-master",        file: "./routes/bankMaster" },
      { path: "/api/billing-terms",      file: "./routes/billingTerms" },
      { path: "/api/card-master",        file: "./routes/cardMaster" },
      { path: "/api/cheque-master",      file: "./routes/chequeMaster" },
      { path: "/api/document-type",      file: "./routes/documentType" },
      { path: "/api/fin-year",           file: "./routes/finYear" },
      { path: "/api/general-ledger",     file: "./routes/generalLedger" },
      { path: "/api/hsn",                file: "./routes/hsn" },
      { path: "/api/item-groups",        file: "./routes/itemGroup" },
      { path: "/api/item-master",        file: "./routes/itemMaster" },
      { path: "/api/tds-master",         file: "./routes/tdsMaster" },
      { path: "/api/enterprises",        file: "./routes/enterprise" },
      { path: "/api/entry-type",         file: "./routes/entryType" },
      { path: "/api/expense-booking",    file: "./routes/expenseBooking" },
      { path: "/api/new-payment",        file: "./routes/newPayment" },
      { path: "/api/received-payment",   file: "./routes/receivedPayment" },
      { path: "/api/purchase-orders",    file: "./routes/purchaseOrders" },
      { path: "/api/tenants",            file: "./routes/tenants" },
      { path: "/api/work-orders",        file: "./routes/workOrder" },
      { path: "/api/user-profile",       file: "./routes/userProfile" },
      { path: "/api/uom-master",         file: "./routes/uomMaster" },
      { path: "/api/debit-note",         file: "./routes/debitNote" },
      { path: "/api/tc-master",          file: "./routes/tcMaster" },
      { path: "/api/transactions", file: "./routes/transactions" },
      { path: "/api/grns",               file: "./routes/grns" },
      { path: "/api/stock-ledger",       file: "./routes/stockLedger" },
{ path: "/api/brs",                file: "./routes/brs" },
      { path: "/api/reports",             file: "./routes/reports" },
      { path: "/api/finance-dashboard",  file: "./routes/financeDashboard" },
      { path: "/api/material-dashboard", file: "./routes/materialDashboard" },
      { path: "/api/admin-dashboard",    file: "./routes/adminDashboard" },
      { path: "/api/user-activity",      file: "./routes/userActivity" },
      { path: "/api/business-units",     file: "./routes/businessUnit" },
      { path: "/api/cheque-leaf",       file: "./routes/chequeLeaf" },
      { path: "/api/contractor-category", file: "./routes/contractorCategory" },
{ path: "/api/approval-workflows", file: "./routes/approvalWorkflows" },
      { path: "/api/approval-inbox", file: "./routes/approvalInbox" },
      { path: "/api/tasks", file: "./routes/tasks" },
      { path: "/api/widgets", file: "./routes/widgets" },
    ];

    for (const { path, file } of routes) {
      const label = path.replace("/api/", "");
      if (isDev) console.log(`Loading route: ${label}`);
      try {
        app.use(path, authMiddleware, require(file));
      } catch (err) {
        console.error(`❌ Failed loading route: ${label} — ${err.message}`);
        throw err;
      }
    }

    // DBA route with role restriction
    if (isDev) console.log("Loading route: dba");
    try {
      app.use(
        "/api/dba",
        authMiddleware,
        require("./middleware/role")("dba", "admin", "director"),
        require("./routes/dba"),
      );
    } catch (err) {
      console.error(`❌ Failed loading route: dba — ${err.message}`);
      throw err;
    }

    // ====================== SYSTEM METRICS ======================
    app.get("/api/system/metrics", authMiddleware, async (req, res) => {
      try {
        const metrics = await getSystemMetrics();
        const predictedRPM = await getPredictedRPM();
        metrics.predictedRPM = predictedRPM;

        const topEngagedUsers = await getRedis().zrevrange(
          "engagement:score",
          0,
          9,
          "WITHSCORES",
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
        res.status(500).json({ error: err.message });
      }
    });

    // ====================== GLOBAL ERROR HANDLER ======================
    app.use((err, req, res, next) => {
      logger.error({
        message: err.message,
        stack: err.stack,
      });
      res.status(500).json({ error: "Internal Server Error" });
    });

    // ====================== START SERVER ======================
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => logger.info(`Server running on port ${PORT}`));

    return app;
  } catch (err) {
    console.error("Failed to start server:", err.message);
    process.exit(1);
  }
}

const appPromise = startServer();
module.exports = async (req, res) => {
  const app = await appPromise;
  return app(req, res);
};
