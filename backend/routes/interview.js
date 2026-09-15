const allowRoles = require("../middleware/role");
const express = require("express");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");

const STATUS_VALUES = ["PENDING", "SELECTED", "REJECTED", "HOLD"];

// Interview.Status -> CandidateMaster.InterviewStatus, so the candidate's
// own record stays in sync with the outcome of their latest interview.
const CANDIDATE_STATUS_SYNC = {
  SELECTED: "Selected",
  REJECTED: "Rejected",
  HOLD: "On Hold",
};

const SELECT_COLUMNS = `
  SELECT
    i.InterviewId, i.DocNo, i.CandidateId, i.CompanyId, i.ProjectId,
    i.InterviewDate, i.Remarks, i.Status, i.IsActive, i.CreatedAt, i.UpdatedAt,
    c.CandidateCode, c.CandidateName, c.Contact, c.Email, c.Qualification, c.Experience,
    c.ExpectedSalary, c.CurrentSalary, c.NoticePeriod, c.ResumeFileName, c.ResumeBase64,
    c.InterviewStatus AS CandidateInterviewStatus,
    comp.name AS CompanyName,
    proj.name AS ProjectName
  FROM dbo.Interview i
  JOIN dbo.CandidateMaster c ON c.CandidateId = i.CandidateId
  LEFT JOIN dbo.enterprise comp ON comp.id = i.CompanyId
  LEFT JOIN dbo.enterprise proj ON proj.id = i.ProjectId
`;

async function nextDocNo(pool, sql) {
  const res = await pool.request().query(`
    SELECT ISNULL(MAX(TRY_CAST(SUBSTRING(DocNo, 5, 10) AS INT)), 0) AS MaxSeq
    FROM dbo.Interview WHERE DocNo LIKE 'INT-%'
  `);
  const next = (res.recordset[0].MaxSeq || 0) + 1;
  return `INT-${String(next).padStart(5, "0")}`;
}

