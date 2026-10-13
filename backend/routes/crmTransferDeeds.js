// Transfer Deeds — the legal chain of a resale / buy-back case (migration 560):
// the deed workspace, its stamp duty and its registry. The work lives in
// services/crmTransferDeed.js; this file is the HTTP surface for staff. The
// parties' own portal actions are in routes/crmPortal.js.
const express = require("express");
const multer = require("multer");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const apiRateLimit = require("../middleware/apiRateLimit");
const { requirePageRight } = require("../middleware/requirePageRight");
const { parseId } = require("../middleware/validateRequest");
const { actorId } = require("../services/saAccess");
const svc = require("../services/crmTransferDeed");

router.use(authMiddleware);
router.use(apiRateLimit);
// Project access: a restricted user only reaches deeds of their projects.
{
  const { crmProjectGuards, projectParamGuard } = require("../services/projectScope");
  crmProjectGuards(router, `
  SELECT b.ProjectId FROM dbo.CrmTransferDeed d JOIN dbo.CrmBooking b ON b.Id = d.BookingId WHERE d.Id = @id`);
  // Opening a case's deed: the case's project, the same way the case is guarded.
  router.param("resaleId", projectParamGuard(`
  SELECT COALESCE(p.ProjectId, u.ProjectId, b.ProjectId) AS ProjectId FROM dbo.CrmUnitResale r
  LEFT JOIN dbo.PlotMaster p ON p.Id = r.PlotId LEFT JOIN dbo.UnitMaster u ON u.Id = r.UnitId
  LEFT JOIN dbo.CrmBooking b ON b.Id = r.FromBookingId WHERE r.Id = @id`));
}
// A party is one of the deed's sides — nothing else reaches the service.
router.param("party", (req, res, next, value) => (["Seller", "Buyer"].includes(value) ? next() : res.status(400).json({ error: "Unknown party" })));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, ["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(file.mimetype)),
});
// Remarks arrive as remarks, note (Approval Inbox) or Remarks.
const rmk = (req) => req.body?.remarks ?? req.body?.note ?? req.body?.Remarks ?? null;
const user = (req) => ({ email: req.user?.email || req.user?.name || String(actorId(req)), role: req.user?.role, userId: req.user?.userId ?? actorId(req) });
const fail = (res, e, where) => {
  if (e.status) return res.status(e.status).json({ error: e.message });
  if (/not authorized/i.test(e.message)) return res.status(403).json({ error: e.message });
  if (/Cannot (submit|reject|approve) from status/i.test(e.message)) return res.status(409).json({ error: e.message });
  console.error(`[transfer-deeds] ${where}:`, e.message);
  res.status(500).json({ error: "Something went wrong — please try again" });
};
/** Runs an action on one deed and answers with its fresh state. */
const act = (fn, where) => async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  try {
    await fn(getPool(), id, req);
    res.json(await svc.deedState(getPool(), id));
  } catch (e) { fail(res, e, where); }
};
const withFile = (fn, where) => (req, res) => upload.single("file")(req, res, (err) => {
  if (err) return res.status(400).json({ error: err.message });
  if (!req.file) return res.status(400).json({ error: "Attach a PDF or image" });
  return act(fn, where)(req, res);
});
/** Who did it: staff themselves, or staff for a party (proxy, with how they said it). */
const ctxOf = (req) => (req.body?.ProxyMethod
  ? { actorType: "Proxy", userId: actorId(req), method: req.body.ProxyMethod, remarks: req.body.ProxyRemarks }
  : { actorType: "Staff", userId: actorId(req), remarks: req.body?.Remarks || null });

// ── Lists ────────────────────────────────────────────────────────────────────
router.get("/", requirePageRight("crm-transfer-deeds", "view"), async (req, res) => {
  try {
    res.json(await svc.listDeeds(getPool(), { status: req.query.status || null, projectScope: req.projectScope }));
  } catch (e) { fail(res, e, "GET /"); }
});
router.get("/legal-executives", requirePageRight("crm-transfer-deeds", "view"), async (_req, res) => {
  try {
    res.json((await getPool().request().query(
      "SELECT id, name FROM dbo.users WHERE ISNULL(discontinue, 0) = 0 AND LinkedLHeadId IS NULL ORDER BY name")).recordset);
  } catch (e) { fail(res, e, "GET /legal-executives"); }
});

