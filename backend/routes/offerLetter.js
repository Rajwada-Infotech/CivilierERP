const allowRoles = require("../middleware/role");
const express = require("express");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");

const SELECT_COLUMNS = `
  SELECT
    o.OfferId, o.DocNo, o.CandidateId, o.CompanyId, o.FinYearId, o.Salary, o.CandidateAddress,
    o.DateOfJoin, o.DocumentDate, o.Remarks, o.JoiningConfirmed, o.ActualDateOfJoining, o.JoiningRemarks,
    o.IsActive, o.CreatedAt, o.UpdatedAt,
    c.CandidateCode, c.CandidateName, c.Contact, c.Email, c.Qualification, c.Experience,
    c.ExpectedSalary, c.CurrentSalary, c.NoticePeriod, c.InterviewStatus AS CandidateInterviewStatus,
    comp.name AS CompanyName,
    fy.FName AS FinYearName
  FROM dbo.OfferLetter o
  JOIN dbo.CandidateMaster c ON c.CandidateId = o.CandidateId
  LEFT JOIN dbo.enterprise comp ON comp.id = o.CompanyId
  LEFT JOIN dbo.FinYear fy ON fy.FId = o.FinYearId
`;

async function nextDocNo(pool, sql) {
  const res = await pool.request().query(`
    SELECT ISNULL(MAX(TRY_CAST(SUBSTRING(DocNo, 5, 10) AS INT)), 0) AS MaxSeq
    FROM dbo.OfferLetter WHERE DocNo LIKE 'OFR-%'
  `);
  const next = (res.recordset[0].MaxSeq || 0) + 1;
  return `OFR-${String(next).padStart(5, "0")}`;
}

