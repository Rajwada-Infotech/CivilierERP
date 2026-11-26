"use strict";

/**
 * Video ads in the Civilier Security app (residents only). POPUP ads play in a pop-up on the resident's dashboard;
 * BANNER ads play in the dashboard's ad space. Files are stored on disk under uploads/security-ads (a Docker volume in
 * production) with random names; dbo.SecurityAd (migration 722) holds the list.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { sql } = require("../db");

const ADS_DIR = process.env.SECURITY_ADS_DIR || path.join(__dirname, "..", "uploads", "security-ads");
const KINDS = ["POPUP", "BANNER"];
const TYPES = { "video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov" };
const MAX_BYTES = 200 * 1024 * 1024;

const toAd = (r) => ({
  id: r.AdId,
  kind: r.Kind,
  title: r.Title,
  originalName: r.OriginalName,
  mimeType: r.MimeType,
  sizeBytes: Number(r.SizeBytes),
  isActive: !!r.IsActive,
  createdAt: r.CreatedAt,
});

async function listAds(pool, { activeOnly = false } = {}) {
  return (
    await pool.request().query(`
      SELECT AdId, Kind, Title, OriginalName, MimeType, SizeBytes, IsActive, CreatedAt FROM dbo.SecurityAd
      ${activeOnly ? "WHERE IsActive = 1" : ""} ORDER BY Kind, CreatedAt DESC`)
  ).recordset.map(toAd);
}

/** Stores an uploaded video (the temp file multer wrote) and records it. */
async function addAd(pool, userId, { kind, title }, file) {
  const fail = (m) => Object.assign(new Error(m), { status: 400 });
  try {
    if (!file) throw fail("Choose a video file.");
    const k = String(kind || "").toUpperCase();
    if (!KINDS.includes(k)) throw fail("Choose pop-up or dashboard video.");
    const ext = TYPES[file.mimetype];
    if (!ext) throw fail("Upload an MP4, WebM or MOV video.");
    const t = String(title || "").trim().slice(0, 120) || path.parse(file.originalname || "").name.slice(0, 120) || "Ad";
    fs.mkdirSync(ADS_DIR, { recursive: true });
    const name = `${crypto.randomUUID()}${ext}`;
    // Copy then remove: the temp folder may be on another disk than the uploads volume (rename would fail).
    fs.copyFileSync(file.path, path.join(ADS_DIR, name));
    const r = await pool
      .request()
      .input("k", sql.NVarChar(10), k)
      .input("t", sql.NVarChar(120), t)
      .input("f", sql.NVarChar(100), name)
      .input("o", sql.NVarChar(260), (file.originalname || "").slice(0, 260))
      .input("m", sql.NVarChar(50), file.mimetype)
      .input("s", sql.BigInt, file.size)
      .input("u", sql.Int, userId || null).query(`
        INSERT INTO dbo.SecurityAd (Kind, Title, FileName, OriginalName, MimeType, SizeBytes, CreatedBy)
        OUTPUT INSERTED.AdId, INSERTED.Kind, INSERTED.Title, INSERTED.OriginalName, INSERTED.MimeType, INSERTED.SizeBytes, INSERTED.IsActive, INSERTED.CreatedAt
        VALUES (@k, @t, @f, @o, @m, @s, @u)`);
    return toAd(r.recordset[0]);
  } finally {
    if (file?.path) fs.rm(file.path, { force: true }, () => {});
  }
}

async function updateAd(pool, id, { title, isActive }) {
  const r = await pool
    .request()
    .input("id", sql.Int, id)
    .input("t", sql.NVarChar(120), typeof title === "string" && title.trim() ? title.trim().slice(0, 120) : null)
    .input("a", sql.Bit, typeof isActive === "boolean" ? isActive : null).query(`
      UPDATE dbo.SecurityAd SET Title = ISNULL(@t, Title), IsActive = ISNULL(@a, IsActive)
      OUTPUT INSERTED.AdId, INSERTED.Kind, INSERTED.Title, INSERTED.OriginalName, INSERTED.MimeType, INSERTED.SizeBytes, INSERTED.IsActive, INSERTED.CreatedAt
      WHERE AdId = @id`);
  return r.recordset[0] ? toAd(r.recordset[0]) : null;
}

/** Deletes the ad and its file. */
async function deleteAd(pool, id) {
  const r = await pool.request().input("id", sql.Int, id).query(`DELETE FROM dbo.SecurityAd OUTPUT DELETED.FileName WHERE AdId = @id`);
  const name = r.recordset[0]?.FileName;
  if (name) await fs.promises.rm(path.join(ADS_DIR, path.basename(name)), { force: true }).catch(() => {});
  return !!name;
}

/**
 * Streams an ad's video, honouring Range requests (players seek and buffer by range). `activeOnly`: residents only
 * get ads that are switched on.
 */
async function streamAd(pool, id, req, res, { activeOnly }) {
  const row = (
    await pool.request().input("id", sql.Int, id).query(`SELECT FileName, MimeType, IsActive FROM dbo.SecurityAd WHERE AdId = @id`)
  ).recordset[0];
  if (!row || (activeOnly && !row.IsActive)) return res.status(404).json({ error: "Ad not found." });
  const file = path.join(ADS_DIR, path.basename(row.FileName));
  let size;
  try {
    size = fs.statSync(file).size;
  } catch {
    return res.status(404).json({ error: "The video file is missing." });
  }
  res.setHeader("Content-Type", row.MimeType);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "private, max-age=3600");
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ""));
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    let end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start >= size || start > end) {
      res.setHeader("Content-Range", `bytes */${size}`);
      return res.status(416).end();
    }
    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
    res.setHeader("Content-Length", end - start + 1);
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.setHeader("Content-Length", size);
  return fs.createReadStream(file).pipe(res);
}

module.exports = { ADS_DIR, KINDS, TYPES, MAX_BYTES, listAds, addAd, updateAd, deleteAd, streamAd };
