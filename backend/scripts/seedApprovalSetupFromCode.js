// Step 2 of "Approval Setup is the only source of approvers".
//
// For every approval module (MODULE_MAP) that has NO active workflow, write
// one into Approval Setup that copies who the code lets approve it TODAY:
// MODULE_APPROVER_ROLE_OVERRIDES[module], else APPROVER_ROLES — read from
// services/approvalService.js, never retyped here. Modules with the same
// role set share one workflow. Behaviour is unchanged after --apply; the
// rules simply become visible and editable on the Approval Setup page.
//
// It also REPORTS (writes nothing for) the two things roles can't carry
// over, so they can be decided on the page before the code lists go:
//   - people who approve today only via the Menu Rights fallback
//     ("edit" on the Approval Inbox page);
//   - for modules that already have a workflow, admin / super_admin users
//     who approve today only through the code bypass.
//
//   node scripts/seedApprovalSetupFromCode.js           dry run (default)
//   node scripts/seedApprovalSetupFromCode.js --apply   write
const { connectDB, getPool, closeDB, sql } = require("../db");
const {
  MODULE_MAP, getWorkflow, APPROVER_ROLES, MODULE_APPROVER_ROLE_OVERRIDES, WORKFLOW_ID_MAP,
} = require("../services/approvalService");
// The id Approval Setup and getWorkflow() use for a module (e.g. boq -> BOQ).
const setupId = (module) => WORKFLOW_ID_MAP[module] || module;
// Every approval gate the code knows: engine modules plus the CRM gates that
// only have a role list (registry, mutation, query payment...).
const ALL_MODULES = [...new Set([...Object.keys(MODULE_MAP), ...Object.keys(MODULE_APPROVER_ROLE_OVERRIDES)])].sort();
const { userHasEffectivePageRight } = require("../middleware/permissions");
const { bumpCacheVersion } = require("../redis");

const APPLY = process.argv.includes("--apply");
const CREATED_BY = "seedApprovalSetupFromCode";