// GET all offer letters
router.get("/", cache("offer-letter", 60), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`${SELECT_COLUMNS} ORDER BY o.CreatedAt DESC`);
    res.json(result.recordset);
  } catch (err) {
    console.error("[offer-letter] GET error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST — add offer letter
router.post("/", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const { CandidateId, CompanyId, FinYearId, Salary, CandidateAddress, DateOfJoin, DocumentDate, Remarks } = req.body;
  if (!CandidateId) return res.status(400).json({ error: "CandidateId is required" });
  if (!DocumentDate) return res.status(400).json({ error: "DocumentDate is required" });
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
          .input("FinYearId", sql.Int, FinYearId || null)
          .input("Salary", sql.Decimal(12, 2), Salary ?? null)
          .input("CandidateAddress", sql.NVarChar(500), CandidateAddress || null)
          .input("DateOfJoin", sql.Date, DateOfJoin || null)
          .input("DocumentDate", sql.Date, DocumentDate)
          .input("Remarks", sql.NVarChar(1000), Remarks || null)
          .input("CreatedBy", sql.Int, createdBy)
          .query(`
            INSERT INTO dbo.OfferLetter (
              DocNo, CandidateId, CompanyId, FinYearId, Salary, CandidateAddress,
              DateOfJoin, DocumentDate, Remarks, CreatedBy, CreatedAt
            )
            OUTPUT INSERTED.OfferId
            VALUES (
              @DocNo, @CandidateId, @CompanyId, @FinYearId, @Salary, @CandidateAddress,
              @DateOfJoin, @DocumentDate, @Remarks, @CreatedBy, SYSUTCDATETIME()
            )
          `);
        newId = insertResult.recordset[0].OfferId;
      } catch (err) {
        if (!/UQ_OfferLetter_DocNo/i.test(err.message || "")) throw err;
        // collision on DocNo — loop and try the next serial
      }
    }
    if (newId === null) return res.status(500).json({ error: "Could not allocate a document number, please retry" });
    await bumpCacheVersion("offer-letter");
    res.json({ message: "Offer letter added successfully", OfferId: newId });
  } catch (err) {
    if (/FK_OfferLetter_Candidate/i.test(err.message || "")) {
      return res.status(400).json({ error: "Selected candidate not found" });
    }
    console.error("[offer-letter] POST error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT — update offer letter (not DocNo, not joining fields — those go through PATCH /joining)
router.put("/:id", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const { id } = req.params;
  const { CandidateId, CompanyId, FinYearId, Salary, CandidateAddress, DateOfJoin, DocumentDate, Remarks } = req.body;
  if (!CandidateId) return res.status(400).json({ error: "CandidateId is required" });
  if (!DocumentDate) return res.status(400).json({ error: "DocumentDate is required" });
  const updatedBy = req.user?.userId || null;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("Id", sql.Int, parseInt(id))
      .input("CandidateId", sql.Int, CandidateId)
      .input("CompanyId", sql.Int, CompanyId || null)
      .input("FinYearId", sql.Int, FinYearId || null)
      .input("Salary", sql.Decimal(12, 2), Salary ?? null)
      .input("CandidateAddress", sql.NVarChar(500), CandidateAddress || null)
      .input("DateOfJoin", sql.Date, DateOfJoin || null)
      .input("DocumentDate", sql.Date, DocumentDate)
      .input("Remarks", sql.NVarChar(1000), Remarks || null)
      .input("UpdatedBy", sql.Int, updatedBy)
      .query(`
        UPDATE dbo.OfferLetter SET
          CandidateId = @CandidateId, CompanyId = @CompanyId, FinYearId = @FinYearId,
          Salary = @Salary, CandidateAddress = @CandidateAddress, DateOfJoin = @DateOfJoin,
          DocumentDate = @DocumentDate, Remarks = @Remarks, UpdatedBy = @UpdatedBy, UpdatedAt = SYSUTCDATETIME()
        WHERE OfferId = @Id
      `);
    await bumpCacheVersion("offer-letter");
    res.json({ message: "Offer letter updated successfully" });
  } catch (err) {
    if (/FK_OfferLetter_Candidate/i.test(err.message || "")) {
      return res.status(400).json({ error: "Selected candidate not found" });
    }
    console.error("[offer-letter] PUT error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// PATCH — confirm/record the actual joining date + remarks (Joining tab)
router.patch("/:id/joining", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { ActualDateOfJoining, JoiningRemarks } = req.body;
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
  if (!ActualDateOfJoining) return res.status(400).json({ error: "ActualDateOfJoining is required" });
  const updatedBy = req.user?.userId || null;
  try {
    const pool = getPool();
    const existing = await pool.request().input("Id", sql.Int, id)
      .query("SELECT OfferId FROM dbo.OfferLetter WHERE OfferId = @Id");
    if (!existing.recordset.length) return res.status(404).json({ error: "Offer letter not found" });

    await pool
      .request()
      .input("Id", sql.Int, id)
      .input("ActualDateOfJoining", sql.Date, ActualDateOfJoining)
      .input("JoiningRemarks", sql.NVarChar(500), JoiningRemarks || null)
      .input("UpdatedBy", sql.Int, updatedBy)
      .query(`
        UPDATE dbo.OfferLetter SET
          JoiningConfirmed = 1, ActualDateOfJoining = @ActualDateOfJoining, JoiningRemarks = @JoiningRemarks,
          UpdatedBy = @UpdatedBy, UpdatedAt = SYSUTCDATETIME()
        WHERE OfferId = @Id
      `);
    await bumpCacheVersion("offer-letter");
    res.json({ message: "Joining confirmed successfully" });
  } catch (err) {
    console.error("[offer-letter] PATCH joining error:", err.message);
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
      .query("SELECT DocNo FROM dbo.OfferLetter WHERE OfferId = @Id");
    if (!existing.recordset.length) return res.status(404).json({ error: "Offer letter not found" });
    await pool.request().input("Id", sql.Int, id).query("DELETE FROM dbo.OfferLetter WHERE OfferId = @Id");
    await bumpCacheVersion("offer-letter");
    res.json({ message: `Offer letter "${existing.recordset[0].DocNo}" deleted successfully` });
  } catch (err) {
    console.error("[offer-letter] DELETE error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
