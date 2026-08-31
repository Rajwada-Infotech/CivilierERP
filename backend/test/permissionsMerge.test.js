process.env.NODE_ENV = "test";

/**
 * Regression test for getEffectivePagePermissions' merge semantics.
 *
 * A per-user override (dbo.UserPageRightsJson) must fully REPLACE the
 * role's grant for any page it touches — not be unioned with it. Before
 * this fix, an admin unchecking "edit" for one user in MenuRights.tsx's
 * Custom User-wise mode had no effect if that user's role already granted
 * edit on the same page, because the merge always took role-actions ∪
 * user-actions per page.
 */

jest.mock("../db", () => {
  const sql = require("mssql");
  let roleRightsRows = [];
  let userRightsJson = "[]";

  const makeRequest = () => {
    const req = {
      params: {},
      input(name, _type, value) {
        this.params[name] = value;
        return this;
      },
      query: async (text) => {
        if (/FROM dbo\.RoleRights/i.test(text)) {
          return { recordset: roleRightsRows };
        }
        if (/FROM dbo\.UserPageRightsJson/i.test(text)) {
          return { recordset: [{ RightsJson: userRightsJson }] };
        }
        return { recordset: [] };
      },
    };
    return req;
  };

  const fakePool = { request: makeRequest };
  return {
    sql,
    getPool: () => fakePool,
    __setRoleRightsRows: (rows) => { roleRightsRows = rows; },
    __setUserRightsJson: (json) => { userRightsJson = json; },
  };
});

const { getEffectivePagePermissions, userPermissionCache } = require("../middleware/permissions");
const dbMock = require("../db");

beforeEach(() => {
  dbMock.__setRoleRightsRows([]);
  dbMock.__setUserRightsJson("[]");
  userPermissionCache.invalidateAll();
});

const actionsFor = (effective, page) =>
  (effective.find((r) => r.page === page)?.actions ?? []).sort();

describe("getEffectivePagePermissions merge semantics", () => {
  test("a per-user override RESTRICTS below the role's grant on the same page", async () => {
    // Role grants full CRUD on Purchase Orders...
    dbMock.__setRoleRightsRows([
      { Module: "Material", SubModule: "PurchaseOrders", CanView: 1, CanAdd: 1, CanEdit: 1, CanDelete: 1, CanPrint: 0, CanExport: 0, CanPostApproval: 0 },
    ]);
    // ...but this specific user was explicitly set to view-only.
    dbMock.__setUserRightsJson(JSON.stringify([{ page: "purchase-orders", actions: ["view"] }]));

    const effective = await getEffectivePagePermissions(9, 5);
    expect(actionsFor(effective, "purchase-orders")).toEqual(["view"]);
  });

  test("an explicit empty-actions override means no access, not 'unset'", async () => {
    dbMock.__setRoleRightsRows([
      { Module: "Material", SubModule: "PurchaseOrders", CanView: 1, CanAdd: 0, CanEdit: 1, CanDelete: 0, CanPrint: 0, CanExport: 0, CanPostApproval: 0 },
    ]);
    dbMock.__setUserRightsJson(JSON.stringify([{ page: "purchase-orders", actions: [] }]));

    const effective = await getEffectivePagePermissions(9, 5);
    expect(actionsFor(effective, "purchase-orders")).toEqual([]);
  });

  test("a page the user never customized still inherits the full role baseline", async () => {
    dbMock.__setRoleRightsRows([
      { Module: "Material", SubModule: "PurchaseOrders", CanView: 1, CanAdd: 1, CanEdit: 1, CanDelete: 0, CanPrint: 0, CanExport: 0, CanPostApproval: 0 },
    ]);
    dbMock.__setUserRightsJson(JSON.stringify([{ page: "some-other-page", actions: ["view"] }]));

    const effective = await getEffectivePagePermissions(9, 5);
    expect(actionsFor(effective, "purchase-orders")).toEqual(["create", "edit", "view"]);
  });

  test("a per-user override can still grant a page the role doesn't mention at all", async () => {
    dbMock.__setRoleRightsRows([]);
    dbMock.__setUserRightsJson(JSON.stringify([{ page: "reports", actions: ["view", "export"] }]));

    const effective = await getEffectivePagePermissions(9, 5);
    expect(actionsFor(effective, "reports")).toEqual(["export", "view"]);
  });
});
