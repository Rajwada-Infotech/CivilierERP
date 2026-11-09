/**
 * docAmendments.js — amendment requests for approved documents (services/docAmendment.js).
 *
 *   POST /api/doc-amendments/preview/:docType/:docId   { proposed }          what it would do (blockers, chain, values)
 *   POST /api/doc-amendments/:docType/:docId           { proposed, reason }  raise it (goes to approval as Pending)
 *   GET  /api/doc-amendments?module=&docType=&docId=                           list
 *   GET  /api/doc-amendments/:id                                               one, with before / proposed / chain
 *   PUT  /api/doc-amendments/:id/approve                                       approve a level; the last one applies it
 *   PUT  /api/doc-amendments/:id/reject                { note }
 *   PUT  /api/doc-amendments/:id/apply                                         retry applying an approved one (admins)
 *
 * Raising (and previewing) takes the document's own page right ("edit"), as editing it would. Approving is decided
 * by the approval engine (Approval Setup's "Amendment" module), as for every other approvable record.
 */
"use strict";

const express = require("express");
const router = express.Router();
const apiRateLimit = require("../middleware/apiRateLimit");
router.use(apiRateLimit);
const authenticateToken = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { attachProjectScope, assertProjectAllowed } = require("../services/projectScope");
const { getPool, sql } = require("../db");
const { transition } = require("../services/approvalService");
const am = require("../services/docAmendment");

router.use(authenticateToken, attachProjectScope);

const userName = (req) => req.user?.name || req.user?.email || null;
const userId = (req) => req.user?.userId ?? req.user?.id ?? null;
const ADMIN_ROLES = new Set(["super_admin", "admin"]);

/** The document's own page right ("edit") — answered with a 403 by requirePageRight itself when missing. */
const canEditDoc = (docType, req, res) =>
  new Promise((resolve) => {
    const a = am.ADAPTERS[docType];
    if (!a) {
      res.status(400).json({ error: `Documents of type "${docType}" can't be amended yet.` });
      return resolve(false);
    }
    requirePageRight(a.pageKey, "edit")(req, res, () => resolve(true)).then(() => resolve(false), () => resolve(false));
  });

