const express = require("express");
const router = express.Router();
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const ApkReader = require("adbkit-apkreader");

const { getPool, sql } = require("../db");
const authenticateToken = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");

// The folder nginx serves at /downloads/ (docker-compose mounts the host's
// ./apk-releases here read-write for this service). Outside Docker it falls
// back to <repo>/apk-releases.
const APK_DIR = process.env.APK_RELEASES_DIR || path.join(__dirname, "..", "apk-releases");

// One entry per mobile app. fileName is the stable name the file is served
// under (/downloads/<fileName>), so existing download links keep working.
// packageName must match the uploaded APK's own manifest, which stops the
// wrong app's build being published under a different app's name.
const APP_CATALOG = {
  "finance-material": { label: "CivilierERP (Finance & Material)", packageName: "com.rajwadainfotech.civiliererp", fileName: "CivilierERP.apk" },
  admin: { label: "CivilierERP Admin", packageName: "com.rajwadainfotech.civiliererpadmin", fileName: "CivilierERPAdmin.apk" },
  supplier: { label: "CivilierERP Supplier", packageName: "com.rajwadainfotech.civiliererpsupplier", fileName: "CivilierERPSupplier.apk" },
  "fixed-asset": { label: "Civilier Fixed Asset", packageName: "com.rajwadainfotech.civiliererpfixedasset", fileName: "CivilierERPFixedAsset.apk" },
  "follow-up": { label: "Civilier Follow-Up", packageName: "com.rajwadainfotech.civilierfollowup", fileName: "CivilierERPFollowUp.apk" },
  maintenance: { label: "Civilier Maintenance", packageName: "com.rajwadainfotech.civiliermaintenance", fileName: "CivilierERPMaintenance.apk" },
};

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, os.tmpdir()),
    filename: (_req, _file, cb) => cb(null, `apk-upload-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.tmp`),
  }),
  limits: { fileSize: 250 * 1024 * 1024 },
});

const toRelease = (r) => ({
  id: r.AppReleaseId,
  appKey: r.AppKey,
  packageName: r.PackageName,
  versionCode: r.VersionCode,
  versionName: r.VersionName,
  sizeBytes: Number(r.SizeBytes),
  sha256: r.Sha256,
  md5: r.Md5,
  releaseNotes: r.ReleaseNotes,
  mandatory: !!r.IsMandatory,
  isCurrent: !!r.IsCurrent,
  publishedBy: r.PublishedBy,
  publishedAt: r.PublishedAt,
  // Query string busts caches when the same file name is overwritten.
  downloadPath: `/downloads/${r.FileName}?v=${r.VersionCode}`,
});

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const sha = crypto.createHash("sha256");
    const md5 = crypto.createHash("md5");
    const s = fs.createReadStream(filePath);
    s.on("data", (d) => {
      sha.update(d);
      md5.update(d);
    });
    s.on("end", () => resolve({ sha256: sha.digest("hex"), md5: md5.digest("hex") }));
    s.on("error", reject);
  });
}

// GET /latest?app=<appKey> — PUBLIC. Called by each mobile app on launch,
// before/without login, to learn the newest published build of itself.
router.get("/latest", async (req, res) => {
  const appKey = String(req.query.app || "");
  if (!APP_CATALOG[appKey]) return res.status(400).json({ error: "Unknown app." });
  try {
    const pool = getPool();
    const r = await pool.request().input("k", sql.NVarChar(40), appKey).query(
      "SELECT TOP 1 * FROM dbo.AppRelease WHERE AppKey = @k AND IsCurrent = 1 ORDER BY VersionCode DESC",
    );
    if (!r.recordset.length) return res.json({ available: false });
    res.set("Cache-Control", "no-store");
    res.json({ available: true, ...toRelease(r.recordset[0]) });
  } catch (err) {
    console.error("[app-releases] GET /latest error:", err.message);
    res.status(500).json({ error: "Failed to check for updates" });
  }
});

// GET /catalog — the six apps with their current release (APK Manager page).
router.get("/catalog", authenticateToken, requirePageRight("apk-manager", "view"), async (_req, res) => {
  try {
    const pool = getPool();
    const r = await pool.request().query("SELECT * FROM dbo.AppRelease WHERE IsCurrent = 1");
    const byKey = new Map(r.recordset.map((x) => [x.AppKey, toRelease(x)]));
    res.json(
      Object.entries(APP_CATALOG).map(([appKey, a]) => ({
        appKey,
        label: a.label,
        packageName: a.packageName,
        current: byKey.get(appKey) || null,
      })),
    );
  } catch (err) {
    console.error("[app-releases] GET /catalog error:", err.message);
    res.status(500).json({ error: "Failed to load apps" });
  }
});

// GET / — release history, optionally for one app.
router.get("/", authenticateToken, requirePageRight("apk-manager", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const request = pool.request();
    let where = "";
    if (req.query.app) {
      request.input("k", sql.NVarChar(40), String(req.query.app));
      where = "WHERE AppKey = @k";
    }
    const r = await request.query(`SELECT * FROM dbo.AppRelease ${where} ORDER BY PublishedAt DESC, AppReleaseId DESC`);
    res.json(r.recordset.map(toRelease));
  } catch (err) {
    console.error("[app-releases] GET / error:", err.message);
    res.status(500).json({ error: "Failed to load releases" });
  }
});

