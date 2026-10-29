// Read-only: for every module the approval engine knows (MODULE_MAP), what
// Approval Setup says about who approves it — before moving to "Approval
// Setup is the only source of approvers". Changes nothing.
//   node scripts/checkApprovalCoverage.js
const { connectDB, getPool, closeDB } = require("../db");
const { MODULE_MAP, getWorkflow } = require("../services/approvalService");

(async () => {
  await connectDB();
  const pool = getPool();
  const ids = new Set();
  const rows = [];
  for (const module of Object.keys(MODULE_MAP).sort()) {
    const wf = await getWorkflow(module).catch(() => null);
    const levels = wf?.LevelDefs ?? [];
    if (!levels.length) { rows.push({ Module: module, Workflow: "NONE — nobody could approve", Level: "", Roles: "", People: "" }); continue; }
    levels.forEach((lv, i) => {
      (lv.userIds || []).forEach((id) => ids.add(Number(id)));
      rows.push({
        Module: i === 0 ? module : "",
        Workflow: i === 0 ? `${wf.Id ?? wf.id ?? ""} ${wf.Name ?? wf.name ?? ""}`.trim() : "",
        Level: `${i + 1} ${lv.label ?? ""}`.trim(),
        Roles: (lv.roles || []).join(", ") || "—",
        People: (lv.userIds || []).join(", ") || "—",
      });
    });
  }
  console.log("\n== Who approves each module per Approval Setup");
  console.table(rows);

  if (ids.size) {
    const users = (await pool.request().query(`
      SELECT u.id, u.name, r.RName AS RoleName FROM dbo.Users u LEFT JOIN dbo.Role r ON r.RId = u.RoleId
      WHERE u.id IN (${[...ids].join(",")}) ORDER BY u.id`)).recordset;
    console.log("\n== People named above");
    console.table(users);
  }
  const roles = (await pool.request().query(`
    SELECT r.RName, COUNT(u.id) AS Users FROM dbo.Role r LEFT JOIN dbo.Users u ON u.RoleId = r.RId GROUP BY r.RName ORDER BY r.RName`)).recordset;
  console.log("\n== Roles and how many users hold each");
  console.table(roles);
  await closeDB();
})().catch(async (e) => { console.error("FAILED:", e.message); try { await closeDB(); } catch (_) {} process.exit(1); });
