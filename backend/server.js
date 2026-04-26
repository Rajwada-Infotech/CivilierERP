require("dotenv").config();
const isDev = process.env.NODE_ENV === "development";

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const compression = require("compression");
const { connectDB } = require("./db");
const authMiddleware = require("./middleware/auth");
const rateLimit = require("express-rate-limit");
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
  "http://localhost:5173",
  "https://civiliererp.vercel.app",
  "https://civiliererp.in",
];

function printBanner(port) {
  if (!isDev) return;
  logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  logger.info(`Server running on http://localhost:${port}`);
  logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

async function makeStore(prefix) {
  try {
    const { RedisStore } = require("rate-limit-redis");
    const redis = await getRedis();

    return new RedisStore({
      prefix,
      sendCommand: (...args) => redis.call(...args),
    });
  } catch (err) {
    logger.warn(`[REDIS] fallback memory store: ${err.message}`);
    return undefined;
  }
}

async function startServer() {
  try {
    await connectDB();

    // ✅ ensure Redis ready before rate limiter
    const loginStore = await makeStore("rl:login:");
    const apiStore = await makeStore("rl:api:");

    const loginLimiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 10,
      message: { error: "Too many login attempts" },
      store: loginStore,
    });

    const apiLimiter = rateLimit({
      windowMs: 60 * 1000,
      max: async (req) => {
        if (!req.user) return 1000;

        const score =
          (await redisZScore("engagement:score", req.user.userId)) || 0;

        const metrics = await getSystemMetrics();
        const predicted = await getPredictedRPM();

        return getDynamicLimit(
          score,
          predicted || metrics.rpm,
          metrics.memoryUsage,
        );
      },
      store: apiStore,
      keyGenerator: (req) => `${req.user?.userId || ipKeyGenerator(req)}`,
    });

    const app = express();

    app.use(requestLogger);
    app.use(express.json());
    app.use(helmet());
    app.use(cors({ origin: ALLOWED_ORIGINS }));
    app.use(compression());

    app.use(async (req, res, next) => {
      await incrGlobalRequests();
      await trackHourLoad();
      next();
    });

    app.use("/api/users/login", loginLimiter);
    app.use("/api", apiLimiter);

    app.get("/", (req, res) => res.send("API running"));
    app.get("/health", (req, res) => res.json({ ok: true }));

    app.use("/api/users", require("./routes/users"));

    app.use("/api", authMiddleware, async (req, res, next) => {
      if (req.user?.userId) {
        pfaddActiveUser(req.user.userId).catch(() => {});
      }
      next();
    });

    const PORT = process.env.PORT || 5000;

    app.listen(PORT, () => {
      printBanner(PORT);
      logger.info(`Server started on ${PORT}`);
    });

    return app;
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
}

const appPromise = startServer();

module.exports = async (req, res) => {
  const app = await appPromise;
  return app(req, res);
};
