process.env.NODE_ENV = "test";

const { MODULES, scoreModule, rankModules, rankAllowed } = require("../services/moduleUsage");

const NOW = new Date("2026-10-06T00:00:00Z");
const daysAgo = (d) => new Date(NOW.getTime() - d * 86400000).toISOString();

describe("moduleUsage", () => {
  test("a module with no visits scores zero", () => {
    expect(scoreModule(0, daysAgo(0), NOW)).toBe(0);
  });

  test("more visits and more recent visits both raise the score", () => {
    expect(scoreModule(20, daysAgo(1), NOW)).toBeGreaterThan(scoreModule(2, daysAgo(1), NOW));
    expect(scoreModule(5, daysAgo(1), NOW)).toBeGreaterThan(scoreModule(5, daysAgo(60), NOW));
  });

  test("a recent light module can outrank an old heavy one", () => {
    const rows = [
      { module: "finance", visitCount: 40, lastVisitedAt: daysAgo(90) },
      { module: "material", visitCount: 6, lastVisitedAt: daysAgo(0) },
    ];
    expect(rankModules(rows, NOW)[0].module).toBe("material");
  });

  test("ranking lists every module, unused ones after the used, in default order", () => {
    const ranking = rankModules([{ module: "crm", visitCount: 3, lastVisitedAt: daysAgo(1) }], NOW);
    expect(ranking).toHaveLength(MODULES.length);
    expect(ranking.map((m) => m.module).slice(0, 3)).toEqual(["crm", "finance", "material"]);
  });

  test("rankAllowed hides modules the user cannot open", () => {
    const rows = [{ module: "finance", visitCount: 50, lastVisitedAt: daysAgo(0) }];
    const out = rankAllowed(rows, ["material", "crm"], NOW);
    expect(out.modules.map((m) => m.module)).toEqual(["material", "crm"]);
    expect(out.personalized).toBe(false);
  });

  test("rankAllowed is personalised once the user has history in an allowed module", () => {
    const rows = [{ module: "crm", visitCount: 4, lastVisitedAt: daysAgo(2) }];
    const out = rankAllowed(rows, ["material", "crm"], NOW);
    expect(out.personalized).toBe(true);
    expect(out.modules[0].module).toBe("crm");
  });

  test("a new user gets the allowed modules in default order", () => {
    const out = rankAllowed([], ["crm", "material"], NOW);
    expect(out.personalized).toBe(false);
    expect(out.modules.map((m) => m.module)).toEqual(["material", "crm"]);
  });
});
