const allowRoles = require("../middleware/role");
const express = require("express");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");

const { createEmployeeAccountHead } = require("../services/employeeAccountHead");
const SELECT_COLUMNS = `
  SELECT
    o.OfferId, o.DocNo, o.CandidateId, o.CompanyId, o.FinYearId, o.DesignationId, o.Salary, o.CandidateAddress,
    o.DateOfJoin, o.DocumentDate, o.Remarks, o.JoiningConfirmed, o.ActualDateOfJoining, o.JoiningRemarks,
    o.IsActive, o.CreatedAt, o.UpdatedAt,
    c.CandidateCode, c.CandidateName, c.Contact, c.Email, c.Qualification, c.Experience,
    c.ExpectedSalary, c.CurrentSalary, c.NoticePeriod, c.InterviewStatus AS CandidateInterviewStatus,
    comp.name AS CompanyName,
    fy.FName AS FinYearName,
    des.DesignationName AS DesignationName
  FROM dbo.OfferLetter o
  JOIN dbo.CandidateMaster c ON c.CandidateId = o.CandidateId
  LEFT JOIN dbo.enterprise comp ON comp.id = o.CompanyId
  LEFT JOIN dbo.FinYear fy ON fy.FId = o.FinYearId
  LEFT JOIN dbo.DesignationMaster des ON des.Id = o.DesignationId
`;

async function nextDocNo(pool, sql) {
  const res = await pool.request().query(`
    SELECT ISNULL(MAX(TRY_CAST(SUBSTRING(DocNo, 5, 10) AS INT)), 0) AS MaxSeq
    FROM dbo.OfferLetter WHERE DocNo LIKE 'OFR-%'
  `);
  const next = (res.recordset[0].MaxSeq || 0) + 1;
  return `OFR-${String(next).padStart(5, "0")}`;
}

const DEFAULT_TEMPLATE_BODY = `Dear {{CandidateName}},

We are pleased to offer you the position at {{Company}}.

Your annual salary will be {{Salary}} and your proposed date of joining is {{DateOfJoin}}.

Address on file: {{CandidateAddress}}

This offer is issued as document {{DocNo}} dated {{DocumentDate}}, for financial year {{FinYear}}.

We look forward to welcoming you to the team.

Regards,
{{Company}}`;

