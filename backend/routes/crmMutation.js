const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId } = require("../services/saAccess");
const { getNextDocNumber } = require("../services/docNumber");
const { requireActiveBooking } = require("../services/crmWorkflowGuards");
const { logCrmAudit } = require("../services/crmAudit");
const multer = require("multer");

router.use(authMiddleware);
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 10 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/pdf', 'image/jpeg', 'image/png', 'image/webp',
      'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
    ];
    if (allowedTypes.includes(file.mimetype)) cb(null, true);
    else cb(new Error(`File type ${file.mimetype} not supported`), false);
  },
});

// Mutation tracks the municipal-record update (Khata Transfer) that follows
// Sale Deed registration. Gate: CrmRegistry.Status = 'Completed' — the deed
// must be officially registered before municipal records can be updated.
// The real process is not a bare Applied -> Approved: the municipal
// authority routinely raises a query/objection requiring resubmission
// (mirrors Sale Deed's Senior-Reject -> reprepare -> resubmit loop), and a
// mutation fee + old/new Khata numbers are real outcomes worth recording.
const MUT_SELECT = `
  SELECT m.*, b.BookingNo, COALESCE(bn.UnitNo, b.UnitNo) AS UnitNo, a.ApplicantName, a.Mobile,
         sd.DeedNo, sd.RegistrationNo, reg.Id AS RegistryId, reg.RegNo, reg.SubRegistrarOffice
  FROM dbo.CrmMutation m
  JOIN dbo.CrmBooking b ON b.Id = m.BookingId
  JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
  LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
  LEFT JOIN dbo.CrmSalesDeed sd ON sd.BookingId = b.Id
  LEFT JOIN dbo.CrmRegistry reg ON reg.BookingId = b.Id AND reg.Status = 'Completed'
`;

// The realistic mandatory-document set a municipal Khata Transfer
// application actually needs — the "Registered Deed Copy" is always
// synced automatically from Registry below rather than re-requested.
const MANDATORY_DOC_TEMPLATE = [
  { type: "RegisteredDeedCopy", label: "Registered Sale Deed Copy" },
  { type: "MutationApplicationForm", label: "Mutation Application Form" },
  { type: "PropertyTaxReceipt", label: "Latest Property Tax Receipt" },
];

async function logMutationHistory(mutationId, action, remarks, actorIdVal, actorType = 'Staff') {
  const pool = getPool();
  await pool.request()
    .input('mid', sql.Int, mutationId)
    .input('act', sql.NVarChar(40), action)
    .input('rem', sql.NVarChar(sql.MAX), remarks || null)
    .input('atype', sql.NVarChar(20), actorType)
    .input('aid', sql.Int, actorIdVal)
    .query(`INSERT INTO dbo.CrmMutationLog (MutationId, Action, Remarks, ActorType, ActorId, CreatedAt)
            VALUES (@mid, @act, @rem, @atype, @aid, SYSDATETIME())`);
}

