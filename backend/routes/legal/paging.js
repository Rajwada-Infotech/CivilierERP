"use strict";
/**
 * Server paging for the Legal work queues (Approvals, Deed Process, LA & ULC, Deed Registration, Post-registration,
 * Deed search, Land & Projects). Added to a list route; without ?page the route answers exactly as before.
 *   ?page=1&pageSize=20     one page (pageSize up to 100)
 *   ?q=…                    rows with any text value containing it
 *   ?project=all|none|<id>  the Legal project picker (row.ProjectId)
 *   ?kind=…                 a named subset the route offers (e.g. Deed Process: l1, l2, reverify)
 * The body's list (`key`, or the body itself when it is an array) is cut to the page and comes back with
 * { total, page, pageSize }; an array body becomes { items, total, page, pageSize }.
 */
const PAGE_MAX = 100;

const matches = (row, q) => {
  const t = q.toLowerCase();
  const walk = (v, depth) => {
    if (v == null) return false;
    if (typeof v === "object") return depth < 2 && Object.values(v).some((x) => walk(x, depth + 1));
    return String(v).toLowerCase().includes(t);
  };
  return walk(row, 0);
};

function pageable(key = null, { kinds = {} } = {}) {
  return (req, res, next) => {
    if (req.query.page === undefined) return next();
    // (req.legalScope is set by the project-scope middleware on the Legal routers.)
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(PAGE_MAX, Math.max(1, Number.parseInt(req.query.pageSize, 10) || 20));
    const json = res.json.bind(res);
    res.json = (body) => {
      const list = key ? body?.[key] : body;
      if (res.statusCode >= 400 || !Array.isArray(list)) return json(body);
      let rows = list;
      // Project access: a user restricted to some projects sees only their rows.
      if (req.legalScope) rows = rows.filter((r) => r.ProjectId != null && req.legalScope.includes(Number(r.ProjectId)));
      const project = String(req.query.project ?? "all");
      if (project === "none") rows = rows.filter((r) => !Number(r.ProjectId));
      else if (project !== "all" && Number(project) > 0) rows = rows.filter((r) => Number(r.ProjectId) === Number(project));
      const kind = kinds[String(req.query.kind || "")];
      if (kind) rows = rows.filter(kind);
      const q = String(req.query.q || "").trim();
      if (q) rows = rows.filter((r) => matches(r, q));
      const total = rows.length;
      const cut = rows.slice((page - 1) * pageSize, page * pageSize);
      return json(key ? { ...body, [key]: cut, total, page, pageSize } : { items: cut, total, page, pageSize });
    };
    next();
  };
}

module.exports = { pageable };
