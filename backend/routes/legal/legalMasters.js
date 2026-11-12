"use strict";

// Legal module Setup masters — one router for every master in ./masterConfig.js.
//   GET    /meta              form + column definitions for every master
//   GET    /summary           counts and health checks for the Legal dashboard
//   GET    /lookup/:ref       picker options (a Legal master, or project / role / user)
//   GET    /:master           every row, with the label of each linked record
//   POST   /:master           add      (page right: create)
//   PUT    /:master/:id       update   (page right: edit)
//   DELETE /:master/:id       delete   (page right: delete; refused while another record uses it, or for noDelete records)
//   GET /:master?parent=ID     one land property's rows (masters with a `parent` column)
// Every add / update / delete is written to LegalRecordAudit.
//   POST   /files             upload one document for a master's file field (any Legal create / edit right)
//   GET    /files/:id         the document itself, for preview / download (any Legal view right)
// Table and column names only ever come from the config, never from the request.

const express = require("express");
const { usersHaveWhatsApp } = require("../../services/usersWhatsApp");
const { getPool, sql } = require("../../db");
const { cache } = require("../../middleware/cache");
const { requirePageRight, requireAnyPageRight, hasAnyPageAction } = require("../../middleware/requirePageRight");
const apiRateLimit = require("../../middleware/apiRateLimit");
const multer = require("multer");
const { verifyFileMatchesDeclaredType } = require("../../services/fileSignature");
const { MASTERS, EXTERNAL_REFS } = require("./masterConfig");
const { writeAudit, nextCodeSql, codePrefix } = require("./legalAudit");
const { canAct, ownWork, isAdmin } = require("./approvalAuthority");

const router = express.Router();
router.use(apiRateLimit);

// Cached per path; any successful write anywhere drops it (writeInvalidator).
const listCache = cache("legal-masters", 120, { shared: true, dropOnAnyWrite: true });

const STALE_LINK_DAYS = 90;

// Per master: the columns its picker returns besides value / label — what any other master filters by
// or fills from. Worked out once from the config, so the lookup never sends more than the forms use.
const LOOKUP_COLUMNS = Object.fromEntries(Object.keys(MASTERS).map((k) => [k, new Set()]));
for (const m of Object.values(MASTERS)) {
  for (const f of m.fields) {
    if (f.type !== "ref" || !MASTERS[f.ref]) continue;
    if (f.filterBy) LOOKUP_COLUMNS[f.ref].add(f.filterBy);
    for (const src of Object.values(f.fill || {})) LOOKUP_COLUMNS[f.ref].add(src);
  }
}
// Registry search (Deed Registration) picks a district first, then shows its offices with their type and jurisdiction.
["DistrictId", "OfficeType", "Jurisdiction"].forEach((c) => LOOKUP_COLUMNS["registration-office"]?.add(c));
const PAGE_KEYS = [...new Set(Object.values(MASTERS).map((m) => m.pageKey))];
// Masters with a page of their own (a lookupOnly master only feeds pickers).
const PAGED = Object.entries(MASTERS).filter(([, m]) => !m.lookupOnly);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) =>
    ["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(file.mimetype)
      ? cb(null, true)
      : cb(new Error("Upload a PDF, JPG, PNG or WEBP file")),
});

// ── Scoped masters (several masters sharing one table) ───────────────────────────────────────────
// The scope value comes from the config, never from the request.
// `where` (also from the config) narrows a master further; {t} stands for the row's table / alias.
const scopeSql = (cfg, alias) =>
  (cfg.scope ? ` AND ${alias ? `${alias}.` : ""}${cfg.scope.column} = N'${cfg.scope.value}'` : "")
  + (cfg.where ? ` AND (${cfg.where.replace(/\{t\}/g, alias ? `${alias}.` : `${cfg.table}.`)})` : "");

// ── Aadhaar ───────────────────────────────────────────────────────────────────────────────────────
// Verhoeff check digit — the last digit of every genuine Aadhaar number.
const VD = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]];
const VP = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]];
const verhoeffOk = (num) => [...num].reverse().reduce((c, d, i) => VD[c][VP[i % 8][Number(d)]], 0) === 0;
const maskAadhaar = (v) => (v ? `XXXX XXXX ${String(v).slice(-4)}` : v);
const KEEP = Symbol("keep stored value");

const masterOf = (req, res) => {
  const own = Object.prototype.hasOwnProperty.call(MASTERS, req.params.master) ? MASTERS[req.params.master] : null;
  const cfg = own && !own.lookupOnly ? own : null;
  if (!cfg) res.status(404).json({ error: "Unknown master" });
  return cfg;
};

const withRight = (action) => (req, res, next) => {
  const cfg = masterOf(req, res);
  if (!cfg) return;
  // The approval setup (Approval Control, Approval Workflow, Reminder & SLA) is changed only by an
  // administrator, whatever rights a user has been given on the page.
  if (cfg.adminOnly && action !== "view" && !isAdmin(req)) {
    return res.status(403).json({ error: `Only an administrator can change ${cfg.title}` });
  }
  return requirePageRight(cfg.pageKey, action)(req, res, next);
};

// Viewing any one Legal master is enough to read the dashboard summary and the pickers.
const anyLegalView = requireAnyPageRight(PAGE_KEYS, "view");

// SQL expression for the label of the row a ref column points at.
function refLabelSql(field, alias) {
  if (field.type === "file") return `(SELECT FileName FROM dbo.LegalMasterFile WHERE FileId = ${alias}.${field.name})`;
  if (EXTERNAL_REFS[field.ref]) {
    const t = { project: ["dbo.enterprise", "id", "name"], role: ["dbo.Role", "RId", "RName"], user: ["dbo.users", "id", "name"], company: ["dbo.enterprise", "id", "name"], "fin-year": ["dbo.FinYear", "FId", "FName"] }[field.ref];
    return `(SELECT ${t[2]} FROM ${t[0]} WHERE ${t[1]} = ${alias}.${field.name})`;
  }
  const target = MASTERS[field.ref];
  return `(SELECT ${target.label} FROM dbo.${target.table} r WHERE r.${target.pk} = ${alias}.${field.name})`;
}

