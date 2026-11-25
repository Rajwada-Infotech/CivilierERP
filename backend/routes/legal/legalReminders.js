"use strict";
// Legal pending work for the navbar Reminders panel: what is waiting for the signed-in user right now.
// Live queries (nothing stored) — an item drops off as soon as the work is done.
const express = require("express");
const { getPool, sql } = require("../../db");
const projectGuard = require("./projectGuard");
const { userOf } = require("./approvalAuthority");

const router = express.Router();
router.use(async (req, _res, next) => { try { req.legalScope = await projectGuard.getProjectScope(req.user); } catch { /* unrestricted */ } next(); });

const PIPE = "N'Deed Process', N'Deed Completed', N'Deed Registration', N'Registered'";

async function stagesOf(pool, uid) {
  try {
    const r = await pool.request().input("U", sql.Int, uid).query("SELECT DISTINCT Stage FROM dbo.LegalApprovalAuthority WHERE IsActive = 1 AND ApproverId = @U");
    return new Set(r.recordset.map((x) => x.Stage));
  } catch { return new Set(); }
}
const has = async (pool, t) => !!(await pool.request().query(`SELECT OBJECT_ID('dbo.${t}', 'U') AS t`)).recordset[0].t;
const col = async (pool, t, c) => (await pool.request().query(`SELECT COL_LENGTH('dbo.${t}', '${c}') AS c`)).recordset[0].c != null;

