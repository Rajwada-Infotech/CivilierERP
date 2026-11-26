"use strict";

/**
 * backend/routes/securityAds.js — Maintenance → Ads (super admins only), mounted at /api/security-ads. Video ads for the
 * Civilier Security app's residents: POPUP (a pop-up on the dashboard) and BANNER (the dashboard's ad space).
 *
 *   GET    /             every ad
 *   POST   /             multipart: video (file), kind (POPUP | BANNER), title
 *   PUT    /:id          { title?, isActive? }
 *   DELETE /:id          the ad and its file
 *   GET    /:id/video    the video (Range requests), for the preview
 *
 * Residents get the switched-on ads through /api/security-portal/ads (routes/securityPortal.js).
 */
const express = require("express");
const os = require("os");
const crypto = require("crypto");
const multer = require("multer");
const router = express.Router();
const apiRateLimit = require("../middleware/apiRateLimit");
router.use(apiRateLimit);
const { getPool } = require("../db");
const { isSuperAdmin } = require("../middleware/role");
const ads = require("../services/securityAds");

router.use((req, res, next) => (isSuperAdmin(req.user?.role) ? next() : res.status(403).json({ error: "Only a super admin manages ads." })));

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, os.tmpdir()),
    filename: (_req, _file, cb) => cb(null, `ad-upload-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.tmp`),
  }),
  limits: { fileSize: ads.MAX_BYTES },
});

const idOf = (req) => {
  const n = Number.parseInt(String(req.params.id), 10);
  return Number.isInteger(n) && n > 0 ? n : null;
};
const failed = (req, res, err) => {
  if (err.status) return res.status(err.status).json({ error: err.message });
  if (err.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "The video is larger than 200 MB." });
  if (err.number === 208) return res.status(404).json({ error: "Ads aren't set up on this server yet." });
  req.log?.error?.({ err }, "security ads failed");
  return res.status(500).json({ error: "The ad could not be saved." });
};

router.get("/", async (req, res) => {
  try {
    res.json(await ads.listAds(getPool()));
  } catch (err) {
    failed(req, res, err);
  }
});

router.post("/", (req, res) => {
  upload.single("video")(req, res, async (uploadErr) => {
    if (uploadErr) return failed(req, res, uploadErr);
    try {
      res.json(await ads.addAd(getPool(), Number(req.user?.userId) || null, req.body || {}, req.file));
    } catch (err) {
      failed(req, res, err);
    }
  });
});

router.put("/:id", async (req, res) => {
  const id = idOf(req);
  if (!id) return res.status(400).json({ error: "Invalid ad." });
  try {
    const ad = await ads.updateAd(getPool(), id, req.body || {});
    if (!ad) return res.status(404).json({ error: "Ad not found." });
    res.json(ad);
  } catch (err) {
    failed(req, res, err);
  }
});

router.delete("/:id", async (req, res) => {
  const id = idOf(req);
  if (!id) return res.status(400).json({ error: "Invalid ad." });
  try {
    if (!(await ads.deleteAd(getPool(), id))) return res.status(404).json({ error: "Ad not found." });
    res.json({ success: true });
  } catch (err) {
    failed(req, res, err);
  }
});

router.get("/:id/video", async (req, res) => {
  const id = idOf(req);
  if (!id) return res.status(400).json({ error: "Invalid ad." });
  try {
    await ads.streamAd(getPool(), id, req, res, { activeOnly: false });
  } catch (err) {
    failed(req, res, err);
  }
});

module.exports = router;
