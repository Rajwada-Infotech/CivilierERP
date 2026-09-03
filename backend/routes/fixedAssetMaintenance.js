const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests" } }));

const { getPool, sql } = require("../db");
const authenticateToken = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { bumpCacheVersion } = require("../redis");
const {
  resolveDocTypeId, lockNextDocNumber, previewNextDocNumber, backPatchRecordId,
} = require("../utils/docNumberLock");
const {
  buildPostingPlan, postMaintenance, reverseMaintenancePosting, resolveGstConfig,
} = require("../services/fixedAssetMaintenancePosting");

const DOC_PREFIX = "FAMR";

// SAC code + resolved GST rate for an FA record, for the pickers/preview.
// Rate mirrors resolveGstConfig(): CGST+SGST, or IGST when only that is set.
const SAC_GST_SELECT = `
  fa.RepairType AS SacCode,
  hsn.HShortDescription AS SacDescription,
  CASE
    WHEN NULLIF(ISNULL(hsn.HCGST,0) + ISNULL(hsn.HSGST,0), 0) IS NOT NULL
      THEN ISNULL(hsn.HCGST,0) + ISNULL(hsn.HSGST,0)
    ELSE hsn.HIGST
  END AS GstRatePct`;
const SAC_GST_JOIN = `
  LEFT JOIN dbo.HSN hsn
    ON hsn.HCode = fa.RepairType AND ISNULL(hsn.HIsSAC,0) = 1 AND ISNULL(hsn.HStatus,1) = 1`;

/**
 * GST snapshot for persisting on the record. Draft-friendly: when the SAC
 * code / rate isn't configured yet it returns zero GST rather than throwing,
 * so a Draft can still be saved — the hard gate is at posting time
 * (buildPostingPlan / postMaintenance).
 */
async function computeGstSnapshot(pool, assetId, amount) {
  const taxable = Math.round((Number(amount) || 0) * 100) / 100;
  try {
    const cfg = await resolveGstConfig(pool, assetId);
    const gstAmount = Math.round(taxable * cfg.ratePct) / 100;
    return {
      sacCode: cfg.sacCode,
      gstRatePct: cfg.ratePct,
      taxableAmount: taxable,
      gstAmount,
      totalAmount: Math.round((taxable + gstAmount) * 100) / 100,
    };
  } catch (e) {
    if (e.code !== "CONFIG_MISSING") throw e;
    return { sacCode: null, gstRatePct: null, taxableAmount: taxable, gstAmount: 0, totalAmount: taxable };
  }
}

router.use(authenticateToken);

const PAGE = "fixed-asset-maintenance";
const REPAIR_TYPES = ["Direct", "Indirect"];