// ── Validation ────────────────────────────────────────────────────────────────────────────────────
function readValue(field, raw) {
  const empty = raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "");
  if (field.type === "bit") return { value: empty ? (field.default ?? false) : raw === true || raw === 1 || raw === "1" || raw === "true" };
  // A field left out takes its configured default (the form sends it anyway; API callers may not).
  if (empty) return { value: field.default !== undefined && field.default !== "today" && raw === undefined ? field.default : null };
  switch (field.type) {
    case "int":
    case "file":
    case "ref": {
      const n = Number(raw);
      if (!Number.isInteger(n)) return { error: `${field.label} must be a whole number` };
      if (field.type !== "int" && n <= 0) return { error: `Choose a valid ${field.label}` };
      if (field.min !== undefined && n < field.min) return { error: `${field.label} must be at least ${field.min}` };
      if (field.max !== undefined && field.type === "int" && n > field.max) return { error: `${field.label} must be at most ${field.max}` };
      return { value: n };
    }
    case "decimal": {
      const n = Number(raw);
      if (!Number.isFinite(n) || (n < 0 && !field.signed)) return { error: `${field.label} must be a positive number` };
      if (field.min !== undefined && n < field.min) return { error: field.min > 0 && field.min < 1 ? `${field.label} must be greater than 0` : `${field.label} must be at least ${field.min}` };
      if (field.maxValue !== undefined && n > field.maxValue) return { error: `${field.label} must be at most ${field.maxValue}` };
      return { value: n };
    }
    case "date": {
      const s = String(raw).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) return { error: `${field.label} is not a valid date` };
      return { value: s };
    }
    case "select": {
      const s = String(raw).trim();
      if (!field.options.includes(s)) return { error: `${field.label} must be one of: ${field.options.join(", ")}` };
      return { value: s };
    }
    default: {
      if (field.mask === "aadhaar") {
        const digits = String(raw).replace(/[\s-]/g, "");
        if (/^X{8}\d{4}$/i.test(digits)) return { value: KEEP };
        if (!/^[2-9]\d{11}$/.test(digits) || !verhoeffOk(digits)) return { error: `${field.label} is not a valid 12-digit Aadhaar number` };
        return { value: digits };
      }
      let s = String(raw).trim();
      if (field.type !== "textarea") s = s.replace(/\s+/g, " ");
      if (field.upper) s = s.toUpperCase();
      if (field.max && s.length > field.max) return { error: `${field.label} can be at most ${field.max} characters` };
      if (field.type === "url" && !/^https?:\/\/[^\s/$.?#][^\s]*$/i.test(s)) return { error: `${field.label} must be a full http(s) link` };
      if (field.pattern && !new RegExp(field.pattern).test(s)) return { error: field.patternMsg || `${field.label} is not valid` };
      return { value: s };
    }
  }
}

async function validate(pool, cfg, body) {
  const values = {};
  for (const field of cfg.fields) {
    if (field.auto) continue; // generated on add, never edited
    // Status kept by the workflow (section Verified tick, L1 / L2 approval): never taken from the form. Its default on
    // add; on edit it is not written at all.
    if (field.system) { values[field.name] = field.default === "today" ? new Date().toISOString().slice(0, 10) : field.default === "fy" ? finYearOf() : field.default ?? null; continue; }
    const { value, error } = readValue(field, body?.[field.name]);
    if (error) return { error };
    if (field.required && value === null) return { error: `${field.label} is required` };
    values[field.name] = value;
  }
  for (const field of cfg.fields) {
    if (field.requiredWhen && values[field.requiredWhen.field] !== null && field.requiredWhen.values.includes(values[field.requiredWhen.field]) && values[field.name] === null) {
      return { error: `${field.label} is required when ${cfg.fields.find((f) => f.name === field.requiredWhen.field).label} is ${values[field.requiredWhen.field]}` };
    }
    if (field.requiredWith && values[field.requiredWith] !== null && values[field.name] === null) {
      return { error: `${field.label} is required when ${cfg.fields.find((f) => f.name === field.requiredWith).label} is entered` };
    }
    if (field.after && values[field.name] && values[field.after] && values[field.name] < values[field.after]) {
      return { error: `${field.label} cannot be before ${cfg.fields.find((f) => f.name === field.after).label}` };
    }
    if (field.type === "file" && values[field.name] !== null) {
      const f = await pool.request().input("v", sql.Int, values[field.name]).query("SELECT 1 FROM dbo.LegalMasterFile WHERE FileId = @v");
      if (!f.recordset.length) return { error: `${field.label}: the uploaded file was not found — upload it again` };
    }
    if (field.type !== "ref" || values[field.name] === null) continue;
    // The linked record must exist (and, for a filtered pick, belong to the chosen parent).
    let q;
    const r = pool.request().input("v", sql.Int, values[field.name]);
    if (EXTERNAL_REFS[field.ref]) {
      q = EXTERNAL_REFS[field.ref].exists;
    } else {
      const target = MASTERS[field.ref];
      q = `SELECT 1 FROM dbo.${target.table} WHERE ${target.pk} = @v${scopeSql(target)}`;
      if (field.filterBy && values[field.filterBy] !== null) {
        q += field.blankOk ? ` AND (${field.filterBy} = @p OR ${field.filterBy} IS NULL)` : ` AND ${field.filterBy} = @p`;
        r.input("p", sql.Int, values[field.filterBy]);
      }
    }
    const found = await r.query(q);
    if (!found.recordset.length) {
      if (field.filterBy) return { error: `The ${field.label} chosen does not belong to the selected ${cfg.fields.find((f) => f.name === field.filterBy).label}` };
      const target = MASTERS[field.ref];
      if (target?.where) return { error: `${field.label}: only ${target.title.toLowerCase()} can be chosen here` };
      return { error: target?.scope ? `Choose ${field.label} from the ${target.title} master` : `The ${field.label} chosen no longer exists` };
    }
  }
  return { values };
}

