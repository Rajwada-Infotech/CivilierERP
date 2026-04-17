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

    app.use(async (req, res, next) => {
      try {
        await incrGlobalRequests();
        await trackHourLoad();
      } catch {}
      next();
    });

<<<<<<< HEAD
    const corsOptions = {
      origin: (origin, cb) => {
        if (process.env.NODE_ENV === "development" && origin) {
          console.log("CORS:", origin);
        }
        if (!origin || ALLOWED_ORIGINS.includes(origin)) {
          cb(null, true);
        } else {
          if (process.env.NODE_ENV === "development") {
            console.log(`CORS rejected: ${origin}`);
          }
          cb(new Error("Not allowed by CORS"));
        }
      },
      credentials: true,
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    };

    app.use(cors(corsOptions));
    app.use(compression());

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

    // Health check — must be before auth middleware
    app.get("/", (req, res) => res.send("CivilierERP API running"));
    app.get("/health", (req, res) => res.json({ status: "ok" }));

    // Rate limiters
    app.use("/api/users/login", loginLimiter);
    app.use("/api", apiLimiter);

    // Public routes (no auth)
=======
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

    // ====================== RATE LIMITERS ======================
    app.use("/api/users/login", loginLimiter);
    app.use("/api", apiLimiter);

    // ====================== ROUTES ======================

    // Public routes
>>>>>>> 29d867355f6214f453259329362bf048a99aa8e9
    app.use("/api/users", require("./routes/users"));
    app.use("/api/roles", require("./routes/roles"));

    // Global authentication for all /api routes (except the public ones above)
    app.use("/api", authMiddleware);

<<<<<<< HEAD
    // Track active users after auth (scoped to /api only)
    app.use("/api", authMiddleware, async (req, res, next) => {
=======
    // Active user tracking
    app.use((req, res, next) => {
>>>>>>> 29d867355f6214f453259329362bf048a99aa8e9
      if (req.user?.userId) {
        pfaddActiveUser(req.user.userId).catch(() => {});
      }
      next();
    });
<<<<<<< HEAD

    // Route definitions
    const routes = [
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
      { path: "/api/purchase-orders",    file: "./routes/purchaseOrders" },
      { path: "/api/tenants",            file: "./routes/tenants" },
      { path: "/api/work-orders",        file: "./routes/workOrder" },
      { path: "/api/user-profile",       file: "./routes/userProfile" },
      { path: "/api/uom-master",         file: "./routes/uomMaster" },
      { path: "/api/debit-note",         file: "./routes/debitNote" },
      { path: "/api/tc-master",          file: "./routes/tcMaster" },
      { path: "/api/grns",               file: "./routes/grns" },
      { path: "/api/stock-ledger",       file: "./routes/stockLedger" },
      { path: "/api/brs",                file: "./routes/brs" },
      { path: "/api/finance-dashboard",  file: "./routes/financeDashboard" },
      { path: "/api/material-dashboard", file: "./routes/materialDashboard" },
      { path: "/api/user-activity",      file: "./routes/userActivity" },
      { path: "/api/roles",              file: "./routes/roles" },
      { path: "/api/business-units",     file: "./routes/businessUnit" },
      { path: "/api/tasks",              file: "./routes/tasks" },
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
      app.use("/api/dba", authMiddleware, allowRoles("dba", "admin"), require("./routes/dba"));
    } catch (err) {
      console.error(`❌ Failed loading route: dba — ${err.message}`);
      throw err;
    }

    // System metrics endpoint
    app.get("/api/system/metrics", authMiddleware, async (req, res) => {
=======

    // Protected routes
    app.use("/api/user-rights", require("./routes/userRights"));
    app.use("/api/account-group", require("./routes/accountGroup"));
    app.use("/api/account-head", require("./routes/accountHeadMaster"));
    app.use("/api/activity-master", require("./routes/activityMaster"));
    app.use("/api/bank-master", require("./routes/bankMaster"));
    app.use("/api/billing-terms", require("./routes/billingTerms"));
    app.use("/api/card-master", require("./routes/cardMaster"));
    app.use("/api/cheque-master", require("./routes/chequeMaster"));
    app.use("/api/document-type", require("./routes/documentType"));
    app.use("/api/fin-year", require("./routes/finYear"));
    app.use("/api/general-ledger", require("./routes/generalLedger"));
    app.use("/api/hsn", require("./routes/hsn"));
    app.use("/api/item-groups", require("./routes/itemGroup"));
    app.use("/api/item-master", require("./routes/itemMaster"));
    app.use("/api/tds-master", require("./routes/tdsMaster"));
    app.use("/api/enterprises", require("./routes/enterprise"));
    app.use("/api/entry-type", require("./routes/entryType"));
    app.use("/api/expense-booking", require("./routes/expenseBooking"));
    app.use("/api/new-payment", require("./routes/newPayment"));
    app.use("/api/purchase-orders", require("./routes/purchaseOrders"));
    app.use("/api/tenants", require("./routes/tenants"));
    app.use("/api/work-orders", require("./routes/workOrder"));
    app.use("/api/user-profile", require("./routes/userProfile"));
    app.use("/api/uom-master", require("./routes/uomMaster"));
    app.use("/api/debit-note", require("./routes/debitNote"));
    app.use("/api/tc-master", require("./routes/tcMaster"));
    app.use("/api/grns", require("./routes/grns"));
    app.use("/api/finance-dashboard", require("./routes/financeDashboard"));
    app.use("/api/material-dashboard", require("./routes/materialDashboard"));
    app.use("/api/admin-dashboard", require("./routes/adminDashboard"));
    app.use("/api/user-activity", require("./routes/userActivity"));
    app.use("/api/tasks", require("./routes/tasks"));

    // Routes with extra role checks
    const allowRoles = require("./middleware/role");
    app.use(
      "/api/dba",
      allowRoles("dba", "admin", "director"),
      require("./routes/dba"),
    );

    // System metrics
    app.get("/api/system/metrics", async (req, res) => {
>>>>>>> 29d867355f6214f453259329362bf048a99aa8e9
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
    });

<<<<<<< HEAD
    // Global error handler
    app.use((err, req, res, next) => {
      logger.error({
        message: err.message,
        stack: err.stack,
      });
      res.status(500).json({ error: "Internal Server Error" });
    });

    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => logger.info(`Server running on port ${PORT}`));
=======
    app.get("/", (req, res) => res.send("CivilierERP API running"));

    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });
>>>>>>> 29d867355f6214f453259329362bf048a99aa8e9

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