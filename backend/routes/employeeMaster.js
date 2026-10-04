const express = require("express");
const router = express.Router();
const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const { requirePageRight } = require("../middleware/requirePageRight");
const { pickStructureVersion, calculateStructure } = require("../lib/formulaEngine");
const salaryStructureRoutes = require("./salaryStructure");
const { createEmployeeAccountHead, syncEmployeeAccountHead, deleteAccountHeadById } = require("../services/employeeAccountHead");

const headFields = (body) => ({
  name: body.EmployeeName, phone: body.Mobile, email: body.Email, address: body.Address, isActive: body.IsActive !== false,
});

const SELECT_COLUMNS = "e.EmployeeId, e.EmployeeCode, e.EmployeeName, e.PhotoBase64, e.DateOfBirth, e.Gender, e.Mobile, e.Email, e.Address, e.EmergencyContactName, e.EmergencyContactPhone, e.JoiningDate, e.ConfirmationDate, e.CompanyId, comp.name AS CompanyName, e.Department, e.Designation, e.BranchLocation, e.ReportingManagerId, mgr.EmployeeName AS ReportingManagerName, e.EmploymentType, e.GradeLevel, e.CostCenterId, cc.Name AS CostCenterName, e.CandidateId, cand.CandidateCode AS CandidateCode, cand.CandidateName AS CandidateName, e.BankName, e.BankAccountNumber, e.BankIFSC, e.PAN, e.Aadhaar, e.UAN, e.ESICNumber, e.PFNumber, e.NomineeName, e.NomineeRelationship, e.NomineeContact, e.CTCAmount, e.CTCFrequency, e.SalaryStructureCode, e.IsActive, e.CreatedBy, e.CreatedAt, e.UpdatedBy, e.UpdatedAt, (SELECT COUNT(*) FROM dbo.EmployeeDocuments d WHERE d.EmployeeId = e.EmployeeId) AS DocumentCount";

router.get("/", cache("employee-master", 300), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(
      "SELECT " + SELECT_COLUMNS + " FROM dbo.EmployeeMaster e " +
      "LEFT JOIN dbo.EmployeeMaster mgr ON mgr.EmployeeId = e.ReportingManagerId " +
      "LEFT JOIN dbo.CostCenter cc ON cc.CostCenterId = e.CostCenterId " +
      "LEFT JOIN dbo.enterprise comp ON comp.id = e.CompanyId " +
      "LEFT JOIN dbo.CandidateMaster cand ON cand.CandidateId = e.CandidateId " +
      "ORDER BY e.EmployeeName"
    );
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/options", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(
      "SELECT EmployeeId AS id, EmployeeName AS label, EmployeeCode AS code FROM dbo.EmployeeMaster WHERE IsActive = 1 ORDER BY EmployeeName"
    );
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function bindEmployeeFields(request, body) {
  return request
    .input("EmployeeCode", sql.NVarChar(30), body.EmployeeCode || null)
    .input("EmployeeName", sql.NVarChar(150), body.EmployeeName || null)
    .input("PhotoBase64", sql.NVarChar(sql.MAX), body.PhotoBase64 || null)
    .input("DateOfBirth", sql.Date, body.DateOfBirth || null)
    .input("Gender", sql.NVarChar(20), body.Gender || null)
    .input("Mobile", sql.NVarChar(20), body.Mobile || null)
    .input("Email", sql.NVarChar(150), body.Email || null)
    .input("Address", sql.NVarChar(500), body.Address || null)
    .input("EmergencyContactName", sql.NVarChar(150), body.EmergencyContactName || null)
    .input("EmergencyContactPhone", sql.NVarChar(20), body.EmergencyContactPhone || null)
    .input("JoiningDate", sql.Date, body.JoiningDate || null)
    .input("ConfirmationDate", sql.Date, body.ConfirmationDate || null)
    .input("CompanyId", sql.Int, body.CompanyId || null)
    .input("Department", sql.NVarChar(100), body.Department || null)
    .input("Designation", sql.NVarChar(100), body.Designation || null)
    .input("BranchLocation", sql.NVarChar(150), body.BranchLocation || null)
    .input("ReportingManagerId", sql.Int, body.ReportingManagerId || null)
    .input("EmploymentType", sql.NVarChar(30), body.EmploymentType || null)
    .input("GradeLevel", sql.NVarChar(50), body.GradeLevel || null)
    .input("CostCenterId", sql.Int, body.CostCenterId || null)
    .input("CandidateId", sql.Int, body.CandidateId || null)
    .input("BankName", sql.NVarChar(150), body.BankName || null)
    .input("BankAccountNumber", sql.NVarChar(40), body.BankAccountNumber || null)
    .input("BankIFSC", sql.NVarChar(20), body.BankIFSC || null)
    .input("PAN", sql.NVarChar(20), body.PAN || null)
    .input("Aadhaar", sql.NVarChar(20), body.Aadhaar || null)
    .input("UAN", sql.NVarChar(20), body.UAN || null)
    .input("ESICNumber", sql.NVarChar(30), body.ESICNumber || null)
    .input("PFNumber", sql.NVarChar(30), body.PFNumber || null)
    .input("NomineeName", sql.NVarChar(150), body.NomineeName || null)
    .input("NomineeRelationship", sql.NVarChar(50), body.NomineeRelationship || null)
    .input("NomineeContact", sql.NVarChar(20), body.NomineeContact || null)
    .input("CTCAmount", sql.Decimal(18, 2), body.CTCAmount === "" || body.CTCAmount == null ? null : Number(body.CTCAmount))
    .input("CTCFrequency", sql.NVarChar(10), body.CTCFrequency || null)
    .input("SalaryStructureCode", sql.NVarChar(30), body.SalaryStructureCode || null)
    .input("IsActive", sql.Bit, body.IsActive !== false ? 1 : 0);
}

