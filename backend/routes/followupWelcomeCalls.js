const express = require("express");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { checkPermissionForMethod } = require("../middleware/routePermission");

const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, validate: false }));

const PERMISSION_MODULE = "Followup";
const PERMISSION_SUBMODULE = "WelcomeCalls";

const OUTCOME_OPTIONS = [
  "connected",
  "no_answer",
  "callback",
  "voicemail",
  "completed",
];
const STATUS_OPTIONS = ["Scheduled", "Completed", "Cancelled"];

const LIST_COLUMNS = `
  wc.Id,
  wc.CallNo,
  wc.BookingId,
  fb.BookingNo,
  wc.ApplicantId,
  ISNULL(ahm.DisplayName, ahm.LHeadName) AS ApplicantName,
  ahm.LHeadCode                          AS ApplicantNo,
  CONVERT(VARCHAR(10), wc.CallDate, 23)  AS CallDate,
  wc.CallTime,
  wc.Duration,
  wc.Outcome,
  wc.BankSelected,
  wc.LoanRequired,
  wc.ExpectedLoanAmount,
  wc.PreferredBanker,
  wc.AssignedTo,
  u.name  AS AssignedToName,
  wc.Notes,
  wc.Status,
  wc.CreatedBy,
  wc.CreatedAt,
  wc.UpdatedBy,
  wc.UpdatedAt
`;

router.use(authMiddleware);
router.use(checkPermissionForMethod(PERMISSION_MODULE, PERMISSION_SUBMODULE));

// ── Helpers ───────────────────────────────────────────────────────────────────
function requireUserName(req, res) {
  const userName = req.user?.name || req.user?.email || null;
  if (!userName) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return userName;
}

function parseId(rawId) {
  const id = parseInt(rawId, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function normalizeText(v) {
  if (v === undefined || v === null) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
}

function normalizeNumber(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function generateCallNo(pool) {
  const result = await pool.request().query(`
    SELECT COUNT(*) AS cnt FROM dbo.FollowupWelcomeCalls
  `);
  const cnt = result.recordset[0].cnt + 1;
  return `WC${String(cnt).padStart(5, "0")}`;
}

// ── GET /meta/options ─────────────────────────────────────────────────────────
router.get("/meta/options", async (req, res) => {
  try {
    const pool = getPool();

    const [bookingsRes, usersRes] = await Promise.all([
      pool.request().query(`
        SELECT fb.Id, fb.BookingNo,
               ISNULL(ahm.DisplayName, ahm.LHeadName) AS ApplicantName
        FROM   dbo.FollowupBookings fb
        LEFT JOIN dbo.AccountHeadMaster ahm
               ON ahm.LHeadId = fb.ApplicantId
        WHERE  fb.IsDeleted = 0
        ORDER  BY fb.BookingNo
      `),
      pool.request().query(`
        SELECT id AS Id, name AS Name FROM dbo.users WHERE ISNULL(discontinue, 0) = 0 ORDER BY name
      `),
    ]);

    res.json({
      outcomes: OUTCOME_OPTIONS,
      statuses: STATUS_OPTIONS,
      bookings: bookingsRes.recordset,
      assignees: usersRes.recordset,
    });
  } catch (err) {
    console.error("WelcomeCalls options error:", err.message);
    res.status(500).json({ error: "Failed to load options" });
  }
});

// ── GET / — list with pagination & filters ────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, parseInt(req.query.pageSize, 10) || 20),
    );
    const offset = (page - 1) * pageSize;
    const search =
      typeof req.query.search === "string" ? req.query.search.trim() : "";
    const status =
      typeof req.query.status === "string" ? req.query.status.trim() : "";
    const bookingId = parseId(req.query.bookingId);

    const pool = getPool();
    const request = pool.request();
    const filters = ["wc.IsDeleted = 0"];

    if (search) {
      filters.push(`(
        ahm.LHeadName LIKE @search OR
        ahm.DisplayName LIKE @search OR
        wc.CallNo LIKE @search OR
        wc.BankSelected LIKE @search
      )`);
      request.input("search", sql.NVarChar(255), `%${search}%`);
    }
    if (status) {
      filters.push("wc.Status = @status");
      request.input("status", sql.NVarChar(50), status);
    }
    if (bookingId) {
      filters.push("wc.BookingId = @bookingId");
      request.input("bookingId", sql.Int, bookingId);
    }

    const where = filters.join(" AND ");

    const dataResult = await request.query(`
      SELECT ${LIST_COLUMNS}
      FROM   dbo.FollowupWelcomeCalls wc
      LEFT JOIN dbo.FollowupBookings  fb  ON fb.Id   = wc.BookingId
      LEFT JOIN dbo.AccountHeadMaster ahm ON ahm.LHeadId  = wc.ApplicantId
      LEFT JOIN dbo.users             u   ON u.id    = wc.AssignedTo
      WHERE  ${where}
      ORDER  BY wc.CreatedAt DESC, wc.Id DESC
      OFFSET ${offset} ROWS FETCH NEXT ${pageSize} ROWS ONLY
    `);

    const countResult = await pool.request().query(`
      SELECT COUNT(*) AS total
      FROM   dbo.FollowupWelcomeCalls wc
      LEFT JOIN dbo.AccountHeadMaster ahm ON ahm.LHeadId = wc.ApplicantId
      WHERE  ${where}
    `);

    const total = countResult.recordset[0].total;
    res.json({
      data: dataResult.recordset,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (err) {
    console.error("WelcomeCalls GET error:", err.message);
    res.status(500).json({ error: "Failed to fetch welcome calls" });
  }
});

// ── GET /:id — single record ──────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });

  try {
    const result = await getPool().request().input("Id", sql.Int, id).query(`
        SELECT ${LIST_COLUMNS}
        FROM   dbo.FollowupWelcomeCalls wc
        LEFT JOIN dbo.FollowupBookings  fb  ON fb.Id  = wc.BookingId
        LEFT JOIN dbo.AccountHeadMaster ahm ON ahm.LHeadId = wc.ApplicantId
        LEFT JOIN dbo.users             u   ON u.id   = wc.AssignedTo
        WHERE  wc.Id = @Id AND wc.IsDeleted = 0
      `);

    if (!result.recordset.length)
      return res.status(404).json({ error: "Not found" });
    res.json(result.recordset[0]);
  } catch (err) {
    console.error("WelcomeCalls GET/:id error:", err.message);
    res.status(500).json({ error: "Failed to fetch welcome call" });
  }
});

