const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId } = require("../services/saAccess");
const { getNextDocNumber } = require("../services/docNumber");
const { logCommunication } = require("../services/crmCommunicationLog");
const { requireActiveBooking } = require("../services/crmWorkflowGuards");
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

// Registry tracks the ACT of registering the deed at the Sub-Registrar
// Office — appointment, attendance, the registration particulars once it
// actually happens, supporting documents (receipt/challan, stamped copy),
// and a full audit trail. Once Completed, RegistrationNo/BookNo/PartNo are
// also mirrored onto CrmSalesDeed so the Sale Deed page's own registration
// display stays in sync without staff re-entering the same data twice.
const REG_SELECT = `
  SELECT r.*, b.BookingNo, COALESCE(bn.UnitNo, b.UnitNo) AS UnitNo, a.ApplicantName, a.Mobile,
         sd.DeedNo, sd.DeedValue, sd.StampDuty AS DeedStampDuty, sd.RegistrationFee AS DeedRegistrationFee,
         qp.QPNo, qp.ConfirmedAmount AS QPConfirmedAmount, qp.Status AS QPStatus
  FROM dbo.CrmRegistry r
  JOIN dbo.CrmBooking b ON b.Id = r.BookingId
  JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
  LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
  LEFT JOIN dbo.CrmSalesDeed sd ON sd.Id = r.SalesDeedId
  OUTER APPLY (SELECT TOP 1 QPNo, ConfirmedAmount, Status FROM dbo.CrmQueryPayment WHERE BookingId = r.BookingId ORDER BY CreatedAt DESC) qp
`;

// The realistic mandatory-document set for a physical sale-deed
// registration — not just "a receipt". Every one of these is a document an
// office visit actually depends on; a generic single "Registration
// Receipt" placeholder understated what completing a registration really
// requires. Dynamic per booking the same way Sale Deed/Welcome Call's
// checklists are — this is the fixed baseline every registry needs, not a
// hardcoded one-size record.
const MANDATORY_DOC_TEMPLATE = [
  { type: "ExecutedDeed",     label: "Original Executed Sale Deed" },
  { type: "IdentityProofs",   label: "Identity Proofs — Buyer & Seller (PAN/Aadhaar)" },
  { type: "RegistrationReceipt", label: "Registration Receipt / Challan" },
];

async function logRegistryHistory(registryId, action, remarks, actorIdVal, actorType = 'Staff') {
  const pool = getPool();
  await pool.request()
    .input('rid', sql.Int, registryId)
    .input('act', sql.NVarChar(40), action)
    .input('rem', sql.NVarChar(sql.MAX), remarks || null)
    .input('atype', sql.NVarChar(20), actorType)
    .input('aid', sql.Int, actorIdVal)
    .query(`INSERT INTO dbo.CrmRegistryLog (RegistryId, Action, Remarks, ActorType, ActorId, CreatedAt)
            VALUES (@rid, @act, @rem, @atype, @aid, SYSDATETIME())`);
}

