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

    // ---------------------------------------------------------------------------
    // Build Redis-backed rate limit stores INSIDE startServer so the Redis
    // client is already initialised before RedisStore tries to send commands.
    // Falls back to in-memory if the package isn't available or Redis is down.
    // ---------------------------------------------------------------------------
    function makeStore(prefix) {
      try {
        const { RedisStore } = require("rate-limit-redis");
        return new RedisStore({
          prefix,
          sendCommand: (...args) => getRedis().call(...args),
        });
      } catch {
        return undefined; // in-memory fallback
      }
    }

    const loginLimiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 10,
      message: { error: "Too many login attempts. Try again later." },
      store: makeStore("rl:login:"),
    });

    const apiLimiter = rateLimit({
      windowMs: 60 * 1000, // 1 min buckets for scaling
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

    // ---------------------------------------------------------------------------

    const app = express();
    app.disable("x-powered-by");

    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use(helmet());
    app.use(morgan("dev"));

    // Track global metrics on every request
    app.use(async (req, res, next) => {
      try {
        await incrGlobalRequests();
        await trackHourLoad();
      } catch {}
      next();
    });

    app.use(
      cors({
        origin: (origin, cb) => {
          console.log(`CORS request from origin: ${origin || "undefined"}`);
          if (!origin || ALLOWED_ORIGINS.includes(origin)) {
            cb(null, true);
          } else {
            console.log(`CORS rejected origin: ${origin}`);
            cb(null, false);
          }
        },
        credentials: true,
      }),
    );

    app.get("/", (req, res) => res.send("CivilierERP API running"));

    // Rate limiters
    app.use("/api/users/login", loginLimiter);
    app.use("/api", apiLimiter);

    // Public
    app.use("/api/users", require("./routes/users"));

    // Protected
    const allowRoles = require("./middleware/role");

    // Track active users after auth
    app.use(authMiddleware, async (req, res, next) => {
      if (req.user?.userId) {
        try {
          await pfaddActiveUser(req.user.userId);
        } catch {}
      }
      next();
    });

    app.use(
      "/api/account-group",
      authMiddleware,
      require("./routes/accountGroup"),
    );
    app.use(
      "/api/account-head",
      authMiddleware,
      require("./routes/accountHeadMaster"),
    );
    app.use(
      "/api/activity-master",
      authMiddleware,
      require("./routes/activityMaster"),
    );
    app.use("/api/bank-master", authMiddleware, require("./routes/bankMaster"));
    app.use(
      "/api/billing-terms",
      authMiddleware,
      require("./routes/billingTerms"),
    );
    app.use("/api/card-master", authMiddleware, require("./routes/cardMaster"));
    app.use(
      "/api/cheque-master",
      authMiddleware,
      require("./routes/chequeMaster"),
    );
    app.use(
      "/api/document-type",
      authMiddleware,
      require("./routes/documentType"),
    );
    app.use("/api/fin-year", authMiddleware, require("./routes/finYear"));
    app.use(
      "/api/general-ledger",
      authMiddleware,
      require("./routes/generalLedger"),
    );
    app.use("/api/hsn", authMiddleware, require("./routes/hsn"));
    app.use("/api/item-groups", authMiddleware, require("./routes/itemGroup"));
    app.use("/api/item-master", authMiddleware, require("./routes/itemMaster"));
    app.use("/api/tds-master", authMiddleware, require("./routes/tdsMaster"));
    app.use("/api/enterprises", authMiddleware, require("./routes/enterprise"));
    app.use("/api/entry-type", authMiddleware, require("./routes/entryType"));
    app.use(
      "/api/expense-booking",
      authMiddleware,
      require("./routes/expenseBooking"),
    );
    app.use("/api/new-payment", authMiddleware, require("./routes/newPayment"));
    app.use(
      "/api/purchase-orders",
      authMiddleware,
      require("./routes/purchaseOrders"),
    );
    app.use("/api/tenants", authMiddleware, require("./routes/tenants"));
    app.use(
      "/api/dba",
      authMiddleware,
      allowRoles("dba", "admin"),
      require("./routes/dba"),
    );
    app.use("/api/work-orders", authMiddleware, require("./routes/workOrder"));
    app.use(
      "/api/user-profile",
      authMiddleware,
      require("./routes/userProfile"),
    );
    app.use("/api/uom-master", authMiddleware, require("./routes/uomMaster"));
    app.use("/api/debit-note", authMiddleware, require("./routes/debitNote"));
    app.use("/api/tc-master", authMiddleware, require("./routes/tcMaster"));
    app.use("/api/grns", authMiddleware, require("./routes/grns"));
    app.use(
      "/api/finance-dashboard",
      authMiddleware,
      require("./routes/financeDashboard"),
    );
    app.use(
      "/api/user-activity",
      authMiddleware,
      require("./routes/userActivity"),
    );

    // System metrics endpoint
    app.get("/api/system/metrics", authMiddleware, async (req, res) => {
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

    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

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
