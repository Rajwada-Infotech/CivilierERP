"use strict";

// Land Management pipeline — one workflow per land property (Land ID).
//   GET  /stats                     dashboard counts and recent land properties
//   GET  /:id                       header, every pipeline step with its status and gate, warnings
//   POST /:id/steps/:code           move a step: In Progress / Pending Verification / Completed /
//                                   Correction Required / Skipped (with a reason)
//   POST /:id/hold                  put the land on hold (category, reason)
//   POST /:id/resume                resume it
//   GET  /:id/audit                 the land's audit trail
//   POST /enquiries/:id/convert     turn an enquiry into a land property (new Land ID)
//
// Gates are checked here, never only in the browser. A step completes only when every earlier step is
// Completed or Skipped and its own gate passes; reopening a finished step sends the finished steps after
// it back for re-verification (their history stays).

const express = require("express");
const { getPool, sql } = require("../../db");
const { requirePageRight, hasAnyPageAction } = require("../../middleware/requirePageRight");
const apiRateLimit = require("../../middleware/apiRateLimit");
const { writeAudit, nextCodeSql, codePrefix } = require("./legalAudit");

const router = express.Router();
router.use(apiRateLimit);

const LAND_PAGE = "legal-land-master";
const ENQUIRY_PAGE = "legal-land-enquiry";
// Steps whose screens and gates exist today; later steps arrive phase by phase.
const LIVE_PHASE = 1;
const DONE = new Set(["Completed", "Skipped"]);
const STATUSES = ["In Progress", "Pending Verification", "Completed", "Correction Required", "Skipped"];
const HOLD_CATEGORIES = ["Legal Dispute", "Ownership Mismatch", "Document Missing", "Mortgage / Loan Issue", "Court Case", "Buyer / Seller Issue", "Financial Issue", "Management Decision", "Other"];
const OWNER_ROLES = ["Owner", "Joint Owner", "Legal Heir"];

const idParam = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};
const text = (v, max) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

const requireApprove = async (req, res) => {
  if (await hasAnyPageAction(req, LAND_PAGE, ["approve"])) return true;
  res.status(403).json({ error: "Only a user with approve rights on Land Property can do this" });
  return false;
};

async function loadLand(conn, id) {
  const r = await conn.request().input("Id", sql.Int, id).query(`
    SELECT l.LandId, l.LandCode, l.LandName, l.DistrictId, l.MouzaId, l.Area, l.AreaUnitId, l.EnquiryId,
           l.LandStatus, l.WorkflowStatus, l.IsOnHold, l.IsActive, l.CreatedAt,
           d.DistrictName, m.MouzaName, m.JLNo, u.UnitName, e.EnquiryNo
    FROM dbo.LegalLand l
    LEFT JOIN dbo.LegalDistrict d ON d.DistrictId = l.DistrictId
    LEFT JOIN dbo.LegalMouza m ON m.MouzaId = l.MouzaId
    LEFT JOIN dbo.LegalAreaUnit u ON u.AreaUnitId = l.AreaUnitId
    LEFT JOIN dbo.LegalLandEnquiry e ON e.EnquiryId = l.EnquiryId
    WHERE l.LandId = @Id`);
  return r.recordset[0] || null;
}