router.get("/", requirePageRight("crm-registry", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const { status } = req.query;
    const req0 = pool.request();
    const where = [];
    if (status) { req0.input("st", sql.NVarChar(20), status); where.push("r.Status = @st"); }
    const result = await req0.query(`${REG_SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY r.CreatedAt DESC`);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-registry] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.get("/booking/:bookingId", requirePageRight("crm-registry", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const bookingId = parseInt(req.params.bookingId, 10);
    const result = await pool.request().input("bid", sql.Int, bookingId)
      .query(`${REG_SELECT} WHERE r.BookingId = @bid`);
    res.json(result.recordset[0] || null);
  } catch (e) {
    console.error("[crm-registry] GET /booking/:id error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /eligible-bookings — bookings whose Query Payment is Confirmed and
// don't have a Registry tracker yet.
router.get("/eligible-bookings", requirePageRight("crm-registry", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT b.Id, b.BookingNo, COALESCE(bn.UnitNo, b.UnitNo) AS UnitNo, a.ApplicantName,
             qp.QPNo, sd.DeedNo
      FROM dbo.CrmBooking b
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
      JOIN dbo.CrmQueryPayment qp ON qp.BookingId = b.Id AND qp.Status = 'Confirmed'
      LEFT JOIN dbo.CrmSalesDeed sd ON sd.Id = qp.SalesDeedId
      WHERE b.Status <> 'Cancelled'
        AND NOT EXISTS (SELECT 1 FROM dbo.CrmRegistry WHERE BookingId = b.Id)
      ORDER BY b.CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-registry] eligible-bookings error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /:id — full detail: the tracker row, its documents and its history.
router.get("/:id", requirePageRight("crm-registry", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    const [regRes, docRes, logRes] = await Promise.all([
      pool.request().input('id', sql.Int, id).query(`${REG_SELECT} WHERE r.Id = @id`),
      pool.request().input('id', sql.Int, id).query(`
        SELECT Id, DocumentType, Label, IsMandatory, Status, FileName, MimeType, FileSize,
               UploadedAt, UploadedByType, Remarks, CreatedAt,
               CASE WHEN FileBase64 IS NOT NULL THEN 1 ELSE 0 END AS HasFile
        FROM dbo.CrmRegistryDocument WHERE RegistryId = @id ORDER BY CreatedAt
      `),
      pool.request().input('id', sql.Int, id).query(`
        SELECT l.*, u.name AS ActorName
        FROM dbo.CrmRegistryLog l
        LEFT JOIN dbo.Users u ON u.id = l.ActorId
        WHERE l.RegistryId = @id ORDER BY l.CreatedAt DESC
      `),
    ]);
    if (!regRes.recordset[0]) return res.status(404).json({ error: "Registry not found" });
    res.json({ registry: regRes.recordset[0], documents: docRes.recordset, history: logRes.recordset });
  } catch (e) {
    console.error("[crm-registry] GET /:id error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST / — start Registry tracking for a booking. Gated on Query Payment
// being Confirmed — the customer must have actually paid the government
// before the deed can go to the Sub-Registrar Office for registration.
router.post("/", requirePageRight("crm-registry", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    if (!b.BookingId) return res.status(400).json({ error: "BookingId is required" });
    const bookingId = parseInt(b.BookingId, 10);

    const activeErr = await requireActiveBooking(pool, bookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });

    const qp = await pool.request().input("bid", sql.Int, bookingId)
      .query("SELECT Id, Status FROM dbo.CrmQueryPayment WHERE BookingId = @bid");
    if (!qp.recordset.length || qp.recordset[0].Status !== "Confirmed") {
      return res.status(400).json({ error: "Registry requires Query Payment to be Confirmed first — the customer must have paid the government before the deed can be registered" });
    }

    const deed = await pool.request().input("bid", sql.Int, bookingId)
      .query("SELECT Id FROM dbo.CrmSalesDeed WHERE BookingId = @bid");
    const salesDeedId = deed.recordset[0]?.Id || null;

    // The Sale Deed almost certainly already has its own executed copy on
    // file (verified, during the Sale Deed workflow) — Registry re-asking
    // staff to upload the exact same PDF a second time is duplicate work
    // and a real "why doesn't this system talk to itself" complaint. Pull
    // it across directly when it exists, verified, so Registry starts with
    // real synced data instead of another blank request.
    let syncedExecutedDeed = null;
    if (salesDeedId) {
      const src = await pool.request().input("sdid", sql.Int, salesDeedId).query(`
        SELECT TOP 1 FileName, MimeType, FileSize, FileBase64
        FROM dbo.CrmSalesDeedDocument
        WHERE SalesDeedId = @sdid AND DocumentType = 'ExecutedDeed' AND Status = 'Verified' AND FileBase64 IS NOT NULL
        ORDER BY UpdatedAt DESC
      `);
      syncedExecutedDeed = src.recordset[0] || null;
    }

    const regNo = await getNextDocNumber(pool, "REG", "REG");
    const result = await pool.request()
      .input("no",   sql.NVarChar(30), regNo)
      .input("bid",  sql.Int, bookingId)
      .input("sdid", sql.Int, deed.recordset[0]?.Id || null)
      .input("cb",   sql.Int, actorId(req))
      .query(`
        INSERT INTO dbo.CrmRegistry (RegNo, BookingId, SalesDeedId, Status, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@no, @bid, @sdid, 'Pending', @cb, SYSDATETIME())
      `);
    const registryId = result.recordset[0].Id;

    // Seed the full realistic mandatory-document checklist up front — same
    // pattern as Sale Deed's DeedDraft, but reflecting everything an actual
    // office visit depends on, not one placeholder receipt. ExecutedDeed is
    // inserted pre-filled and pre-verified when it was already synced above.
    for (const doc of MANDATORY_DOC_TEMPLATE) {
      const synced = doc.type === 'ExecutedDeed' ? syncedExecutedDeed : null;
      await pool.request()
        .input('rid', sql.Int, registryId)
        .input('dt', sql.NVarChar(50), doc.type)
        .input('lbl', sql.NVarChar(255), doc.label)
        .input('cb', sql.Int, actorId(req))
        .input('st', sql.NVarChar(30), synced ? 'Verified' : 'Requested')
        .input('fn', sql.NVarChar(255), synced?.FileName || null)
        .input('mt', sql.NVarChar(100), synced?.MimeType || null)
        .input('fs', sql.Int, synced?.FileSize || null)
        .input('b64', sql.NVarChar(sql.MAX), synced?.FileBase64 || null)
        .input('rem', sql.NVarChar(sql.MAX), synced ? 'Synced automatically from the Sale Deed\'s verified executed copy.' : null)
        .query(`
          INSERT INTO dbo.CrmRegistryDocument
            (RegistryId, DocumentType, Label, IsMandatory, Status, FileName, MimeType, FileSize, FileBase64,
             UploadedByType, UploadedAt, RequestedBy, RequestedAt, Remarks, CreatedBy, CreatedAt)
          VALUES (@rid, @dt, @lbl, 1, @st, @fn, @mt, @fs, @b64,
             CASE WHEN @b64 IS NOT NULL THEN 'System' ELSE NULL END, CASE WHEN @b64 IS NOT NULL THEN SYSDATETIME() ELSE NULL END,
             @cb, SYSDATETIME(), @rem, @cb, SYSDATETIME())
        `);
    }

    await logRegistryHistory(registryId, 'Started', syncedExecutedDeed ? 'Executed Deed copy synced automatically from the Sale Deed.' : null, actorId(req));

    res.status(201).json({ success: true, id: registryId, RegNo: regNo });
  } catch (e) {
    if (e.message?.includes("UNIQUE") || e.message?.includes("unique"))
      return res.status(409).json({ error: "Registry tracking already started for this booking" });
    console.error("[crm-registry] POST error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id/schedule — record (or set for the first time) the appointment
// date at the Sub-Registrar Office. Also used to schedule the FIRST date —
// "Reschedule" (below) is the distinct action for pushing an existing one.
router.put("/:id/schedule", requirePageRight("crm-registry", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    const b = req.body;
    if (!b.ScheduledDate) return res.status(400).json({ error: "ScheduledDate is required" });

    const cur = await pool.request().input("id", sql.Int, id).query("SELECT BookingId, Status FROM dbo.CrmRegistry WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "Registry not found" });
    if (["Completed", "Cancelled"].includes(cur.recordset[0].Status)) return res.status(400).json({ error: `Cannot schedule — registry is already ${cur.recordset[0].Status}` });
    const activeErr = await requireActiveBooking(pool, cur.recordset[0].BookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });

    if (!b.AppointmentOffice?.trim()) return res.status(400).json({ error: "The Sub-Registrar Office is required to schedule an appointment" });

    await pool.request()
      .input("id", sql.Int, id)
      .input("dt", sql.Date, b.ScheduledDate)
      .input("tm", sql.NVarChar(20), b.AppointmentTime || null)
      .input("off", sql.NVarChar(255), b.AppointmentOffice.trim())
      .input("rem", sql.NVarChar(sql.MAX), b.Remarks || null)
      .input("ub", sql.Int, actorId(req))
      .query(`
        UPDATE dbo.CrmRegistry SET Status = 'Scheduled', ScheduledDate = @dt, AppointmentTime = @tm,
          AppointmentOffice = @off, Remarks = ISNULL(@rem, Remarks),
          UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);
    await logRegistryHistory(id, 'Scheduled', b.Remarks || `Appointment set for ${b.ScheduledDate}${b.AppointmentTime ? ` at ${b.AppointmentTime}` : ''} — ${b.AppointmentOffice.trim()}`, actorId(req));
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-registry] PUT /:id/schedule error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id/reschedule — the Sub-Registrar visit didn't happen as planned
// (postponed/no-show) — push the date without losing the fact that this
// happened, unlike overwriting ScheduledDate silently. RescheduleCount
// makes a repeatedly-postponed registration visible in the list at a glance.
router.put("/:id/reschedule", requirePageRight("crm-registry", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    const b = req.body;
    if (!b.ScheduledDate) return res.status(400).json({ error: "New ScheduledDate is required" });
    if (!b.Reason?.trim()) return res.status(400).json({ error: "A reason for rescheduling is required" });

    const cur = await pool.request().input("id", sql.Int, id).query("SELECT BookingId, Status, ScheduledDate FROM dbo.CrmRegistry WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "Registry not found" });
    if (cur.recordset[0].Status !== "Scheduled") return res.status(400).json({ error: "Only a Scheduled appointment can be rescheduled" });
    const activeErr = await requireActiveBooking(pool, cur.recordset[0].BookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });

    const oldDate = cur.recordset[0].ScheduledDate ? String(cur.recordset[0].ScheduledDate).slice(0, 10) : "unscheduled";
    await pool.request()
      .input("id", sql.Int, id)
      .input("dt", sql.Date, b.ScheduledDate)
      .input("tm", sql.NVarChar(20), b.AppointmentTime || null)
      .input("off", sql.NVarChar(255), b.AppointmentOffice || null)
      .input("ub", sql.Int, actorId(req))
      .query(`
        UPDATE dbo.CrmRegistry SET ScheduledDate = @dt, AppointmentTime = ISNULL(@tm, AppointmentTime),
          AppointmentOffice = ISNULL(@off, AppointmentOffice), RescheduleCount = RescheduleCount + 1,
          UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);
    await logRegistryHistory(id, 'Rescheduled', `${b.Reason.trim()} (moved from ${oldDate} to ${b.ScheduledDate})`, actorId(req));
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-registry] PUT /:id/reschedule error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id/complete — the deed has actually been registered at the office.
// Captures the real registration particulars here (this is now the single
// place staff enter them) and mirrors RegistrationNo/BookNo/PartNo/
// SubRegistrarOffice/RegistrationDate onto CrmSalesDeed, which is what
// unlocks the Sale Deed page's own "Registered" step — so completing here
// is the one action that finishes both trackers instead of splitting the
// same fact across two separate pages/forms.
router.put("/:id/complete", requirePageRight("crm-registry", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    const b = req.body;
    if (!b.RegistrationNo?.trim()) return res.status(400).json({ error: "Registration No. is required" });
    if (!b.BuyerAttended || !b.SellerAttended) {
      return res.status(400).json({ error: "Both buyer and seller/builder representative attendance must be confirmed before completing" });
    }
    if (!b.WitnessNames?.trim()) return res.status(400).json({ error: "Witness names are required — the Registration Act requires two identifying witnesses" });

    const cur = await pool.request().input("id", sql.Int, id).query("SELECT BookingId, SalesDeedId, Status FROM dbo.CrmRegistry WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "Registry not found" });
    if (cur.recordset[0].Status === "Completed") return res.status(400).json({ error: "Already completed" });
    if (cur.recordset[0].Status !== "Scheduled") {
      return res.status(400).json({ error: "Registry must be Scheduled (appointment date recorded) before it can be marked Completed" });
    }
    const activeErr = await requireActiveBooking(pool, cur.recordset[0].BookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });

    const docs = await pool.request().input("id", sql.Int, id).query(`
      SELECT COUNT(*) AS Required, SUM(CASE WHEN Status = 'Verified' THEN 1 ELSE 0 END) AS Verified
      FROM dbo.CrmRegistryDocument WHERE RegistryId = @id AND IsMandatory = 1
    `);
    const { Required, Verified } = docs.recordset[0];
    if (Number(Required) > 0 && Number(Verified) < Number(Required)) {
      return res.status(400).json({ error: `${Verified || 0}/${Required} mandatory documents verified — the registration receipt must be uploaded and verified before completing` });
    }

    const completedDate = b.CompletedDate || new Date().toISOString().slice(0, 10);
    const regDate = b.RegistrationDate || completedDate;

    await pool.request()
      .input("id", sql.Int, id)
      .input("dt", sql.Date, completedDate)
      .input("regno", sql.NVarChar(100), b.RegistrationNo.trim())
      .input("bookno", sql.NVarChar(100), b.BookNo || null)
      .input("partno", sql.NVarChar(100), b.PartNo || null)
      .input("sro", sql.NVarChar(255), b.SubRegistrarOffice || null)
      .input("regdt", sql.Date, regDate)
      .input("wit", sql.NVarChar(500), b.WitnessNames.trim())
      .input("rem", sql.NVarChar(sql.MAX), b.Remarks || null)
      .input("ub", sql.Int, actorId(req))
      .query(`
        UPDATE dbo.CrmRegistry SET
          Status = 'Completed', CompletedDate = @dt,
          RegistrationNo = @regno, BookNo = @bookno, PartNo = @partno,
          SubRegistrarOffice = @sro, RegistrationDate = @regdt,
          WitnessNames = @wit, BuyerAttended = 1, SellerAttended = 1,
          Remarks = ISNULL(@rem, Remarks), UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);

    // Mirror onto the Sale Deed, if one is linked — reuses the same
    // ISNULL-guarded columns crmSalesDeed.js's own PUT /:id writes, so this
    // never clobbers a value staff already entered there by hand.
    if (cur.recordset[0].SalesDeedId) {
      await pool.request()
        .input("id", sql.Int, cur.recordset[0].SalesDeedId)
        .input("regno", sql.NVarChar(100), b.RegistrationNo.trim())
        .input("bookno", sql.NVarChar(100), b.BookNo || null)
        .input("partno", sql.NVarChar(100), b.PartNo || null)
        .input("sro", sql.NVarChar(255), b.SubRegistrarOffice || null)
        .input("regdt", sql.Date, regDate)
        .query(`
          UPDATE dbo.CrmSalesDeed SET
            RegistrationNo = ISNULL(RegistrationNo, @regno),
            BookNo = ISNULL(BookNo, @bookno),
            PartNo = ISNULL(PartNo, @partno),
            SubRegistrarOffice = ISNULL(SubRegistrarOffice, @sro),
            RegistrationDate = ISNULL(RegistrationDate, @regdt),
            Status = 'Registered'
          WHERE Id = @id
        `).catch((e) => console.error("[crm-registry] sales-deed mirror failed:", e.message));
    }

    await logRegistryHistory(id, 'Completed', `Reg No. ${b.RegistrationNo.trim()}${b.SubRegistrarOffice ? ` at ${b.SubRegistrarOffice}` : ''}`, actorId(req));

    await logCommunication(pool, {
      bookingId: cur.recordset[0].BookingId, direction: "Outbound",
      subject: "Deed registered at Sub-Registrar Office",
      summary: `Registry completed — Reg No. ${b.RegistrationNo.trim()}.`,
      createdBy: actorId(req),
    });

    res.json({ success: true });
  } catch (e) {
    console.error("[crm-registry] PUT /:id/complete error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id/cancel — the registration is being abandoned for this booking
// (e.g. cancellation, mutation elsewhere). Distinct from Completed/Scheduled
// so a dead tracker doesn't sit there forever looking "Pending".
router.put("/:id/cancel", requirePageRight("crm-registry", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    const reason = req.body?.Reason;
    if (!reason?.trim()) return res.status(400).json({ error: "A reason is required to cancel" });

    const cur = await pool.request().input("id", sql.Int, id).query("SELECT Status FROM dbo.CrmRegistry WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "Registry not found" });
    if (["Completed", "Cancelled"].includes(cur.recordset[0].Status)) {
      return res.status(400).json({ error: `Cannot cancel a registry that is already ${cur.recordset[0].Status}` });
    }

    await pool.request()
      .input("id", sql.Int, id)
      .input("rea", sql.NVarChar(sql.MAX), reason.trim())
      .input("ub", sql.Int, actorId(req))
      .query(`
        UPDATE dbo.CrmRegistry SET Status = 'Cancelled', CancelledReason = @rea, CancelledAt = SYSDATETIME(),
          CancelledBy = @ub, UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);
    await logRegistryHistory(id, 'Cancelled', reason.trim(), actorId(req));
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-registry] PUT /:id/cancel error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /:id/documents/upload — attach a supporting document (receipt,
// stamped copy, etc). Fulfils a pending mandatory request of the same
// DocumentType if one exists, otherwise adds a new (optional) row —
// mirrors crmSalesDeed.js's identical endpoint.
router.post("/:id/documents/upload", requirePageRight("crm-registry", "edit"), upload.array('files'), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    const { DocumentType = 'Other', Label, IsMandatory = 0, Remarks } = req.body;

    const reg = await pool.request().input("id", sql.Int, id).query("SELECT Status FROM dbo.CrmRegistry WHERE Id = @id");
    if (!reg.recordset.length) return res.status(404).json({ error: "Registry not found" });
    if (["Completed", "Cancelled"].includes(reg.recordset[0].Status)) {
      return res.status(400).json({ error: "Cannot modify documents for a completed or cancelled registry" });
    }

    for (const file of req.files || []) {
      const b64 = file.buffer.toString('base64');
      const reqCheck = await pool.request()
        .input("rid", sql.Int, id)
        .input("dt", sql.NVarChar(50), DocumentType)
        .query("SELECT TOP 1 Id FROM dbo.CrmRegistryDocument WHERE RegistryId = @rid AND DocumentType = @dt AND Status = 'Requested' AND IsMandatory = 1 ORDER BY CreatedAt ASC");

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
            UPDATE dbo.CrmRegistryDocument SET
              FileBase64 = @b64, FileName = @fn, MimeType = @mt, FileSize = @fs,
              Status = 'Uploaded', UploadedByType = 'Staff', UploadedAt = SYSDATETIME(),
              Remarks = ISNULL(@rem, Remarks), UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
            WHERE Id = @docid
          `);
      } else {
        await pool.request()
          .input("rid", sql.Int, id)
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
            INSERT INTO dbo.CrmRegistryDocument
              (RegistryId, DocumentType, Label, IsMandatory, Status, FileName, MimeType, FileSize, FileBase64,
               UploadedByType, UploadedAt, Remarks, CreatedBy, CreatedAt)
            VALUES (@rid, @dt, @lbl, @ism, 'Uploaded', @fn, @mt, @fs, @b64,
               'Staff', SYSDATETIME(), @rem, @cb, SYSDATETIME())
          `);
      }
    }
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-registry] documents/upload error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /:id/documents/request — request an additional mandatory/optional
// document dynamically (recovery path if the seeded one was ever consumed,
// or a second document type becomes necessary) — mirrors crmSalesDeed.js.
router.post("/:id/documents/request", requirePageRight("crm-registry", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    const { DocumentType, Label, IsMandatory = true } = req.body;
    if (!DocumentType?.trim()) return res.status(400).json({ error: "DocumentType is required" });

    const reg = await pool.request().input("id", sql.Int, id).query("SELECT Status FROM dbo.CrmRegistry WHERE Id = @id");
    if (!reg.recordset.length) return res.status(404).json({ error: "Registry not found" });
    if (["Completed", "Cancelled"].includes(reg.recordset[0].Status)) {
      return res.status(400).json({ error: "Cannot request documents for a completed or cancelled registry" });
    }

    const dup = await pool.request().input("rid", sql.Int, id).input("dt", sql.NVarChar(50), DocumentType.trim())
      .query("SELECT TOP 1 Id FROM dbo.CrmRegistryDocument WHERE RegistryId = @rid AND DocumentType = @dt AND Status IN ('Requested', 'Uploaded')");
    if (dup.recordset.length) return res.status(409).json({ error: `A ${DocumentType} request is already open` });

    await pool.request()
      .input('rid', sql.Int, id)
      .input('dt', sql.NVarChar(50), DocumentType.trim())
      .input('lbl', sql.NVarChar(255), Label?.trim() || DocumentType.trim())
      .input('ism', sql.Bit, IsMandatory ? 1 : 0)
      .input('cb', sql.Int, actorId(req))
      .query(`
        INSERT INTO dbo.CrmRegistryDocument (RegistryId, DocumentType, Label, IsMandatory, Status, RequestedBy, RequestedAt, CreatedBy, CreatedAt)
        VALUES (@rid, @dt, @lbl, @ism, 'Requested', @cb, SYSDATETIME(), @cb, SYSDATETIME())
      `);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id/documents/:docId — review a document (Verify/Reject).
router.put("/:id/documents/:docId", requirePageRight("crm-registry", "edit"), async (req, res) => {
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
        UPDATE dbo.CrmRegistryDocument SET Status = ISNULL(@st, Status), Remarks = ISNULL(@rem, Remarks), UpdatedBy = @ub, UpdatedAt = SYSDATETIME() WHERE Id = @docid
      `);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /documents/file/:docId — same access pattern as crmSalesDeed.js;
// the frontend fetches this with an auth header and previews/downloads the
// blob client-side rather than navigating to it directly.
router.get("/documents/file/:docId", async (req, res) => {
  try {
    const pool = getPool();
    const doc = await pool.request().input("docid", sql.Int, parseInt(req.params.docId, 10)).query(`
      SELECT FileName, MimeType, FileBase64 FROM dbo.CrmRegistryDocument WHERE Id = @docid
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
