/**
 * backend/routes/recordsRoutes.js
 *
 * Unified Records module — a single read-only feed over every attachment
 * that already exists across the ERP, regardless of which module created it:
 *
 *   - dbo.ticket_attachments        (Ticket module)
 *   - dbo.VehicleInOutAttachments   (Vehicle In/Out module)
 *   - dbo.FollowupDocumentVault     (Follow-Up Document Vault)
 *
 * This route does NOT duplicate or move any file bytes. Each source module
 * keeps owning its own binary storage and its own streaming endpoint
 * (/api/tickets/attachment/:id, /api/vehicle-in-out/attachment/:id,
 * /api/followup-document-vault/file/:id). Records only aggregates metadata
 * (filename, size, type, doc reference, uploader, timestamp) and points the
 * UI back at the original download URL.
 *
 * Adding a future attachment source: write one more fetchXAttachments(pool,
 * actor) function below that queries the new table and returns rows already
 * normalized into the same shape (source, sourceId, module, docRef, docLabel,
 * filename, mimeType, size, uploadedBy, uploadedAt, url), then add it to the
 * SOURCES array near the bottom of this file. Nothing else changes — no
 * migration, no new table, no frontend changes.
 *
 * Access scoping mirrors each source module's own rule rather than a single
 * blanket permission, since Records is a read-only window onto data that
 * already has per-module access rules:
 *   - Tickets: admin-tier roles see all; everyone else sees only tickets
 *     they created or are assigned to (same rule as ticketRoutes.js).
 *   - Vehicle In/Out: internal/operational log, visible to any authenticated
 *     non-customer user (same exposure as the Vehicle In/Out module itself).
 *   - Document Vault: internal/operational, visible to any authenticated
 *     non-customer user (Followup module is staff-only in the UI already).
 *
 * Routes
 *   GET /api/records  — unified, searchable list of all attachments across
 *                        every source above. Each row's `url` field points
 *                        directly at that row's own source module's existing
 *                        streaming endpoint — Records never re-serves bytes.
 */

"use strict";

const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));

const { getPool, sql } = require("../db");
const allowRoles = require("../middleware/role");

function actorFromReq(req) {
  return {
    id: req.user?.userId ?? req.user?.id ?? null,
    role: allowRoles.normalizeRole(req.user?.role),
  };
}

function isAdminTier(role) {
  return ["admin", "super_admin", "dba", "engineer"].includes(role);
}

// ─── Per-source fetchers ──────────────────────────────────────────────────────
// Each returns already-normalized rows: { source, sourceId, docRef, docLabel,
// filename, mimeType, size, uploadedBy, uploadedAt, url, module }

async function fetchTicketAttachments(pool, actor) {
  const admin = isAdminTier(actor.role);

  const request = pool.request();
  let scopeClause = "";
  if (!admin) {
    if (!actor.id) return [];
    request.input("actorId", sql.Int, actor.id);
    scopeClause =
      "AND (t.created_by_id = @actorId OR t.assigned_to_id = @actorId)";
  }

  const result = await request.query(`
    SELECT
      a.id            AS AttachmentId,
      a.ticket_id     AS TicketId,
      t.subject       AS TicketSubject,
      a.filename      AS FileName,
      a.mime_type     AS MimeType,
      a.file_size     AS FileSize,
      a.uploaded_by   AS UploadedById,
      u.name          AS UploadedByName,
      a.uploaded_at   AS UploadedAt
    FROM dbo.ticket_attachments a
    INNER JOIN dbo.tickets t ON t.id = a.ticket_id
    LEFT JOIN dbo.users u ON u.id = a.uploaded_by
    WHERE 1 = 1 ${scopeClause}
    ORDER BY a.uploaded_at DESC
  `);

  return result.recordset.map((r) => ({
    source: "ticket",
    sourceId: r.AttachmentId,
    module: "Ticket",
    docRef: `TKT-${r.TicketId}`,
    docLabel: r.TicketSubject || `Ticket #${r.TicketId}`,
    filename: r.FileName,
    mimeType: r.MimeType,
    size: r.FileSize,
    uploadedBy:
      r.UploadedByName || (r.UploadedById ? `User #${r.UploadedById}` : null),
    uploadedAt: r.UploadedAt,
    url: `/api/tickets/attachment/${r.AttachmentId}`,
  }));
}

async function fetchVehicleAttachments(pool, actor) {
  // Operational gate log — any authenticated non-customer user can see it,
  // same exposure as the Vehicle In/Out module itself.
  if (actor.role === "customer") return [];

  const result = await pool.request().query(`
    SELECT
      a.AttachmentId,
      a.VehicleInOutID,
      v.DocNo        AS VehicleDocNo,
      v.VehicleNo    AS VehicleNo,
      a.FileName,
      a.MimeType,
      a.FileSize,
      a.UploadedBy,
      a.UploadedAt
    FROM dbo.VehicleInOutAttachments a
    LEFT JOIN dbo.VehicleInOut v ON v.VehicleInOutID = a.VehicleInOutID
    WHERE a.VehicleInOutID IS NOT NULL
    ORDER BY a.UploadedAt DESC
  `);

  return result.recordset.map((r) => ({
    source: "vehicle",
    sourceId: r.AttachmentId,
    module: "Vehicle In/Out",
    docRef: r.VehicleDocNo || `VEH-${r.VehicleInOutID}`,
    docLabel: r.VehicleNo
      ? `Vehicle ${r.VehicleNo}`
      : r.VehicleDocNo || `Vehicle In/Out #${r.VehicleInOutID}`,
    filename: r.FileName,
    mimeType: r.MimeType,
    size: r.FileSize,
    uploadedBy: r.UploadedBy || null,
    uploadedAt: r.UploadedAt,
    url: `/api/vehicle-in-out/attachment/${r.AttachmentId}`,
  }));
}

