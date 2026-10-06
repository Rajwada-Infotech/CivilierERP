process.env.NODE_ENV = "test";

const { scoreModule, rankModules, pickWidgets } = require("../services/moduleUsage");

const NOW = new Date("2026-10-06T00:00:00Z");
const daysAgo = (d) => new Date(NOW.getTime() - d * 86400000).toISOString();

const CATALOG = [
  { key: "f-stat", module: "Finance", type: "stat" },
  { key: "f-ts", module: "Finance", type: "timeseries" },
  { key: "f-bd", module: "Finance", type: "breakdown" },
  { key: "f-ts2", module: "Finance", type: "timeseries" },
  { key: "m-bd", module: "Material", type: "breakdown" },
  { key: "m-stat", module: "Material", type: "stat" },
  { key: "e-stat", module: "Engineering", type: "stat" },
  { key: "c-stat", module: "CRM", type: "stat" },
];

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
      { module: "Finance", visitCount: 40, lastVisitedAt: daysAgo(90) },
      { module: "Material", visitCount: 6, lastVisitedAt: daysAgo(0) },
    ];
    expect(rankModules(rows, NOW)[0].module).toBe("Material");
  });

  test("ranking lists every module, unused ones last in default order", () => {
    const ranking = rankModules([{ module: "CRM", visitCount: 3, lastVisitedAt: daysAgo(1) }], NOW);
    expect(ranking.map((m) => m.module)).toEqual(["CRM", "Finance", "Material", "Engineering"]);
  });

  test("personalised picks fill quotas by rank, stat first, and skip unused modules", () => {
    const ranking = rankModules(
      [
        { module: "Finance", visitCount: 30, lastVisitedAt: daysAgo(0) },
        { module: "Material", visitCount: 5, lastVisitedAt: daysAgo(2) },
      ],
      NOW,
    );
    const out = pickWidgets(CATALOG, ranking, null);
    expect(out.personalized).toBe(true);
    expect(out.widgets.map((w) => w.key)).toEqual(["f-stat", "f-ts", "f-ts2", "m-stat", "m-bd"]);
  });

  test("modules the user cannot open are never offered", () => {
    const ranking = rankModules([{ module: "Finance", visitCount: 30, lastVisitedAt: daysAgo(0) }], NOW);
    const out = pickWidgets(CATALOG, ranking, ["Material", "CRM"]);
    expect(out.personalized).toBe(false);
    expect(out.widgets.every((w) => w.module !== "Finance")).toBe(true);
  });

  test("a new user with no history gets the allowed modules in default order", () => {
    const out = pickWidgets(CATALOG, rankModules([], NOW), ["Material", "Engineering"]);
    expect(out.personalized).toBe(false);
    expect(out.widgets.map((w) => w.module)).toEqual(["Material", "Material", "Engineering"]);
  });
});
