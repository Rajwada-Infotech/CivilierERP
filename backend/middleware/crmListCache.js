// Redis cache for CRM paged lists (any GET /api/crm/... carrying ?page=).
//
// Many people open the same CRM list pages; a repeat of the same page / size / filters is served from Redis instead
// of SQL Server. Entries are keyed per user + project scope by cache(), so nobody can be served a list their rights
// or projects don't allow.
//
// Freshness: CRM rows are changed from many places (CRM, Finance receipts, approvals, imports…), so instead of
// tracking every writer, ANY successful write (POST / PUT / PATCH / DELETE answered 2xx) anywhere in the API bumps
// the "crm-lists" version, which drops every cached CRM list at once. The short TTL is a backstop for changes made
// outside the API (scripts, SQL jobs).
const { cache } = require("./cache");
const { bumpCacheVersion } = require("../redis");

const NAMESPACE = "crm-lists";
const TTL_SECONDS = 60;

const listCache = cache(NAMESPACE, TTL_SECONDS, { fixedTtl: true });

function crmListCache(req, res, next) {
  if (req.method !== "GET" || req.query.page == null) return next();
  return listCache(req, res, next);
}

function crmListCacheInvalidator(req, res, next) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  res.on("finish", () => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      Promise.resolve(bumpCacheVersion(NAMESPACE)).catch(() => {});
    }
  });
  next();
}

module.exports = { crmListCache, crmListCacheInvalidator, CRM_LIST_CACHE_NAMESPACE: NAMESPACE };