// GET the single offer-letter body template -- registered before the
// "/:id" routes below so Express doesn't try to parse "template" as an id.
router.get("/template", async (req, res) => {
  try {
    const pool = getPool();
    let result = await pool.request().query("SELECT TOP 1 TemplateId, Body FROM dbo.OfferLetterTemplate ORDER BY TemplateId");
    if (!result.recordset.length) {
      await pool.request().input("Body", sql.NVarChar(sql.MAX), DEFAULT_TEMPLATE_BODY)
        .query("INSERT INTO dbo.OfferLetterTemplate (Body) VALUES (@Body)");
      result = await pool.request().query("SELECT TOP 1 TemplateId, Body FROM dbo.OfferLetterTemplate ORDER BY TemplateId");
    }
    res.json(result.recordset[0]);
  } catch (err) {
    console.error("[offer-letter] GET template error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT -- update the offer-letter body template
router.put("/template", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const { Body } = req.body;
  if (!Body?.trim()) return res.status(400).json({ error: "Body is required" });
  const updatedBy = req.user?.userId || null;
  try {
    const pool = getPool();
    const existing = await pool.request().query("SELECT TOP 1 TemplateId FROM dbo.OfferLetterTemplate ORDER BY TemplateId");
    if (existing.recordset.length) {
      await pool
        .request()
        .input("Id", sql.Int, existing.recordset[0].TemplateId)
        .input("Body", sql.NVarChar(sql.MAX), Body)
        .input("UpdatedBy", sql.Int, updatedBy)
        .query("UPDATE dbo.OfferLetterTemplate SET Body = @Body, UpdatedBy = @UpdatedBy, UpdatedAt = SYSUTCDATETIME() WHERE TemplateId = @Id");
    } else {
      await pool
        .request()
        .input("Body", sql.NVarChar(sql.MAX), Body)
        .input("UpdatedBy", sql.Int, updatedBy)
        .query("INSERT INTO dbo.OfferLetterTemplate (Body, UpdatedBy, UpdatedAt) VALUES (@Body, @UpdatedBy, SYSUTCDATETIME())");
    }
    await bumpCacheVersion("offer-letter-template");
    res.json({ message: "Template updated successfully" });
  } catch (err) {
    console.error("[offer-letter] PUT template error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

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

// GET candidates whose Offer Letter & Joining is confirmed but who don't
// have an Employee Master record yet -- lets Employee Master's "Add
// Employee" form offer a manual pick as a fallback to the automatic
// creation that normally happens the moment joining is confirmed (e.g. if
// that auto-create failed, or the employee record was later deleted).
router.get("/unlinked-employees", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT
        o.OfferId, o.CandidateId, o.CompanyId, o.ActualDateOfJoining, o.CandidateAddress,
        c.CandidateCode, c.CandidateName, c.Contact, c.Email,
        comp.name AS CompanyName,
        des.DesignationName, dept.DepartmentName
      FROM dbo.OfferLetter o
      JOIN dbo.CandidateMaster c ON c.CandidateId = o.CandidateId
      LEFT JOIN dbo.enterprise comp ON comp.id = o.CompanyId
      LEFT JOIN dbo.DesignationMaster des ON des.Id = o.DesignationId
      LEFT JOIN dbo.DepartmentMaster dept ON dept.Id = des.DepartmentId
      WHERE o.JoiningConfirmed = 1
        AND NOT EXISTS (
          SELECT 1 FROM dbo.EmployeeMaster e WHERE e.CandidateId = o.CandidateId
        )
      ORDER BY o.ActualDateOfJoining DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[offer-letter] GET unlinked-employees error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST — add offer letter
router.post("/", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const { CandidateId, CompanyId, FinYearId, DesignationId, Salary, CandidateAddress, DateOfJoin, DocumentDate, Remarks } = req.body;
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
          .input("DesignationId", sql.Int, DesignationId || null)
          .input("Salary", sql.Decimal(12, 2), Salary ?? null)
          .input("CandidateAddress", sql.NVarChar(500), CandidateAddress || null)
          .input("DateOfJoin", sql.Date, DateOfJoin || null)
          .input("DocumentDate", sql.Date, DocumentDate)
          .input("Remarks", sql.NVarChar(1000), Remarks || null)
          .input("CreatedBy", sql.Int, createdBy)
          .query(`
            INSERT INTO dbo.OfferLetter (
              DocNo, CandidateId, CompanyId, FinYearId, DesignationId, Salary, CandidateAddress,
              DateOfJoin, DocumentDate, Remarks, CreatedBy, CreatedAt
            )
            OUTPUT INSERTED.OfferId
            VALUES (
              @DocNo, @CandidateId, @CompanyId, @FinYearId, @DesignationId, @Salary, @CandidateAddress,
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
  const { CandidateId, CompanyId, FinYearId, DesignationId, Salary, CandidateAddress, DateOfJoin, DocumentDate, Remarks } = req.body;
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
      .input("DesignationId", sql.Int, DesignationId || null)
      .input("Salary", sql.Decimal(12, 2), Salary ?? null)
      .input("CandidateAddress", sql.NVarChar(500), CandidateAddress || null)
      .input("DateOfJoin", sql.Date, DateOfJoin || null)
      .input("DocumentDate", sql.Date, DocumentDate)
      .input("Remarks", sql.NVarChar(1000), Remarks || null)
      .input("UpdatedBy", sql.Int, updatedBy)
      .query(`
        UPDATE dbo.OfferLetter SET
          CandidateId = @CandidateId, CompanyId = @CompanyId, FinYearId = @FinYearId, DesignationId = @DesignationId,
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

async function nextEmployeeCode(pool, sql) {
  const res = await pool.request().query(`
    SELECT ISNULL(MAX(TRY_CAST(SUBSTRING(EmployeeCode, 5, 10) AS INT)), 0) AS MaxSeq
    FROM dbo.EmployeeMaster WHERE EmployeeCode LIKE 'EMP-%'
  `);
  const next = (res.recordset[0].MaxSeq || 0) + 1;
  return `EMP-${String(next).padStart(5, "0")}`;
}

// Creates the Employee Master record for a just-joined candidate, if one
// doesn't already exist for them -- idempotent (safe to call every time
// joining is confirmed/re-confirmed), and never throws: a failure here
// must not roll back the joining confirmation that already committed.
async function autoCreateEmployeeFromOffer(pool, sql, offerId, createdBy) {
  const offerRes = await pool.request().input("Id", sql.Int, offerId).query(`
    SELECT
      o.CandidateId, o.CompanyId, o.ActualDateOfJoining, o.CandidateAddress,
      c.CandidateName, c.Contact, c.Email,
      des.DesignationName, dept.DepartmentName
    FROM dbo.OfferLetter o
    JOIN dbo.CandidateMaster c ON c.CandidateId = o.CandidateId
    LEFT JOIN dbo.DesignationMaster des ON des.Id = o.DesignationId
    LEFT JOIN dbo.DepartmentMaster dept ON dept.Id = des.DepartmentId
    WHERE o.OfferId = @Id
  `);
  const info = offerRes.recordset[0];
  if (!info) return null;

  const existingEmp = await pool.request().input("CandidateId", sql.Int, info.CandidateId)
    .query("SELECT EmployeeId FROM dbo.EmployeeMaster WHERE CandidateId = @CandidateId");
  if (existingEmp.recordset.length) return null;

  for (let attempt = 0; attempt < 5; attempt++) {
    const employeeCode = await nextEmployeeCode(pool, sql);
    const tx = pool.transaction();
    await tx.begin();
    try {
      const insertRes = await tx
        .request()
        .input("EmployeeCode", sql.NVarChar(30), employeeCode)
        .input("EmployeeName", sql.NVarChar(150), info.CandidateName)
        .input("Mobile", sql.NVarChar(20), info.Contact || null)
        .input("Email", sql.NVarChar(150), info.Email || null)
        .input("Address", sql.NVarChar(500), info.CandidateAddress || null)
        .input("JoiningDate", sql.Date, info.ActualDateOfJoining)
        .input("CompanyId", sql.Int, info.CompanyId || null)
        .input("Department", sql.NVarChar(100), info.DepartmentName || null)
        .input("Designation", sql.NVarChar(100), info.DesignationName || null)
        .input("CandidateId", sql.Int, info.CandidateId)
        .input("CreatedBy", sql.NVarChar(150), createdBy)
        .query(`
          INSERT INTO dbo.EmployeeMaster (
            EmployeeCode, EmployeeName, Mobile, Email, Address, JoiningDate, CompanyId, Department, Designation,
            CandidateId, IsActive, CreatedBy, CreatedAt
          )
          OUTPUT INSERTED.EmployeeId
          VALUES (
            @EmployeeCode, @EmployeeName, @Mobile, @Email, @Address, @JoiningDate, @CompanyId, @Department, @Designation,
            @CandidateId, 1, @CreatedBy, SYSDATETIME()
          )
        `);
      const newEmployeeId = insertRes.recordset[0].EmployeeId;
      await createEmployeeAccountHead(tx, newEmployeeId, {
        name: info.CandidateName, phone: info.Contact, email: info.Email, address: info.CandidateAddress, isActive: true,
      }, createdBy);
      await tx.commit();
      await bumpCacheVersion("account-head-master");
      return newEmployeeId;
    } catch (err) {
      await tx.rollback().catch(() => {});
      if (/UQ_EmployeeMaster_CandidateId/i.test(err.message || "")) return null; // race: another request created it first
      if (err.number === 2627 || err.number === 2601) continue; // EmployeeCode collision -- retry with the next serial
      throw err;
    }
  }
  return null;
}

// PATCH — confirm/record the actual joining date + remarks (Joining tab).
// Also auto-creates the Employee Master record for this candidate, so
// there's no separate manual "add to Employee Master" step afterwards.
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

    let employeeCreated = false;
    try {
      const createdBy = (req.user && (req.user.name || req.user.email)) || null;
      const newEmployeeId = await autoCreateEmployeeFromOffer(pool, sql, id, createdBy);
      if (newEmployeeId) {
        employeeCreated = true;
        await bumpCacheVersion("employee-master");
      }
    } catch (autoErr) {
      // The joining confirmation itself already succeeded -- log and move on
      // rather than surfacing a 500 for something the user already saw work.
      console.error("[offer-letter] auto-create Employee Master error:", autoErr.message);
    }

    res.json({
      message: employeeCreated
        ? "Joining confirmed and Employee Master record created"
        : "Joining confirmed successfully",
    });
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
