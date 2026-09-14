process.env.NODE_ENV = "test";

/**
 * The Inter-Company Transfer orchestrator (backend/routes/interCompanyTransfer.js)
 * calls internal creation functions extracted from other route files
 * (createSaleOrderInternal, createSaleInvoiceInternal,
 * createReceivedPaymentInternal, createPurchaseOrderInternal,
 * createGRNInternal, createExpenseBookingInternal) via destructured require()
 * — e.g. `const { createGRNInternal } = require("./grns")`.
 *
 * Each of those route files attaches its internal function onto
 * module.exports alongside the router (`module.exports.createXInternal = ...`).
 * A route file rewrite that resets `module.exports = router` without
 * re-attaching the internal function silently breaks this — the
 * destructured import becomes `undefined`, and the orchestrator only fails
 * at runtime, deep into a live approval, with "createXInternal is not a
 * function". This happened for real: a large merge from another branch
 * rewrote grns.js and dropped its `createGRNInternal` export, breaking the
 * Inter-Company Transfer chain exactly at the GRN step. This test would
 * have caught it immediately.
 */

jest.mock("../config/env", () => ({ loadEnv: jest.fn(), envPath: "" }));
jest.mock("../logger", () => {
  const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  logger.child = jest.fn(() => logger);
  return logger;
});
jest.mock("../db", () => ({
  sql: require("mssql"),
  getPool: () => ({ request: () => ({ input: () => ({ input: () => ({ query: async () => ({ recordset: [] }) }) }), query: async () => ({ recordset: [] }) }) }),
  connectDB: jest.fn(async () => {}),
  closeDB: jest.fn(async () => {}),
  isDbReady: jest.fn(async () => true),
  queryWithRetry: async (pool, fn) => fn(pool.request()),
}));
jest.mock("../redis", () => ({
  bumpCacheVersion: jest.fn(async () => {}),
  redisGet: jest.fn(async () => null),
  redisSet: jest.fn(async () => {}),
  redisGetStrict: jest.fn(async () => null),
  pfaddActiveUser: jest.fn(async () => {}),
  localVersionCache: { invalidate: jest.fn(), get: jest.fn(async () => null), set: jest.fn() },
  permissionCache: { get: jest.fn(async () => null) },
}));

describe("Internal creation functions used by the Inter-Company Transfer orchestrator stay exported", () => {
  test("grns.js exports createGRNInternal", () => {
    const { createGRNInternal } = require("../routes/grns");
    expect(typeof createGRNInternal).toBe("function");
  });

  test("purchaseOrders.js exports createPurchaseOrderInternal", () => {
    const { createPurchaseOrderInternal } = require("../routes/purchaseOrders");
    expect(typeof createPurchaseOrderInternal).toBe("function");
  });

  test("expenseBooking.js exports createExpenseBookingInternal", () => {
    const { createExpenseBookingInternal } = require("../routes/expenseBooking");
    expect(typeof createExpenseBookingInternal).toBe("function");
  });

  test("customerSaleOrders.js exports createSaleOrderInternal", () => {
    const { createSaleOrderInternal } = require("../routes/customerSaleOrders");
    expect(typeof createSaleOrderInternal).toBe("function");
  });

  test("saleInvoices.js exports createSaleInvoiceInternal", () => {
    const { createSaleInvoiceInternal } = require("../routes/saleInvoices");
    expect(typeof createSaleInvoiceInternal).toBe("function");
  });

  test("receivedPayment.js exports createReceivedPaymentInternal", () => {
    const { createReceivedPaymentInternal } = require("../routes/receivedPayment");
    expect(typeof createReceivedPaymentInternal).toBe("function");
  });
});