// Opens (or returns) the deed of a case.
router.post("/for-case/:resaleId", requirePageRight("crm-transfer-deeds", "create"), async (req, res) => {
  const rid = parseId(req.params.resaleId);
  if (rid === null) return res.status(400).json({ error: "Invalid case" });
  try {
    const id = await svc.openForCase(getPool(), rid, actorId(req));
    res.status(201).json(await svc.deedState(getPool(), id));
  } catch (e) { fail(res, e, "POST /for-case"); }
});
router.get("/:id", requirePageRight("crm-transfer-deeds", "view"), async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  try { res.json(await svc.deedState(getPool(), id)); } catch (e) { fail(res, e, "GET /:id"); }
});

// ── Workspace ────────────────────────────────────────────────────────────────
router.put("/:id/legal-executive", requirePageRight("crm-transfer-deeds", "edit"),
  act((db, id, req) => svc.assignLegal(db, id, parseInt(req.body?.LegalExecutiveId, 10), actorId(req)), "assign legal"));
router.post("/:id/documents/request", requirePageRight("crm-transfer-deeds", "edit"),
  act((db, id, req) => svc.requestDocument(db, id, req.body || {}, actorId(req)), "request document"));
router.post("/:id/documents/:docId/upload", requirePageRight("crm-transfer-deeds", "edit"),
  withFile((db, id, req) => svc.uploadDocument(db, id, parseInt(req.params.docId, 10), req.file, ctxOf(req)), "upload document"));
router.put("/:id/documents/:docId/review", requirePageRight("crm-transfer-deeds", "edit"),
  act((db, id, req) => svc.reviewDocument(db, id, parseInt(req.params.docId, 10), req.body?.decision, req.body?.remarks, actorId(req)), "review document"));
router.get("/:id/documents/:docId/file", requirePageRight("crm-transfer-deeds", "view"), async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  try {
    const f = await svc.documentFile(getPool(), id, parseInt(req.params.docId, 10));
    if (!f?.FileBase64) return res.status(404).json({ error: "No file uploaded yet" });
    res.setHeader("Content-Type", f.MimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(f.FileName || "document")}"`);
    res.send(Buffer.from(f.FileBase64, "base64"));
  } catch (e) { fail(res, e, "GET file"); }
});
router.put("/:id/submit", requirePageRight("crm-transfer-deeds", "edit"), act((db, id, req) => svc.submitForLegal(db, id, user(req)), "submit"));
router.put("/:id/legal/approve", requirePageRight("crm-transfer-deeds", "edit"), act((db, id, req) => svc.legalDecision(db, id, true, rmk(req), user(req)), "legal approve"));
router.put("/:id/legal/reject", requirePageRight("crm-transfer-deeds", "edit"), act((db, id, req) => svc.legalDecision(db, id, false, rmk(req), user(req)), "legal reject"));
router.put("/:id/send-to-parties", requirePageRight("crm-transfer-deeds", "edit"), act((db, id, req) => svc.sendToParties(db, id, actorId(req)), "send to parties"));
// Staff record a party's answer for them (proxy — ProxyMethod + ProxyRemarks required).
router.put("/:id/parties/:party/respond", requirePageRight("crm-transfer-deeds", "edit"), act((db, id, req) => {
  if (!req.body?.ProxyMethod) throw new svc.DeedError("Say how the party told you (ProxyMethod) — or let them answer in the portal");
  return svc.partyRespond(db, id, String(req.params.party), req.body?.decision, ctxOf(req));
}, "party respond"));
router.put("/:id/date/propose", requirePageRight("crm-transfer-deeds", "edit"), act((db, id, req) => {
  const by = req.body?.ProposedBy || "Company";
  if (by !== "Company" && !req.body?.ProxyMethod) throw new svc.DeedError("A party's proposal is recorded with how they said it (ProxyMethod)");
  return svc.proposeDate(db, id, by, req.body?.Date, by === "Company" ? { actorType: "Staff", userId: actorId(req) } : ctxOf(req), user(req));
}, "propose date"));
router.put("/:id/date/accept/:party", requirePageRight("crm-transfer-deeds", "edit"), act((db, id, req) => {
  if (!req.body?.ProxyMethod) throw new svc.DeedError("Say how the party accepted it (ProxyMethod) — or let them accept in the portal");
  return svc.acceptDate(db, id, String(req.params.party), ctxOf(req), user(req));
}, "accept date"));
router.put("/:id/date/approve", requirePageRight("crm-transfer-deeds", "edit"), act((db, id, req) => svc.dateDecision(db, id, true, rmk(req), user(req)), "date approve"));
router.put("/:id/date/reject", requirePageRight("crm-transfer-deeds", "edit"), act((db, id, req) => svc.dateDecision(db, id, false, rmk(req), user(req)), "date reject"));
router.put("/:id/execute", requirePageRight("crm-transfer-deeds", "edit"), act((db, id, req) => svc.markExecuted(db, id, actorId(req)), "execute"));
router.put("/:id/cancel", requirePageRight("crm-transfer-deeds", "edit"), act((db, id, req) => svc.cancelDeed(db, id, req.body?.remarks, actorId(req)), "cancel"));

