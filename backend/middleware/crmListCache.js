// Redis cache for CRM paged lists (any GET /api/crm/... carrying ?page=).
//
// Many people open the same CRM list pages; a repeat of the same page / size / filters is served from Redis instead
// of SQL Server. Entries are keyed per user + project scope by cache(), so nobody can be served a list their rights
// or projects don't allow.
//
// Freshness: CRM rows are changed from many places (CRM, Finance receipts, approvals, imports, the portal…), so the
// cache is { dropOnAnyWrite: true } - any successful write anywhere drops it (middleware/writeInvalidator.js). The
// short TTL is a backstop for changes made outside the API (scripts, SQL jobs).
const { cache } = require("./cache");

const listCache = cache("crm-lists", 60, { fixedTtl: true, dropOnAnyWrite: true });

function crmListCache(req, res, next) {
  if (req.method !== "GET" || req.query.page == null) return next();
  return listCache(req, res, next);
}

module.exports = { crmListCache };
