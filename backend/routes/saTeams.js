const express = require("express");
const { parseId } = require("../middleware/validateRequest");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const apiRateLimit = require("../middleware/apiRateLimit");
const { requirePageRight } = require("../middleware/requirePageRight");
const { isSaAdmin, actorId } = require("../services/saAccess");
const { CLOSED_LEAD_SQL, distributableStatus } = require("../constants/saStatuses");

router.use(apiRateLimit);
router.use(authMiddleware);
router.use(apiRateLimit);

// Sales teams master: a team is a record of its own — "Team A, led by X,
// members Y and Z" (dbo.SaTeam, migration 581). Membership rows stay in
// dbo.SaSalesTeam (TeamId + TeamLeadUserId) because every lead-scope query
// in SA reads TeamLeadUserId.
//
// Who may do what: SA admins manage every team. A non-admin team lead may
// only change the members of their own team (not its lead), and may not
// create or delete teams.
//
// Leads follow the person. A team change is never just a roster change —
// open leads (not Booking / Converted / Lost) move with it, in the same
// transaction:
//   member joins a team (new, or from another team) → their leads take the new lead
//   member leaves a team                             → their leads go back to the
//                                                      team lead for redistribution
//   team changes lead                                → the team's leads move to the new lead
//   team deleted                                     → members leave (as above); the
//                                                      lead keeps leads still waiting
//                                                      to be handed out

const openLeads = `Status NOT IN ${CLOSED_LEAD_SQL}`;

async function inTransaction(pool, work) {
  const tx = pool.transaction();
  await tx.begin();
  try {
    const out = await work(tx);
    await tx.commit();
    return out;
  } catch (e) {
    await tx.rollback();
    throw e;
  }
}

const badRequest = (message) => Object.assign(new Error(message), { status: 400 });

async function moveMemberLeads(tx, memberId, teamLeadId) {
  await tx.request().input("mid", sql.Int, memberId).input("tlid", sql.Int, teamLeadId).query(`
    UPDATE dbo.SaLead SET AssignedTeamLeadId = @tlid, UpdatedAt = SYSDATETIME()
    WHERE AssignedSalespersonId = @mid AND IsActive = 1 AND ${openLeads}
  `);
}

async function releaseMemberLeads(tx, memberId) {
  await tx.request()
    .input("mid", sql.Int, memberId)
    .input("lvl1", sql.NVarChar(30), distributableStatus(1))
    .input("lvl2", sql.NVarChar(30), distributableStatus(2))
    .query(`
      UPDATE dbo.SaLead
      SET AssignedSalespersonId = NULL,
          Status = CASE WHEN AssignedTeamLeadId IS NULL THEN @lvl1 ELSE @lvl2 END,
          UpdatedAt = SYSDATETIME()
      WHERE AssignedSalespersonId = @mid AND IsActive = 1 AND ${openLeads}
    `);
}

async function addMember(tx, team, memberId, actor) {
  await tx.request().input("mid", sql.Int, memberId)
    .query("UPDATE dbo.SaSalesTeam SET IsActive = 0, UpdatedAt = SYSDATETIME() WHERE MemberUserId = @mid AND IsActive = 1");
  await tx.request()
    .input("tid", sql.Int, team.Id)
    .input("tlid", sql.Int, team.TeamLeadUserId)
    .input("mid", sql.Int, memberId)
    .input("cb", sql.Int, actor || null)
    .query(`
      INSERT INTO dbo.SaSalesTeam (TeamId, TeamLeadUserId, MemberUserId, IsActive, CreatedBy, CreatedAt)
      VALUES (@tid, @tlid, @mid, 1, @cb, SYSDATETIME())
    `);
  await moveMemberLeads(tx, memberId, team.TeamLeadUserId);
}

async function removeMember(tx, teamId, memberId) {
  await tx.request().input("tid", sql.Int, teamId).input("mid", sql.Int, memberId).query(`
    UPDATE dbo.SaSalesTeam SET IsActive = 0, UpdatedAt = SYSDATETIME()
    WHERE TeamId = @tid AND MemberUserId = @mid AND IsActive = 1
  `);
  await releaseMemberLeads(tx, memberId);
}