// ── Stamp duty ───────────────────────────────────────────────────────────────
router.put("/:id/duty/info", requirePageRight("crm-transfer-deeds", "edit"), act((db, id, req) => svc.sendDutyInfo(db, id, req.body || {}, actorId(req)), "duty info"));
router.post("/:id/duty/proof", requirePageRight("crm-transfer-deeds", "edit"), withFile((db, id, req) => svc.uploadDutyProof(db, id, req.file, req.body || {}, ctxOf(req)), "duty proof"));
router.put("/:id/duty/confirm", requirePageRight("crm-transfer-deeds", "edit"), act((db, id, req) => svc.confirmDuty(db, id, true, req.body?.remarks, actorId(req)), "duty confirm"));
router.put("/:id/duty/return", requirePageRight("crm-transfer-deeds", "edit"), act((db, id, req) => svc.confirmDuty(db, id, false, req.body?.remarks, actorId(req)), "duty return"));
router.get("/:id/duty/proof", requirePageRight("crm-transfer-deeds", "view"), async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  try {
    const f = await svc.dutyProof(getPool(), id);
    if (!f?.FileBase64) return res.status(404).json({ error: "No proof uploaded yet" });
    res.setHeader("Content-Type", f.MimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(f.FileName || "proof")}"`);
    res.send(Buffer.from(f.FileBase64, "base64"));
  } catch (e) { fail(res, e, "GET duty proof"); }
});

// ── Registry ─────────────────────────────────────────────────────────────────
router.put("/:id/registry/schedule", requirePageRight("crm-transfer-deeds", "edit"), act((db, id, req) => svc.scheduleRegistry(db, id, req.body || {}, actorId(req)), "registry schedule"));
router.post("/:id/registry/copy", requirePageRight("crm-transfer-deeds", "edit"), withFile((db, id, req) => svc.uploadRegisteredCopy(db, id, req.file, actorId(req)), "registry copy"));
router.put("/:id/registry/copy/verify", requirePageRight("crm-transfer-deeds", "edit"), act((db, id, req) => svc.verifyRegisteredCopy(db, id, true, req.body?.remarks, actorId(req)), "registry copy verify"));
router.put("/:id/registry/copy/reject", requirePageRight("crm-transfer-deeds", "edit"), act((db, id, req) => svc.verifyRegisteredCopy(db, id, false, req.body?.remarks, actorId(req)), "registry copy reject"));
router.put("/:id/registry/complete", requirePageRight("crm-transfer-deeds", "edit"), act((db, id, req) => svc.completeRegistry(db, id, req.body || {}, actorId(req)), "registry complete"));

module.exports = router;
