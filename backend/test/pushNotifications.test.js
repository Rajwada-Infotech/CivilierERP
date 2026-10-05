process.env.NODE_ENV = "test";

jest.mock("../db", () => ({ getPool: jest.fn(), sql: require("mssql") }));
jest.mock("../logger", () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const { getPool } = require("../db");
const push = require("../services/pushNotifications");
const { notifyTransition } = require("../services/approvalNotifications");

// A pool that records every query and answers from `answer(text, inputs)`.
function fakePool(answer) {
  const queries = [];
  const pool = {
    request: () => {
      const inputs = {};
      const req = {
        input: (k, _t, v) => ((inputs[k] = v), req),
        query: async (text) => {
          queries.push({ text, inputs });
          const recordset = answer(text, inputs) ?? [];
          return { recordset, rowsAffected: [recordset.length] };
        },
      };
      return req;
    },
  };
  getPool.mockReturnValue(pool);
  return { queries };
}

const TOKEN = (n) => `ExponentPushToken[abc${n}]`;
const okTickets = (n) => ({ ok: true, json: async () => ({ data: Array.from({ length: n }, () => ({ status: "ok" })) }) });

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn();
});

describe("isExpoPushToken / registerToken", () => {
  it("accepts Expo tokens and rejects anything else", () => {
    expect(push.isExpoPushToken("ExponentPushToken[xyz]")).toBe(true);
    expect(push.isExpoPushToken("ExpoPushToken[xyz]")).toBe(true);
    expect(push.isExpoPushToken("fcm-raw-token")).toBe(false);
    expect(push.isExpoPushToken("")).toBe(false);
    expect(push.isExpoPushToken(null)).toBe(false);
  });

  it("refuses a bad token or user with a 400 and never touches the DB", async () => {
    const { queries } = fakePool(() => []);
    await expect(push.registerToken(7, "nope")).rejects.toMatchObject({ status: 400 });
    await expect(push.registerToken(NaN, TOKEN(1))).rejects.toMatchObject({ status: 400 });
    expect(queries).toHaveLength(0);
  });

  it("upserts by token, binding it to the given user (a handed-over phone follows the new login)", async () => {
    const { queries } = fakePool(() => []);
    await push.registerToken(7, TOKEN(1), { appKey: "finance-material", platform: "android" });
    expect(queries[0].text).toMatch(/MERGE dbo\.PushDeviceToken/);
    expect(queries[0].text).toMatch(/UPDATE SET UserId = @uid/);
    expect(queries[0].inputs).toMatchObject({ uid: 7, token: TOKEN(1), app: "finance-material", plat: "android" });
  });

  it("unregister is scoped to the caller", async () => {
    const { queries } = fakePool(() => []);
    await push.unregisterToken(7, TOKEN(1));
    expect(queries[0].text).toMatch(/Token = @token AND UserId = @uid/);
  });
});

