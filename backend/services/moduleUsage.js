"use strict";

// Modules that have widgets in the metrics catalog, in default display order.
const MODULES = ["Finance", "Material", "Engineering", "CRM"];

// How many widgets each ranked module contributes: the module worked in most
// gets the most room.
const QUOTAS = [3, 2, 1, 1];
const TYPE_ORDER = { stat: 0, timeseries: 1, breakdown: 2 };
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

// Picks the widgets to show. `allowedModules` limits it to modules the user
// can open. With any usage history only used modules contribute; with none
// (a new user) the allowed modules are offered in default order instead.
function pickWidgets(catalog, ranking, allowedModules) {
  const allowed = allowedModules ? new Set(allowedModules) : null;
  const eligible = ranking.filter((m) => !allowed || allowed.has(m.module));
  const personalized = eligible.some((m) => m.score > 0);
  const chosen = personalized ? eligible.filter((m) => m.score > 0) : eligible;

  const widgets = [];
  chosen.forEach((m, i) => {
    const quota = QUOTAS[i] ?? 1;
    const inModule = catalog
      .filter((w) => w.module === m.module)
      .sort((a, b) => (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9));
    widgets.push(...inModule.slice(0, quota));
  });
  return { personalized, modules: chosen, widgets };
}

module.exports = { MODULES, QUOTAS, scoreModule, rankModules, pickWidgets };
