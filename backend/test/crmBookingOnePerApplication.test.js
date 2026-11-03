process.env.NODE_ENV = "test";

/**
 * One booking per application (services/crmEntityCreation.js). The first
 * check in createCrmBookingRecord runs unlocked, so two submits at once both
 * pass it; inside the booking's transaction it is checked again under the
 * application's lock — the second waits for the first, then finds its booking.
 */
jest.mock("../db", () => ({
  sql: new Proxy({}, { get: () => () => "type" }),
  getPool: () => ({}),
}));

const fs = require("fs");
const path = require("path");
const { assertNoBookingForApplicationLocked } = require("../services/crmEntityCreation");

function mockTx(bookingNo) {
  const calls = [];
  return {
    calls,
    request() {
      const r = {
        inputs: {},
        input(n, _t, v) { r.inputs[n] = v; return r; },
        async query(q) { calls.push({ q, inputs: r.inputs }); return { recordset: [{ Id: 100, BookingNo: bookingNo }] }; },
      };
      return r;
    },
  };
}

test("reads the application under an update lock held to the end of the transaction", async () => {
  const tx = mockTx(null);
  await assertNoBookingForApplicationLocked(tx, 100);
  expect(tx.calls).toHaveLength(1);
  expect(tx.calls[0].q).toMatch(/FROM dbo\.CrmApplication a WITH \(UPDLOCK, HOLDLOCK\) WHERE a\.Id = @aid/);
  expect(tx.calls[0].q).toMatch(/x\.IsActive = 1/);
  expect(tx.calls[0].inputs.aid).toBe(100);
});

test("no booking yet: the first submit goes ahead", async () => {
  await expect(assertNoBookingForApplicationLocked(mockTx(null), 100)).resolves.toBeUndefined();
});

test("the second submit finds the first one's booking and is refused (409)", async () => {
  await expect(assertNoBookingForApplicationLocked(mockTx("BKG-2026-00031"), 100)).rejects.toMatchObject({
    status: 409,
    message: expect.stringMatching(/already has a booking \(BKG-2026-00031\)/),
  });
});

test("createCrmBookingRecord runs it inside its transaction, before the booking is inserted", () => {
  const src = fs.readFileSync(path.join(__dirname, "../services/crmEntityCreation.js"), "utf8");
  const body = src.slice(src.indexOf("async function createCrmBookingRecord("));
  const begin = body.indexOf("await tx.begin()");
  const check = body.indexOf("await assertNoBookingForApplicationLocked(tx,");
  const insert = body.indexOf("INSERT INTO dbo.CrmBooking");
  expect(begin).toBeGreaterThan(-1);
  expect(check).toBeGreaterThan(begin);
  expect(insert).toBeGreaterThan(check);
});
