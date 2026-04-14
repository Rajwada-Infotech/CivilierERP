require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const morgan = require("morgan");
const cors = require("cors");
const { connectDB } = require("./db");
const authMiddleware = require("./middleware/auth");
const rateLimit = require("express-rate-limit");
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
      store: makeStore(`rl:api:${Math.floor(Date.now() / 60000)}:`),
      skip: (req) => req.path.startsWith("/api/user-activity"),
      keyGenerator: (req) => `${req.user?.userId || ipKeyGenerator(req)}`,
    });

    const app = express();

    app.disable("x-powered-by");

    // ====================== MIDDLEWARE ======================
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use(helmet());
    app.use(morgan("dev"));

    app.use(async (req, res, next) => {
      try {
        await incrGlobalRequests();
        await trackHourLoad();
      } catch {}
      next();
    });

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
    app.use("/api/users", require("./routes/users"));
    app.use("/api/roles", require("./routes/roles"));

    // Global authentication for all /api routes (except the public ones above)
    app.use("/api", authMiddleware);

    // Active user tracking
    app.use((req, res, next) => {
      if (req.user?.userId) {
        pfaddActiveUser(req.user.userId).catch(() => {});
      }
      next();
    });

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

    app.get("/", (req, res) => res.send("CivilierERP API running"));

    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });

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
