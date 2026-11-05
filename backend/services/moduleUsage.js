"use strict";

// The modules the Home page has tiles for. Ids match Home's own module access
// keys, in default display order.
const MODULES = [
  "finance",
  "material",
  "engineering",
  "followup",
  "ticket",
  "sales",
  "salesAutomation",
  "civilworkdpr",
  "crm",
  "fixedasset",
];

const RECENCY_HALF_LIFE_DAYS = 7;

// Frequency grows with log(visits) so one heavy day can't bury everything
// else; recency halves every week so last week's module outranks last year's.
function scoreModule(visitCount, lastVisitedAt, now = new Date()) {
  const visits = Math.max(0, Number(visitCount) || 0);
  if (!visits) return 0;
  const last = lastVisitedAt ? new Date(lastVisitedAt).getTime() : now.getTime();
  const days = Math.max(0, (now.getTime() - last) / 86400000);
  return Math.log2(1 + visits) + 3 * Math.pow(0.5, days / RECENCY_HALF_LIFE_DAYS);
}

// rows: [{ module, visitCount, lastVisitedAt }] → every known module, best first.
function rankModules(rows, now = new Date()) {
  const byModule = new Map((rows || []).map((r) => [r.module, r]));
  return MODULES.map((module, i) => {
    const r = byModule.get(module);
    return {
      module,
      visits: r ? Number(r.visitCount) || 0 : 0,
      lastVisitedAt: r?.lastVisitedAt ?? null,
      score: r ? scoreModule(r.visitCount, r.lastVisitedAt, now) : 0,
      order: i,
    };
  }).sort((a, b) => b.score - a.score || a.order - b.order);
}

// The ranking limited to modules the user can open (null = all). `personalized`
// is false for someone with no history yet, whose order is just the default.
function rankAllowed(rows, allowedModules, now = new Date()) {
  const allowed = allowedModules ? new Set(allowedModules) : null;
  const modules = rankModules(rows, now).filter((m) => !allowed || allowed.has(m.module));
  return { personalized: modules.some((m) => m.score > 0), modules };
}

module.exports = { MODULES, scoreModule, rankModules, rankAllowed };
