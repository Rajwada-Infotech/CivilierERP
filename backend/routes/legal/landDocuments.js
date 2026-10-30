"use strict";

// Land documents (pipeline step 6) — every document of one land property, with append-only versions.
//   GET  /:landId                     documents (current version, its review, version count) and the
//                                     required-document checklist with each item's state
//   GET  /doc/:docId/versions         every version of one document, newest first
//   POST /:landId                     add a document with its first version (file uploaded first via
//                                     POST /api/legal/masters/files)
//   POST /doc/:docId/versions         reattach: a new version; earlier versions stay as they were
//   POST /version/:versionId/review   Verified / Rejected / Reattachment Required / Pending (approve right)
//   POST /:landId/na                  mark a required document type Not Applicable, with a reason (approve)
//   DELETE /:landId/na/:docTypeId     undo that (approve)
// A review always belongs to one version, so a later upload never inherits an earlier approval.
// Required document types come from the land's checklist template (Land Property → Document checklist).

const express = require("express");
const { getPool, sql } = require("../../db");
const { requirePageRight, hasAnyPageAction } = require("../../middleware/requirePageRight");
const apiRateLimit = require("../../middleware/apiRateLimit");
const { writeAudit, nextCodeSql, codePrefix } = require("./legalAudit");

const router = express.Router();
router.use(apiRateLimit);

const PAGE = "legal-land-master";
const SECTIONS = ["Property", "Ownership", "Legal", "Purchase / Sale", "Registration"];
const REVIEWS = ["Pending", "Verified", "Rejected", "Reattachment Required"];

const idParam = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};
const text = (v, max) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const dateOrNull = (v) => {
  if (!v) return { value: null };
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? { value: s } : { error: "Document date is not valid" };
};
const approver = async (req, res) => {
  if (await hasAnyPageAction(req, PAGE, ["approve"])) return true;
  res.status(403).json({ error: "Only a reviewer (approve right on Land Property) can do this" });
  return false;
};

/**
 * The land's required documents and the state of each: Missing, Pending, Verified, Rejected,
 * Reattachment Required or Not Applicable. Also used by the pipeline's step-6 gate.
 */
async function requiredDocuments(conn, landId) {
  const r = await conn.request().input("Land", sql.Int, landId).query(`
    SELECT l.ChecklistTemplateId, t.TemplateName + ' v' + CAST(t.VersionNo AS NVARCHAR(10)) AS TemplateName
      FROM dbo.LegalLand l LEFT JOIN dbo.LegalChecklistTemplate t ON t.TemplateId = l.ChecklistTemplateId
      WHERE l.LandId = @Land;
    SELECT i.DocTypeId, dt.DocTypeName, i.Requirement, i.StageNeeded, i.AllowNA, i.Instructions,
           na.Reason AS NaReason,
           (SELECT TOP 1 v.ReviewStatus FROM dbo.LegalLandDocument d
              JOIN dbo.LegalLandDocumentVersion v ON v.DocumentId = d.DocumentId AND v.VersionNo = d.CurrentVersionNo
              WHERE d.LandId = @Land AND d.DocTypeId = i.DocTypeId AND d.IsActive = 1
              ORDER BY CASE v.ReviewStatus WHEN 'Verified' THEN 0 WHEN 'Pending' THEN 1 ELSE 2 END) AS BestStatus
    FROM dbo.LegalLand l
    JOIN dbo.LegalChecklistItem i ON i.TemplateId = l.ChecklistTemplateId AND i.IsActive = 1
    JOIN dbo.LegalDocumentType dt ON dt.DocTypeId = i.DocTypeId
    LEFT JOIN dbo.LegalLandDocumentNA na ON na.LandId = l.LandId AND na.DocTypeId = i.DocTypeId
    WHERE l.LandId = @Land
    ORDER BY i.SortOrder;`);
  const [head, items] = r.recordsets;
  return {
    templateId: head[0]?.ChecklistTemplateId ?? null,
    templateName: head[0]?.TemplateName ?? null,
    items: items.map((i) => ({
      docTypeId: i.DocTypeId, docTypeName: i.DocTypeName, requirement: i.Requirement, stage: i.StageNeeded,
      allowNA: !!i.AllowNA, instructions: i.Instructions, naReason: i.NaReason,
      state: i.NaReason ? "Not Applicable" : i.BestStatus || "Missing",
    })),
  };
}

