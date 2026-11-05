jest.mock("../db", () => ({ sql: { Int: "Int" } }));
const { isApprovedStatus, findUnapproved, unapprovedResponse, BRS_SOURCES } = require("../utils/brsClearGuard");

// A fake transaction: answers each status read from `rows[SourceType:SourceID]`
// and records the SQL it was given.
function fakeTx(rows) {
  const queries = [];
  return {
    queries,
    request() {
      let id;
      return {
        input(_n, _t, v) { id = v; return this; },
        async query(text) {
          queries.push(text);
          const key = Object.keys(rows).find((k) => text.includes(BRS_SOURCES[k.split(":")[0]].table) && Number(k.split(":")[1]) === id);
          return { recordset: key ? [rows[key]] : [] };
        },
      };
    },
  };
}

describe("BRS: only approved documents can be cleared", () => {
  test("only 'Approved' (any case, trimmed) passes", () => {
    expect(isApprovedStatus("Approved")).toBe(true);
    expect(isApprovedStatus("  approved ")).toBe(true);
    for (const s of ["Pending", "Rejected", "Draft", "", null, undefined, "Approved-ish"]) expect(isApprovedStatus(s)).toBe(false);
  });

  test("a pending document is blocked, an approved one passes, reads are locked", async () => {
    const tx = fakeTx({
      "PAYMENT:1": { Status: "Approved", DocNo: "PAY-1" },
      "RECEIVED:2": { Status: "Pending", DocNo: "RP-2" },
    });
    const blocked = await findUnapproved(tx, [{ SourceType: "PAYMENT", SourceID: 1 }, { SourceType: "RECEIVED", SourceID: 2 }]);
    expect(blocked).toEqual([{ SourceType: "RECEIVED", SourceID: 2, DocNo: "RP-2", Status: "Pending" }]);
    expect(tx.queries.every((q) => q.includes("UPDLOCK, HOLDLOCK"))).toBe(true);
  });

  test("missing document and unknown source type are blocked", async () => {
    const blocked = await findUnapproved(fakeTx({}), [{ SourceType: "PAYMENT", SourceID: 9 }, { SourceType: "NOPE", SourceID: 1 }]);
    expect(blocked.map((b) => b.Status)).toEqual(["not found", "unknown source type"]);
  });

  test("sources with no approval of their own count as approved when they exist", async () => {
    const blocked = await findUnapproved(fakeTx({ "CRM_RECEIVED:5": { Status: "Approved", DocNo: "MR-5" } }), [{ SourceType: "CRM_RECEIVED", SourceID: 5 }]);
    expect(blocked).toEqual([]);
  });

  test("the refusal names each document", () => {
    const body = unapprovedResponse([{ SourceType: "RECEIVED", SourceID: 2, DocNo: "RP-2", Status: "Pending" }]);
    expect(body.error).toMatch(/Only approved documents can be cleared — RP-2 \(Pending\)/);
    expect(body.blocked).toHaveLength(1);
  });
});
