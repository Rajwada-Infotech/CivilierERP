process.env.NODE_ENV = "test";

jest.mock("../db", () => ({ getPool: jest.fn(), sql: require("mssql") }));

jest.mock("../middleware/permissions", () => ({
  SUPERUSER_ROLES: new Set(["super_admin", "sa", "dba", "admin"]),
  getEffectivePagePermissions: jest.fn(),
}));

const { getEffectivePagePermissions } = require("../middleware/permissions");
const {
  DOC_FINDER_REGISTRY,
  findDocuments,
  normalizeQuery,
  escapeLike,
} = require("../services/docFinder");

// A pool whose request().query() records the SQL and answers from `handler`.
function fakePool(handler) {
  const queries = [];
  const pool = {
    request: () => {
      const inputs = {};
      const req = {
        input: (k, _t, v) => { inputs[k] = v; return req; },
        query: async (text) => {
          queries.push({ text, inputs });
          return { recordset: handler(text, inputs) };
        },
      };
      return req;
    },
  };
  return { pool, queries };
}

const admin = { role: "super_admin", userId: 1, roleId: 1 };

describe("normalizeQuery / escapeLike", () => {
  it("trims, collapses whitespace and caps length", () => {
    expect(normalizeQuery("  SU-2026-00011  ")).toBe("SU-2026-00011");
    expect(normalizeQuery("a   b")).toBe("a b");
    expect(normalizeQuery("x".repeat(200))).toHaveLength(60);
    expect(normalizeQuery(null)).toBe("");
  });
  it("escapes LIKE wildcards so they match literally", () => {
    expect(escapeLike("GC-WO/0001_26%[x]")).toBe("GC-WO/0001\\_26\\%\\[x]");
  });
});

describe("DOC_FINDER_REGISTRY", () => {
  it("has every field a preview + deep link needs", () => {
    for (const [name, e] of Object.entries(DOC_FINDER_REGISTRY)) {
      expect(e.table).toMatch(/^dbo\.\w+$/);
      expect(e.docNoCols.length).toBeGreaterThan(0);
      expect(e.route).toMatch(/^\//);
      expect(e.pageKey).toBeTruthy();
      expect(e.projectExpr).toBeTruthy();
      expect(name).toBeTruthy();
    }
  });
});

describe("findDocuments", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns tooShort without touching the DB for a 1-2 char query", async () => {
    const { pool, queries } = fakePool(() => []);
    const out = await findDocuments(pool, { q: "su", user: admin, scope: null });
    expect(out).toEqual({ query: "su", tooShort: true, results: [] });
    expect(queries).toHaveLength(0);
  });

  it("resolves a number via DocNumberSequence and builds a ?view= deep link", async () => {
    const { pool } = fakePool((text) => {
      if (text.includes("DocNumberSequence")) {
        return [{ DocNo: "JV-2026-00100", TableName: "JournalVoucher", RecordId: 77, Rnk: 0 }];
      }
      if (text.includes("FROM dbo.JournalVoucher t") && text.includes("IN (77)")) {
        return [{ Id: 77, DocNo: "JV-2026-00100", DocDate: "2026-04-02", Amount: 5000, Status: "Approved", Subtitle: "Rent" }];
      }
      return [];
    });
    const out = await findDocuments(pool, { q: "JV-2026-00100", user: admin, scope: null });
    expect(out.results).toHaveLength(1);
    expect(out.results[0]).toMatchObject({
      table: "JournalVoucher",
      type: "Journal Voucher",
      id: 77,
      docNo: "JV-2026-00100",
      url: "/journal-voucher?view=77",
      pageKey: "journal-voucher",
      exact: true,
    });
  });

  it("de-duplicates a record found by both tiers", async () => {
    const row = { Id: 5, DocNo: "SU-2026-00011", DocDate: "2026-04-01", Amount: null, Status: null, Subtitle: null };
    const { pool } = fakePool((text) => {
      if (text.includes("DocNumberSequence")) return [{ DocNo: "SU-2026-00011", TableName: "StockUpdate", RecordId: 5, Rnk: 0 }];
      if (text.includes("FROM dbo.StockUpdate t")) return [row];
      return [];
    });
    const out = await findDocuments(pool, { q: "SU-2026-00011", user: admin, scope: null });
    expect(out.results.filter((r) => r.table === "StockUpdate")).toHaveLength(1);
  });

  it("never queries a table the user lacks the view right for", async () => {
    getEffectivePagePermissions.mockResolvedValue([
      { page: "stock-update", actions: ["view"] },
      { page: "new-payment", actions: ["create"] }, // no view
    ]);
    const { pool, queries } = fakePool(() => []);
    const user = { role: "engineer", userId: 9, roleId: 3 };
    const out = await findDocuments(pool, { q: "PAY-2026-00279", user, scope: null });
    expect(out.results).toEqual([]);
    const sqlText = queries.map((q) => q.text).join("\n");
    expect(sqlText).toContain("dbo.StockUpdate");
    expect(sqlText).not.toContain("dbo.NewPayment");
    expect(sqlText).not.toContain("dbo.ReceivedPayment");
    const seqQuery = queries.find((q) => q.text.includes("DocNumberSequence"));
    expect(Object.values(seqQuery.inputs)).toContain("StockUpdate");
    expect(Object.values(seqQuery.inputs)).not.toContain("NewPayment");
  });

  it("issues no queries at all when the user can view none of the registered pages", async () => {
    getEffectivePagePermissions.mockResolvedValue([]);
    const { pool, queries } = fakePool(() => []);
    const out = await findDocuments(pool, { q: "SU-2026-00011", user: { role: "viewer", userId: 2, roleId: 2 }, scope: null });
    expect(out.results).toEqual([]);
    expect(queries).toHaveLength(0);
  });

  it("applies Project Access scoping to every query", async () => {
    const { pool, queries } = fakePool(() => []);
    await findDocuments(pool, { q: "SU-2026-00011", user: admin, scope: [4, 9] });
    const previewQueries = queries.filter((q) => q.text.includes("FROM dbo.") && !q.text.includes("DocNumberSequence"));
    expect(previewQueries.length).toBe(Object.keys(DOC_FINDER_REGISTRY).length);
    for (const q of previewQueries) expect(q.text).toMatch(/IN \(4,9\)/);
  });

  it("ranks an exact doc number above a partial match", async () => {
    const { pool } = fakePool((text) => {
      if (text.includes("DocNumberSequence")) return [];
      if (text.includes("FROM dbo.NewPayment t")) {
        return [
          { Id: 2, DocNo: "PAY-2026-002790", DocDate: "2026-05-01", Amount: 1, Status: "Approved", Subtitle: null },
          { Id: 1, DocNo: "PAY-2026-00279", DocDate: "2026-04-01", Amount: 1, Status: "Approved", Subtitle: null },
        ];
      }
      return [];
    });
    const out = await findDocuments(pool, { q: "PAY-2026-00279", user: admin, scope: null });
    expect(out.results.map((r) => r.id)).toEqual([1, 2]);
    expect(out.results[0].exact).toBe(true);
    expect(out.results[1].exact).toBe(false);
  });
});