async function activeMembers(tx, teamId) {
  const r = await tx.request().input("tid", sql.Int, teamId)
    .query("SELECT MemberUserId FROM dbo.SaSalesTeam WHERE TeamId = @tid AND IsActive = 1");
  return r.recordset.map((x) => x.MemberUserId);
}

async function getTeam(q, teamId) {
  const r = await q.request().input("id", sql.Int, teamId)
    .query("SELECT Id, Name, TeamLeadUserId FROM dbo.SaTeam WHERE Id = @id AND IsActive = 1");
  return r.recordset[0] || null;
}

// Checks the body of a create/update: a name, a team lead who holds the role
// and has no other active team, and members who are all active salespeople.
// A current member who has since been switched off or given another role is
// dropped (they leave the team on save) rather than blocking the whole save —
// otherwise such a team could never be edited again. Anyone NEW must be valid.
async function validateTeam(q, body, teamId, currentMembers = []) {
  const name = String(body?.Name || "").trim();
  const leadId = parseInt(body?.TeamLeadUserId, 10);
  const memberIds = [...new Set((Array.isArray(body?.MemberIds) ? body.MemberIds : []).map((x) => parseInt(x, 10)).filter(Number.isFinite))];
  if (!name) throw badRequest("Team name is required");
  if (!Number.isFinite(leadId)) throw badRequest("Team lead is required");

  const lead = await q.request().input("id", sql.Int, leadId).query(`
    SELECT u.id FROM dbo.Users u JOIN dbo.Role r ON r.RId = u.RoleId
    WHERE u.id = @id AND LOWER(r.RName) = 'sales_team_lead' AND u.discontinue = 0
  `);
  if (!lead.recordset.length) throw badRequest("The team lead must be an active Sales Team Lead");

  const clash = await q.request().input("tl", sql.Int, leadId).input("nm", sql.NVarChar(100), name).input("id", sql.Int, teamId || 0).query(`
    SELECT TOP 1 CASE WHEN TeamLeadUserId = @tl THEN 'lead' ELSE 'name' END AS Kind
    FROM dbo.SaTeam WHERE IsActive = 1 AND Id <> @id AND (TeamLeadUserId = @tl OR Name = @nm)
  `);
  if (clash.recordset[0]?.Kind === "lead") throw badRequest("That team lead already leads another team");
  if (clash.recordset[0]?.Kind === "name") throw badRequest("Another team already has that name");

  if (memberIds.length) {
    const r = q.request();
    memberIds.forEach((id, i) => r.input(`m${i}`, sql.Int, id));
    const ok = await r.query(`
      SELECT u.id AS Id FROM dbo.Users u JOIN dbo.Role r ON r.RId = u.RoleId
      WHERE u.id IN (${memberIds.map((_, i) => `@m${i}`).join(", ")})
        AND LOWER(r.RName) = 'sales_person' AND u.discontinue = 0
    `);
    const valid = new Set(ok.recordset.map((x) => x.Id));
    const invalidNew = memberIds.filter((id) => !valid.has(id) && !currentMembers.includes(id));
    if (invalidNew.length) throw badRequest("Only active salespeople can be added to a team");
    return { name, leadId, memberIds: memberIds.filter((id) => valid.has(id)) };
  }
  return { name, leadId, memberIds };
}

// The filtered unique indexes (migration 581) are the last word when two
// people save at once — turn their violations into the same plain messages.
const UNIQUE_MESSAGES = {
  UX_SaTeam_ActiveLead: "That team lead already leads another team",
  UX_SaTeam_ActiveName: "Another team already has that name",
  UX_SaSalesTeam_ActiveMember: "One of these salespeople was just added to another team — reload and try again",
};

const fail = (res, tag, e) => {
  if (e.status) return res.status(e.status).json({ error: e.message });
  if (e.number === 2601 || e.number === 2627) {
    const hit = Object.keys(UNIQUE_MESSAGES).find((k) => String(e.message).includes(k));
    if (hit) return res.status(409).json({ error: UNIQUE_MESSAGES[hit] });
  }
  console.error(`[sa-teams] ${tag} error:`, e.message);
  res.status(500).json({ error: e.message });
};

// ─── GET /me ─────────────────────────────────────────────────────────────────
// What the current user may do, so the page only offers what the server accepts.
router.get("/me", requirePageRight("sa-teams", "view"), (req, res) => {
  res.json({ userId: actorId(req), isSaAdmin: isSaAdmin(req) });
});

