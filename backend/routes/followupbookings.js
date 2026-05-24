const express = require("express");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { checkPermission } = require("../middleware/permissions");

const router = express.Router();

const PERMISSION_MODULE = "Followup";
const PERMISSION_SUBMODULE = "Bookings";

const STATUS_OPTIONS = ["Confirmed", "Pending", "Cancelled"];
const PAYMENT_MODES = ["Cheque", "NEFT", "RTGS", "DD", "Cash", "Online"];

router.use(authMiddleware);

// ── Helpers ──────────────────────────────────────────────────────────────────
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
  return Number.isFinite(n) ? n : Number.NaN;
}

function assertValidNumber(v, name) {
  if (v === null) return null;
  return Number.isNaN(v) ? `${name} must be a valid number` : null;
}

function getPayload(body) {
  const applicantId = normalizeNumber(body?.ApplicantId);
  const unitSelectionId = normalizeNumber(body?.UnitSelectionId);
  const projectId = normalizeNumber(body?.ProjectId);
  const companyId = normalizeNumber(body?.CompanyId);
  const assignedTo = normalizeNumber(body?.AssignedTo);
  const totalValue = normalizeNumber(body?.TotalValue);
  const bookingAmount = normalizeNumber(body?.BookingAmount);
  const ratePerSqFt = normalizeNumber(body?.RatePerSqFt);
  const areaSqFt = normalizeNumber(body?.AreaSqFt);
  const loanAmount = normalizeNumber(body?.LoanAmount);

  const numericError =
    assertValidNumber(applicantId, "ApplicantId") ||
    assertValidNumber(unitSelectionId, "UnitSelectionId") ||
    assertValidNumber(projectId, "ProjectId") ||
    assertValidNumber(companyId, "CompanyId") ||
    assertValidNumber(assignedTo, "AssignedTo") ||
    assertValidNumber(totalValue, "TotalValue") ||
    assertValidNumber(bookingAmount, "BookingAmount") ||
    assertValidNumber(ratePerSqFt, "RatePerSqFt") ||
    assertValidNumber(areaSqFt, "AreaSqFt") ||
    assertValidNumber(loanAmount, "LoanAmount");
  if (numericError) return { error: numericError };

  if (!applicantId) return { error: "ApplicantId is required" };

  const unitNo = normalizeText(body?.UnitNo);
  if (!unitNo) return { error: "UnitNo is required" };

  const bookingDate = normalizeText(body?.BookingDate);
  if (!bookingDate) return { error: "BookingDate is required" };

  if (bookingAmount == null) return { error: "BookingAmount is required" };

  const status = normalizeText(body?.Status) || "Confirmed";
  if (!STATUS_OPTIONS.includes(status))
    return { error: `Status must be one of: ${STATUS_OPTIONS.join(", ")}` };

  return {
    ApplicantId: applicantId,
    UnitSelectionId: unitSelectionId,
    ProjectId: projectId,
    CompanyId: companyId,
    UnitNo: unitNo,
    BlockName: normalizeText(body?.BlockName),
    FloorName: normalizeText(body?.FloorName),
    UnitType: normalizeText(body?.UnitType),
    AreaSqFt: areaSqFt,
    RatePerSqFt: ratePerSqFt,
    TotalValue: totalValue,
    BookingAmount: bookingAmount,
    BookingDate: bookingDate,
    PaymentMode: normalizeText(body?.PaymentMode),
    ChequeNo: normalizeText(body?.ChequeNo),
    BankName: normalizeText(body?.BankName),
    LoanApproved: body?.LoanApproved ? 1 : 0,
    LoanBank: normalizeText(body?.LoanBank),
    LoanAmount: loanAmount,
    AssignedTo: assignedTo,
    Status: status,
    Notes: normalizeText(body?.Notes),
  };
}

const LIST_COLUMNS = `
  fb.Id,
  fb.BookingNo,
  fb.ApplicantId,
  fa.ApplicantName,
  fa.PrimaryMobile,
  fa.Email,
  fb.UnitSelectionId,
  fb.ProjectId,
  pm.name AS ProjectName,
  fb.CompanyId,
  cm.Name AS CompanyName,
  fb.UnitNo,
  fb.BlockName,
  fb.FloorName,
  fb.UnitType,
  fb.AreaSqFt,
  fb.RatePerSqFt,
  fb.TotalValue,
  fb.BookingAmount,
  CONVERT(VARCHAR(10), fb.BookingDate, 120) AS BookingDate,
  fb.PaymentMode,
  fb.ChequeNo,
  fb.BankName,
  fb.LoanApproved,
  fb.LoanBank,
  fb.LoanAmount,
  fb.AssignedTo,
  u.name AS AssignedToName,
  fb.Status,
  fb.Notes,
  fb.CreatedBy,
  fb.CreatedAt,
  fb.UpdatedBy,
  fb.UpdatedAt
`;