router.post("/", requirePageRight("employee-master", "create"), async (req, res) => {
  const EmployeeCode = req.body.EmployeeCode;
  const EmployeeName = req.body.EmployeeName;
  if (!EmployeeCode || !EmployeeName)
    return res.status(400).json({ error: "Employee Code and Employee Name are required" });
  try {
    const pool = getPool();
    const actor = (req.user && (req.user.name || req.user.email)) || null;
    const tx = pool.transaction();
    await tx.begin();
    let newId;
    try {
    let request = tx.request();
    request = bindEmployeeFields(request, req.body);
    const result = await request
      .input("CreatedBy", sql.NVarChar(150), actor)
      .query(
        "INSERT INTO dbo.EmployeeMaster (" +
        "EmployeeCode, EmployeeName, PhotoBase64, DateOfBirth, Gender, Mobile, Email, Address, " +
        "EmergencyContactName, EmergencyContactPhone, JoiningDate, ConfirmationDate, CompanyId, " +
        "Department, Designation, BranchLocation, ReportingManagerId, EmploymentType, GradeLevel, " +
        "CostCenterId, CandidateId, BankName, BankAccountNumber, BankIFSC, PAN, Aadhaar, UAN, ESICNumber, PFNumber, " +
        "NomineeName, NomineeRelationship, NomineeContact, CTCAmount, CTCFrequency, SalaryStructureCode, IsActive, CreatedBy, CreatedAt" +
        ") OUTPUT INSERTED.EmployeeId VALUES (" +
        "@EmployeeCode, @EmployeeName, @PhotoBase64, @DateOfBirth, @Gender, @Mobile, @Email, @Address, " +
        "@EmergencyContactName, @EmergencyContactPhone, @JoiningDate, @ConfirmationDate, @CompanyId, " +
        "@Department, @Designation, @BranchLocation, @ReportingManagerId, @EmploymentType, @GradeLevel, " +
        "@CostCenterId, @CandidateId, @BankName, @BankAccountNumber, @BankIFSC, @PAN, @Aadhaar, @UAN, @ESICNumber, @PFNumber, " +
        "@NomineeName, @NomineeRelationship, @NomineeContact, @CTCAmount, @CTCFrequency, @SalaryStructureCode, @IsActive, @CreatedBy, SYSDATETIME())"
      );
    newId = result.recordset[0].EmployeeId;
    await createEmployeeAccountHead(tx, newId, headFields(req.body), actor);
    await tx.commit();
    } catch (e) { await tx.rollback(); throw e; }
    await bumpCacheVersion("employee-master");
    await bumpCacheVersion("account-head-master");
    res.json({ message: "Employee added", id: newId });
  } catch (err) {
    if (err.number === 2627 || err.number === 2601) {
      if (/UQ_EmployeeMaster_CandidateId/i.test(err.message || "")) {
        return res.status(409).json({ error: "This candidate has already been added as an employee" });
      }
      return res.status(409).json({ error: "An employee with this Employee Code already exists" });
    }
    res.status(500).json({ error: err.message });
  }
});