function bindValues(request, cfg, values) {
  for (const field of cfg.fields) {
    const v = values[field.name];
    switch (field.type) {
      case "int": case "ref": case "file": request.input(field.name, sql.Int, v); break;
      case "decimal": request.input(field.name, sql.Decimal(18, 6), v); break;
      case "date": request.input(field.name, sql.Date, v); break;
      case "bit": request.input(field.name, sql.Bit, v ? 1 : 0); break;
      default: request.input(field.name, sql.NVarChar(field.max || 4000), v);
    }
  }
}

/** The fields an insert / update writes: all of them, except generated codes and a masked value sent back unchanged. */
// Indian financial year of a date (April–March), e.g. "2026-27".
const finYearOf = (d = new Date()) => { const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; return `${y}-${String(y + 1).slice(2)}`; };
const writtenFields = (cfg, values, isUpdate = false) => cfg.fields.filter((f) => !f.auto && !(isUpdate && f.system) && values[f.name] !== KEEP);

/** SET / VALUES expressions for `derived` text columns, read from the picked row (Mouza's District name). */
const derivedSql = (cfg) => (cfg.derived || []).map((d) => {
  const target = MASTERS[cfg.fields.find((f) => f.name === d.from).ref];
  return { name: d.name, expr: `(SELECT ${d.column} FROM dbo.${target.table} WHERE ${target.pk} = @${d.from})` };
});

// ── Review (verification) fields ──────────────────────────────────────────────────────────────────
// `review: { field, by, at, free }` on a master: setting `field` to anything outside `free` (default
// ["Pending"]) — Verified, Rejected, Approved… — needs a Verifier (Setup → Approval Control) and stamps who and when.
// Maker-checker: the user who entered the row cannot verify it; another user must.
// A reviewed row whose other data is then edited by someone without that right goes back to free[0], so a
// change is never left carrying an old approval.
const isReviewer = (req, cfg) => canAct(req, "Verifier", cfg.pageKey);

async function reviewCols(req, cfg, values, before) {
  const rv = cfg.review;
  if (!rv || cfg.fields.find((f) => f.name === rv.field)?.system) return { cols: [] };
  const free = rv.free || ["Pending"];
  const next = values[rv.field];
  const prev = before ? before[rv.field] : free[0];
  if (next === prev) return { cols: [] };
  if (!free.includes(next)) {
    const label = cfg.fields.find((f) => f.name === rv.field).label;
    if (!(await isReviewer(req, cfg))) return { error: `Only a verifier (Setup → Approval Control) can set ${label} to ${next}` };
    const own = before ? ownWork(req, before.CreatedBy) : ownWork(req, req.user?.userId ?? req.user?.id, "this record");
    if (own) return { error: before ? own : `Save this record as ${free[0]} — another user must set ${label} to ${next}` };
  }
  const stamp = free.includes(next) ? "NULL" : null;
  return {
    cols: [
      ...(rv.by ? [{ name: rv.by, expr: stamp ?? "@UserId" }] : []),
      ...(rv.at ? [{ name: rv.at, expr: stamp ?? "SYSUTCDATETIME()" }] : []),
    ],
  };
}

/** The land property a row belongs to, for the audit trail. */
const landOf = (cfg, id, row) => (cfg.table === "LegalLand" ? id : row?.LandId ?? null);

const auditCopy = (cfg, row) => (row ? maskRows(cfg, [{ ...row }])[0] : null);

/** Lists and exports never carry a full Aadhaar number. */
function maskRows(cfg, rows) {
  const masked = cfg.fields.filter((f) => f.mask === "aadhaar");
  if (masked.length) for (const r of rows) for (const f of masked) r[f.name] = maskAadhaar(r[f.name]);
  return rows;
}

function sendDbError(res, cfg, err, where) {
  const n = err?.number ?? err?.originalError?.info?.number;
  if (n === 2627 || n === 2601) return res.status(409).json({ error: cfg.unique?.[1] || "This record already exists" });
  if (n === 547) return res.status(409).json({ error: `This ${cfg.title} is used by other records, so it cannot be deleted. Mark it inactive instead.` });
  console.error(`[legal-masters] ${where} ${cfg.table}:`, err.message);
  return res.status(500).json({ error: "Could not save. Please try again." });
}

// ── Routes ────────────────────────────────────────────────────────────────────────────────────────
router.get("/meta", (req, res) => {
  res.json(PAGED.map(([key, m]) => ({
    key, title: m.title, group: m.group, pageKey: m.pageKey, desc: m.desc, pk: m.pk, parent: m.parent, noDelete: !!m.noDelete, adminOnly: !!m.adminOnly,
    extras: (m.extras || []).map(({ name, label, whatsapp, after }) => ({ name, label, whatsapp: !!whatsapp, after })),
    fields: m.fields.map(({ name, label, type, required, options, ref, filterBy, blankOk, fill, default: def, upper, max, mask, auto, suggest, party, hidden, system, multi }) =>
      ({ name, label, type, required: !!required, options, ref, filterBy, blankOk: !!blankOk, fill, default: def, upper: !!upper, max, mask, auto: !!auto, suggest, party, hidden: !!hidden, system: !!system, multi: !!multi,
        creatable: type === "ref" && creatableRef(ref) })),
  })));
});

