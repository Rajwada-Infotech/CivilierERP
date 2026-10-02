"use strict";
/**
 * End-to-end run of a PLOT sale through the REAL route files, from the
 * application to the final invoice, against the configured database:
 *
 *   application (2 plots) -> submit (auto-booking) -> data-review checklist
 *   -> ready-for-approval -> stage approvals -> on-account receipt (CRM)
 *   -> Accounts sets the deposit bank -> receipt approval (GL: Dr Bank /
 *   Cr Advance) -> demands -> milestone invoices (GL: Dr Advance / Cr Sale
 *   of Land, no GST) -> every voucher balanced.
 *
 * JWT is swapped for the given admin user; page rights / role middleware
 * still run. Everything it creates is tagged ZZE2E and removed afterwards by
 * scripts/e2eCrmPlotLifecycleCleanup.js (run automatically at the end).
 *
 * Run: node backend/scripts/e2eCrmPlotLifecycle.js --project <id> --bank <bankLHeadId> --user <adminUserId> [--keep]
 */
const path = require("path");
const BACKEND = path.join(__dirname, "..");
require(path.join(BACKEND, "config/env")).loadEnv();

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? parseInt(process.argv[i + 1], 10) : NaN; };
const PROJECT = arg("project"), BANK = arg("bank"), USER = arg("user");
const KEEP = process.argv.includes("--keep");
if (![PROJECT, BANK, USER].every(Number.isInteger)) {
  console.error("Usage: node backend/scripts/e2eCrmPlotLifecycle.js --project <id> --bank <bankLHeadId> --user <adminUserId> [--keep]");
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
  app.use("/api/crm/customers", require(path.join(BACKEND, "routes/crmCustomers")));
  app.use("/api/crm/payments", require(path.join(BACKEND, "routes/crmPayments")));
  app.use("/api/crm/parking", require(path.join(BACKEND, "routes/crmParking")));
  app.use("/api/crm/welcome-calls", require(path.join(BACKEND, "routes/crmWelcomeCalls")));
  app.use("/api/crm/welcome-checklist", require(path.join(BACKEND, "routes/crmWelcomeChecklist")));
  app.use("/api/received-payment", require(path.join(BACKEND, "routes/receivedPayment")));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    let data = null; try { data = await res.json(); } catch { /* empty */ }
    return { status: res.status, data };
  };
  const ok = (r) => r.status >= 200 && r.status < 300;
  const ledger = async (sourceTypes, ids) => ids.length ? q(`
    SELECT g.VoucherNo, g.SourceType, g.SourceId, g.LHeadId, h.LHeadName, h.LHeadCode, g.DebitAmount, g.CreditAmount
    FROM dbo.GeneralLedgerEntry g JOIN dbo.AccountHeadMaster h ON h.LHeadId = g.LHeadId
    WHERE g.SourceType IN (${sourceTypes.map((s) => `'${s}'`).join(",")}) AND g.SourceId IN (${ids.join(",")})
    ORDER BY g.EntryId`) : [];

  const run = { applicationId: null, bookingId: null, customerId: null, plotRestore: [] };
  const glStart = (await q("SELECT ISNULL(MAX(EntryId), 0) AS m FROM dbo.GeneralLedgerEntry"))[0].m;
  try {
    // ── Pick two free plots with different sizes (bought together = one sale) ──
    const plots = await q(`
      SELECT TOP 2 p.Id, p.PlotName, p.AreaSqFt, p.RatePerSqFt, p.BlockId
      FROM dbo.PlotMaster p
      WHERE p.ProjectId = @pid AND p.IsActive = 1 AND p.ConvertedUnitId IS NULL
        AND NOT EXISTS (SELECT 1 FROM dbo.CrmBookingPlot bp WHERE bp.PlotId = p.Id AND bp.Status = 'Active')
        AND NOT EXISTS (SELECT 1 FROM dbo.CrmApplicationPlot ap WHERE ap.PlotId = p.Id AND ap.Status = 'Active')
        AND NOT EXISTS (SELECT 1 FROM dbo.CrmInventoryHold h WHERE h.EntityType = 'Plot' AND h.EntityId = p.Id AND h.Status = 'Active')
      ORDER BY p.Id DESC`, { pid: [sql.Int, PROJECT] });
    if (plots.length < 2) throw new Error("project needs 2 free plots");
    // Fixture: two DIFFERENT sizes on one rate (restored afterwards). Bought
    // together they are priced as a single sale on the combined area.
    run.plotRestore = plots.map((p) => ({ Id: p.Id, AreaSqFt: p.AreaSqFt, RatePerSqFt: p.RatePerSqFt }));
    const fixture = [[1200, 2500], [1500, 2500]];
    for (let i = 0; i < 2; i++) {
      await q("UPDATE dbo.PlotMaster SET AreaSqFt = @a, RatePerSqFt = @r WHERE Id = @id",
        { a: [sql.Decimal(18, 2), fixture[i][0]], r: [sql.Decimal(18, 2), fixture[i][1]], id: [sql.Int, plots[i].Id] });
      plots[i].AreaSqFt = fixture[i][0]; plots[i].RatePerSqFt = fixture[i][1];
    }
    // ...and neighbours, so they can be bought together (removed afterwards).
    await q(`INSERT INTO dbo.PlotAdjacency (PlotId, AdjacentPlotId, CreatedBy, CreatedAt) VALUES (@a, @b, @u, SYSDATETIME())`,
      { a: [sql.Int, Math.min(plots[0].Id, plots[1].Id)], b: [sql.Int, Math.max(plots[0].Id, plots[1].Id)], u: [sql.Int, USER] });
    run.adjacency = [Math.min(plots[0].Id, plots[1].Id), Math.max(plots[0].Id, plots[1].Id)];
    console.log(`Plots: ${plots.map((p) => `${p.PlotName} (${p.AreaSqFt} sqft @ ${p.RatePerSqFt})`).join(", ")}`);
    const PLAN_FOR_GUARD = (await q("SELECT TOP 1 Id FROM dbo.CrmPaymentPlanTemplate WHERE IsActive = 1 ORDER BY Id"))[0]?.Id ?? 1;
    const expectedValue = money(plots.reduce((s, p) => s + Number(p.AreaSqFt) * Number(p.RatePerSqFt), 0));

    console.log("\n[1] Application with two plots");
    let r = await call("POST", "/api/crm/applications", {
      ApplicantName: `${TAG} Plot Buyer`, Mobile: "9000000001", Email: "zze2e@example.invalid",
      ProjectId: PROJECT, PreferredPlotIds: plots.map((p) => p.Id), TokenType: "Amount", TokenValue: 100000, BookingAmount: 100000,
      Source: "WalkIn", DateOfApply: new Date().toISOString().slice(0, 10), Notes: `${TAG} automated end-to-end test`,
    });
    run.applicationId = r.data?.id ?? null;
    check("application created", r.status === 201 && run.applicationId, r);
    if (!run.applicationId) throw new Error("stop: no application");
    const appPlots = await q("SELECT PlotId, IsPrimary, Status FROM dbo.CrmApplicationPlot WHERE ApplicationId = @a", { a: [sql.Int, run.applicationId] });
    check("both plots attached to the application", appPlots.filter((x) => x.Status === "Active").length === 2, appPlots);

    // PUT /:id is how the form saves; it also stores PreferredPlotIds.
    r = await call("PUT", `/api/crm/applications/${run.applicationId}`, { PreferredPlotIds: plots.map((p) => p.Id) });
    check("application edit with plots accepted", ok(r), r);

    console.log("\n[2] Submit -> booking is created automatically");
    r = await call("PUT", `/api/crm/applications/${run.applicationId}/submit`, {});
    check("submit accepted", ok(r), r);
    run.bookingId = (await q("SELECT Id FROM dbo.CrmBooking WHERE ApplicationId = @a AND IsActive = 1", { a: [sql.Int, run.applicationId] }))[0]?.Id ?? null;
    check("booking exists", !!run.bookingId, r.data);
    if (!run.bookingId) throw new Error("stop: no booking");
    const bid = run.bookingId;
    const bk = (await q(`SELECT BookingNo, UnitId, BlockId, BlockName, UnitNo, TotalValue, GrandTotal, TotalGstAmount, UnitGstAmount,
                                UnitParkingGstAmount, ParkingGstAmount, ExtraWorkGstAmount, Status, WorkflowStage
                         FROM dbo.CrmBooking WHERE Id = @b`, { b: [sql.Int, bid] }))[0];
    console.log(`  booking ${bk.BookingNo}: TotalValue ${bk.TotalValue}, GrandTotal ${bk.GrandTotal}, stage ${bk.WorkflowStage}`);
    check("UnitId is NULL (plot booking)", bk.UnitId == null, bk);
    check("BlockId stored on the booking", bk.BlockId === plots[0].BlockId, { BlockId: bk.BlockId, expected: plots[0].BlockId });
    check("UnitNo names both plots", plots.every((p) => String(bk.UnitNo).includes(p.PlotName)), bk.UnitNo);
    check("TotalValue = sum of area x rate of both plots", money(bk.TotalValue) === expectedValue, { got: bk.TotalValue, expectedValue });
    check("no GST anywhere on a land sale", [bk.TotalGstAmount, bk.UnitGstAmount, bk.UnitParkingGstAmount, bk.ParkingGstAmount, bk.ExtraWorkGstAmount].every((v) => !Number(v)), bk);
    check("GrandTotal = TotalValue (no tax, no parking)", money(bk.GrandTotal) === money(bk.TotalValue), bk);
    const lines = await q("SELECT PlotId, AllocatedValue, Status FROM dbo.CrmBookingPlot WHERE BookingId = @b", { b: [sql.Int, bid] });
    check("two active plot lines", lines.filter((l) => l.Status === "Active").length === 2, lines);
    check("plot line values add up to TotalValue", money(lines.reduce((s, l) => s + Number(l.AllocatedValue), 0)) === money(bk.TotalValue), lines);
    const ms = await q("SELECT Id, MilestoneNo, MilestoneName, AmountDue, Status, DemandStatus FROM dbo.CrmPaymentMilestone WHERE BookingId = @b ORDER BY MilestoneNo", { b: [sql.Int, bid] });
    check("no payment plan on a plot sale", (await q("SELECT PaymentPlanId FROM dbo.CrmBooking WHERE Id = @b", { b: [sql.Int, bid] }))[0].PaymentPlanId == null);
    check("schedule is Booking 1,00,000 then Balance", ms.length === 2 && ms[0].MilestoneName === "Booking" && money(ms[0].AmountDue) === 100000 && ms[1].MilestoneName === "Balance", ms);
    check("milestones add up to GrandTotal", money(ms.reduce((s, m) => s + Number(m.AmountDue), 0)) === money(bk.GrandTotal), ms);
    const holds = await q("SELECT EntityType, EntityId, Status FROM dbo.CrmInventoryHold WHERE ApplicationId = @a", { a: [sql.Int, run.applicationId] });
    console.log(`  holds: ${JSON.stringify(holds)}`);

    console.log("\n[3] Booking visible through list / search / block filter");
    r = await call("GET", `/api/crm/bookings?search=${encodeURIComponent(plots[0].PlotName)}&pageSize=200`);
    const listRows = Array.isArray(r.data) ? r.data : (r.data?.items || r.data?.data || []);
    check("search by plot name finds it", listRows.some((x) => x.Id === bid), { status: r.status, n: listRows.length });
    r = await call("GET", `/api/crm/bookings?blockId=${plots[0].BlockId}&pageSize=500`);
    const blkRows = Array.isArray(r.data) ? r.data : (r.data?.items || r.data?.data || []);
    check("block filter finds it", blkRows.some((x) => x.Id === bid), { status: r.status, n: blkRows.length });
    r = await call("GET", `/api/crm/bookings/${bid}`);
    check("detail loads with BlockId", ok(r) && (r.data?.BlockId ?? r.data?.booking?.BlockId) === plots[0].BlockId, { status: r.status, BlockId: r.data?.BlockId ?? r.data?.booking?.BlockId });

    console.log("\n[3b] Every screen is told this is a plot sale; parking is refused");
    r = await call("GET", `/api/crm/bookings/${bid}`);
    check("booking detail: IsPlotSale + both plot lines", r.data?.booking?.IsPlotSale === true && (r.data?.plots || []).filter((p) => p.Status === "Active").length === 2, { IsPlotSale: r.data?.booking?.IsPlotSale, plots: r.data?.plots });
    check("plot lines carry name, area and value", (r.data?.plots || []).every((p) => p.PlotName && Number(p.AreaSqFt) > 0 && Number(p.AllocatedValue) > 0), r.data?.plots);
    r = await call("GET", `/api/crm/bookings?search=${encodeURIComponent(plots[0].PlotName)}&pageSize=200`);
    const listRow = (Array.isArray(r.data) ? r.data : (r.data?.rows || r.data?.items || [])).find((x) => x.Id === bid);
    check("booking list row: IsPlotSale", listRow?.IsPlotSale === true, listRow && { IsPlotSale: listRow.IsPlotSale });
    r = await call("GET", `/api/crm/applications/${run.applicationId}`);
    const appRow = r.data?.application;
    check("application detail: IsPlotSale, plot names, land area", appRow?.IsPlotSale === true && plots.every((p) => String(appRow.PlotNames).includes(p.PlotName)) && Number(appRow.PlotAreaSqFt) === plots.reduce((s, p) => s + p.AreaSqFt, 0), appRow && { IsPlotSale: appRow.IsPlotSale, PlotNames: appRow.PlotNames, PlotAreaSqFt: appRow.PlotAreaSqFt });
    r = await call("GET", `/api/crm/payments/booking/${bid}`);
    check("payments page: IsPlotSale", JSON.stringify(r.data || {}).includes('"IsPlotSale":true'), { status: r.status });
    r = await call("GET", `/api/crm/welcome-calls/${bid}/call-context`);
    check("welcome call: IsPlotSale", r.data?.booking?.IsPlotSale === true, { status: r.status, IsPlotSale: r.data?.booking?.IsPlotSale });
    r = await call("GET", `/api/crm/welcome-checklist/${bid}`);
    const wcItems = (r.data?.sections || []).flatMap((x) => x.items || []);
    check("welcome checklist speaks of plots, not units", wcItems.some((i) => i.ItemKey === "unit_no" && /Plot/.test(i.Label)) && (r.data?.sections || []).some((x) => x.label === "Project & Plot Details") && !wcItems.some((i) => i.ItemKey === "parking_selection"), r.data?.sections?.map((x) => x.label));
    const pm = (await q("SELECT TOP 1 Id FROM dbo.ParkingMaster WHERE ProjectId = @p AND IsActive = 1", { p: [sql.Int, PROJECT] }))[0];
    r = await call("POST", `/api/crm/parking/${bid}`, { ParkingMasterId: pm?.Id ?? 0, ParkingType: "Covered", Quantity: 1, RateOverride: 1000 });
    check("adding parking to the plot booking is refused", r.status === 400 && /plot sale has no parking/i.test(r.data?.error || ""), r);
    r = await call("POST", "/api/crm/parking/standalone", { ApplicationId: run.applicationId, ParkingType: "Covered", RateOverride: 1000, Quantity: 1 });
    check("adding parking to the plot application is refused", r.status === 400 && /plot sale has no parking/i.test(r.data?.error || ""), r);
    check("no parking row was created", (await q("SELECT COUNT(*) n FROM dbo.CrmParkingAllotment WHERE BookingId = @b OR ApplicationId = @a", { b: [sql.Int, bid], a: [sql.Int, run.applicationId] }))[0].n === 0);

    console.log("\n[3c] Edits before approval keep value, plot lines and schedule in step");
    const state = async () => {
      const b0 = (await q("SELECT TotalValue, GrandTotal, BookingAmount FROM dbo.CrmBooking WHERE Id = @b", { b: [sql.Int, bid] }))[0];
      const ln = await q("SELECT AllocatedValue FROM dbo.CrmBookingPlot WHERE BookingId = @b AND Status = N'Active'", { b: [sql.Int, bid] });
      const sc = await q("SELECT MilestoneName, AmountDue FROM dbo.CrmPaymentMilestone WHERE BookingId = @b AND ExtraChargeId IS NULL AND ParkingAllotmentId IS NULL ORDER BY MilestoneNo", { b: [sql.Int, bid] });
      return { total: money(b0.TotalValue), grand: money(b0.GrandTotal), bookingAmt: money(b0.BookingAmount), lines: money(ln.reduce((s, l) => s + Number(l.AllocatedValue), 0)), sched: sc.map((m) => [m.MilestoneName, money(m.AmountDue)]) };
    };
    const area = plots.reduce((s, p) => s + p.AreaSqFt, 0);
    r = await call("PUT", `/api/crm/bookings/${bid}`, { RatePerSqFt: 2600 });
    let st = await state();
    check("rate edit: total = area x new rate, plot lines follow", ok(r) && st.total === area * 2600 && st.lines === st.total && st.grand === st.total, { r: r.status, st });
    check("rate edit: schedule rebuilt as Booking + Balance of the new value", JSON.stringify(st.sched) === JSON.stringify([["Booking", 100000], ["Balance", area * 2600 - 100000]]), st.sched);
    r = await call("PUT", `/api/crm/bookings/${bid}`, { BookingAmount: 250000 });
    st = await state();
    check("booking amount edit: schedule follows", ok(r) && JSON.stringify(st.sched) === JSON.stringify([["Booking", 250000], ["Balance", area * 2600 - 250000]]), { r: r.status, st });
    r = await call("PUT", `/api/crm/bookings/${bid}`, { BookingAmount: 0 });
    st = await state();
    check("booking amount cleared: one Full Payment of the whole value", ok(r) && JSON.stringify(st.sched) === JSON.stringify([["Full Payment", area * 2600]]), { r: r.status, st });
    r = await call("PUT", `/api/crm/bookings/${bid}`, { RatePerSqFt: 2500, BookingAmount: 100000 });
    st = await state();
    check("restored: value, lines and schedule back to the original", ok(r) && st.total === expectedValue && st.lines === expectedValue && JSON.stringify(st.sched) === JSON.stringify([["Booking", 100000], ["Balance", expectedValue - 100000]]), st);
    r = await call("POST", `/api/crm/bookings/${bid}/resync-schedule`, {});
    check("resync-schedule rebuilds the land schedule", ok(r) && r.data?.changed === true && JSON.stringify((await state()).sched) === JSON.stringify(st.sched), r);
    // Editing the application and re-submitting carries the new rate and
    // Booking Amount through to the booking, its plot lines and schedule.
    r = await call("PUT", `/api/crm/applications/${run.applicationId}`, { RatePerSqFt: 2600, TokenType: "Amount", TokenValue: 150000, BookingAmount: 150000 });
    const r2 = await call("PUT", `/api/crm/applications/${run.applicationId}/submit`, {});
    st = await state();
    check("application re-submit: new rate reaches value, lines and schedule", ok(r) && ok(r2) && st.total === area * 2600 && st.lines === st.total && JSON.stringify(st.sched) === JSON.stringify([["Booking", 150000], ["Balance", area * 2600 - 150000]]), { r: r.status, r2: r2.status, st });
    r = await call("PUT", `/api/crm/applications/${run.applicationId}`, { RatePerSqFt: 2500, TokenValue: 100000, BookingAmount: 100000 });
    await call("PUT", `/api/crm/applications/${run.applicationId}/submit`, {});
    st = await state();
    check("application re-submit: restored", st.total === expectedValue && st.lines === expectedValue && JSON.stringify(st.sched) === JSON.stringify([["Booking", 100000], ["Balance", expectedValue - 100000]]), st);

    r = await call("PUT", `/api/crm/bookings/${bid}/change-unit`, { NewUnitId: 1, Reason: TAG });
    check("change-unit is refused for a plot sale", r.status === 400 && /plot sale/i.test(r.data?.error || ""), r);
    r = await call("PUT", `/api/crm/bookings/${bid}`, { PaymentPlanId: PLAN_FOR_GUARD });
    check("attaching a payment plan is refused for a plot sale", r.status === 400 && /no payment plan/i.test(r.data?.error || ""), r);
    r = await call("GET", `/api/crm/bookings/${bid}/checklist`);
    const clItems = Array.isArray(r.data) ? r.data : (r.data?.items || []);
    check("data review checklist speaks of plots", clItems.some((i) => i.ItemKey === "ProjectUnitRate" && /Plot/.test(i.ItemLabel)) && clItems.some((i) => i.ItemKey === "PaymentPlanAmounts" && /no payment plan/i.test(i.ItemLabel)), clItems.map((i) => i.ItemLabel));

    console.log("\n[4] Data review checklist -> ready for approval -> approvals");
    for (const key of ["ApplicantKyc", "ProjectUnitRate", "PaymentPlanAmounts", "BankDepositMode", "BrokerDetails", "SourceAssignment", "Documents"]) {
      r = await call("PUT", `/api/crm/bookings/${bid}/checklist/${key}/check`, { remarks: TAG });
      if (!ok(r)) check(`checklist ${key}`, false, r);
    }
    r = await call("PUT", `/api/crm/bookings/${bid}/ready-for-approval`, {});
    check("ready-for-approval accepted", ok(r) && !r.data?.mrWarning, r);
    let stage = null;
    for (let i = 0; i < 6; i++) {
      const s = (await q("SELECT Status, WorkflowStage FROM dbo.CrmBooking WHERE Id = @b", { b: [sql.Int, bid] }))[0];
      stage = s;
      if (s.Status === "Approved") break;
      r = await call("PUT", `/api/crm/bookings/${bid}/approve`, {});
      console.log(`  approve at stage ${s.WorkflowStage}: HTTP ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
      if (!ok(r)) break;
    }
    check("booking Approved", stage?.Status === "Approved", stage);

    const grand = money(bk.GrandTotal);
    const today = new Date().toISOString().slice(0, 10);
    const cust = (await q("SELECT CustomerId FROM dbo.CrmApplication WHERE Id = @a", { a: [sql.Int, run.applicationId] }))[0].CustomerId;
    run.customerId = cust;

    console.log("\n[5] Customer is invoiced; demands raised for the schedule");
    // The customer form saves the whole record — send it back with only the mode changed.
    r = await call("GET", `/api/crm/customers/${cust}`);
    const custRow = r.data?.customer || r.data;
    r = await call("PUT", `/api/crm/customers/${cust}`, { ...custRow, InvoiceMode: "Invoice" });
    check("customer set to Invoice", ok(r) && (await q("SELECT InvoiceMode FROM dbo.CrmCustomer WHERE Id = @c", { c: [sql.Int, cust] }))[0]?.InvoiceMode === "Invoice", r);
    const ms0 = await q("SELECT Id, MilestoneName FROM dbo.CrmPaymentMilestone WHERE BookingId = @b ORDER BY MilestoneNo", { b: [sql.Int, bid] });
    for (const m of ms0) {
      r = await call("POST", `/api/crm/payments/${m.Id}/demand`, { Notes: TAG });
      check(`demand raised for ${m.MilestoneName}`, ok(r), r);
    }
    r = await call("POST", "/api/crm/bookings/invoices/bulk-generate", { items: ms0.map((m) => ({ bookingId: bid, milestoneId: m.Id })) });
    check("invoice refused while the booking is unpaid", ok(r) && r.data?.succeeded?.length === 0 && /fully paid/i.test(r.data?.skipped?.[0]?.reason || ""), r);

    const approveWithBank = async (rpId, label) => {
      let x = await call("PUT", `/api/received-payment/${rpId}/approve`);
      check(`${label}: approval refused without a deposit bank`, x.status === 400 && /Deposit Bank/i.test(x.data?.error || ""), x);
      x = await call("PATCH", `/api/received-payment/${rpId}/deposit-bank`, { RPDepositBankId: BANK });
      check(`${label}: deposit bank set`, ok(x) && x.data?.RPDepositBankId === BANK, x);
      x = await call("PUT", `/api/received-payment/${rpId}/approve`);
      check(`${label}: approved with no CRM warning`, ok(x) && !x.data?.crmWarning, x);
    };

    console.log("\n[6] Booking amount: Money Receipt -> Received Payment -> Accounts approves");
    const mr = await q("SELECT Id, ReceiptNo, Amount, Status, ReceivedPaymentId FROM dbo.CrmMoneyReceipt WHERE BookingId = @b", { b: [sql.Int, bid] });
    console.log(`  money receipts: ${JSON.stringify(mr)}`);
    const mrRp = (await q("SELECT RPPaymentID, RPAmount, RPStatus FROM dbo.ReceivedPayment WHERE CrmBookingId = @b AND RPStatus = 'Pending'", { b: [sql.Int, bid] }));
    check("one Pending Received Payment for the booking amount", mrRp.length === 1 && money(mrRp[0].RPAmount) === 100000, mrRp);
    if (mrRp[0]) await approveWithBank(mrRp[0].RPPaymentID, "booking amount");
    let msNow = await q("SELECT MilestoneName, AmountDue, AmountPaid, Status FROM dbo.CrmPaymentMilestone WHERE BookingId = @b ORDER BY MilestoneNo", { b: [sql.Int, bid] });
    // By design money stays in Advance from Customer until the whole sale value
    // is in (autoApplyOnAccountIfFullyFunded), so nothing is applied yet.
    check("part payment held on account — no milestone settled yet", msNow.every((m) => m.Status !== "Paid" && !Number(m.AmountPaid)), msNow);

    console.log("\n[7] Balance: CRM records it -> Received Payment -> Accounts approves");
    const balance = money(grand - 100000);
    r = await call("POST", `/api/crm/payments/booking/${bid}/on-account`, {
      Amount: balance, ReceivedDate: today, PaymentMode: "NEFT", TransactionRef: `${TAG}-UTR-1`, BankName: "ZZE2E Customer Bank", Notes: `${TAG} balance payment`,
    });
    const rpId = r.data?.ReceivedPaymentId;
    check("balance entry accepted, Pending", r.status === 201 && rpId, r);
    if (rpId) await approveWithBank(rpId, "balance");
    msNow = await q("SELECT MilestoneName, AmountDue, AmountPaid, Status FROM dbo.CrmPaymentMilestone WHERE BookingId = @b ORDER BY MilestoneNo", { b: [sql.Int, bid] });
    check("every milestone paid in full", msNow.every((m) => m.Status === "Paid" && money(m.AmountPaid) === money(m.AmountDue)), msNow);
    const oa = await q("SELECT Id, ReceiptNo, Amount, AppliedAmount FROM dbo.CrmOnAccountPayment WHERE BookingId = @b", { b: [sql.Int, bid] });
    check("deposits total the sale value, all applied", money(oa.reduce((s, x) => s + Number(x.Amount), 0)) === grand && money(oa.reduce((s, x) => s + Number(x.AppliedAmount), 0)) === grand, oa);

    console.log("\n[8] Invoices (revenue recognition)");
    r = await call("POST", "/api/crm/bookings/invoices/bulk-generate", { items: ms0.map((m) => ({ bookingId: bid, milestoneId: m.Id })) });
    check("every milestone invoiced", ok(r) && r.data?.succeeded?.length === ms0.length && !r.data?.skipped?.length, r);
    r = await call("POST", "/api/crm/bookings/invoices/bulk-generate", { items: ms0.map((m) => ({ bookingId: bid, milestoneId: m.Id })) });
    check("re-generating is refused (no duplicate invoice)", ok(r) && r.data?.succeeded?.length === 0, r);
    const invs = await q("SELECT Id, InvoiceNo, InvoiceType, Amount, Status FROM dbo.CrmInvoice WHERE BookingId = @b", { b: [sql.Int, bid] });
    console.table(invs);
    check("invoices add up to the sale value", money(invs.reduce((s, i) => s + Number(i.Amount), 0)) === grand, invs);

    console.log("\n[9] Ledger for this sale");
    const gl = await q(`
      SELECT g.VoucherNo, g.SourceType, g.SourceId, h.LHeadName, h.LHeadCode, g.LHeadId, g.DebitAmount, g.CreditAmount
      FROM dbo.GeneralLedgerEntry g JOIN dbo.AccountHeadMaster h ON h.LHeadId = g.LHeadId
      WHERE g.EntryId > @start AND g.ProjectId = @p ORDER BY g.EntryId`, { start: [sql.Int, glStart], p: [sql.Int, PROJECT] });
    console.table(gl);
    const byV = {};
    for (const g of gl) { byV[g.VoucherNo] = byV[g.VoucherNo] || { dr: 0, cr: 0 }; byV[g.VoucherNo].dr += Number(g.DebitAmount); byV[g.VoucherNo].cr += Number(g.CreditAmount); }
    check("every voucher balanced (Dr = Cr)", Object.keys(byV).length >= 3 && Object.values(byV).every((v) => money(v.dr) === money(v.cr)), byV);
    const sum = (rows, f) => money(rows.reduce((s, g) => s + Number(g[f]), 0));
    check("bank debited with the whole sale value", sum(gl.filter((g) => g.LHeadId === BANK), "DebitAmount") === grand, gl.filter((g) => g.LHeadId === BANK));
    check("Sale of Land credited with the whole sale value", sum(gl.filter((g) => g.LHeadCode === "CRM-SALE-LAND"), "CreditAmount") === grand);
    check("nothing to the flat-sale income head", !gl.some((g) => g.LHeadCode === "CRM-SALE-INCOME"));
    check("no GST leg anywhere", !gl.some((g) => /gst/i.test(`${g.LHeadName} ${g.LHeadCode}`)));
    const adv = gl.filter((g) => g.LHeadCode === "ADVC-CUST");
    check("Advance from Customer nets to zero (received, then recognised)", adv.length >= 2 && sum(adv, "CreditAmount") === sum(adv, "DebitAmount"), adv);
  } catch (e) {
    failures++;
    console.error("\nERROR:", e.stack || e.message);
  } finally {
    console.log(`\nRun ids: application ${run.applicationId}, booking ${run.bookingId}`);
    server.close();
    if (!KEEP) {
      for (const p of run.plotRestore) {
        await q("UPDATE dbo.PlotMaster SET AreaSqFt = @a, RatePerSqFt = @r WHERE Id = @id",
          { a: [sql.Decimal(18, 2), p.AreaSqFt], r: [sql.Decimal(18, 2), p.RatePerSqFt], id: [sql.Int, p.Id] });
      }
      if (run.adjacency) await q("DELETE FROM dbo.PlotAdjacency WHERE PlotId = @a AND AdjacentPlotId = @b", { a: [sql.Int, run.adjacency[0]], b: [sql.Int, run.adjacency[1]] });
      if (run.plotRestore.length) console.log(`restored price fields on plots ${run.plotRestore.map((p) => p.Id).join(", ")}`);
      const { cleanup } = require("./e2eCrmPlotLifecycleCleanup");
      try { await cleanup(getPool(), TAG); } catch (e) { failures++; console.error("CLEANUP ERROR:", e.stack || e.message); }
    }
    console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL CHECKS PASSED");
    process.exit(failures ? 1 : 0);
  }
})();
