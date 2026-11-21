"use strict";
// Amendments to a registered land (migration 698). A Registered land is locked; a change goes through here:
//   GET  /fields                 the fields an amendment may change, and the amendment types
//   GET  /pending                every amendment waiting for a decision (for Amendment Approvers)
//   GET  /land/:landId           one land's amendments
//   POST /land/:landId           ask for an amendment  { type, reason, referenceNo, changes: [{ field, to }] }
//   POST /:id/approve            { remarks } — applies the changes, saves the land as a new "after registration" version
//   POST /:id/reject             { remarks }
//   POST /:id/withdraw           the requester takes it back
// Approving needs the "Amendment Approver" role (Setup → Approval Control); the requester never approves their own.
const express = require("express");
const { getPool, sql } = require("../../db");
const { requirePageRight } = require("../../middleware/requirePageRight");
const apiRateLimit = require("../../middleware/apiRateLimit");
const { canAct, ownWork, userOf } = require("./approvalAuthority");
const { writeAudit, nextCodeSql, codePrefix } = require("./legalAudit");
const { pageable } = require("./paging");
const router = express.Router();
router.use(apiRateLimit);
const PAGE = "legal-land-master";
const STAGE = "Amendment Approver";

const TYPES = ["Clerical correction", "Mutation / LR record update", "Resurvey / area correction", "Conversion of land type", "Court order", "Boundary correction", "Other"];
// Plain fields of the land that an amendment may change: [column, label, kind, max/options]
const FIELDS = [
  ["LandName", "Land title / name", "text", 200], ["RsKhatianNo", "RS Khatian number", "text", 50], ["RsDagNo", "RS Dag / Plot number", "text", 50],
  ["LrKhatianNo", "LR Khatian number", "text", 50], ["LrDagNo", "LR Dag / Plot number", "text", 50], ["Area", "Total land area", "number"],
  ["LandStatus", "Land status", "select", ["Owned", "Active", "Registered", "Mutated", "In Dispute", "On Hold", "Disposed / Transferred", "Inactive"]],
  ["PossessionStatus", "Possession status", "select", ["In Possession", "Partly in Possession", "Not in Possession", "Disputed", "Unknown"]],
  ["LocationAddress", "Land location (full address)", "text", 500], ["NorthBoundary", "North boundary", "text", 300], ["SouthBoundary", "South boundary", "text", 300],
  ["EastBoundary", "East boundary", "text", 300], ["WestBoundary", "West boundary", "text", 300], ["GpsLatitude", "GPS latitude", "number"], ["GpsLongitude", "GPS longitude", "number"],
  ["Remarks", "Remarks", "text", 1000],
].map(([field, label, kind, extra]) => ({ field, label, kind, ...(Array.isArray(extra) ? { options: extra } : extra ? { max: extra } : {}) }));
const FIELD = Object.fromEntries(FIELDS.map((f) => [f.field, f]));