router.get("/summary", anyLegalView, listCache, async (req, res) => {
  try {
    const pool = getPool();
    const counts = PAGED
      .map(([key, m]) => `SELECT '${key}' AS k, COUNT(*) AS total, SUM(CASE WHEN IsActive = 1 THEN 1 ELSE 0 END) AS active FROM dbo.${m.table} WHERE 1 = 1${scopeSql(m)}`)
      .join(" UNION ALL ");
    const [c, links, templates, land] = await Promise.all([
      pool.request().query(counts),
      pool.request().input("days", sql.Int, STALE_LINK_DAYS).query(`
        SELECT l.LinkId, l.LinkLabel, l.ServiceType, l.Url, l.LastTestedDate, o.OfficeName
        FROM dbo.LegalPortalLink l LEFT JOIN dbo.LegalRegistrationOffice o ON o.OfficeId = l.OfficeId
        WHERE l.IsActive = 1 AND (l.LastTestedDate IS NULL OR l.LastTestedDate < DATEADD(day, -@days, CAST(SYSDATETIME() AS DATE)))
        ORDER BY l.LastTestedDate`),
      pool.request().query(`
        SELECT t.TemplateId, t.TemplateName, t.VersionNo,
               (SELECT COUNT(*) FROM dbo.LegalChecklistItem i WHERE i.TemplateId = t.TemplateId AND i.IsActive = 1) AS Items,
               (SELECT COUNT(*) FROM dbo.LegalChecklistItem i WHERE i.TemplateId = t.TemplateId AND i.IsActive = 1 AND i.Requirement = 'Required') AS RequiredItems
        FROM dbo.LegalChecklistTemplate t WHERE t.IsActive = 1 ORDER BY t.TemplateName, t.VersionNo DESC`),
      pool.request().query(`
        SELECT m.MouzaId, m.MouzaName, m.JLNo, m.District,
               (SELECT COUNT(*) FROM dbo.LegalRsPlot p WHERE p.MouzaId = m.MouzaId AND p.IsActive = 1) AS RsPlots,
               (SELECT COUNT(*) FROM dbo.LegalRsKhatian k WHERE k.MouzaId = m.MouzaId AND k.IsActive = 1) AS RsKhatians,
               (SELECT COUNT(*) FROM dbo.LegalLrRor r WHERE r.MouzaId = m.MouzaId AND r.IsActive = 1) AS LrRors,
               (SELECT COUNT(*) FROM dbo.LegalRsPlot p WHERE p.MouzaId = m.MouzaId AND p.IsActive = 1
                  AND NOT EXISTS (SELECT 1 FROM dbo.LegalLrRor r WHERE r.RsPlotId = p.RsPlotId AND r.IsActive = 1)) AS PlotsWithoutRor
        FROM dbo.LegalMouza m WHERE m.IsActive = 1 ORDER BY RsPlots DESC, m.MouzaName`),
    ]);
    const masters = Object.fromEntries(c.recordset.map((r) => [r.k, { total: r.total, active: r.active || 0 }]));
    res.json({ masters, staleLinks: links.recordset, staleLinkDays: STALE_LINK_DAYS, templates: templates.recordset, mouzas: land.recordset });
  } catch (err) {
    console.error("[legal-masters] summary:", err.message);
    res.status(500).json({ error: "Could not load the Legal summary" });
  }
});

// The official sites (Setup → Government Site Links) as quick links for anyone in the Legal module — opened in a new
// tab to check land details by hand. Nothing is sent to or read from those sites.
router.get("/portal-links", anyLegalView, listCache, async (_req, res) => {
  try {
    const r = await getPool().request().query(`
      SELECT l.LinkId, l.LinkLabel, l.ServiceType, l.Url, l.FallbackInstructions, l.LastTestedDate, o.OfficeName
      FROM dbo.LegalPortalLink l LEFT JOIN dbo.LegalRegistrationOffice o ON o.OfficeId = l.OfficeId
      WHERE l.IsActive = 1 ORDER BY l.ServiceType, l.LinkLabel`);
    res.json(r.recordset);
  } catch (err) {
    console.error("[legal-masters] portal links:", err.message);
    res.status(500).json({ error: "Could not load the portal links" });
  }
});

router.get("/lookup/:ref", anyLegalView, listCache, async (req, res) => {
  const { ref } = req.params;
  try {
    const pool = getPool();
    if (Object.prototype.hasOwnProperty.call(EXTERNAL_REFS, ref)) {
      return res.json((await pool.request().query(EXTERNAL_REFS[ref].sql)).recordset);
    }
    if (!Object.prototype.hasOwnProperty.call(MASTERS, ref)) return res.status(404).json({ error: "Unknown lookup" });
    const m = MASTERS[ref];
    // The columns other masters filter on or fill from come along (RS Khatian's Mouza, an RS plot's area).
    const parents = [...LOOKUP_COLUMNS[ref]].map((c) => `, ${c}`).join("");
    const rows = (await pool.request().query(
      `SELECT r.${m.pk} AS value, ${m.label} AS label, r.IsActive AS active${parents.replace(/, /g, ", r.")} FROM dbo.${m.table} r WHERE 1 = 1${scopeSql(m, "r")} ORDER BY ${m.orderBy.split(",").map((c) => `r.${c.trim()}`).join(", ")}`,
    )).recordset;
    res.json(rows);
  } catch (err) {
    console.error("[legal-masters] lookup:", err.message);
    res.status(500).json({ error: "Could not load options" });
  }
});

// ── Documents ─────────────────────────────────────────────────────────────────────────────────────
// Uploaded first, then saved on the record by id. A replaced document stays stored, so earlier evidence
// is never silently overwritten.
router.post("/files", async (req, res, next) => {
  // Either right will do: a document for a new record (create) or one added while editing (edit).
  try {
    for (const pk of PAGE_KEYS) if (await hasAnyPageAction(req, pk, ["create", "edit"])) return next();
    return res.status(403).json({ error: "You cannot upload Legal documents" });
  } catch (e) {
    console.error("[legal-masters] upload right:", e.message);
    return res.status(500).json({ error: "Permission check error" });
  }
}, (req, res) => {
  upload.single("file")(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.code === "LIMIT_FILE_SIZE" ? "The file is larger than 15 MB" : err.message });
    if (!req.file) return res.status(400).json({ error: "Choose a file to upload" });
    const sigErr = verifyFileMatchesDeclaredType(req.file);
    if (sigErr) return res.status(400).json({ error: sigErr });
    try {
      const name = req.file.originalname.replace(/[^\w.\- ()]/g, "_").slice(-200);
      const result = await getPool().request()
        .input("FileName", sql.NVarChar(200), name)
        .input("MimeType", sql.NVarChar(100), req.file.mimetype)
        .input("FileSize", sql.Int, req.file.size)
        .input("FileBase64", sql.NVarChar(sql.MAX), req.file.buffer.toString("base64"))
        .input("UserId", sql.Int, req.user?.userId || null)
        .query(`INSERT INTO dbo.LegalMasterFile (FileName, MimeType, FileSize, FileBase64, UploadedBy)
                OUTPUT INSERTED.FileId AS id VALUES (@FileName, @MimeType, @FileSize, @FileBase64, @UserId)`);
      res.status(201).json({ id: result.recordset[0].id, fileName: name });
    } catch (e) {
      console.error("[legal-masters] upload:", e.message);
      res.status(500).json({ error: "Could not store the file. Please try again." });
    }
  });
});