// GET all interviews
router.get("/", cache("interview", 60), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`${SELECT_COLUMNS} ORDER BY i.InterviewDate DESC, i.InterviewId DESC`);
    res.json(result.recordset);
  } catch (err) {
    console.error("[interview] GET error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST — add interview
router.post("/", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const { CandidateId, CompanyId, ProjectId, InterviewDate, Remarks } = req.body;
  if (!CandidateId) return res.status(400).json({ error: "CandidateId is required" });
  if (!InterviewDate) return res.status(400).json({ error: "InterviewDate is required" });
  const createdBy = req.user?.userId || null;
  try {
    const pool = getPool();
    let newId = null;
    for (let attempt = 0; attempt < 5 && newId === null; attempt++) {
      const docNo = await nextDocNo(pool, sql);
      try {
        const insertResult = await pool
          .request()
          .input("DocNo", sql.NVarChar(30), docNo)
          .input("CandidateId", sql.Int, CandidateId)
          .input("CompanyId", sql.Int, CompanyId || null)
          .input("ProjectId", sql.Int, ProjectId || null)
          .input("InterviewDate", sql.Date, InterviewDate)
          .input("Remarks", sql.NVarChar(1000), Remarks || null)
          .input("CreatedBy", sql.Int, createdBy)
          .query(`
            INSERT INTO dbo.Interview (DocNo, CandidateId, CompanyId, ProjectId, InterviewDate, Remarks, Status, CreatedBy, CreatedAt)
            OUTPUT INSERTED.InterviewId
            VALUES (@DocNo, @CandidateId, @CompanyId, @ProjectId, @InterviewDate, @Remarks, 'PENDING', @CreatedBy, SYSUTCDATETIME())
          `);
        newId = insertResult.recordset[0].InterviewId;
      } catch (err) {
        if (!/UQ_Interview_DocNo/i.test(err.message || "")) throw err;
        // collision on DocNo — loop and try the next serial
      }
    }
    if (newId === null) return res.status(500).json({ error: "Could not allocate a document number, please retry" });
    await bumpCacheVersion("interview");
    res.json({ message: "Interview added successfully", InterviewId: newId });
  } catch (err) {
    if (/FK_Interview_Candidate/i.test(err.message || "")) {
      return res.status(400).json({ error: "Selected candidate not found" });
    }
    console.error("[interview] POST error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT — update interview (candidate/company/project/date/remarks — not Status or DocNo)
router.put("/:id", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const { id } = req.params;
  const { CandidateId, CompanyId, ProjectId, InterviewDate, Remarks } = req.body;
  if (!CandidateId) return res.status(400).json({ error: "CandidateId is required" });
  if (!InterviewDate) return res.status(400).json({ error: "InterviewDate is required" });
  const updatedBy = req.user?.userId || null;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("Id", sql.Int, parseInt(id))
      .input("CandidateId", sql.Int, CandidateId)
      .input("CompanyId", sql.Int, CompanyId || null)
      .input("ProjectId", sql.Int, ProjectId || null)
      .input("InterviewDate", sql.Date, InterviewDate)
      .input("Remarks", sql.NVarChar(1000), Remarks || null)
      .input("UpdatedBy", sql.Int, updatedBy)
      .query(`
        UPDATE dbo.Interview SET
          CandidateId = @CandidateId, CompanyId = @CompanyId, ProjectId = @ProjectId,
          InterviewDate = @InterviewDate, Remarks = @Remarks, UpdatedBy = @UpdatedBy, UpdatedAt = SYSUTCDATETIME()
        WHERE InterviewId = @Id
      `);
    await bumpCacheVersion("interview");
    res.json({ message: "Interview updated successfully" });
  } catch (err) {
    if (/FK_Interview_Candidate/i.test(err.message || "")) {
      return res.status(400).json({ error: "Selected candidate not found" });
    }
    console.error("[interview] PUT error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// PATCH — update status only (Selected / Rejected / Hold), keeps the
// candidate's own InterviewStatus field in sync with the outcome.
router.patch("/:id/status", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { Status } = req.body;
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
  if (!STATUS_VALUES.includes(Status)) {
    return res.status(400).json({ error: `Status must be one of: ${STATUS_VALUES.join(", ")}` });
  }
  const updatedBy = req.user?.userId || null;
  try {
    const pool = getPool();
    const existing = await pool.request().input("Id", sql.Int, id)
      .query("SELECT CandidateId FROM dbo.Interview WHERE InterviewId = @Id");
    if (!existing.recordset.length) return res.status(404).json({ error: "Interview not found" });

    await pool
      .request()
      .input("Id", sql.Int, id)
      .input("Status", sql.NVarChar(20), Status)
      .input("UpdatedBy", sql.Int, updatedBy)
      .query(`
        UPDATE dbo.Interview SET Status = @Status, UpdatedBy = @UpdatedBy, UpdatedAt = SYSUTCDATETIME()
        WHERE InterviewId = @Id
      `);

    const candidateStatus = CANDIDATE_STATUS_SYNC[Status];
    if (candidateStatus) {
      await pool
        .request()
        .input("CandidateId", sql.Int, existing.recordset[0].CandidateId)
        .input("InterviewStatus", sql.NVarChar(30), candidateStatus)
        .query(`
          UPDATE dbo.CandidateMaster SET InterviewStatus = @InterviewStatus, UpdatedAt = SYSDATETIME()
          WHERE CandidateId = @CandidateId
        `);
    }

    await bumpCacheVersion("interview");
    await bumpCacheVersion("candidate-master");
    res.json({ message: "Interview status updated successfully" });
  } catch (err) {
    console.error("[interview] PATCH status error:", err.message);
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
      .query("SELECT DocNo FROM dbo.Interview WHERE InterviewId = @Id");
    if (!existing.recordset.length) return res.status(404).json({ error: "Interview not found" });
    await pool.request().input("Id", sql.Int, id).query("DELETE FROM dbo.Interview WHERE InterviewId = @Id");
    await bumpCacheVersion("interview");
    res.json({ message: `Interview "${existing.recordset[0].DocNo}" deleted successfully` });
  } catch (err) {
    console.error("[interview] DELETE error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