// Record sections an amendment may add to, edit or remove from. Columns: [column, label, kind, max | options, required]
const col = (name, label, kind, extra, required) => ({ name, label, kind, ...(Array.isArray(extra) ? { options: extra } : extra ? { max: extra } : {}), required: !!required });
const DOC_SECTIONS = ["Property", "Ownership", "Legal", "Purchase / Sale", "Registration", "Loan & Mortgage", "Mutation", "Payment", "Tax", "Survey & Valuation", "Other"];
const CLEARANCE_STATUS = ["Not Applied", "Applied", "Under Processing", "Obtained", "Rejected"];
const SECTIONS = {
  rs: { title: "RS record", table: "LegalLandRsRecord", pk: "RsRecordId", ops: ["add", "edit", "remove"],
    cols: [col("RsKhatianNo", "RS Khatian", "text", 50, true), col("RsDagNo", "RS Dag", "text", 50, true), col("RecordedHolder", "Recorded holder", "text", 200), col("Area", "Area", "number"), col("Share", "Share", "text", 60), col("Remarks", "Remarks", "text", 500)],
    name: (r) => `Khatian ${r.RsKhatianNo ?? "—"} / Dag ${r.RsDagNo ?? "—"}` },
  lr: { title: "LR record", table: "LegalLandLrRecord", pk: "LrRecordId", ops: ["add", "edit", "remove"],
    cols: [col("LrKhatianNo", "LR Khatian", "text", 50, true), col("LrDagNo", "LR Dag", "text", 50, true), col("RecordedHolder", "Recorded holder", "text", 200), col("GuardianName", "Father / husband", "text", 200), col("Area", "Area", "number"), col("Share", "Share", "text", 60), col("Remarks", "Remarks", "text", 500)],
    name: (r) => `Khatian ${r.LrKhatianNo ?? "—"} / Dag ${r.LrDagNo ?? "—"}` },
  owner: { title: "Owner", table: "LegalOwnershipRecord", pk: "RecordId", ops: ["add", "edit", "remove"],
    cols: [col("OwnerName", "Owner name", "text", 200, true), col("OwnerGuardian", "Father / husband", "text", 200), col("SharePct", "Share %", "number", null, true), col("ValidFrom", "Owner from", "date", null, true)],
    name: (r) => `${r.OwnerName ?? "—"}${r.SharePct != null ? ` (${Number(r.SharePct)}%)` : ""}` },
  mutation: { title: "Mutation", table: "LegalMutation", pk: "MutationId", ops: ["add", "edit", "remove"],
    cols: [col("ApplicationNo", "Application no.", "text", 100), col("ApplicationDate", "Application date", "date"), col("OfficeName", "Office", "text", 200, true), col("ApplicationStatus", "Status", "text", 80),
      col("PreviousKhatian", "Previous khatian", "text", 100), col("NewOwner", "New owner", "text", 300, true), col("OrderNo", "Order no.", "text", 100), col("OrderDate", "Order date", "date"), col("CaseNo", "Case no.", "text", 100)],
    name: (r) => `${r.ApplicationNo ?? "Mutation"}${r.ApplicationStatus ? ` · ${r.ApplicationStatus}` : ""}` },
  clearance: { title: "Clearance", table: "LegalLandClearance", pk: "Kind", ops: ["edit"],
    cols: [col("Status", "Status", "select", CLEARANCE_STATUS, true), col("AppliedOn", "Applied on", "date"), col("ApplicationNo", "Application no.", "text", 100), col("ObtainedOn", "Obtained on", "date"), col("CertificateNo", "Certificate no.", "text", 100), col("FileId", "Certificate file", "file")],
    name: (r) => `${r.Kind} clearance` },
  document: { title: "Document", table: "LegalLandDocument", pk: "DocumentId", ops: ["add", "file", "remove"],
    cols: [col("DocTypeId", "Document type", "doctype", null, true), col("RelatedSection", "Section", "select", DOC_SECTIONS, true), col("Title", "Title", "text", 200, true), col("DocumentNo", "Document no.", "text", 100), col("DocumentDate", "Document date", "date"), col("FileId", "File", "file", null, true)],
    name: (r) => `${r.DocumentCode ?? "New document"} ${r.Title ?? ""}`.trim() },
};
const pickCols = (spec, row) => Object.fromEntries(spec.cols.map((c) => { const v = row?.[c.name] ?? null; return [c.name, v instanceof Date ? v.toISOString().slice(0, 10) : c.kind === "number" && v != null ? Number(v) : v]; }));

/** One value checked against its column; returns [value] or throws a message. */
function cleanValue(c, raw) {
  if (raw === undefined || raw === null || String(raw).trim() === "") { if (c.required) throw `${c.label} is required`; return null; }
  const v = String(raw).trim();
  if (c.kind === "number") { const n = Number(v); if (!Number.isFinite(n)) throw `${c.label} must be a number`; return n; }
  if (c.kind === "date") { if (!/^\d{4}-\d{2}-\d{2}/.test(v) || Number.isNaN(+new Date(v))) throw `${c.label} must be a date`; return v.slice(0, 10); }
  if (c.kind === "file" || c.kind === "doctype") { const n = idParam(v); if (!n) throw `${c.label} is not valid`; return n; }
  if (c.options && !c.options.includes(v)) throw `Choose a valid ${c.label}`;
  if (c.max && v.length > c.max) throw `${c.label} is too long`;
  return v;
}