// POST / — publish a new build. multipart: file (.apk), appKey, releaseNotes,
// mandatory. The version comes from the APK itself, never from the form.
router.post(
  "/",
  authenticateToken,
  requirePageRight("apk-manager", "create"),
  upload.single("file"),
  async (req, res) => {
    const tmp = req.file?.path;
    const cleanup = () => tmp && fs.promises.unlink(tmp).catch(() => {});
    try {
      const appKey = String(req.body?.appKey || "");
      const app = APP_CATALOG[appKey];
      if (!app) return (await cleanup(), res.status(400).json({ error: "Choose which app this build is for." }));
      if (!req.file) return res.status(400).json({ error: "Attach the .apk file." });

      let manifest;
      try {
        const reader = await ApkReader.open(tmp);
        manifest = await reader.readManifest();
      } catch (e) {
        await cleanup();
        return res.status(400).json({ error: "That file isn't a readable Android APK." });
      }
      if (manifest.package !== app.packageName) {
        await cleanup();
        return res.status(400).json({
          error: `This APK is for "${manifest.package}", but ${app.label} is "${app.packageName}". Pick the right app or file.`,
        });
      }
      const versionCode = Number(manifest.versionCode);
      if (!Number.isInteger(versionCode) || versionCode <= 0) {
        await cleanup();
        return res.status(400).json({ error: "Couldn't read a version code from this APK." });
      }

      const pool = getPool();
      const latest = await pool.request().input("k", sql.NVarChar(40), appKey).query(
        "SELECT ISNULL(MAX(VersionCode), 0) AS maxCode FROM dbo.AppRelease WHERE AppKey = @k",
      );
      const maxCode = latest.recordset[0].maxCode;
      if (versionCode <= maxCode) {
        await cleanup();
        return res.status(400).json({
          error: `Version code ${versionCode} is not newer than the published ${maxCode}. Android only installs a higher version code over an existing app, so build a new one.`,
        });
      }

      const { sha256, md5 } = await hashFile(tmp);
      const sizeBytes = (await fs.promises.stat(tmp)).size;

      // Write next to the destination then rename, so a download in flight
      // never sees a half-written file.
      await fs.promises.mkdir(APK_DIR, { recursive: true });
      const dest = path.join(APK_DIR, app.fileName);
      const partial = `${dest}.uploading`;
      await fs.promises.copyFile(tmp, partial);
      await fs.promises.rename(partial, dest);
      await cleanup();

      const actor = req.user?.email || req.user?.name || "system";
      const tx = new sql.Transaction(pool);
      await tx.begin();
      try {
        await new sql.Request(tx).input("k", sql.NVarChar(40), appKey).query(
          "UPDATE dbo.AppRelease SET IsCurrent = 0 WHERE AppKey = @k",
        );
        const ins = await new sql.Request(tx)
          .input("k", sql.NVarChar(40), appKey)
          .input("pkg", sql.NVarChar(150), manifest.package)
          .input("vc", sql.Int, versionCode)
          .input("vn", sql.NVarChar(50), manifest.versionName ? String(manifest.versionName).slice(0, 50) : null)
          .input("fn", sql.NVarChar(150), app.fileName)
          .input("sz", sql.BigInt, sizeBytes)
          .input("sha", sql.Char(64), sha256)
          .input("md5", sql.Char(32), md5)
          .input("notes", sql.NVarChar(2000), req.body?.releaseNotes ? String(req.body.releaseNotes).slice(0, 2000) : null)
          .input("mand", sql.Bit, String(req.body?.mandatory) === "true" || req.body?.mandatory === "1" ? 1 : 0)
          .input("by", sql.NVarChar(150), actor).query(`
            INSERT INTO dbo.AppRelease
              (AppKey, PackageName, VersionCode, VersionName, FileName, SizeBytes, Sha256, Md5, ReleaseNotes, IsMandatory, IsCurrent, PublishedBy)
            OUTPUT INSERTED.*
            VALUES (@k, @pkg, @vc, @vn, @fn, @sz, @sha, @md5, @notes, @mand, 1, @by)
          `);
        await tx.commit();
        res.status(201).json(toRelease(ins.recordset[0]));
      } catch (dbErr) {
        try { await tx.rollback(); } catch (_) { /* already rolled back */ }
        throw dbErr;
      }
    } catch (err) {
      await cleanup();
      console.error("[app-releases] POST error:", err.message);
      res.status(500).json({ error: err.message });
    }
  },
);

// PATCH /:id — edit release notes / the mandatory flag of a published build.
router.patch("/:id", authenticateToken, requirePageRight("apk-manager", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const r = await pool.request()
      .input("id", sql.Int, id)
      .input("notes", sql.NVarChar(2000), req.body?.releaseNotes != null ? String(req.body.releaseNotes).slice(0, 2000) : null)
      .input("mand", sql.Bit, req.body?.mandatory ? 1 : 0).query(`
        UPDATE dbo.AppRelease SET ReleaseNotes = @notes, IsMandatory = @mand
        OUTPUT INSERTED.* WHERE AppReleaseId = @id
      `);
    if (!r.recordset.length) return res.status(404).json({ error: "Release not found" });
    res.json(toRelease(r.recordset[0]));
  } catch (err) {
    console.error("[app-releases] PATCH error:", err.message);
    res.status(500).json({ error: "Failed to update release" });
  }
});

module.exports = router;