router.get("/files/:id", anyLegalView, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
  try {
    const r = await getPool().request().input("Id", sql.Int, id)
      .query("SELECT FileName, MimeType, FileBase64 FROM dbo.LegalMasterFile WHERE FileId = @Id");
    if (!r.recordset.length) return res.status(404).json({ error: "File not found" });
    const f = r.recordset[0];
    res.setHeader("Content-Type", f.MimeType);
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(f.FileName)}"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(Buffer.from(f.FileBase64, "base64"));
  } catch (e) {
    console.error("[legal-masters] file:", e.message);
    res.status(500).json({ error: "Could not load the file" });
  }
});

router.get("/:master", withRight("view"), listCache, async (req, res) => {
  const cfg = MASTERS[req.params.master];
  const parentId = req.query.parent === undefined ? null : Number(req.query.parent);
  if (parentId !== null && (!cfg.parent || !Number.isInteger(parentId) || parentId <= 0)) return res.status(400).json({ error: "Invalid parent" });
  try {
    const labels = cfg.fields.filter((f) => f.type === "ref" || f.type === "file").map((f) => `, ${refLabelSql(f, "t")} AS ${f.name}__label`).join("");
    const withWa = (cfg.extras || []).some((x) => x.whatsapp) && (await usersHaveWhatsApp(getPool()));
    const result = await getPool().request().input("Parent", sql.Int, parentId).query(`
      SELECT t.*${labels}${(cfg.extras || []).map((x) => `, ${x.sql} AS ${x.name}${x.whatsapp && withWa ? `, ${x.whatsapp} AS ${x.name}__wa` : ""}${x.userId ? `, ${x.userId} AS ${x.name}__uid` : ""}`).join("")},
             (SELECT name FROM dbo.users WHERE id = t.CreatedBy) AS CreatedByName,
             (SELECT name FROM dbo.users WHERE id = t.UpdatedBy) AS UpdatedByName
      FROM dbo.${cfg.table} t WHERE 1 = 1${scopeSql(cfg, "t")}${parentId !== null ? ` AND t.${cfg.parent} = @Parent` : ""} ORDER BY ${cfg.orderBy.split(",").map((s) => `t.${s.trim()}`).join(", ")}`);
    res.json(maskRows(cfg, result.recordset));
  } catch (err) {
    sendDbError(res, cfg, err, "list");
  }
});

// A party name typed or picked in a form (seller of a purchase, buyer of a sale, an owner in the chain): the name
// is matched to that party list (same role, same name) and added there when it is new, so every party typed once
// is offered next time. `party` is the role; `partyId` (optional) is the column that keeps the matched person's id.
// Several names can be given comma-separated (co-owner sellers); each is matched or added.
// A dropdown whose list takes a plain name (Transfer Type, Payment Mode… and the party lists): a new name typed in
// the form arrives as "new:<name>" and is matched (same list, same name) or added to that list, then saved by its id.
const creatableRef = (ref) => {
  const m = MASTERS[ref];
  return !!m && !!m.scope && (m.table === "LegalLookupValue" || m.table === "LegalPerson");
};
async function resolveNewRefs(pool, cfg, body, userId, added = []) {
  for (const f of cfg.fields) {
    const v = body[f.name];
    if (f.type !== "ref" || typeof v !== "string" || !v.startsWith("new:") || !creatableRef(f.ref)) continue;
    const m = MASTERS[f.ref], name = v.slice(4).trim().replace(/\s+/g, " ").slice(0, m.table === "LegalPerson" ? 200 : 150);
    if (!name) { body[f.name] = null; continue; }
    const isPerson = m.table === "LegalPerson", col = isPerson ? "FullName" : "Name";
    const found = (await pool.request().input("Scope", m.scope.value).input("Name", name)
      .query(`SELECT TOP 1 ${m.pk} AS id FROM dbo.${m.table} WHERE ${m.scope.column} = @Scope AND LTRIM(RTRIM(${col})) = @Name`)).recordset[0];
    if (found) { body[f.name] = found.id; continue; }
    body[f.name] = (await pool.request().input("Scope", m.scope.value).input("Name", name).input("UserId", userId || null)
      .query(`INSERT INTO dbo.${m.table} (${m.scope.column}, ${col}${isPerson ? ", PartyType" : ""}, IsActive, CreatedBy, CreatedAt)
              OUTPUT INSERTED.${m.pk} AS id VALUES (@Scope, @Name${isPerson ? ", N'Individual'" : ""}, 1, @UserId, SYSUTCDATETIME())`)).recordset[0].id;
    added.push({ table: m.table, pk: m.pk, id: body[f.name] });
  }
}

/** Takes back list entries added for a save that was then refused. */
async function dropAdded(pool, added) {
  for (const a of added.reverse()) await pool.request().input("Id", a.id).query(`DELETE FROM dbo.${a.table} WHERE ${a.pk} = @Id`).catch(() => {});
}