/** What each live step still needs before it can be Completed ([] = ready), plus non-blocking warnings. */
async function gates(conn, land) {
  const r = await conn.request().input("Id", sql.Int, land.LandId).query(`
    SELECT lp.LandRole, lp.SharePct, p.FullName, p.Pan, p.Aadhaar
      FROM dbo.LegalLandParty lp JOIN dbo.LegalPerson p ON p.PersonId = lp.PersonId
      WHERE lp.LandId = @Id AND lp.IsActive = 1;
    SELECT 'RS' AS Kind, VerificationStatus FROM dbo.LegalLandRsRecord WHERE LandId = @Id AND IsActive = 1
    UNION ALL SELECT 'LR', VerificationStatus FROM dbo.LegalLandLrRecord WHERE LandId = @Id AND IsActive = 1;`);
  const [parties, records] = r.recordsets;
  const need = { ENQUIRY: [], PROPERTY: [], PARTIES: [], RECORD_MAPPING: [] };
  const warnings = [];

  if (!land.EnquiryId) need.ENQUIRY.push("No enquiry is linked. If the land was entered directly, skip this step with a reason.");

  for (const [col, label] of [["LandName", "Land title"], ["DistrictId", "District"], ["MouzaId", "Mouza"], ["Area", "Total land area"], ["AreaUnitId", "Area unit"]]) {
    if (land[col] === null || land[col] === undefined || land[col] === "") need.PROPERTY.push(`${label} is not entered`);
  }

  const owners = parties.filter((p) => OWNER_ROLES.includes(p.LandRole));
  if (!owners.length) need.PARTIES.push("Link at least one current owner, joint owner or legal heir");
  else if (owners.some((p) => p.SharePct === null)) need.PARTIES.push("Enter each current owner's share");
  else {
    // Shares are never adjusted automatically; an incomplete total stays pending verification.
    const total = owners.reduce((s, p) => s + Number(p.SharePct), 0);
    if (Math.abs(total - 100) > 0.0001) need.PARTIES.push(`Current owners' shares add up to ${Number(total.toFixed(4))}%, not 100%`);
  }
  // A seller is not automatically the legal owner: flag sellers who match no current owner.
  const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
  for (const s of parties.filter((p) => p.LandRole === "Seller")) {
    const match = owners.some((o) => (s.Pan && o.Pan === s.Pan) || (s.Aadhaar && o.Aadhaar === s.Aadhaar) || norm(o.FullName) === norm(s.FullName));
    if (!match) warnings.push(`Seller ${s.FullName} does not match any current owner of this land`);
  }

  if (!records.length) need.RECORD_MAPPING.push("Enter at least one RS or LR record");
  const open = records.filter((x) => x.VerificationStatus !== "Verified");
  if (open.length) need.RECORD_MAPPING.push(`${open.length} RS / LR record(s) are not verified yet`);

  const counts = {
    parties: parties.length,
    owners: owners.length,
    rs: records.filter((x) => x.Kind === "RS").length,
    lr: records.filter((x) => x.Kind === "LR").length,
    recordsVerified: records.length - open.length,
  };
  return { need, warnings, counts };
}

async function loadSteps(conn, landId) {
  const r = await conn.request().input("Id", sql.Int, landId).query(`
    SELECT s.StepNo, s.StepCode, s.StepName, s.Phase, s.IsSkippable,
           ISNULL(st.Status, 'Not Started') AS Status, st.Remarks, st.SkipReason, st.UpdatedAt,
           (SELECT name FROM dbo.users WHERE id = st.UpdatedBy) AS UpdatedByName,
           (SELECT name FROM dbo.users WHERE id = st.ResponsibleUserId) AS ResponsibleName
    FROM dbo.LegalWorkflowStep s
    LEFT JOIN dbo.LegalWorkflowStepState st ON st.StepCode = s.StepCode AND st.LandId = @Id
    WHERE s.IsActive = 1 ORDER BY s.StepNo`);
  return r.recordset;
}

/** Keeps LegalLand.WorkflowStatus on the first unfinished step's name. */
async function syncWorkflowStatus(conn, landId) {
  await conn.request().input("Id", sql.Int, landId).query(`
    UPDATE dbo.LegalLand SET WorkflowStatus = ISNULL((
      SELECT TOP 1 s.StepName FROM dbo.LegalWorkflowStep s
      LEFT JOIN dbo.LegalWorkflowStepState st ON st.StepCode = s.StepCode AND st.LandId = @Id
      WHERE s.IsActive = 1 AND ISNULL(st.Status, 'Not Started') NOT IN ('Completed', 'Skipped')
      ORDER BY s.StepNo), 'Completed')
    WHERE LandId = @Id`);
}

