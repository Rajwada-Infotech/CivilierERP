// requestLogger.js
const pinoHttp = require("pino-http");
const logger = require("./logger");
const { v4: uuidv4 } = require("uuid");

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

  // ✅ customProps removed — it uses an internal pino stringify symbol
  // that is not available on the worker-thread logger created by pino-pretty
  // transport, causing: "logger[stringifySym] is not a function".
  // Extra fields (reqId, userId) are instead attached via the serializers below.

  customAttributeKeys: {
    req: "req",
    res: "res",
    err: "err",
    responseTime: "responseTime",
    reqId: "reqId",
  },

  serializers: {
    // Keep req/res out of the log body to avoid noise
    req: () => undefined,
    res: () => undefined,
  },

  // Attach extra fields safely using wrapSerializers-compatible hook
  // (pino-http calls this before stringify, so it is always safe)
  customReceivedMessage: undefined,
  customReceivedObject: undefined,

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