async function resolveParties(pool, cfg, body, userId, added = []) {
  for (const f of cfg.fields) {
    if (!f.party || body[f.name] === undefined) continue;
    const names = String(body[f.name] ?? "").split(",").map((x) => x.trim().replace(/\s+/g, " ")).filter(Boolean);
    const ids = [];
    for (const name of names) {
      const found = (await pool.request().input("Role", f.party).input("Name", name.slice(0, 200))
        .query("SELECT TOP 1 PersonId FROM dbo.LegalPerson WHERE PersonRole = @Role AND IsActive = 1 AND LTRIM(RTRIM(FullName)) = @Name")).recordset[0];
      if (found) { ids.push(found.PersonId); continue; }
      const row = (await pool.request().input("Role", f.party).input("Name", name.slice(0, 200)).input("UserId", userId || null)
        .query(`INSERT INTO dbo.LegalPerson (PersonRole, FullName, PartyType, IsActive, CreatedBy, CreatedAt)
                OUTPUT INSERTED.PersonId VALUES (@Role, @Name, N'Individual', 1, @UserId, SYSUTCDATETIME())`)).recordset[0];
      ids.push(row.PersonId);
      added.push({ table: "LegalPerson", pk: "PersonId", id: row.PersonId });
    }
    body[f.name] = names.join(", ");
    if (f.partyId) body[f.partyId] = ids.length === 1 ? ids[0] : null;
  }
}

// Approval Control by role: one entry per role with all its users (stored one row per user — the checks read that).
const STAGES = () => MASTERS["approval-authority"].fields.find((f) => f.name === "Stage").options;
router.get("/approval-authority/by-role", requirePageRight("legal-approval-authority-master", "view"), async (_req, res) => {
  try {
    const rows = (await getPool().request().query(`
      SELECT a.AuthorityId, a.Stage, a.ApproverId, u.name AS UserName, a.Remarks, a.IsActive, a.UpdatedAt, a.CreatedAt
      FROM dbo.LegalApprovalAuthority a LEFT JOIN dbo.users u ON u.id = a.ApproverId ORDER BY a.Stage, u.name`)).recordset;
    res.json(STAGES().map((stage) => {
      const r = rows.filter((x) => x.Stage === stage);
      return { stage, users: r.map((x) => ({ id: x.ApproverId, name: x.UserName, active: !!x.IsActive })), remarks: r.find((x) => x.Remarks)?.Remarks ?? null };
    }));
  } catch (err) {
    console.error("[legal-masters] approval by role:", err.message);
    res.status(500).json({ error: "Could not load Approval Control" });
  }
});