router.put("/:id", requirePageRight("employee-master", "edit"), async (req, res) => {
  const EmployeeCode = req.body.EmployeeCode;
  const EmployeeName = req.body.EmployeeName;
  if (!EmployeeCode || !EmployeeName)
    return res.status(400).json({ error: "Employee Code and Employee Name are required" });
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
    if (req.body.ReportingManagerId && Number(req.body.ReportingManagerId) === id)
      return res.status(400).json({ error: "An employee cannot report to themselves" });
    const pool = getPool();
    const actor = (req.user && (req.user.name || req.user.email)) || null;
    const tx = pool.transaction();
    await tx.begin();
    try {
    let request = tx.request().input("EmployeeId", sql.Int, id);
    request = bindEmployeeFields(request, req.body);
    const upd = await request
      .input("UpdatedBy", sql.NVarChar(150), actor)
      .query(
        "UPDATE dbo.EmployeeMaster SET " +
        "EmployeeCode = @EmployeeCode, EmployeeName = @EmployeeName, PhotoBase64 = @PhotoBase64, " +
        "DateOfBirth = @DateOfBirth, Gender = @Gender, Mobile = @Mobile, Email = @Email, Address = @Address, " +
        "EmergencyContactName = @EmergencyContactName, EmergencyContactPhone = @EmergencyContactPhone, " +
        "JoiningDate = @JoiningDate, ConfirmationDate = @ConfirmationDate, CompanyId = @CompanyId, " +
        "Department = @Department, Designation = @Designation, BranchLocation = @BranchLocation, " +
        "ReportingManagerId = @ReportingManagerId, EmploymentType = @EmploymentType, GradeLevel = @GradeLevel, " +
        "CostCenterId = @CostCenterId, CandidateId = @CandidateId, BankName = @BankName, BankAccountNumber = @BankAccountNumber, BankIFSC = @BankIFSC, " +
        "PAN = @PAN, Aadhaar = @Aadhaar, UAN = @UAN, ESICNumber = @ESICNumber, PFNumber = @PFNumber, " +
        "NomineeName = @NomineeName, NomineeRelationship = @NomineeRelationship, NomineeContact = @NomineeContact, " +
        "CTCAmount = @CTCAmount, CTCFrequency = @CTCFrequency, SalaryStructureCode = @SalaryStructureCode, " +
        "IsActive = @IsActive, UpdatedBy = @UpdatedBy, UpdatedAt = SYSDATETIME() " +
        "WHERE EmployeeId = @EmployeeId"
      );
    if (upd.rowsAffected[0] > 0) await syncEmployeeAccountHead(tx, id, headFields(req.body), actor);
    await tx.commit();
    } catch (e) { await tx.rollback(); throw e; }
    await bumpCacheVersion("employee-master");
    await bumpCacheVersion("account-head-master");
    res.json({ message: "Employee updated" });
  } catch (err) {
    if (err.number === 2627 || err.number === 2601) {
      if (/UQ_EmployeeMaster_CandidateId/i.test(err.message || "")) {
        return res.status(409).json({ error: "This candidate has already been added as an employee" });
      }
      return res.status(409).json({ error: "An employee with this Employee Code already exists" });
    }
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:id", requirePageRight("employee-master", "delete"), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
    const pool = getPool();
    const tx = pool.transaction();
    await tx.begin();
    try {
      const cur = await tx.request().input("EmployeeId", sql.Int, id)
        .query("SELECT AccountHeadId FROM dbo.EmployeeMaster WHERE EmployeeId = @EmployeeId");
      if (!cur.recordset.length) { await tx.rollback(); return res.status(404).json({ error: "Employee not found" }); }
      const headId = cur.recordset[0].AccountHeadId;
      await tx.request().input("EmployeeId", sql.Int, id)
        .query("UPDATE dbo.EmployeeMaster SET ReportingManagerId = NULL WHERE ReportingManagerId = @EmployeeId");
      await tx.request().input("EmployeeId", sql.Int, id)
        .query("DELETE FROM dbo.EmployeeMaster WHERE EmployeeId = @EmployeeId");
      // The employee's Account Head goes with it (hard delete) -- in the same
      // transaction, so a head already used by a ledger/payment blocks the
      // whole delete instead of leaving an orphan or a dangling reference.
      await deleteAccountHeadById(tx, headId);
      await tx.commit();
    } catch (e) { await tx.rollback(); throw e; }
    await bumpCacheVersion("employee-master");
    await bumpCacheVersion("account-head-master");
    res.json({ message: "Employee deleted" });
  } catch (err) {
    if (err.number === 547) {
      return res.status(409).json({ error: "This employee can't be deleted — their account head is already used in ledger, payroll or payment entries." });
    }
    res.status(500).json({ error: err.message });
  }
});