// ── POST / — create ───────────────────────────────────────────────────────────
router.post("/", async (req, res) => {
  const userName = requireUserName(req, res);
  if (!userName) return;

  const {
    BookingId,
    ApplicantId,
    CallDate,
    CallTime,
    Duration,
    Outcome,
    BankSelected,
    LoanRequired,
    ExpectedLoanAmount,
    PreferredBanker,
    AssignedTo,
    Notes,
    Status,
  } = req.body || {};

  if (!ApplicantId)
    return res.status(400).json({ error: "ApplicantId is required" });

  let autoDraftNocNo = null;

  try {
    const pool = getPool();
    const callNo = await generateCallNo(pool);

    const result = await pool
      .request()
      .input("CallNo", sql.NVarChar(50), callNo)
      .input("BookingId", sql.Int, normalizeNumber(BookingId))
      .input("ApplicantId", sql.Int, normalizeNumber(ApplicantId))
      .input("CallDate", sql.Date, CallDate ? new Date(CallDate) : new Date())
      .input("CallTime", sql.NVarChar(10), normalizeText(CallTime))
      .input("Duration", sql.NVarChar(20), normalizeText(Duration))
      .input("Outcome", sql.NVarChar(50), normalizeText(Outcome))
      .input("BankSelected", sql.NVarChar(200), normalizeText(BankSelected))
      .input("LoanRequired", sql.Bit, LoanRequired ? 1 : 0)
      .input(
        "ExpectedLoanAmount",
        sql.Decimal(18, 2),
        normalizeNumber(ExpectedLoanAmount),
      )
      .input(
        "PreferredBanker",
        sql.NVarChar(200),
        normalizeText(PreferredBanker),
      )
      .input("AssignedTo", sql.Int, normalizeNumber(AssignedTo))
      .input("Notes", sql.NVarChar(sql.MAX), normalizeText(Notes))
      .input("Status", sql.NVarChar(50), normalizeText(Status) || "Scheduled")
      .input("CreatedBy", sql.NVarChar(100), userName).query(`
        INSERT INTO dbo.FollowupWelcomeCalls
          (CallNo, BookingId, ApplicantId, CallDate, CallTime, Duration,
           Outcome, BankSelected, LoanRequired, ExpectedLoanAmount,
           PreferredBanker, AssignedTo, Notes, Status, CreatedBy)
        OUTPUT INSERTED.Id, INSERTED.CallNo
        VALUES
          (@CallNo, @BookingId, @ApplicantId, @CallDate, @CallTime, @Duration,
           @Outcome, @BankSelected, @LoanRequired, @ExpectedLoanAmount,
           @PreferredBanker, @AssignedTo, @Notes, @Status, @CreatedBy)
      `);

    const id = result.recordset[0].Id;

    // ── Auto-draft Organisation NOC if bank was selected ────────────────────
    if (BankSelected) {
      try {
        const nocInsert = await pool
          .request()
          .input("ApplicantId", sql.Int, normalizeNumber(ApplicantId))
          .input("UnitSelectionId", sql.Int, null)
          .input("AgreementId", sql.Int, null)
          .input("ProjectId", sql.Int, null)
          .input("CompanyId", sql.Int, null)
          .input(
            "Reason",
            sql.NVarChar(500),
            `Bank NOC for ${BankSelected} — auto-created from Welcome Call ${callNo}`,
          )
          .input("Status", sql.NVarChar(30), "Pending")
          .input("CreatedBy", sql.NVarChar(100), userName).query(`
            INSERT INTO dbo.FollowupNOCs (
              ApplicantId, UnitSelectionId, AgreementId, ProjectId, CompanyId,
              Reason, Status, CreatedBy, CreatedAt
            )
            OUTPUT INSERTED.Id
            VALUES (
              @ApplicantId, @UnitSelectionId, @AgreementId, @ProjectId, @CompanyId,
              @Reason, @Status, @CreatedBy, SYSDATETIME()
            )
          `);
        const nocId = nocInsert.recordset[0]?.Id;
        if (nocId) {
          const nocNo = `NOC${String(nocId).padStart(6, "0")}`;
          await pool
            .request()
            .input("Id", sql.Int, nocId)
            .input("NOCNo", sql.NVarChar(50), nocNo)
            .query(`UPDATE dbo.FollowupNOCs SET NOCNo = @NOCNo WHERE Id = @Id`);
          autoDraftNocNo = nocNo;
        }
      } catch (nocErr) {
        // Non-fatal: log but don't fail the welcome call
        console.warn("Auto-draft NOC failed:", nocErr?.message);
      }
    }

    res.status(201).json({
      id,
      callNo,
      autoDraftNocNo,
    });
  } catch (err) {
    console.error("WelcomeCalls POST error:", err.message);
    res.status(500).json({ error: "Failed to create welcome call" });
  }
});

