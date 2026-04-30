// requestLogger.js
const pinoHttp = require("pino-http");
const pino = require("pino");
const { v4: uuidv4 } = require("uuid");

const isProd = process.env.NODE_ENV === "production";

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  ...(isProd
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "HH:MM:ss",
            ignore: "pid,hostname,reqId,req,res,responseTime",
            singleLine: true,
          },
        },
      }),
  base: null,
});

// High-frequency routes to silence
const SILENT_ROUTES = [
  "/",
  "/health",
  "/favicon.ico",
  "/api/user-activity",
  "/api/purchase-orders",
  "/api/grns",
  "/api/tds-master",
  "/api/cheque-master",
  "/api/work-orders",
];

module.exports = pinoHttp({
  logger,

  genReqId: (req) => req.headers["x-request-id"] || uuidv4(),

  customLogLevel: (req, res, err) => {
    if (err || res.statusCode >= 500) return "error";
    if (res.statusCode >= 400) return "warn";
    if (res.responseTime > 800) return "warn";
    return "info";
  },

  // Clean message without icons
  customSuccessMessage: (req, res, responseTime) => {
    const method = req.method.padEnd(6);
    const url =
      req.url.length > 45
        ? req.url.substring(0, 42) + "..."
        : req.url.padEnd(45);

    return `${method} ${url} ${res.statusCode} ${responseTime}ms`;
  },

  customErrorMessage: (req, res, err) => {
    return `ERROR ${req.method} ${req.url} → ${res.statusCode} ${err?.message || ""}`;
  },

  // Remove bulky objects from output
  serializers: {
    req: () => undefined,
    res: () => undefined,
  },

  // Silence noisy routes
  autoLogging: {
    ignore: (req) => {
      return SILENT_ROUTES.some(
        (route) =>
          req.url === route ||
          req.url.startsWith(route + "?") ||
          req.url.startsWith(route + "/"),
      );
    },
  },
});
