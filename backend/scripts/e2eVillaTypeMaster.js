"use strict";
/**
 * End-to-end check of the villa type master (migration 525) through the real
 * routes: create a type, plan it on a plot, convert that plot naming only the
 * type, and confirm the villa takes the type's areas and records the type.
 * Also checks the guards (built-up required, SBU >= built-up, a type of another
 * project refused, removal blocked while a plot plans the type).
 *
 * Everything is tagged ZZE2E and removed afterwards; the plot is restored.
 *
 * Run: node backend/scripts/e2eVillaTypeMaster.js --project <id> --user <adminUserId>
 */
const path = require("path");
const BACKEND = path.join(__dirname, "..");
require(path.join(BACKEND, "config/env")).loadEnv();

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? parseInt(process.argv[i + 1], 10) : NaN; };
const PROJECT = arg("project"), USER = arg("user");
if (![PROJECT, USER].every(Number.isInteger)) {
  console.error("Usage: node backend/scripts/e2eVillaTypeMaster.js --project <id> --user <adminUserId>");
  process.exit(2);
}
const TAG = "ZZE2E";
const authPath = require.resolve(path.join(BACKEND, "middleware/auth"));
const express = require("express");
const { connectDB, getPool, sql } = require(path.join(BACKEND, "db"));

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  PASS  ${name}`);
  else { failures++; console.log(`  FAIL  ${name}`, extra !== undefined ? JSON.stringify(extra).slice(0, 600) : ""); }
};

(async () => {
  await connectDB();
  const q = async (t, i = {}) => { const r = getPool().request(); for (const [k, [ty, v]] of Object.entries(i)) r.input(k, ty, v); return (await r.query(t)).recordset; };
  const u = (await q("SELECT u.id, u.email, u.name, r.RName, u.RoleId FROM dbo.Users u JOIN dbo.Role r ON r.RId = u.RoleId WHERE u.id = @id", { id: [sql.Int, USER] }))[0];
  if (!u) { console.error("user not found"); process.exit(2); }
  const ADMIN = { userId: u.id, id: u.id, email: u.email, name: u.name, role: u.RName, roleId: u.RoleId };
  require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: (req, _r, next) => { req.user = { ...ADMIN }; next(); } };

  const app = express();
  app.use(express.json());
  app.use((req, _r, next) => { req.user = { ...ADMIN }; next(); });
  app.use("/api/villa-type-master", require(path.join(BACKEND, "routes/villaTypeMaster")));
  app.use("/api/plot-master", require(path.join(BACKEND, "routes/plotMaster")));
  app.use("/api/crm/project-auto-setup", require(path.join(BACKEND, "routes/crmProjectAutoSetup")));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };

  const plot = (await q(`
    SELECT TOP 1 p.Id, p.PlannedVillaTypeId FROM dbo.PlotMaster p
    WHERE p.ProjectId = @p AND p.IsActive = 1 AND p.ConvertedUnitId IS NULL
      AND NOT EXISTS (SELECT 1 FROM dbo.CrmBookingPlot bp WHERE bp.PlotId = p.Id AND bp.Status = N'Active')
      AND NOT EXISTS (SELECT 1 FROM dbo.CrmApplicationPlot ap WHERE ap.PlotId = p.Id AND ap.Status = N'Active')
      AND NOT EXISTS (SELECT 1 FROM dbo.CrmInventoryHold h WHERE h.EntityType = N'Plot' AND h.EntityId = p.Id AND h.Status = N'Active')
    ORDER BY p.Id`, { p: [sql.Int, PROJECT] }))[0];
  if (!plot) { console.error("no free plot in the project"); process.exit(2); }
  const otherProject = (await q("SELECT TOP 1 id FROM dbo.enterprise WHERE id <> @p ORDER BY id", { p: [sql.Int, PROJECT] }))[0]?.id;
  const unitType = (await q(`SELECT TOP 1 t.Label FROM dbo.RoomLayoutType t WHERE t.IsActive = 1
    AND EXISTS (SELECT 1 FROM dbo.RoomLayoutComposition c WHERE c.LayoutTypeId = t.Id) ORDER BY t.SortOrder`).catch(() => []))[0]?.Label
    ?? (await q("SELECT TOP 1 UnitType FROM dbo.UnitMaster WHERE UnitType IS NOT NULL AND IsActive = 1"))[0]?.UnitType;

  let typeId = null, foreignTypeId = null, unitId = null;
  try {
    let r = await call("POST", "/api/villa-type-master", { ProjectId: PROJECT, Code: `${TAG}4`, Name: `${TAG} Villa Type 4`, BaseLandAreaSqFt: 1591.11, BuiltUpAreaSqFt: "" });
    check("built-up area is required", r.status === 400, r);
    r = await call("POST", "/api/villa-type-master", { ProjectId: PROJECT, Code: `${TAG}4`, Name: `${TAG} Villa Type 4`, BuiltUpAreaSqFt: 2286.72, SuperBuiltUpAreaSqFt: 2000 });
    check("super built-up below built-up refused", r.status === 400, r);
    r = await call("POST", "/api/villa-type-master", { ProjectId: PROJECT, Code: `${TAG}4`, Name: `${TAG} Villa Type 4`, BaseLandAreaSqFt: 1591.11, BuiltUpAreaSqFt: 2286.72, SuperBuiltUpAreaSqFt: 2600 });
    check("villa type created", r.status === 201, r);
    typeId = r.body.id;
    r = await call("POST", "/api/villa-type-master", { ProjectId: PROJECT, Code: `${TAG}4`, Name: "dup", BuiltUpAreaSqFt: 100 });
    check("duplicate code in the project refused", r.status === 409, r);
    r = await call("GET", `/api/villa-type-master?projectId=${PROJECT}`);
    check("listed for the project", r.status === 200 && r.body.some((t) => t.Id === typeId && Number(t.BuiltUpAreaSqFt) === 2286.72), r.status);

    if (otherProject) {
      r = await call("POST", "/api/villa-type-master", { ProjectId: otherProject, Code: `${TAG}X`, Name: `${TAG} other`, BuiltUpAreaSqFt: 1000 });
      foreignTypeId = r.body.id;
      r = await call("PUT", "/api/plot-master/planned-villa-type", { PlotIds: [plot.Id], VillaTypeId: foreignTypeId });
      check("a type of another project cannot be planned", r.status === 400, r);
    }

    r = await call("PUT", "/api/plot-master/planned-villa-type", { PlotIds: [plot.Id], VillaTypeId: typeId });
    check("type planned on the plot", r.status === 200 && r.body.updated === 1, r);
    r = await call("GET", `/api/plot-master/${plot.Id}`);
    check("plot shows its planned type", r.body.PlannedVillaTypeId === typeId && r.body.PlannedVillaTypeCode === `${TAG}4`, r.body);
    r = await call("DELETE", `/api/villa-type-master/${typeId}`);
    check("removal blocked while a plot plans the type", r.status === 400, r);

    const other = (await q("SELECT TOP 1 Id FROM dbo.PlotMaster WHERE ProjectId = @p AND IsActive = 1 AND ConvertedUnitId IS NULL AND Id <> @id", { p: [sql.Int, PROJECT], id: [sql.Int, plot.Id] }))[0];
    if (other) {
      r = await call("POST", "/api/crm/project-auto-setup/plots/convert", {
        PlotIds: [plot.Id, other.Id], UnitName: `${TAG} Merge`, UnitType: unitType, UnitKind: "VILLA", RatePerSqFt: 3000, VillaTypeId: typeId,
      });
      check("several plots are not merged without Combine", r.status === 400 && /Combine/.test(r.body.error || ""), r);
    }
    r = await call("POST", "/api/crm/project-auto-setup/plots/convert", {
      PlotIds: [plot.Id], UnitName: `${TAG} Villa VT`, UnitType: unitType, UnitKind: "VILLA", RatePerSqFt: 3000, VillaTypeId: typeId,
    });
    check("converted naming only the villa type", r.status === 200 || r.status === 201, r);
    const unit = (await q("SELECT Id, AreaSqFt, BuiltUpAreaSqFt, SuperBuiltUpAreaSqFt, VillaTypeId FROM dbo.UnitMaster WHERE UnitName = @n AND IsActive = 1", { n: [sql.NVarChar, `${TAG} Villa VT`] }))[0];
    unitId = unit?.Id ?? null;
    check("villa takes the type's areas (BU 2286.72, SBU 2600 = saleable area) and records the type",
      unit && Number(unit.BuiltUpAreaSqFt) === 2286.72 && Number(unit.SuperBuiltUpAreaSqFt) === 2600 && Number(unit.AreaSqFt) === 2600 && unit.VillaTypeId === typeId, unit);

    r = await call("PUT", `/api/villa-type-master/${typeId}`, { Code: `${TAG}4`, Name: `${TAG} Villa Type 4`, BuiltUpAreaSqFt: 2300 });
    const after = (await q("SELECT BuiltUpAreaSqFt FROM dbo.UnitMaster WHERE Id = @id", { id: [sql.Int, unitId ?? 0] }))[0];
    check("editing the type leaves the built villa unchanged", r.status === 200 && after && Number(after.BuiltUpAreaSqFt) === 2286.72, { r, after });
  } finally {
    if (unitId) {
      await q("DELETE FROM dbo.RoomMaster WHERE UnitId = @id", { id: [sql.Int, unitId] }).catch(() => {});
      await q("UPDATE dbo.PlotMaster SET ConvertedUnitId = NULL, ConvertedAt = NULL WHERE ConvertedUnitId = @id", { id: [sql.Int, unitId] });
      await q("DELETE FROM dbo.UnitMaster WHERE Id = @id", { id: [sql.Int, unitId] }).catch((e) => console.log("unit cleanup:", e.message));
    }
    await q("UPDATE dbo.PlotMaster SET PlannedVillaTypeId = @v WHERE Id = @id", { id: [sql.Int, plot.Id], v: [sql.Int, plot.PlannedVillaTypeId] });
    await q(`DELETE FROM dbo.VillaTypeMaster WHERE Code LIKE '${TAG}%'`);
    server.close();
    console.log(failures ? `${failures} FAILURE(S)` : "ALL CHECKS PASSED");
    process.exit(failures ? 1 : 0);
  }
})().catch((e) => { console.error(e); process.exit(1); });