/** Moves one step and records the change in its history (`from` is null for a step never started). */
async function moveStep(conn, req, landId, code, from, to, { remarks = null, skipReason = null } = {}) {
  await conn.request()
    .input("LandId", sql.Int, landId).input("Code", sql.NVarChar(40), code)
    .input("Prev", sql.NVarChar(30), from).input("Status", sql.NVarChar(30), to)
    .input("Remarks", sql.NVarChar(1000), remarks).input("SkipReason", sql.NVarChar(500), skipReason)
    .input("UserId", sql.Int, req.user?.userId || null)
    .query(`
      MERGE dbo.LegalWorkflowStepState AS t
      USING (SELECT @LandId AS LandId, @Code AS StepCode) AS s ON t.LandId = s.LandId AND t.StepCode = s.StepCode
      WHEN MATCHED THEN UPDATE SET Status = @Status, Remarks = @Remarks, SkipReason = @SkipReason, UpdatedBy = @UserId, UpdatedAt = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN INSERT (LandId, StepCode, Status, Remarks, SkipReason, ResponsibleUserId, UpdatedBy, UpdatedAt)
        VALUES (@LandId, @Code, @Status, @Remarks, @SkipReason, @UserId, @UserId, SYSUTCDATETIME());
      INSERT INTO dbo.LegalWorkflowStepHistory (LandId, StepCode, PreviousStatus, NewStatus, Remarks, ChangedBy)
        VALUES (@LandId, @Code, @Prev, @Status, ISNULL(@SkipReason, @Remarks), @UserId);`);
}

// ── Routes ────────────────────────────────────────────────────────────────────────────────────────
router.get("/stats", requirePageRight(LAND_PAGE, "view"), async (_req, res) => {
  try {
    const r = await getPool().request().query(`
      SELECT
        (SELECT COUNT(*) FROM dbo.LegalLand WHERE IsActive = 1) AS totalLands,
        (SELECT COUNT(*) FROM dbo.LegalLandEnquiry WHERE IsActive = 1 AND EnquiryStatus IN ('New', 'Under Review', 'Interested', 'On Hold')) AS activeEnquiries,
        (SELECT COUNT(*) FROM dbo.LegalLand WHERE IsActive = 1 AND IsOnHold = 0 AND ISNULL(WorkflowStatus, '') <> 'Completed') AS inProgress,
        (SELECT COUNT(*) FROM dbo.LegalLand WHERE IsActive = 1 AND IsOnHold = 1) AS onHold,
        (SELECT COUNT(DISTINCT LandId) FROM dbo.LegalWorkflowStepState WHERE Status = 'Pending Verification') AS pendingVerification,
        (SELECT COUNT(*) FROM dbo.LegalLand WHERE IsActive = 1 AND WorkflowStatus = 'Completed') AS completed;
      SELECT TOP 8 l.LandId, l.LandCode, l.LandName, l.WorkflowStatus, l.IsOnHold, m.MouzaName, m.JLNo, l.CreatedAt
      FROM dbo.LegalLand l LEFT JOIN dbo.LegalMouza m ON m.MouzaId = l.MouzaId
      WHERE l.IsActive = 1 ORDER BY ISNULL(l.UpdatedAt, l.CreatedAt) DESC;`);
    res.json({ ...r.recordsets[0][0], recent: r.recordsets[1] });
  } catch (err) {
    console.error("[legal-land] stats:", err.message);
    res.status(500).json({ error: "Could not load land statistics" });
  }
});

router.get("/:id", requirePageRight(LAND_PAGE, "view"), async (req, res) => {
  const id = idParam(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const land = await loadLand(pool, id);
    if (!land) return res.status(404).json({ error: "Land property not found" });
    const [steps, g, hold] = await Promise.all([
      loadSteps(pool, id),
      gates(pool, land),
      pool.request().input("Id", sql.Int, id).query(`
        SELECT TOP 1 h.HoldId, h.HoldCategory, h.HoldReason, h.HoldDate, h.ExpectedReviewDate, h.Remarks,
               (SELECT name FROM dbo.users WHERE id = h.HeldBy) AS HeldByName
        FROM dbo.LegalHold h WHERE h.LandId = @Id AND h.ResumedAt IS NULL ORDER BY h.HoldId DESC`),
    ]);
    let blockedFrom = null;
    const out = steps.map((s) => {
      const live = s.Phase <= LIVE_PHASE;
      const missing = live ? g.need[s.StepCode] || [] : [];
      const locked = blockedFrom !== null;
      if (!DONE.has(s.Status) && blockedFrom === null) blockedFrom = s.StepNo;
      return {
        stepNo: s.StepNo, code: s.StepCode, name: s.StepName, phase: s.Phase, skippable: !!s.IsSkippable,
        status: s.Status, remarks: s.Remarks, skipReason: s.SkipReason, updatedAt: s.UpdatedAt,
        updatedBy: s.UpdatedByName, responsible: s.ResponsibleName, live, locked, missing,
      };
    });
    const done = out.filter((s) => DONE.has(s.status)).length;
    res.json({
      land, hold: hold.recordset[0] || null, steps: out, counts: g.counts, warnings: g.warnings,
      progress: Math.round((done / Math.max(out.length, 1)) * 100), holdCategories: HOLD_CATEGORIES,
    });
  } catch (err) {
    console.error("[legal-land] pipeline:", err.message);
    res.status(500).json({ error: "Could not load the land pipeline" });
  }
});