/** The land's current rows of every section, for the request form and for checking requests. */
async function currentRows(pool, landId) {
  const q = async (text) => { try { return (await pool.request().input("L", sql.Int, landId).query(text)).recordset; } catch { return []; } };
  return {
    rs: await q("SELECT RsRecordId AS id, * FROM dbo.LegalLandRsRecord WHERE LandId = @L AND IsActive = 1 ORDER BY RsRecordId"),
    lr: await q("SELECT LrRecordId AS id, * FROM dbo.LegalLandLrRecord WHERE LandId = @L AND IsActive = 1 ORDER BY LrRecordId"),
    owner: await q("SELECT RecordId AS id, * FROM dbo.LegalOwnershipRecord WHERE LandId = @L AND IsActive = 1 AND ValidTo IS NULL ORDER BY ValidFrom, RecordId"),
    mutation: await q("SELECT MutationId AS id, * FROM dbo.LegalMutation WHERE LandId = @L AND IsActive = 1 ORDER BY MutationId"),
    clearance: (await q("SELECT Kind AS id, * FROM dbo.LegalLandClearance WHERE LandId = @L"))
      .concat(["LA", "ULC"].map((k) => ({ id: k, Kind: k, Status: "Not Applied" }))).filter((r, i, a) => a.findIndex((x) => x.Kind === r.Kind) === i),
    document: await q(`SELECT d.DocumentId AS id, d.DocumentCode, d.DocTypeId, t.DocTypeName, d.RelatedSection, d.Title, d.DocumentNo, d.DocumentDate, d.CurrentVersionNo
                       FROM dbo.LegalLandDocument d LEFT JOIN dbo.LegalDocumentType t ON t.DocTypeId = d.DocTypeId WHERE d.LandId = @L AND d.IsActive = 1 ORDER BY d.DocumentId`),
  };
}

/** Is this land registered (so locked)? Used by the other Legal screens to refuse direct edits. */
async function isLocked(pool, landId) {
  if (!landId) return false;
  const r = await pool.request().input("L", sql.Int, landId).query("SELECT WorkflowStatus FROM dbo.LegalLand WHERE LandId = @L");
  if (r.recordset[0]?.WorkflowStatus !== "Registered") return false;
  // An approved amendment opens the land for editing until its edits are approved as a version (Status Completed).
  const open = await pool.request().input("L", sql.Int, landId).query(
    "IF OBJECT_ID(N'dbo.LegalLandAmendment', N'U') IS NULL SELECT 0 AS n ELSE SELECT COUNT(*) AS n FROM dbo.LegalLandAmendment WHERE LandId = @L AND Status = N'Open'");
  return !open.recordset[0].n;
}
const LOCK_MSG = "This land is registered and locked. Use Request amendment (Legal Flow Chart) to change it.";

const idParam = (v) => { const n = Number.parseInt(v, 10); return Number.isInteger(n) && n > 0 ? n : null; };
const ready = async (pool) => !!(await pool.request().query("SELECT OBJECT_ID(N'dbo.LegalLandAmendment', N'U') AS t")).recordset[0].t;
const notReady = (res) => res.status(503).json({ error: "Amendments are not set up yet (migration 698)" });
const parse = (s) => { try { return JSON.parse(s); } catch { return []; } };

const SELECT = `
  SELECT a.AmendmentId, a.LandId, l.LandCode, l.LandName, l.ProjectId, a.AmendmentNo, a.AmendType, a.Reason, a.ChangesJson, a.ReferenceNo, a.Status,
         a.RequestedBy, ru.name AS RequestedByName, a.RequestedAt, a.DecidedBy, du.name AS DecidedByName, a.DecidedAt, a.DecisionRemarks, a.VersionNo
  FROM dbo.LegalLandAmendment a JOIN dbo.LegalLand l ON l.LandId = a.LandId
  LEFT JOIN dbo.users ru ON ru.id = a.RequestedBy LEFT JOIN dbo.users du ON du.id = a.DecidedBy`;
const shape = (r) => ({ ...r, changes: parse(r.ChangesJson), ChangesJson: undefined });

router.get("/fields", requirePageRight(PAGE, "view"), async (_req, res) => {
  const docTypes = await getPool().request().query("SELECT DocTypeId AS id, DocTypeName AS name FROM dbo.LegalDocumentType WHERE IsActive = 1 ORDER BY DocTypeName").then((r) => r.recordset).catch(() => []);
  const sections = Object.fromEntries(Object.entries(SECTIONS).map(([k, v]) => [k, { title: v.title, ops: v.ops, cols: v.cols }]));
  res.json({ fields: FIELDS, types: TYPES, sections, docTypes });
});

router.get("/pending", requirePageRight(PAGE, "view"), pageable("items"), async (req, res) => {
  try {
    const pool = getPool();
    if (!(await ready(pool))) return res.json({ items: [], canApprove: false });
    const r = await pool.request().query(`${SELECT} WHERE a.Status = N'Pending' ORDER BY a.RequestedAt`);
    res.json({ items: r.recordset.map(shape), canApprove: await canAct(req, STAGE, PAGE), userId: userOf(req) });
  } catch (err) {
    console.error("[legal-amendment] pending:", err.message);
    res.status(500).json({ error: "Could not load amendments" });
  }
});

