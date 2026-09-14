process.env.NODE_ENV = "test";

/**
 * "Post Approval" is a real per-page action now (migration 167):
 * approvalService.guardEdit() blocks editing an Approved record unless the
 * caller passes { allowPostApproval: true }, and
 * middleware/permissions.resolveAllowPostApproval(req, pageKey) is what
 * decides that — SUPERUSER_ROLES always pass, everyone else needs
 * "post-approval" granted (role baseline merged with their own overrides,
 * same getEffectivePagePermissions used everywhere else).
 */

jest.mock("../db", () => {
  const sql = require("mssql");
  let recordStatus = "Approved";
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
        if (/SELECT .*status.* FROM/i.test(text)) {
          return { recordset: [{ status: recordStatus }] };
        }
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
    __setRecordStatus: (s) => { recordStatus = s; },
    __setRoleRightsRows: (rows) => { roleRightsRows = rows; },
    __setUserRightsJson: (json) => { userRightsJson = json; },
  };
});

const { guardEdit } = require("../services/approvalService");
const { resolveAllowPostApproval, userPermissionCache } = require("../middleware/permissions");
const dbMock = require("../db");

beforeEach(() => {
  dbMock.__setRecordStatus("Approved");
  dbMock.__setRoleRightsRows([]);
  dbMock.__setUserRightsJson("[]");
  userPermissionCache.invalidateAll();
});

describe("guardEdit: allowPostApproval bypass", () => {
  test("blocks editing an Approved record by default (unchanged behavior)", async () => {
    await expect(guardEdit("journal-voucher", 1)).rejects.toThrow(/approved record/i);
  });

  test("still blocks editing a Pending record even with allowPostApproval:true", async () => {
    dbMock.__setRecordStatus("Pending");
    await expect(guardEdit("journal-voucher", 1, { allowPostApproval: true })).rejects.toThrow(/reject it first/i);
  });

  test("allows editing an Approved record when allowPostApproval:true", async () => {
    await expect(guardEdit("journal-voucher", 1, { allowPostApproval: true })).resolves.toBeUndefined();
  });
});

describe("resolveAllowPostApproval", () => {
  test("SUPERUSER_ROLES always bypass, regardless of granted rights", async () => {
    const req = { user: { role: "super_admin", userId: 1, roleId: 1 } };
    expect(await resolveAllowPostApproval(req, "grn-master")).toBe(true);
  });

  test("ordinary role without the right is denied", async () => {
    const req = { user: { role: "accountant", userId: 9, roleId: 5 } };
    expect(await resolveAllowPostApproval(req, "grn-master")).toBe(false);
  });

  test("role-level CanPostApproval grant is honored", async () => {
    dbMock.__setRoleRightsRows([
      { Module: "Material", SubModule: "GRN", CanView: 1, CanAdd: 0, CanEdit: 0, CanDelete: 0, CanPrint: 0, CanExport: 0, CanPostApproval: 1 },
    ]);
    const req = { user: { role: "accountant", userId: 9, roleId: 5 } };
    expect(await resolveAllowPostApproval(req, "grn-master")).toBe(true);
  });

  test("per-user override grant is honored even without a role grant", async () => {
    dbMock.__setUserRightsJson(JSON.stringify([{ page: "grn-master", actions: ["view", "post-approval"] }]));
    const req = { user: { role: "accountant", userId: 9, roleId: 5 } };
    expect(await resolveAllowPostApproval(req, "grn-master")).toBe(true);
  });
});