/** What step 6 still needs: a checklist, and every Required document verified (or marked N/A). */
async function documentGate(conn, landId) {
  const req = await requiredDocuments(conn, landId);
  const missing = [];
  if (!req.templateId) missing.push("Choose the document checklist on the Land Property");
  for (const i of req.items.filter((x) => x.requirement === "Required")) {
    if (i.state === "Missing") missing.push(`${i.docTypeName} is not uploaded`);
    else if (i.state === "Pending") missing.push(`${i.docTypeName} is waiting for review`);
    else if (i.state === "Rejected" || i.state === "Reattachment Required") missing.push(`${i.docTypeName}: ${i.state.toLowerCase()}`);
  }
  const counts = { required: req.items.filter((x) => x.requirement === "Required").length, done: req.items.filter((x) => x.requirement === "Required" && ["Verified", "Not Applicable"].includes(x.state)).length };
  return { missing, counts };
}

router.get("/:landId", requirePageRight(PAGE, "view"), async (req, res) => {
  const landId = idParam(req.params.landId);
  if (!landId) return res.status(400).json({ error: "Invalid land" });
  try {
    const pool = getPool();
    const [docs, required] = await Promise.all([
      pool.request().input("Land", sql.Int, landId).query(`
        SELECT d.DocumentId, d.DocumentCode, d.DocTypeId, dt.DocTypeName, d.RelatedSection, d.Title, d.DocumentNo, d.DocumentDate,
               d.IssuingAuthority, d.CurrentVersionNo, d.Remarks, d.IsActive,
               v.VersionId, v.FileId, f.FileName, v.UploadedAt, v.ReviewStatus, v.ReviewedAt, v.ReviewRemarks,
               (SELECT name FROM dbo.users WHERE id = v.UploadedBy) AS UploadedByName,
               (SELECT name FROM dbo.users WHERE id = v.ReviewedBy) AS ReviewedByName,
               (SELECT COUNT(*) FROM dbo.LegalLandDocumentVersion x WHERE x.DocumentId = d.DocumentId) AS Versions
        FROM dbo.LegalLandDocument d
        JOIN dbo.LegalDocumentType dt ON dt.DocTypeId = d.DocTypeId
        JOIN dbo.LegalLandDocumentVersion v ON v.DocumentId = d.DocumentId AND v.VersionNo = d.CurrentVersionNo
        JOIN dbo.LegalMasterFile f ON f.FileId = v.FileId
        WHERE d.LandId = @Land
        ORDER BY d.RelatedSection, dt.DocTypeName, d.DocumentId`),
      requiredDocuments(pool, landId),
    ]);
    res.json({ documents: docs.recordset, required, sections: SECTIONS });
  } catch (err) {
    console.error("[legal-docs] list:", err.message);
    res.status(500).json({ error: "Could not load the documents" });
  }
});

router.get("/doc/:docId/versions", requirePageRight(PAGE, "view"), async (req, res) => {
  const docId = idParam(req.params.docId);
  if (!docId) return res.status(400).json({ error: "Invalid document" });
  try {
    const r = await getPool().request().input("Doc", sql.Int, docId).query(`
      SELECT v.VersionId, v.VersionNo, v.FileId, f.FileName, f.FileSize, v.UploadRemarks, v.UploadedAt, v.ReviewStatus, v.ReviewedAt, v.ReviewRemarks,
             (SELECT name FROM dbo.users WHERE id = v.UploadedBy) AS UploadedByName,
             (SELECT name FROM dbo.users WHERE id = v.ReviewedBy) AS ReviewedByName
      FROM dbo.LegalLandDocumentVersion v JOIN dbo.LegalMasterFile f ON f.FileId = v.FileId
      WHERE v.DocumentId = @Doc ORDER BY v.VersionNo DESC`);
    res.json(r.recordset);
  } catch (err) {
    console.error("[legal-docs] versions:", err.message);
    res.status(500).json({ error: "Could not load the versions" });
  }
});

