const express = require("express");
const router = express.Router();
const apiRateLimit = require("../middleware/apiRateLimit");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId } = require("../services/saAccess");

router.use(authMiddleware);
router.use(apiRateLimit);

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
router.get("/for-project/:projectId", async (req, res) => {
  try {
    const pool = getPool();
    const projectId = parseInt(req.params.projectId);
    // Fetch ALL of this project's tag rows first (not filtered on the
    // tagged bank's own LHeadStatus). Whether we're in branch (1) or (2)
    // above must be decided from "does this project have any tag row at
    // all" — NOT "does this project have any tag row pointing to a
    // currently-active bank". Filtering on LHeadStatus before checking
    // that would mean a project whose only tagged bank(s) are temporarily
    // deactivated (e.g. a bank head disabled for correction) silently
    // fell through to branch (2) and leaked every untagged bank in the
    // system into a project meant to be exclusive to specific banks.
    const rows = await pool.request().input("pid", sql.Int, projectId).query(`
      SELECT ah.LHeadId AS BId, ah.LHeadName AS BName, ah.LHeadStatus AS BStatus
      FROM dbo.CrmProjectBank pb
      JOIN dbo.AccountHeadMaster ah ON ah.LHeadId = pb.BankLHeadId
      WHERE pb.ProjectId = @pid AND pb.IsActive = 1
      ORDER BY ah.LHeadName
    `);
    if (rows.recordset.length) {
      // Project has tag(s) -> stays in the exclusive branch even if every
      // tagged bank happens to be currently inactive. An empty array here
      // (all tagged banks temporarily deactivated) is the correct result,
      // not a signal to fall through to the untagged pool below.
      return res.json(rows.recordset.filter((r) => r.BStatus === 1).map(({ BId, BName }) => ({ BId, BName })));
    }

    // No banks are tagged to this project — show ALL active company banks
    const allBanks = await pool.request().query(`
      SELECT ah.LHeadId AS BId, ah.LHeadName AS BName
      FROM dbo.AccountHeadMaster ah
      WHERE ah.LHeadType = 'B' AND ah.LHeadStatus = 1
      ORDER BY ah.LHeadName
    `);
    res.json(allBanks.recordset);
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