router.get("/land/:landId", requirePageRight(PAGE, "view"), async (req, res) => {
  const landId = idParam(req.params.landId);
  if (!landId) return res.status(400).json({ error: "Invalid land" });
  try {
    const pool = getPool();
    if (!(await ready(pool))) return res.json({ items: [], canApprove: false, locked: false });
    const l = (await pool.request().input("L", sql.Int, landId).query(`SELECT WorkflowStatus, ${FIELDS.map((f) => `[${f.field}]`).join(", ")} FROM dbo.LegalLand WHERE LandId = @L`)).recordset[0];
    const r = await pool.request().input("L", sql.Int, landId).query(`${SELECT} WHERE a.LandId = @L ORDER BY a.AmendmentNo`);
    res.json({ items: r.recordset.map(shape), canApprove: await canAct(req, STAGE, PAGE), locked: l?.WorkflowStatus === "Registered", userId: userOf(req),
      current: l?.WorkflowStatus === "Registered" ? await currentRows(pool, landId) : null,
      land: l ? Object.fromEntries(FIELDS.map((f) => [f.field, l[f.field] ?? null])) : null });
  } catch (err) {
    console.error("[legal-amendment] land:", err.message);
    res.status(500).json({ error: "Could not load amendments" });
  }
});

router.post("/land/:landId", requirePageRight(PAGE, "edit"), async (req, res) => {
  const landId = idParam(req.params.landId);
  if (!landId) return res.status(400).json({ error: "Invalid land" });
  const b = req.body || {};
  const type = String(b.type || "").trim();
  const reason = String(b.reason || "").trim();
  const referenceNo = String(b.referenceNo || "").trim().slice(0, 150) || null;
  if (!TYPES.includes(type)) return res.status(400).json({ error: "Choose the amendment type" });
  if (reason.length < 5) return res.status(400).json({ error: "Write the reason for the amendment" });
  // Changes are optional: an amendment without them opens the land for editing once approved.
  if (b.changes !== undefined && !Array.isArray(b.changes)) return res.status(400).json({ error: "Invalid changes" });
  b.changes = b.changes || [];
  try {
    const pool = getPool();
    if (!(await ready(pool))) return notReady(res);
    const land = (await pool.request().input("L", sql.Int, landId).query("SELECT * FROM dbo.LegalLand WHERE LandId = @L AND IsActive = 1")).recordset[0];
    if (!land) return res.status(404).json({ error: "Land not found" });
    if (land.WorkflowStatus !== "Registered") return res.status(409).json({ error: "Only a registered land needs an amendment — edit this land directly" });
    const open = (await pool.request().input("L", sql.Int, landId).query("SELECT COUNT(*) AS n FROM dbo.LegalLandAmendment WHERE LandId = @L AND Status IN (N'Pending', N'Open')")).recordset[0].n;
    if (open) return res.status(409).json({ error: "This land already has an amendment waiting for approval" });
    const changes = [];
    const cur = await currentRows(pool, landId);
    for (const c of b.changes) {
      if (c?.section && c.section !== "land") {
        const spec = SECTIONS[c.section];
        if (!spec || !spec.ops.includes(c.op)) return res.status(400).json({ error: "This change is not allowed" });
        const row = c.op === "add" ? null : cur[c.section].find((r) => String(r.id) === String(c.id));
        if (c.op !== "add" && !row) return res.status(400).json({ error: `${spec.title} not found on this land` });
        if (changes.some((x) => x.section === c.section && x.id != null && String(x.id) === String(c.id))) return res.status(400).json({ error: `${spec.title} ${spec.name(row)} is listed twice` });
        let to = null;
        try {
          if (c.op === "file") to = { FileId: cleanValue(spec.cols.find((x) => x.name === "FileId"), c.to?.FileId), FileName: String(c.to?.FileName || "").slice(0, 200) || null };
          else if (c.op !== "remove") {
            to = {};
            const base = c.op === "edit" ? pickCols(spec, row) : {};
            for (const k of spec.cols) to[k.name] = cleanValue(k, c.to?.[k.name] !== undefined ? c.to[k.name] : base[k.name]);
            if (c.to?.FileName) to.FileName = String(c.to.FileName).slice(0, 200);
            if (c.section === "document") to.DocTypeName = String(c.to?.DocTypeName || "").slice(0, 200) || null;
          }
        } catch (msg) { return res.status(400).json({ error: `${spec.title}: ${msg}` }); }
        const from = row ? pickCols(spec, row) : null;
        if (c.op === "edit" && JSON.stringify(from) === JSON.stringify(Object.fromEntries(spec.cols.map((k) => [k.name, to[k.name]])))) return res.status(400).json({ error: `${spec.title} ${spec.name(row)} is not changed` });
        const opWord = { add: "Add", edit: "Change", remove: "Remove", file: "New file for" }[c.op];
        changes.push({ section: c.section, op: c.op, id: row ? row.id : null, label: `${opWord} ${spec.title} — ${spec.name(row || to)}`, from, to });
        continue;
      }
      const f = FIELD[c?.field];
      if (!f) return res.status(400).json({ error: `This field cannot be amended: ${c?.field}` });
      if (changes.some((x) => x.field === f.field)) return res.status(400).json({ error: `${f.label} is listed twice` });
      let to = c.to == null ? "" : String(c.to).trim();
      if (f.kind === "number") {
        if (to === "") to = null; else { const n = Number(to); if (!Number.isFinite(n)) return res.status(400).json({ error: `${f.label} must be a number` }); to = n; }
      } else {
        if (f.options && to && !f.options.includes(to)) return res.status(400).json({ error: `Choose a valid ${f.label}` });
        if (f.max && String(to).length > f.max) return res.status(400).json({ error: `${f.label} is too long` });
        if (to === "") to = null;
      }
      const from = land[f.field] ?? null;
      if (JSON.stringify(from) === JSON.stringify(to) || String(from ?? "") === String(to ?? "")) return res.status(400).json({ error: `${f.label} is not changed` });
      changes.push({ section: "land", field: f.field, label: f.label, from, to });
    }
    const r = await pool.request().input("L", sql.Int, landId).input("T", sql.NVarChar(60), type).input("R", sql.NVarChar(1000), reason.slice(0, 1000))
      .input("C", sql.NVarChar(sql.MAX), JSON.stringify(changes)).input("Ref", sql.NVarChar(150), referenceNo).input("U", sql.Int, userOf(req)).query(`
        INSERT INTO dbo.LegalLandAmendment (LandId, AmendmentNo, AmendType, Reason, ChangesJson, ReferenceNo, RequestedBy)
        OUTPUT INSERTED.AmendmentId, INSERTED.AmendmentNo
        VALUES (@L, (SELECT ISNULL(MAX(AmendmentNo), 0) + 1 FROM dbo.LegalLandAmendment WITH (UPDLOCK, HOLDLOCK) WHERE LandId = @L), @T, @R, @C, @Ref, @U)`);
    const { AmendmentId, AmendmentNo } = r.recordset[0];
    await writeAudit(pool, req, { action: "Amendment requested", entityType: "Land Amendment", entityId: AmendmentId, landId,
      oldValue: Object.fromEntries(changes.map((c) => [c.field || c.label, c.from])), newValue: Object.fromEntries(changes.map((c) => [c.field || c.label, c.to])),
      remarks: `Amendment ${AmendmentNo} · ${type}: ${reason}`.slice(0, 1000) });
    res.status(201).json({ id: AmendmentId, message: `Amendment ${AmendmentNo} sent for approval` });
  } catch (err) {
    console.error("[legal-amendment] request:", err.message);
    res.status(500).json({ error: "Could not save the amendment" });
  }
});