router.get("/:id/documents", requirePageRight("employee-master", "view"), async (req, res) => {
  const employeeId = parseInt(req.params.id, 10);
  if (!Number.isFinite(employeeId)) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const result = await pool.request().input("EmployeeId", sql.Int, employeeId).query(
      "SELECT AttachmentId, EmployeeId, DocType, FileName, MimeType, FileSize, UploadedBy, UploadedAt " +
      "FROM dbo.EmployeeDocuments WHERE EmployeeId = @EmployeeId ORDER BY UploadedAt DESC"
    );
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/:id/documents", requirePageRight("employee-master", "edit"), upload.single("file"), async (req, res) => {
  const employeeId = parseInt(req.params.id, 10);
  const actor = (req.user && (req.user.email || req.user.name)) || "system";
  if (!Number.isFinite(employeeId)) return res.status(400).json({ error: "Invalid id" });
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  try {
    const pool = getPool();
    const empRes = await pool.request().input("EmployeeId", sql.Int, employeeId)
      .query("SELECT EmployeeId FROM dbo.EmployeeMaster WHERE EmployeeId = @EmployeeId");
    if (!empRes.recordset[0]) return res.status(404).json({ error: "Employee not found" });

    const insertRes = await pool
      .request()
      .input("EmployeeId", sql.Int, employeeId)
      .input("DocType", sql.NVarChar(30), req.body.docType || "Other")
      .input("FileName", sql.NVarChar(255), req.file.originalname)
      .input("MimeType", sql.NVarChar(100), req.file.mimetype)
      .input("FileSize", sql.Int, req.file.size)
      .input("FileData", sql.VarBinary(sql.MAX), req.file.buffer)
      .input("UploadedBy", sql.NVarChar(150), actor)
      .query(
        "INSERT INTO dbo.EmployeeDocuments (EmployeeId, DocType, FileName, MimeType, FileSize, FileData, UploadedBy) " +
        "OUTPUT INSERTED.AttachmentId VALUES (@EmployeeId, @DocType, @FileName, @MimeType, @FileSize, @FileData, @UploadedBy)"
      );
    const attachId = insertRes.recordset[0].AttachmentId;
    await bumpCacheVersion("employee-master");
    res.status(201).json({ attachmentId: attachId, fileName: req.file.originalname });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/document/:attachId", requirePageRight("employee-master", "view"), async (req, res) => {
  const attachId = parseInt(req.params.attachId, 10);
  if (!Number.isFinite(attachId)) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const result = await pool.request().input("AttachmentId", sql.Int, attachId)
      .query("SELECT FileName, MimeType, FileData FROM dbo.EmployeeDocuments WHERE AttachmentId = @AttachmentId");
    const attachment = result.recordset[0];
    if (!attachment) return res.status(404).json({ error: "Attachment not found" });
    res.setHeader("Content-Type", attachment.MimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", "inline; filename=\"" + encodeURIComponent(attachment.FileName) + "\"");
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.send(attachment.FileData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/document/:attachId", requirePageRight("employee-master", "edit"), async (req, res) => {
  const attachId = parseInt(req.params.attachId, 10);
  if (!Number.isFinite(attachId)) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const delResult = await pool.request().input("AttachmentId", sql.Int, attachId)
      .query("DELETE FROM dbo.EmployeeDocuments WHERE AttachmentId = @AttachmentId");
    if (delResult.rowsAffected[0] === 0)
      return res.status(404).json({ error: "Attachment not found" });
    await bumpCacheVersion("employee-master");
    res.json({ message: "Document removed" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET the calculated salary breakup for one employee, using their own
// CTC + the Salary Structure version applicable on `asOfDate` (default
// today) -- spec 6's ad-hoc "Employee Salary Details", no payroll run
// required. Reuses the exact same formula engine Payroll Run uses.
router.get("/:id/salary-breakup", requirePageRight("employee-master", "view"), async (req, res) => {
  const employeeId = parseInt(req.params.id, 10);
  if (!Number.isFinite(employeeId)) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const empRes = await pool.request().input("Id", sql.Int, employeeId)
      .query("SELECT EmployeeId, EmployeeName, CTCAmount, CTCFrequency, SalaryStructureCode FROM dbo.EmployeeMaster WHERE EmployeeId = @Id");
    const emp = empRes.recordset[0];
    if (!emp) return res.status(404).json({ error: "Employee not found" });
    if (emp.CTCAmount == null || !emp.CTCFrequency) {
      return res.status(400).json({ error: "Employee does not have a CTC configured" });
    }
    if (!emp.SalaryStructureCode) {
      return res.status(400).json({ error: "Employee does not have a Salary Structure assigned" });
    }

    const asOfDate = req.query.asOfDate ? new Date(String(req.query.asOfDate)) : new Date();
    const versionsRes = await pool.request().input("Code", sql.NVarChar(30), emp.SalaryStructureCode)
      .query(`${salaryStructureRoutes.HEADER_SELECT} WHERE s.Code = @Code`);
    const structure = pickStructureVersion(versionsRes.recordset, asOfDate);
    if (!structure) {
      return res.status(400).json({
        error: `No active Salary Structure version found for code "${emp.SalaryStructureCode}" as of ${asOfDate.toISOString().slice(0, 10)}`,
      });
    }

    const linesRes = await pool.request().input("Id", sql.Int, structure.SalaryStructureId)
      .query(`${salaryStructureRoutes.LINES_SELECT} WHERE l.SalaryStructureId = @Id ORDER BY l.Sequence, l.LineId`);
    const { engineLines } = await salaryStructureRoutes.buildEngineLines(pool, linesRes.recordset);

    const result = calculateStructure(engineLines, Number(emp.CTCAmount), emp.CTCFrequency, structure.CTCFrequency);
    res.json({
      EmployeeId: emp.EmployeeId,
      EmployeeName: emp.EmployeeName,
      SalaryStructureId: structure.SalaryStructureId,
      SalaryStructureName: structure.Name,
      SalaryStructureVersion: structure.Version,
      ...result,
    });
  } catch (err) {
    console.error("[employee-master] GET /salary-breakup error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
