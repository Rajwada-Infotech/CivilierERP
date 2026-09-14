const allowRoles = require("../middleware/role");
const express = require("express");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");

const isUniqueViolation = (err) => /UQ_CandidateMaster_Code/i.test(err.message || "");

const SELECT_COLUMNS =
  "CandidateId, CandidateCode, CandidateName, Contact, Email, Qualification, Experience, " +
  "ExpectedSalary, CurrentSalary, NoticePeriod, ResumeFileName, ResumeBase64, InterviewStatus, " +
  "Remarks, IsActive, CreatedBy, CreatedAt, UpdatedBy, UpdatedAt";

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

// POST — add candidate
router.post("/", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const {
    CandidateCode, CandidateName, Contact, Email, Qualification, Experience,
    ExpectedSalary, CurrentSalary, NoticePeriod, ResumeFileName, ResumeBase64,
    InterviewStatus, Remarks, IsActive,
  } = req.body;
  if (!CandidateCode?.trim()) return res.status(400).json({ error: "CandidateCode is required" });
  if (!CandidateName?.trim()) return res.status(400).json({ error: "CandidateName is required" });
  const createdBy = (req.user && (req.user.name || req.user.email)) || null;
  try {
    const pool = getPool();
    await pool
      .request()
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
    await bumpCacheVersion("candidate-master");
    res.json({ message: "Candidate added successfully" });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({ error: "A candidate with this Candidate ID already exists" });
    }
    console.error("[candidate-master] POST error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT — update candidate
router.put("/:id", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
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

// DELETE
router.delete("/:id", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
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