async function fetchGRNAttachments(pool, actor) {
  if (actor.role === "customer") return [];
  const tableCheck = await pool.request().query(
    "SELECT 1 AS f FROM sys.tables WHERE object_id = OBJECT_ID('dbo.GRNAttachments')"
  );
  if (!tableCheck.recordset[0]) return [];
  const result = await pool.request().query(`
    SELECT
      a.AttachmentId,
      a.GRNID,
      g.DocNo        AS GRNDocNo,
      g.GRNNo        AS GRNNo,
      a.FileName,
      a.MimeType,
      a.FileSize,
      a.UploadedBy,
      a.UploadedAt
    FROM dbo.GRNAttachments a
    LEFT JOIN dbo.GoodsReceiptNotes g ON g.GRNID = a.GRNID
    WHERE a.GRNID IS NOT NULL
    ORDER BY a.UploadedAt DESC
  `);
  return result.recordset.map((r) => ({
    source: "grn",
    sourceId: r.AttachmentId,
    module: "GRN",
    docRef: r.GRNDocNo || r.GRNNo || `GRN-${r.GRNID}`,
    docLabel: r.GRNDocNo || r.GRNNo || `GRN #${r.GRNID}`,
    filename: r.FileName,
    mimeType: r.MimeType,
    size: r.FileSize,
    uploadedBy: r.UploadedBy || null,
    uploadedAt: r.UploadedAt,
    url: `/api/grns/attachment/${r.AttachmentId}`,
  }));
}

async function fetchLoanNocAttachments(pool, actor) {
  if (actor.role === "customer") return [];
  const tableCheck = await pool.request().query(
    "SELECT 1 AS f FROM sys.tables WHERE object_id = OBJECT_ID('dbo.LoanNOCAttachments')"
  );
  if (!tableCheck.recordset[0]) return [];
  const result = await pool.request().query(`
    SELECT
      a.AttachmentId,
      a.LoanId,
      ls.LoanNo,
      a.FileName,
      a.MimeType,
      a.FileSize,
      a.UploadedBy,
      a.UploadedAt
    FROM dbo.LoanNOCAttachments a
    LEFT JOIN dbo.LoanSanction ls ON ls.LoanId = a.LoanId
    ORDER BY a.UploadedAt DESC
  `);
  return result.recordset.map((r) => ({
    source: "loan-noc",
    sourceId: r.AttachmentId,
    module: "Loan NOC",
    docRef: r.LoanNo || `Loan-${r.LoanId}`,
    docLabel: r.LoanNo ? `NOC - ${r.LoanNo}` : `NOC - Loan #${r.LoanId}`,
    filename: r.FileName,
    mimeType: r.MimeType,
    size: r.FileSize,
    uploadedBy: r.UploadedBy || null,
    uploadedAt: r.UploadedAt,
    url: `/api/loan-sanction/noc/${r.AttachmentId}`,
  }));
}

async function fetchLoanDocumentAttachments(pool, actor) {
  if (actor.role === "customer") return [];
  const tableCheck = await pool.request().query(
    "SELECT 1 AS f FROM sys.tables WHERE object_id = OBJECT_ID('dbo.LoanDocumentAttachments')"
  );
  if (!tableCheck.recordset[0]) return [];
  const result = await pool.request().query(`
    SELECT
      a.AttachmentId,
      a.LoanId,
      a.DocType,
      ls.LoanNo,
      ls.LoanDocNo,
      a.FileName,
      a.MimeType,
      a.FileSize,
      a.UploadedBy,
      a.UploadedAt
    FROM dbo.LoanDocumentAttachments a
    LEFT JOIN dbo.LoanSanction ls ON ls.LoanId = a.LoanId
    ORDER BY a.UploadedAt DESC
  `);
  return result.recordset.map((r) => ({
    source: "loan-document",
    sourceId: r.AttachmentId,
    module: "Loan Document",
    docRef: r.LoanDocNo || r.LoanNo || `Loan-${r.LoanId}`,
    docLabel: `${r.DocType} - ${r.LoanNo || `Loan #${r.LoanId}`}${r.LoanDocNo ? ` (${r.LoanDocNo})` : ""}`,
    filename: r.FileName,
    mimeType: r.MimeType,
    size: r.FileSize,
    uploadedBy: r.UploadedBy || null,
    uploadedAt: r.UploadedAt,
    url: `/api/loan-sanction/document/${r.AttachmentId}`,
  }));
}