(async () => {
  await connectDB();
  const pool = getPool();
  const q = async (s) => (await pool.request().query(s)).recordset;

  const roleRows = await q(`SELECT RId, RName FROM dbo.Role`);
  const roleByLower = new Map(roleRows.map((r) => [r.RName.toLowerCase(), r.RName]));

  // 0. Repair rows an earlier run of this script wrote under the code's
  //    module name instead of the Approval Setup id (boq instead of BOQ).
  const seeded = await q(`SELECT Id, modules FROM dbo.ApprovalWorkflows WHERE CreatedBy = '${CREATED_BY}'`);
  const repairs = [];
  for (const row of seeded) {
    const mods = JSON.parse(row.modules || "[]");
    const fixed = [...new Set(mods.map(setupId))];
    if (JSON.stringify(fixed) !== JSON.stringify(mods)) repairs.push({ Id: row.Id, From: mods.join(", "), To: fixed.join(", "), fixed });
  }
  console.log(`\n== Earlier seeded workflows with wrong module ids (${repairs.length})`);
  if (repairs.length) console.table(repairs.map(({ fixed, ...r }) => r));
  if (APPLY && repairs.length) {
    for (const r of repairs) {
      await pool.request().input("id", sql.Int, r.Id).input("m", sql.NVarChar(sql.MAX), JSON.stringify(r.fixed))
        .input("first", sql.NVarChar(100), r.fixed[0])
        .query(`UPDATE dbo.ApprovalWorkflows SET modules = @m, Module = @first WHERE Id = @id`);
    }
    console.log(`Repaired ${repairs.length}.`);
  }

  // 1. Modules with no workflow -> grouped by today's role set.
  const groups = new Map();
  const missingRoles = new Set();
  const withWorkflow = [];
  for (const module of ALL_MODULES) {
    const wf = await getWorkflow(module).catch(() => null);
    if (wf?.LevelDefs?.length) { withWorkflow.push({ module, wf }); continue; }
    const codeRoles = MODULE_APPROVER_ROLE_OVERRIDES[module] ?? APPROVER_ROLES;
    const roles = [];
    for (const r of codeRoles) {
      const real = roleByLower.get(String(r).toLowerCase());
      if (real) roles.push(real); else missingRoles.add(r);
    }
    const key = roles.map((r) => r.toLowerCase()).sort().join("|");
    if (!groups.has(key)) groups.set(key, { roles, modules: [] });
    const id = setupId(module);
    if (!groups.get(key).modules.includes(id)) groups.get(key).modules.push(id);
  }

  console.log(`\n${APPLY ? "APPLY" : "DRY RUN"} — workflows to create (one level each, roles as the code allows today)`);
  console.table([...groups.values()].map((g) => ({ Roles: g.roles.join(", ") || "(none exist!)", Modules: g.modules.join(", ") })));
  if (missingRoles.size) console.log(`Roles named in the code that don't exist here (left out): ${[...missingRoles].join(", ")}`);

  // 2. Report: people who approve today only through Menu Rights.
  const users = await q(`SELECT u.id, u.name, u.RoleId, r.RName FROM dbo.Users u LEFT JOIN dbo.Role r ON r.RId = u.RoleId
                         WHERE LOWER(ISNULL(r.RName,'')) NOT IN ('supplier','customer')`);
  const viaPageRight = [];
  for (const u of users) {
    if (APPROVER_ROLES.includes(String(u.RName || "").toLowerCase())) continue;
    if (await userHasEffectivePageRight(u.id, u.RoleId, "approval-inbox", "edit").catch(() => false)) {
      viaPageRight.push({ id: u.id, name: u.name, role: u.RName });
    }
  }
  console.log(`\n== People who approve today only via Menu Rights (Approval Inbox edit) — add them on the page if they should keep it`);
  console.table(viaPageRight.length ? viaPageRight : [{ id: "-", name: "nobody", role: "-" }]);

  // 3. Report: admins/super admins not named on modules that already have a workflow.
  const admins = users.filter((u) => ["admin", "super_admin"].includes(String(u.RName || "").toLowerCase()));
  const losses = [];
  for (const { module, wf } of withWorkflow) {
    wf.LevelDefs.forEach((lv, i) => {
      const lvRoles = (lv.roles || []).map((r) => String(r).toLowerCase());
      const lvUsers = (lv.userIds || []).map(Number);
      const out = admins.filter((a) => !lvRoles.includes(String(a.RName).toLowerCase()) && !lvUsers.includes(a.id));
      if (out.length) losses.push({ Module: module, Level: `${i + 1} ${lv.label ?? ""}`.trim(), "Admins not on it": out.map((a) => `${a.id} ${a.name}`).join("; ") });
    });
  }
  console.log(`\n== Existing workflows: admins who approve there today only through the code bypass`);
  console.table(losses.length ? losses : [{ Module: "-", Level: "-", "Admins not on it": "none" }]);

  if (!APPLY) {
    console.log("\nNothing written. Re-run with --apply to create the workflows above.");
    await closeDB();
    return;
  }

  const tx = pool.transaction();
  await tx.begin();
  try {
    for (const g of groups.values()) {
      if (!g.roles.length) continue;
      const levels = [{ id: 1, label: "Approval", mode: "any", roles: g.roles, userIds: [] }];
      await tx.request()
        .input("Name", sql.NVarChar(255), `Carried over from code — ${g.roles.join(", ")}`)
        .input("type", sql.NVarChar(50), "sequential")
        .input("modules", sql.NVarChar(sql.MAX), JSON.stringify(g.modules))
        .input("LevelsData", sql.NVarChar(sql.MAX), JSON.stringify(levels))
        .input("CreatedBy", sql.NVarChar(100), CREATED_BY)
        .input("Module", sql.NVarChar(100), g.modules[0])
        .input("LevelCount", sql.Int, levels.length)
        .query(`INSERT INTO dbo.ApprovalWorkflows
                  (Name, type, modules, LevelsData, active, CreatedBy, CreatedAt, Module, Levels, Status)
                VALUES (@Name, @type, @modules, @LevelsData, 1, @CreatedBy, SYSDATETIME(), @Module, @LevelCount, 'Active')`);
    }
    await tx.commit();
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }
  await bumpCacheVersion("approval-workflows").catch(() => {});
  console.log(`\nDone — ${[...groups.values()].filter((g) => g.roles.length).length} workflow(s) created.`);
  await closeDB();
})().catch(async (e) => { console.error("FAILED:", e.message); try { await closeDB(); } catch (_) {} process.exit(1); });