router.get("/", async (req, res) => {
  const pool = getPool();
  const uid = userOf(req);
  const sc = (text) => projectGuard.scopeSqlText(text, "all", req.legalScope);
  const out = [];
  const add = (type, id, title, subtitle, due, path) => out.push({ id: `${type}-${id}`, type, title, subtitle, dueDate: due ? new Date(due).toISOString() : new Date().toISOString(), path });
  const run = async (fn) => { try { await fn(); } catch (e) { console.error("[legal-reminders]", e.message); } };
  const st = await stagesOf(pool, uid);
  const approver = ["Approver", "L1 Approver", "L2 Approver"].some((s) => st.has(s));

  if (st.has("Verifier")) await run(async () => {
    const r = await pool.request().query(sc(`
      SELECT r.LandId, l.LandCode, l.LandName, r.VersionNo, r.EntrySubmittedAt, r.EntrySubmittedBy
      FROM dbo.LegalLandReview r JOIN dbo.LegalLand l ON l.LandId = r.LandId AND l.IsActive = 1
      WHERE r.Status = N'Verifying'`));
    for (const x of r.recordset) if (x.EntrySubmittedBy !== uid)
      add("legal_verify", x.LandId, `Verify ${x.LandCode}`, `${x.LandName ?? ""} · version ${x.VersionNo}`, null, `/legal/approvals`);
  });

  if (approver) await run(async () => {
    const r = await pool.request().query(sc(`
      SELECT l.LandId, l.LandCode, l.LandName, ISNULL(l.UpdatedAt, l.CreatedAt) AS At FROM dbo.LegalLand l
      WHERE l.IsActive = 1 AND ISNULL(l.IsCancelled, 0) = 0 AND l.VerificationStatus = N'Verified' AND ISNULL(l.WorkflowStatus, N'') NOT IN (${PIPE})
        AND NOT EXISTS (SELECT 1 FROM dbo.LegalLandReview r WHERE r.LandId = l.LandId AND r.Status IN (N'Verifying', N'Submitted'))`));
    for (const x of r.recordset) add("legal_approval", x.LandId, `Approve land ${x.LandCode}`, x.LandName ?? "Verified — waiting for approval", null, `/legal/approvals`);
  });

  if (approver && (await col(pool, "LegalLand", "DeedApprovalRequestedAt"))) await run(async () => {
    const r = await pool.request().query(sc(`
      SELECT l.LandId, l.LandCode, l.LandName, l.DeedApprovalRequestedAt FROM dbo.LegalLand l
      WHERE l.IsActive = 1 AND l.WorkflowStatus = N'Deed Process' AND l.DeedApprovalRequestedAt IS NOT NULL AND ISNULL(l.L2Status, N'') <> N'Approved'`));
    for (const x of r.recordset) add("legal_approval", `d${x.LandId}`, `Approve deed ${x.LandCode}`, x.LandName ?? "Deed process done", null, `/legal/approvals`);
  });

  if (st.has("Amendment Approver") && (await has(pool, "LegalLandAmendment"))) await run(async () => {
    const r = await pool.request().query(sc(`
      SELECT a.AmendmentId, a.AmendmentNo, a.AmendType, a.RequestedAt, a.RequestedBy, l.LandCode FROM dbo.LegalLandAmendment a
      JOIN dbo.LegalLand l ON l.LandId = a.LandId WHERE a.Status = N'Pending'`));
    for (const x of r.recordset) if (x.RequestedBy !== uid)
      add("legal_approval", `a${x.AmendmentId}`, `Amendment ${x.AmendmentNo ?? ""} · ${x.LandCode}`, x.AmendType ?? "", null, `/legal/approvals`);
  });

  // Deed process target dates — creator / final verifier, and approvers.
  if (await col(pool, "LegalLand", "DeedTargetDate")) await run(async () => {
    const r = await pool.request().input("U", sql.Int, uid).input("A", sql.Bit, approver ? 1 : 0).query(sc(`
      SELECT l.LandId, l.LandCode, l.LandName, l.DeedTargetDate FROM dbo.LegalLand l
      WHERE l.IsActive = 1 AND l.WorkflowStatus = N'Deed Process' AND l.DeedTargetDate IS NOT NULL AND l.DeedCompletedAt IS NULL
        AND l.DeedTargetDate <= DATEADD(DAY, 7, CAST(GETDATE() AS DATE))
        AND (@A = 1 OR l.CreatedBy = @U OR l.FinalVerifiedBy = @U)`));
    for (const x of r.recordset) add("legal_deed", x.LandId, `Deed due · ${x.LandCode}`, x.LandName ?? "", x.DeedTargetDate, `/legal/land/deed-process/${x.LandId}`);
  });

  // Office deed searches pending on an enquiry — assigned user / creator.
  if (await has(pool, "LegalEnquiryOfficeSearch")) await run(async () => {
    const r = await pool.request().input("U", sql.Int, uid).query(sc(`
      SELECT o.EnquiryId, o.OfficeType, o.DueDate, e.EnquiryNo FROM dbo.LegalEnquiryOfficeSearch o
      JOIN dbo.LegalLandEnquiry e ON e.EnquiryId = o.EnquiryId
      WHERE e.IsActive = 1 AND e.LandId IS NULL AND e.EnquiryStatus <> N'Rejected' AND o.Status = N'Pending' AND o.DueDate IS NOT NULL
        AND o.DueDate <= DATEADD(DAY, 7, CAST(GETDATE() AS DATE))
        AND (e.AssignedUserId = @U OR (e.AssignedUserId IS NULL AND e.CreatedBy = @U))`));
    for (const x of r.recordset) add("legal_search", `${x.EnquiryId}-${x.OfficeType}`, `Deed search · ${x.EnquiryNo}`, x.OfficeType ?? "", x.DueDate, `/legal/land/deed-search`);
  });

  // Post-registration tasks — assignee (or approvers when unassigned).
  if (await has(pool, "LegalPostRegTask")) await run(async () => {
    const r = await pool.request().input("U", sql.Int, uid).input("A", sql.Bit, approver ? 1 : 0).query(sc(`
      SELECT t.TaskId, t.LandId, t.Task, t.DueDate, l.LandCode FROM dbo.LegalPostRegTask t
      JOIN dbo.LegalLand l ON l.LandId = t.LandId AND l.IsActive = 1
      WHERE t.Status NOT IN (N'Completed', N'Rejected') AND t.DueDate IS NOT NULL AND t.DueDate <= DATEADD(DAY, 7, CAST(GETDATE() AS DATE))
        AND (t.AssignedUserId = @U OR (t.AssignedUserId IS NULL AND @A = 1))`));
    for (const x of r.recordset) add("legal_postreg", x.TaskId, `${x.Task} · ${x.LandCode}`, "Post-registration task", x.DueDate, `/legal/land/post-registration/${x.LandId}`);
  });

  // Verification activities assigned to this user (Legal V2).
  if (await has(pool, "LegalVerificationActivity")) await run(async () => {
    const r = await pool.request().input("U", sql.Int, uid).query(`
      SELECT a.ActivityId, a.ActivityNo, a.ActivityName, a.Status, a.DueDate, a.VerificationId, v.VerificationNo, v.ProjectId
      FROM dbo.LegalVerificationActivity a JOIN dbo.LegalVerification v ON v.VerificationId = a.VerificationId AND v.Status <> N'Closed'
      WHERE a.AssignedUserId = @U AND a.Status NOT IN (N'Completed', N'Not Applicable')`);
    for (const x of r.recordset) if (!req.legalScope || req.legalScope.includes(Number(x.ProjectId)))
      add("legal_activity", x.ActivityId, `${x.ActivityNo}. ${x.ActivityName}`, `${x.VerificationNo} · ${x.Status}`, x.DueDate, `/legal/land/verification/${x.VerificationId}`);
  });

  res.json(out);
});

module.exports = router;
