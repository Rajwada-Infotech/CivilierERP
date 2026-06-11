const express = require("express");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { checkPermission } = require("../middleware/permissions");
const { logAudit } = require("../utils/auditLog");

const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, validate: false }));

const PERMISSION_MODULE = "Followup";
const PERMISSION_SUBMODULE = "Bookings";

const STATUS_OPTIONS = ["Confirmed", "Pending", "Cancelled"];
const PAYMENT_MODES = ["Cheque", "NEFT", "RTGS", "DD", "Cash", "Online"];

router.use(authMiddleware);

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
  return Number.isFinite(n) ? n : Number.NaN;
}

function assertValidNumber(v, name) {
  if (v === null) return null;
  return Number.isNaN(v) ? `${name} must be a valid number` : null;
}

/** Resolve a term's ₹ amount given the booking total value */
function resolveTermAmount(term, totalValue) {
  const tv = Number(totalValue) || 0;
  const tv2 = Number(term.TermValue) || 0;
  if (term.ValueType === "percent") return Math.round((tv2 / 100) * tv);
  if (term.ValueType === "fixed") return Math.round(tv2);
  return 0;
}

function getPayload(body) {
  const applicantId = normalizeNumber(body?.ApplicantId);
  const unitSelectionId = normalizeNumber(body?.UnitSelectionId);
  const projectId = normalizeNumber(body?.ProjectId);
  const companyId = normalizeNumber(body?.CompanyId);
  const assignedTo = normalizeNumber(body?.AssignedTo);
  const totalValue = normalizeNumber(body?.TotalValue);
  const bookingAmount = normalizeNumber(body?.BookingAmount) ?? 0;
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
  const status = normalizeText(body?.Status) || "Confirmed";
  if (!STATUS_OPTIONS.includes(status))
    return { error: `Status must be one of: ${STATUS_OPTIONS.join(", ")}` };

  // Validate PaymentTermIds if provided
  const rawTermIds = body?.PaymentTermIds;
  let paymentTermIds = null;
  if (Array.isArray(rawTermIds) && rawTermIds.length > 0) {
    paymentTermIds = rawTermIds
      .map((x) => parseInt(x, 10))
      .filter((x) => Number.isFinite(x) && x > 0);
    if (paymentTermIds.length === 0) paymentTermIds = null;
  }

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
    PaymentTermIds: paymentTermIds,
  };
}

/**
 * Fetch PaymentTermMaster rows for a list of TermIDs.
 * Returns a Map<termId, termRow>.
 */
async function fetchTermsByIds(pool, termIds) {
  if (!termIds || termIds.length === 0) return new Map();
  // Build a safe IN clause using individual params
  const req = pool.request();
  const placeholders = termIds.map((id, i) => {
    req.input(`tid${i}`, sql.Int, id);
    return `@tid${i}`;
  });
  const result = await req.query(`
    SELECT TermID, TermName, ValueType, TermValue, IsActive
    FROM dbo.PaymentTermMaster
    WHERE TermID IN (${placeholders.join(",")})
  `);
  const map = new Map();
  for (const row of result.recordset) map.set(row.TermID, row);
  return map;
}

/**
 * Insert rows into BookingPaymentTerms.
 * Clears existing rows first (for PUT).
 */
