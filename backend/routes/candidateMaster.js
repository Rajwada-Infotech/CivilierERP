const allowRoles = require("../middleware/role");
const { pageRightByMethod } = require("../middleware/requirePageRight");
const express = require("express");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const router = express.Router();
const apiRateLimit = require("../middleware/apiRateLimit");
router.use(apiRateLimit);
const { getPool, sql } = require("../db");

const isUniqueViolation = (err) => /UQ_CandidateMaster_Code/i.test(err.message || "");

const SELECT_COLUMNS =
  "CandidateId, CandidateCode, CandidateName, Contact, Email, Qualification, Experience, " +
  "ExpectedSalary, CurrentSalary, NoticePeriod, ResumeFileName, ResumeBase64, InterviewStatus, " +
  "Remarks, IsActive, CreatedBy, CreatedAt, UpdatedBy, UpdatedAt";

async function nextCandidateCode(pool, sql) {
  const res = await pool.request().query(`
    SELECT ISNULL(MAX(TRY_CAST(SUBSTRING(CandidateCode, 6, 10) AS INT)), 0) AS MaxSeq
    FROM dbo.CandidateMaster WHERE CandidateCode LIKE 'CAND-%'
  `);
  const next = (res.recordset[0].MaxSeq || 0) + 1;
  return `CAND-${String(next).padStart(5, "0")}`;
}

