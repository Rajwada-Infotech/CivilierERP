require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const morgan = require("morgan");
const cors = require("cors");
const { connectDB } = require("./db");
const authMiddleware = require("./middleware/auth");
const rateLimit = require("express-rate-limit");
const { getRedis } = require("./redis");

const ALLOWED_ORIGINS = [
  "http://localhost:8080",
  "http://localhost:8081",
  "http://localhost:5173",
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
      windowMs: 15 * 60 * 1000,
      max: 1000,
      store: makeStore("rl:api:"),
      skip: (req) => req.path.startsWith("/api/user-activity"),
    });

    // ---------------------------------------------------------------------------

    const app = express();
    app.disable("x-powered-by");

    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use(helmet());
    app.use(morgan("dev"));

    app.use(
      cors({
        origin: (origin, cb) => {
          if (!origin || ALLOWED_ORIGINS.includes(origin)) {
            cb(null, true);
          } else {
            cb(new Error("Not allowed by CORS"));
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
      "/api/user-activity",
      authMiddleware,
      require("./routes/userActivity"),
    );

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
