const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const allowRoles = require("../middleware/role");
const { requirePageRight } = require("../middleware/requirePageRight");
const bcrypt = require("bcrypt");

const adminOnly = allowRoles("admin", "super_admin");

// ── Broker RERA certificate upload — mirrors crmBookingDocuments.js's
// disk-storage + streamed-GET pattern exactly (private upload dir, random
// filename, path-traversal guard on read). Only ever attached to
// LHeadType='BR' rows.
const BROKER_CERT_DIR = path.join(__dirname, "../uploads/broker-certificates");
if (!fs.existsSync(BROKER_CERT_DIR)) fs.mkdirSync(BROKER_CERT_DIR, { recursive: true });
const brokerCertUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, BROKER_CERT_DIR),
    filename: (_req, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
      cb(null, `${Date.now()}_${Math.round(Math.random() * 1e9)}_${safe}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ALLOWED = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
    if (ALLOWED.includes(file.mimetype)) return cb(null, true);
    cb(new Error("File type not allowed — upload a PDF or image"));
  },
});

// SUNDRY CREDITORS (migration 260628/154, Code='SCS') — every broker's ledger
// head lands here automatically instead of staff manually picking an Account
// Group. Mirrors crmLedger.js's getSundryDebtorsGroupId() cache-once pattern
// exactly, just the payable-side equivalent for brokers (who are owed
// commission) instead of the receivable-side one CRM customers use.
let _sundryCreditorsGroupId;
async function getSundryCreditorsGroupId(pool) {
  if (_sundryCreditorsGroupId !== undefined) return _sundryCreditorsGroupId;
  const r = await pool.request().query("SELECT TOP 1 AGId FROM dbo.AccountGroup WHERE Code = 'SCS'");
  _sundryCreditorsGroupId = r.recordset[0]?.AGId ?? null;
  return _sundryCreditorsGroupId;
}

// SUNDRY DEBTORS (ASSETS > CURRENT ASSETS > TRADE RECEIVABLES > SUNDRY
// DEBTORS, Code='SDS') — the receivable-side equivalent of
// getSundryCreditorsGroupId above. Every Customer/Applicant (LHeadType='A')
// created via CustomerMaster.tsx lands here automatically. Mirrors
// crmLedger.js's getSundryDebtorsGroupId() (kept as a separate cache here
// rather than importing that module, matching how this file already
// duplicates the Creditors pattern instead of sharing it).
let _sundryDebtorsGroupId;
async function getSundryDebtorsGroupId(pool) {
  if (_sundryDebtorsGroupId !== undefined) return _sundryDebtorsGroupId;
  const r = await pool.request().query("SELECT TOP 1 AGId FROM dbo.AccountGroup WHERE Code = 'SDS'");
  _sundryDebtorsGroupId = r.recordset[0]?.AGId ?? null;
  return _sundryDebtorsGroupId;
}

// Matches backend/routes/users.js's SALT_ROUNDS exactly — reusing the same
// bcrypt library and cost factor per the "no new encryption mechanism" spec,
// not introducing a second constant that could silently drift out of sync.
const SALT_ROUNDS = 12;

// Default Supplier Portal login password applied when an admin creates a
// supplier without setting one explicitly — never blocks creation on
// picking a password up front. Always changeable afterwards via the edit
// endpoint's optional SupplierPassword field.
const DEFAULT_SUPPLIER_PASSWORD = "123456";

// ── Auto-generate a unique Supplier Portal login email ─────────────────────
// Format: <sanitized supplier name>@civilier.in. Collisions (two suppliers
// with the same/very similar name) get a numeric suffix before the @ —
// checked against dbo.users.email (UNIQUE-constrained there), the only
// table a supplier's login identity actually lives in. AccountHeadMaster
// is the shared, generic ledger-head table (suppliers/customers/banks/GL
// heads as rows, distinguished by LHeadType) and deliberately has no
// login-related columns at all — a supplier's credentials are a dbo.users
// row (role='supplier', LinkedLHeadId -> this ledger head), exactly the
// same mechanism every other user in the system authenticates through.
async function generateSupplierLoginEmail(pool, supplierName) {
  const base =
    String(supplierName || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "") || "supplier";

  for (let suffix = 0; suffix < 1000; suffix++) {
    const candidate = `${base}${suffix || ""}@civilier.in`;
    const existing = await pool
      .request()
      .input("email", sql.NVarChar(150), candidate)
      .query("SELECT 1 AS hit FROM dbo.users WHERE email = @email");
    if (!existing.recordset.length) return candidate;
  }
  // Astronomically unlikely (1000 same-named suppliers), but never loop forever.
  throw new Error("Could not generate a unique supplier login email — too many name collisions.");
}

let accountHeadColumnMetaPromise = null;

async function getAccountHeadColumnMeta() {
  if (!accountHeadColumnMetaPromise) {
    accountHeadColumnMetaPromise = getPool()
      .request()
      .query(
        `
        SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'AccountHeadMaster'
      `,
      )
      .then((result) => {
        const meta = new Map();
        result.recordset.forEach((row) => {
          meta.set(row.COLUMN_NAME.toLowerCase(), {
            name: row.COLUMN_NAME,
            type: row.DATA_TYPE,
            isNullable: row.IS_NULLABLE === "YES",
          });
        });
        return meta;
      })
      .catch(() => new Map());
  }
  return accountHeadColumnMetaPromise;
}

const getColumn = (meta, columnName) =>
  meta.get(columnName.toLowerCase()) || null;
const hasColumn = (meta, columnName) => Boolean(getColumn(meta, columnName));

const requireUserName = (req, res) => {
  const email = req.user?.name;
  if (!email) {
    res.status(401).json({ error: "User context missing" });
    return null;
  }
  return email;
};

// ─── GET single by id ───────────────────────────────────────────────────────
router.get("/:id", async (req, res, next) => {
  if (!/^\d+$/.test(req.params.id)) return next();
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: "Invalid id" });
    }
    const columnMeta = await getAccountHeadColumnMeta();
    const selectColumns = [
      "lh.LHeadId",
      "ISNULL(lh.DisplayName, lh.LHeadName) AS LHeadName",
      "lh.LHeadCode",
      "lh.LHeadType",
      "lh.LHeadPhone",
      "lh.LHeadEmail",
      "lh.LHeadAddress",
      "lh.LHeadContactPerson",
      "lh.LHeadStatus",
      "lh.LHeadPaymentTerms",
      "lh.LBranchName",
      "lh.LGST",
      "lh.LGSTState",
      "lh.LCountry",
      "lh.LBelongsTo",
      "lh.LDescription",
    ];
    if (hasColumn(columnMeta, "LGSTType")) selectColumns.push("lh.LGSTType");
    if (hasColumn(columnMeta, "LHeadPan")) selectColumns.push("lh.LHeadPan");
    if (hasColumn(columnMeta, "LHeadRera")) selectColumns.push("lh.LHeadRera");
    if (hasColumn(columnMeta, "LHeadCertificateUrl"))
      selectColumns.push("lh.LHeadCertificateUrl");
    if (hasColumn(columnMeta, "LHeadCertificateFileName"))
      selectColumns.push("lh.LHeadCertificateFileName");
    if (hasColumn(columnMeta, "LHeadCategory"))
      selectColumns.push("lh.LHeadCategory");
    if (hasColumn(columnMeta, "IsTdsApplicable"))
      selectColumns.push("lh.IsTdsApplicable");

    // Login email lives on dbo.users (role='supplier', LinkedLHeadId -> this
    // row), not on AccountHeadMaster — same table every other user's login
    // identity lives in. Safe to expose (it's a username, not a secret);
    // the bcrypt hash itself is never selected in any GET response.
    const query = `SELECT ${selectColumns.join(", ")},
        su.email AS SupplierLoginEmail
      FROM dbo.AccountHeadMaster lh
      LEFT JOIN dbo.users su ON su.LinkedLHeadId = lh.LHeadId AND su.RoleId = (SELECT RId FROM dbo.Role WHERE LOWER(RName) = 'supplier')
      WHERE lh.LHeadId = @id`;

    const result = await pool.request().input("id", sql.Int, id).query(query);

    if (!result.recordset.length) {
      return res.status(404).json({ error: "Not found" });
    }
    res.json(result.recordset[0]);
  } catch (err) {
    console.error("GET BY ID ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET all ──────────────────────────────────────────────────────────────────
router.get("/", cache("account-head-master", 300), async (req, res) => {
  try {
    const pool = getPool();
    const columnMeta = await getAccountHeadColumnMeta();
    const selectColumns = [
      "lh.LHeadId",
      "ISNULL(lh.DisplayName, lh.LHeadName) AS LHeadName",
      "lh.LHeadCode",
      "lh.LHeadType",
      "lh.LHeadPhone",
      "lh.LHeadEmail",
      "lh.LHeadAddress",
      "lh.LHeadContactPerson",
      "lh.LHeadStatus",
      "lh.LHeadPaymentTerms",
      "lh.LBranchName",
      "lh.LGST",
      "lh.LGSTState",
      "lh.LCountry",
      "lh.LBelongsTo",
      "lh.LDescription",
      "lh.isEdited",
      "lh.Status", // ← approval status
    ];

    if (hasColumn(columnMeta, "LGSTType")) selectColumns.push("lh.LGSTType");
    if (hasColumn(columnMeta, "LHeadPan")) selectColumns.push("lh.LHeadPan");
    if (hasColumn(columnMeta, "LHeadRera")) selectColumns.push("lh.LHeadRera");
    if (hasColumn(columnMeta, "LHeadCertificateUrl"))
      selectColumns.push("lh.LHeadCertificateUrl");
    if (hasColumn(columnMeta, "LHeadCertificateFileName"))
      selectColumns.push("lh.LHeadCertificateFileName");
    if (hasColumn(columnMeta, "LHeadCategory"))
      selectColumns.push("lh.LHeadCategory");
    if (hasColumn(columnMeta, "IsTdsApplicable"))
      selectColumns.push("lh.IsTdsApplicable");
    if (hasColumn(columnMeta, "CreatedAt")) selectColumns.push("lh.CreatedAt");
    if (hasColumn(columnMeta, "UpdatedAt")) selectColumns.push("lh.UpdatedAt");
    if (hasColumn(columnMeta, "ApprovedBy"))
      selectColumns.push("lh.ApprovedBy");
    if (hasColumn(columnMeta, "ApprovedAt"))
      selectColumns.push("lh.ApprovedAt");
    if (hasColumn(columnMeta, "CreatedBy"))
      selectColumns.push("lh.CreatedBy AS CreatedByEmail");
    if (hasColumn(columnMeta, "UpdatedBy"))
      selectColumns.push("lh.UpdatedBy AS UpdatedByEmail");

    // Login email lives on dbo.users (role='supplier', LinkedLHeadId -> this
    // row) — see GET /:id above for the full rationale.
    let query = `SELECT
        ${selectColumns.join(",\n        ")},
        ag.Name         AS GroupName,
        ag.ParentGroupId,
        parent.Name     AS ParentGroupName,
        su.email        AS SupplierLoginEmail
      FROM dbo.AccountHeadMaster lh
      LEFT JOIN dbo.AccountGroup ag     ON ag.AGId     = lh.LBelongsTo
      LEFT JOIN dbo.AccountGroup parent ON parent.AGId = ag.ParentGroupId
      LEFT JOIN dbo.users su            ON su.LinkedLHeadId = lh.LHeadId AND su.RoleId = (SELECT RId FROM dbo.Role WHERE LOWER(RName) = 'supplier')`;

    const request = pool.request();
    const conditions = [];
    if (req.query.type) {
      conditions.push("lh.LHeadType = @type");
      request.input("type", sql.VarChar(50), req.query.type);
    }
    if (req.query.groupId) {
      conditions.push("lh.LBelongsTo = @groupId");
      request.input("groupId", sql.Int, parseInt(req.query.groupId, 10));
    }
    if (conditions.length) {
      query += " WHERE " + conditions.join(" AND ");
    }

    const result = await request.query(query);
    res.json(result.recordset);
  } catch (err) {
    console.error("GET ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST — create (always Draft) ─────────────────────────────────────────────
router.post("/", requirePageRight("account-head", "create"), async (req, res) => {
  const {
    LHeadName,
    LHeadCode,
    LHeadPhone,
    LHeadEmail,
    LHeadAddress,
    LHeadContactPerson,
    LHeadStatus,
    LHeadPaymentTerms,
    LBranchName,
    LGST,
    LGSTState,
    LCountry,
    LBelongsTo,
    LDescription,
    LGSTType,
    LHeadPan,
    LHeadRera,
    LHeadCategory,
    LHeadType,
  IsTdsApplicable,
    SupplierPassword: supplierPasswordPlain,
  } = req.body;

  try {
    const userName = requireUserName(req, res);
    if (!userName) return;

    // LHeadName is a NOT NULL column with no fallback default in the insert
    // below (unlike LHeadAddress/LHeadContactPerson/LHeadType, which all
    // fall back to a placeholder) — omitting it used to reach the database
    // and crash with an unhandled SQL "Cannot insert the value NULL" 500
    // instead of a clean validation error. Same bug class found and fixed
    // across purchaseOrders.js, expenseBooking.js, workOrder.js,
    // materialIssues.js, chequeMasterSchemas.js, debitNote.js,
    // cardMasterSchemas.js, and roomMaster.js during a live-DB workflow test.
    // Checked before the supplier-password rule below so a request missing
    // BOTH fields reports the more fundamental error first (matches the
    // existing precedence other required-field checks in this route use).
    if (!LHeadName || !LHeadName.trim()) {
      return res.status(400).json({ error: "LHeadName is required." });
    }

    // ── Supplier login password — defaults to "123456" when not supplied,
    // so creating a supplier never blocks on picking a password up front.
    // An admin can still set/override it here or change it later via the
    // edit endpoint below. Only validated (min length) when explicitly given.
    if (LHeadType === "S" && supplierPasswordPlain && supplierPasswordPlain.length < 6) {
      return res.status(400).json({
        error: "Supplier password must be at least 6 characters.",
        code: "INVALID_SUPPLIER_PASSWORD",
      });
    }

    // ── Account Group is mandatory (not required for suppliers/customers/contractors) ──
    if (
      !LBelongsTo &&
      LHeadType !== "S" &&
      LHeadType !== "A" &&
      LHeadType !== "C" &&
      LHeadType !== "BR"
    ) {
      return res.status(400).json({
        error:
          "Please select an Account Group before creating a Ledger Account.",
        code: "MISSING_ACCOUNT_GROUP",
      });
    }

    // ── PAN is mandatory for suppliers ──
    if (LHeadType === "S" && !(LHeadPan && LHeadPan.trim())) {
      return res.status(400).json({
        error: "PAN Number is mandatory for suppliers.",
        code: "MISSING_PAN",
      });
    }

    // ── Phone must fit the LHeadPhone column (VarChar(15)) ──
    if (LHeadPhone && LHeadPhone.length > 15) {
      return res.status(400).json({
        error: "Phone number must be 15 characters or fewer.",
        code: "PHONE_TOO_LONG",
      });
    }

    const pool = getPool();
    const columnMeta = await getAccountHeadColumnMeta();

    // Brokers, Suppliers, and Contractors all always land in SUNDRY
    // CREDITORS — never trust a client-supplied LBelongsTo for these types
    // (payable-side ledger heads), so one is never left invisible in Trial
    // Balance the way a NULL-group head would be (see trialBalance.js's
    // `WHERE ahm.LBelongsTo IS NOT NULL` filter).
    //
    // LHeadType='C' still collides with one remaining code path that reuses
    // 'C' to mean "Customer" rather than "Contractor" —
    // projectMaster.js's ensureProjectLedgerHeads (LHeadCode 'PRJ-<id>-CUST').
    // crmLedger.js's ensureCrmCustomerLedgerHead used to collide here too but
    // now correctly mints LHeadType='A' (see migration 224). Those rows
    // belong in SUNDRY DEBTORS, not Creditors, so any code containing
    // 'CUST' is excluded from this block.
    const isCustomerHeadMislabelledC = (LHeadCode || "").includes("CUST");
    let effectiveLBelongsTo = LBelongsTo;
    if (
      !isCustomerHeadMislabelledC &&
      (LHeadType === "BR" || LHeadType === "S" || LHeadType === "C")
    ) {
      effectiveLBelongsTo = await getSundryCreditorsGroupId(pool);
    } else if (LHeadType === "A") {
      // Customers/Applicants (CustomerMaster.tsx) always land in SUNDRY
      // DEBTORS — same never-trust-the-client treatment as the Creditors
      // block above, just the receivable side.
      effectiveLBelongsTo = await getSundryDebtorsGroupId(pool);
    }

    // Both need to be resolved before the insert (email generation queries
    // the DB for collisions; hashing is async), and both only apply to
    // suppliers.
    let supplierLoginEmail = null;
    let supplierPasswordHash = null;
    if (LHeadType === "S") {
      supplierLoginEmail = await generateSupplierLoginEmail(pool, LHeadName);
      supplierPasswordHash = await bcrypt.hash(supplierPasswordPlain || DEFAULT_SUPPLIER_PASSWORD, SALT_ROUNDS);
    }

    const tx = pool.transaction();
    await tx.begin();
    let newLHeadId;
    try {
    const request = tx
      .request()
      .input("LHeadName", sql.NVarChar(200), LHeadName)
      .input("LHeadCode", sql.NVarChar(20), LHeadCode || null)
      .input("LHeadPhone", sql.VarChar(15), LHeadPhone || null)
      .input("LHeadEmail", sql.NVarChar(100), LHeadEmail || null)
      .input("LHeadAddress", sql.VarChar(300), LHeadAddress || "N/A")
      .input(
        "LHeadContactPerson",
        sql.VarChar(100),
        LHeadContactPerson || "N/A",
      )
      .input("LHeadStatus", sql.Bit, LHeadStatus !== false ? 1 : 0)
      .input("LHeadPaymentTerms", sql.NVarChar(100), LHeadPaymentTerms || "N/A")
      .input(
        "LBranchName",
        sql.VarChar(100),
        LHeadType === "B" ? LBranchName || "Main" : (LBranchName ?? null),
      )
      .input("LGST", sql.VarChar(20), LGST || null)
      .input("LGSTState", sql.VarChar(50), LGSTState || null)
      .input("LCountry", sql.VarChar(50), LCountry || "India")
      .input("LBelongsTo", sql.Int, effectiveLBelongsTo || null)
      .input("LDescription", sql.NVarChar, LDescription || null)
      .input("LHeadType", sql.VarChar(50), LHeadType || "GL")
      .input("Status", sql.NVarChar(20), "Draft"); // ← always Draft on create

    const insertColumns = [
      "LHeadName",
      "LHeadCode",
      "LHeadPhone",
      "LHeadEmail",
      "LHeadAddress",
      "LHeadContactPerson",
      "LHeadStatus",
      "LHeadPaymentTerms",
      "LBranchName",
      "LGST",
      "LGSTState",
      "LCountry",
      "LBelongsTo",
      "LDescription",
      "LHeadType",
      "Status",
    ];
    const insertValues = insertColumns.map((col) => `@${col}`);

    if (hasColumn(columnMeta, "LGSTType")) {
      request.input("LGSTType", sql.NVarChar(50), LGSTType || null);
      insertColumns.push("LGSTType");
      insertValues.push("@LGSTType");
    }
    if (hasColumn(columnMeta, "LHeadPan")) {
      request.input("LHeadPan", sql.NVarChar(50), LHeadPan || null);
      insertColumns.push("LHeadPan");
      insertValues.push("@LHeadPan");
    }
    if (hasColumn(columnMeta, "LHeadRera")) {
      request.input("LHeadRera", sql.NVarChar(50), LHeadRera || null);
      insertColumns.push("LHeadRera");
      insertValues.push("@LHeadRera");
    }
    if (hasColumn(columnMeta, "LHeadCategory")) {
      request.input("LHeadCategory", sql.NVarChar(100), LHeadCategory || null);
      insertColumns.push("LHeadCategory");
      insertValues.push("@LHeadCategory");
    }
    if (hasColumn(columnMeta, "IsTdsApplicable")) {
      request.input("IsTdsApplicable", sql.Bit, IsTdsApplicable ? 1 : 0);
      insertColumns.push("IsTdsApplicable");
      insertValues.push("@IsTdsApplicable");
    }
    if (hasColumn(columnMeta, "CreatedBy")) {
      request.input("CreatedBy", sql.NVarChar(100), userName);
      insertColumns.push("CreatedBy");
      insertValues.push("@CreatedBy");
    }
    if (hasColumn(columnMeta, "CreatedAt")) {
      request.input("CreatedAt", sql.DateTime2, new Date());
      insertColumns.push("CreatedAt");
      insertValues.push("@CreatedAt");
    }
    const inserted = await request.query(`
      INSERT INTO dbo.AccountHeadMaster (${insertColumns.join(", ")})
      OUTPUT INSERTED.LHeadId
      VALUES (${insertValues.join(", ")})
    `);
    newLHeadId = inserted.recordset[0].LHeadId;

    // ── Wire up real Supplier Portal login ──────────────────────────────────
    // AccountHeadMaster never stores login credentials — a supplier's login
    // is a dbo.users row (bcrypt hash, role='supplier', LinkedLHeadId
    // pointing back here), the exact mechanism the existing Supplier Portal
    // login (routes/users.js POST /login + routes/supplierPortal.js
    // resolveSupplier) already uses, per the seed pattern in
    // migrations/260702/157-quotation-l1-supplier-portal.sql. Without this,
    // the supplier's new email/password would be stored but could never
    // actually log in anywhere.
    if (LHeadType === "S") {
      const roleRow = await tx
        .request()
        .query("SELECT TOP 1 RId FROM dbo.Role WHERE LOWER(RName) = 'supplier'");
      const supplierRoleId = roleRow.recordset[0]?.RId ?? null;

      await tx
        .request()
        .input("name", sql.NVarChar(200), LHeadName)
        .input("email", sql.NVarChar(150), supplierLoginEmail)
        .input("password", sql.NVarChar(255), supplierPasswordHash)
        .input("RoleId", sql.Int, supplierRoleId)
        .input("LinkedLHeadId", sql.Int, newLHeadId).query(`
          INSERT INTO dbo.users (name, email, password, RoleId, created_datetime, discontinue, can_accept_tickets, LinkedLHeadId)
          VALUES (@name, @email, @password, @RoleId, GETDATE(), 0, 0, @LinkedLHeadId)
        `);
    }

    await tx.commit();
    } catch (txErr) {
      try {
        await tx.rollback();
      } catch {
        /* best-effort — original error is what propagates */
      }
      throw txErr;
    }

    await bumpCacheVersion("account-head-master");
    res.json({
      message: "Ledger head added successfully",
      LHeadId: newLHeadId,
      ...(supplierLoginEmail ? { SupplierLoginEmail: supplierLoginEmail } : {}),
      ...(LHeadType === "S" && !supplierPasswordPlain
        ? { SupplierPasswordDefaulted: true, SupplierDefaultPassword: DEFAULT_SUPPLIER_PASSWORD }
        : {}),
    });
  } catch (err) {
    console.error("INSERT ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET options ───────────────────────────────────────────────────────────────
router.get("/options", async (req, res) => {
  try {
    const pool = getPool();
    let query = `SELECT LHeadId AS id, LHeadName AS label, LHeadContactPerson AS contactPerson
                 FROM dbo.AccountHeadMaster WHERE LHeadStatus = 1`;
    const request = pool.request();
    if (req.query.type) {
      // Accepts a single type ("S") or a comma-separated list ("S,C") —
      // the Payment page's Payee/Party picker needs both Suppliers and
      // Contractors since a Contract can be tagged to either.
      const types = String(req.query.type).split(",").map((t) => t.trim()).filter(Boolean);
      if (types.length === 1) {
        query += " AND LHeadType = @type";
        request.input("type", sql.VarChar(50), types[0]);
      } else if (types.length > 1) {
        const params = types.map((t, i) => `@type${i}`);
        query += ` AND LHeadType IN (${params.join(",")})`;
        types.forEach((t, i) => request.input(`type${i}`, sql.VarChar(50), t));
      }
    }
    query += " ORDER BY LHeadName";
    const result = await request.query(query);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET bank options ──────────────────────────────────────────────────────────
router.get("/bank-options", async (req, res) => {
  try {
    const pool = getPool();
    const columnMeta = await getAccountHeadColumnMeta();
    // Same column-name fallback bankMaster.js uses when saving BCompanyName —
    // whichever of these actually exists on this DB holds the company label
    // picked from the same company dropdown ChequeMaster's Company field uses.
    const companyCol =
      getColumn(columnMeta, "CompanyName")?.name ||
      getColumn(columnMeta, "LCompanyName")?.name ||
      "LDescription";
    const result = await pool.request().query(`
      SELECT LHeadId AS id, LHeadName AS label,
             LAccountNo AS accountNumber, LIFSCCode AS ifscCode,
             LBranchName AS branchName, ${companyCol} AS companyName
      FROM dbo.AccountHeadMaster
      WHERE LHeadType = 'B' AND LHeadStatus = 1
      ORDER BY LHeadName
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /:id/submit — user submits for approval ───────────────────────────────
router.put("/:id/submit", requirePageRight("account-head", "edit"), async (req, res) => {
  try {
    const userName = requireUserName(req, res);
    if (!userName) return;

    const pool = getPool();

    // Only the creator can submit, and only from Draft or Rejected
    const existing = await pool
      .request()
      .input("id", sql.Int, req.params.id)
      .query(
        "SELECT Status, CreatedBy FROM dbo.AccountHeadMaster WHERE LHeadId = @id",
      );

    const row = existing.recordset[0];
    if (!row) return res.status(404).json({ error: "Record not found" });
    if (!["Draft", "Rejected"].includes(row.Status)) {
      return res
        .status(400)
        .json({ error: `Cannot submit from status: ${row.Status}` });
    }

    await pool
      .request()
      .input("id", sql.Int, req.params.id)
      .input("UpdatedBy", sql.NVarChar(100), userName).query(`
        UPDATE dbo.AccountHeadMaster SET
          Status    = 'Pending',
          UpdatedBy = @UpdatedBy,
          UpdatedAt = SYSDATETIME()
        WHERE LHeadId = @id
      `);

    await bumpCacheVersion("account-head-master");
    res.json({ message: "Submitted for approval" });
  } catch (err) {
    console.error("SUBMIT ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /:id/approve — admin approves ────────────────────────────────────────
router.put("/:id/approve", adminOnly, async (req, res) => {
  try {
    const userName = requireUserName(req, res);
    if (!userName) return;

    const pool = getPool();

    const existing = await pool
      .request()
      .input("id", sql.Int, req.params.id)
      .query("SELECT Status FROM dbo.AccountHeadMaster WHERE LHeadId = @id");

    const row = existing.recordset[0];
    if (!row) return res.status(404).json({ error: "Record not found" });
    if (row.Status !== "Pending") {
      return res
        .status(400)
        .json({ error: `Cannot approve from status: ${row.Status}` });
    }

    await pool
      .request()
      .input("id", sql.Int, req.params.id)
      .input("ApprovedBy", sql.NVarChar(100), userName).query(`
        UPDATE dbo.AccountHeadMaster SET
          Status     = 'Approved',
          ApprovedBy = @ApprovedBy,
          ApprovedAt = SYSDATETIME()
        WHERE LHeadId = @id
      `);

    await bumpCacheVersion("account-head-master");
    res.json({ message: "Record approved successfully" });
  } catch (err) {
    console.error("APPROVE ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /:id/reject — admin rejects ──────────────────────────────────────────
router.put("/:id/reject", adminOnly, async (req, res) => {
  try {
    const userName = requireUserName(req, res);
    if (!userName) return;

    const { reason } = req.body; // optional rejection reason

    const pool = getPool();

    const existing = await pool
      .request()
      .input("id", sql.Int, req.params.id)
      .query("SELECT Status FROM dbo.AccountHeadMaster WHERE LHeadId = @id");

    const row = existing.recordset[0];
    if (!row) return res.status(404).json({ error: "Record not found" });
    if (row.Status !== "Pending") {
      return res
        .status(400)
        .json({ error: `Cannot reject from status: ${row.Status}` });
    }

    await pool
      .request()
      .input("id", sql.Int, req.params.id)
      .input("UpdatedBy", sql.NVarChar(100), userName)
      .input("reason", sql.NVarChar(500), reason || null).query(`
        UPDATE dbo.AccountHeadMaster SET
          Status    = 'Rejected',
          UpdatedBy = @UpdatedBy,
          UpdatedAt = SYSDATETIME()
        WHERE LHeadId = @id
      `);

    await bumpCacheVersion("account-head-master");
    res.json({ message: "Record rejected" });
  } catch (err) {
    console.error("REJECT ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /:id — update (blocked if Approved) ──────────────────────────────────
router.put("/:id", requirePageRight("account-head", "edit"), async (req, res) => {
  const {
    LHeadName,
    LHeadCode,
    LHeadPhone,
    LHeadEmail,
    LHeadAddress,
    LHeadContactPerson,
    LHeadStatus,
    LHeadPaymentTerms,
    LBranchName,
    LGST,
    LGSTState,
    LCountry,
    LBelongsTo,
    LDescription,
    LGSTType,
    LHeadPan,
    LHeadRera,
    LHeadCategory,
    LHeadType,
    IsTdsApplicable,
    SupplierPassword: supplierPasswordPlain,
  } = req.body;

  try {
    const userName = requireUserName(req, res);
    if (!userName) return;

    // Same NOT NULL column as POST / — this UPDATE overwrites it
    // unconditionally (LHeadName=@LHeadName, not a COALESCE-style partial
    // update), so omitting it here would null out the existing value and
    // crash the same way the create path did before the fix above.
    if (!LHeadName || !LHeadName.trim()) {
      return res.status(400).json({ error: "LHeadName is required." });
    }

    // Password is optional on edit (only mandatory at creation) — an admin
    // resetting it types a new one; leaving it blank keeps the existing
    // hash untouched on both AccountHeadMaster and the linked dbo.users row.
    if (LHeadType === "S" && supplierPasswordPlain && supplierPasswordPlain.length < 6) {
      return res.status(400).json({
        error: "Supplier password must be at least 6 characters.",
        code: "MISSING_SUPPLIER_PASSWORD",
      });
    }

    const pool = getPool();

    // Block editing approved records
    const existing = await pool
      .request()
      .input("id", sql.Int, req.params.id)
      .query("SELECT Status FROM dbo.AccountHeadMaster WHERE LHeadId = @id");

    const row = existing.recordset[0];
    if (!row) return res.status(404).json({ error: "Record not found" });
    if (row.Status === "Approved") {
      return res.status(400).json({ error: "Cannot edit an approved record" });
    }

    // ── Account Group is mandatory (not required for suppliers/customers/contractors) ──
    if (
      !LBelongsTo &&
      LHeadType !== "S" &&
      LHeadType !== "A" &&
      LHeadType !== "C" &&
      LHeadType !== "BR"
    ) {
      return res.status(400).json({
        error: "Please select an Account Group before saving a Ledger Account.",
        code: "MISSING_ACCOUNT_GROUP",
      });
    }

    // ── PAN is mandatory for suppliers ──
    if (LHeadType === "S" && !(LHeadPan && LHeadPan.trim())) {
      return res.status(400).json({
        error: "PAN Number is mandatory for suppliers.",
        code: "MISSING_PAN",
      });
    }

    // ── Phone must fit the LHeadPhone column (VarChar(15)) ──
    if (LHeadPhone && LHeadPhone.length > 15) {
      return res.status(400).json({
        error: "Phone number must be 15 characters or fewer.",
        code: "PHONE_TOO_LONG",
      });
    }

    const columnMeta = await getAccountHeadColumnMeta();

    // Same auto-assignment as POST / — a broker/supplier/contractor's group
    // is never client-editable, even on update. Excludes any 'CUST'-coded
    // head, which also uses LHeadType='C' but means "Customer" (Sundry
    // Debtors), not Contractor — see POST / for detail.
    const isCustomerHeadMislabelledC = (LHeadCode || "").includes("CUST");
    let effectiveLBelongsTo = LBelongsTo;
    if (
      !isCustomerHeadMislabelledC &&
      (LHeadType === "BR" || LHeadType === "S" || LHeadType === "C")
    ) {
      effectiveLBelongsTo = await getSundryCreditorsGroupId(pool);
    } else if (LHeadType === "A") {
      effectiveLBelongsTo = await getSundryDebtorsGroupId(pool);
    }

    let newSupplierPasswordHash = null;
    if (LHeadType === "S" && supplierPasswordPlain) {
      newSupplierPasswordHash = await bcrypt.hash(supplierPasswordPlain, SALT_ROUNDS);
    }

    const tx = pool.transaction();
    await tx.begin();
    try {
    const request = tx
      .request()
      .input("id", sql.Int, req.params.id)
      .input("LHeadName", sql.NVarChar(200), LHeadName)
      .input("LHeadCode", sql.NVarChar(20), LHeadCode || null)
      .input("LHeadPhone", sql.VarChar(15), LHeadPhone || null)
      .input("LHeadEmail", sql.NVarChar(100), LHeadEmail || null)
      .input("LHeadAddress", sql.VarChar(300), LHeadAddress || null)
      .input("LHeadContactPerson", sql.VarChar(100), LHeadContactPerson || null)
      .input("LHeadStatus", sql.Bit, LHeadStatus !== false ? 1 : 0)
      .input("LHeadPaymentTerms", sql.NVarChar(100), LHeadPaymentTerms || null)
      .input("LBranchName", sql.VarChar(100), LBranchName || null)
      .input("LGST", sql.VarChar(20), LGST || null)
      .input("LGSTState", sql.VarChar(50), LGSTState || null)
      .input("LCountry", sql.VarChar(50), LCountry || null)
      .input("LBelongsTo", sql.Int, effectiveLBelongsTo || null)
      .input("LDescription", sql.NVarChar, LDescription || null);

    const updates = [
      "LHeadName=@LHeadName",
      "LHeadCode=@LHeadCode",
      "LHeadPhone=@LHeadPhone",
      "LHeadEmail=@LHeadEmail",
      "LHeadAddress=@LHeadAddress",
      "LHeadContactPerson=@LHeadContactPerson",
      "LHeadStatus=@LHeadStatus",
      "LHeadPaymentTerms=@LHeadPaymentTerms",
      "LBranchName=@LBranchName",
      "LGST=@LGST",
      "LGSTState=@LGSTState",
      "LCountry=@LCountry",
      "LBelongsTo=@LBelongsTo",
      "LDescription=@LDescription",
      "isEdited=1",
      "Status='Draft'", // editing resets back to Draft
    ];

    if (hasColumn(columnMeta, "LGSTType")) {
      request.input("LGSTType", sql.NVarChar(50), LGSTType || null);
      updates.push("LGSTType=@LGSTType");
    }
    if (hasColumn(columnMeta, "LHeadPan")) {
      request.input("LHeadPan", sql.NVarChar(50), LHeadPan || null);
      updates.push("LHeadPan=@LHeadPan");
    }
    if (hasColumn(columnMeta, "LHeadRera")) {
      request.input("LHeadRera", sql.NVarChar(50), LHeadRera || null);
      updates.push("LHeadRera=@LHeadRera");
    }
    if (hasColumn(columnMeta, "LHeadCategory")) {
      request.input("LHeadCategory", sql.NVarChar(100), LHeadCategory || null);
      updates.push("LHeadCategory=@LHeadCategory");
    }
    if (hasColumn(columnMeta, "IsTdsApplicable")) {
      request.input("IsTdsApplicable", sql.Bit, IsTdsApplicable ? 1 : 0);
      updates.push("IsTdsApplicable=@IsTdsApplicable");
    }
    if (hasColumn(columnMeta, "UpdatedBy")) {
      request.input("UpdatedBy", sql.NVarChar(100), userName);
      updates.push("UpdatedBy=@UpdatedBy");
    }
    if (hasColumn(columnMeta, "UpdatedAt")) {
      updates.push("UpdatedAt=SYSDATETIME()");
    }

    await request.query(`
      UPDATE dbo.AccountHeadMaster SET ${updates.join(", ")}
      WHERE LHeadId = @id
    `);

    // Update the linked Supplier Portal login (dbo.users) — AccountHeadMaster
    // never stores credentials (see POST / above). Note: LHeadName
    // intentionally is NOT synced back to the login email here even if it
    // changed — regenerating a supplier's login email on every name edit
    // would silently invalidate credentials they already know, so the
    // login email is fixed at creation time (see POST / and
    // generateSupplierLoginEmail).
    if (newSupplierPasswordHash) {
      await tx
        .request()
        .input("id", sql.Int, req.params.id)
        .input("password", sql.NVarChar(255), newSupplierPasswordHash)
        .query("UPDATE dbo.users SET password=@password WHERE LinkedLHeadId=@id AND RoleId = (SELECT RId FROM dbo.Role WHERE LOWER(RName) = 'supplier')");
    }

    await tx.commit();
    } catch (txErr) {
      try {
        await tx.rollback();
      } catch {
        /* best-effort — original error is what propagates */
      }
      throw txErr;
    }

    await bumpCacheVersion("account-head-master");
    res.json({ message: "Ledger head updated" });
  } catch (err) {
    console.error("UPDATE ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE ────────────────────────────────────────────────────────────────────
router.delete("/:id", requirePageRight("account-head", "delete"), async (req, res) => {
  try {
    const pool = getPool();

    // Block deleting approved records
    const existing = await pool
      .request()
      .input("id", sql.Int, req.params.id)
      .query("SELECT Status FROM dbo.AccountHeadMaster WHERE LHeadId = @id");

    const row = existing.recordset[0];
    if (row?.Status === "Approved") {
      return res
        .status(400)
        .json({ error: "Cannot delete an approved record" });
    }

    await pool
      .request()
      .input("id", sql.Int, req.params.id)
      .query("DELETE FROM dbo.AccountHeadMaster WHERE LHeadId = @id");

    await bumpCacheVersion("account-head-master");
    res.json({ message: "Ledger head deleted" });
  } catch (err) {
    console.error("DELETE ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /:id/certificate — RERA/broker certificate upload, single file.
// Scoped to LHeadType='BR' rows only — this is a broker-only concept even
// though it lives on the shared AccountHeadMaster table.
router.post("/:id/certificate", requirePageRight("account-head", "edit"), (req, res) => {
  brokerCertUpload.single("file")(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      const id = parseInt(req.params.id);
      const pool = getPool();
      const row = await pool.request().input("id", sql.Int, id)
        .query("SELECT LHeadType FROM dbo.AccountHeadMaster WHERE LHeadId = @id");
      if (!row.recordset.length || row.recordset[0].LHeadType !== "BR") {
        const resolved = path.resolve(req.file.path);
        if (resolved.startsWith(path.resolve(BROKER_CERT_DIR) + path.sep)) fs.unlink(resolved, () => {});
        return res.status(404).json({ error: "Broker not found" });
      }
      await pool.request()
        .input("id", sql.Int, id)
        .input("url", sql.NVarChar(500), req.file.path)
        .input("fn", sql.NVarChar(300), req.file.originalname)
        .query(`
          UPDATE dbo.AccountHeadMaster SET
            LHeadCertificateUrl = @url, LHeadCertificateFileName = @fn, UpdatedAt = SYSDATETIME()
          WHERE LHeadId = @id
        `);
      await bumpCacheVersion("account-head-master");
      res.status(201).json({ success: true, fileName: req.file.originalname });
    } catch (e) {
      if (req.file) {
        const resolved = path.resolve(req.file.path);
        if (resolved.startsWith(path.resolve(BROKER_CERT_DIR) + path.sep)) fs.unlink(resolved, () => {});
      }
      console.error("[account-head] certificate upload error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });
});

// GET /:id/certificate/file — stream the certificate for inline preview/download
router.get("/:id/certificate/file", requirePageRight("account-head", "view"), async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const result = await getPool().request().input("id", sql.Int, id)
      .query("SELECT LHeadCertificateUrl, LHeadCertificateFileName FROM dbo.AccountHeadMaster WHERE LHeadId = @id");
    if (!result.recordset.length || !result.recordset[0].LHeadCertificateUrl) return res.status(404).json({ error: "Certificate not found" });
    const doc = result.recordset[0];

    const resolvedPath = path.resolve(doc.LHeadCertificateUrl);
    if (!resolvedPath.startsWith(path.resolve(BROKER_CERT_DIR) + path.sep)) return res.status(403).json({ error: "Access denied" });
    if (!fs.existsSync(resolvedPath)) return res.status(404).json({ error: "File not found on disk" });

    res.setHeader("Content-Disposition", `inline; filename="${doc.LHeadCertificateFileName || "certificate"}"`);
    fs.createReadStream(resolvedPath).pipe(res);
  } catch (e) {
    console.error("[account-head] certificate GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
