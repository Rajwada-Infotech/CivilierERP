"use strict";
/**
 * End-to-end HTTP test of the CRM payment -> Accounts deposit-bank -> approval
 * gate, through the REAL route files (JWT swapped for the given user; page
 * rights / role middleware still run). Self-cleaning: the Received Payment it
 * creates is deleted at the end. It deliberately stops BEFORE the final
 * approval, which would post real ledger entries (unchanged posting code).
 *
 * Run: node backend/scripts/e2eCrmDepositBankFlow.js --booking <bookingId> --bank <bankLHeadId> --user <adminUserId>
 */
const path = require("path");
const BACKEND = path.join(__dirname, "..");
require(path.join(BACKEND, "config/env")).loadEnv();

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? parseInt(process.argv[i + 1], 10) : NaN; };
const BOOKING = arg("booking"), BANK = arg("bank"), USER = arg("user");
if (![BOOKING, BANK, USER].every(Number.isInteger)) {
  console.error("Usage: node backend/scripts/e2eCrmDepositBankFlow.js --booking <id> --bank <bankLHeadId> --user <adminUserId>");
  process.exit(2);
}
const ADMIN = { userId: USER, id: USER, role: "admin", roleId: 1 };
const authPath = require.resolve(path.join(BACKEND, "middleware/auth"));
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: (req, _r, next) => { req.user = { ...ADMIN }; next(); } };
const express = require("express");
const { connectDB, getPool, sql } = require(path.join(BACKEND, "db"));

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  PASS  ${name}`);
  else { failures++; console.log(`  FAIL  ${name}`, extra !== undefined ? JSON.stringify(extra).slice(0, 500) : ""); }
};

(async () => {
  await connectDB();
  const q = async (t, i = {}) => { const r = getPool().request(); for (const [k, [ty, v]] of Object.entries(i)) r.input(k, ty, v); return (await r.query(t)).recordset; };
  const app = express();
  app.use(express.json());
  app.use((req, _r, next) => { req.user = { ...ADMIN }; next(); });
  app.use("/api/crm/payments", require(path.join(BACKEND, "routes/crmPayments")));
  app.use("/api/received-payment", require(path.join(BACKEND, "routes/receivedPayment")));
  app.use("/api/approval-inbox", require(path.join(BACKEND, "routes/approvalInbox")));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    let data = null; try { data = await res.json(); } catch { /* empty */ }
    return { status: res.status, data };
  };
  const nonBank = (await q("SELECT TOP 1 LHeadId FROM dbo.AccountHeadMaster WHERE LHeadType <> 'B'"))[0]?.LHeadId;
  let rpId = null;

  // Leftovers from an interrupted earlier run.
  for (const old of await q("SELECT RPPaymentID FROM dbo.ReceivedPayment WHERE RPRemarks LIKE 'E2E deposit-bank test%'")) {
    const d = await call("DELETE", `/api/received-payment/${old.RPPaymentID}`);
    console.log(`  (pre-clean) removed leftover test payment ${old.RPPaymentID}: HTTP ${d.status}`);
  }

  try {
    console.log("\n[1] CRM records an on-account deposit — a bank sent from CRM is ignored");
    let r = await call("POST", `/api/crm/payments/booking/${BOOKING}/on-account`, {
      Amount: 1, ReceivedDate: new Date().toISOString().slice(0, 10), PaymentMode: "Cheque", TransactionRef: "E2E-CHQ-1",
      Notes: "E2E deposit-bank test (auto-deleted)", DepositBankId: BANK, DepositBankName: "should be ignored",
    });
    rpId = r.data?.ReceivedPaymentId ?? r.data?.RPPaymentID ?? null;
    if (!rpId) {
      const row = (await q("SELECT TOP 1 RPPaymentID FROM dbo.ReceivedPayment WHERE CrmBookingId = @b AND RPRemarks LIKE 'E2E deposit-bank test%' ORDER BY RPPaymentID DESC", { b: [sql.Int, BOOKING] }))[0];
      rpId = row?.RPPaymentID ?? null;
    }
    check("CRM entry accepted without requiring a bank", r.status >= 200 && r.status < 300 && rpId, r);
    const rp = (await q("SELECT RPStatus, RPDepositBankId, CrmBookingId FROM dbo.ReceivedPayment WHERE RPPaymentID = @id", { id: [sql.Int, rpId] }))[0];
    check("Received Payment is Pending, CRM-linked, with NO deposit bank (CRM's bank ignored)", rp?.RPStatus === "Pending" && rp.CrmBookingId === BOOKING && rp.RPDepositBankId == null, rp);

    console.log("\n[2] Approval Inbox shows Review, not Approve");
    let inbox = await call("GET", "/api/approval-inbox");
    let rows = Array.isArray(inbox.data) ? inbox.data : (inbox.data?.items || []);
    let mine = rows.find((x) => x.Module === "received-payment" && String(x.RecordId) === String(rpId));
    check("inbox row flagged NeedsReview", mine && !!mine.NeedsReview, mine);

    console.log("\n[3] Approval is refused while there is no deposit bank");
    r = await call("PUT", `/api/received-payment/${rpId}/approve`);
    check("approve -> 400 'no Deposit Bank'", r.status === 400 && /Deposit Bank/i.test(r.data?.error), r);
    check("still Pending", (await q("SELECT RPStatus FROM dbo.ReceivedPayment WHERE RPPaymentID = @id", { id: [sql.Int, rpId] }))[0].RPStatus === "Pending");

    console.log("\n[4] Accounts assigns the deposit bank");
    r = await call("PATCH", `/api/received-payment/${rpId}/deposit-bank`, { RPDepositBankId: nonBank });
    check("a non-bank account is refused (400)", r.status === 400 && /not an active bank/i.test(r.data?.error), r);
    r = await call("PATCH", `/api/received-payment/${rpId}/deposit-bank`, {});
    check("no bank selected is refused (400)", r.status === 400, r);
    const before = (await q("SELECT RPAmount, RPMode, RPCheckNumber, RPTransactionID FROM dbo.ReceivedPayment WHERE RPPaymentID = @id", { id: [sql.Int, rpId] }))[0];
    r = await call("PATCH", `/api/received-payment/${rpId}/deposit-bank`, { RPDepositBankId: BANK });
    check("real bank accepted", r.status === 200 && r.data?.RPDepositBankId === BANK && r.data?.RPDepositBankName, r);
    const after = (await q("SELECT RPAmount, RPMode, RPCheckNumber, RPTransactionID, RPDepositBankId FROM dbo.ReceivedPayment WHERE RPPaymentID = @id", { id: [sql.Int, rpId] }))[0];
    check("ONLY the bank changed (amount / mode / cheque details untouched)",
      Number(after.RPAmount) === Number(before.RPAmount) && after.RPMode === before.RPMode && after.RPCheckNumber === before.RPCheckNumber && after.RPTransactionID === before.RPTransactionID && after.RPDepositBankId === BANK, { before, after });
    const single = await call("GET", `/api/received-payment/${rpId}`);
    check("GET /:id returns CrmBookingId + the bank (for the page's panel)", single.data?.CrmBookingId === BOOKING && single.data?.RPDepositBankId === BANK, single.data && { CrmBookingId: single.data.CrmBookingId, RPDepositBankId: single.data.RPDepositBankId });

    console.log("\n[5] Inbox now allows the final approval");
    inbox = await call("GET", "/api/approval-inbox");
    rows = Array.isArray(inbox.data) ? inbox.data : (inbox.data?.items || []);
    mine = rows.find((x) => x.Module === "received-payment" && String(x.RecordId) === String(rpId));
    check("inbox row no longer NeedsReview", mine && !mine.NeedsReview, mine);

    console.log("\n[6] Guards on the set-bank action");
    const nonCrm = (await q("SELECT TOP 1 RPPaymentID FROM dbo.ReceivedPayment WHERE CrmBookingId IS NULL AND RPStatus = 'Pending'"))[0];
    if (nonCrm) {
      r = await call("PATCH", `/api/received-payment/${nonCrm.RPPaymentID}/deposit-bank`, { RPDepositBankId: BANK });
      check("non-CRM payment refused (400)", r.status === 400 && /Only CRM payments/.test(r.data?.error), r);
    } else console.log("  (skip) no Pending non-CRM payment on this DB to test against");
    const approvedCrm = (await q("SELECT TOP 1 RPPaymentID FROM dbo.ReceivedPayment WHERE CrmBookingId IS NOT NULL AND RPStatus = 'Approved'"))[0];
    if (approvedCrm) {
      const bankBefore = (await q("SELECT RPDepositBankId FROM dbo.ReceivedPayment WHERE RPPaymentID = @id", { id: [sql.Int, approvedCrm.RPPaymentID] }))[0].RPDepositBankId;
      r = await call("PATCH", `/api/received-payment/${approvedCrm.RPPaymentID}/deposit-bank`, { RPDepositBankId: BANK });
      const bankAfter = (await q("SELECT RPDepositBankId FROM dbo.ReceivedPayment WHERE RPPaymentID = @id", { id: [sql.Int, approvedCrm.RPPaymentID] }))[0].RPDepositBankId;
      check("an already-approved payment's bank can't be changed here (400, unchanged)", r.status === 400 && bankBefore === bankAfter, r);
    } else console.log("  (skip) no approved CRM payment on this DB to test against");
  } catch (e) {
    failures++;
    console.error("\nERROR:", e.stack || e.message);
  } finally {
    console.log("\n[Cleanup]");
    if (rpId) {
      const d = await call("DELETE", `/api/received-payment/${rpId}`);
      const left = (await q("SELECT COUNT(*) n FROM dbo.ReceivedPayment WHERE RPPaymentID = @id", { id: [sql.Int, rpId] }))[0].n;
      check("test payment deleted", d.status === 200 && left === 0, d);
    }
    server.close();
    console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL CHECKS PASSED");
    process.exit(failures ? 1 : 0);
  }
})();
