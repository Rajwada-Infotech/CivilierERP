const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const authenticateToken = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { bumpCacheVersion } = require("../redis");
const { lockNextDocNumber, backPatchRecordId } = require("../utils/docNumberLock");
const { transition, guardEdit } = require("../services/approvalService");

function requireUser(req, res) {
  const email = req.user?.email || req.user?.name;
  if (!email) { res.status(401).json({ error: "User context missing" }); return null; }
  return email;
}

// ── GET / — list ─────────────────────────────────────────────────────────────
router.get("/", authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    const { companyId, projectId, finYear, status, search } = req.query;
    const request = pool.request();
    if (companyId) request.input("CompanyId", sql.Int, parseInt(companyId, 10));
    if (projectId) request.input("ProjectId", sql.Int, parseInt(projectId, 10));
    if (finYear)   request.input("FinYear", sql.NVarChar(20), finYear);
    if (status)    request.input("Status", sql.NVarChar(30), status);
    if (search)    request.input("Search", sql.NVarChar(200), `%${search}%`);

    const result = await request.query(`
      SELECT
        c.ContractId,
        c.DocNo,
        c.DocDate,
        c.ContractDate,
        c.CompanyId,
        co.name          AS CompanyName,
        c.ProjectId,
        pr.name          AS ProjectName,
        c.FinYear,
        c.ContactPerson,
        c.Reason,
        c.NatureOfContract,
        c.ContractAmount,
        c.ContractStartDate,
        c.ContractEndDate,
        c.Remarks,
        c.Status,
        c.CreatedBy,
        c.CreatedAt
      FROM dbo.Contract c
      LEFT JOIN dbo.enterprise co ON co.id = c.CompanyId
      LEFT JOIN dbo.enterprise pr ON pr.id = c.ProjectId
      WHERE 1=1
        ${companyId ? "AND c.CompanyId = @CompanyId" : ""}
        ${projectId ? "AND c.ProjectId = @ProjectId" : ""}
        ${finYear   ? "AND c.FinYear = @FinYear" : ""}
        ${status    ? "AND c.Status = @Status" : ""}
        ${search    ? "AND (c.DocNo LIKE @Search OR c.ContactPerson LIKE @Search OR c.NatureOfContract LIKE @Search)" : ""}
      ORDER BY c.CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[contract] GET /:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /contact-persons — dropdown from AccountHeadMaster ────────────────────
router.get("/contact-persons", authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT
        LTRIM(RTRIM(LHeadContactPerson)) AS name,
        LHeadType                        AS type,
        LHeadId                          AS partyId,
        LHeadName                        AS partyName,
        LHeadCode                        AS partyCode,
        LHeadPhone                       AS phone,
        LHeadEmail                       AS email,
        LHeadAddress                     AS address,
        LGST                             AS gst,
        LHeadPan                         AS pan
      FROM dbo.AccountHeadMaster
      WHERE LHeadType IN ('S', 'C', 'A')
        AND LHeadContactPerson IS NOT NULL
        AND LTRIM(RTRIM(LHeadContactPerson)) <> ''
      ORDER BY LHeadType, LHeadContactPerson
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /meta/suppliers — party pill source ────────────────────────────────
router.get("/meta/suppliers", authenticateToken, async (req, res) => {
  try {
    const result = await getPool().request().query(`
      SELECT LHeadId AS id, LHeadName AS name, LHeadCode AS code
      FROM dbo.AccountHeadMaster WHERE LHeadType = 'S' AND Status IN ('Active', 'Approved')
      ORDER BY LHeadName
    `);
    res.json(result.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /meta/contractors — party pill source ──────────────────────────────
router.get("/meta/contractors", authenticateToken, async (req, res) => {
  try {
    const result = await getPool().request().query(`
      SELECT LHeadId AS id, LHeadName AS name, LHeadCode AS code
      FROM dbo.AccountHeadMaster WHERE LHeadType = 'C' AND Status IN ('Active', 'Approved')
      ORDER BY LHeadName
    `);
    res.json(result.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /meta/customers — party pill source ───────────────────────────────
router.get("/meta/customers", authenticateToken, async (req, res) => {
  try {
    const result = await getPool().request().query(`
      SELECT LHeadId AS id, LHeadName AS name, LHeadCode AS code
      FROM dbo.AccountHeadMaster WHERE LHeadType = 'A' AND Status IN ('Active', 'Approved')
      ORDER BY LHeadName
    `);
    res.json(result.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /options — dropdown source for Payment/Invoice/Expense forms ────────
// Must be before /:id so "options" isn't matched as an id param.
router.get("/options", authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    const request = pool.request();
    let query = `
      SELECT c.ContractId AS id,
             CONCAT(ISNULL(c.DocNo, 'Contract #' + CAST(c.ContractId AS NVARCHAR)),
                    ISNULL(' — ' + c.ContactPerson, '')) AS label,
             c.ContractAmount
      FROM dbo.Contract c
      WHERE c.Status <> 'Deleted'
    `;
    if (req.query.companyId) {
      query += " AND c.CompanyId = @CompanyId";
      request.input("CompanyId", sql.Int, parseInt(req.query.companyId, 10));
    }
    if (req.query.projectId) {
      query += " AND c.ProjectId = @ProjectId";
      request.input("ProjectId", sql.Int, parseInt(req.query.projectId, 10));
    }
    query += " ORDER BY c.CreatedAt DESC";
    const result = await request.query(query);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:id — single contract ────────────────────────────────────────────────
router.get("/:id", authenticateToken, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const result = await pool.request().input("ContractId", sql.Int, id).query(`
      SELECT c.*,
             co.name AS CompanyName,
             pr.name AS ProjectName
      FROM dbo.Contract c
      LEFT JOIN dbo.enterprise co ON co.id = c.CompanyId
      LEFT JOIN dbo.enterprise pr ON pr.id = c.ProjectId
      WHERE c.ContractId = @ContractId
    `);
    if (!result.recordset.length) return res.status(404).json({ error: "Not found" });
    res.json(result.recordset[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:id/attachment/:index — stream one attachment ─────────────────────
// Contract attachments have no dedicated binary-storage table like GRN/
// Vehicle In/Out — they're stored as a JSON array of {name, url, type, size}
// on dbo.Contract.Attachments, where `url` is a base64 data URI. That raw
// data URI was previously handed straight to the frontend as the record's
// download/preview link (via recordsRoutes.js), which fetch()s it as if it
// were a real HTTP path — a data: URI isn't one, so every preview/download
// 404'd. This decodes it server-side and streams real bytes with the right
// Content-Type instead, matching how every other module's attachments work.
router.get("/:id/attachment/:index", authenticateToken, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const index = parseInt(req.params.index, 10);
  if (!Number.isFinite(id) || !Number.isFinite(index) || index < 0)
    return res.status(400).json({ error: "Invalid id or index" });
  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("ContractId", sql.Int, id)
      .query("SELECT Attachments FROM dbo.Contract WHERE ContractId = @ContractId");
    if (!result.recordset.length) return res.status(404).json({ error: "Contract not found" });

    let attachments;
    try {
      attachments = JSON.parse(result.recordset[0].Attachments || "[]");
    } catch {
      return res.status(404).json({ error: "Attachment not found" });
    }
    const att = Array.isArray(attachments) ? attachments[index] : null;
    if (!att || !att.url) return res.status(404).json({ error: "Attachment not found" });

    const match = /^data:([^;]+);base64,(.+)$/.exec(att.url);
    if (!match) {
      // A handful of contracts predate a fix to the upload code and still
      // hold a browser blob: object URL instead of the file's actual bytes
      // — that URL only ever existed in the uploader's browser tab, so
      // there's nothing to serve; the file itself was never sent to the
      // server. Not recoverable — the only fix is re-uploading it.
      const isStaleBlobUrl = /^blob:/.test(att.url);
      return res.status(422).json({
        error: isStaleBlobUrl
          ? "This attachment was uploaded before file storage was fixed and can't be recovered — please remove and re-upload it."
          : "Attachment is not a valid data URI",
      });
    }
    const [, mimeType, base64Data] = match;
    const buffer = Buffer.from(base64Data, "base64");

    res.setHeader("Content-Type", att.type || mimeType || "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${(att.name || `attachment-${index}`).replace(/"/g, "")}"`,
    );
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST / — create ───────────────────────────────────────────────────────────
router.post("/", authenticateToken, requirePageRight("finance-contracts", "create"), async (req, res) => {
  const email = requireUser(req, res);
  if (!email) return;
  try {
    const pool = getPool();
    const {
      docTypeId, docDate, contractDate, companyId, projectId, finYear,
      contactPerson, contactPartyId, reason, natureOfContract, contractAmount,
      contractStartDate, contractEndDate, attachments, termsAndConditions, remarks, parties,
    } = req.body;

    if (!docTypeId) return res.status(400).json({ error: "docTypeId is required" });

    const docNo = await lockNextDocNumber(pool, sql, {
      docTypeId: parseInt(docTypeId, 10),
      finYear,
      tableName: "Contract",
      issuedBy: email,
    });

    const insert = await pool.request()
      .input("DocNo",             sql.NVarChar(100), docNo)
      .input("DocTypeId",         sql.Int,           parseInt(docTypeId, 10))
      .input("DocDate",           sql.Date,          docDate || null)
      .input("ContractDate",      sql.Date,          contractDate || null)
      .input("CompanyId",         sql.Int,           companyId ? parseInt(companyId, 10) : null)
      .input("ProjectId",         sql.Int,           projectId ? parseInt(projectId, 10) : null)
      .input("FinYear",           sql.NVarChar(20),  finYear || null)
      .input("ContactPerson",     sql.NVarChar(200), contactPerson || null)
      .input("ContactPartyId",    sql.Int,           contactPartyId ? parseInt(contactPartyId, 10) : null)
      .input("Reason",            sql.NVarChar(sql.MAX), reason || null)
      .input("NatureOfContract",  sql.NVarChar(500), natureOfContract || null)
      .input("ContractAmount",    sql.Decimal(18, 2), contractAmount ? parseFloat(contractAmount) : null)
      .input("ContractStartDate", sql.Date,          contractStartDate || null)
      .input("ContractEndDate",   sql.Date,          contractEndDate || null)
      .input("Attachments",       sql.NVarChar(sql.MAX), attachments ? JSON.stringify(attachments) : null)
      .input("TermsAndConditions",sql.NVarChar(sql.MAX), termsAndConditions || null)
      .input("Remarks",           sql.NVarChar(sql.MAX), remarks || null)
      .input("Parties",           sql.NVarChar(sql.MAX), parties ? JSON.stringify(parties) : null)
      .input("Status",            sql.NVarChar(30),  "Draft")
      .input("CreatedBy",         sql.NVarChar(200), email)
      .query(`
        INSERT INTO dbo.Contract
          (DocNo, DocTypeId, DocDate, ContractDate, CompanyId, ProjectId, FinYear,
           ContactPerson, ContactPartyId, Reason, NatureOfContract, ContractAmount,
           ContractStartDate, ContractEndDate, Attachments, TermsAndConditions,
           Remarks, Parties, Status, CreatedBy, CreatedAt)
        VALUES
          (@DocNo, @DocTypeId, @DocDate, @ContractDate, @CompanyId, @ProjectId, @FinYear,
           @ContactPerson, @ContactPartyId, @Reason, @NatureOfContract, @ContractAmount,
           @ContractStartDate, @ContractEndDate, @Attachments, @TermsAndConditions,
           @Remarks, @Parties, @Status, @CreatedBy, GETDATE());
        SELECT SCOPE_IDENTITY() AS ContractId;
      `);

    const newId = insert.recordset[0]?.ContractId;
    await backPatchRecordId(pool, sql, docNo, "Contract", newId);
    await bumpCacheVersion("contracts");

    // Auto-submit: transition Draft → Pending immediately so no manual
    // "Submit" step is required after creation — a contract goes straight
    // to the approval chain.
    let finalStatus = "Draft";
    try {
      const result = await transition("contracts", newId, "Pending", email, req.user?.role);
      finalStatus = result.newStatus;
    } catch (submitErr) {
      console.warn("Contract auto-submit failed (non-fatal):", submitErr.message);
    }

    res.json({ contractId: newId, docNo, status: finalStatus });
  } catch (err) {
    console.error("[contract] POST /:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /:id — update ─────────────────────────────────────────────────────────
router.put("/:id", authenticateToken, requirePageRight("finance-contracts", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
  const email = requireUser(req, res);
  if (!email) return;
  try {
    await guardEdit("contracts", id);
  } catch (err) {
    return res.status(409).json({ error: err.message });
  }
  try {
    const pool = getPool();
    const {
      docDate, contractDate, companyId, projectId, finYear,
      contactPerson, contactPartyId, reason, natureOfContract, contractAmount,
      contractStartDate, contractEndDate, attachments, termsAndConditions, remarks, parties, status,
    } = req.body;

    await pool.request()
      .input("ContractId",        sql.Int,           id)
      .input("DocDate",           sql.Date,          docDate || null)
      .input("ContractDate",      sql.Date,          contractDate || null)
      .input("CompanyId",         sql.Int,           companyId ? parseInt(companyId, 10) : null)
      .input("ProjectId",         sql.Int,           projectId ? parseInt(projectId, 10) : null)
      .input("FinYear",           sql.NVarChar(20),  finYear || null)
      .input("ContactPerson",     sql.NVarChar(200), contactPerson || null)
      .input("ContactPartyId",    sql.Int,           contactPartyId ? parseInt(contactPartyId, 10) : null)
      .input("Reason",            sql.NVarChar(sql.MAX), reason || null)
      .input("NatureOfContract",  sql.NVarChar(500), natureOfContract || null)
      .input("ContractAmount",    sql.Decimal(18, 2), contractAmount ? parseFloat(contractAmount) : null)
      .input("ContractStartDate", sql.Date,          contractStartDate || null)
      .input("ContractEndDate",   sql.Date,          contractEndDate || null)
      .input("Attachments",       sql.NVarChar(sql.MAX), attachments ? JSON.stringify(attachments) : null)
      .input("TermsAndConditions",sql.NVarChar(sql.MAX), termsAndConditions || null)
      .input("Remarks",           sql.NVarChar(sql.MAX), remarks || null)
      .input("Parties",           sql.NVarChar(sql.MAX), parties ? JSON.stringify(parties) : null)
      .input("Status",            sql.NVarChar(30),  status || "Draft")
      .input("UpdatedBy",         sql.NVarChar(200), email)
      .query(`
        UPDATE dbo.Contract SET
          DocDate           = @DocDate,
          ContractDate      = @ContractDate,
          CompanyId         = @CompanyId,
          ProjectId         = @ProjectId,
          FinYear           = @FinYear,
          ContactPerson     = @ContactPerson,
          ContactPartyId    = @ContactPartyId,
          Reason            = @Reason,
          NatureOfContract  = @NatureOfContract,
          ContractAmount    = @ContractAmount,
          ContractStartDate = @ContractStartDate,
          ContractEndDate   = @ContractEndDate,
          Attachments       = @Attachments,
          TermsAndConditions= @TermsAndConditions,
          Remarks           = @Remarks,
          Parties           = @Parties,
          Status            = @Status,
          UpdatedBy         = @UpdatedBy,
          UpdatedAt         = GETDATE()
        WHERE ContractId = @ContractId
      `);

    await bumpCacheVersion("contracts");
    res.json({ ok: true });
  } catch (err) {
    console.error("[contract] PUT /:id:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /:id/submit ───────────────────────────────────────────────────────────
// Not used by the normal create flow (contracts auto-submit on POST /), but
// kept so a Rejected contract can be manually resubmitted, matching every
// other approval-gated module's endpoint set.
router.put("/:id/submit", authenticateToken, requirePageRight("finance-contracts", "edit"), async (req, res) => {
  const email = requireUser(req, res);
  if (!email) return;
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });

    const result = await transition("contracts", id, "Pending", email, req.user?.role);
    await bumpCacheVersion("contracts");
    res.json({ message: "Submitted for approval", ...result });
  } catch (err) {
    res.status(err.message.includes("not authorized") ? 403 : 400).json({ error: err.message });
  }
});

// ── PUT /:id/approve ─────────────────────────────────────────────────────────
router.put("/:id/approve", authenticateToken, async (req, res) => {
  const email = requireUser(req, res);
  if (!email) return;
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });

    const result = await transition("contracts", id, "Approved", email, req.user?.role);
    await bumpCacheVersion("contracts");
    res.json({ message: "Contract approved", ...result });
  } catch (err) {
    res.status(err.message.includes("not authorized") ? 403 : 400).json({ error: err.message });
  }
});

// ── PUT /:id/reject ──────────────────────────────────────────────────────────
router.put("/:id/reject", authenticateToken, async (req, res) => {
  const email = requireUser(req, res);
  if (!email) return;
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });

    const { note } = req.body;
    const result = await transition("contracts", id, "Rejected", email, req.user?.role, note || null);
    await bumpCacheVersion("contracts");
    res.json({ message: "Contract rejected", ...result });
  } catch (err) {
    res.status(err.message.includes("not authorized") ? 403 : 400).json({ error: err.message });
  }
});

