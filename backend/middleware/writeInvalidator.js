// After any successful write (POST / PUT / PATCH / DELETE answered 2xx) anywhere in the API, bump the "any-write"
// cache version. Every cache made with { dropOnAnyWrite: true } (CRM lists, dashboards, reports, dropdown metadata)
// is then dropped at once with one Redis INCR, so a new or edited record shows on the next read instead of after the
// TTL. Routes that bump their own namespace on write keep working exactly as before.
const { bumpCacheVersion } = require("../redis");
const { ANY_WRITE_NAMESPACE } = require("./cache");
const { isLookup, isHousekeeping } = require("./activityAudit");

function writeInvalidator(req, res, next) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  // Writes that change no business data — housekeeping (activity log lines, page-visit counts, sign-in / out)
  // and look-ups sent as POST (price quotes, previews) — neither drop every cache nor tell open pages to
  // re-read. They used to drop every user's cached lists on each page visit, and twice a second while an
  // application form re-asked its price quote. The two lists live in middleware/activityAudit.js.
  if (isHousekeeping(req) || isLookup(req)) return next();
  res.on("finish", () => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      Promise.resolve(bumpCacheVersion(ANY_WRITE_NAMESPACE)).catch(() => {});
      // Open pages mark what they hold as out of date and read it again the next time it is shown.
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