// ─── GET /options ────────────────────────────────────────────────────────────
// Pickers for the team form: every team lead and salesperson, with the team
// each is currently in (so the form can say "moves from Team B").
router.get("/options", requirePageRight("sa-teams", "view"), async (req, res) => {
  try {
    const r = await getPool().request().query(`
      SELECT u.id AS Id, u.name AS Name, u.email AS Email, LOWER(r.RName) AS Role,
             COALESCE(led.Id, st.TeamId) AS TeamId, COALESCE(led.Name, inTeam.Name) AS TeamName
      FROM dbo.Users u
      JOIN dbo.Role r ON r.RId = u.RoleId
      LEFT JOIN dbo.SaTeam led ON led.TeamLeadUserId = u.id AND led.IsActive = 1
      LEFT JOIN dbo.SaSalesTeam st ON st.MemberUserId = u.id AND st.IsActive = 1
      LEFT JOIN dbo.SaTeam inTeam ON inTeam.Id = st.TeamId
      WHERE LOWER(r.RName) IN ('sales_team_lead', 'sales_person') AND u.discontinue = 0
      ORDER BY u.name
    `);
    res.json({
      leads: r.recordset.filter((u) => u.Role === "sales_team_lead"),
      salespeople: r.recordset.filter((u) => u.Role === "sales_person"),
    });
  } catch (e) { fail(res, "GET /options", e); }
});

// ─── GET / ───────────────────────────────────────────────────────────────────
// Every active team with its lead, members and lead counts.
router.get("/", requirePageRight("sa-teams", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const teams = await pool.request().query(`
      SELECT t.Id, t.Name, t.TeamLeadUserId, u.name AS TeamLeadName, u.email AS TeamLeadEmail, t.CreatedAt,
        CASE WHEN u.discontinue = 0 AND LOWER(lr.RName) = 'sales_team_lead' THEN 1 ELSE 0 END AS LeadActive,
        (SELECT COUNT(*) FROM dbo.SaLead l WHERE l.AssignedTeamLeadId = t.TeamLeadUserId AND l.IsActive = 1 AND l.${openLeads}) AS OpenLeads,
        (SELECT COUNT(*) FROM dbo.SaLead l WHERE l.AssignedTeamLeadId = t.TeamLeadUserId AND l.AssignedSalespersonId IS NULL
           AND l.IsActive = 1 AND l.${openLeads}) AS ToDistribute
      FROM dbo.SaTeam t
      JOIN dbo.Users u ON u.id = t.TeamLeadUserId
      LEFT JOIN dbo.Role lr ON lr.RId = u.RoleId
      WHERE t.IsActive = 1
      ORDER BY t.Name
    `);
    const members = await pool.request().query(`
      SELECT st.TeamId, u.id AS Id, u.name AS Name, u.email AS Email,
        CASE WHEN u.discontinue = 0 AND LOWER(r.RName) = 'sales_person' THEN 1 ELSE 0 END AS Active
      FROM dbo.SaSalesTeam st JOIN dbo.Users u ON u.id = st.MemberUserId
      LEFT JOIN dbo.Role r ON r.RId = u.RoleId
      WHERE st.IsActive = 1 AND st.TeamId IS NOT NULL
      ORDER BY u.name
    `);
    const byTeam = {};
    members.recordset.forEach((m) => { (byTeam[m.TeamId] ||= []).push({ Id: m.Id, Name: m.Name, Email: m.Email, Active: !!m.Active }); });
    res.json(teams.recordset.map((t) => ({ ...t, Members: byTeam[t.Id] || [] })));
  } catch (e) { fail(res, "GET", e); }
});

// ─── POST / ──────────────────────────────────────────────────────────────────
router.post("/", requirePageRight("sa-teams", "create"), async (req, res) => {
  try {
    if (!isSaAdmin(req)) return res.status(403).json({ error: "Only an SA admin can create a team" });
    const pool = getPool();
    const v = await validateTeam(pool, req.body);
    const id = await inTransaction(pool, async (tx) => {
      const r = await tx.request()
        .input("nm", sql.NVarChar(100), v.name)
        .input("tl", sql.Int, v.leadId)
        .input("cb", sql.Int, actorId(req) || null)
        .query("INSERT INTO dbo.SaTeam (Name, TeamLeadUserId, CreatedBy) OUTPUT INSERTED.Id VALUES (@nm, @tl, @cb)");
      const team = { Id: r.recordset[0].Id, TeamLeadUserId: v.leadId };
      for (const m of v.memberIds) await addMember(tx, team, m, actorId(req));
      return team.Id;
    });
    res.status(201).json({ success: true, id, message: `${v.name} created` });
  } catch (e) { fail(res, "POST", e); }
});