describe("sendToUsers", () => {
  it("sends nothing and makes no network call when nobody has a registered device", async () => {
    fakePool(() => []);
    expect(await push.sendToUsers([1, 2], { title: "Hi" })).toEqual({ sent: 0, failed: 0 });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("looks tokens up only for valid integer ids (no SQL injection through the id list)", async () => {
    const { queries } = fakePool(() => []);
    await push.sendToUsers([3, "4", "5; DROP TABLE x", NaN, 3], { title: "Hi" });
    expect(queries[0].text).toMatch(/UserId IN \(3,4\)/);
    expect(queries[0].text).not.toMatch(/DROP/);
  });

  it("can limit delivery to certain apps (devices with no app recorded stay eligible)", async () => {
    const { queries } = fakePool(() => []);
    await push.sendToUsers([3], { title: "Hi" }, { apps: ["admin", "finance-material"] });
    expect(queries[0].text).toMatch(/AppKey IS NULL OR AppKey IN \(@a0,@a1\)/);
    expect(queries[0].inputs).toMatchObject({ a0: "admin", a1: "finance-material" });
  });

  it("applies no app filter when none is given", async () => {
    const { queries } = fakePool(() => []);
    await push.sendToUsers([3], { title: "Hi" });
    expect(queries[0].text).not.toMatch(/AppKey/);
  });

  it("posts one Expo request with title, body and data per device", async () => {
    fakePool((t) => (/SELECT Token/.test(t) ? [{ Token: TOKEN(1) }, { Token: TOKEN(2) }] : []));
    global.fetch.mockResolvedValue(okTickets(2));
    const out = await push.sendToUsers([1], { title: "Approval needed", body: "PO is waiting", data: { module: "purchase-orders" } });
    expect(out).toEqual({ sent: 2, failed: 0 });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe("https://exp.host/--/api/v2/push/send");
    const msgs = JSON.parse(init.body);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toMatchObject({ to: TOKEN(1), title: "Approval needed", body: "PO is waiting", data: { module: "purchase-orders" }, sound: "default" });
  });

  it("splits more than 100 devices into batches of 100", async () => {
    const tokens = Array.from({ length: 230 }, (_, i) => ({ Token: TOKEN(i) }));
    fakePool((t) => (/SELECT Token/.test(t) ? tokens : []));
    global.fetch.mockImplementation(async (_u, init) => okTickets(JSON.parse(init.body).length));
    const out = await push.sendToUsers([1], { title: "x" });
    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(out.sent).toBe(230);
  });

  it("deletes tokens Expo reports as DeviceNotRegistered", async () => {
    const { queries } = fakePool((t) => (/SELECT Token/.test(t) ? [{ Token: TOKEN(1) }, { Token: TOKEN(2) }] : []));
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ status: "ok" }, { status: "error", details: { error: "DeviceNotRegistered" } }] }),
    });
    const out = await push.sendToUsers([1], { title: "x" });
    expect(out).toEqual({ sent: 1, failed: 1 });
    const del = queries.find((q) => /DELETE FROM dbo\.PushDeviceToken WHERE Token IN/.test(q.text));
    expect(del).toBeTruthy();
    expect(Object.values(del.inputs)).toEqual([TOKEN(2)]);
  });

  it("never throws when Expo is down", async () => {
    fakePool((t) => (/SELECT Token/.test(t) ? [{ Token: TOKEN(1) }] : []));
    global.fetch.mockRejectedValue(new Error("network down"));
    await expect(push.sendToUsers([1], { title: "x" })).resolves.toEqual({ sent: 0, failed: 1 });
    global.fetch.mockResolvedValue({ ok: false, status: 500 });
    await expect(push.sendToUsers([1], { title: "x" })).resolves.toEqual({ sent: 0, failed: 1 });
  });

  it("never throws when the database fails", async () => {
    getPool.mockImplementation(() => {
      throw new Error("db down");
    });
    await expect(push.sendToUsers([1], { title: "x" })).resolves.toEqual({ sent: 0, failed: 0 });
  });
});