const parseJson = (s) => {
  try {
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
};
const summary = (r) => ({
  id: r.Id,
  docType: r.DocType,
  docId: r.DocId,
  docNo: r.DocNo,
  module: r.Module,
  status: r.Status,
  reason: r.Reason,
  oldValue: r.OldValue != null ? Number(r.OldValue) : null,
  newValue: r.NewValue != null ? Number(r.NewValue) : null,
  requestedBy: r.RequestedBy,
  requestedAt: r.RequestedAt,
  decidedBy: r.DecidedBy,
  decidedAt: r.DecidedAt,
  appliedAt: r.AppliedAt,
  applyError: r.ApplyError,
  rejectionNote: r.RejectionNote,
});

router.post("/preview/:docType/:docId", async (req, res) => {
  const { docType } = req.params;
  const docId = parseInt(req.params.docId, 10);
  if (!Number.isFinite(docId)) return res.status(400).json({ error: "Invalid document id." });
  if (!(await canEditDoc(docType, req, res))) return;
  try {
    const pv = await am.previewAmendment(docType, docId, req.body?.proposed || {});
    if (!assertProjectAllowed(req, res, pv.current.projectId)) return;
    res.json({ blockers: pv.blockers, cascade: pv.cascade, oldValue: pv.oldValue, newValue: pv.newValue, docNo: pv.docNo });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post("/:docType/:docId", async (req, res) => {
  const { docType } = req.params;
  const docId = parseInt(req.params.docId, 10);
  if (!Number.isFinite(docId)) return res.status(400).json({ error: "Invalid document id." });
  if (!(await canEditDoc(docType, req, res))) return;
  const who = userName(req);
  if (!who) return res.status(401).json({ error: "User context missing" });
  try {
    const pv = await am.previewAmendment(docType, docId, req.body?.proposed || {});
    if (!assertProjectAllowed(req, res, pv.current.projectId)) return;
    if (!assertProjectAllowed(req, res, req.body?.proposed?.ProjectId)) return;
    // Who raised it: an amendment applied through the document's own edit route runs that edit as them.
    const requester = { userId: userId(req), roleId: req.user?.roleId ?? null, role: req.user?.role ?? null, email: req.user?.email ?? null, name: req.user?.name ?? null };
    const id = await am.createAmendment(docType, docId, req.body?.proposed || {}, req.body?.reason, who, requester);
    // Submit: starts the approval cycle and notifies the approvers.
    await transition("doc-amendment", id, "Pending", who, req.user?.role, null, userId(req));
    res.status(201).json({ id, message: "Amendment raised — it applies once approved." });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, ...(err.blockers ? { blockers: err.blockers } : {}) });
  }
});

router.get("/", async (req, res) => {
  try {
    const r = getPool().request();
    const where = [];
    if (req.query.module) {
      r.input("module", sql.NVarChar(20), String(req.query.module));
      where.push("Module = @module");
    }
    if (req.query.docType) {
      r.input("docType", sql.NVarChar(40), String(req.query.docType));
      where.push("DocType = @docType");
    }
    if (req.query.docId) {
      r.input("docId", sql.Int, parseInt(req.query.docId, 10) || 0);
      where.push("DocId = @docId");
    }
    // Restricted users see only their projects' amendments.
    if (req.projectScope) {
      const ids = req.projectScope.map(Number).filter(Number.isFinite);
      where.push(ids.length ? `(ProjectId IS NULL OR ProjectId IN (${ids.join(",")}))` : "ProjectId IS NULL");
    }
    const rows = (
      await r.query(`
        SELECT TOP 500 Id, DocType, DocId, DocNo, Module, Status, Reason, OldValue, NewValue, RequestedBy, RequestedAt,
               DecidedBy, DecidedAt, AppliedAt, ApplyError, RejectionNote
        FROM dbo.DocAmendment ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY Id DESC
      `)
    ).recordset;
    res.json(rows.map(summary));
  } catch (err) {
    console.error("[doc-amendments] list error:", err.message);
    res.status(500).json({ error: "Could not load amendments." });
  }
});

router.get("/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid amendment id." });
  try {
    const r = await am.getAmendment(id);
    if (!r) return res.status(404).json({ error: "Amendment not found." });
    if (!assertProjectAllowed(req, res, r.ProjectId)) return;
    const before = parseJson(r.BeforeJson);
    res.json({ ...summary(r), before: before?.row ?? null, proposed: parseJson(r.ProposedJson), cascade: parseJson(r.CascadeJson) ?? [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const decided = (id, who, note = null) =>
  getPool()
    .request()
    .input("id", sql.Int, id)
    .input("who", sql.NVarChar(150), who)
    .input("note", sql.NVarChar(1000), note ? String(note).slice(0, 1000) : null)
    .query("UPDATE dbo.DocAmendment SET DecidedBy = @who, DecidedAt = SYSDATETIME(), RejectionNote = COALESCE(@note, RejectionNote) WHERE Id = @id");

router.put("/:id/approve", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid amendment id." });
  const who = userName(req);
  if (!who) return res.status(401).json({ error: "User context missing" });
  try {
    const amendment = await am.getAmendment(id);
    if (!amendment) return res.status(404).json({ error: "Amendment not found." });
    if (!assertProjectAllowed(req, res, amendment.ProjectId)) return;
    // Every level re-checks the guards: an invoice raised since the request blocks it.
    const result = await transition("doc-amendment", id, "Approved", who, req.user?.role, null, userId(req), () => am.assertStillAmendable(amendment));
    if (result?.newStatus !== "Approved") return res.json({ message: "Approved at this level — waiting on the next.", ...result });
    await decided(id, who);
    try {
      const applied = await am.applyAmendment(id, who);
      res.json({ message: "Amendment approved and applied.", ...result, ...applied });
    } catch (applyErr) {
      res.status(207).json({ message: "Approved, but it could not be applied.", applyError: applyErr.message, ...result });
    }
  } catch (err) {
    res.status(err.status || (String(err.message).includes("not authorized") ? 403 : 400)).json({ error: err.message });
  }
});

router.put("/:id/reject", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid amendment id." });
  const who = userName(req);
  if (!who) return res.status(401).json({ error: "User context missing" });
  try {
    const amendment = await am.getAmendment(id);
    if (!amendment) return res.status(404).json({ error: "Amendment not found." });
    if (!assertProjectAllowed(req, res, amendment.ProjectId)) return;
    const result = await transition("doc-amendment", id, "Rejected", who, req.user?.role, req.body?.note || null, userId(req));
    await decided(id, who, req.body?.note);
    res.json({ message: "Amendment rejected — the document stays as it was.", ...result });
  } catch (err) {
    res.status(err.status || (String(err.message).includes("not authorized") ? 403 : 400)).json({ error: err.message });
  }
});

router.put("/:id/apply", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid amendment id." });
  if (!ADMIN_ROLES.has(String(req.user?.role || ""))) return res.status(403).json({ error: "Only an admin can retry applying an amendment." });
  try {
    const out = await am.applyAmendment(id, userName(req));
    res.json({ message: out.alreadyApplied ? "Already applied." : "Amendment applied.", ...out });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

module.exports = router;
