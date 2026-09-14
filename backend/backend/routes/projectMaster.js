const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const allowRoles = require("../middleware/role");
const { bumpCacheVersion } = require("../redis");
const { cache } = require("../middleware/cache");
const { deleteProjectCascade } = require("../services/projectCascadeDelete");
const { getProjectLockReason } = require("../services/crmHierarchyLocks");

const adminOnly = allowRoles("admin", "super_admin", "dba");

let _acctHeadHasLGSTType = null;
async function acctHeadHasLGSTType(pool) {
  if (_acctHeadHasLGSTType === null) {
    const r = await pool
      .request()
      .query(
        "SELECT COUNT(1) AS cnt FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.AccountHeadMaster') AND name = N'LGSTType'",
      );
    _acctHeadHasLGSTType = r.recordset[0].cnt > 0;
  }
  return _acctHeadHasLGSTType;
}

// ── Auto-create Customer + Supplier ledger heads for a project ────────────────
// Extracted so both POST / (new project) and PUT /:id (edit/re-save an
// existing project) can ensure a project has its trading ledger heads before
// it can participate in the Inter-Company Stock Transfer workflow. Projects
// (business_type='P') carry no GST of their own in this schema — GST/PAN/TAN
// live only on the parent Company row (see GET /company/:id below).
//
// A company can legitimately be GST-Unregistered (companyMaster.js's
// gst_type='Unregistered', gst_no intentionally NULL) — that's a valid real
// business state, not missing data, and such companies can still trade
// (invoices just carry no GST line). Only skip ledger-head creation when
// gst_type isn't explicitly 'Unregistered' AND gst_no is still empty, i.e.
// the compliance fields genuinely haven't been filled in yet. Idempotent:
// does nothing if the PRJ-{id}-CUST/SUPP heads already exist.
async function ensureProjectLedgerHeads(pool, projectId, projectName, address, createdBy) {
  if (!projectId) return;

  const projectRow = await pool
    .request()
    .input("id", sql.Int, projectId)
    .query("SELECT company_id FROM dbo.enterprise WHERE id=@id AND business_type='P'");
  const resolvedCompanyId = projectRow.recordset[0]?.company_id ?? null;

  if (!resolvedCompanyId) {
    console.warn(
      `[projectMaster] Skipped auto-creating trading ledger heads for project ${projectId}: no company_id set.`,
    );
    return;
  }

  const companyRow = await pool
    .request()
    .input("id", sql.Int, resolvedCompanyId)
    .query("SELECT gst_no, gst_type, pan_no, name FROM dbo.enterprise WHERE id=@id AND business_type='C'");
  const company = companyRow.recordset[0];

  if (!company) {
    console.warn(
      `[projectMaster] Skipped auto-creating trading ledger heads for project ${projectId}: parent company ${resolvedCompanyId} not found.`,
    );
    return;
  }

  const isUnregistered = company.gst_type === "Unregistered";
  if (!company.gst_no && !isUnregistered) {
    console.warn(
      `[projectMaster] Skipped auto-creating trading ledger heads for project ${projectId}: parent company ${resolvedCompanyId} has no GST status/number on file yet.`,
    );
    return;
  }

  const custCode = `PRJ-${projectId}-CUST`;
  const suppCode = `PRJ-${projectId}-SUPP`;
  const existingLedger = await pool
    .request()
    .input("c1", sql.NVarChar(20), custCode)
    .input("c2", sql.NVarChar(20), suppCode)
    .query("SELECT TOP 1 LHeadId FROM dbo.AccountHeadMaster WHERE LHeadCode IN (@c1, @c2)");

  if (existingLedger.recordset.length > 0) return;

  const ledgerName = `${projectName} (${company.name})`;
  const hasLGSTType = await acctHeadHasLGSTType(pool);

  for (const [lHeadType, lHeadCode] of [
    ["C", custCode],
    ["S", suppCode],
  ]) {
    const insertReq = pool
      .request()
      .input("LHeadName", sql.NVarChar(200), ledgerName)
      .input("LHeadCode", sql.NVarChar(20), lHeadCode)
      .input("LHeadAddress", sql.VarChar(300), address || "N/A")
      .input("LHeadContactPerson", sql.VarChar(100), "N/A")
      .input("LHeadStatus", sql.Bit, 1)
      .input("LHeadPaymentTerms", sql.NVarChar(100), "N/A")
      .input("LGST", sql.VarChar(20), isUnregistered ? null : company.gst_no)
      .input("LCountry", sql.VarChar(50), "India")
      .input("LHeadPan", sql.NVarChar(50), company.pan_no || null)
      .input("LHeadType", sql.VarChar(50), lHeadType)
      .input("Status", sql.NVarChar(20), "Approved")
      .input("ApprovedBy", sql.NVarChar(100), createdBy)
      .input("CreatedBy", sql.NVarChar(100), createdBy);

    const cols = [
      "LHeadName", "LHeadCode", "LHeadAddress", "LHeadContactPerson", "LHeadStatus",
      "LHeadPaymentTerms", "LGST", "LCountry", "LHeadPan", "LHeadType", "Status",
      "ApprovedBy", "ApprovedAt", "CreatedBy", "CreatedAt",
    ];
    const vals = [
      "@LHeadName", "@LHeadCode", "@LHeadAddress", "@LHeadContactPerson", "@LHeadStatus",
      "@LHeadPaymentTerms", "@LGST", "@LCountry", "@LHeadPan", "@LHeadType", "@Status",
      "@ApprovedBy", "SYSDATETIME()", "@CreatedBy", "SYSDATETIME()",
    ];
    if (hasLGSTType) {
      insertReq.input("LGSTType", sql.NVarChar(50), company.gst_type || (isUnregistered ? "Unregistered" : "Registered"));
      cols.push("LGSTType");
      vals.push("@LGSTType");
    }

    await insertReq.query(`
      INSERT INTO dbo.AccountHeadMaster (${cols.join(", ")})
      VALUES (${vals.join(", ")})
    `);
  }
  await bumpCacheVersion("account-head-master");
}

