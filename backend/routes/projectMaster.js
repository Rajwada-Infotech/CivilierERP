const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const allowRoles = require("../middleware/role");
const { bumpCacheVersion } = require("../redis");
const { cache } = require("../middleware/cache");

const adminOnly = allowRoles("admin", "super_admin", "dba");

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
    // Stock Transfer workflow. Projects (business_type='P') carry no GST
    // of their own in this schema — GST/PAN/TAN live only on the parent
    // Company row (see GET /company/:id above) — so a project whose
    // company has no gst_no on file is skipped with a warning rather than
    // fabricating compliance data.
    try {
      const projectRow = await pool
        .request()
        .input("name", sql.NVarChar(255), f.name || null)
        .input("btype", sql.NVarChar(10), "P")
        .query(
          "SELECT TOP 1 id, company_id FROM dbo.enterprise WHERE name=@name AND business_type=@btype ORDER BY id DESC",
        );
      const newProjectId = projectRow.recordset[0]?.id;
      const resolvedCompanyId =
        projectRow.recordset[0]?.company_id ??
        (f.companyId ? parseInt(f.companyId) : null);

      if (newProjectId && resolvedCompanyId) {
        const companyRow = await pool
          .request()
          .input("id", sql.Int, resolvedCompanyId)
          .query(
            "SELECT gst_no, pan_no, name FROM dbo.enterprise WHERE id=@id AND business_type='C'",
          );
        const company = companyRow.recordset[0];

        if (company?.gst_no) {
          const custCode = `PRJ-${newProjectId}-CUST`;
          const suppCode = `PRJ-${newProjectId}-SUPP`;
          const existingLedger = await pool
            .request()
            .input("c1", sql.NVarChar(20), custCode)
            .input("c2", sql.NVarChar(20), suppCode)
            .query(
              "SELECT TOP 1 LHeadId FROM dbo.AccountHeadMaster WHERE LHeadCode IN (@c1, @c2)",
            );

          if (existingLedger.recordset.length === 0) {
            const ledgerName = `${f.name} (${company.name})`;
            const createdBy = req.user?.name || req.user?.email || "system";

            for (const [lHeadType, lHeadCode] of [
              ["C", custCode],
              ["S", suppCode],
            ]) {
              await pool
                .request()
                .input("LHeadName", sql.NVarChar(200), ledgerName)
                .input("LHeadCode", sql.NVarChar(20), lHeadCode)
                .input("LHeadAddress", sql.VarChar(300), f.addressLine1 || "N/A")
                .input("LHeadContactPerson", sql.VarChar(100), "N/A")
                .input("LHeadStatus", sql.Bit, 1)
                .input("LHeadPaymentTerms", sql.NVarChar(100), "N/A")
                .input("LGST", sql.VarChar(20), company.gst_no)
                .input("LCountry", sql.VarChar(50), "India")
                .input("LHeadPan", sql.NVarChar(50), company.pan_no || null)
                .input("LHeadType", sql.VarChar(50), lHeadType)
                .input("Status", sql.NVarChar(20), "Approved")
                .input("ApprovedBy", sql.NVarChar(100), createdBy)
                .input("CreatedBy", sql.NVarChar(100), createdBy).query(`
                  INSERT INTO dbo.AccountHeadMaster
                    (LHeadName, LHeadCode, LHeadAddress, LHeadContactPerson, LHeadStatus,
                     LHeadPaymentTerms, LGST, LCountry, LHeadPan, LHeadType, Status,
                     ApprovedBy, ApprovedAt, CreatedBy, CreatedAt)
                  VALUES
                    (@LHeadName, @LHeadCode, @LHeadAddress, @LHeadContactPerson, @LHeadStatus,
                     @LHeadPaymentTerms, @LGST, @LCountry, @LHeadPan, @LHeadType, @Status,
                     @ApprovedBy, SYSDATETIME(), @CreatedBy, SYSDATETIME())
                `);
            }
            await bumpCacheVersion("account-head-master");
          }
        } else {
          console.warn(
            `[projectMaster] Skipped auto-creating trading ledger heads for project ${newProjectId}: parent company ${resolvedCompanyId} has no GST on file.`,
          );
        }
      } else if (newProjectId) {
        console.warn(
          `[projectMaster] Skipped auto-creating trading ledger heads for project ${newProjectId}: no company_id set.`,
        );
      }
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

    // 2. Check for any Purchase Orders, Work Orders, or GRNs referencing this project
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

    // 3. Safe to delete
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

module.exports = router;