router.get("/", requirePageRight("crm-mutation", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const { status } = req.query;
    const req0 = pool.request();
    const where = [];
    if (status) { req0.input("st", sql.NVarChar(20), status); where.push("m.Status = @st"); }
    const result = await req0.query(`${MUT_SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY m.CreatedAt DESC`);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-mutation] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.get("/booking/:bookingId", requirePageRight("crm-mutation", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const bookingId = parseInt(req.params.bookingId, 10);
    const result = await pool.request().input("bid", sql.Int, bookingId)
      .query(`${MUT_SELECT} WHERE m.BookingId = @bid`);
    res.json(result.recordset[0] || null);
  } catch (e) {
    console.error("[crm-mutation] GET /booking/:id error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /eligible-bookings — bookings whose Sale Deed Registry is Completed
// and don't have a Mutation tracker yet.
router.get("/eligible-bookings", requirePageRight("crm-mutation", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT b.Id, b.BookingNo, COALESCE(bn.UnitNo, b.UnitNo) AS UnitNo, a.ApplicantName,
             reg.RegNo, sd.DeedNo
      FROM dbo.CrmBooking b
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
      JOIN dbo.CrmRegistry reg ON reg.BookingId = b.Id AND reg.Status = 'Completed'
      LEFT JOIN dbo.CrmSalesDeed sd ON sd.BookingId = b.Id
      WHERE b.Status <> 'Cancelled'
        AND NOT EXISTS (SELECT 1 FROM dbo.CrmMutation WHERE BookingId = b.Id)
      ORDER BY b.CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-mutation] eligible-bookings error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /:id — full detail: the tracker row, its documents and its history.
router.get("/:id", requirePageRight("crm-mutation", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    const [mutRes, docRes, logRes] = await Promise.all([
      pool.request().input('id', sql.Int, id).query(`${MUT_SELECT} WHERE m.Id = @id`),
      pool.request().input('id', sql.Int, id).query(`
        SELECT Id, DocumentType, Label, IsMandatory, Status, FileName, MimeType, FileSize,
               UploadedAt, UploadedByType, Remarks, CreatedAt,
               CASE WHEN FileBase64 IS NOT NULL THEN 1 ELSE 0 END AS HasFile
        FROM dbo.CrmMutationDocument WHERE MutationId = @id ORDER BY CreatedAt
      `),
      pool.request().input('id', sql.Int, id).query(`
        SELECT l.*, u.name AS ActorName
        FROM dbo.CrmMutationLog l
        LEFT JOIN dbo.Users u ON u.id = l.ActorId
        WHERE l.MutationId = @id ORDER BY l.CreatedAt DESC
      `),
    ]);
    if (!mutRes.recordset[0]) return res.status(404).json({ error: "Mutation not found" });
    res.json({ mutation: mutRes.recordset[0], documents: docRes.recordset, history: logRes.recordset });
  } catch (e) {
    console.error("[crm-mutation] GET /:id error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST / — start mutation tracking. Gate: Sale Deed Registry must be Completed.
router.post("/", requirePageRight("crm-mutation", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    if (!b.BookingId) return res.status(400).json({ error: "BookingId is required" });
    const bookingId = parseInt(b.BookingId, 10);

    const activeErr = await requireActiveBooking(pool, bookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });

    const reg = await pool.request().input("bid", sql.Int, bookingId)
      .query("SELECT Id, Status, RegistrationNo, SubRegistrarOffice FROM dbo.CrmRegistry WHERE BookingId = @bid");
    if (!reg.recordset.length || reg.recordset[0].Status !== "Completed") {
      return res.status(400).json({ error: "Mutation requires the Sale Deed Registry to be Completed — the deed must be officially registered at the Sub-Registrar Office before mutation can be applied" });
    }
    const registryId = reg.recordset[0].Id;

    // The registered deed's own scanned copy already lives on the Registry
    // tracker (its ExecutedDeed document, itself synced from the Sale
    // Deed) — pull it across the same way Registry pulls from Sale Deed,
    // instead of asking staff to attach the same file a third time.
    const src = await pool.request().input("rid", sql.Int, registryId).query(`
      SELECT TOP 1 FileName, MimeType, FileSize, FileBase64
      FROM dbo.CrmRegistryDocument
      WHERE RegistryId = @rid AND DocumentType = 'ExecutedDeed' AND Status = 'Verified' AND FileBase64 IS NOT NULL
      ORDER BY UpdatedAt DESC
    `);
    const syncedDeedCopy = src.recordset[0] || null;

    const mutNo = await getNextDocNumber(pool, "MUT", "MUT");
    const result = await pool.request()
      .input("no",   sql.NVarChar(30),  mutNo)
      .input("bid",  sql.Int,           bookingId)
      .input("ano",  sql.NVarChar(100), b.ApplicationNo   || null)
      .input("ad",   sql.Date,          b.ApplicationDate || null)
      .input("auth", sql.NVarChar(200), b.Authority       || null)
      .input("okhata", sql.NVarChar(100), b.OldKhataNo || null)
      .input("fee",  sql.Decimal(18,2), b.MutationFee != null && b.MutationFee !== "" ? parseFloat(b.MutationFee) : null)
      .input("rem",  sql.NVarChar(sql.MAX), b.Remarks     || null)
      .input("cb",   sql.Int,           actorId(req))
      .query(`
        INSERT INTO dbo.CrmMutation (MutationNo, BookingId, Status, ApplicationNo, ApplicationDate, Authority, OldKhataNo, MutationFee, Remarks, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@no, @bid, 'Applied', @ano, @ad, @auth, @okhata, @fee, @rem, @cb, SYSDATETIME())
      `);
    const mutationId = result.recordset[0].Id;

    for (const doc of MANDATORY_DOC_TEMPLATE) {
      const synced = doc.type === 'RegisteredDeedCopy' ? syncedDeedCopy : null;
      await pool.request()
        .input('mid', sql.Int, mutationId)
        .input('dt', sql.NVarChar(50), doc.type)
        .input('lbl', sql.NVarChar(255), doc.label)
        .input('cb', sql.Int, actorId(req))
        .input('st', sql.NVarChar(30), synced ? 'Verified' : 'Requested')
        .input('fn', sql.NVarChar(255), synced?.FileName || null)
        .input('mt', sql.NVarChar(100), synced?.MimeType || null)
        .input('fs', sql.Int, synced?.FileSize || null)
        .input('b64', sql.NVarChar(sql.MAX), synced?.FileBase64 || null)
        .input('rem', sql.NVarChar(sql.MAX), synced ? "Synced automatically from the Registry's verified deed copy." : null)
        .query(`
          INSERT INTO dbo.CrmMutationDocument
            (MutationId, DocumentType, Label, IsMandatory, Status, FileName, MimeType, FileSize, FileBase64,
             UploadedByType, UploadedAt, RequestedBy, RequestedAt, Remarks, CreatedBy, CreatedAt)
          VALUES (@mid, @dt, @lbl, 1, @st, @fn, @mt, @fs, @b64,
             CASE WHEN @b64 IS NOT NULL THEN 'System' ELSE NULL END, CASE WHEN @b64 IS NOT NULL THEN SYSDATETIME() ELSE NULL END,
             @cb, SYSDATETIME(), @rem, @cb, SYSDATETIME())
        `);
    }

    await logMutationHistory(mutationId, 'Applied', syncedDeedCopy ? 'Registered deed copy synced automatically from Registry.' : null, actorId(req));

    res.status(201).json({ success: true, id: mutationId, MutationNo: mutNo });
  } catch (e) {
    if (e.message?.includes("UNIQUE") || e.message?.includes("unique"))
      return res.status(409).json({ error: "Mutation tracking already started for this booking" });
    console.error("[crm-mutation] POST error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id — update editable metadata fields only. Status is never accepted here;
// use PUT /:id/approve, /:id/query, or /:id/resubmit for status transitions.
router.put("/:id", requirePageRight("crm-mutation", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    const b = req.body;

    const cur = await pool.request().input("id", sql.Int, id).query("SELECT BookingId, Status FROM dbo.CrmMutation WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "Mutation record not found" });

    if (b.Status) return res.status(400).json({ error: "Use /approve, /query or /resubmit to change status" });

    const activeErr = await requireActiveBooking(pool, cur.recordset[0].BookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });

    await pool.request()
      .input("id",   sql.Int, id)
      .input("ano",  sql.NVarChar(100), b.ApplicationNo   || null)
      .input("ad",   sql.Date,          b.ApplicationDate || null)
      .input("apno", sql.NVarChar(100), b.ApprovedNo      || null)
      .input("apd",  sql.Date,          b.ApprovedDate    || null)
      .input("auth", sql.NVarChar(200), b.Authority       || null)
      .input("okhata", sql.NVarChar(100), b.OldKhataNo || null)
      .input("nkhata", sql.NVarChar(100), b.NewKhataNo || null)
      .input("fee",  sql.Decimal(18,2), b.MutationFee != null && b.MutationFee !== "" ? parseFloat(b.MutationFee) : null)
      .input("rem",  sql.NVarChar(sql.MAX), b.Remarks     || null)
      .input("ub",   sql.Int,           actorId(req))
      .query(`
        UPDATE dbo.CrmMutation SET
          ApplicationNo   = ISNULL(@ano,  ApplicationNo),
          ApplicationDate = ISNULL(@ad,   ApplicationDate),
          ApprovedNo      = ISNULL(@apno, ApprovedNo),
          ApprovedDate    = ISNULL(@apd,  ApprovedDate),
          Authority       = ISNULL(@auth, Authority),
          OldKhataNo      = ISNULL(@okhata, OldKhataNo),
          NewKhataNo      = ISNULL(@nkhata, NewKhataNo),
          MutationFee     = ISNULL(@fee, MutationFee),
          Remarks         = ISNULL(@rem,  Remarks),
          UpdatedBy       = @ub,
          UpdatedAt       = SYSDATETIME()
        WHERE Id = @id
      `);
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-mutation] PUT error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id/query — the municipal authority raised a query/objection on the
// application. Mirrors Sale Deed's Senior-Reject: resets the mandatory
// documents back to Requested so the actual correction is forced, not just
// a status label change, and requires remarks describing what's wrong.
router.put("/:id/query", requirePageRight("crm-mutation", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    const remarks = req.body?.Remarks;
    if (!remarks?.trim()) return res.status(400).json({ error: "Remarks describing the query are required" });

    const cur = await pool.request().input("id", sql.Int, id).query("SELECT BookingId, Status FROM dbo.CrmMutation WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "Mutation record not found" });
    if (cur.recordset[0].Status !== "Applied") return res.status(400).json({ error: `Cannot raise a query from status ${cur.recordset[0].Status}` });
    const activeErr = await requireActiveBooking(pool, cur.recordset[0].BookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });

    await pool.request().input("id", sql.Int, id).input("rem", sql.NVarChar(sql.MAX), remarks.trim()).input("ub", sql.Int, actorId(req)).query(`
      UPDATE dbo.CrmMutation SET Status = 'QueryRaised', QueryRemarks = @rem, QueryRaisedAt = SYSDATETIME(),
        UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
      WHERE Id = @id
    `);

    // Only reset staff-uploaded documents (not the ones synced automatically
    // from Registry) — a query is about what the applicant/staff submitted,
    // not about the registration itself.
    await pool.request().input("id", sql.Int, id).input("ub", sql.Int, actorId(req)).query(`
      UPDATE dbo.CrmMutationDocument SET
        Status = 'Requested', FileBase64 = NULL, FileName = NULL, MimeType = NULL, FileSize = NULL,
        UploadedByType = NULL, UploadedAt = NULL, UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
      WHERE MutationId = @id AND IsMandatory = 1
        AND Remarks NOT LIKE 'Synced automatically%'
    `);

    await logMutationHistory(id, 'QueryRaised', remarks.trim(), actorId(req));
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-mutation] PUT /:id/query error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id/resubmit — after a query has been addressed, send it back to
// Applied for the authority to reconsider.
router.put("/:id/resubmit", requirePageRight("crm-mutation", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);

    const cur = await pool.request().input("id", sql.Int, id).query("SELECT BookingId, Status FROM dbo.CrmMutation WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "Mutation record not found" });
    if (cur.recordset[0].Status !== "QueryRaised") return res.status(400).json({ error: `Cannot resubmit from status ${cur.recordset[0].Status}` });
    const activeErr = await requireActiveBooking(pool, cur.recordset[0].BookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });

    const docs = await pool.request().input("id", sql.Int, id).query(`
      SELECT COUNT(*) AS Required, SUM(CASE WHEN Status = 'Verified' THEN 1 ELSE 0 END) AS Verified
      FROM dbo.CrmMutationDocument WHERE MutationId = @id AND IsMandatory = 1
    `);
    const { Required, Verified } = docs.recordset[0];
    if (Number(Required) > 0 && Number(Verified) < Number(Required)) {
      return res.status(400).json({ error: `${Verified || 0}/${Required} mandatory documents verified — fix and verify the documents the query flagged before resubmitting` });
    }

    await pool.request().input("id", sql.Int, id).input("ub", sql.Int, actorId(req)).query(`
      UPDATE dbo.CrmMutation SET Status = 'Applied', UpdatedBy = @ub, UpdatedAt = SYSDATETIME() WHERE Id = @id
    `);
    await logMutationHistory(id, 'Resubmitted', null, actorId(req));
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-mutation] PUT /:id/resubmit error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id/approve — advance from Applied → Approved. One-way; cannot be reversed.
router.put("/:id/approve", requirePageRight("crm-mutation", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    const b = req.body;
    if (!b.NewKhataNo?.trim()) return res.status(400).json({ error: "New Khata No. is required" });

    const cur = await pool.request().input("id", sql.Int, id)
      .query("SELECT BookingId, Status, MutationNo FROM dbo.CrmMutation WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "Mutation record not found" });
    if (cur.recordset[0].Status === "Approved") return res.status(400).json({ error: "Already approved" });
    if (cur.recordset[0].Status !== "Applied") return res.status(400).json({ error: `Cannot approve from status ${cur.recordset[0].Status} — resolve the open query first` });

    const activeErr = await requireActiveBooking(pool, cur.recordset[0].BookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });

    const docs = await pool.request().input("id", sql.Int, id).query(`
      SELECT COUNT(*) AS Required, SUM(CASE WHEN Status = 'Verified' THEN 1 ELSE 0 END) AS Verified
      FROM dbo.CrmMutationDocument WHERE MutationId = @id AND IsMandatory = 1
    `);
    const { Required, Verified } = docs.recordset[0];
    if (Number(Required) > 0 && Number(Verified) < Number(Required)) {
      return res.status(400).json({ error: `${Verified || 0}/${Required} mandatory documents verified — all must be verified before approval` });
    }

    await pool.request()
      .input("id",   sql.Int, id)
      .input("apno", sql.NVarChar(100), b.ApprovedNo   || null)
      .input("apd",  sql.Date,          b.ApprovedDate || null)
      .input("nkhata", sql.NVarChar(100), b.NewKhataNo.trim())
      .input("rem",  sql.NVarChar(sql.MAX), b.Remarks  || null)
      .input("ub",   sql.Int,           actorId(req))
      .query(`
        UPDATE dbo.CrmMutation SET
          Status       = 'Approved',
          ApprovedNo   = ISNULL(@apno, ApprovedNo),
          ApprovedDate = ISNULL(@apd,  CONVERT(DATE, SYSDATETIME())),
          NewKhataNo   = @nkhata,
          Remarks      = ISNULL(@rem,  Remarks),
          UpdatedBy    = @ub,
          UpdatedAt    = SYSDATETIME()
        WHERE Id = @id
      `);

    await logCrmAudit(pool, "Mutation", id, actorId(req), [
      { field: "Status", oldVal: cur.recordset[0].Status, newVal: "Approved" },
    ]);
    await logMutationHistory(id, 'Approved', `New Khata No. ${b.NewKhataNo.trim()}`, actorId(req));

    res.json({ success: true });
  } catch (e) {
    console.error("[crm-mutation] PUT /:id/approve error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /:id/documents/upload
router.post("/:id/documents/upload", requirePageRight("crm-mutation", "edit"), upload.array('files'), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    const { DocumentType = 'Other', Label, IsMandatory = 0, Remarks } = req.body;

    const mut = await pool.request().input("id", sql.Int, id).query("SELECT Status FROM dbo.CrmMutation WHERE Id = @id");
    if (!mut.recordset.length) return res.status(404).json({ error: "Mutation not found" });
    if (mut.recordset[0].Status === "Approved") return res.status(400).json({ error: "Cannot modify documents for an approved mutation" });

    for (const file of req.files || []) {
      const b64 = file.buffer.toString('base64');
      const reqCheck = await pool.request()
        .input("mid", sql.Int, id)
        .input("dt", sql.NVarChar(50), DocumentType)
        .query("SELECT TOP 1 Id FROM dbo.CrmMutationDocument WHERE MutationId = @mid AND DocumentType = @dt AND Status = 'Requested' AND IsMandatory = 1 ORDER BY CreatedAt ASC");

      if (reqCheck.recordset.length > 0) {
        await pool.request()
          .input("docid", sql.Int, reqCheck.recordset[0].Id)
          .input("b64", sql.NVarChar(sql.MAX), b64)
          .input("fn", sql.NVarChar(255), file.originalname)
          .input("mt", sql.NVarChar(100), file.mimetype)
          .input("fs", sql.Int, file.size)
          .input("rem", sql.NVarChar(sql.MAX), Remarks || null)
          .input("ub", sql.Int, actorId(req))
          .query(`
            UPDATE dbo.CrmMutationDocument SET
              FileBase64 = @b64, FileName = @fn, MimeType = @mt, FileSize = @fs,
              Status = 'Uploaded', UploadedByType = 'Staff', UploadedAt = SYSDATETIME(),
              Remarks = ISNULL(@rem, Remarks), UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
            WHERE Id = @docid
          `);
      } else {
        await pool.request()
          .input("mid", sql.Int, id)
          .input("dt", sql.NVarChar(50), DocumentType)
          .input("lbl", sql.NVarChar(255), Label || file.originalname)
          .input("ism", sql.Bit, parseInt(IsMandatory, 10) || 0)
          .input("fn", sql.NVarChar(255), file.originalname)
          .input("mt", sql.NVarChar(100), file.mimetype)
          .input("fs", sql.Int, file.size)
          .input("b64", sql.NVarChar(sql.MAX), b64)
          .input("rem", sql.NVarChar(sql.MAX), Remarks || null)
          .input("cb", sql.Int, actorId(req))
          .query(`
            INSERT INTO dbo.CrmMutationDocument
              (MutationId, DocumentType, Label, IsMandatory, Status, FileName, MimeType, FileSize, FileBase64,
               UploadedByType, UploadedAt, Remarks, CreatedBy, CreatedAt)
            VALUES (@mid, @dt, @lbl, @ism, 'Uploaded', @fn, @mt, @fs, @b64,
               'Staff', SYSDATETIME(), @rem, @cb, SYSDATETIME())
          `);
      }
    }
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-mutation] documents/upload error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /:id/documents/request
router.post("/:id/documents/request", requirePageRight("crm-mutation", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    const { DocumentType, Label, IsMandatory = true } = req.body;
    if (!DocumentType?.trim()) return res.status(400).json({ error: "DocumentType is required" });

    const mut = await pool.request().input("id", sql.Int, id).query("SELECT Status FROM dbo.CrmMutation WHERE Id = @id");
    if (!mut.recordset.length) return res.status(404).json({ error: "Mutation not found" });
    if (mut.recordset[0].Status === "Approved") return res.status(400).json({ error: "Cannot request documents for an approved mutation" });

    const dup = await pool.request().input("mid", sql.Int, id).input("dt", sql.NVarChar(50), DocumentType.trim())
      .query("SELECT TOP 1 Id FROM dbo.CrmMutationDocument WHERE MutationId = @mid AND DocumentType = @dt AND Status IN ('Requested', 'Uploaded')");
    if (dup.recordset.length) return res.status(409).json({ error: `A ${DocumentType} request is already open` });

    await pool.request()
      .input('mid', sql.Int, id)
      .input('dt', sql.NVarChar(50), DocumentType.trim())
      .input('lbl', sql.NVarChar(255), Label?.trim() || DocumentType.trim())
      .input('ism', sql.Bit, IsMandatory ? 1 : 0)
      .input('cb', sql.Int, actorId(req))
      .query(`
        INSERT INTO dbo.CrmMutationDocument (MutationId, DocumentType, Label, IsMandatory, Status, RequestedBy, RequestedAt, CreatedBy, CreatedAt)
        VALUES (@mid, @dt, @lbl, @ism, 'Requested', @cb, SYSDATETIME(), @cb, SYSDATETIME())
      `);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id/documents/:docId — review a document (Verify/Reject).
router.put("/:id/documents/:docId", requirePageRight("crm-mutation", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const docId = parseInt(req.params.docId, 10);
    const { Status, Remarks } = req.body;

    if (Status !== undefined && !["Verified", "Rejected"].includes(Status)) {
      return res.status(400).json({ error: "Status must be Verified or Rejected" });
    }
    if (Status === "Rejected" && !Remarks?.trim()) {
      return res.status(400).json({ error: "Remarks are required when rejecting a document" });
    }

    await pool.request()
      .input("docid", sql.Int, docId)
      .input("st", sql.NVarChar(30), Status)
      .input("rem", sql.NVarChar(sql.MAX), Remarks)
      .input("ub", sql.Int, actorId(req))
      .query(`
        UPDATE dbo.CrmMutationDocument SET Status = ISNULL(@st, Status), Remarks = ISNULL(@rem, Remarks), UpdatedBy = @ub, UpdatedAt = SYSDATETIME() WHERE Id = @docid
      `);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /documents/file/:docId
router.get("/documents/file/:docId", async (req, res) => {
  try {
    const pool = getPool();
    const doc = await pool.request().input("docid", sql.Int, parseInt(req.params.docId, 10)).query(`
      SELECT FileName, MimeType, FileBase64 FROM dbo.CrmMutationDocument WHERE Id = @docid
    `);
    if (!doc.recordset.length || !doc.recordset[0].FileBase64) return res.status(404).send("File not found");
    const row = doc.recordset[0];
    const buffer = Buffer.from(row.FileBase64, 'base64');
    res.setHeader('Content-Type', row.MimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${row.FileName || 'document'}"`);
    res.send(buffer);
  } catch (e) {
    res.status(500).send(e.message);
  }
});

module.exports = router;
