"use strict";

const logger = require("../logger");

const DEFAULT_TIMEOUT_MS = Number(process.env.API_REQUEST_TIMEOUT_MS || 30000);
const WARN_MS = Number(process.env.SLOW_REQUEST_WARN_MS || 1000);
const ERROR_MS = Number(process.env.SLOW_REQUEST_ERROR_MS || 5000);
const CRITICAL_MS = Number(process.env.SLOW_REQUEST_CRITICAL_MS || 30000);

function elapsedMs(start) {
  return Number(process.hrtime.bigint() - start) / 1e6;
}

function rounded(ms) {
  return Math.round(ms * 100) / 100;
}

function addRequestTiming(req, res, next) {
  const requestStart = process.hrtime.bigint();
  const stages = [];

  req.timing = {
    start: requestStart,
    mark(name, startedAt, extra = {}) {
      const durationMs = rounded(elapsedMs(startedAt));
      stages.push({ name, durationMs, ...extra });
      return durationMs;
    },
    startStage() {
      return process.hrtime.bigint();
    },
    stages,
  };

  res.on("finish", () => {
    const durationMs = rounded(elapsedMs(requestStart));
    const details = {
      event: "REQUEST_TIMING",
      requestId: req.id,
      method: req.method,
      url: req.originalUrl || req.url,
      statusCode: res.statusCode,
      durationMs,
      userId: req.user?.userId || req.user?.id,
      stages,
    };

    if (durationMs >= CRITICAL_MS) {
      logger.fatal(details, "Critical slow request");
    } else if (durationMs >= ERROR_MS) {
      logger.error(details, "Slow request");
    } else if (durationMs >= WARN_MS) {
      logger.warn(details, "Slow request");
    }
  });

  next();
}

function requestTimeout(timeoutMs = DEFAULT_TIMEOUT_MS) {
  return (req, res, next) => {
    // Skip global request timeouts for Server-Sent Events.
    if (
      req.headers.accept === "text/event-stream" ||
      req.originalUrl?.includes("/stream") ||
      req.url?.includes("/stream")
    ) {
      return next();
    }

    req.timedout = false;

    res.setTimeout(timeoutMs, () => {
      req.timedout = true;
      const payload = {
        event: "REQUEST_TIMEOUT",
        requestId: req.id,
        method: req.method,
        url: req.originalUrl || req.url,
        timeoutMs,
        userId: req.user?.userId || req.user?.id,
      };

      logger.error(payload, "Request timeout");

      if (!res.headersSent) {
        res.status(503).json({
          success: false,
          message: "Request timeout",
          requestId: req.id,
        });
      }
    });

    next();
  };
}

module.exports = {
  addRequestTiming,
  requestTimeout,
};