// ── GET all projects ──────────────────────────────────────────────────────────
router.get("/", cache("project-master", 60, { shared: true }), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT
        p.id                    AS Id,
        p.business_identity     AS Code,
        p.name                  AS Name,
        p.short_name            AS ShortName,
        p.entity_type           AS Type,
        p.description           AS Description,
        p.address               AS AddressLine1,
        p.address_line2         AS AddressLine2,
        p.address_line3         AS AddressLine3,
        p.pincode               AS ZipCode,
        p.latitude              AS Latitude,
        p.longitude             AS Longitude,
        p.currency              AS Currency,
        p.status                AS Status,
        p.rera_no               AS Priority,
        p.start_date            AS StartDate,
        p.end_date              AS EndDate,
        p.team_size             AS TeamSize,
        p.remarks               AS Remarks,
        CASE WHEN p.discontinue = 1 THEN 0 ELSE 1 END AS IsActive,
        p.logo                  AS ProjectImage,
        p.enterprise_id         AS EnterpriseId,
        e.name                  AS EnterpriseName,
        p.company_id            AS CompanyId,
        c.name                  AS CompanyName,
        c.gst_no                AS CompanyGST,
        c.gst_issue_date        AS CompanyGSTDate,
        c.pan_no                AS CompanyPAN,
        c.tan                   AS CompanyTAN,
        c.trade_license         AS CompanyTradeLicenseNo,
        ISNULL(p.jv_enabled, 0) AS JvEnabled,
        p.jv_company_name       AS JvCompanyName,
        p.date_of_entry         AS CreatedAt
      FROM dbo.enterprise p WITH (NOLOCK)
      LEFT JOIN dbo.enterprise e WITH (NOLOCK) ON e.id = p.enterprise_id
      LEFT JOIN dbo.enterprise c WITH (NOLOCK) ON c.id = p.company_id
      WHERE p.business_type = 'P'
      ORDER BY p.name
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /company/:id — fetch compliance fields from linked Company ─────────────
router.get("/company/:id", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("id", sql.Int, parseInt(req.params.id)).query(`
        SELECT
          id                  AS Id,
          name                AS Name,
          gst_no              AS GST,
          gst_issue_date      AS GSTDate,
          pan_no              AS PAN,
          tan                 AS TAN,
          trade_license       AS TradeLicenseNo
        FROM dbo.enterprise WITH (NOLOCK)
        WHERE id = @id AND business_type = 'C'
      `);
    if (!result.recordset.length)
      return res.status(404).json({ error: "Company not found" });
    res.json(result.recordset[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST — create project ─────────────────────────────────────────────────────
router.post("/", adminOnly, async (req, res) => {
  const f = req.body;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("name", sql.NVarChar(255), f.name || null)
      .input("short_name", sql.NVarChar(100), f.shortName || null)
      .input("business_identity", sql.NVarChar(100), f.code || null)
      .input("business_type", sql.NVarChar(10), "P")
      .input("entity_type", sql.NVarChar(50), f.type || null)
      .input("description", sql.NVarChar(sql.MAX), f.description || null)
      .input("address", sql.NVarChar(sql.MAX), f.addressLine1 || null)
      .input("address_line2", sql.NVarChar(500), f.addressLine2 || null)
      .input("address_line3", sql.NVarChar(500), f.addressLine3 || null)
      .input("pincode", sql.NVarChar(20), f.zipCode || null)
      .input(
        "latitude",
        sql.Decimal(10, 7),
        f.latitude ? parseFloat(f.latitude) : null,
      )
      .input(
        "longitude",
        sql.Decimal(10, 7),
        f.longitude ? parseFloat(f.longitude) : null,
      )
      .input("currency", sql.NVarChar(10), f.currency || "INR")
      .input("status", sql.NVarChar(50), f.status || "Planning")
      .input("rera_no", sql.NVarChar(100), f.priority || null)
      .input("start_date", sql.Date, f.startDate || null)
      .input("end_date", sql.Date, f.endDate || null)
      .input("team_size", sql.Int, f.teamSize ? parseInt(f.teamSize) : null)
      .input("remarks", sql.NVarChar(500), f.remarks || null)
      .input("logo", sql.NVarChar(sql.MAX), f.projectImage || null)
      // ── proper FK ids (replaces the old string-based belongs_to / b_sub_identity_type) ──
      .input(
        "enterprise_id",
        sql.Int,
        f.enterpriseId ? parseInt(f.enterpriseId) : null,
      )
      .input("company_id", sql.Int, f.companyId ? parseInt(f.companyId) : null)
      .input("jv_enabled", sql.Bit, f.jvEnabled ? 1 : 0)
      .input(
        "jv_company_name",
        sql.NVarChar(255),
        f.jvEnabled && f.jvCompanyName ? f.jvCompanyName : null,
      )
      .input("discontinue", sql.Bit, f.isActive ? 0 : 1)
      .input("date_of_entry", sql.Date, new Date()).query(`
        INSERT INTO dbo.enterprise (
          name, short_name, business_identity, business_type, entity_type, description,
          address, address_line2, address_line3, pincode, latitude, longitude,
          currency, status, rera_no, start_date, end_date, team_size, remarks,
          logo, enterprise_id, company_id,
          jv_enabled, jv_company_name, discontinue, date_of_entry
        ) VALUES (
          @name, @short_name, @business_identity, @business_type, @entity_type, @description,
          @address, @address_line2, @address_line3, @pincode, @latitude, @longitude,
          @currency, @status, @rera_no, @start_date, @end_date, @team_size, @remarks,
          @logo, @enterprise_id, @company_id,
          @jv_enabled, @jv_company_name, @discontinue, @date_of_entry
        )
      `);
    await bumpCacheVersion("enterprises");
    await bumpCacheVersion("project-master");

    // Auto-create a dedicated godown for this project
    try {
      const projectRow = await pool
        .request()
        .input("name", sql.NVarChar(255), f.name || null)
        .input("btype", sql.NVarChar(10), "P")
        .query(
          "SELECT TOP 1 id, company_id FROM dbo.enterprise WHERE name=@name AND business_type=@btype ORDER BY id DESC",
        );
      const newProjectId = projectRow.recordset[0]?.id;
      // Always derive the godown's EnterpriseID from the project's own
      // stored company_id column rather than trusting f.companyId from the
      // request body — the form may omit it, which previously left
      // EnterpriseID null/wrong and made the godown invisible in every
      // company/project filter (see migration 105-fix-godown-enterprise-id).
      const resolvedCompanyId =
        projectRow.recordset[0]?.company_id ??
        (f.companyId ? parseInt(f.companyId) : null);
      if (newProjectId) {
        const code = (f.code || f.name || "PRJ")
          .replace(/\s+/g, "_")
          .toUpperCase()
          .slice(0, 40);
        const godownCode = `PRJ-${code}-${newProjectId}`;
        const godownName = `${f.name} Godown`;
        // Only create if no godown already linked to this project
        const existing = await pool
          .request()
          .input("pid", sql.Int, newProjectId)
          .query(
            "SELECT TOP 1 GodownID FROM dbo.Godowns WHERE ProjectID=@pid AND IsDeleted=0",
          );
        if (existing.recordset.length === 0) {
          await pool
            .request()
            .input("GodownCode", sql.NVarChar(50), godownCode)
            .input("GodownName", sql.NVarChar(255), godownName)
            .input("ShortDesc", sql.NVarChar(100), f.shortName || f.name)
            .input("ProjectID", sql.Int, newProjectId)
            .input("EnterpriseID", sql.Int, resolvedCompanyId).query(`
              INSERT INTO dbo.Godowns (GodownCode, GodownName, ShortDesc, ProjectID, EnterpriseID, IsMain, IsActive, IsDeleted)
              VALUES (@GodownCode, @GodownName, @ShortDesc, @ProjectID, @EnterpriseID, 0, 1, 0)
            `);
        }
      }
    } catch (godownErr) {
      // Non-fatal — project was created, godown creation failed
      console.warn(
        "[projectMaster] Auto-godown creation failed:",
        godownErr.message,
      );
    }

    // Auto-create Customer + Supplier ledger heads representing this
    // project, so it can immediately participate in the Inter-Company
    // Stock Transfer workflow.
    try {
      const projectRow = await pool
        .request()
        .input("name", sql.NVarChar(255), f.name || null)
        .input("btype", sql.NVarChar(10), "P")
        .query(
          "SELECT TOP 1 id FROM dbo.enterprise WHERE name=@name AND business_type=@btype ORDER BY id DESC",
        );
      const newProjectId = projectRow.recordset[0]?.id;
      const createdBy = req.user?.name || req.user?.email || "system";
      await ensureProjectLedgerHeads(pool, newProjectId, f.name, f.addressLine1, createdBy);
    } catch (ledgerErr) {
      // Non-fatal — project was created, ledger-head creation failed
      console.warn(
        "[projectMaster] Auto-ledger-head creation failed:",
        ledgerErr.message,
      );
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT — update project ──────────────────────────────────────────────────────
router.put("/:id", adminOnly, async (req, res) => {
  const f = req.body;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("id", sql.Int, parseInt(req.params.id))
      .input("name", sql.NVarChar(255), f.name || null)
      .input("short_name", sql.NVarChar(100), f.shortName || null)
      .input("business_identity", sql.NVarChar(100), f.code || null)
      .input("entity_type", sql.NVarChar(50), f.type || null)
      .input("description", sql.NVarChar(sql.MAX), f.description || null)
      .input("address", sql.NVarChar(sql.MAX), f.addressLine1 || null)
      .input("address_line2", sql.NVarChar(500), f.addressLine2 || null)
      .input("address_line3", sql.NVarChar(500), f.addressLine3 || null)
      .input("pincode", sql.NVarChar(20), f.zipCode || null)
      .input(
        "latitude",
        sql.Decimal(10, 7),
        f.latitude ? parseFloat(f.latitude) : null,
      )
      .input(
        "longitude",
        sql.Decimal(10, 7),
        f.longitude ? parseFloat(f.longitude) : null,
      )
      .input("currency", sql.NVarChar(10), f.currency || "INR")
      .input("status", sql.NVarChar(50), f.status || "Planning")
      .input("rera_no", sql.NVarChar(100), f.priority || null)
      .input("start_date", sql.Date, f.startDate || null)
      .input("end_date", sql.Date, f.endDate || null)
      .input("team_size", sql.Int, f.teamSize ? parseInt(f.teamSize) : null)
      .input("remarks", sql.NVarChar(500), f.remarks || null)
      .input("logo", sql.NVarChar(sql.MAX), f.projectImage || null)
      // ── proper FK ids ──
      .input(
        "enterprise_id",
        sql.Int,
        f.enterpriseId ? parseInt(f.enterpriseId) : null,
      )
      .input("company_id", sql.Int, f.companyId ? parseInt(f.companyId) : null)
      .input("jv_enabled", sql.Bit, f.jvEnabled ? 1 : 0)
      .input(
        "jv_company_name",
        sql.NVarChar(255),
        f.jvEnabled && f.jvCompanyName ? f.jvCompanyName : null,
      )
      .input("discontinue", sql.Bit, f.isActive ? 0 : 1).query(`
        UPDATE dbo.enterprise SET
          name=@name, short_name=@short_name, business_identity=@business_identity,
          entity_type=@entity_type, description=@description,
          address=@address, address_line2=@address_line2, address_line3=@address_line3,
          pincode=@pincode, latitude=@latitude, longitude=@longitude,
          currency=@currency, status=@status, rera_no=@rera_no,
          start_date=@start_date, end_date=@end_date, team_size=@team_size, remarks=@remarks,
          logo=@logo, enterprise_id=@enterprise_id, company_id=@company_id,
          jv_enabled=@jv_enabled, jv_company_name=@jv_company_name,
          discontinue=@discontinue
        WHERE id=@id AND business_type='P'
      `);
    await bumpCacheVersion("enterprises");
    await bumpCacheVersion("project-master");

    // Keep this project's dedicated godown in sync if its company changed —
    // otherwise the godown silently drops out of company/project filters
    // (same root cause as migration 105-fix-godown-enterprise-id).
    try {
      const projectId = parseInt(req.params.id);
      const resolvedCompanyId = f.companyId ? parseInt(f.companyId) : null;
      await pool
        .request()
        .input("ProjectID", sql.Int, projectId)
        .input("EnterpriseID", sql.Int, resolvedCompanyId)
        .query(
          `UPDATE dbo.Godowns SET EnterpriseID=@EnterpriseID
           WHERE ProjectID=@ProjectID AND IsDeleted=0`,
        );
      await bumpCacheVersion("godowns");
    } catch (godownSyncErr) {
      console.warn(
        "[projectMaster] Godown EnterpriseID sync failed:",
        godownSyncErr.message,
      );
    }

    // Ensure this project's trading ledger heads exist — covers projects
    // created before this auto-creation logic existed (re-saving them via
    // this route is the documented way to backfill), and projects whose
    // company didn't have GST on file at creation time but does now.
    try {
      const projectId = parseInt(req.params.id, 10);
      const createdBy = req.user?.name || req.user?.email || "system";
      await ensureProjectLedgerHeads(pool, projectId, f.name, f.addressLine1, createdBy);
    } catch (ledgerErr) {
      console.warn(
        "[projectMaster] Auto-ledger-head creation failed:",
        ledgerErr.message,
      );
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE — blocked if project is linked to a company, enterprise, PO, WO, or GRN ──
router.delete("/:id", adminOnly, async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid project ID" });

  try {
    const pool = getPool();

    // 1. Check if the project itself has a parent company or enterprise set
    const projectRow = await pool
      .request()
      .input("id", sql.Int, id)
      .query(
        "SELECT id, name, enterprise_id, company_id FROM dbo.enterprise WHERE id=@id AND business_type='P'",
      );

    if (!projectRow.recordset.length)
      return res.status(404).json({ error: "Project not found" });

    const proj = projectRow.recordset[0];

    if (proj.enterprise_id || proj.company_id) {
      return res.status(409).json({
        error: "Cannot delete project",
        reason:
          "This project is linked to a parent " +
          [proj.enterprise_id && "enterprise", proj.company_id && "company"]
            .filter(Boolean)
            .join(" and ") +
          ". Unlink it first before deleting.",
      });
    }

    // 2. Check for any live Block/Unit/Parking Slot (or, defensively, a
    // stray Booking/Application) anywhere under this project — same shared
    // hierarchy-wide rule Block/Unit/Floor deletion already enforce
    // (see services/crmHierarchyLocks.js). A project full of live inventory
    // or an active booking can never be silently removed out from under it.
    const projectLockReason = await getProjectLockReason(pool, id);
    if (projectLockReason) {
      return res.status(409).json({
        error: "Cannot delete project",
        reason: `This project ${projectLockReason}. Delete/clear those first.`,
      });
    }

    // 3. Check for any Purchase Orders, Work Orders, or GRNs referencing this project
    const usageCheck = await pool.request().input("ProjectId", sql.Int, id)
      .query(`
      SELECT
        (SELECT COUNT(*) FROM dbo.PurchaseOrders   WHERE ProjectId = @ProjectId) AS POCount,
        (SELECT COUNT(*) FROM dbo.WorkOrderHeader        WHERE ProjectId = @ProjectId) AS WOCount,
        (SELECT COUNT(*) FROM dbo.GoodsReceiptNotes grn
           INNER JOIN dbo.PurchaseOrders po ON po.PurchaseOrderID = grn.POID
           WHERE po.ProjectId = @ProjectId)                                        AS GRNCount
    `);

    const { POCount, WOCount, GRNCount } = usageCheck.recordset[0];
    const linked = [];
    if (POCount > 0)
      linked.push(`${POCount} Purchase Order${POCount > 1 ? "s" : ""}`);
    if (WOCount > 0)
      linked.push(`${WOCount} Work Order${WOCount > 1 ? "s" : ""}`);
    if (GRNCount > 0) linked.push(`${GRNCount} GRN${GRNCount > 1 ? "s" : ""}`);

    if (linked.length > 0) {
      return res.status(409).json({
        error: "Cannot delete project",
        reason: `This project has ${linked.join(", ")} linked to it and cannot be deleted.`,
      });
    }

    // 4. Safe to delete
    await pool
      .request()
      .input("id", sql.Int, id)
      .query("DELETE FROM dbo.enterprise WHERE id=@id AND business_type='P'");

    await bumpCacheVersion("enterprises");
    await bumpCacheVersion("project-master");
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /:id/cascade — super_admin ONLY: wipes the project and every ────
// transactional record under it (see services/projectCascadeDelete.js for
// exactly what is and isn't included, and why). Deliberately gated with its
// own literal role check rather than `adminOnly` or `requirePageRight` — no
// rights-matrix toggle should ever be able to grant this to admin/dba/any
// other role, so the check can't be widened by a future rights change.
// The caller must re-type the exact project name as `confirmName` to guard
// against a stray click on something this irreversible.
router.delete("/:id/cascade", async (req, res) => {
  if ((req.user?.role || "").toLowerCase() !== "super_admin") {
    return res.status(403).json({
      error: "Only Super Admin can delete a project and its transactions.",
    });
  }

  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid project ID" });

  const { confirmName } = req.body || {};

  try {
    const pool = getPool();
    const projectRow = await pool
      .request()
      .input("id", sql.Int, id)
      .query(
        "SELECT id, name, company_id FROM dbo.enterprise WHERE id=@id AND business_type='P'",
      );

    if (!projectRow.recordset.length)
      return res.status(404).json({ error: "Project not found" });

    const project = projectRow.recordset[0];

    if (!confirmName || confirmName.trim() !== project.name) {
      return res.status(400).json({
        error: "Confirmation name does not match the project name.",
      });
    }

    // Same hierarchy-wide lock check as the normal DELETE /:id above — this
    // route is a deliberate super_admin "force delete everything" tool, but
    // a live booking/hold/application anywhere underneath is never
    // bypassable, by design: no role, confirmation, or flag skips this.
    const projectLockReason = await getProjectLockReason(pool, id);
    if (projectLockReason) {
      return res.status(409).json({
        error: `Cannot delete project — this project ${projectLockReason}. Delete/clear those first.`,
      });
    }

    const summary = await deleteProjectCascade(pool, id, project.name);

    // The project's own AccountHeadMaster ledger heads and TypeOfDoc rows
    // are intentionally left in place (see projectCascadeDelete.js) — only
    // the enterprise row itself is removed here, after everything under it.
    await pool
      .request()
      .input("id", sql.Int, id)
      .query("DELETE FROM dbo.enterprise WHERE id=@id AND business_type='P'");

    // Best-effort audit trail — the deletion itself already committed above,
    // so a failure here (e.g. migration 171 not yet applied on this DB)
    // must never turn an already-successful deletion into a reported 500.
    try {
      await pool
        .request()
        .input("ProjectId", sql.Int, id)
        .input("ProjectName", sql.NVarChar(255), project.name)
        .input("CompanyId", sql.Int, project.company_id || null)
        .input("DeletedBy", sql.NVarChar(255), req.user?.email || req.user?.name || "unknown")
        .input("SummaryJson", sql.NVarChar(sql.MAX), JSON.stringify(summary)).query(`
          INSERT INTO dbo.ProjectDeletionLog (ProjectId, ProjectName, CompanyId, DeletedBy, SummaryJson)
          VALUES (@ProjectId, @ProjectName, @CompanyId, @DeletedBy, @SummaryJson)
        `);
    } catch (auditErr) {
      console.error(
        `[projectMaster] Project ${id} (${project.name}) was deleted successfully, but writing to ProjectDeletionLog failed (non-fatal):`,
        auditErr.message,
      );
    }

    await Promise.all([
      bumpCacheVersion("enterprises"),
      bumpCacheVersion("project-master"),
      bumpCacheVersion("account-head-master"),
    ]);

    res.json({ success: true, deleted: summary });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.ensureProjectLedgerHeads = ensureProjectLedgerHeads;