router.post("/:landId", requirePageRight(PAGE, "edit"), async (req, res) => {
  const landId = idParam(req.params.landId);
  if (!landId) return res.status(400).json({ error: "Invalid land" });
  const b = req.body || {};
  const docTypeId = idParam(b.docTypeId);
  const fileId = idParam(b.fileId);
  const title = text(b.title, 200);
  const date = dateOrNull(b.documentDate);
  if (!docTypeId) return res.status(400).json({ error: "Choose the document type" });
  if (!SECTIONS.includes(b.relatedSection)) return res.status(400).json({ error: `Related section must be one of: ${SECTIONS.join(", ")}` });
  if (!title) return res.status(400).json({ error: "Enter the document title" });
  if (!fileId) return res.status(400).json({ error: "Upload the file" });
  if (date.error) return res.status(400).json({ error: date.error });

  const tx = new sql.Transaction(getPool());
  try {
    await tx.begin();
    const ok = (await tx.request().input("Land", sql.Int, landId).input("Type", sql.Int, docTypeId).input("File", sql.Int, fileId).query(`
      SELECT (SELECT COUNT(*) FROM dbo.LegalLand WHERE LandId = @Land) AS land,
             (SELECT COUNT(*) FROM dbo.LegalDocumentType WHERE DocTypeId = @Type AND IsActive = 1) AS type,
             (SELECT COUNT(*) FROM dbo.LegalMasterFile WHERE FileId = @File) AS f`)).recordset[0];
    const refuse = async (msg) => { await tx.rollback(); return res.status(400).json({ error: msg }); };
    if (!ok.land) return refuse("Land property not found");
    if (!ok.type) return refuse("Choose an active document type");
    if (!ok.f) return refuse("The uploaded file was not found — upload it again");
    const ins = await tx.request()
      .input("Prefix", sql.NVarChar(20), codePrefix("DOC"))
      .input("Land", sql.Int, landId).input("Type", sql.Int, docTypeId).input("Section", sql.NVarChar(30), b.relatedSection)
      .input("Title", sql.NVarChar(200), title).input("No", sql.NVarChar(100), text(b.documentNo, 100))
      .input("Date", sql.Date, date.value).input("Authority", sql.NVarChar(200), text(b.issuingAuthority, 200))
      .input("Remarks", sql.NVarChar(1000), text(b.remarks, 1000)).input("UserId", sql.Int, req.user?.userId || null)
      .query(`
        INSERT INTO dbo.LegalLandDocument (DocumentCode, LandId, DocTypeId, RelatedSection, Title, DocumentNo, DocumentDate, IssuingAuthority, CurrentVersionNo, Remarks, CreatedBy)
        OUTPUT INSERTED.DocumentId AS id, INSERTED.DocumentCode AS code
        SELECT ${nextCodeSql("LegalLandDocument", "DocumentCode", "@Prefix")}, @Land, @Type, @Section, @Title, @No, @Date, @Authority, 1, @Remarks, @UserId`);
    const doc = ins.recordset[0];
    await tx.request().input("Doc", sql.Int, doc.id).input("File", sql.Int, fileId).input("UserId", sql.Int, req.user?.userId || null)
      .query("INSERT INTO dbo.LegalLandDocumentVersion (DocumentId, VersionNo, FileId, UploadedBy) VALUES (@Doc, 1, @File, @UserId)");
    await writeAudit(tx, req, { action: "Document uploaded", entityType: "Land Document", entityId: doc.id, landId, newValue: { code: doc.code, title, version: 1 } });
    await tx.commit();
    res.status(201).json({ id: doc.id, message: `Document ${doc.code} added` });
  } catch (err) {
    try { await tx.rollback(); } catch { /* already rolled back */ }
    console.error("[legal-docs] add:", err.message);
    res.status(500).json({ error: "Could not add the document. Please try again." });
  }
});

