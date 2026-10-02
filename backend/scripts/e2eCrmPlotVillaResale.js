"use strict";
/**
 * End-to-end run of the plot -> villa -> resale lifecycle through the real
 * route files:
 *
 *   Plot X: buyer A buys it -> the developer builds a villa on it -> a
 *           stranger cannot buy that villa -> A resells the plot to buyer B
 *           (completing the resale makes B the owner, nothing owed to the
 *           developer) -> A can no longer buy the villa -> B buys it, priced
 *           on construction only -> the plot can't be resold as bare land
 *           any more.
 *   Plot Y: buyer A buys it -> villa built -> A buys the villa directly.
 *
 * JWT is swapped for the given admin user; page rights / role middleware
 * still run. Everything is tagged ZZE2E and removed afterwards (including the
 * villa Unit Master rows and the plots' converted marker); plot fixtures are
 * restored.
 *
 * Run: node backend/scripts/e2eCrmPlotVillaResale.js --project <id> --user <adminUserId> [--keep]
 */
const path = require("path");
const BACKEND = path.join(__dirname, "..");
require(path.join(BACKEND, "config/env")).loadEnv();

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? parseInt(process.argv[i + 1], 10) : NaN; };
const PROJECT = arg("project"), USER = arg("user");
const KEEP = process.argv.includes("--keep");
if (![PROJECT, USER].every(Number.isInteger)) {
  console.error("Usage: node backend/scripts/e2eCrmPlotVillaResale.js --project <id> --user <adminUserId> [--keep]");
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
  app.use("/api/crm/resales", require(path.join(BACKEND, "routes/crmResales")));
  app.use("/api/crm/project-auto-setup", require(path.join(BACKEND, "routes/crmProjectAutoSetup")));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    let data = null; try { data = await res.json(); } catch { /* empty */ }
    return { status: res.status, data };
  };
  const ok = (r) => r.status >= 200 && r.status < 300;

  const run = { plotRestore: [], villaUnitIds: [], resaleIds: [] };
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
    for (const p of plots) {
      await q("UPDATE dbo.PlotMaster SET AreaSqFt = 1500, RatePerSqFt = 2500 WHERE Id = @id", { id: [sql.Int, p.Id] });
    }
    const [X, Y] = plots;
    const today = new Date().toISOString().slice(0, 10);
    const { listLayoutTypes } = require(path.join(BACKEND, "services/unitLayout"));
    const layouts = (await listLayoutTypes(getPool())).filter((l) => Number(l.roomCount ?? l.RoomCount ?? 0) > 0);
    if (!layouts.length) throw new Error("no unit layout type with rooms configured");
    const unitType = layouts[0].label ?? layouts[0].Label;

    const customer = async (name) => {
      const r = await call("POST", "/api/crm/customers", { CustomerName: `${TAG} ${name}`, Mobile: null });
      return r.data?.id ?? r.data?.Id ?? r.data?.customer?.Id ?? null;
    };
    const buyPlot = async (customerId, plot) => {
      const r = await call("POST", "/api/crm/applications", { CustomerId: customerId, ProjectId: PROJECT, PreferredPlotIds: [plot.Id], Source: "WalkIn", DateOfApply: today, Notes: TAG });
      if (r.status !== 201) return { error: r };
      await call("PUT", `/api/crm/applications/${r.data.id}/submit`, {});
      const bk = (await q("SELECT Id FROM dbo.CrmBooking WHERE ApplicationId = @a AND IsActive = 1", { a: [sql.Int, r.data.id] }))[0];
      return { applicationId: r.data.id, bookingId: bk?.Id ?? null };
    };
    const applyForVilla = (customerId, unitId) => call("POST", "/api/crm/applications", {
      CustomerId: customerId, ProjectId: PROJECT, PreferredUnitIds: [unitId], RatePerSqFt: null, Source: "WalkIn", DateOfApply: today, Notes: TAG,
    });
    const convert = (plot, name, body = {}) => call("POST", "/api/crm/project-auto-setup/plots/convert", {
      PlotIds: [plot.Id], UnitName: `${TAG} ${name}`, UnitType: unitType, UnitKind: "VILLA", ...body,
    });

    const A = await customer("Buyer A"), B = await customer("Buyer B"), C = await customer("Stranger C");
    check("three customers", A && B && C, { A, B, C });

    console.log("\n[1] Buyer A buys plots X and Y");
    const ax = await buyPlot(A, X), ay = await buyPlot(A, Y);
    check("A holds X and Y under land bookings", ax.bookingId && ay.bookingId, { ax, ay });

    console.log("\n[2] The developer builds villas on the SOLD plots");
    let r = await convert(X, "Villa X");
    check("conversion without a construction rate is refused (no land-rate fallback)", r.status === 400 && /construction rate/i.test(r.data?.error || ""), r);
    r = await convert(X, "Villa X", { RatePerSqFt: 3000, AreaSqFt: 1800 });
    check("villa built on sold plot X", r.status === 201 && r.data?.UnitId, r);
    const villaX = r.data?.UnitId; if (villaX) run.villaUnitIds.push(villaX);
    r = await convert(Y, "Villa Y", { RatePerSqFt: 3000, AreaSqFt: 1800 });
    const villaY = r.data?.UnitId; if (villaY) run.villaUnitIds.push(villaY);
    check("villa built on sold plot Y", r.status === 201 && villaY, r);
    const vx = (await q("SELECT AreaSqFt, RatePerSqFt FROM dbo.UnitMaster WHERE Id = @u", { u: [sql.Int, villaX || 0] }))[0];
    check("villa priced on its construction rate and built-up area", vx && Number(vx.RatePerSqFt) === 3000 && Number(vx.AreaSqFt) === 1800, vx);
    const landStill = (await q("SELECT COUNT(*) n FROM dbo.CrmBookingPlot WHERE BookingId = @b AND PlotId = @p AND Status = N'Active'", { b: [sql.Int, ax.bookingId], p: [sql.Int, X.Id] }))[0].n;
    check("A still owns plot X after the villa is built", landStill === 1);

    console.log("\n[3] Only the plot's owner can buy its villa");
    r = await applyForVilla(C, villaX);
    check("a stranger is refused villa X", r.status === 409 && /only the plot's owner/i.test(r.data?.error || ""), r);

    console.log("\n[4] Branch 1 — A buys villa Y directly (separate booking)");
    r = await applyForVilla(A, villaY);
    check("A's application for villa Y accepted", r.status === 201, r);
    if (r.data?.id) {
      const sub = await call("PUT", `/api/crm/applications/${r.data.id}/submit`, {});
      const vb = (await q(`SELECT b.Id, b.UnitId, b.TotalValue, b.UnitParkingGstRate, b.HsnCode,
          CAST(CASE WHEN EXISTS (SELECT 1 FROM dbo.CrmBookingPlot bp WHERE bp.BookingId = b.Id) THEN 1 ELSE 0 END AS BIT) AS HasPlotLines
        FROM dbo.CrmBooking b WHERE b.ApplicationId = @a AND b.IsActive = 1`, { a: [sql.Int, r.data.id] }))[0];
      check("villa Y booked for A as its own booking", ok(sub) && vb?.UnitId === villaY && !vb.HasPlotLines, { sub: sub.data, vb });
      check("villa price is construction only (1,800 sq ft × ₹3,000), land not charged again", money(vb?.TotalValue) === 1800 * 3000, vb);
      console.log(`  villa Y GST: HSN ${vb?.HsnCode}, rate ${vb?.UnitParkingGstRate}%`);
      const plotYStill = (await q("SELECT COUNT(*) n FROM dbo.CrmBookingPlot WHERE BookingId = @b AND PlotId = @p AND Status = N'Active'", { b: [sql.Int, ay.bookingId], p: [sql.Int, Y.Id] }))[0].n;
      check("A's land booking for Y is untouched", plotYStill === 1);
    }

    console.log("\n[5] Branch 2 — A resells plot X to buyer B");
    r = await call("POST", "/api/crm/resales", { PlotId: X.Id, ToCustomerId: B, AgreedValue: 4500000, DeveloperFeeAmount: 25000, ResaleDate: today, Notes: TAG });
    const resaleId = r.data?.id; if (resaleId) run.resaleIds.push(resaleId);
    check("resale recorded", r.status === 201 && resaleId, r);
    r = await call("PUT", `/api/crm/resales/${resaleId}/complete`, {});
    check("resale completes without B needing a booking first", ok(r) && r.data?.holdingCreated === true && r.data?.ToBookingId, r);
    const holdId = r.data?.ToBookingId;
    const hold = (await q(`SELECT b.TotalValue, b.GrandTotal, b.Status, a.CustomerId,
        (SELECT COUNT(*) FROM dbo.CrmPaymentMilestone m WHERE m.BookingId = b.Id) AS Milestones
      FROM dbo.CrmBooking b JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId WHERE b.Id = @b`, { b: [sql.Int, holdId || 0] }))[0];
    check("B owns plot X: nothing owed to the developer, no schedule", hold && hold.CustomerId === B && money(hold.TotalValue) === 0 && money(hold.GrandTotal) === 0 && hold.Milestones === 0 && hold.Status === "Approved", hold);
    const lines = await q("SELECT BookingId, Status FROM dbo.CrmBookingPlot WHERE PlotId = @p ORDER BY Id", { p: [sql.Int, X.Id] });
    check("A's line Transferred, B's line Active", lines.some((l) => l.BookingId === ax.bookingId && l.Status === "Transferred") && lines.some((l) => l.BookingId === holdId && l.Status === "Active"), lines);
    const aOriginal = (await q("SELECT Status, TotalValue FROM dbo.CrmBooking WHERE Id = @b", { b: [sql.Int, ax.bookingId] }))[0];
    check("A's original sale stands (not cancelled)", aOriginal.Status !== "Cancelled", aOriginal);

    console.log("\n[6] After the resale only B can buy villa X");
    r = await applyForVilla(A, villaX);
    check("A (the seller) is now refused villa X", r.status === 409, r);
    r = await applyForVilla(B, villaX);
    check("B's application for villa X accepted", r.status === 201, r);
    if (r.data?.id) {
      await call("PUT", `/api/crm/applications/${r.data.id}/submit`, {});
      const vb = (await q("SELECT UnitId, TotalValue FROM dbo.CrmBooking WHERE ApplicationId = @a AND IsActive = 1", { a: [sql.Int, r.data.id] }))[0];
      check("villa X booked for B at construction price", vb?.UnitId === villaX && money(vb.TotalValue) === 1800 * 3000, vb);
    }

    console.log("\n[7] A plot with a booked villa can't be resold as bare land");
    r = await call("POST", "/api/crm/resales", { PlotId: X.Id, ToCustomerId: C, AgreedValue: 1, ResaleDate: today, Notes: TAG });
    if (r.data?.id) run.resaleIds.push(r.data.id);
    check("resale of plot X refused once its villa is booked", r.status === 409 && /villa on this plot is already booked/i.test(r.data?.error || ""), r);
  } catch (e) {
    failures++;
    console.error("\nERROR:", e.stack || e.message);
  } finally {
    server.close();
    if (!KEEP) {
      // Resales and villa units first (they reference bookings / plots), then the tagged CRM data.
      if (run.resaleIds.length) await q(`DELETE FROM dbo.CrmUnitResale WHERE Id IN (${run.resaleIds.join(",")})`);
      const { cleanup } = require("./e2eCrmPlotLifecycleCleanup");
      try { await cleanup(getPool(), TAG); } catch (e) { failures++; console.error("CLEANUP ERROR:", e.stack || e.message); }
      for (const p of run.plotRestore) {
        await q("UPDATE dbo.PlotMaster SET AreaSqFt = @a, RatePerSqFt = @r, ConvertedUnitId = NULL, ConvertedAt = NULL WHERE Id = @id",
          { a: [sql.Decimal(18, 2), p.AreaSqFt], r: [sql.Decimal(18, 2), p.RatePerSqFt], id: [sql.Int, p.Id] });
      }
      if (run.villaUnitIds.length) {
        const ids = run.villaUnitIds.join(",");
        // syncUnitRooms gave each villa its rooms; they go with it.
        for (const t of ["RoomLayoutOverride", "RoomMaster"]) {
          await q(`DELETE FROM dbo.${t} WHERE UnitId IN (${ids})`).catch((e) => { failures++; console.error(`${t} cleanup:`, e.message); });
        }
        await q(`DELETE FROM dbo.UnitMaster WHERE Id IN (${ids}) AND UnitName LIKE '${TAG}%'`).catch((e) => { failures++; console.error("villa cleanup:", e.message); });
      }
      console.log(`restored plots ${run.plotRestore.map((p) => p.Id).join(", ")}; removed villas ${run.villaUnitIds.join(", ") || "none"}`);
    }
    console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL CHECKS PASSED");
    process.exit(failures ? 1 : 0);
  }
})();
