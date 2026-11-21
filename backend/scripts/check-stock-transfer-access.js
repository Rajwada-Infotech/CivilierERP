// Read-only: why can't a user make a Stock Transfer? Runs the server's own checks for that user.
//   NAME=<part of the user's name or email>
const { connectDB, getPool, sql } = require("../db");

(async () => {
  await connectDB();
  const pool = getPool();
  const { checkPermission, getEffectivePagePermissions } = require("../middleware/permissions");
  const { requirePageRight } = require("../middleware/requirePageRight");
  const { normalizeRole, hasFullAccess } = require("../middleware/role");
  const { getProjectScope } = require("../services/projectScope");

  const name = process.env.NAME;
  if (!name) throw new Error("Set NAME=<user name>");
  const users = (await pool.request().input("q", sql.NVarChar(200), `%${name}%`).query(`
    SELECT u.id, u.name, u.email, u.RoleId, r.RName, u.discontinue
    FROM dbo.users u LEFT JOIN dbo.Role r ON r.RId = u.RoleId
    WHERE u.name LIKE @q OR u.email LIKE @q`)).recordset;
  if (!users.length) { console.log("No user matches", name); process.exit(0); }

  // Runs one Express middleware with a fake request and reports pass / the status it refused with.
  const run = (mw, user) => new Promise((resolve) => {
    const req = { user, method: "POST", path: "/", headers: {} };
    const res = { status(c) { this.code = c; return this; }, json(b) { resolve(`REFUSED ${this.code} ${JSON.stringify(b)}`); } };
    Promise.resolve(mw(req, res, () => resolve("ok"))).catch((e) => resolve(`ERROR ${e.message}`));
  });

  for (const u of users) {
    const role = normalizeRole(u.RName);
    const user = { userId: u.id, id: u.id, roleId: u.RoleId, role, email: u.email, name: u.name };
    console.log(`\n=== ${u.name} <${u.email}>  id ${u.id} · role "${u.RName}" (${role}, roleId ${u.RoleId})${u.discontinue ? " · DISCONTINUED" : ""}`);
    if (hasFullAccess(role)) console.log("Full-access role: every rights check passes.");

    console.log("\n-- Old check: module right Material / StockTransfer (never saved by the rights screens; removed by the fix) --");
    for (const a of ["CanView", "CanAdd", "CanEdit"]) console.log(`  ${a.padEnd(8)} ${await run(checkPermission("Material", "StockTransfer", a), user)}`);

    console.log("\n-- Stock Transfer page right (what the fix checks: Role + Menu Rights) --");
    for (const a of ["view", "create", "edit"]) console.log(`  ${a.padEnd(8)} ${await run(requirePageRight("stock-transfers", a), user)}`);

    const eff = await getEffectivePagePermissions(u.id, u.RoleId);
    const related = eff.filter((r) => /transfer|godown|stock/i.test(String(r?.page || "")));
    console.log("\n-- Rights he has on stock / transfer / godown pages --");
    if (!related.length) console.log("  (none)");
    for (const r of related) console.log(`  ${String(r.page).padEnd(32)} ${(r.actions || []).join(", ")}`);

    console.log("\n-- Project access (source godown must be in one of these) --");
    const scope = await getProjectScope(user);
    if (scope === null) console.log("  Unrestricted (all projects)");
    else if (!scope.length) console.log("  NONE");
    else {
      const ps = (await pool.request().query(`SELECT id AS ProjectId, name AS ProjectName FROM dbo.enterprise WHERE id IN (${scope.map(Number).join(",")})`).catch(() => ({ recordset: [] }))).recordset;
      const names = new Map(ps.map((p) => [Number(p.ProjectId), p.ProjectName]));
      for (const id of scope) console.log(`  ${id}  ${names.get(Number(id)) || ""}`);
    }
    const gd = (await pool.request().query(`
      SELECT g.GodownID, g.GodownName, g.ProjectID, g.IsActive
      FROM dbo.Godowns g WHERE g.IsDeleted = 0 ${scope ? `AND g.ProjectID IN (${scope.length ? scope.map(Number).join(",") : "NULL"})` : ""}
      ORDER BY g.GodownName`)).recordset;
    console.log(`\n-- Godowns he can transfer out of: ${gd.length} --`);
    for (const g of gd) console.log(`  ${String(g.GodownID).padEnd(6)} ${g.GodownName}${g.IsActive === false || g.IsActive === 0 ? "  (inactive)" : ""}  project ${g.ProjectID ?? "-"}`);

    const st = (await pool.request().input("e", sql.NVarChar(255), u.email).query(`
      SELECT TOP 10 st.TransferID, st.DocNo, st.TransferDate, st.Status, fg.GodownName AS FromG, tg.GodownName AS ToG, st.CreatedAt
      FROM dbo.StockTransfers st
      LEFT JOIN dbo.Godowns fg ON fg.GodownID = st.FromGodownID
      LEFT JOIN dbo.Godowns tg ON tg.GodownID = st.ToGodownID
      WHERE st.CreatedBy = @e ORDER BY st.TransferID DESC`)).recordset;
    console.log(`\n-- His last stock transfers: ${st.length} --`);
    for (const t of st) console.log(`  ${t.DocNo}  ${t.Status}  ${t.FromG} -> ${t.ToG}  created ${new Date(t.CreatedAt).toISOString().slice(0, 16)}`);
  }
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