router.post("/:id/steps/:code", requirePageRight(LAND_PAGE, "edit"), async (req, res) => {
  const id = idParam(req.params.id);
  const code = String(req.params.code || "").toUpperCase();
  const to = req.body?.status;
  const remarks = text(req.body?.remarks, 1000);
  const skipReason = text(req.body?.skipReason, 500);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  if (!STATUSES.includes(to)) return res.status(400).json({ error: `Status must be one of: ${STATUSES.join(", ")}` });
  if ((to === "Skipped" || to === "Correction Required") && !(await requireApprove(req, res))) return;
  if (to === "Skipped" && (!skipReason || skipReason.length < 5)) return res.status(400).json({ error: "Give the reason for skipping this step" });
  if (to === "Correction Required" && !remarks) return res.status(400).json({ error: "Say what needs correcting" });

  const tx = new sql.Transaction(getPool());
  try {
    await tx.begin();
    const land = await loadLand(tx, id);
    if (!land) { await tx.rollback(); return res.status(404).json({ error: "Land property not found" }); }
    if (land.IsOnHold) { await tx.rollback(); return res.status(409).json({ error: "This land is on hold. Resume it first." }); }
    if (!land.IsActive) { await tx.rollback(); return res.status(409).json({ error: "This land property is inactive" }); }
    // Lock this land's steps so two people cannot move them at once.
    await tx.request().input("Id", sql.Int, id).query("SELECT LandId FROM dbo.LegalLand WITH (UPDLOCK, ROWLOCK) WHERE LandId = @Id");
    const steps = await loadSteps(tx, id);
    const step = steps.find((s) => s.StepCode === code);
    const refuse = async (msg) => { await tx.rollback(); return res.status(409).json({ error: msg }); };
    if (!step) return refuse("Unknown step");
    if (step.Phase > LIVE_PHASE) return refuse(`${step.StepName} opens in a later phase of the Legal module`);
    if (step.Status === to) return refuse(`${step.StepName} is already ${to}`);
    if (to === "Skipped" && !step.IsSkippable) return refuse(`${step.StepName} cannot be skipped`);

    const earlier = steps.filter((s) => s.StepNo < step.StepNo && !DONE.has(s.Status));
    if (["In Progress", "Pending Verification", "Completed", "Skipped"].includes(to) && earlier.length) {
      return refuse(`Finish ${earlier[0].StepNo}. ${earlier[0].StepName} first`);
    }
    if (to === "Completed") {
      const { need } = await gates(tx, land);
      const missing = need[code] || [];
      if (missing.length) return refuse(`${step.StepName} cannot be completed yet: ${missing.join("; ")}`);
    }

    await moveStep(tx, req, id, code, step.Status === "Not Started" ? null : step.Status, to, { remarks, skipReason });

    // Reopening a finished step: later finished steps go back for re-verification, with their history kept.
    const reopened = DONE.has(step.Status) && !DONE.has(to);
    const flagged = [];
    if (reopened) {
      for (const later of steps.filter((s) => s.StepNo > step.StepNo && DONE.has(s.Status))) {
        await moveStep(tx, req, id, later.StepCode, later.Status, "Pending Verification", { remarks: `Re-verify: ${step.StepName} was reopened` });
        flagged.push(later.StepName);
      }
    }
    await syncWorkflowStatus(tx, id);
    await writeAudit(tx, req, {
      action: "Workflow step changed", entityType: "Land Property", entityId: id, landId: id,
      oldValue: { step: step.StepName, status: step.Status }, newValue: { step: step.StepName, status: to },
      remarks: skipReason || remarks,
    });
    await tx.commit();
    res.json({ message: `${step.StepName}: ${to}`, reverify: flagged });
  } catch (err) {
    try { await tx.rollback(); } catch { /* already rolled back */ }
    console.error("[legal-land] step:", err.message);
    res.status(500).json({ error: "Could not update the step. Please try again." });
  }
});