describe("notifyTransition (approval recipients)", () => {
  const levelDefs = [
    { label: "L1", userIds: [10, 11] },
    { label: "L2", userIds: [20] },
  ];
  const base = { module: "purchase-orders", tableName: "PurchaseOrders", id: 55, actorUserId: 99, levelDefs, defaultRoles: ["admin", "super_admin"] };

  // Routes the queries notifyTransition makes to fixed answers.
  function world({ submitterEmail = "raise@x.com", submitterId = 5, roleUsers = [] } = {}) {
    const sent = [];
    const { queries } = fakePool((t) => {
      if (/SELECT Token/.test(t)) {
        const ids = t.match(/IN \(([\d,]+)\)/)[1].split(",").map(Number);
        sent.push(ids);
        return ids.map((i) => ({ Token: TOKEN(i) }));
      }
      if (/FROM dbo\.DocNumberSequence/.test(t)) return [{ DocNo: "PO-2026-00042" }];
      if (/FROM dbo\.ApprovalAuditLog/.test(t)) return submitterEmail ? [{ ApproverEmail: submitterEmail }] : [];
      if (/FROM dbo\.users WHERE LOWER\(email\)/.test(t)) return submitterId ? [{ id: submitterId }] : [];
      if (/JOIN dbo\.Role/.test(t)) return roleUsers.map((id) => ({ id }));
      return [];
    });
    global.fetch.mockImplementation(async (_u, init) => okTickets(JSON.parse(init.body).length));
    return { queries, sent };
  }
  const bodyOf = () => JSON.parse(global.fetch.mock.calls[0][1].body);

  it("submit: pings the people named on level 1, not the submitter", async () => {
    const w = world();
    await notifyTransition({ ...base, targetStatus: "Pending", result: { newStatus: "Pending" }, actorUserId: 10 });
    expect(w.sent[0].sort()).toEqual([11]); // 10 is the actor
    expect(bodyOf()[0]).toMatchObject({ title: "Approval needed", data: { type: "approval-waiting", module: "purchase-orders", recordId: 55 } });
    expect(bodyOf()[0].body).toBe("Purchase Order PO-2026-00042 is waiting for your approval.");
  });

  it("approval pushes go to the Admin app only — never to Finance & Material", async () => {
    const w = world();
    await notifyTransition({ ...base, targetStatus: "Pending", result: { newStatus: "Pending" } });
    const tokenQuery = w.queries.find((q) => /SELECT Token/.test(q.text));
    expect(tokenQuery.text).toMatch(/AppKey IN \(@a0\)/);
    const apps = Object.entries(tokenQuery.inputs).filter(([k]) => /^a\d+$/.test(k)).map(([, v]) => v);
    expect(apps).toEqual(["admin"]);
  });

  it("a cleared level opens the next one: pings level 2's approver", async () => {
    const w = world();
    await notifyTransition({ ...base, targetStatus: "Approved", result: { newStatus: "Pending", level: 1, totalLevels: 2, remainingLevels: 1 } });
    expect(w.sent[0]).toEqual([20]);
  });

  it("an 'everyone must approve' level still waiting on others pings nobody new", async () => {
    world();
    await notifyTransition({ ...base, targetStatus: "Approved", result: { newStatus: "Pending", level: 1, waitingOnLevel: true } });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("a level that names nobody falls back to the module's default approver roles", async () => {
    const w = world({ roleUsers: [1, 2] });
    await notifyTransition({ ...base, levelDefs: [{ label: "L1" }], targetStatus: "Pending", result: { newStatus: "Pending" } });
    expect(w.sent[0].sort()).toEqual([1, 2]);
  });

  it("a level that names roles pings the users holding them", async () => {
    const w = world({ roleUsers: [7] });
    await notifyTransition({ ...base, levelDefs: [{ roles: ["Finance Manager"] }], targetStatus: "Pending", result: { newStatus: "Pending" } });
    expect(w.sent[0]).toEqual([7]);
  });

  it("final approval tells the submitter", async () => {
    const w = world();
    await notifyTransition({ ...base, targetStatus: "Approved", result: { newStatus: "Approved", level: 2, totalLevels: 2 } });
    expect(w.sent[0]).toEqual([5]);
    expect(bodyOf()[0]).toMatchObject({ title: "Approved", body: "Your Purchase Order PO-2026-00042 was approved.", data: { type: "approval-outcome", status: "Approved" } });
  });

  it("rejection tells the submitter", async () => {
    const w = world();
    await notifyTransition({ ...base, targetStatus: "Rejected", result: { newStatus: "Rejected", level: 1 } });
    expect(w.sent[0]).toEqual([5]);
    expect(bodyOf()[0]).toMatchObject({ title: "Rejected", data: { status: "Rejected" } });
  });

  it("does not notify someone about their own action", async () => {
    world({ submitterId: 99 });
    await notifyTransition({ ...base, targetStatus: "Approved", result: { newStatus: "Approved", level: 2 }, actorUserId: 99 });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("does nothing when the submitter can't be found, and never throws", async () => {
    world({ submitterEmail: null });
    await expect(notifyTransition({ ...base, targetStatus: "Rejected", result: { newStatus: "Rejected" } })).resolves.toBeUndefined();
    expect(global.fetch).not.toHaveBeenCalled();
    getPool.mockImplementation(() => {
      throw new Error("db down");
    });
    await expect(notifyTransition({ ...base, targetStatus: "Pending", result: { newStatus: "Pending" } })).resolves.toBeUndefined();
  });
});