// PUT /approval-authority/by-role { stage, userIds, remarks } — the role's users become exactly these (admin only).
router.put("/approval-authority/by-role", requirePageRight("legal-approval-authority-master", "edit"), async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: "Only an administrator can change Approval Control" });
  const stage = req.body?.stage;
  if (!STAGES().includes(stage)) return res.status(400).json({ error: "Choose the approval role" });
  const ids = [...new Set((Array.isArray(req.body?.userIds) ? req.body.userIds : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  const remarks = String(req.body?.remarks ?? "").trim().slice(0, 500) || null;
  const pool = getPool();
  const tx = new sql.Transaction(pool);
  try {
    await tx.begin();
    const before = (await tx.request().input("S", sql.NVarChar(20), stage).query("SELECT AuthorityId, ApproverId FROM dbo.LegalApprovalAuthority WITH (UPDLOCK) WHERE Stage = @S")).recordset;
    const removed = before.filter((b) => !ids.includes(b.ApproverId));
    for (const r of removed) await tx.request().input("A", sql.Int, r.AuthorityId).query("DELETE FROM dbo.LegalApprovalAuthority WHERE AuthorityId = @A");
    const added = [];
    for (const uid of ids) {
      const r = await tx.request().input("S", sql.NVarChar(20), stage).input("U", sql.Int, uid).input("R", sql.NVarChar(500), remarks).input("By", sql.Int, req.user?.userId || null).query(`
        IF EXISTS (SELECT 1 FROM dbo.LegalApprovalAuthority WHERE Stage = @S AND ApproverId = @U)
          UPDATE dbo.LegalApprovalAuthority SET Remarks = @R, IsActive = 1, UpdatedBy = @By, UpdatedAt = SYSUTCDATETIME() WHERE Stage = @S AND ApproverId = @U;
        ELSE IF EXISTS (SELECT 1 FROM dbo.users WHERE id = @U)
          INSERT INTO dbo.LegalApprovalAuthority (Stage, ApproverId, Remarks, IsActive, CreatedBy) OUTPUT INSERTED.ApproverId VALUES (@S, @U, @R, 1, @By);`);
      if (r.recordset?.length) added.push(uid);
    }
    await tx.commit();
    await writeAudit(pool, req, { action: "Updated", entityType: "Approval Control", entityId: null,
      oldValue: { stage, users: before.map((b) => b.ApproverId) }, newValue: { stage, users: ids }, remarks });
    res.json({ message: `${stage}: ${ids.length} user(s)${added.length ? `, ${added.length} added` : ""}${removed.length ? `, ${removed.length} removed` : ""}` });
  } catch (err) {
    try { await tx.rollback(); } catch { /* rolled back */ }
    console.error("[legal-masters] approval by role save:", err.message);
    res.status(500).json({ error: "Could not save" });
  }
});

// Approval Control: several users picked at once → one row per user (users who already hold the role are skipped).
router.post("/:master", withRight("create"), async (req, res, next) => {
  const cfg = MASTERS[req.params.master];
  if (req.params.master !== "approval-authority" || !Array.isArray(req.body?.ApproverId)) return next();
  const ids = [...new Set(req.body.ApproverId.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  const stage = req.body.Stage;
  const stageField = cfg.fields.find((f) => f.name === "Stage");
  if (!stageField.options.includes(stage)) return res.status(400).json({ error: "Choose the approval role" });
  if (!ids.length) return res.status(400).json({ error: "Choose at least one user" });
  const remarks = String(req.body.Remarks ?? "").trim().slice(0, 500) || null;
  const active = req.body.IsActive === false || req.body.IsActive === 0 || req.body.IsActive === "0" ? 0 : 1;
  try {
    const pool = getPool();
    const added = [], skipped = [];
    for (const uid of ids) {
      const u = (await pool.request().input("U", sql.Int, uid).query("SELECT name FROM dbo.users WHERE id = @U")).recordset[0];
      if (!u) return res.status(400).json({ error: `User ${uid} not found` });
      const r = await pool.request().input("S", sql.NVarChar(20), stage).input("U", sql.Int, uid).input("R", sql.NVarChar(500), remarks)
        .input("A", sql.Bit, active).input("By", sql.Int, req.user?.userId || null).query(`
          INSERT INTO dbo.LegalApprovalAuthority (Stage, ApproverId, Remarks, IsActive, CreatedBy)
          OUTPUT INSERTED.AuthorityId
          SELECT @S, @U, @R, @A, @By WHERE NOT EXISTS (SELECT 1 FROM dbo.LegalApprovalAuthority WHERE Stage = @S AND ApproverId = @U)`);
      if (r.recordset.length) {
        added.push(u.name);
        await writeAudit(pool, req, { action: "Created", entityType: cfg.title, entityId: r.recordset[0].AuthorityId, newValue: { Stage: stage, ApproverId: uid, user: u.name } });
      } else skipped.push(u.name);
    }
    if (!added.length) return res.status(409).json({ error: `Already ${stage}: ${skipped.join(", ")}` });
    res.status(201).json({ message: `${stage}: ${added.join(", ")} added${skipped.length ? ` (already: ${skipped.join(", ")})` : ""}` });
  } catch (err) {
    console.error("[legal-masters] approval-authority multi:", err.message);
    res.status(500).json({ error: "Could not save" });
  }
});

router.post("/:master", withRight("create"), async (req, res) => {
  const cfg = MASTERS[req.params.master];
  try {
    const pool = getPool();
    await resolveParties(pool, cfg, req.body, req.user?.userId, res.locals.added = []);
    await resolveNewRefs(pool, cfg, req.body, req.user?.userId, res.locals.added);
    // A refused save (validation, a business rule, a duplicate…) takes back the list entries it just added.
    res.once("finish", () => { if (res.statusCode >= 400 && res.locals.added.length) dropAdded(pool, res.locals.added); });
    if (cfg.needsWhatsApp && (await usersHaveWhatsApp(pool))) {
      const me = (await pool.request().input("U", sql.Int, req.user?.userId).query("SELECT WhatsAppNo FROM dbo.users WHERE id = @U")).recordset[0];
      if (!me?.WhatsAppNo) return res.status(400).json({ error: "Add your WhatsApp number first (box at the top of this page) — others reach you on it about this entry" });
    }
    // `self` fields are always the user who adds the row.
    for (const f of cfg.fields) if (f.self) req.body[f.name] = req.user?.userId ?? req.user?.id ?? null;
    const { values, error } = await validate(pool, cfg, req.body);
    if (error) return res.status(400).json({ error });
    // A master's own business rule (the same area cannot be sold twice…); `id` is null on add.
    if (cfg.check) {
      const refused = await cfg.check(pool, values, req.params.id ? Number(req.params.id) : null);
      if (refused) return res.status(409).json({ error: refused });
    }
    if (Object.values(values).includes(KEEP)) return res.status(400).json({ error: "Enter the full Aadhaar number" });
    const review = await reviewCols(req, cfg, values, null);
    if (review.error) return res.status(403).json({ error: review.error });
    const request = pool.request();
    bindValues(request, cfg, values);
    request.input("UserId", sql.Int, req.user?.userId || null);
    const cols = writtenFields(cfg, values).map((f) => ({ name: f.name, expr: `@${f.name}` }));
    for (const f of cfg.fields.filter((x) => x.auto)) {
      request.input(`Prefix_${f.name}`, sql.NVarChar(20), codePrefix(f.auto));
      cols.push({ name: f.name, expr: nextCodeSql(cfg.table, f.name, `@Prefix_${f.name}`) });
    }
    cols.push(...derivedSql(cfg), ...review.cols);
    if (cfg.scope) {
      request.input("ScopeValue", sql.NVarChar(40), cfg.scope.value);
      cols.push({ name: cfg.scope.column, expr: "@ScopeValue" });
    }
    const result = await request.query(`
      INSERT INTO dbo.${cfg.table} (${cols.map((c) => c.name).join(", ")}, CreatedBy, CreatedAt)
      OUTPUT INSERTED.*
      SELECT ${cols.map((c) => c.expr).join(", ")}, @UserId, SYSUTCDATETIME()`);
    const row = result.recordset[0];
    const id = row[cfg.pk];
    if (cfg.afterWrite) await cfg.afterWrite(pool, req, row, null);
    await writeAudit(pool, req, { action: "Created", entityType: cfg.title, entityId: id, landId: landOf(cfg, id, row), newValue: auditCopy(cfg, row) });
    const code = cfg.fields.find((f) => f.auto);
    res.status(201).json({ id, message: code ? `${cfg.title} ${row[code.name]} added` : `${cfg.title} added` });
  } catch (err) {
    sendDbError(res, cfg, err, "add");
  }
});

// Approval Control edited with several users picked: the row keeps the first user, the others get rows of their own
// for the same role (users who already hold it are skipped); then the normal update runs for the row.
router.put("/:master/:id", withRight("edit"), async (req, res, next) => {
  if (req.params.master !== "approval-authority" || !Array.isArray(req.body?.ApproverId)) return next();
  const ids = [...new Set(req.body.ApproverId.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length) return res.status(400).json({ error: "Choose at least one user" });
  const stage = req.body.Stage;
  if (!MASTERS["approval-authority"].fields.find((f) => f.name === "Stage").options.includes(stage)) return res.status(400).json({ error: "Choose the approval role" });
  try {
    const pool = getPool();
    const remarks = String(req.body.Remarks ?? "").trim().slice(0, 500) || null;
    for (const uid of ids.slice(1)) {
      const r = await pool.request().input("S", sql.NVarChar(20), stage).input("U", sql.Int, uid).input("R", sql.NVarChar(500), remarks).input("By", sql.Int, req.user?.userId || null).query(`
        INSERT INTO dbo.LegalApprovalAuthority (Stage, ApproverId, Remarks, IsActive, CreatedBy)
        OUTPUT INSERTED.AuthorityId
        SELECT @S, @U, @R, 1, @By WHERE EXISTS (SELECT 1 FROM dbo.users WHERE id = @U)
          AND NOT EXISTS (SELECT 1 FROM dbo.LegalApprovalAuthority WHERE Stage = @S AND ApproverId = @U)`);
      if (r.recordset.length) await writeAudit(pool, req, { action: "Created", entityType: "Approval Control", entityId: r.recordset[0].AuthorityId, newValue: { Stage: stage, ApproverId: uid } });
    }
    req.body.ApproverId = ids[0];
    next();
  } catch (err) {
    console.error("[legal-masters] approval-authority multi edit:", err.message);
    res.status(500).json({ error: "Could not save" });
  }
});

router.put("/:master/:id", withRight("edit"), async (req, res) => {
  const cfg = MASTERS[req.params.master];
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    await resolveParties(pool, cfg, req.body, req.user?.userId, res.locals.added = []);
    await resolveNewRefs(pool, cfg, req.body, req.user?.userId, res.locals.added);
    // A refused save (validation, a business rule, a duplicate…) takes back the list entries it just added.
    res.once("finish", () => { if (res.statusCode >= 400 && res.locals.added.length) dropAdded(pool, res.locals.added); });
    // `self: "always"` fields (Verified by, Approved by) are whoever saves — never picked.
    for (const f of cfg.fields) if (f.self === "always") req.body[f.name] = req.user?.userId ?? req.user?.id ?? null;
    const { values, error } = await validate(pool, cfg, req.body);
    if (error) return res.status(400).json({ error });
    // A master's own business rule (the same area cannot be sold twice…); `id` is null on add.
    if (cfg.check) {
      const refused = await cfg.check(pool, values, req.params.id ? Number(req.params.id) : null);
      if (refused) return res.status(409).json({ error: refused });
    }
    if (cfg.guard) {
      const refused = await cfg.guard(pool, id, values);
      if (refused) return res.status(409).json({ error: refused });
    }
    const before = (await pool.request().input("Id", sql.Int, id)
      .query(`SELECT * FROM dbo.${cfg.table} WHERE ${cfg.pk} = @Id${scopeSql(cfg)}`)).recordset[0];
    if (!before) return res.status(404).json({ error: `${cfg.title} not found` });
    const review = await reviewCols(req, cfg, values, before);
    if (review.error) return res.status(403).json({ error: review.error });
    const written = writtenFields(cfg, values, true);
    const request = pool.request();
    bindValues(request, { fields: written }, values);
    request.input("Id", sql.Int, id).input("UserId", sql.Int, req.user?.userId || null);
    const result = await request.query(`
      UPDATE dbo.${cfg.table}
      SET ${[...written.map((f) => `${f.name} = @${f.name}`), ...[...derivedSql(cfg), ...review.cols].map((d) => `${d.name} = ${d.expr}`)].join(", ")}, UpdatedBy = @UserId, UpdatedAt = SYSUTCDATETIME()
      OUTPUT INSERTED.*
      WHERE ${cfg.pk} = @Id${scopeSql(cfg)}`);
    if (!result.recordset.length) return res.status(404).json({ error: `${cfg.title} not found` });
    let after = result.recordset[0];
    // Only the columns that changed go into the trail.
    const changed = Object.keys(after).filter((k) => !["UpdatedAt", "UpdatedBy"].includes(k) && String(before[k] ?? "") !== String(after[k] ?? ""));
    const rv = cfg.review;
    const free = rv?.free || ["Pending"];
    if (rv && !free.includes(after[rv.field]) && after[rv.field] === before[rv.field]
        && changed.some((k) => ![rv.field, rv.by, rv.at].includes(k)) && !(await isReviewer(req, cfg))) {
      after = (await pool.request().input("Id", sql.Int, id).input("Free", sql.NVarChar(40), free[0]).query(`
        UPDATE dbo.${cfg.table} SET ${[`${rv.field} = @Free`, ...(rv.by ? [`${rv.by} = NULL`] : []), ...(rv.at ? [`${rv.at} = NULL`] : [])].join(", ")}
        OUTPUT INSERTED.* WHERE ${cfg.pk} = @Id`)).recordset[0];
      changed.push(rv.field);
    }
    if (changed.length) {
      const pick = (r) => Object.fromEntries(changed.map((k) => [k, r[k]]));
      await writeAudit(pool, req, { action: "Updated", entityType: cfg.title, entityId: id, landId: landOf(cfg, id, after), oldValue: auditCopy(cfg, pick(before)), newValue: auditCopy(cfg, pick(after)) });
    }
    if (cfg.afterWrite) await cfg.afterWrite(pool, req, after, before);
    res.json({ message: rv && changed.includes(rv.field) && free.includes(after[rv.field]) && !free.includes(before[rv.field])
      ? `${cfg.title} updated — sent back for verification` : `${cfg.title} updated` });
  } catch (err) {
    sendDbError(res, cfg, err, "update");
  }
});

router.delete("/:master/:id", withRight("delete"), async (req, res) => {
  const cfg = MASTERS[req.params.master];
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
  if (cfg.noDelete) return res.status(409).json({ error: `A ${cfg.title} is never deleted, so its history stays. Mark it inactive instead.` });
  try {
    const pool = getPool();
    const result = await pool.request().input("Id", sql.Int, id)
      .query(`DELETE FROM dbo.${cfg.table} OUTPUT DELETED.* WHERE ${cfg.pk} = @Id${scopeSql(cfg)}`);
    if (!result.recordset.length) return res.status(404).json({ error: `${cfg.title} not found` });
    const row = result.recordset[0];
    if (cfg.afterDelete) await cfg.afterDelete(pool, req, row);
    await writeAudit(pool, req, { action: "Deleted", entityType: cfg.title, entityId: id, landId: landOf(cfg, id, row), oldValue: auditCopy(cfg, row) });
    res.json({ message: `${cfg.title} deleted` });
  } catch (err) {
    sendDbError(res, cfg, err, "delete");
  }
});

module.exports = router;
