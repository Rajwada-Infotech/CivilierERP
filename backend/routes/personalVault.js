"use strict";

/**
 * backend/routes/personalVault.js
 *
 * Records module's "New Folder" feature — a private, per-user file vault
 * unrelated to any business/project document. Any file type is accepted
 * (images, PDFs, Office docs, CSV, etc — no fileFilter, unlike Vehicle
 * In/Out's image+PDF restriction). Files are grouped into folders by a
 * free-text FolderName column on each file row; dbo.PersonalVaultFolders
 * holds one row per (OwnerId, FolderName) purely to carry an optional
 * PasswordHash.
 *
 * Strictly owner-scoped: every route filters by the authenticated user's
 * own id, and there is no admin-sees-all override like the other Records
 * sources (recordsRoutes.js) have — these are explicitly personal files.
 *
 * Password-protected folders: unlocking a folder (POST /folder/:name/unlock)
 * issues a short-lived JWT (30 min, purpose="vault-unlock", scoped to
 * ownerId+folderName) that the frontend must send back as the
 * `X-Vault-Token` header on every file-level operation on that folder
 * (stream/download, upload more, delete file/folder). Forgetting the
 * folder password is recovered by re-proving the user's own ERP account
 * password (POST /folder/:name/reset-password) — same bcrypt-compare
 * pattern userProfile.js's change-password route already uses against
 * dbo.users, not a new credential system.
 */

const express = require("express");
const router = express.Router();
const multer = require("multer");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const authenticateToken = require("../middleware/auth");

router.use(authenticateToken);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB per file — no type restriction
});

const SALT_ROUNDS = 12;
const UNLOCK_TOKEN_TTL = "30m";

function ownerId(req, res) {
  const id = req.user?.userId ?? req.user?.id;
  if (!id) {
    res.status(401).json({ error: "User context missing" });
    return null;
  }
  return id;
}

function signUnlockToken(uid, folderName) {
  return jwt.sign(
    { purpose: "vault-unlock", ownerId: uid, folderName },
    process.env.JWT_SECRET,
    { expiresIn: UNLOCK_TOKEN_TTL },
  );
}

/** Verifies the X-Vault-Token header matches this owner+folder. Throws-free —
 *  returns true/false so callers decide the response shape. */
function hasValidUnlockToken(req, uid, folderName) {
  const token = req.headers["x-vault-token"];
  if (!token) return false;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return (
      decoded.purpose === "vault-unlock" &&
      decoded.ownerId === uid &&
      decoded.folderName === folderName
    );
  } catch {
    return false;
  }
}

async function getFolderRow(pool, uid, folderName) {
  const r = await pool
    .request()
    .input("OwnerId", sql.Int, uid)
    .input("FolderName", sql.NVarChar(200), folderName).query(`
      SELECT Id, PasswordHash FROM dbo.PersonalVaultFolders
      WHERE OwnerId = @OwnerId AND FolderName = @FolderName
    `);
  return r.recordset[0] || null;
}

/** True if this owner+folder requires (and the request doesn't already
 *  carry) a valid unlock token — i.e. the caller should be rejected. */
async function isLockedOut(req, pool, uid, folderName) {
  const folder = await getFolderRow(pool, uid, folderName);
  if (!folder || !folder.PasswordHash) return false; // no password set — open
  return !hasValidUnlockToken(req, uid, folderName);
}

