"use strict";

const pino = require("pino");

const isProd = process.env.NODE_ENV === "production";

// Warnings and errors also go to the terminal monitor's feed (services/activityFeed.js, npm run monitor). Skipped:
// pino-http's per-request lines and the global error handler's line, which the feed already gets directly.
function toMonitor(args, level) {
  if (level < 40) return;
  const [first, second] = args;
  const obj = first && typeof first === "object" && !(first instanceof Error) ? first : null;
  if (obj && ("responseTime" in obj || ("method" in obj && "url" in obj))) return;
  const err = first instanceof Error ? first : obj?.err instanceof Error ? obj.err : null;
  const msg = typeof first === "string" ? first : typeof second === "string" ? second : err?.message || obj?.event || "";
  require("./services/activityFeed").recordError({
    source: "log",
    level: level >= 60 ? "fatal" : level >= 50 ? "error" : "warn",
    msg: String(msg).slice(0, 500),
    event: obj?.event || null,
    detail: err ? err.message : typeof obj?.err === "string" ? obj.err.slice(0, 300) : null,
  });
}

const logger = pino({
  level: process.env.LOG_LEVEL || "info",

  hooks: {
    logMethod(args, method, level) {
      try {
        toMonitor(args, level);
      } catch {
        // The monitor must never get in the way of logging.
      }
      return method.apply(this, args);
    },
  },

  ...(isProd
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "HH:MM:ss",
            ignore: "pid,hostname,service,env",
            singleLine: true,
            messageFormat: "{msg}",
          },
        },
      }),

  // In prod, tag every log line with service info
  ...(isProd
    ? {
        base: {
          service: "civilier-erp-api",
          env: process.env.NODE_ENV,
        },
      }
    : { base: null }), // ← removes service/env clutter in dev
});

module.exports = logger;