const sqlType = (c) => (c.kind === "number" ? sql.Decimal(18, 6) : c.kind === "date" ? sql.Date : c.kind === "file" || c.kind === "doctype" ? sql.Int : sql.NVarChar(sql.MAX));

/** Writes one approved record change (add / edit / remove / new file) inside the approval transaction. */
async function applyRecord(tx, landId, c, userId) {
  const spec = SECTIONS[c.section];
  const rq = () => tx.request().input("L", sql.Int, landId).input("U", sql.Int, userId);
  const bind = (r) => { spec.cols.forEach((k) => r.input(k.name, sqlType(k), c.to?.[k.name] ?? null)); return r; };
  if (c.section === "document") {
    if (c.op === "remove") return rq().input("Id", sql.Int, c.id).query("UPDATE dbo.LegalLandDocument SET IsActive = 0, UpdatedBy = @U, UpdatedAt = SYSUTCDATETIME() WHERE DocumentId = @Id AND LandId = @L");
    if (c.op === "file") {
      return rq().input("Id", sql.Int, c.id).input("F", sql.Int, c.to.FileId).query(`
        DECLARE @N INT = (SELECT CurrentVersionNo + 1 FROM dbo.LegalLandDocument WITH (UPDLOCK) WHERE DocumentId = @Id AND LandId = @L);
        INSERT INTO dbo.LegalLandDocumentVersion (DocumentId, VersionNo, FileId, UploadRemarks, UploadedBy, ReviewStatus) VALUES (@Id, @N, @F, N'Amendment', @U, N'Verified');
        UPDATE dbo.LegalLandDocument SET CurrentVersionNo = @N, UpdatedBy = @U, UpdatedAt = SYSUTCDATETIME() WHERE DocumentId = @Id;`);
    }
    return bind(rq()).input("Prefix", sql.NVarChar(20), codePrefix("DOC")).query(`
      DECLARE @D TABLE (id INT);
      INSERT INTO dbo.LegalLandDocument (DocumentCode, LandId, DocTypeId, RelatedSection, Title, DocumentNo, DocumentDate, CurrentVersionNo, Remarks, CreatedBy)
      OUTPUT INSERTED.DocumentId INTO @D
      SELECT ${nextCodeSql("LegalLandDocument", "DocumentCode", "@Prefix")}, @L, @DocTypeId, @RelatedSection, @Title, @DocumentNo, @DocumentDate, 1, N'Added by amendment', @U;
      INSERT INTO dbo.LegalLandDocumentVersion (DocumentId, VersionNo, FileId, UploadRemarks, UploadedBy, ReviewStatus) SELECT id, 1, @FileId, N'Amendment', @U, N'Verified' FROM @D;`);
  }
  if (c.section === "clearance") {
    return bind(rq()).input("K", sql.NVarChar(20), c.id).query(`
      IF EXISTS (SELECT 1 FROM dbo.LegalLandClearance WHERE LandId = @L AND Kind = @K)
        UPDATE dbo.LegalLandClearance SET Status = @Status, AppliedOn = @AppliedOn, ApplicationNo = @ApplicationNo, ObtainedOn = @ObtainedOn, CertificateNo = @CertificateNo,
               FileId = ISNULL(@FileId, FileId), UpdatedBy = @U, UpdatedAt = SYSUTCDATETIME() WHERE LandId = @L AND Kind = @K;
      ELSE INSERT INTO dbo.LegalLandClearance (LandId, Kind, Status, AppliedOn, ApplicationNo, ObtainedOn, CertificateNo, FileId, UpdatedBy, UpdatedAt)
        VALUES (@L, @K, @Status, @AppliedOn, @ApplicationNo, @ObtainedOn, @CertificateNo, @FileId, @U, SYSUTCDATETIME());`);
  }
  const names = spec.cols.map((k) => k.name);
  if (c.op === "remove") {
    if (c.section === "owner") return rq().input("Id", sql.Int, c.id).query("UPDATE dbo.LegalOwnershipRecord SET ValidTo = CAST(SYSDATETIME() AS DATE), UpdatedBy = @U, UpdatedAt = SYSUTCDATETIME() WHERE RecordId = @Id AND LandId = @L");
    return rq().input("Id", sql.Int, c.id).query(`UPDATE dbo.${spec.table} SET IsActive = 0, UpdatedBy = @U, UpdatedAt = SYSUTCDATETIME() WHERE ${spec.pk} = @Id AND LandId = @L`);
  }
  if (c.op === "edit") {
    return bind(rq()).input("Id", sql.Int, c.id).query(`UPDATE dbo.${spec.table} SET ${names.map((n) => `[${n}] = @${n}`).join(", ")}, UpdatedBy = @U, UpdatedAt = SYSUTCDATETIME() WHERE ${spec.pk} = @Id AND LandId = @L`);
  }
  // add
  if (c.section === "rs" || c.section === "lr") {
    return bind(rq()).query(`INSERT INTO dbo.${spec.table} (LandId, MouzaId, ${names.join(", ")}, VerificationStatus, CreatedBy)
      SELECT @L, MouzaId, ${names.map((n) => `@${n}`).join(", ")}, N'Verified', @U FROM dbo.LegalLand WHERE LandId = @L`);
  }
  if (c.section === "owner") {
    return bind(rq()).query(`INSERT INTO dbo.LegalOwnershipRecord (LandId, OwnerName, OwnerGuardian, SharePct, ValidFrom, OwnershipTypeId, VerificationStatus, VerificationRemarks, CreatedBy)
      SELECT @L, @OwnerName, @OwnerGuardian, @SharePct, @ValidFrom,
             COALESCE((SELECT TOP 1 OwnershipTypeId FROM dbo.LegalOwnershipRecord WHERE LandId = @L ORDER BY RecordId DESC),
                      (SELECT TOP 1 OwnershipTypeId FROM dbo.LegalOwnershipRecord ORDER BY RecordId DESC)),
             N'Verified', N'Added by amendment', @U`);
  }
  return bind(rq()).query(`INSERT INTO dbo.${spec.table} (LandId, ${names.join(", ")}, CreatedBy) VALUES (@L, ${names.map((n) => `@${n}`).join(", ")}, @U)`);
}

