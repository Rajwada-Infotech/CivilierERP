const pinoHttp = require("pino-http");
const pino = require("pino");
const { v4: uuidv4 } = require("uuid");

const isProd = process.env.NODE_ENV === "production";

// Shared pretty logger so request logs go through pino-pretty too
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
            messageFormat: "{msg}",
          },
        },
      }),
  base: null,
});

// Routes to silence (high-frequency polling)
const SILENT_ROUTES = [
  "/api/purchase-orders",
  "/api/grns",
  "/api/tds-master",
  "/api/user-activity",
  "/", // silence root health-check spam
];

function statusIcon(code) {
  if (code >= 500) return "🔴";
  if (code >= 400) return "🟠";
  if (code >= 300) return "🟡";
  return "🟢";
}

module.exports = pinoHttp({
  logger, // share the pretty logger

  genReqId: (req) => req.headers["x-request-id"] || uuidv4(),

  // 3-arg signature: (req, res, err)
  customLogLevel: (req, res, err) => {
    if (res.statusCode >= 500 || err) return "error";
    if (res.statusCode >= 400) return "warn";
    if (res.responseTime > 1000) return "warn";
    return "info";
  },

  // responseTime is the 3rd explicit param here
  customSuccessMessage: (req, res, responseTime) => {
    const icon = statusIcon(res.statusCode);
    const method = req.method.padEnd(6);
    const url = req.url.padEnd(32);
    return `${icon} ${method} ${url} ${res.statusCode}  ${responseTime}ms`;
  },

  customErrorMessage: (req, res, err) => {
    return `🔴 ${req.method} ${req.url}  ERROR ${res.statusCode}  ${err?.message || ""}`;
  },

  // Strip bulky req/res objects from the log line
  serializers: {
    req: () => undefined,
    res: () => undefined,
  },

  // Silence noisy polling routes
  autoLogging: {
    ignore: (req) =>
      SILENT_ROUTES.some((r) => req.url === r || req.url.startsWith(r + "?")),
  },
});