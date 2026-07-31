const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId } = require("../services/saAccess");

router.use(authMiddleware);
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));

// GET / — every active Project↔Bank link (management page).
router.get("/", requirePageRight("crm-project-banks", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT pb.Id, pb.ProjectId, proj.name AS ProjectName,
             pb.BankLHeadId, ah.LHeadName AS BankName
      FROM dbo.CrmProjectBank pb
      JOIN dbo.enterprise proj ON proj.id = pb.ProjectId AND proj.business_type = 'P'
      JOIN dbo.AccountHeadMaster ah ON ah.LHeadId = pb.BankLHeadId
      WHERE pb.IsActive = 1
      ORDER BY proj.name, ah.LHeadName
    `);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-project-banks] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /for-project/:projectId — the one lookup every payment surface calls
// to scope its deposit-bank dropdown. This is the full rule, resolved
// server-side so no caller can get it wrong:
//   1. Any bank(s) tagged to this Project -> return exactly those, nothing
//      else (a tagged bank is exclusive to its tagged Project(s) and must
//      never appear for a different one).
//   2. Nothing tagged to this Project -> return every bank that has NO tag
//      to ANY project at all. A bank tagged elsewhere must stay invisible
//      here even though this Project itself has no tags of its own —
//      "untagged" is the fallback pool, not "everything".
router.get("/for-project/:projectId", requirePageRight("crm-project-banks", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const projectId = parseInt(req.params.projectId);
    // ah.LHeadStatus = 1 matters here too, not just in the untagged fallback
    // below — a bank deactivated after being tagged must stop being offered
    // for its Project rather than staying selectable forever because the
    // tag row itself is still IsActive.
    const tagged = await pool.request().input("pid", sql.Int, projectId).query(`
      SELECT ah.LHeadId AS BId, ah.LHeadName AS BName
      FROM dbo.CrmProjectBank pb
      JOIN dbo.AccountHeadMaster ah ON ah.LHeadId = pb.BankLHeadId
      WHERE pb.ProjectId = @pid AND pb.IsActive = 1 AND ah.LHeadStatus = 1
      ORDER BY ah.LHeadName
    `);
    if (tagged.recordset.length) return res.json(tagged.recordset);

    const untagged = await pool.request().query(`
      SELECT ah.LHeadId AS BId, ah.LHeadName AS BName
      FROM dbo.AccountHeadMaster ah
      WHERE ah.LHeadType = 'B' AND ah.LHeadStatus = 1
        AND NOT EXISTS (SELECT 1 FROM dbo.CrmProjectBank pb WHERE pb.BankLHeadId = ah.LHeadId AND pb.IsActive = 1)
      ORDER BY ah.LHeadName
    `);
    res.json(untagged.recordset);
  } catch (e) {
    console.error("[crm-project-banks] GET /for-project error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /for-bank/:bankLHeadId — every Project a bank is currently tagged to
// (Bank Master's own edit form prefill).
router.get("/for-bank/:bankLHeadId", requirePageRight("crm-project-banks", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const bankLHeadId = parseInt(req.params.bankLHeadId);
    const result = await pool.request().input("bid", sql.Int, bankLHeadId).query(`
      SELECT pb.ProjectId, proj.name AS ProjectName
      FROM dbo.CrmProjectBank pb
      JOIN dbo.enterprise proj ON proj.id = pb.ProjectId AND proj.business_type = 'P'
      WHERE pb.BankLHeadId = @bid AND pb.IsActive = 1
      ORDER BY proj.name
    `);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-project-banks] GET /for-bank error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Shared by bankMaster.js — sets a bank's full set of tagged Projects
// (deactivate-then-upsert, same pattern as crmPaymentPlans.js's own
// syncPaymentPlanProjectTag one tier over). A bank can be tagged to several
// Projects at once (unlike the Payment Plan's 1:1 rule) — the only
// exclusivity here is "once tagged anywhere, invisible everywhere else",
// enforced by GET /for-project above, not by a uniqueness constraint on
// this table.
async function syncBankProjectTags(pool, bankLHeadId, projectIds, actorUserId) {
  await pool.request().input("bid", sql.Int, bankLHeadId)
    .query("UPDATE dbo.CrmProjectBank SET IsActive = 0 WHERE BankLHeadId = @bid");
  for (const projectId of projectIds) {
    if (!Number.isFinite(projectId)) continue;
    await pool.request()
      .input("bid", sql.Int, bankLHeadId)
      .input("pid", sql.Int, projectId)
      .input("cb", sql.Int, actorUserId)
      .query(`
        MERGE dbo.CrmProjectBank AS tgt
        USING (SELECT @pid AS ProjectId, @bid AS BankLHeadId) AS src
        ON tgt.ProjectId = src.ProjectId AND tgt.BankLHeadId = src.BankLHeadId
        WHEN MATCHED THEN UPDATE SET IsActive = 1
        WHEN NOT MATCHED THEN INSERT (ProjectId, BankLHeadId, IsActive, CreatedBy, CreatedAt) VALUES (src.ProjectId, src.BankLHeadId, 1, @cb, SYSDATETIME());
      `);
  }
}

// POST / — link a bank to a project. Idempotent: re-linking an already-
// active pair is a no-op success (matches the unique index instead of
// erroring on it).
router.post("/", requirePageRight("crm-project-banks", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const { ProjectId, BankLHeadId } = req.body;
    if (!ProjectId || !BankLHeadId) return res.status(400).json({ error: "ProjectId and BankLHeadId are required" });

    const existing = await pool.request()
      .input("pid", sql.Int, parseInt(ProjectId))
      .input("bid", sql.Int, parseInt(BankLHeadId))
      .query("SELECT Id FROM dbo.CrmProjectBank WHERE ProjectId = @pid AND BankLHeadId = @bid AND IsActive = 1");
    if (existing.recordset.length) return res.json({ success: true, id: existing.recordset[0].Id, alreadyLinked: true });

    const result = await pool.request()
      .input("pid", sql.Int, parseInt(ProjectId))
      .input("bid", sql.Int, parseInt(BankLHeadId))
      .input("cb",  sql.Int, actorId(req))
      .query(`
        INSERT INTO dbo.CrmProjectBank (ProjectId, BankLHeadId, IsActive, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@pid, @bid, 1, @cb, SYSDATETIME())
      `);
    res.status(201).json({ success: true, id: result.recordset[0].Id });
  } catch (e) {
    console.error("[crm-project-banks] POST error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /:id — unlink (soft-deactivate, same convention as every other
// master in this codebase).
router.delete("/:id", requirePageRight("crm-project-banks", "delete"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    await pool.request().input("id", sql.Int, id)
      .query("UPDATE dbo.CrmProjectBank SET IsActive = 0 WHERE Id = @id");
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-project-banks] DELETE error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
module.exports.syncBankProjectTags = syncBankProjectTags;