async function loadOne(pool, id) {
  const r = await pool.request().input("Id", sql.Int, id).query(`${SELECT} WHERE a.AmendmentId = @Id`);
  return r.recordset[0] ? shape(r.recordset[0]) : null;
}

router.post("/:id/approve", requirePageRight(PAGE, "view"), async (req, res) => {
  const id = idParam(req.params.id);
  const remarks = String(req.body?.remarks || "").trim();
  if (!id) return res.status(400).json({ error: "Invalid amendment" });
  if (remarks.length < 3) return res.status(400).json({ error: "Write the approval remark" });
  try {
    const pool = getPool();
    if (!(await ready(pool))) return notReady(res);
    if (!(await canAct(req, STAGE, PAGE))) return res.status(403).json({ error: "Only an Amendment Approver (Setup → Approval Control) can approve" });
    const a = await loadOne(pool, id);
    if (!a) return res.status(404).json({ error: "Amendment not found" });
    if (a.Status !== "Pending") return res.status(409).json({ error: `This amendment is already ${a.Status.toLowerCase()}` });
    const own = ownWork(req, a.RequestedBy, "this amendment");
    if (own) return res.status(403).json({ error: own });

    if (!a.changes.length) {
      await pool.request().input("Id", sql.Int, id).input("U", sql.Int, userOf(req)).input("R", sql.NVarChar(1000), remarks.slice(0, 1000))
        .query("UPDATE dbo.LegalLandAmendment SET Status = N'Open', DecidedBy = @U, DecidedAt = SYSUTCDATETIME(), DecisionRemarks = @R WHERE AmendmentId = @Id AND Status = N'Pending'");
      await writeAudit(pool, req, { action: "Amendment approved", entityType: "Land Amendment", entityId: id, landId: a.LandId, remarks: `Amendment ${a.AmendmentNo} · ${a.AmendType}: ${remarks}`.slice(0, 1000) });
      return res.json({ message: `Amendment ${a.AmendmentNo} approved — ${a.LandCode} is open for editing. After the edits, send it for verification.` });
    }
    const tx = pool.transaction();
    await tx.begin();
    try {
      const set = [], rq = tx.request().input("L", sql.Int, a.LandId).input("U", sql.Int, userOf(req));
      for (const c of a.changes.filter((x) => x.section && x.section !== "land")) await applyRecord(tx, a.LandId, c, userOf(req));
      a.changes.filter((x) => !x.section || x.section === "land").forEach((c, i) => {
        const f = FIELD[c.field];
        if (!f) return;
        rq.input(`V${i}`, f.kind === "number" ? sql.Decimal(18, 6) : sql.NVarChar(sql.MAX), c.to);
        set.push(`[${f.field}] = @V${i}`);
      });
      if (set.length) await rq.query(`UPDATE dbo.LegalLand SET ${set.join(", ")}, UpdatedBy = @U, UpdatedAt = SYSUTCDATETIME() WHERE LandId = @L`);
      await tx.request().input("Id", sql.Int, id).input("U", sql.Int, userOf(req)).input("R", sql.NVarChar(1000), remarks.slice(0, 1000))
        .query("UPDATE dbo.LegalLandAmendment SET Status = N'Approved', DecidedBy = @U, DecidedAt = SYSUTCDATETIME(), DecisionRemarks = @R WHERE AmendmentId = @Id AND Status = N'Pending'");
      await tx.commit();
    } catch (e) { await tx.rollback().catch(() => {}); throw e; }

    await writeAudit(pool, req, { action: "Amendment approved", entityType: "Land Amendment", entityId: id, landId: a.LandId,
      oldValue: Object.fromEntries(a.changes.map((c) => [c.field || c.label, c.from])), newValue: Object.fromEntries(a.changes.map((c) => [c.field || c.label, c.to])),
      remarks: `Amendment ${a.AmendmentNo} · ${a.AmendType}: ${remarks}`.slice(0, 1000) });
    // Saved as the next version of the land, marked "after registration" (Legal Flow Chart).
    const flow = require("./landFlow");
    const no = await flow.snapshotVersion(pool, a.LandId, userOf(req), "Amendment approved", {
      no: a.AmendmentNo, type: a.AmendType, reason: a.Reason, referenceNo: a.ReferenceNo, remarks, requestedBy: a.RequestedByName, changes: a.changes,
    });
    if (no) await pool.request().input("Id", sql.Int, id).input("N", sql.Int, no).query("UPDATE dbo.LegalLandAmendment SET VersionNo = @N WHERE AmendmentId = @Id");
    res.json({ message: `Amendment ${a.AmendmentNo} approved — saved as version ${no ?? ""}`.trim() });
  } catch (err) {
    console.error("[legal-amendment] approve:", err.message);
    res.status(500).json({ error: "Could not approve the amendment" });
  }
});

