// After any successful write (POST / PUT / PATCH / DELETE answered 2xx) anywhere in the API, bump the "any-write"
// cache version. Every cache made with { dropOnAnyWrite: true } (CRM lists, dashboards, reports, dropdown metadata)
// is then dropped at once with one Redis INCR, so a new or edited record shows on the next read instead of after the
// TTL. Routes that bump their own namespace on write keep working exactly as before.
const { bumpCacheVersion } = require("../redis");
const { ANY_WRITE_NAMESPACE } = require("./cache");

const HOUSEKEEPING = /^\/api\/(user-activity|home\/usage|users\/(login|logout|refresh))/;

function writeInvalidator(req, res, next) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  res.on("finish", () => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      Promise.resolve(bumpCacheVersion(ANY_WRITE_NAMESPACE)).catch(() => {});
      // Open pages mark what they hold as out of date and read it again the next time it is shown
      // (not for housekeeping writes: activity log lines, page-visit counts, sign-in / out).
      if (HOUSEKEEPING.test(req.originalUrl || req.url)) return;
      try {
        require("../services/realtime").emitDataChanged("any");
      } catch {
        /* sockets unavailable */
      }
    }
  });
  next();
}

module.exports = { writeInvalidator };
