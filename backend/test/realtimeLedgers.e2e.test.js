process.env.NODE_ENV = "test";

/**
 * A real socket.io server and a real client: a ledger change in the cache layer must reach a connected browser, and a
 * non-ledger change must not.
 */
const http = require("http");
const { Server } = require("socket.io");
const { io: connect } = require("socket.io-client");

let httpServer;
let mockServer;
let port;
jest.mock("../socket", () => ({ getIo: () => mockServer }));
jest.mock("../redis", () => ({ bumpCacheVersion: async () => {} }));

const realtime = require("../services/realtime");

beforeAll(async () => {
  httpServer = http.createServer();
  mockServer = new Server(httpServer);
  await new Promise((resolve) => httpServer.listen(0, resolve));
  port = httpServer.address().port;
});
afterAll(async () => {
  await new Promise((resolve) => mockServer.close(resolve));
});

const clientConnected = () =>
  new Promise((resolve) => {
    const client = connect(`http://localhost:${port}`, { transports: ["websocket"], reconnection: false });
    client.on("connect", () => resolve(client));
  });
const once = (client, event, ms = 2000) =>
  new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    client.once(event, (payload) => {
      clearTimeout(t);
      resolve(payload);
    });
  });

test("every connected client hears that ledgers changed, once, within a moment", async () => {
  const a = await clientConnected();
  const b = await clientConnected();
  const heardA = once(a, "data:changed");
  const heardB = once(b, "data:changed");
  realtime.afterCacheBump("general-ledger");
  realtime.afterCacheBump("account-head-master");
  const [pa, pb] = await Promise.all([heardA, heardB]);
  expect(pa).toMatchObject({ topic: "ledgers" });
  expect(pb).toMatchObject({ topic: "ledgers" });
  a.close();
  b.close();
});

test("a change to something that is not a ledger sends nothing", async () => {
  const c = await clientConnected();
  const heard = once(c, "data:changed", 700);
  realtime.afterCacheBump("new-payment");
  expect(await heard).toBeNull();
  c.close();
});