router.post("/:id/reject", requirePageRight(PAGE, "view"), async (req, res) => {
  const id = idParam(req.params.id);
  const remarks = String(req.body?.remarks || "").trim();
  if (!id) return res.status(400).json({ error: "Invalid amendment" });
  if (remarks.length < 3) return res.status(400).json({ error: "Write why it is rejected" });
  try {
    const pool = getPool();
    if (!(await ready(pool))) return notReady(res);
    if (!(await canAct(req, STAGE, PAGE))) return res.status(403).json({ error: "Only an Amendment Approver (Setup → Approval Control) can reject" });
    const a = await loadOne(pool, id);
    if (!a) return res.status(404).json({ error: "Amendment not found" });
    if (a.Status !== "Pending") return res.status(409).json({ error: `This amendment is already ${a.Status.toLowerCase()}` });
    await pool.request().input("Id", sql.Int, id).input("U", sql.Int, userOf(req)).input("R", sql.NVarChar(1000), remarks.slice(0, 1000))
      .query("UPDATE dbo.LegalLandAmendment SET Status = N'Rejected', DecidedBy = @U, DecidedAt = SYSUTCDATETIME(), DecisionRemarks = @R WHERE AmendmentId = @Id AND Status = N'Pending'");
    await writeAudit(pool, req, { action: "Amendment rejected", entityType: "Land Amendment", entityId: id, landId: a.LandId, remarks: `Amendment ${a.AmendmentNo}: ${remarks}`.slice(0, 1000) });
    res.json({ message: `Amendment ${a.AmendmentNo} rejected` });
  } catch (err) {
    console.error("[legal-amendment] reject:", err.message);
    res.status(500).json({ error: "Could not reject the amendment" });
  }
});