// ── GET /folders — this user's distinct folders, newest-file-first ───────────
router.get("/folders", async (req, res) => {
  const uid = ownerId(req, res);
  if (!uid) return;
  try {
    const pool = getPool();
    const result = await pool.request().input("OwnerId", sql.Int, uid).query(`
      SELECT f.FolderName, COUNT(*) AS FileCount, SUM(f.FileSize) AS TotalSize,
             MAX(f.UploadedAt) AS LatestUploadedAt,
             CASE WHEN pf.PasswordHash IS NOT NULL THEN 1 ELSE 0 END AS HasPassword
      FROM dbo.PersonalVaultFiles f
      LEFT JOIN dbo.PersonalVaultFolders pf
        ON pf.OwnerId = f.OwnerId AND pf.FolderName = f.FolderName
      WHERE f.OwnerId = @OwnerId
      GROUP BY f.FolderName, pf.PasswordHash
      ORDER BY MAX(f.UploadedAt) DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /upload — multipart, fields: folderName + optional password + file[] ─
// `password` is only honored the first time a folder is created (protects
// against silently re-protecting/changing an existing folder's password
// through the upload path instead of the dedicated set/reset routes).
router.post("/upload", upload.array("file", 20), async (req, res) => {
  const uid = ownerId(req, res);
  if (!uid) return;
  const folderName = (req.body.folderName || "").trim();
  if (!folderName) return res.status(400).json({ error: "folderName is required" });
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: "At least one file is required" });

  try {
    const pool = getPool();
    let folder = await getFolderRow(pool, uid, folderName);

    if (!folder) {
      const password = (req.body.password || "").trim();
      const passwordHash = password ? await bcrypt.hash(password, SALT_ROUNDS) : null;
      const ins = await pool
        .request()
        .input("OwnerId", sql.Int, uid)
        .input("FolderName", sql.NVarChar(200), folderName)
        .input("PasswordHash", sql.NVarChar(200), passwordHash).query(`
          INSERT INTO dbo.PersonalVaultFolders (OwnerId, FolderName, PasswordHash)
          OUTPUT INSERTED.Id, INSERTED.PasswordHash
          VALUES (@OwnerId, @FolderName, @PasswordHash)
        `);
      folder = ins.recordset[0];
    } else if (folder.PasswordHash && !hasValidUnlockToken(req, uid, folderName)) {
      return res.status(423).json({ error: "This folder is locked — unlock it first" });
    }

    const inserted = [];
    for (const f of files) {
      const result = await pool
        .request()
        .input("OwnerId", sql.Int, uid)
        .input("FolderName", sql.NVarChar(200), folderName)
        .input("FileName", sql.NVarChar(300), f.originalname)
        .input("MimeType", sql.NVarChar(150), f.mimetype || null)
        .input("FileSize", sql.Int, f.size)
        .input("FileData", sql.VarBinary(sql.MAX), f.buffer).query(`
          INSERT INTO dbo.PersonalVaultFiles (OwnerId, FolderName, FileName, MimeType, FileSize, FileData)
          OUTPUT INSERTED.Id
          VALUES (@OwnerId, @FolderName, @FileName, @MimeType, @FileSize, @FileData)
        `);
      inserted.push({ id: result.recordset[0].Id, filename: f.originalname });
    }
    res.json({ folderName, files: inserted, hasPassword: !!folder?.PasswordHash });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /folder/:name/unlock — body {password} → short-lived token ──────────
router.post("/folder/:name/unlock", async (req, res) => {
  const uid = ownerId(req, res);
  if (!uid) return;
  const folderName = decodeURIComponent(req.params.name || "").trim();
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: "password is required" });
  try {
    const pool = getPool();
    const folder = await getFolderRow(pool, uid, folderName);
    if (!folder) return res.status(404).json({ error: "Folder not found" });
    if (!folder.PasswordHash) {
      // Not actually protected — issue a token anyway so the frontend's
      // "unlocked" state stays consistent either way.
      return res.json({ token: signUnlockToken(uid, folderName) });
    }
    const match = await bcrypt.compare(password, folder.PasswordHash);
    if (!match) return res.status(401).json({ error: "Incorrect folder password" });
    res.json({ token: signUnlockToken(uid, folderName) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /folder/:name/set-password — protect/change/remove; requires current
// unlock token if the folder already has a password ──────────────────────────
router.post("/folder/:name/set-password", async (req, res) => {
  const uid = ownerId(req, res);
  if (!uid) return;
  const folderName = decodeURIComponent(req.params.name || "").trim();
  const { newPassword } = req.body; // "" / null clears protection
  try {
    const pool = getPool();
    const folder = await getFolderRow(pool, uid, folderName);
    if (!folder) return res.status(404).json({ error: "Folder not found" });
    if (folder.PasswordHash && !hasValidUnlockToken(req, uid, folderName)) {
      return res.status(423).json({ error: "This folder is locked — unlock it first" });
    }
    const newHash = newPassword ? await bcrypt.hash(newPassword, SALT_ROUNDS) : null;
    await pool
      .request()
      .input("Id", sql.Int, folder.Id)
      .input("PasswordHash", sql.NVarChar(200), newHash)
      .query("UPDATE dbo.PersonalVaultFolders SET PasswordHash = @PasswordHash, UpdatedAt = SYSDATETIME() WHERE Id = @Id");
    res.json({
      message: newHash ? "Folder password set" : "Folder password removed",
      token: newHash ? signUnlockToken(uid, folderName) : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /folder/:name/reset-password — "forgot password" recovery: proves
// identity via the user's own ERP account password instead ───────────────────
router.post("/folder/:name/reset-password", async (req, res) => {
  const uid = ownerId(req, res);
  if (!uid) return;
  const folderName = decodeURIComponent(req.params.name || "").trim();
  const { accountPassword, newPassword } = req.body;
  if (!accountPassword) return res.status(400).json({ error: "Your account password is required" });
  try {
    const pool = getPool();
    const folder = await getFolderRow(pool, uid, folderName);
    if (!folder) return res.status(404).json({ error: "Folder not found" });

    const userRow = await pool
      .request()
      .input("id", sql.Int, uid)
      .query("SELECT password FROM dbo.users WHERE id = @id");
    if (!userRow.recordset.length) return res.status(404).json({ error: "User not found" });

    const match = await bcrypt.compare(accountPassword, userRow.recordset[0].password);
    if (!match) return res.status(401).json({ error: "Your account password is incorrect" });

    const newHash = newPassword ? await bcrypt.hash(newPassword, SALT_ROUNDS) : null;
    await pool
      .request()
      .input("Id", sql.Int, folder.Id)
      .input("PasswordHash", sql.NVarChar(200), newHash)
      .query("UPDATE dbo.PersonalVaultFolders SET PasswordHash = @PasswordHash, UpdatedAt = SYSDATETIME() WHERE Id = @Id");
    res.json({
      message: "Folder password reset",
      token: newHash ? signUnlockToken(uid, folderName) : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /file/:id — stream (owner + unlock-token-if-locked) ──────────────────
router.get("/file/:id", async (req, res) => {
  const uid = ownerId(req, res);
  if (!uid) return;
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("Id", sql.Int, id)
      .input("OwnerId", sql.Int, uid).query(`
        SELECT FileName, MimeType, FileData, FolderName
        FROM dbo.PersonalVaultFiles
        WHERE Id = @Id AND OwnerId = @OwnerId
      `);
    if (!result.recordset.length) return res.status(404).json({ error: "File not found" });
    const file = result.recordset[0];
    if (await isLockedOut(req, pool, uid, file.FolderName)) {
      return res.status(423).json({ error: "This folder is locked — unlock it first" });
    }
    res.setHeader("Content-Type", file.MimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(file.FileName)}"`);
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.send(file.FileData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /bulk — body {ids: number[]} — owner + unlock-token-if-locked,
// checked per distinct folder among the selected files ───────────────────────
router.delete("/bulk", async (req, res) => {
  const uid = ownerId(req, res);
  if (!uid) return;
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((n) => parseInt(n, 10)).filter(Number.isFinite) : [];
  if (!ids.length) return res.status(400).json({ error: "ids[] is required" });
  try {
    const pool = getPool();
    const idList = ids.join(",");
    const rows = await pool.request().input("OwnerId", sql.Int, uid).query(`
      SELECT Id, FolderName FROM dbo.PersonalVaultFiles
      WHERE OwnerId = @OwnerId AND Id IN (${idList})
    `);
    const folders = [...new Set(rows.recordset.map((r) => r.FolderName))];
    for (const folderName of folders) {
      if (await isLockedOut(req, pool, uid, folderName)) {
        return res.status(423).json({ error: `Folder "${folderName}" is locked — unlock it first` });
      }
    }
    const del = await pool.request().input("OwnerId", sql.Int, uid).query(`
      DELETE FROM dbo.PersonalVaultFiles WHERE OwnerId = @OwnerId AND Id IN (${idList})
    `);
    res.json({ message: "Files deleted", deleted: del.rowsAffected[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /:id — owner + unlock-token-if-locked ──────────────────────────────
router.delete("/:id", async (req, res) => {
  const uid = ownerId(req, res);
  if (!uid) return;
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const row = await pool
      .request()
      .input("Id", sql.Int, id)
      .input("OwnerId", sql.Int, uid)
      .query("SELECT FolderName FROM dbo.PersonalVaultFiles WHERE Id = @Id AND OwnerId = @OwnerId");
    if (!row.recordset.length) return res.status(404).json({ error: "File not found" });
    if (await isLockedOut(req, pool, uid, row.recordset[0].FolderName)) {
      return res.status(423).json({ error: "This folder is locked — unlock it first" });
    }
    await pool
      .request()
      .input("Id", sql.Int, id)
      .input("OwnerId", sql.Int, uid)
      .query("DELETE FROM dbo.PersonalVaultFiles WHERE Id = @Id AND OwnerId = @OwnerId");
    res.json({ message: "File deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /folder/:name — whole folder, owner + unlock-token-if-locked ──────
router.delete("/folder/:name", async (req, res) => {
  const uid = ownerId(req, res);
  if (!uid) return;
  const folderName = decodeURIComponent(req.params.name || "").trim();
  if (!folderName) return res.status(400).json({ error: "Invalid folder name" });
  try {
    const pool = getPool();
    if (await isLockedOut(req, pool, uid, folderName)) {
      return res.status(423).json({ error: "This folder is locked — unlock it first" });
    }
    await pool
      .request()
      .input("OwnerId", sql.Int, uid)
      .input("FolderName", sql.NVarChar(200), folderName)
      .query("DELETE FROM dbo.PersonalVaultFiles WHERE OwnerId = @OwnerId AND FolderName = @FolderName");
    await pool
      .request()
      .input("OwnerId", sql.Int, uid)
      .input("FolderName", sql.NVarChar(200), folderName)
      .query("DELETE FROM dbo.PersonalVaultFolders WHERE OwnerId = @OwnerId AND FolderName = @FolderName");
    res.json({ message: "Folder deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