router.post("/doc/:docId/versions", requirePageRight(PAGE, "edit"), async (req, res) => {
  const docId = idParam(req.params.docId);
  const fileId = idParam(req.body?.fileId);
  if (!docId) return res.status(400).json({ error: "Invalid document" });
  if (!fileId) return res.status(400).json({ error: "Upload the new file" });
  const tx = new sql.Transaction(getPool());
  try {
    await tx.begin();
    const d = (await tx.request().input("Doc", sql.Int, docId)
      .query("SELECT DocumentId, LandId, CurrentVersionNo, DocumentCode FROM dbo.LegalLandDocument WITH (UPDLOCK, ROWLOCK) WHERE DocumentId = @Doc")).recordset[0];
    if (!d) { await tx.rollback(); return res.status(404).json({ error: "Document not found" }); }
    const f = (await tx.request().input("File", sql.Int, fileId).query("SELECT 1 AS ok FROM dbo.LegalMasterFile WHERE FileId = @File")).recordset[0];
    if (!f) { await tx.rollback(); return res.status(400).json({ error: "The uploaded file was not found — upload it again" }); }
    const next = d.CurrentVersionNo + 1;
    await tx.request().input("Doc", sql.Int, docId).input("No", sql.Int, next).input("File", sql.Int, fileId)
      .input("Remarks", sql.NVarChar(500), text(req.body?.remarks, 500)).input("UserId", sql.Int, req.user?.userId || null)
      .query(`
        INSERT INTO dbo.LegalLandDocumentVersion (DocumentId, VersionNo, FileId, UploadRemarks, UploadedBy) VALUES (@Doc, @No, @File, @Remarks, @UserId);
        UPDATE dbo.LegalLandDocument SET CurrentVersionNo = @No, UpdatedBy = @UserId, UpdatedAt = SYSUTCDATETIME() WHERE DocumentId = @Doc;`);
    await writeAudit(tx, req, { action: "Document version added", entityType: "Land Document", entityId: docId, landId: d.LandId, oldValue: { version: d.CurrentVersionNo }, newValue: { version: next }, remarks: text(req.body?.remarks, 500) });
    await tx.commit();
    res.status(201).json({ message: `${d.DocumentCode}: version ${next} uploaded for review` });
  } catch (err) {
    try { await tx.rollback(); } catch { /* already rolled back */ }
    console.error("[legal-docs] version:", err.message);
    res.status(500).json({ error: "Could not upload the new version. Please try again." });
  }
});

router.post("/version/:versionId/review", requirePageRight(PAGE, "view"), async (req, res) => {
  const versionId = idParam(req.params.versionId);
  const status = req.body?.status;
  const remarks = text(req.body?.remarks, 1000);
  if (!versionId) return res.status(400).json({ error: "Invalid version" });
  if (!REVIEWS.includes(status)) return res.status(400).json({ error: `Review must be one of: ${REVIEWS.join(", ")}` });
  if (status !== "Verified" && status !== "Pending" && !remarks) return res.status(400).json({ error: "Say why the document is not accepted" });
  if (!(await approver(req, res))) return;
  try {
    const pool = getPool();
    const r = await pool.request().input("Id", sql.Int, versionId).input("Status", sql.NVarChar(30), status)
      .input("Remarks", sql.NVarChar(1000), remarks).input("UserId", sql.Int, req.user?.userId || null)
      .query(`
        UPDATE v SET ReviewStatus = @Status, ReviewRemarks = @Remarks,
                     ReviewedBy = CASE WHEN @Status = 'Pending' THEN NULL ELSE @UserId END,
                     ReviewedAt = CASE WHEN @Status = 'Pending' THEN NULL ELSE SYSUTCDATETIME() END
        OUTPUT DELETED.ReviewStatus AS prev, INSERTED.VersionNo AS no, d.LandId, d.DocumentId, d.DocumentCode
        FROM dbo.LegalLandDocumentVersion v JOIN dbo.LegalLandDocument d ON d.DocumentId = v.DocumentId
        WHERE v.VersionId = @Id`);
    const row = r.recordset[0];
    if (!row) return res.status(404).json({ error: "Version not found" });
    await writeAudit(pool, req, {
      action: status === "Verified" ? "Document verified" : status === "Pending" ? "Document review reset" : "Document rejected",
      entityType: "Land Document", entityId: row.DocumentId, landId: row.LandId,
      oldValue: { version: row.no, review: row.prev }, newValue: { version: row.no, review: status }, remarks,
    });
    res.json({ message: `${row.DocumentCode} v${row.no}: ${status}` });
  } catch (err) {
    console.error("[legal-docs] review:", err.message);
    res.status(500).json({ error: "Could not save the review" });
  }
});

