"use strict";
/**
 * End-to-end run of a CANCELLED plot sale through the real route files:
 *
 *   application (2 plots) -> booking -> approvals -> booking amount received
 *   -> cancellation request -> submit -> approve
 *   -> booking and plot lines Cancelled, the money held for refund, every
 *      ledger voucher balanced
 *   -> the same plots can be applied for again; cancelling that application
 *      frees them once more.
 *
 * JWT is swapped for the given admin user; page rights / role middleware
 * still run. Everything is tagged ZZE2E and removed afterwards by
 * scripts/e2eCrmPlotLifecycleCleanup.js. Plot price / neighbour fixtures are
 * restored.
 *
 * Run: node backend/scripts/e2eCrmPlotCancellation.js --project <id> --bank <bankLHeadId> --user <adminUserId> [--keep]
 */
const path = require("path");
const BACKEND = path.join(__dirname, "..");
require(path.join(BACKEND, "config/env")).loadEnv();

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? parseInt(process.argv[i + 1], 10) : NaN; };
const PROJECT = arg("project"), BANK = arg("bank"), USER = arg("user");
const KEEP = process.argv.includes("--keep");
if (![PROJECT, BANK, USER].every(Number.isInteger)) {
  console.error("Usage: node backend/scripts/e2eCrmPlotCancellation.js --project <id> --bank <bankLHeadId> --user <adminUserId> [--keep]");
  process.exit(2);
}
const TAG = "ZZE2E";
const authPath = require.resolve(path.join(BACKEND, "middleware/auth"));
const express = require("express");
const { connectDB, getPool, sql } = require(path.join(BACKEND, "db"));

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  PASS  ${name}`);
  else { failures++; console.log(`  FAIL  ${name}`, extra !== undefined ? JSON.stringify(extra).slice(0, 800) : ""); }
};
const money = (x) => Math.round(Number(x || 0) * 100) / 100;

(async () => {
  await connectDB();
  const q = async (t, i = {}) => { const r = getPool().request(); for (const [k, [ty, v]] of Object.entries(i)) r.input(k, ty, v); return (await r.query(t)).recordset; };

  const u = (await q(`SELECT u.id, u.email, u.name, r.RName, u.RoleId FROM dbo.Users u JOIN dbo.Role r ON r.RId = u.RoleId WHERE u.id = @id`, { id: [sql.Int, USER] }))[0];
  if (!u) { console.error("user not found"); process.exit(2); }
  const ADMIN = { userId: u.id, id: u.id, email: u.email, name: u.name, role: u.RName, roleId: u.RoleId };
  require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: (req, _r, next) => { req.user = { ...ADMIN }; next(); } };

  const app = express();
  app.use(express.json());
  app.use((req, _r, next) => { req.user = { ...ADMIN }; next(); });
  app.use("/api/crm/applications", require(path.join(BACKEND, "routes/crmApplications")));
  app.use("/api/crm/bookings", require(path.join(BACKEND, "routes/crmBookings")));
  app.use("/api/crm/payments", require(path.join(BACKEND, "routes/crmPayments")));
  app.use("/api/crm/cancellations", require(path.join(BACKEND, "routes/crmCancellations")));
  app.use("/api/received-payment", require(path.join(BACKEND, "routes/receivedPayment")));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    let data = null; try { data = await res.json(); } catch { /* empty */ }
    return { status: res.status, data };
  };
  const ok = (r) => r.status >= 200 && r.status < 300;

  const run = { applicationIds: [], bookingId: null, plotRestore: [], adjacency: null };
  const glStart = (await q("SELECT ISNULL(MAX(EntryId), 0) AS m FROM dbo.GeneralLedgerEntry"))[0].m;
  try {
    const plots = await q(`
      SELECT TOP 2 p.Id, p.PlotName, p.AreaSqFt, p.RatePerSqFt, p.BlockId
      FROM dbo.PlotMaster p
      WHERE p.ProjectId = @pid AND p.IsActive = 1 AND p.ConvertedUnitId IS NULL
        AND NOT EXISTS (SELECT 1 FROM dbo.CrmBookingPlot bp WHERE bp.PlotId = p.Id AND bp.Status = 'Active')
        AND NOT EXISTS (SELECT 1 FROM dbo.CrmApplicationPlot ap WHERE ap.PlotId = p.Id AND ap.Status = 'Active')
        AND NOT EXISTS (SELECT 1 FROM dbo.CrmInventoryHold h WHERE h.EntityType = 'Plot' AND h.EntityId = p.Id AND h.Status = 'Active')
      ORDER BY p.Id DESC`, { pid: [sql.Int, PROJECT] });
    if (plots.length < 2) throw new Error("project needs 2 free plots");
    run.plotRestore = plots.map((p) => ({ Id: p.Id, AreaSqFt: p.AreaSqFt, RatePerSqFt: p.RatePerSqFt }));
    const fixture = [[1200, 2500], [1500, 2500]];
    for (let i = 0; i < 2; i++) {
      await q("UPDATE dbo.PlotMaster SET AreaSqFt = @a, RatePerSqFt = @r WHERE Id = @id",
        { a: [sql.Decimal(18, 2), fixture[i][0]], r: [sql.Decimal(18, 2), fixture[i][1]], id: [sql.Int, plots[i].Id] });
    }
    run.adjacency = [Math.min(plots[0].Id, plots[1].Id), Math.max(plots[0].Id, plots[1].Id)];
    await q("INSERT INTO dbo.PlotAdjacency (PlotId, AdjacentPlotId, CreatedBy, CreatedAt) VALUES (@a, @b, @u, SYSDATETIME())",
      { a: [sql.Int, run.adjacency[0]], b: [sql.Int, run.adjacency[1]], u: [sql.Int, USER] });
    const plotIds = plots.map((p) => p.Id);
    const today = new Date().toISOString().slice(0, 10);
    const newApplication = async (name) => {
      const r = await call("POST", "/api/crm/applications", {
        ApplicantName: `${TAG} ${name}`, Mobile: "9000000002", ProjectId: PROJECT, PreferredPlotIds: plotIds,
        TokenType: "Amount", TokenValue: 100000, BookingAmount: 100000, Source: "WalkIn", DateOfApply: today, Notes: `${TAG} cancellation test`,
      });
      if (r.data?.id) run.applicationIds.push(r.data.id);
      return r;
    };
    const plotLines = async () => ({
      booking: await q(`SELECT Status, COUNT(*) n FROM dbo.CrmBookingPlot WHERE PlotId IN (${plotIds.join(",")}) AND BookingId = @b GROUP BY Status`, { b: [sql.Int, run.bookingId || 0] }),
      activeAnywhere: (await q(`SELECT
          (SELECT COUNT(*) FROM dbo.CrmBookingPlot WHERE PlotId IN (${plotIds.join(",")}) AND Status = N'Active') +
          (SELECT COUNT(*) FROM dbo.CrmApplicationPlot WHERE PlotId IN (${plotIds.join(",")}) AND Status = N'Active') AS n`))[0].n,
    });

    console.log("\n[1] Sell the two plots and take the booking amount");
    let r = await newApplication("Plot Canceller");
    check("application created", r.status === 201, r);
    const appId = run.applicationIds[0];
    r = await call("PUT", `/api/crm/applications/${appId}/submit`, {});
    run.bookingId = (await q("SELECT Id FROM dbo.CrmBooking WHERE ApplicationId = @a AND IsActive = 1", { a: [sql.Int, appId] }))[0]?.Id ?? null;
    check("booking created", ok(r) && !!run.bookingId, r);
    if (!run.bookingId) throw new Error("stop: no booking");
    const bid = run.bookingId;
    for (const key of ["ApplicantKyc", "ProjectUnitRate", "PaymentPlanAmounts", "BankDepositMode", "BrokerDetails", "SourceAssignment", "Documents"]) {
      await call("PUT", `/api/crm/bookings/${bid}/checklist/${key}/check`, { remarks: TAG });
    }
    r = await call("PUT", `/api/crm/bookings/${bid}/ready-for-approval`, {});
    check("ready for approval", ok(r), r);
    for (let i = 0; i < 4; i++) {
      const s = (await q("SELECT Status FROM dbo.CrmBooking WHERE Id = @b", { b: [sql.Int, bid] }))[0];
      if (s.Status === "Approved") break;
      r = await call("PUT", `/api/crm/bookings/${bid}/approve`, {});
      if (!ok(r)) break;
    }
    check("booking approved", (await q("SELECT Status FROM dbo.CrmBooking WHERE Id = @b", { b: [sql.Int, bid] }))[0].Status === "Approved");
    const rp = (await q("SELECT RPPaymentID FROM dbo.ReceivedPayment WHERE CrmBookingId = @b AND RPStatus = 'Pending'", { b: [sql.Int, bid] }))[0];
    check("booking-amount receipt waiting for Accounts", !!rp);
    if (rp) {
      await call("PATCH", `/api/received-payment/${rp.RPPaymentID}/deposit-bank`, { RPDepositBankId: BANK });
      r = await call("PUT", `/api/received-payment/${rp.RPPaymentID}/approve`);
      check("booking amount approved", ok(r) && !r.data?.crmWarning, r);
    }
    const paid = money((await q("SELECT ISNULL(SUM(Amount), 0) AS s FROM dbo.CrmOnAccountPayment WHERE BookingId = @b", { b: [sql.Int, bid] }))[0].s);
    check("₹1,00,000 received and held as Advance", paid === 100000, paid);

    console.log("\n[2] Cancel the booking");
    r = await call("POST", "/api/crm/cancellations", { BookingId: bid, Reason: `${TAG} customer withdrew`, DeductionPercent: 0 });
    const cancelId = r.data?.id ?? r.data?.Id ?? r.data?.cancellation?.Id ?? null;
    check("cancellation requested", ok(r) && !!cancelId, r);
    if (!cancelId) throw new Error("stop: no cancellation");
    // A new request is created straight into Pending (awaiting approval).
    const cStatus = (await q("SELECT Status FROM dbo.CrmCancellation WHERE Id = @c", { c: [sql.Int, cancelId] }))[0]?.Status;
    check("cancellation awaiting approval", cStatus === "Pending", cStatus);
    r = await call("PUT", `/api/crm/cancellations/${cancelId}/approve`, {});
    check("cancellation approved", ok(r), r);
    const bk = (await q("SELECT Status FROM dbo.CrmBooking WHERE Id = @b", { b: [sql.Int, bid] }))[0];
    check("booking Cancelled", bk.Status === "Cancelled", bk);
    let lines = await plotLines();
    check("plot lines Cancelled — no active claim on either plot", lines.activeAnywhere === 0 && lines.booking.every((x) => x.Status === "Cancelled"), lines);
    const appStatus = (await q("SELECT Status FROM dbo.CrmApplication WHERE Id = @a", { a: [sql.Int, appId] }))[0].Status;
    check("application closed with the booking", appStatus === "Cancelled", appStatus);
    const refund = await q("SELECT Id, Status, GrossAmount, NetAmount FROM dbo.CrmRefund WHERE BookingId = @b", { b: [sql.Int, bid] });
    console.log(`  refund rows: ${JSON.stringify(refund)}`);
    check("the money is kept for refund in full, not lost", refund.length === 1 && money(refund[0].GrossAmount) === 100000 && money(refund[0].NetAmount) === 100000, refund);

    console.log("\n[3] The plots are for sale again");
    r = await newApplication("Plot Rebuyer");
    check("a new application can take the same plots", r.status === 201, r);
    const app2 = run.applicationIds[1];
    if (app2) {
      lines = await plotLines();
      check("the new application holds them", lines.activeAnywhere === 2, lines);
      r = await call("PUT", `/api/crm/applications/${app2}/cancel`, { Remarks: TAG });
      check("cancelling that application", ok(r), r);
      lines = await plotLines();
      check("frees them again", lines.activeAnywhere === 0, lines);
    }

    console.log("\n[4] Ledger");
    const gl = await q(`SELECT g.VoucherNo, g.SourceType, h.LHeadName, h.LHeadCode, g.DebitAmount, g.CreditAmount
      FROM dbo.GeneralLedgerEntry g JOIN dbo.AccountHeadMaster h ON h.LHeadId = g.LHeadId
      WHERE g.EntryId > @s AND g.ProjectId = @p ORDER BY g.EntryId`, { s: [sql.Int, glStart], p: [sql.Int, PROJECT] });
    console.table(gl);
    const byV = {};
    for (const g of gl) { byV[g.VoucherNo] = byV[g.VoucherNo] || { dr: 0, cr: 0 }; byV[g.VoucherNo].dr += Number(g.DebitAmount); byV[g.VoucherNo].cr += Number(g.CreditAmount); }
    check("every voucher balanced", Object.keys(byV).length >= 1 && Object.values(byV).every((v) => money(v.dr) === money(v.cr)), byV);
    check("no revenue recognised on a cancelled sale", !gl.some((g) => ["CRM-SALE-LAND", "CRM-SALE-INCOME"].includes(g.LHeadCode)), gl);
  } catch (e) {
    failures++;
    console.error("\nERROR:", e.stack || e.message);
  } finally {
    console.log(`\nRun ids: applications ${run.applicationIds.join(", ")}, booking ${run.bookingId}`);
    server.close();
    if (!KEEP) {
      for (const p of run.plotRestore) {
        await q("UPDATE dbo.PlotMaster SET AreaSqFt = @a, RatePerSqFt = @r WHERE Id = @id",
          { a: [sql.Decimal(18, 2), p.AreaSqFt], r: [sql.Decimal(18, 2), p.RatePerSqFt], id: [sql.Int, p.Id] });
      }
      if (run.adjacency) await q("DELETE FROM dbo.PlotAdjacency WHERE PlotId = @a AND AdjacentPlotId = @b", { a: [sql.Int, run.adjacency[0]], b: [sql.Int, run.adjacency[1]] });
      const { cleanup } = require("./e2eCrmPlotLifecycleCleanup");
      try { await cleanup(getPool(), TAG); } catch (e) { failures++; console.error("CLEANUP ERROR:", e.stack || e.message); }
    }
    console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL CHECKS PASSED");
    process.exit(failures ? 1 : 0);
  }
})();