// ─── PUT /:id ────────────────────────────────────────────────────────────────
router.put("/:id", requirePageRight("sa-teams", "edit"), async (req, res) => {
  try {
    const teamId = parseId(req.params.id);
    if (teamId === null) return res.status(400).json({ error: "Invalid id" });
    const pool = getPool();
    const team = await getTeam(pool, teamId);
    if (!team) return res.status(404).json({ error: "Team not found" });

    const admin = isSaAdmin(req);
    if (!admin && actorId(req) !== team.TeamLeadUserId) return res.status(403).json({ error: "You can only manage your own team" });
    const v = await validateTeam(pool, req.body, teamId, await activeMembers(pool, teamId));
    if (!admin && (v.leadId !== team.TeamLeadUserId || v.name !== team.Name)) {
      return res.status(403).json({ error: "Only an SA admin can rename a team or change its lead" });
    }

    await inTransaction(pool, async (tx) => {
      const actor = actorId(req);
      if (v.leadId !== team.TeamLeadUserId) {
        // New lead takes the team: its membership rows and every open lead the
        // old lead was holding for it.
        await tx.request().input("tid", sql.Int, teamId).input("tl", sql.Int, v.leadId)
          .query("UPDATE dbo.SaSalesTeam SET TeamLeadUserId = @tl, UpdatedAt = SYSDATETIME() WHERE TeamId = @tid AND IsActive = 1");
        await tx.request().input("old", sql.Int, team.TeamLeadUserId).input("tl", sql.Int, v.leadId).query(`
          UPDATE dbo.SaLead SET AssignedTeamLeadId = @tl, UpdatedAt = SYSDATETIME()
          WHERE AssignedTeamLeadId = @old AND IsActive = 1 AND ${openLeads}
        `);
      }
      await tx.request().input("id", sql.Int, teamId).input("nm", sql.NVarChar(100), v.name).input("tl", sql.Int, v.leadId).input("ub", sql.Int, actor || null)
        .query("UPDATE dbo.SaTeam SET Name = @nm, TeamLeadUserId = @tl, UpdatedBy = @ub, UpdatedAt = SYSDATETIME() WHERE Id = @id");

      const current = await activeMembers(tx, teamId);
      const updated = { Id: teamId, TeamLeadUserId: v.leadId };
      for (const m of current) if (!v.memberIds.includes(m)) await removeMember(tx, teamId, m);
      for (const m of v.memberIds) if (!current.includes(m)) await addMember(tx, updated, m, actor);
    });
    res.json({ success: true, message: `${v.name} saved` });
  } catch (e) { fail(res, "PUT", e); }
});

// ─── DELETE /:id ─────────────────────────────────────────────────────────────
// Soft delete: the team is deactivated, never removed.
router.delete("/:id", requirePageRight("sa-teams", "delete"), async (req, res) => {
  try {
    if (!isSaAdmin(req)) return res.status(403).json({ error: "Only an SA admin can delete a team" });
    const teamId = parseId(req.params.id);
    if (teamId === null) return res.status(400).json({ error: "Invalid id" });
    const pool = getPool();
    const team = await getTeam(pool, teamId);
    if (!team) return res.status(404).json({ error: "Team not found" });

    await inTransaction(pool, async (tx) => {
      for (const m of await activeMembers(tx, teamId)) await removeMember(tx, teamId, m);
      await tx.request().input("id", sql.Int, teamId).input("ub", sql.Int, actorId(req) || null)
        .query("UPDATE dbo.SaTeam SET IsActive = 0, UpdatedBy = @ub, UpdatedAt = SYSDATETIME() WHERE Id = @id");
    });
    res.json({ success: true, message: `${team.Name} deleted` });
  } catch (e) { fail(res, "DELETE", e); }
});

module.exports = router;
