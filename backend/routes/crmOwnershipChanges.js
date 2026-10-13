// Ownership Changes — the new owner of a conveyed property, recorded from
// their registered sale deed and approved (services/crmOwnershipChange.js).
const express = require("express");
const multer = require("multer");
const router = express.Router();
const { getPool } = require("../db");
const authMiddleware = require("../middleware/auth");
const apiRateLimit = require("../middleware/apiRateLimit");
const { requirePageRight } = require("../middleware/requirePageRight");
const { parseId } = require("../middleware/validateRequest");
const { actorId } = require("../services/saAccess");
const svc = require("../services/crmOwnershipChange");

router.use(authMiddleware);
router.use(apiRateLimit);
// Project access: a restricted user only reaches records of their projects.
{
  const { crmProjectGuards } = require("../services/projectScope");
  crmProjectGuards(router, `
  SELECT b.ProjectId FROM dbo.CrmOwnershipChange o JOIN dbo.CrmBooking b ON b.Id = o.BookingId WHERE o.Id = @id`);
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, ["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(file.mimetype)),
});
const user = (req) => ({ email: req.user?.email || req.user?.name || String(actorId(req)), role: req.user?.role, userId: req.user?.userId ?? actorId(req) });
// Remarks arrive as note (Approval Inbox), remarks or Remarks.
const rmk = (req) => req.body?.note ?? req.body?.remarks ?? req.body?.Remarks ?? null;
const fail = (res, e, where) => {
  if (e.status) return res.status(e.status).json({ error: e.message });
  if (/not authorized|someone else has to approve/i.test(e.message)) return res.status(403).json({ error: e.message });
  if (/Cannot (submit|reject|approve) from status/i.test(e.message)) return res.status(409).json({ error: e.message });
  console.error(`[ownership-changes] ${where}:`, e.message);
  res.status(500).json({ error: "Something went wrong — please try again" });
};
const withId = (fn, where) => async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  try { res.json(await fn(getPool(), id, req)); } catch (e) { fail(res, e, where); }
};

router.get("/", requirePageRight("crm-ownership-changes", "view"), async (req, res) => {
  try { res.json(await svc.list(getPool(), { status: req.query.status || "", search: req.query.search || "", projectScope: req.projectScope })); }
  catch (e) { fail(res, e, "GET /"); }
});
router.get("/eligible-bookings", requirePageRight("crm-ownership-changes", "view"), async (req, res) => {
  try { res.json(await svc.eligibleBookings(getPool(), { search: req.query.search || "", projectScope: req.projectScope })); }
  catch (e) { fail(res, e, "GET /eligible-bookings"); }
});
router.post("/", requirePageRight("crm-ownership-changes", "create"), async (req, res) => {
  try { res.status(201).json(await svc.create(getPool(), req.body || {}, actorId(req), req.projectScope)); }
  catch (e) { fail(res, e, "POST /"); }
});
router.get("/:id", requirePageRight("crm-ownership-changes", "view"), withId((db, id) => svc.load(db, id), "GET /:id"));
router.put("/:id", requirePageRight("crm-ownership-changes", "edit"), withId((db, id, req) => svc.update(db, id, req.body || {}, actorId(req)), "PUT /:id"));
router.post("/:id/deed", requirePageRight("crm-ownership-changes", "edit"), (req, res) => upload.single("file")(req, res, (err) => {
  if (err) return res.status(400).json({ error: err.message });
  if (!req.file) return res.status(400).json({ error: "Attach the registered sale deed (PDF or image)" });
  return withId((db, id) => svc.attachDeed(db, id, req.file, actorId(req)), "POST deed")(req, res);
}));
router.get("/:id/deed", requirePageRight("crm-ownership-changes", "view"), async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  try {
    const f = await svc.deedFile(getPool(), id);
    if (!f?.FileBase64) return res.status(404).json({ error: "No deed copy yet" });
    res.setHeader("Content-Type", f.MimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(f.FileName || "sale-deed")}"`);
    res.send(Buffer.from(f.FileBase64, "base64"));
  } catch (e) { fail(res, e, "GET deed"); }
});
router.put("/:id/submit", requirePageRight("crm-ownership-changes", "edit"), withId((db, id, req) => svc.submit(db, id, user(req)), "submit"));
router.put("/:id/approve", requirePageRight("crm-ownership-changes", "edit"), withId((db, id, req) => svc.decide(db, id, true, rmk(req), user(req)), "approve"));
router.put("/:id/reject", requirePageRight("crm-ownership-changes", "edit"), withId((db, id, req) => svc.decide(db, id, false, rmk(req), user(req)), "reject"));
router.put("/:id/cancel", requirePageRight("crm-ownership-changes", "edit"), withId((db, id, req) => svc.cancel(db, id, rmk(req), actorId(req)), "cancel"));

module.exports = router;