// ── PUT /:id — update ─────────────────────────────────────────────────────────
router.put("/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });

  const userName = requireUserName(req, res);
  if (!userName) return;

  const {
    BookingId,
    ApplicantId,
    CallDate,
    CallTime,
    Duration,
    Outcome,
    BankSelected,
    LoanRequired,
    ExpectedLoanAmount,
    PreferredBanker,
    AssignedTo,
    Notes,
    Status,
  } = req.body || {};

  try {
    const result = await getPool()
      .request()
      .input("Id", sql.Int, id)
      .input("BookingId", sql.Int, normalizeNumber(BookingId))
      .input("ApplicantId", sql.Int, normalizeNumber(ApplicantId))
      .input("CallDate", sql.Date, CallDate ? new Date(CallDate) : null)
      .input("CallTime", sql.NVarChar(10), normalizeText(CallTime))
      .input("Duration", sql.NVarChar(20), normalizeText(Duration))
      .input("Outcome", sql.NVarChar(50), normalizeText(Outcome))
      .input("BankSelected", sql.NVarChar(200), normalizeText(BankSelected))
      .input("LoanRequired", sql.Bit, LoanRequired ? 1 : 0)
      .input(
        "ExpectedLoanAmount",
        sql.Decimal(18, 2),
        normalizeNumber(ExpectedLoanAmount),
      )
      .input(
        "PreferredBanker",
        sql.NVarChar(200),
        normalizeText(PreferredBanker),
      )
      .input("AssignedTo", sql.Int, normalizeNumber(AssignedTo))
      .input("Notes", sql.NVarChar(sql.MAX), normalizeText(Notes))
      .input("Status", sql.NVarChar(50), normalizeText(Status))
      .input("UpdatedBy", sql.NVarChar(100), userName).query(`
        UPDATE dbo.FollowupWelcomeCalls SET
          BookingId          = ISNULL(@BookingId, BookingId),
          ApplicantId        = ISNULL(@ApplicantId, ApplicantId),
          CallDate           = ISNULL(@CallDate, CallDate),
          CallTime           = @CallTime,
          Duration           = @Duration,
          Outcome            = @Outcome,
          BankSelected       = @BankSelected,
          LoanRequired       = @LoanRequired,
          ExpectedLoanAmount = @ExpectedLoanAmount,
          PreferredBanker    = @PreferredBanker,
          AssignedTo         = @AssignedTo,
          Notes              = @Notes,
          Status             = ISNULL(@Status, Status),
          UpdatedBy          = @UpdatedBy,
          UpdatedAt          = SYSDATETIME()
        WHERE Id = @Id AND IsDeleted = 0
      `);

    if (!result.rowsAffected[0])
      return res.status(404).json({ error: "Not found" });
    res.json({ success: true });
  } catch (err) {
    console.error("WelcomeCalls PUT error:", err.message);
    res.status(500).json({ error: "Failed to update welcome call" });
  }
});

// ── DELETE /:id — soft delete ─────────────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });

  const userName = requireUserName(req, res);
  if (!userName) return;

  try {
    const result = await getPool()
      .request()
      .input("Id", sql.Int, id)
      .input("UpdatedBy", sql.NVarChar(100), userName).query(`
        UPDATE dbo.FollowupWelcomeCalls
        SET IsDeleted = 1, UpdatedBy = @UpdatedBy, UpdatedAt = SYSDATETIME()
        WHERE Id = @Id AND IsDeleted = 0
      `);

    if (!result.rowsAffected[0])
      return res.status(404).json({ error: "Not found" });
    res.json({ success: true });
  } catch (err) {
    console.error("WelcomeCalls DELETE error:", err.message);
    res.status(500).json({ error: "Failed to delete welcome call" });
  }
});

module.exports = router;
