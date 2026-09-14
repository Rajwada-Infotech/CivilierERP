const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const apiRateLimit = require("../middleware/apiRateLimit");
const { requirePageRight } = require("../middleware/requirePageRight");
const { isSaAdmin, actorId } = require("../services/saAccess");

const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
router.use(authMiddleware);
router.use(apiRateLimit);

// ─── GET / ───────────────────────────────────────────────────────────────────
// Returns every team lead with their current active members
router.get("/", requirePageRight("sa-teams", "view"), async (req, res) => {
  try {
    const pool = getPool();

    const leads = await pool.request().query(`
      SELECT u.id AS Id, u.name AS Name, u.email AS Email, r.RName AS Role
      FROM dbo.Users u
      JOIN dbo.Role r ON r.RId = u.RoleId
      WHERE LOWER(r.RName) = 'sales_team_lead' AND u.discontinue = 0
      ORDER BY u.name
    `);

    const members = await pool.request().query(`
      SELECT
        t.Id, t.TeamLeadUserId, t.MemberUserId, t.IsActive, t.CreatedAt,
        u.name AS MemberName, u.email AS MemberEmail, r.RName AS MemberRole
      FROM dbo.SaSalesTeam t
      JOIN dbo.Users u ON t.MemberUserId = u.id
      LEFT JOIN dbo.Role r ON r.RId = u.RoleId
      WHERE t.IsActive = 1
      ORDER BY t.TeamLeadUserId, u.name
    `);

    const membersByLead = {};
    members.recordset.forEach((m) => {
      if (!membersByLead[m.TeamLeadUserId]) membersByLead[m.TeamLeadUserId] = [];
      membersByLead[m.TeamLeadUserId].push(m);
    });

    const teams = leads.recordset.map((l) => ({
      ...l,
      members: membersByLead[l.Id] || [],
    }));

    res.json(teams);
  } catch (e) {
    console.error("[sa-teams] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /unassigned ─────────────────────────────────────────────────────────
// Returns users who can be added to a team (sales_person not already in a team)
router.get("/unassigned", requirePageRight("sa-teams", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const r = await pool.request().query(`
      SELECT u.id AS Id, u.name AS Name, u.email AS Email, r.RName AS Role
      FROM dbo.Users u
      JOIN dbo.Role r ON r.RId = u.RoleId
      WHERE LOWER(r.RName) IN ('sales_person', 'sales_team_lead')
        AND u.discontinue = 0
        AND u.id NOT IN (
          SELECT MemberUserId FROM dbo.SaSalesTeam WHERE IsActive = 1
        )
      ORDER BY r.RName DESC, u.name
    `);
    res.json(r.recordset);
  } catch (e) {
    console.error("[sa-teams] GET /unassigned error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /all-sa-users ───────────────────────────────────────────────────────
// All active SA users (for dropdowns)
router.get("/all-sa-users", requirePageRight("sa-teams", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const r = await pool.request().query(`
      SELECT u.id AS Id, u.name AS Name, u.email AS Email, r.RName AS Role,
        t.TeamLeadUserId,
        tl.name AS TeamLeadName
      FROM dbo.Users u
      JOIN dbo.Role r ON r.RId = u.RoleId
      LEFT JOIN dbo.SaSalesTeam t ON t.MemberUserId = u.id AND t.IsActive = 1
      LEFT JOIN dbo.Users tl ON tl.id = t.TeamLeadUserId
      WHERE LOWER(r.RName) IN ('sales_person', 'sales_team_lead')
        AND u.discontinue = 0
      ORDER BY r.RName DESC, u.name
    `);
    res.json(r.recordset);
  } catch (e) {
    console.error("[sa-teams] GET /all-sa-users error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /:teamLeadId/members ────────────────────────────────────────────────
// Add a user to a team lead's team
router.post("/:teamLeadId/members", requirePageRight("sa-teams", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const teamLeadId = parseInt(req.params.teamLeadId);
    const { memberId } = req.body;
    if (!memberId) return res.status(400).json({ error: "memberId required" });

    // Non-admin TL can only manage their own team
    if (!isSaAdmin(req) && actorId(req) !== teamLeadId) {
      return res.status(403).json({ error: "You can only manage your own team" });
    }

    // Verify team lead exists and has correct role
    const tlCheck = await pool.request()
      .input("id", sql.Int, teamLeadId)
      .query(`
        SELECT u.id FROM dbo.Users u
        JOIN dbo.Role r ON r.RId = u.RoleId
        WHERE u.id = @id AND LOWER(r.RName) = 'sales_team_lead' AND u.discontinue = 0
      `);
    if (!tlCheck.recordset.length) return res.status(400).json({ error: "Team lead not found" });

    // Check if member is already in a team — if so, remove from old team first
    await pool.request()
      .input("mid", sql.Int, parseInt(memberId))
      .query("UPDATE dbo.SaSalesTeam SET IsActive = 0, UpdatedAt = SYSDATETIME() WHERE MemberUserId = @mid AND IsActive = 1");

    // Add to new team
    await pool.request()
      .input("tlid", sql.Int, teamLeadId)
      .input("mid", sql.Int, parseInt(memberId))
      .input("cb", sql.Int, req.user?.userId || null)
      .query(`
        INSERT INTO dbo.SaSalesTeam (TeamLeadUserId, MemberUserId, IsActive, CreatedBy, CreatedAt)
        VALUES (@tlid, @mid, 1, @cb, SYSDATETIME())
      `);

    res.json({ success: true });
  } catch (e) {
    console.error("[sa-teams] POST members error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── DELETE /:teamLeadId/members/:memberId ────────────────────────────────────
// Remove a user from a team
router.delete("/:teamLeadId/members/:memberId", requirePageRight("sa-teams", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const teamLeadId = parseInt(req.params.teamLeadId);
    if (!isSaAdmin(req) && actorId(req) !== teamLeadId) {
      return res.status(403).json({ error: "You can only manage your own team" });
    }
    await pool.request()
      .input("tlid", sql.Int, parseInt(req.params.teamLeadId))
      .input("mid", sql.Int, parseInt(req.params.memberId))
      .query(`
        UPDATE dbo.SaSalesTeam
        SET IsActive = 0, UpdatedAt = SYSDATETIME()
        WHERE TeamLeadUserId = @tlid AND MemberUserId = @mid AND IsActive = 1
      `);
    res.json({ success: true });
  } catch (e) {
    console.error("[sa-teams] DELETE member error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── PUT /:memberId/transfer ──────────────────────────────────────────────────
// Move a member from their current team to a different team lead
router.put("/:memberId/transfer", requirePageRight("sa-teams", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const { newTeamLeadId } = req.body;
    if (!newTeamLeadId) return res.status(400).json({ error: "newTeamLeadId required" });

    const memberId = parseInt(req.params.memberId);

    // Deactivate current assignment
    await pool.request()
      .input("mid", sql.Int, memberId)
      .query("UPDATE dbo.SaSalesTeam SET IsActive = 0, UpdatedAt = SYSDATETIME() WHERE MemberUserId = @mid AND IsActive = 1");

    // Insert new assignment
    await pool.request()
      .input("tlid", sql.Int, parseInt(newTeamLeadId))
      .input("mid", sql.Int, memberId)
      .input("cb", sql.Int, req.user?.userId || null)
      .query(`
        INSERT INTO dbo.SaSalesTeam (TeamLeadUserId, MemberUserId, IsActive, CreatedBy, CreatedAt)
        VALUES (@tlid, @mid, 1, @cb, SYSDATETIME())
      `);

    res.json({ success: true });
  } catch (e) {
    console.error("[sa-teams] PUT transfer error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /:userId/promote ────────────────────────────────────────────────────
// Promote a sales_person to sales_team_lead
router.post("/:userId/promote", requirePageRight("sa-teams", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const userId = parseInt(req.params.userId);

    const userCheck = await pool.request()
      .input("id", sql.Int, userId)
      .query(`
        SELECT u.id, u.name, r.RName AS role
        FROM dbo.Users u
        LEFT JOIN dbo.Role r ON r.RId = u.RoleId
        WHERE u.id = @id AND u.discontinue = 0
      `);
    if (!userCheck.recordset.length) return res.status(404).json({ error: "User not found" });

    const user = userCheck.recordset[0];
    if (user.role === "sales_team_lead") return res.status(400).json({ error: "User is already a team lead" });

    // Remove from any team they belong to
    await pool.request()
      .input("mid", sql.Int, userId)
      .query("UPDATE dbo.SaSalesTeam SET IsActive = 0, UpdatedAt = SYSDATETIME() WHERE MemberUserId = @mid AND IsActive = 1");

    // Get STL RoleId
    const roleRow = await pool.request()
      .query("SELECT RId FROM dbo.Role WHERE RCode = 'STL'");
    if (!roleRow.recordset.length) return res.status(500).json({ error: "STL role not found in dbo.Role" });
    const roleId = roleRow.recordset[0].RId;

    // Update user role
    await pool.request()
      .input("id", sql.Int, userId)
      .input("rid", sql.Int, roleId)
      .query("UPDATE dbo.Users SET RoleId = @rid WHERE id = @id");

    res.json({ success: true, message: `${user.name} promoted to Sales Team Lead` });
  } catch (e) {
    console.error("[sa-teams] POST promote error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /:userId/demote ─────────────────────────────────────────────────────
// Demote a sales_team_lead back to sales_person
router.post("/:userId/demote", requirePageRight("sa-teams", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const userId = parseInt(req.params.userId);

    const userCheck = await pool.request()
      .input("id", sql.Int, userId)
      .query(`
        SELECT u.id, u.name, r.RName AS role
        FROM dbo.Users u
        LEFT JOIN dbo.Role r ON r.RId = u.RoleId
        WHERE u.id = @id AND u.discontinue = 0
      `);
    if (!userCheck.recordset.length) return res.status(404).json({ error: "User not found" });

    const user = userCheck.recordset[0];
    if (user.role !== "sales_team_lead") return res.status(400).json({ error: "User is not a team lead" });

    // Deactivate their team (remove all their members from this lead's team)
    await pool.request()
      .input("tlid", sql.Int, userId)
      .query("UPDATE dbo.SaSalesTeam SET IsActive = 0, UpdatedAt = SYSDATETIME() WHERE TeamLeadUserId = @tlid AND IsActive = 1");

    // Get SP RoleId
    const roleRow = await pool.request()
      .query("SELECT RId FROM dbo.Role WHERE RCode = 'SP'");
    if (!roleRow.recordset.length) return res.status(500).json({ error: "SP role not found in dbo.Role" });
    const roleId = roleRow.recordset[0].RId;

    // Downgrade user role
    await pool.request()
      .input("id", sql.Int, userId)
      .input("rid", sql.Int, roleId)
      .query("UPDATE dbo.Users SET RoleId = @rid WHERE id = @id");

    res.json({ success: true, message: `${user.name} demoted to Sales Person` });
  } catch (e) {
    console.error("[sa-teams] POST demote error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