router.post("/:landId/na", requirePageRight(PAGE, "view"), async (req, res) => {
  const landId = idParam(req.params.landId);
  const docTypeId = idParam(req.body?.docTypeId);
  const reason = text(req.body?.reason, 500);
  if (!landId || !docTypeId) return res.status(400).json({ error: "Invalid request" });
  if (!reason || reason.length < 5) return res.status(400).json({ error: "Give the reason it does not apply" });
  if (!(await approver(req, res))) return;
  try {
    const pool = getPool();
    const item = (await pool.request().input("Land", sql.Int, landId).input("Type", sql.Int, docTypeId).query(`
      SELECT i.AllowNA FROM dbo.LegalLand l JOIN dbo.LegalChecklistItem i ON i.TemplateId = l.ChecklistTemplateId AND i.DocTypeId = @Type AND i.IsActive = 1
      WHERE l.LandId = @Land`)).recordset[0];
    if (!item) return res.status(400).json({ error: "This document is not on the land's checklist" });
    if (!item.AllowNA) return res.status(409).json({ error: "The checklist does not allow this document to be marked Not Applicable" });
    await pool.request().input("Land", sql.Int, landId).input("Type", sql.Int, docTypeId).input("Reason", sql.NVarChar(500), reason).input("UserId", sql.Int, req.user?.userId || null)
      .query(`
        MERGE dbo.LegalLandDocumentNA AS t USING (SELECT @Land AS LandId, @Type AS DocTypeId) AS s ON t.LandId = s.LandId AND t.DocTypeId = s.DocTypeId
        WHEN MATCHED THEN UPDATE SET Reason = @Reason, MarkedBy = @UserId, MarkedAt = SYSUTCDATETIME()
        WHEN NOT MATCHED THEN INSERT (LandId, DocTypeId, Reason, MarkedBy) VALUES (@Land, @Type, @Reason, @UserId);`);
    await writeAudit(pool, req, { action: "Document marked not applicable", entityType: "Land Document", landId, newValue: { docTypeId }, remarks: reason });
    res.json({ message: "Marked Not Applicable" });
  } catch (err) {
    console.error("[legal-docs] na:", err.message);
    res.status(500).json({ error: "Could not save" });
  }
});

router.delete("/:landId/na/:docTypeId", requirePageRight(PAGE, "view"), async (req, res) => {
  const landId = idParam(req.params.landId);
  const docTypeId = idParam(req.params.docTypeId);
  if (!landId || !docTypeId) return res.status(400).json({ error: "Invalid request" });
  if (!(await approver(req, res))) return;
  try {
    const pool = getPool();
    const r = await pool.request().input("Land", sql.Int, landId).input("Type", sql.Int, docTypeId)
      .query("DELETE FROM dbo.LegalLandDocumentNA OUTPUT DELETED.Reason WHERE LandId = @Land AND DocTypeId = @Type");
    if (!r.recordset.length) return res.status(404).json({ error: "Not marked Not Applicable" });
    await writeAudit(pool, req, { action: "Document required again", entityType: "Land Document", landId, oldValue: { docTypeId, reason: r.recordset[0].Reason } });
    res.json({ message: "Required again" });
  } catch (err) {
    console.error("[legal-docs] na undo:", err.message);
    res.status(500).json({ error: "Could not save" });
  }
});

module.exports = router;
module.exports.documentGate = documentGate;