router.post("/:id/hold", requirePageRight(LAND_PAGE, "edit"), async (req, res) => {
  const id = idParam(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  if (!(await requireApprove(req, res))) return;
  const category = req.body?.category;
  const reason = text(req.body?.reason, 1000);
  const review = req.body?.expectedReviewDate ? String(req.body.expectedReviewDate).slice(0, 10) : null;
  const fileId = req.body?.fileId ? idParam(req.body.fileId) : null;
  if (!HOLD_CATEGORIES.includes(category)) return res.status(400).json({ error: "Choose a hold category" });
  if (!reason) return res.status(400).json({ error: "Give the hold reason" });
  if (review && (!/^\d{4}-\d{2}-\d{2}$/.test(review) || Number.isNaN(Date.parse(review)))) return res.status(400).json({ error: "Expected review date is not valid" });
  try {
    const pool = getPool();
    const r = await pool.request()
      .input("Id", sql.Int, id).input("Category", sql.NVarChar(60), category).input("Reason", sql.NVarChar(1000), reason)
      .input("Review", sql.Date, review).input("FileId", sql.Int, fileId).input("Remarks", sql.NVarChar(1000), text(req.body?.remarks, 1000))
      .input("UserId", sql.Int, req.user?.userId || null)
      .query(`
        UPDATE dbo.LegalLand SET IsOnHold = 1, UpdatedBy = @UserId, UpdatedAt = SYSUTCDATETIME() WHERE LandId = @Id AND IsOnHold = 0;
        IF @@ROWCOUNT = 1
          INSERT INTO dbo.LegalHold (LandId, HoldCategory, HoldReason, HoldDate, HeldBy, ExpectedReviewDate, FileId, Remarks)
          OUTPUT INSERTED.HoldId AS id
          VALUES (@Id, @Category, @Reason, CAST(SYSDATETIME() AS DATE), @UserId, @Review, @FileId, @Remarks);`);
    if (!r.recordset?.length) return res.status(409).json({ error: "This land is already on hold, or does not exist" });
    await writeAudit(pool, req, { action: "Land put on hold", entityType: "Land Property", entityId: id, landId: id, newValue: { category, reason, expectedReviewDate: review } });
    res.json({ message: "Land put on hold" });
  } catch (err) {
    console.error("[legal-land] hold:", err.message);
    res.status(500).json({ error: "Could not put the land on hold" });
  }
});

router.post("/:id/resume", requirePageRight(LAND_PAGE, "edit"), async (req, res) => {
  const id = idParam(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  if (!(await requireApprove(req, res))) return;
  const remarks = text(req.body?.remarks, 1000);
  if (!remarks) return res.status(400).json({ error: "Say why the land is resumed" });
  try {
    const pool = getPool();
    const r = await pool.request().input("Id", sql.Int, id).input("Remarks", sql.NVarChar(1000), remarks).input("UserId", sql.Int, req.user?.userId || null)
      .query(`
        UPDATE dbo.LegalLand SET IsOnHold = 0, UpdatedBy = @UserId, UpdatedAt = SYSUTCDATETIME() WHERE LandId = @Id AND IsOnHold = 1;
        IF @@ROWCOUNT = 1
          UPDATE dbo.LegalHold SET ResumedBy = @UserId, ResumedAt = SYSUTCDATETIME(), ResumeRemarks = @Remarks
          OUTPUT INSERTED.HoldId AS id
          WHERE LandId = @Id AND ResumedAt IS NULL;`);
    if (!r.recordset?.length) return res.status(409).json({ error: "This land is not on hold" });
    await writeAudit(pool, req, { action: "Workflow resumed", entityType: "Land Property", entityId: id, landId: id, remarks });
    res.json({ message: "Land resumed" });
  } catch (err) {
    console.error("[legal-land] resume:", err.message);
    res.status(500).json({ error: "Could not resume the land" });
  }
});

router.get("/:id/audit", requirePageRight(LAND_PAGE, "view"), async (req, res) => {
  const id = idParam(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  try {
    const r = await getPool().request().input("Id", sql.Int, id).query(`
      SELECT TOP 300 a.EventId, a.Action, a.EntityType, a.EntityId, a.OldValue, a.NewValue, a.Remarks, a.CreatedAt,
             (SELECT name FROM dbo.users WHERE id = a.UserId) AS UserName
      FROM dbo.LegalRecordAudit a WHERE a.LandId = @Id ORDER BY a.EventId DESC`);
    res.json(r.recordset);
  } catch (err) {
    console.error("[legal-land] audit:", err.message);
    res.status(500).json({ error: "Could not load the audit trail" });
  }
});

router.post("/enquiries/:id/convert", requirePageRight(LAND_PAGE, "create"), requirePageRight(ENQUIRY_PAGE, "edit"), async (req, res) => {
  const id = idParam(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  const tx = new sql.Transaction(getPool());
  try {
    await tx.begin();
    const e = (await tx.request().input("Id", sql.Int, id).query(
      "SELECT * FROM dbo.LegalLandEnquiry WITH (UPDLOCK, ROWLOCK) WHERE EnquiryId = @Id",
    )).recordset[0];
    const refuse = async (status, msg) => { await tx.rollback(); return res.status(status).json({ error: msg }); };
    if (!e) return refuse(404, "Enquiry not found");
    if (e.LandId || e.EnquiryStatus === "Converted to Land Record") return refuse(409, "This enquiry is already converted");
    if (e.EnquiryStatus === "Rejected") return refuse(409, "A rejected enquiry cannot be converted. Change its status first.");

    const ins = await tx.request()
      .input("Prefix", sql.NVarChar(20), codePrefix("LND"))
      .input("Name", sql.NVarChar(200), text(req.body?.landName, 200) || e.LandLocation.slice(0, 200))
      .input("DistrictId", sql.Int, e.DistrictId).input("MouzaId", sql.Int, e.MouzaId)
      .input("Area", sql.Decimal(18, 6), e.ApproxArea).input("AreaUnitId", sql.Int, e.AreaUnitId)
      .input("Address", sql.NVarChar(1000), e.LandLocation).input("EnquiryId", sql.Int, id)
      .input("UserId", sql.Int, req.user?.userId || null)
      .query(`
        INSERT INTO dbo.LegalLand (LandCode, LandName, DistrictId, MouzaId, Area, AreaUnitId, LocationAddress, EnquiryId, LandStatus, IsOnHold, IsActive, CreatedBy, CreatedAt)
        OUTPUT INSERTED.LandId AS id, INSERTED.LandCode AS code
        SELECT ${nextCodeSql("LegalLand", "LandCode", "@Prefix")}, @Name, @DistrictId, @MouzaId, @Area, @AreaUnitId, @Address, @EnquiryId, N'Identified', 0, 1, @UserId, SYSUTCDATETIME()`);
    const land = ins.recordset[0];
    await tx.request().input("Id", sql.Int, id).input("LandId", sql.Int, land.id).input("UserId", sql.Int, req.user?.userId || null)
      .query(`UPDATE dbo.LegalLandEnquiry SET EnquiryStatus = N'Converted to Land Record', LandId = @LandId, UpdatedBy = @UserId, UpdatedAt = SYSUTCDATETIME() WHERE EnquiryId = @Id`);
    await moveStep(tx, req, land.id, "ENQUIRY", null, "Completed", { remarks: `Converted from enquiry ${e.EnquiryNo}` });
    await syncWorkflowStatus(tx, land.id);
    await writeAudit(tx, req, { action: "Land created", entityType: "Land Property", entityId: land.id, landId: land.id, newValue: { landCode: land.code, fromEnquiry: e.EnquiryNo } });
    await writeAudit(tx, req, { action: "Enquiry converted", entityType: "Land Enquiry", entityId: id, landId: land.id, oldValue: { status: e.EnquiryStatus }, newValue: { status: "Converted to Land Record", landCode: land.code } });
    await tx.commit();
    res.status(201).json({ landId: land.id, landCode: land.code, message: `Land ${land.code} created from enquiry ${e.EnquiryNo}` });
  } catch (err) {
    try { await tx.rollback(); } catch { /* already rolled back */ }
    console.error("[legal-land] convert:", err.message);
    res.status(500).json({ error: "Could not convert the enquiry. Please try again." });
  }
});

module.exports = router;