function requireUser(req, res) {
  const email = req.user?.email || req.user?.name;
  if (!email) { res.status(401).json({ error: "User context missing" }); return null; }
  return email;
}
function toInt(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ── GET /assets — valid, active FA Item Code records for the pickers ─────────
router.get("/assets", requirePageRight(PAGE, "view"), async (req, res) => {
  try {
    const pool = getPool();
    const request = pool.request();
    const where = [
      "fa.Status <> 'Deleted'",
      "fa.AssetStatus = 'Active'",
      "fa.FAItemCode IS NOT NULL",
      "fa.AssetCode IS NOT NULL",
    ];
    if (req.query.companyId) { request.input("CompanyId", sql.Int, parseInt(req.query.companyId, 10)); where.push("fa.CompanyId = @CompanyId"); }
    if (req.query.projectId) { request.input("ProjectId", sql.Int, parseInt(req.query.projectId, 10)); where.push("fa.ProjectId = @ProjectId"); }
    const result = await request.query(`
      SELECT fa.AssetId, fa.FAItemCode, fa.AssetName, fa.AssetCategory,
             fa.CompanyId, fa.ProjectId, fa.FinYear,
             ${SAC_GST_SELECT}
      FROM dbo.FixedAssetRecord fa
      ${SAC_GST_JOIN}
      WHERE ${where.join(" AND ")}
      ORDER BY fa.AssetName, fa.FAItemCode
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[faMaintenance] GET /assets:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /vendors — active ledger heads usable as a vendor ───────────────────
router.get("/vendors", requirePageRight(PAGE, "view"), async (_req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT LHeadId AS id, ISNULL(DisplayName, LHeadName) AS label, LHeadCode AS code, LHeadType AS type
      FROM dbo.AccountHeadMaster
      WHERE ISNULL(LHeadStatus, 1) = 1 AND LHeadType IN ('S', 'C', 'CN', 'B', 'GL')
      ORDER BY label
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[faMaintenance] GET /vendors:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /fa-item-codes — active FA Item Codes for a selected Item ───────────
// FA Item Code MUST be filtered by the selected Item Selection (AssetName);
// it never lists every Fixed Asset code. Same "valid + active" filter as
// /assets. Returns [] when the Item has no code (frontend shows a message).
router.get("/fa-item-codes", requirePageRight(PAGE, "view"), async (req, res) => {
  const itemName = (req.query.itemName || "").trim();
  if (!itemName) return res.json([]);
  try {
    const pool = getPool();
    const request = pool.request().input("ItemName", sql.NVarChar(200), itemName);
    const where = [
      "fa.Status <> 'Deleted'",
      "fa.AssetStatus = 'Active'",
      "fa.FAItemCode IS NOT NULL",
      "fa.AssetCode IS NOT NULL",
      "fa.AssetName = @ItemName",
    ];
    if (req.query.companyId) { request.input("CompanyId", sql.Int, parseInt(req.query.companyId, 10)); where.push("fa.CompanyId = @CompanyId"); }
    if (req.query.projectId) { request.input("ProjectId", sql.Int, parseInt(req.query.projectId, 10)); where.push("fa.ProjectId = @ProjectId"); }
    const result = await request.query(`
      SELECT fa.AssetId, fa.FAItemCode, fa.AssetName, fa.AssetCategory,
             fa.CompanyId, fa.ProjectId, fa.FinYear,
             ${SAC_GST_SELECT}
      FROM dbo.FixedAssetRecord fa
      ${SAC_GST_JOIN}
      WHERE ${where.join(" AND ")}
      ORDER BY fa.FAItemCode
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[faMaintenance] GET /fa-item-codes:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /next-number — preview the next auto Doc Number (no lock) ───────────
router.get("/next-number", requirePageRight(PAGE, "view"), async (req, res) => {
  try {
    const pool = getPool();
    const docTypeId = await resolveDocTypeId(pool, sql, DOC_PREFIX);
    const preview = await previewNextDocNumber(pool, sql, docTypeId, req.query.finYear || null);
    res.json(preview);
  } catch (err) {
    console.error("[faMaintenance] GET /next-number:", err.message);
    res.status(500).json({ error: "Failed to preview next document number" });
  }
});

const LIST_SELECT = `
  SELECT m.MaintenanceId, m.DocNo, m.DocDate, m.FinYear, m.CompanyId, m.ProjectId,
         m.AssetId, m.FAItemCode, m.ItemName,
         m.VendorId, m.VendorName, m.RepairExpenseType, m.Amount, m.Remarks,
         m.SacCode, m.GstRatePct, m.TaxableAmount, m.GstAmount, m.TotalAmount,
         m.Status, m.VoucherNo, m.PostedBy, m.PostedAt,
         m.CreatedBy, m.CreatedAt, m.UpdatedBy, m.UpdatedAt,
         co.name AS CompanyName, pr.name AS ProjectName,
         fa.AssetCode, fa.AssetName AS AssetRecordName
  FROM dbo.FixedAssetMaintenance m
  LEFT JOIN dbo.enterprise co ON co.id = m.CompanyId
  LEFT JOIN dbo.enterprise pr ON pr.id = m.ProjectId
  LEFT JOIN dbo.FixedAssetRecord fa ON fa.AssetId = m.AssetId
`;

// ── GET / — list ───────────────────────────────────────────────────────────
router.get("/", requirePageRight(PAGE, "view"), async (req, res) => {
  try {
    const pool = getPool();
    const request = pool.request();
    const where = ["m.Status <> 'Cancelled'"];
    if (req.query.companyId) { request.input("CompanyId", sql.Int, parseInt(req.query.companyId, 10)); where.push("m.CompanyId = @CompanyId"); }
    if (req.query.projectId) { request.input("ProjectId", sql.Int, parseInt(req.query.projectId, 10)); where.push("m.ProjectId = @ProjectId"); }
    if (req.query.assetId)   { request.input("AssetId", sql.Int, parseInt(req.query.assetId, 10)); where.push("m.AssetId = @AssetId"); }
    if (req.query.status)    { request.input("Status", sql.NVarChar(20), req.query.status); where.push("m.Status = @Status"); }
    const result = await request.query(`${LIST_SELECT} WHERE ${where.join(" AND ")} ORDER BY m.CreatedAt DESC`);
    res.json(result.recordset);
  } catch (err) {
    console.error("[faMaintenance] GET /:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:id ───────────────────────────────────────────────────────────────
router.get("/:id", requirePageRight(PAGE, "view"), async (req, res) => {
  const id = toInt(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const result = await pool.request().input("Id", sql.Int, id).query(`${LIST_SELECT} WHERE m.MaintenanceId = @Id`);
    if (!result.recordset.length) return res.status(404).json({ error: "Not found" });

    const row = result.recordset[0];
    let posting = null;
    try {
      posting = await buildPostingPlan(pool, row);
    } catch (e) {
      posting = { error: e.message };
    }
    res.json({ ...row, posting });
  } catch (err) {
    console.error("[faMaintenance] GET /:id:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:id/posting-preview ───────────────────────────────────────────────
router.get("/:id/posting-preview", requirePageRight(PAGE, "view"), async (req, res) => {
  const id = toInt(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const r = await pool.request().input("Id", sql.Int, id)
      .query(`SELECT * FROM dbo.FixedAssetMaintenance WHERE MaintenanceId = @Id`);
    if (!r.recordset.length) return res.status(404).json({ error: "Not found" });
    const plan = await buildPostingPlan(pool, r.recordset[0]);
    res.json(plan);
  } catch (err) {
    const status = err.code === "CONFIG_MISSING" ? 409 : 500;
    res.status(status).json({ error: err.message });
  }
});

// ── shared validation ──────────────────────────────────────────────────────
async function validateBody(pool, b) {
  if (!toInt(b.companyId)) return "Company is mandatory";
  if (!toInt(b.projectId)) return "Project is mandatory";
  if (!b.docDate) return "Doc Date is mandatory";
  if (!b.itemName || !String(b.itemName).trim()) return "Item Selection is mandatory";
  if (!toInt(b.assetId)) return "FA Item Code is mandatory";
  if (!toInt(b.vendorId)) return "Vendor is mandatory";
  if (!REPAIR_TYPES.includes(b.repairExpenseType)) return "Repair Expense Type must be Direct or Indirect";
  const amt = Number(b.amount);
  if (!Number.isFinite(amt) || amt <= 0) return "Amount must be greater than zero";

  // Only valid / active Fixed Asset records are selectable
  const faRes = await pool.request().input("AssetId", sql.Int, toInt(b.assetId)).query(`
    SELECT AssetId, FAItemCode, AssetName, CompanyId, ProjectId, FinYear, AssetStatus, Status
    FROM dbo.FixedAssetRecord
    WHERE AssetId = @AssetId
  `);
  const fa = faRes.recordset[0];
  if (!fa || fa.Status === "Deleted" || fa.AssetStatus !== "Active" || !fa.FAItemCode) {
    return "The selected Fixed Asset is invalid or inactive";
  }

  // The chosen FA Item Code must belong to the chosen Item Selection —
  // enforced here so a mismatched pair can never be posted.
  if (String(fa.AssetName).trim() !== String(b.itemName).trim()) {
    return "The selected FA Item Code does not belong to the selected Item";
  }

  // Company / Project on the transaction must match the asset's own
  if (fa.CompanyId != null && toInt(b.companyId) !== fa.CompanyId) {
    return "The selected FA Item Code belongs to a different Company";
  }
  if (fa.ProjectId != null && toInt(b.projectId) !== fa.ProjectId) {
    return "The selected FA Item Code belongs to a different Project";
  }

  return { fa };
}

// ── POST / — create (Draft) ────────────────────────────────────────────────
router.post("/", requirePageRight(PAGE, "create"), async (req, res) => {
  const email = requireUser(req, res);
  if (!email) return;
  try {
    const pool = getPool();
    const check = await validateBody(pool, req.body);
    if (typeof check === "string") return res.status(400).json({ error: check });
    const { fa } = check;
    const b = req.body;

    const vendorRes = await pool.request().input("Id", sql.Int, toInt(b.vendorId))
      .query(`SELECT ISNULL(DisplayName, LHeadName) AS Name FROM dbo.AccountHeadMaster WHERE LHeadId = @Id`);
    const vendorName = vendorRes.recordset[0]?.Name || null;

    // Doc Number is system-generated — reuses the shared doc-number engine
    // (atomic lock + retry on collision), never taken from the request body.
    const finYear = fa.FinYear || null;
    const docTypeId = await resolveDocTypeId(pool, sql, DOC_PREFIX);
    const docNo = await lockNextDocNumber(pool, sql, {
      docTypeId, finYear, tableName: "FixedAssetMaintenance", issuedBy: email,
    });

    const gst = await computeGstSnapshot(pool, fa.AssetId, b.amount);

    const ins = await pool.request()
      .input("DocNo",             sql.NVarChar(100), docNo)
      .input("DocDate",           sql.Date, b.docDate)
      .input("FinYear",           sql.NVarChar(20), finYear)
      .input("CompanyId",         sql.Int, toInt(b.companyId))
      .input("ProjectId",         sql.Int, toInt(b.projectId))
      .input("AssetId",           sql.Int, fa.AssetId)
      .input("FAItemCode",        sql.NVarChar(200), fa.FAItemCode)
      .input("ItemName",          sql.NVarChar(200), fa.AssetName)
      .input("VendorId",          sql.Int, toInt(b.vendorId))
      .input("VendorName",        sql.NVarChar(200), vendorName)
      .input("RepairExpenseType", sql.NVarChar(20), b.repairExpenseType)
      .input("Amount",            sql.Decimal(18, 2), Number(b.amount))
      .input("SacCode",           sql.NVarChar(50), gst.sacCode)
      .input("GstRatePct",        sql.Decimal(9, 4), gst.gstRatePct)
      .input("TaxableAmount",     sql.Decimal(18, 2), gst.taxableAmount)
      .input("GstAmount",         sql.Decimal(18, 2), gst.gstAmount)
      .input("TotalAmount",       sql.Decimal(18, 2), gst.totalAmount)
      .input("Remarks",           sql.NVarChar(sql.MAX), b.remarks || null)
      .input("CreatedBy",         sql.NVarChar(200), email)
      .query(`
        INSERT INTO dbo.FixedAssetMaintenance
          (DocNo, DocDate, FinYear, CompanyId, ProjectId, AssetId, FAItemCode, ItemName,
           VendorId, VendorName, RepairExpenseType, Amount,
           SacCode, GstRatePct, TaxableAmount, GstAmount, TotalAmount,
           Remarks, Status, CreatedBy, CreatedAt)
        OUTPUT INSERTED.MaintenanceId
        VALUES
          (@DocNo, @DocDate, @FinYear, @CompanyId, @ProjectId, @AssetId, @FAItemCode, @ItemName,
           @VendorId, @VendorName, @RepairExpenseType, @Amount,
           @SacCode, @GstRatePct, @TaxableAmount, @GstAmount, @TotalAmount,
           @Remarks, 'Draft', @CreatedBy, SYSDATETIME())
      `);
    const newId = ins.recordset[0].MaintenanceId;
    await backPatchRecordId(pool, sql, docNo, "FixedAssetMaintenance", newId);
    await bumpCacheVersion("fixed-asset-maintenance");
    res.json({ maintenanceId: newId, docNo });
  } catch (err) {
    console.error("[faMaintenance] POST /:", err.message);
    res.status(400).json({ error: err.message });
  }
});

// ── PUT /:id — edit. Editing a Posted record reverses its GL voucher and
//    returns it to Draft (the client can then re-post via /:id/post). ───────
router.put("/:id", requirePageRight(PAGE, "edit"), async (req, res) => {
  const email = requireUser(req, res);
  if (!email) return;
  const id = toInt(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const cur = await pool.request().input("Id", sql.Int, id)
      .query(`SELECT Status FROM dbo.FixedAssetMaintenance WHERE MaintenanceId = @Id`);
    if (!cur.recordset.length) return res.status(404).json({ error: "Not found" });
    if (cur.recordset[0].Status === "Cancelled")
      return res.status(409).json({ error: "Cancelled records cannot be edited." });

    const wasPosted = cur.recordset[0].Status === "Posted";
    if (wasPosted) {
      // Reverse the existing accounting entry before applying the edit; the
      // record drops back to Draft.
      await reverseMaintenancePosting(pool, id);
      await pool.request().input("Id", sql.Int, id).input("By", sql.NVarChar(200), email).query(`
        UPDATE dbo.FixedAssetMaintenance
        SET Status = 'Draft', VoucherNo = NULL, PostedBy = NULL, PostedAt = NULL,
            UpdatedBy = @By, UpdatedAt = SYSDATETIME()
        WHERE MaintenanceId = @Id
      `);
      await bumpCacheVersion("general-ledger");
    }

    const check = await validateBody(pool, req.body);
    if (typeof check === "string") return res.status(400).json({ error: check });
    const { fa } = check;
    const b = req.body;

    const vendorRes = await pool.request().input("Id", sql.Int, toInt(b.vendorId))
      .query(`SELECT ISNULL(DisplayName, LHeadName) AS Name FROM dbo.AccountHeadMaster WHERE LHeadId = @Id`);
    const vendorName = vendorRes.recordset[0]?.Name || null;

    const gst = await computeGstSnapshot(pool, fa.AssetId, b.amount);

    // DocNo is system-generated and immutable — never updated here.
    await pool.request()
      .input("Id",                sql.Int, id)
      .input("DocDate",           sql.Date, b.docDate)
      .input("FinYear",           sql.NVarChar(20), b.finYear || fa.FinYear || null)
      .input("CompanyId",         sql.Int, toInt(b.companyId))
      .input("ProjectId",         sql.Int, toInt(b.projectId))
      .input("AssetId",           sql.Int, fa.AssetId)
      .input("FAItemCode",        sql.NVarChar(200), fa.FAItemCode)
      .input("ItemName",          sql.NVarChar(200), fa.AssetName)
      .input("VendorId",          sql.Int, toInt(b.vendorId))
      .input("VendorName",        sql.NVarChar(200), vendorName)
      .input("RepairExpenseType", sql.NVarChar(20), b.repairExpenseType)
      .input("Amount",            sql.Decimal(18, 2), Number(b.amount))
      .input("SacCode",           sql.NVarChar(50), gst.sacCode)
      .input("GstRatePct",        sql.Decimal(9, 4), gst.gstRatePct)
      .input("TaxableAmount",     sql.Decimal(18, 2), gst.taxableAmount)
      .input("GstAmount",         sql.Decimal(18, 2), gst.gstAmount)
      .input("TotalAmount",       sql.Decimal(18, 2), gst.totalAmount)
      .input("Remarks",           sql.NVarChar(sql.MAX), b.remarks || null)
      .input("UpdatedBy",         sql.NVarChar(200), email)
      .query(`
        UPDATE dbo.FixedAssetMaintenance SET
          DocDate = @DocDate, FinYear = @FinYear,
          CompanyId = @CompanyId, ProjectId = @ProjectId, AssetId = @AssetId,
          FAItemCode = @FAItemCode, ItemName = @ItemName,
          VendorId = @VendorId, VendorName = @VendorName,
          RepairExpenseType = @RepairExpenseType, Amount = @Amount,
          SacCode = @SacCode, GstRatePct = @GstRatePct, TaxableAmount = @TaxableAmount,
          GstAmount = @GstAmount, TotalAmount = @TotalAmount,
          Remarks = @Remarks,
          UpdatedBy = @UpdatedBy, UpdatedAt = SYSDATETIME()
        WHERE MaintenanceId = @Id AND Status = 'Draft'
      `);
    await bumpCacheVersion("fixed-asset-maintenance");
    res.json({ ok: true, wasPosted });
  } catch (err) {
    console.error("[faMaintenance] PUT /:id:", err.message);
    res.status(400).json({ error: err.message });
  }
});

// ── POST /:id/post — generate the GL voucher, mark Posted ───────────────────
router.post("/:id/post", requirePageRight(PAGE, "edit"), async (req, res) => {
  const email = requireUser(req, res);
  if (!email) return;
  const id = toInt(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const r = await pool.request().input("Id", sql.Int, id)
      .query(`SELECT * FROM dbo.FixedAssetMaintenance WHERE MaintenanceId = @Id`);
    if (!r.recordset.length) return res.status(404).json({ error: "Not found" });
    const rec = r.recordset[0];
    if (rec.Status === "Cancelled") return res.status(409).json({ error: "This record is cancelled" });

    const result = await postMaintenance(pool, rec, email);
    const g = result.gst || {};

    await pool.request()
      .input("Id", sql.Int, id)
      .input("VoucherNo", sql.NVarChar(50), result.voucherNo)
      .input("SacCode", sql.NVarChar(50), g.sacCode ?? null)
      .input("GstRatePct", sql.Decimal(9, 4), g.ratePct ?? null)
      .input("TaxableAmount", sql.Decimal(18, 2), g.taxableAmount ?? null)
      .input("GstAmount", sql.Decimal(18, 2), g.gstAmount ?? null)
      .input("TotalAmount", sql.Decimal(18, 2), g.totalAmount ?? null)
      .input("By", sql.NVarChar(200), email)
      .query(`
        UPDATE dbo.FixedAssetMaintenance
        SET Status = 'Posted', VoucherNo = @VoucherNo,
            SacCode = ISNULL(@SacCode, SacCode),
            GstRatePct = ISNULL(@GstRatePct, GstRatePct),
            TaxableAmount = ISNULL(@TaxableAmount, TaxableAmount),
            GstAmount = ISNULL(@GstAmount, GstAmount),
            TotalAmount = ISNULL(@TotalAmount, TotalAmount),
            PostedBy = @By, PostedAt = SYSDATETIME(),
            UpdatedBy = @By, UpdatedAt = SYSDATETIME()
        WHERE MaintenanceId = @Id
      `);
    await bumpCacheVersion("fixed-asset-maintenance");
    await bumpCacheVersion("general-ledger");
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error("[faMaintenance] POST /:id/post:", err.message);
    const status = err.code === "CONFIG_MISSING" ? 409 : 500;
    res.status(status).json({ error: err.message });
  }
});

// ── DELETE /:id — Draft: cancel. Posted: reverse GL then cancel ─────────────
router.delete("/:id", requirePageRight(PAGE, "delete"), async (req, res) => {
  const email = requireUser(req, res);
  if (!email) return;
  const id = toInt(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const r = await pool.request().input("Id", sql.Int, id)
      .query(`SELECT MaintenanceId, Status FROM dbo.FixedAssetMaintenance WHERE MaintenanceId = @Id`);
    if (!r.recordset.length) return res.status(404).json({ error: "Not found" });
    if (r.recordset[0].Status === "Cancelled") return res.json({ ok: true });

    if (r.recordset[0].Status === "Posted") {
      await reverseMaintenancePosting(pool, id);
    }
    await pool.request()
      .input("Id", sql.Int, id).input("By", sql.NVarChar(200), email)
      .query(`UPDATE dbo.FixedAssetMaintenance
              SET Status = 'Cancelled', UpdatedBy = @By, UpdatedAt = SYSDATETIME()
              WHERE MaintenanceId = @Id`);
    await bumpCacheVersion("fixed-asset-maintenance");
    await bumpCacheVersion("general-ledger");
    res.json({ ok: true });
  } catch (err) {
    console.error("[faMaintenance] DELETE /:id:", err.message);
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