// ── DELETE /:id ───────────────────────────────────────────────────────────────
router.delete("/:id", authenticateToken, requirePageRight("finance-contracts", "delete"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
  const email = requireUser(req, res);
  if (!email) return;
  try {
    const pool = getPool();
    await pool.request()
      .input("ContractId", sql.Int, id)
      .input("UpdatedBy",  sql.NVarChar(200), email)
      .query(`
        UPDATE dbo.Contract
        SET Status = 'Deleted', UpdatedBy = @UpdatedBy, UpdatedAt = GETDATE()
        WHERE ContractId = @ContractId
      `);
    await bumpCacheVersion("contracts");
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:id/ledger — advance/adjustment history + live balance summary ─────
// The transparency surface for the on-account adjustment feature: every
// advance received/paid and every automatic FIFO adjustment ever applied
// against this contract, plus the derived balance figures from
// services/contractLedger.js — never cached, never computed a second way.
router.get("/:id/ledger", authenticateToken, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const contractCheck = await pool.request().input("id", sql.Int, id)
      .query("SELECT ContractId FROM dbo.Contract WHERE ContractId = @id");
    if (!contractCheck.recordset.length) return res.status(404).json({ error: "Not found" });

    const ledgerRows = await pool.request().input("id", sql.Int, id).query(`
      SELECT LedgerId, TxnType, Amount, SourceType, SourceId, SourceDocNo, Remarks, CreatedBy, CreatedAt
      FROM dbo.ContractLedger
      WHERE ContractId = @id
      ORDER BY CreatedAt ASC, LedgerId ASC
    `);

    const { getContractSummary } = require("../services/contractLedger");
    const summary = await getContractSummary(pool, id);
    res.json({ summary, ledger: ledgerRows.recordset });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