// ── GET / (list) ─────────────────────────────────────────────────────────────
router.get(
  "/",
  checkPermission(PERMISSION_MODULE, PERMISSION_SUBMODULE, "CanView"),
  async (req, res) => {
    try {
      const {
        search,
        status,
        projectId,
        page = "1",
        pageSize = "20",
      } = req.query;
      const pg = Math.max(1, parseInt(page, 10) || 1);
      const ps = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20));
      const skip = (pg - 1) * ps;

      const whereClauses = ["fb.IsDeleted = 0"];
      const request = getPool().request();

      if (search) {
        whereClauses.push(`(
          fa.ApplicantName LIKE @search OR
          fb.BookingNo     LIKE @search OR
          fa.PrimaryMobile LIKE @search OR
          fa.Email         LIKE @search OR
          pm.name          LIKE @search OR
          fb.UnitNo        LIKE @search
        )`);
        request.input("search", sql.NVarChar(255), `%${search}%`);
      }
      if (status) {
        whereClauses.push("fb.Status = @status");
        request.input("status", sql.NVarChar(30), status);
      }
      if (projectId) {
        whereClauses.push("fb.ProjectId = @projectId");
        request.input("projectId", sql.Int, parseInt(projectId, 10));
      }

      const WHERE = whereClauses.join(" AND ");

      const countResult = await request.query(`
        SELECT COUNT(*) AS Total
        FROM dbo.FollowupBookings fb
        JOIN dbo.FollowupApplications fa ON fa.Id = fb.ApplicantId
        LEFT JOIN dbo.ProjectMaster  pm ON pm.Id = fb.ProjectId
        LEFT JOIN dbo.CompanyMaster  cm ON cm.Id = fb.CompanyId
        LEFT JOIN dbo.users          u  ON u.id  = fb.AssignedTo
        WHERE ${WHERE}
      `);

      const total = countResult.recordset[0]?.Total ?? 0;
      const totalPages = Math.max(1, Math.ceil(total / ps));

      request.input("skip", sql.Int, skip);
      request.input("take", sql.Int, ps);

      const dataResult = await request.query(`
        SELECT ${LIST_COLUMNS}
        FROM dbo.FollowupBookings fb
        JOIN dbo.FollowupApplications fa ON fa.Id = fb.ApplicantId
        LEFT JOIN dbo.ProjectMaster  pm ON pm.Id = fb.ProjectId
        LEFT JOIN dbo.CompanyMaster  cm ON cm.Id = fb.CompanyId
        LEFT JOIN dbo.users          u  ON u.id  = fb.AssignedTo
        WHERE ${WHERE}
        ORDER BY fb.BookingDate DESC, fb.Id DESC
        OFFSET @skip ROWS FETCH NEXT @take ROWS ONLY
      `);

      res.json({
        data: dataResult.recordset,
        pagination: { page: pg, pageSize: ps, total, totalPages },
      });
    } catch (err) {
      console.error("followupBookings GET error:", err);
      res.status(500).json({ error: "Failed to fetch bookings" });
    }
  },
);

// ── GET /applicants (for combobox) ────────────────────────────────────────────
router.get(
  "/applicants",
  checkPermission(PERMISSION_MODULE, PERMISSION_SUBMODULE, "CanView"),
  async (req, res) => {
    try {
      const result = await getPool().request().query(`
        SELECT Id, ApplicantName AS Name, PrimaryMobile AS Phone, Email
        FROM dbo.FollowupApplications
        WHERE IsDeleted = 0
        ORDER BY ApplicantName
      `);
      res.json(result.recordset);
    } catch (err) {
      console.error("followupBookings /applicants error:", err);
      res.status(500).json({ error: "Failed to fetch applicants" });
    }
  },
);

// ── GET /projects ─────────────────────────────────────────────────────────────
router.get(
  "/projects",
  checkPermission(PERMISSION_MODULE, PERMISSION_SUBMODULE, "CanView"),
  async (req, res) => {
    try {
      const result = await getPool().request().query(`
        SELECT id AS Id, name AS Name
        FROM dbo.enterprise
        WHERE business_type = 'P' AND (discontinue = 0 OR discontinue IS NULL)
        ORDER BY name
      `);
      res.json(result.recordset);
    } catch (err) {
      console.error("followupBookings /projects error:", err);
      res.status(500).json({ error: "Failed to fetch projects" });
    }
  },
);

