"use strict";
// Legal notifications (bell + phone): to the users named for a role in Setup → Approval Control, or to given users.
// Never throws — a failed notification never blocks the work that triggered it.
const { emitNotification } = require("./notify");

const STAGES = { Verifier: ["Verifier"], Approver: ["Approver", "L1 Approver", "L2 Approver"], "Amendment Approver": ["Amendment Approver"], "Legal Reviewer": ["Legal Reviewer"] };

async function roleUsers(pool, role) {
  const stages = STAGES[role] || [role];
  try {
    const r = await pool.request().input("S", stages.join("|")).query(
      "SELECT DISTINCT ApproverId AS id FROM dbo.LegalApprovalAuthority WHERE IsActive = 1 AND Stage IN (SELECT value FROM STRING_SPLIT(@S, '|'))");
    return r.recordset.map((x) => x.id);
  } catch { return []; }
}

/** notify(pool, { roles: ["Verifier"], users: [id…], except: id, type, title, body, refId, refType }) */
async function notify(pool, { roles = [], users = [], except = null, type, title, body, refId = null, refType = "legal_land" }) {
  try {
    const ids = new Set(users.filter(Boolean).map(Number));
    for (const r of roles) for (const id of await roleUsers(pool, r)) ids.add(Number(id));
    if (except) ids.delete(Number(except));
    for (const id of ids) await emitNotification(pool, id, type, title, body, refId, refType, { push: true }).catch(() => {});
  } catch (e) { console.error("[legal-notify]", type, e.message); }
}

module.exports = { notify, roleUsers };
