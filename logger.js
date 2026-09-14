"use strict";

const pino = require("pino");

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