// ── GET /:id (single) ─────────────────────────────────────────────────────────
router.get(
  "/:id",
  checkPermission(PERMISSION_MODULE, PERMISSION_SUBMODULE, "CanView"),
  async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid booking id" });

    try {
      const result = await getPool().request().input("Id", sql.Int, id).query(`
        SELECT ${LIST_COLUMNS}
        FROM dbo.FollowupBookings fb
        JOIN dbo.FollowupApplications fa ON fa.Id = fb.ApplicantId
        LEFT JOIN dbo.ProjectMaster  pm ON pm.Id = fb.ProjectId
        LEFT JOIN dbo.CompanyMaster  cm ON cm.Id = fb.CompanyId
        LEFT JOIN dbo.users          u  ON u.id  = fb.AssignedTo
        WHERE fb.Id = @Id AND fb.IsDeleted = 0
      `);

      if (!result.recordset[0])
        return res.status(404).json({ error: "Booking not found" });

      res.json(result.recordset[0]);
    } catch (err) {
      console.error("followupBookings GET /:id error:", err);
      res.status(500).json({ error: "Failed to fetch booking" });
    }
  },
);

// ── POST / (create) ───────────────────────────────────────────────────────────
router.post(
  "/",
  checkPermission(PERMISSION_MODULE, PERMISSION_SUBMODULE, "CanAdd"),
  async (req, res) => {
    const userName = requireUserName(req, res);
    if (!userName) return;

    const payload = getPayload(req.body);
    if (payload.error) return res.status(400).json({ error: payload.error });

    const pool = getPool();
    const transaction = pool.transaction();
    try {
      await transaction.begin();

      const insertResult = await new sql.Request(transaction)
        .input("ApplicantId", sql.Int, payload.ApplicantId)
        .input("UnitSelectionId", sql.Int, payload.UnitSelectionId)
        .input("ProjectId", sql.Int, payload.ProjectId)
        .input("CompanyId", sql.Int, payload.CompanyId)
        .input("UnitNo", sql.NVarChar(100), payload.UnitNo)
        .input("BlockName", sql.NVarChar(100), payload.BlockName)
        .input("FloorName", sql.NVarChar(100), payload.FloorName)
        .input("UnitType", sql.NVarChar(100), payload.UnitType)
        .input("AreaSqFt", sql.Decimal(18, 2), payload.AreaSqFt)
        .input("RatePerSqFt", sql.Decimal(18, 2), payload.RatePerSqFt)
        .input("TotalValue", sql.Decimal(18, 2), payload.TotalValue)
        .input("BookingAmount", sql.Decimal(18, 2), payload.BookingAmount)
        .input("BookingDate", sql.Date, payload.BookingDate)
        .input("PaymentMode", sql.NVarChar(50), payload.PaymentMode)
        .input("ChequeNo", sql.NVarChar(100), payload.ChequeNo)
        .input("BankName", sql.NVarChar(255), payload.BankName)
        .input("LoanApproved", sql.Bit, payload.LoanApproved)
        .input("LoanBank", sql.NVarChar(255), payload.LoanBank)
        .input("LoanAmount", sql.Decimal(18, 2), payload.LoanAmount)
        .input("AssignedTo", sql.Int, payload.AssignedTo)
        .input("Status", sql.NVarChar(30), payload.Status)
        .input("Notes", sql.NVarChar(sql.MAX), payload.Notes)
        .input("CreatedBy", sql.NVarChar(100), userName).query(`
          INSERT INTO dbo.FollowupBookings (
            ApplicantId, UnitSelectionId, ProjectId, CompanyId,
            UnitNo, BlockName, FloorName, UnitType,
            AreaSqFt, RatePerSqFt, TotalValue, BookingAmount,
            BookingDate, PaymentMode, ChequeNo, BankName,
            LoanApproved, LoanBank, LoanAmount,
            AssignedTo, Status, Notes, CreatedBy, CreatedAt
          )
          OUTPUT INSERTED.Id
          VALUES (
            @ApplicantId, @UnitSelectionId, @ProjectId, @CompanyId,
            @UnitNo, @BlockName, @FloorName, @UnitType,
            @AreaSqFt, @RatePerSqFt, @TotalValue, @BookingAmount,
            @BookingDate, @PaymentMode, @ChequeNo, @BankName,
            @LoanApproved, @LoanBank, @LoanAmount,
            @AssignedTo, @Status, @Notes, @CreatedBy, SYSDATETIME()
          )
        `);

      const id = insertResult.recordset[0]?.Id;
      const bookingNo = `BKG${String(id).padStart(6, "0")}`;

      await new sql.Request(transaction)
        .input("Id", sql.Int, id)
        .input("BookingNo", sql.NVarChar(50), bookingNo)
        .query(
          `UPDATE dbo.FollowupBookings SET BookingNo = @BookingNo WHERE Id = @Id`,
        );

      await transaction.commit();
      res
        .status(201)
        .json({ Id: id, BookingNo: bookingNo, Status: payload.Status });
    } catch (err) {
      try {
        await transaction.rollback();
      } catch {}
      console.error("followupBookings POST error:", err);
      res.status(500).json({ error: "Failed to create booking" });
    }
  },
);