// Contract attachments are stored as a JSON array of
// {name, url (base64 data URI), type, size} in dbo.Contract.Attachments —
// no dedicated attachments table, so this unpacks that column per row.
async function fetchContractAttachments(pool, actor) {
  if (actor.role === "customer") return [];
  const result = await pool.request().query(`
    SELECT ContractId, DocNo, Attachments, CreatedBy, CreatedAt, Status, UpdatedAt
    FROM dbo.Contract
    WHERE Attachments IS NOT NULL AND Attachments <> ''
  `);
  const rows = [];
  for (const r of result.recordset) {
    let atts;
    try { atts = JSON.parse(r.Attachments); } catch { continue; }
    if (!Array.isArray(atts)) continue;
    // Soft-deleted contracts keep their Attachments JSON for a 7-day grace
    // window (see recordsRetentionService.js, which nulls it out after
    // that) — surface that here so Records can show "pending deletion" and
    // how many days are left, instead of the file looking permanent.
    const isDeleted = r.Status === "Deleted";
    const purgeAt = isDeleted && r.UpdatedAt
      ? new Date(new Date(r.UpdatedAt).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
      : null;
    atts.forEach((a, i) => {
      rows.push({
        source: "contract",
        sourceId: `${r.ContractId}-${i}`,
        module: "Contract",
        docRef: r.DocNo || `CONTRACT-${r.ContractId}`,
        docLabel: r.DocNo || `Contract #${r.ContractId}`,
        filename: a.name,
        mimeType: a.type,
        size: a.size ?? null,
        uploadedBy: r.CreatedBy || null,
        uploadedAt: r.CreatedAt,
        // Was the raw base64 data URI (a.url) — fetchWithAuth() treats any
        // non-http(s) string as a relative API path, so a data: URI 404'd.
        // Point at the real streaming endpoint instead.
        url: `/api/contract/${r.ContractId}/attachment/${i}`,
        pendingDeletion: isDeleted,
        purgeAt,
      });
    });
  }
  rows.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
  return rows;
}

// Personal Vault — strictly owner-scoped (no admin-sees-all override, unlike
// every other source above): these are explicitly personal files, private
// to whoever uploaded them, matching the ownership check already enforced
// in personalVault.js's own routes.
async function fetchPersonalVaultAttachments(pool, actor) {
  if (!actor.id) return [];
  const result = await pool.request().input("OwnerId", sql.Int, actor.id).query(`
    SELECT Id, FolderName, FileName, MimeType, FileSize, UploadedAt
    FROM dbo.PersonalVaultFiles
    WHERE OwnerId = @OwnerId
    ORDER BY UploadedAt DESC
  `);
  return result.recordset.map((r) => ({
    source: "personal",
    sourceId: r.Id,
    module: "Personal Vault",
    docRef: r.FolderName,
    docLabel: r.FolderName,
    filename: r.FileName,
    mimeType: r.MimeType,
    size: r.FileSize,
    uploadedBy: null,
    uploadedAt: r.UploadedAt,
    url: `/api/personal-vault/file/${r.Id}`,
  }));
}

// ─── Registry of sources ─────────────────────────────────────────────────────
// To wire in a future module's attachments, add { key, label, fetch } here —
// nothing else in this file needs to change.
const SOURCES = [
  { key: "ticket", label: "Ticket", fetch: fetchTicketAttachments },
  { key: "vehicle", label: "Vehicle In/Out", fetch: fetchVehicleAttachments },
  // "vault" (Follow-Up's Document Vault) removed — the Follow-Up module and
  // its tables (including FollowupDocumentVault) were dropped entirely.
  { key: "grn", label: "GRN", fetch: fetchGRNAttachments },
  { key: "loan-noc", label: "Loan NOC", fetch: fetchLoanNocAttachments },
  { key: "loan-document", label: "Loan Document", fetch: fetchLoanDocumentAttachments },
  { key: "contract", label: "Contract", fetch: fetchContractAttachments },
  { key: "personal", label: "Personal Vault", fetch: fetchPersonalVaultAttachments },
];

// ─── GET /api/records — unified list ─────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const actor = actorFromReq(req);
    if (!actor.id)
      return res.status(401).json({ error: "Authentication required" });

    const pool = getPool();

    const results = await Promise.allSettled(
      SOURCES.map((s) => s.fetch(pool, actor)),
    );

    const records = [];
    const sourceErrors = [];
    results.forEach((r, i) => {
      if (r.status === "fulfilled") {
        records.push(...r.value);
      } else {
        // One source failing (e.g. a table missing in a partially-migrated
        // environment) shouldn't take down the whole Records page — log it
        // and keep serving every other source.
        sourceErrors.push(SOURCES[i].key);
        console.error(
          `[Records] source "${SOURCES[i].key}" failed:`,
          r.reason?.message || r.reason,
        );
      }
    });

    records.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));

    res.json({
      data: records,
      total: records.length,
      sources: SOURCES.map((s) => ({ key: s.key, label: s.label })),
      ...(sourceErrors.length ? { partialFailure: sourceErrors } : {}),
    });
  } catch (err) {
    console.error("[Records GET /]", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