router.post("/:id/withdraw", requirePageRight(PAGE, "edit"), async (req, res) => {
  const id = idParam(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid amendment" });
  try {
    const pool = getPool();
    if (!(await ready(pool))) return notReady(res);
    const a = await loadOne(pool, id);
    if (!a) return res.status(404).json({ error: "Amendment not found" });
    if (a.Status !== "Pending") return res.status(409).json({ error: `This amendment is already ${a.Status.toLowerCase()}` });
    if (Number(a.RequestedBy) !== Number(userOf(req))) return res.status(403).json({ error: "Only the person who asked for it can withdraw it" });
    await pool.request().input("Id", sql.Int, id).query("UPDATE dbo.LegalLandAmendment SET Status = N'Withdrawn', DecidedAt = SYSUTCDATETIME() WHERE AmendmentId = @Id AND Status = N'Pending'");
    await writeAudit(pool, req, { action: "Amendment withdrawn", entityType: "Land Amendment", entityId: id, landId: a.LandId });
    res.json({ message: `Amendment ${a.AmendmentNo} withdrawn` });
  } catch (err) {
    console.error("[legal-amendment] withdraw:", err.message);
    res.status(500).json({ error: "Could not withdraw the amendment" });
  }
});

module.exports = router;
module.exports.FIELDS = FIELDS;
module.exports.isLocked = isLocked;
module.exports.LOCK_MSG = LOCK_MSG;
module.exports.applyRecord = applyRecord;