// GET all candidates
router.get("/", cache("candidate-master", 300), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT ${SELECT_COLUMNS} FROM dbo.CandidateMaster ORDER BY CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[candidate-master] GET error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST — add candidate (CandidateCode is always server-generated: CAND-00001)
router.post("/", pageRightByMethod("candidate-master"), async (req, res) => {
  const {
    CandidateName, Contact, Email, Qualification, Experience,
    ExpectedSalary, CurrentSalary, NoticePeriod, ResumeFileName, ResumeBase64,
    InterviewStatus, Remarks, IsActive,
  } = req.body;
  if (!CandidateName?.trim()) return res.status(400).json({ error: "CandidateName is required" });
  const createdBy = (req.user && (req.user.name || req.user.email)) || null;
  try {
    const pool = getPool();
    let newCode = null;
    for (let attempt = 0; attempt < 5 && newCode === null; attempt++) {
      const candidateCode = await nextCandidateCode(pool, sql);
      try {
        await pool
          .request()
          .input("CandidateCode", sql.NVarChar(30), candidateCode)
          .input("CandidateName", sql.NVarChar(150), CandidateName.trim())
          .input("Contact", sql.NVarChar(20), Contact || null)
          .input("Email", sql.NVarChar(150), Email || null)
          .input("Qualification", sql.NVarChar(200), Qualification || null)
          .input("Experience", sql.NVarChar(50), Experience || null)
          .input("ExpectedSalary", sql.Decimal(12, 2), ExpectedSalary ?? null)
          .input("CurrentSalary", sql.Decimal(12, 2), CurrentSalary ?? null)
          .input("NoticePeriod", sql.NVarChar(50), NoticePeriod || null)
          .input("ResumeFileName", sql.NVarChar(255), ResumeFileName || null)
          .input("ResumeBase64", sql.NVarChar(sql.MAX), ResumeBase64 || null)
          .input("InterviewStatus", sql.NVarChar(30), InterviewStatus || null)
          .input("Remarks", sql.NVarChar(1000), Remarks || null)
          .input("IsActive", sql.Bit, IsActive !== false ? 1 : 0)
          .input("CreatedBy", sql.NVarChar(150), createdBy)
          .query(`
            INSERT INTO dbo.CandidateMaster (
              CandidateCode, CandidateName, Contact, Email, Qualification, Experience,
              ExpectedSalary, CurrentSalary, NoticePeriod, ResumeFileName, ResumeBase64,
              InterviewStatus, Remarks, IsActive, CreatedBy, CreatedAt
            ) VALUES (
              @CandidateCode, @CandidateName, @Contact, @Email, @Qualification, @Experience,
              @ExpectedSalary, @CurrentSalary, @NoticePeriod, @ResumeFileName, @ResumeBase64,
              @InterviewStatus, @Remarks, @IsActive, @CreatedBy, SYSDATETIME()
            )
          `);
        newCode = candidateCode;
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        // collision on CandidateCode — loop and try the next serial
      }
    }
    if (newCode === null) return res.status(500).json({ error: "Could not allocate a Candidate ID, please retry" });
    await bumpCacheVersion("candidate-master");
    res.json({ message: "Candidate added successfully", CandidateCode: newCode });
  } catch (err) {
    console.error("[candidate-master] POST error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---- Bulk import from Excel -------------------------------------------------
// POST /import { rows: [{ rowNo, cells: {...} }], dryRun } — every row is checked the same way as one typed in by
// hand. dryRun only reports; a real run is all-or-nothing: if any row is invalid nothing is saved.
const IMPORT_MAX_ROWS = 2000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9][0-9\s\-()]{4,18}$/;
const MAX_SALARY = 9999999999.99;
const INTERVIEW_LOOKUP = { selected: "Selected", rejected: "Rejected", "on hold": "On Hold", hold: "On Hold", onhold: "On Hold" };
const STATUS_LOOKUP = { active: true, yes: true, y: true, "1": true, true: true, inactive: false, no: false, n: false, "0": false, false: false };

function parseSalary(raw) {
  const s = String(raw ?? "").replace(/[,₹\s]/g, "");
  if (s === "") return { value: null };
  if (!/^\d+(\.\d+)?$/.test(s)) return { error: "must be a number (digits only, no negative)" };
  const n = Number(s);
  if (n > MAX_SALARY) return { error: "is too large" };
  return { value: n };
}

function validateImportRow(cells) {
  const errors = [];
  const c = (k) => String(cells?.[k] ?? "").trim();
  const name = c("name");
  if (!name) errors.push("Name is required");
  else if (name.length > 150) errors.push("Name is longer than 150 characters");

  const contact = c("contact");
  if (contact && !PHONE_RE.test(contact)) errors.push("Contact is not a valid phone number");
  else if (contact.length > 20) errors.push("Contact is longer than 20 characters");

  const email = c("email");
  if (email && (!EMAIL_RE.test(email) || email.length > 150)) errors.push("Email is not valid");

  const qualification = c("qualification");
  if (qualification.length > 200) errors.push("Qualification is longer than 200 characters");
  const experience = c("experience");
  if (experience.length > 50) errors.push("Experience is longer than 50 characters");
  const noticePeriod = c("noticePeriod");
  if (noticePeriod.length > 50) errors.push("Notice Period is longer than 50 characters");
  const remarks = c("remarks");
  if (remarks.length > 1000) errors.push("Remarks is longer than 1000 characters");

  const exp = parseSalary(cells?.expectedSalary);
  if (exp.error) errors.push(`Expected Salary ${exp.error}`);
  const cur = parseSalary(cells?.currentSalary);
  if (cur.error) errors.push(`Current Salary ${cur.error}`);

  let interviewStatus = null;
  const ir = c("interviewStatus");
  if (ir) {
    interviewStatus = INTERVIEW_LOOKUP[ir.toLowerCase()] || null;
    if (!interviewStatus) errors.push("Interview Result must be Selected, Rejected or On Hold");
  }
  let isActive = true;
  const st = c("status");
  if (st) {
    if (!(st.toLowerCase() in STATUS_LOOKUP)) errors.push("Status must be Active or Inactive");
    else isActive = STATUS_LOOKUP[st.toLowerCase()];
  }

  return {
    errors,
    record: {
      name, contact: contact || null, email: email || null, qualification: qualification || null,
      experience: experience || null, expectedSalary: exp.value ?? null, currentSalary: cur.value ?? null,
      noticePeriod: noticePeriod || null, interviewStatus, remarks: remarks || null, isActive,
    },
  };
}

router.post("/import", pageRightByMethod("candidate-master"), async (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
  const dryRun = req.body?.dryRun !== false;
  if (!rows || !rows.length) return res.status(400).json({ error: "The file has no candidate rows" });
  if (rows.length > IMPORT_MAX_ROWS) return res.status(400).json({ error: `Import at most ${IMPORT_MAX_ROWS} candidates at a time` });
  const createdBy = (req.user && (req.user.name || req.user.email)) || null;
  try {
    const pool = getPool();
    const existing = await pool.request().query("SELECT LOWER(Email) AS Email FROM dbo.CandidateMaster WHERE Email IS NOT NULL");
    const known = new Set(existing.recordset.map((r) => r.Email));
    const seenInFile = new Map();

    const results = rows.map((r, i) => {
      const rowNo = Number(r?.rowNo) || i + 2;
      const { errors, record } = validateImportRow(r?.cells || {});
      const key = record.email ? record.email.toLowerCase() : null;
      if (key && known.has(key)) errors.push("A candidate with this email already exists");
      else if (key && seenInFile.has(key)) errors.push(`Same email as row ${seenInFile.get(key)} in this file`);
      if (key && !seenInFile.has(key)) seenInFile.set(key, rowNo);
      return { rowNo, name: record.name, errors, record };
    });
    const invalid = results.filter((r) => r.errors.length);
    const summary = { total: results.length, valid: results.length - invalid.length, invalid: invalid.length };
    const slim = results.map(({ rowNo, name, errors }) => ({ rowNo, name, errors }));

    if (dryRun || invalid.length) return res.json({ dryRun, imported: 0, summary, results: slim });

    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      const max = await new sql.Request(tx).query(`
        SELECT ISNULL(MAX(TRY_CAST(SUBSTRING(CandidateCode, 6, 10) AS INT)), 0) AS MaxSeq
        FROM dbo.CandidateMaster WITH (UPDLOCK, HOLDLOCK) WHERE CandidateCode LIKE 'CAND-%'`);
      let seq = max.recordset[0].MaxSeq || 0;
      for (const r of results) {
        seq += 1;
        const d = r.record;
        await new sql.Request(tx)
          .input("CandidateCode", sql.NVarChar(30), `CAND-${String(seq).padStart(5, "0")}`)
          .input("CandidateName", sql.NVarChar(150), d.name)
          .input("Contact", sql.NVarChar(20), d.contact)
          .input("Email", sql.NVarChar(150), d.email)
          .input("Qualification", sql.NVarChar(200), d.qualification)
          .input("Experience", sql.NVarChar(50), d.experience)
          .input("ExpectedSalary", sql.Decimal(12, 2), d.expectedSalary)
          .input("CurrentSalary", sql.Decimal(12, 2), d.currentSalary)
          .input("NoticePeriod", sql.NVarChar(50), d.noticePeriod)
          .input("InterviewStatus", sql.NVarChar(30), d.interviewStatus)
          .input("Remarks", sql.NVarChar(1000), d.remarks)
          .input("IsActive", sql.Bit, d.isActive ? 1 : 0)
          .input("CreatedBy", sql.NVarChar(150), createdBy)
          .query(`
            INSERT INTO dbo.CandidateMaster (
              CandidateCode, CandidateName, Contact, Email, Qualification, Experience,
              ExpectedSalary, CurrentSalary, NoticePeriod, InterviewStatus, Remarks, IsActive, CreatedBy, CreatedAt
            ) VALUES (
              @CandidateCode, @CandidateName, @Contact, @Email, @Qualification, @Experience,
              @ExpectedSalary, @CurrentSalary, @NoticePeriod, @InterviewStatus, @Remarks, @IsActive, @CreatedBy, SYSDATETIME()
            )`);
      }
      await tx.commit();
    } catch (e) {
      try { await tx.rollback(); } catch { /* already aborted */ }
      throw e;
    }
    await bumpCacheVersion("candidate-master");
    res.json({ dryRun: false, imported: results.length, summary, results: slim });
  } catch (err) {
    console.error("[candidate-master] IMPORT error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT — update candidate
router.put("/:id", pageRightByMethod("candidate-master"), async (req, res) => {
  const { id } = req.params;
  const {
    CandidateCode, CandidateName, Contact, Email, Qualification, Experience,
    ExpectedSalary, CurrentSalary, NoticePeriod, ResumeFileName, ResumeBase64,
    InterviewStatus, Remarks, IsActive,
  } = req.body;
  if (!CandidateCode?.trim()) return res.status(400).json({ error: "CandidateCode is required" });
  if (!CandidateName?.trim()) return res.status(400).json({ error: "CandidateName is required" });
  const updatedBy = (req.user && (req.user.name || req.user.email)) || null;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("Id", sql.Int, parseInt(id))
      .input("CandidateCode", sql.NVarChar(30), CandidateCode.trim())
      .input("CandidateName", sql.NVarChar(150), CandidateName.trim())
      .input("Contact", sql.NVarChar(20), Contact || null)
      .input("Email", sql.NVarChar(150), Email || null)
      .input("Qualification", sql.NVarChar(200), Qualification || null)
      .input("Experience", sql.NVarChar(50), Experience || null)
      .input("ExpectedSalary", sql.Decimal(12, 2), ExpectedSalary ?? null)
      .input("CurrentSalary", sql.Decimal(12, 2), CurrentSalary ?? null)
      .input("NoticePeriod", sql.NVarChar(50), NoticePeriod || null)
      .input("ResumeFileName", sql.NVarChar(255), ResumeFileName || null)
      .input("ResumeBase64", sql.NVarChar(sql.MAX), ResumeBase64 || null)
      .input("InterviewStatus", sql.NVarChar(30), InterviewStatus || null)
      .input("Remarks", sql.NVarChar(1000), Remarks || null)
      .input("IsActive", sql.Bit, IsActive !== false ? 1 : 0)
      .input("UpdatedBy", sql.NVarChar(150), updatedBy)
      .query(`
        UPDATE dbo.CandidateMaster SET
          CandidateCode = @CandidateCode, CandidateName = @CandidateName, Contact = @Contact,
          Email = @Email, Qualification = @Qualification, Experience = @Experience,
          ExpectedSalary = @ExpectedSalary, CurrentSalary = @CurrentSalary, NoticePeriod = @NoticePeriod,
          ResumeFileName = @ResumeFileName, ResumeBase64 = @ResumeBase64, InterviewStatus = @InterviewStatus,
          Remarks = @Remarks, IsActive = @IsActive, UpdatedBy = @UpdatedBy, UpdatedAt = SYSDATETIME()
        WHERE CandidateId = @Id
      `);
    await bumpCacheVersion("candidate-master");
    res.json({ message: "Candidate updated successfully" });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({ error: "A candidate with this Candidate ID already exists" });
    }
    console.error("[candidate-master] PUT error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

const INTERVIEW_RESULT_VALUES = ["Selected", "Rejected", "On Hold"];

// PATCH -- set the interview result directly from Candidate Master
// (Selected / Rejected / On Hold), independent of the Interview page's
// own status sync -- both write the same column.
router.patch("/:id/interview-status", pageRightByMethod("candidate-master"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { InterviewStatus } = req.body;
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
  if (!INTERVIEW_RESULT_VALUES.includes(InterviewStatus)) {
    return res.status(400).json({ error: `InterviewStatus must be one of: ${INTERVIEW_RESULT_VALUES.join(", ")}` });
  }
  const updatedBy = (req.user && (req.user.name || req.user.email)) || null;
  try {
    const pool = getPool();
    const existing = await pool.request().input("Id", sql.Int, id)
      .query("SELECT CandidateId FROM dbo.CandidateMaster WHERE CandidateId = @Id");
    if (!existing.recordset.length) return res.status(404).json({ error: "Candidate not found" });

    await pool
      .request()
      .input("Id", sql.Int, id)
      .input("InterviewStatus", sql.NVarChar(30), InterviewStatus)
      .input("UpdatedBy", sql.NVarChar(150), updatedBy)
      .query(`
        UPDATE dbo.CandidateMaster SET InterviewStatus = @InterviewStatus, UpdatedBy = @UpdatedBy, UpdatedAt = SYSDATETIME()
        WHERE CandidateId = @Id
      `);
    await bumpCacheVersion("candidate-master");
    res.json({ message: "Interview result updated successfully" });
  } catch (err) {
    console.error("[candidate-master] PATCH interview-status error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE
router.delete("/:id", pageRightByMethod("candidate-master"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const existing = await pool.request().input("Id", sql.Int, id)
      .query("SELECT CandidateName FROM dbo.CandidateMaster WHERE CandidateId = @Id");
    if (!existing.recordset.length) return res.status(404).json({ error: "Candidate not found" });
    await pool.request().input("Id", sql.Int, id).query("DELETE FROM dbo.CandidateMaster WHERE CandidateId = @Id");
    await bumpCacheVersion("candidate-master");
    res.json({ message: `Candidate "${existing.recordset[0].CandidateName}" deleted successfully` });
  } catch (err) {
    console.error("[candidate-master] DELETE error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