async function upsertBookingPaymentTerms(
  transaction,
  bookingId,
  bookingNo,
  termIds,
  totalValue,
) {
  // Delete existing
  await new sql.Request(transaction)
    .input("BookingID", sql.Int, bookingId)
    .query("DELETE FROM dbo.BookingPaymentTerms WHERE BookingID = @BookingID");

  if (!termIds || termIds.length === 0) return 0;

  // Fetch term details
  const pool = getPool();
  const termMap = await fetchTermsByIds(pool, termIds);

  let totalComputed = 0;
  const termNames = [];
  for (let i = 0; i < termIds.length; i++) {
    const termId = termIds[i];
    const term = termMap.get(termId);
    if (!term) continue; // skip invalid/inactive

    const computed = resolveTermAmount(term, totalValue || 0);
    totalComputed += computed;
    termNames.push(term.TermName);
    const docRef = `PMT-${bookingNo}-${String(i + 1).padStart(3, "0")}`;

    await new sql.Request(transaction)
      .input("BookingID", sql.Int, bookingId)
      .input("TermID", sql.Int, termId)
      .input("ComputedAmount", sql.Decimal(18, 2), computed)
      .input("DocRef", sql.NVarChar(50), docRef)
      .input("SortOrder", sql.Int, i + 1).query(`
        INSERT INTO dbo.BookingPaymentTerms
          (BookingID, TermID, ComputedAmount, DocRef, SortOrder)
        VALUES
          (@BookingID, @TermID, @ComputedAmount, @DocRef, @SortOrder)
      `);
  }
  return { totalComputed, paymentPlanSummary: termNames.join(", ") || null };
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
  fb.UnitNo,
  fb.BlockName,
  fb.FloorName,
  fb.UnitType,
  fb.AreaSqFt,
  fb.RatePerSqFt,
  fb.TotalValue,
  ISNULL((
    SELECT SUM(bpt.ComputedAmount)
    FROM dbo.BookingPaymentTerms bpt
    WHERE bpt.BookingID = fb.Id
  ), fb.BookingAmount) AS BookingAmount,
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
  fb.UpdatedAt,
  fb.PaymentPlanSummary
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
        LEFT JOIN dbo.enterprise     pm ON pm.id = fb.ProjectId
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
        LEFT JOIN dbo.enterprise     pm ON pm.id = fb.ProjectId
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

// ── GET /applicants ───────────────────────────────────────────────────────────
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
        SELECT
          p.id   AS Id,
          p.name AS Name,
          COALESCE(p.company_id, pc.PrimaryCompanyId) AS company_id,
          pc.CompanyIds AS company_ids
        FROM dbo.enterprise p
        OUTER APPLY (
          SELECT
            MIN(x.cid) AS PrimaryCompanyId,
            STRING_AGG(CAST(x.cid AS NVARCHAR(20)), ',')
              WITHIN GROUP (ORDER BY x.cid) AS CompanyIds
          FROM (
            SELECT p.company_id AS cid WHERE p.company_id IS NOT NULL
            UNION
            SELECT pc2.CompanyId FROM dbo.ProjectCompanies pc2 WHERE pc2.ProjectId = p.id
          ) x
        ) pc
        WHERE p.business_type = 'P'
        ORDER BY p.name
      `);
      res.json(result.recordset);
    } catch (err) {
      console.error("followupBookings /projects error:", err);
      res.status(500).json({ error: "Failed to fetch projects" });
    }
  },
);

// ── GET /:id/payment-terms ─────────────────────────────────────────────────────
// Returns the payment schedule attached to a booking with full term details
router.get(
  "/:id/payment-terms",
  checkPermission(PERMISSION_MODULE, PERMISSION_SUBMODULE, "CanView"),
  async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid booking id" });

    try {
      const result = await getPool().request().input("BookingID", sql.Int, id)
        .query(`
          SELECT
            bpt.Id,
            bpt.BookingID,
            bpt.TermID,
            ptm.TermName,
            ptm.ValueType,
            ptm.TermValue,
            bpt.ComputedAmount,
            bpt.DocRef,
            bpt.SortOrder,
            bpt.DueDate,
            bpt.IsPaid,
            bpt.PaidOn,
            bpt.CreatedAt
          FROM dbo.BookingPaymentTerms bpt
          JOIN dbo.PaymentTermMaster   ptm ON ptm.TermID = bpt.TermID
          WHERE bpt.BookingID = @BookingID
          ORDER BY bpt.SortOrder, bpt.Id
        `);
      res.json(result.recordset);
    } catch (err) {
      console.error("followupBookings GET /:id/payment-terms error:", err);
      res.status(500).json({ error: "Failed to fetch payment terms" });
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
          LEFT JOIN dbo.enterprise     pm ON pm.id = fb.ProjectId
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
          VALUES (
            @ApplicantId, @UnitSelectionId, @ProjectId, @CompanyId,
            @UnitNo, @BlockName, @FloorName, @UnitType,
            @AreaSqFt, @RatePerSqFt, @TotalValue, @BookingAmount,
            @BookingDate, @PaymentMode, @ChequeNo, @BankName,
            @LoanApproved, @LoanBank, @LoanAmount,
            @AssignedTo, @Status, @Notes, @CreatedBy, SYSDATETIME()
          );
          SELECT SCOPE_IDENTITY() AS Id;
        `);

      const id = Number(insertResult.recordset[0]?.Id);
      if (!id) throw new Error("Insert returned no Id");
      const bookingNo = `BKG${String(id).padStart(6, "0")}`;

      await new sql.Request(transaction)
        .input("Id", sql.Int, id)
        .input("BookingNo", sql.NVarChar(50), bookingNo)
        .query(
          `UPDATE dbo.FollowupBookings SET BookingNo = @BookingNo WHERE Id = @Id`,
        );

      // Insert payment terms and back-fill BookingAmount from their total
      if (payload.PaymentTermIds && payload.PaymentTermIds.length > 0) {
        const { totalComputed, paymentPlanSummary } =
          await upsertBookingPaymentTerms(
            transaction,
            id,
            bookingNo,
            payload.PaymentTermIds,
            payload.TotalValue,
          );
        await new sql.Request(transaction)
          .input("Id", sql.Int, id)
          .input("BookingAmount", sql.Decimal(18, 2), totalComputed)
          .input("PaymentPlanSummary", sql.NVarChar(500), paymentPlanSummary)
          .query(
            "UPDATE dbo.FollowupBookings SET BookingAmount = @BookingAmount, PaymentPlanSummary = @PaymentPlanSummary WHERE Id = @Id",
          );
      }

      await transaction.commit();
      logAudit({ module: "Booking", recordId: id, recordNo: bookingNo, action: "Created", changedBy: userName });
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

    const pool = getPool();
    const transaction = pool.transaction();
    try {
      await transaction.begin();

      // Fetch existing to get BookingNo
      const existing = await new sql.Request(transaction).input(
        "Id",
        sql.Int,
        id,
      ).query(`
          SELECT Id, BookingNo, TotalValue
          FROM dbo.FollowupBookings
          WHERE Id = @Id AND IsDeleted = 0
        `);
      if (!existing.recordset[0]) {
        await transaction.rollback();
        return res.status(404).json({ error: "Booking not found" });
      }

      const bookingNo =
        existing.recordset[0].BookingNo || `BKG${String(id).padStart(6, "0")}`;

      await new sql.Request(transaction)
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

      // Sync payment terms — only overwrite BookingAmount if terms are actually provided
      const { totalComputed, paymentPlanSummary } =
        await upsertBookingPaymentTerms(
          transaction,
          id,
          bookingNo,
          payload.PaymentTermIds,
          payload.TotalValue,
        );
      if (payload.PaymentTermIds && payload.PaymentTermIds.length > 0) {
        await new sql.Request(transaction)
          .input("Id", sql.Int, id)
          .input("BookingAmount", sql.Decimal(18, 2), totalComputed)
          .input("PaymentPlanSummary", sql.NVarChar(500), paymentPlanSummary)
          .query(
            "UPDATE dbo.FollowupBookings SET BookingAmount = @BookingAmount, PaymentPlanSummary = @PaymentPlanSummary WHERE Id = @Id",
          );
      }

      await transaction.commit();
      logAudit({ module: "Booking", recordId: id, recordNo: bookingNo, action: "Updated", notes: `Status: ${payload.Status}`, changedBy: userName });
      res.json({ success: true });
    } catch (err) {
      try { await transaction.rollback(); } catch {}
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
      const pool = getPool();

      // Block deletion of Confirmed bookings or those with downstream records
      const guardResult = await pool.request().input("Id", sql.Int, id).query(`
        SELECT
          fb.Status,
          (SELECT COUNT(*) FROM dbo.FollowupAgreements    WHERE BookingId = @Id AND IsDeleted = 0) AS Agreements,
          (SELECT COUNT(*) FROM dbo.FollowupWelcomeCalls  WHERE BookingId = @Id AND IsDeleted = 0) AS WelcomeCalls
        FROM dbo.FollowupBookings fb
        WHERE fb.Id = @Id AND fb.IsDeleted = 0
      `);
      const guard = guardResult.recordset[0];
      if (!guard) return res.status(404).json({ error: "Booking not found" });
      if (guard.Status === "Confirmed") {
        return res.status(409).json({ error: "Confirmed bookings cannot be deleted. Cancel the booking first." });
      }
      if (Number(guard.Agreements) > 0 || Number(guard.WelcomeCalls) > 0) {
        return res.status(400).json({ error: "This booking has linked records and cannot be deleted." });
      }

      await pool
        .request()
        .input("Id", sql.Int, id)
        .input("UpdatedBy", sql.NVarChar(100), userName).query(`
          UPDATE dbo.FollowupBookings
          SET IsDeleted = 1, UpdatedBy = @UpdatedBy, UpdatedAt = SYSDATETIME()
          WHERE Id = @Id AND IsDeleted = 0
        `);
      logAudit({ module: "Booking", recordId: id, action: "Deleted", changedBy: userName });
      res.json({ success: true });
    } catch (err) {
      console.error("followupBookings DELETE error:", err);
      res.status(500).json({ error: "Failed to delete booking" });
    }
  },
);

module.exports = router;