// ── PUT /:id (update) ─────────────────────────────────────────────────────────
router.put(
  "/:id",
  checkPermission(PERMISSION_MODULE, PERMISSION_SUBMODULE, "CanEdit"),
  async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid booking id" });

    const userName = requireUserName(req, res);
    if (!userName) return;

    const payload = getPayload(req.body);
    if (payload.error) return res.status(400).json({ error: payload.error });

    try {
      const existing = await getPool()
        .request()
        .input("Id", sql.Int, id)
        .query(
          `SELECT Id FROM dbo.FollowupBookings WHERE Id = @Id AND IsDeleted = 0`,
        );
      if (!existing.recordset[0])
        return res.status(404).json({ error: "Booking not found" });

      await getPool()
        .request()
        .input("Id", sql.Int, id)
        .input("ApplicantId", sql.Int, payload.ApplicantId)
        .input("UnitSelectionId", sql.Int, payload.UnitSelectionId)
        .input("ProjectId", sql.Int, payload.ProjectId)
        .input("CompanyId", sql.Int, payload.CompanyId)
        .input("UnitNo", sql.NVarChar(100), payload.UnitNo)
        .input("BlockName", sql.NVarChar(100), payload.BlockName)
        .input("FloorName", sql.NVarChar(100), payload.FloorName)
        .input("UnitType", sql.NVarChar(100), payload.UnitType)
        .input("AreaSqFt", sql.Decimal(18, 2), payload.AreaSqFt)
        .input("RatePerSqFt", sql.Decimal(18, 2), payload.RatePerSqFt)
        .input("TotalValue", sql.Decimal(18, 2), payload.TotalValue)
        .input("BookingAmount", sql.Decimal(18, 2), payload.BookingAmount)
        .input("BookingDate", sql.Date, payload.BookingDate)
        .input("PaymentMode", sql.NVarChar(50), payload.PaymentMode)
        .input("ChequeNo", sql.NVarChar(100), payload.ChequeNo)
        .input("BankName", sql.NVarChar(255), payload.BankName)
        .input("LoanApproved", sql.Bit, payload.LoanApproved)
        .input("LoanBank", sql.NVarChar(255), payload.LoanBank)
        .input("LoanAmount", sql.Decimal(18, 2), payload.LoanAmount)
        .input("AssignedTo", sql.Int, payload.AssignedTo)
        .input("Status", sql.NVarChar(30), payload.Status)
        .input("Notes", sql.NVarChar(sql.MAX), payload.Notes)
        .input("UpdatedBy", sql.NVarChar(100), userName).query(`
          UPDATE dbo.FollowupBookings SET
            ApplicantId     = @ApplicantId,
            UnitSelectionId = @UnitSelectionId,
            ProjectId       = @ProjectId,
            CompanyId       = @CompanyId,
            UnitNo          = @UnitNo,
            BlockName       = @BlockName,
            FloorName       = @FloorName,
            UnitType        = @UnitType,
            AreaSqFt        = @AreaSqFt,
            RatePerSqFt     = @RatePerSqFt,
            TotalValue      = @TotalValue,
            BookingAmount   = @BookingAmount,
            BookingDate     = @BookingDate,
            PaymentMode     = @PaymentMode,
            ChequeNo        = @ChequeNo,
            BankName        = @BankName,
            LoanApproved    = @LoanApproved,
            LoanBank        = @LoanBank,
            LoanAmount      = @LoanAmount,
            AssignedTo      = @AssignedTo,
            Status          = @Status,
            Notes           = @Notes,
            UpdatedBy       = @UpdatedBy,
            UpdatedAt       = SYSDATETIME()
          WHERE Id = @Id AND IsDeleted = 0
        `);

      res.json({ success: true });
    } catch (err) {
      console.error("followupBookings PUT error:", err);
      res.status(500).json({ error: "Failed to update booking" });
    }
  },
);

// ── DELETE /:id ───────────────────────────────────────────────────────────────
router.delete(
  "/:id",
  checkPermission(PERMISSION_MODULE, PERMISSION_SUBMODULE, "CanDelete"),
  async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid booking id" });

    const userName = requireUserName(req, res);
    if (!userName) return;

    try {
      await getPool()
        .request()
        .input("Id", sql.Int, id)
        .input("UpdatedBy", sql.NVarChar(100), userName).query(`
          UPDATE dbo.FollowupBookings
          SET IsDeleted = 1, UpdatedBy = @UpdatedBy, UpdatedAt = SYSDATETIME()
          WHERE Id = @Id AND IsDeleted = 0
        `);
      res.json({ success: true });
    } catch (err) {
      console.error("followupBookings DELETE error:", err);
      res.status(500).json({ error: "Failed to delete booking" });
    }
  },
);

module.exports = router;
