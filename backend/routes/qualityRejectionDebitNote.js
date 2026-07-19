/**
 * backend/routes/qualityRejectionDebitNote.js
 *
 * Quality Rejection Debit Note — raised by the buyer against a specific
 * Vehicle In/Out received-item line when inspection finds some or all of
 * the delivered quantity is below the ordered grade (e.g. ordered Grade A
 * steel, 20 of 100 tonnes received turn out inferior on inspection).
 * Records the rejected quantity, the resulting bad-quality percentage, and
 * debits the supplier for that quantity at the PO rate. The Supplier
 * Portal reads the same rows and shows them to the supplier as a Credit
 * Note (their side of the same transaction).
 *
 * Prefix  : /api/quality-debit-note
 * DocType : QDN  (QDN-2026-00001)
 * Table   : dbo.QualityRejectionDebitNote
 * Perms   : reuses the "vehicle-in-out" page key — a debit note is raised
 *           from within a Vehicle In/Out entry, not its own module.
 */

"use strict";

const express = require("express");
const rateLimit = require("express-rate-limit");
const router = express.Router();
router.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    validate: false,
    message: { error: "Too many requests, please try again later." },
  }),
);

const { getPool, sql } = require("../db");
const { requirePageRight } = require("../middleware/requirePageRight");
const {
  resolveDocTypeId,
  lockNextDocNumber,
  backPatchRecordId,
} = require("../utils/docNumberLock");

function userEmail(req) {
  return req.user?.email || req.user?.userEmail || "system";
}

// ── GET / — list, filterable by company/project/supplier/vehicle-in-out ────
router.get("/", requirePageRight("vehicle-in-out", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const { companyId, projectId, supplierId, vehicleInOutId, status } = req.query;

    const conditions = ["1=1"];
    const request = pool.request();
    if (companyId) { conditions.push("q.CompanyID = @companyId"); request.input("companyId", sql.Int, parseInt(companyId, 10)); }
    if (projectId) { conditions.push("q.ProjectID = @projectId"); request.input("projectId", sql.Int, parseInt(projectId, 10)); }
    if (supplierId) { conditions.push("q.SupplierID = @supplierId"); request.input("supplierId", sql.Int, parseInt(supplierId, 10)); }
    if (vehicleInOutId) { conditions.push("q.VehicleInOutID = @vehicleInOutId"); request.input("vehicleInOutId", sql.Int, parseInt(vehicleInOutId, 10)); }
    if (status) { conditions.push("q.Status = @status"); request.input("status", sql.NVarChar(30), status); }

    const result = await request.query(`
      SELECT
        q.*,
        v.DocNo AS VehicleInOutDocNo, v.PONumber, v.VehicleNo,
        c.Name AS CompanyName, p.Name AS ProjectName
      FROM dbo.QualityRejectionDebitNote q
      LEFT JOIN dbo.VehicleInOut v ON v.VehicleInOutID = q.VehicleInOutID
      LEFT JOIN dbo.enterprise c ON c.id = q.CompanyID
      LEFT JOIN dbo.enterprise p ON p.id = q.ProjectID
      WHERE ${conditions.join(" AND ")}
      ORDER BY q.CreatedAt DESC
    `);
    res.json({ data: result.recordset });
  } catch (err) {
    console.error("Quality debit note list error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:id ─────────────────────────────────────────────────────────────────
router.get("/:id", requirePageRight("vehicle-in-out", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: "Invalid id" });
    const result = await pool.request().input("Id", sql.Int, id).query(`
      SELECT q.*, v.DocNo AS VehicleInOutDocNo, v.PONumber, v.VehicleNo
      FROM dbo.QualityRejectionDebitNote q
      LEFT JOIN dbo.VehicleInOut v ON v.VehicleInOutID = q.VehicleInOutID
      WHERE q.DebitNoteId = @Id
    `);
    if (!result.recordset.length) return res.status(404).json({ error: "Not found" });
    res.json(result.recordset[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST / — raise a debit note against a received line ────────────────────
router.post("/", requirePageRight("vehicle-in-out", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const { vehicleInOutItemId, rejectedQty, rate: rateOverride, reason } = req.body;

    const itemId = parseInt(vehicleInOutItemId, 10);
    const qtyBad = Number(rejectedQty);
    if (!itemId) return res.status(400).json({ error: "vehicleInOutItemId is required" });
    if (!(qtyBad > 0)) return res.status(400).json({ error: "rejectedQty must be greater than 0" });

    // Pull the receiving line + its parent Vehicle In/Out header + the PO
    // item's rate (used as the debit rate unless the caller overrides it).
    const lineRes = await pool.request().input("ItemId", sql.Int, itemId).query(`
      SELECT
        vi.VehicleInOutItemID, vi.VehicleInOutID, vi.POItemId, vi.ItemId, vi.ItemName,
        vi.UomName, vi.ReceivedQty,
        v.CompanyID, v.ProjectID, v.SupplierID, v.SupplierName, v.POID,
        poi.Rate AS POItemRate
      FROM dbo.VehicleInOutItems vi
      JOIN dbo.VehicleInOut v ON v.VehicleInOutID = vi.VehicleInOutID
      LEFT JOIN dbo.PurchaseOrderItems poi ON poi.Id = vi.POItemId
      WHERE vi.VehicleInOutItemID = @ItemId
    `);
    const line = lineRes.recordset[0];
    if (!line) return res.status(404).json({ error: "Received line not found" });
    if (!line.SupplierID) return res.status(400).json({ error: "This delivery has no linked supplier — cannot raise a debit note." });

    // Already-rejected quantity on this same line (across earlier, non-cancelled
    // debit notes) counts against the received quantity too — can't reject more
    // than was actually received, cumulatively.
    const priorRes = await pool.request().input("ItemId", sql.Int, itemId).query(`
      SELECT ISNULL(SUM(RejectedQty), 0) AS PriorRejected
      FROM dbo.QualityRejectionDebitNote
      WHERE VehicleInOutItemID = @ItemId AND Status <> 'Cancelled'
    `);
    const priorRejected = Number(priorRes.recordset[0].PriorRejected) || 0;
    const receivedQty = Number(line.ReceivedQty) || 0;
    if (priorRejected + qtyBad > receivedQty + 1e-6) {
      return res.status(400).json({
        error: `${line.ItemName || "Item"}: cannot reject ${qtyBad} — only ${(receivedQty - priorRejected).toFixed(3)} of the received ${receivedQty} is still un-debited.`,
      });
    }

    const rate = rateOverride != null && rateOverride !== "" ? Number(rateOverride) : Number(line.POItemRate) || 0;
    const percentBad = Math.round((qtyBad / receivedQty) * 10000) / 100; // 2dp
    const amount = Math.round(qtyBad * rate * 100) / 100;

    const email = userEmail(req);
    const docTypeId = await resolveDocTypeId(pool, sql, "QDN");
    const docNo = await lockNextDocNumber(pool, sql, {
      docTypeId,
      tableName: "QualityRejectionDebitNote",
      docNoColumn: "DocNo",
      issuedBy: email,
    });

    const insertRes = await pool
      .request()
      .input("DocNo", sql.NVarChar(50), docNo)
      .input("DocTypeId", sql.Int, docTypeId)
      .input("VehicleInOutID", sql.Int, line.VehicleInOutID)
      .input("VehicleInOutItemID", sql.Int, line.VehicleInOutItemID)
      .input("POItemId", sql.Int, line.POItemId)
      .input("POID", sql.Int, line.POID)
      .input("ItemId", sql.NVarChar(100), line.ItemId)
      .input("ItemName", sql.NVarChar(255), line.ItemName)
      .input("UomName", sql.NVarChar(50), line.UomName)
      .input("CompanyID", sql.Int, line.CompanyID)
      .input("ProjectID", sql.Int, line.ProjectID)
      .input("SupplierID", sql.Int, line.SupplierID)
      .input("SupplierName", sql.NVarChar(255), line.SupplierName)
      .input("ReceivedQty", sql.Decimal(18, 3), receivedQty)
      .input("RejectedQty", sql.Decimal(18, 3), qtyBad)
      .input("PercentBad", sql.Decimal(5, 2), percentBad)
      .input("Rate", sql.Decimal(18, 4), rate)
      .input("Amount", sql.Decimal(18, 2), amount)
      .input("Reason", sql.NVarChar(1000), reason || null)
      .input("CreatedBy", sql.NVarChar(150), email).query(`
        INSERT INTO dbo.QualityRejectionDebitNote
          (DocNo, DocTypeId, VehicleInOutID, VehicleInOutItemID, POItemId, POID,
           ItemId, ItemName, UomName, CompanyID, ProjectID, SupplierID, SupplierName,
           ReceivedQty, RejectedQty, PercentBad, Rate, Amount, Reason, CreatedBy)
        OUTPUT INSERTED.DebitNoteId
        VALUES
          (@DocNo, @DocTypeId, @VehicleInOutID, @VehicleInOutItemID, @POItemId, @POID,
           @ItemId, @ItemName, @UomName, @CompanyID, @ProjectID, @SupplierID, @SupplierName,
           @ReceivedQty, @RejectedQty, @PercentBad, @Rate, @Amount, @Reason, @CreatedBy)
      `);
    const debitNoteId = insertRes.recordset[0].DebitNoteId;
    await backPatchRecordId(pool, sql, docNo, "QualityRejectionDebitNote", debitNoteId);

    // Post the financial effect: a debit against the supplier's ledger
    // (reduces what the company owes them), single-leg per
    // GeneralLedgerEntry's documented shape (one row per debit/credit leg).
    let glEntryId = null;
    if (amount > 0) {
      const glRes = await pool
        .request()
        .input("VoucherNo", sql.NVarChar(100), docNo)
        .input("LHeadId", sql.Int, line.SupplierID)
        .input("DebitAmount", sql.Decimal(18, 2), amount)
        .input("Narration", sql.NVarChar(500), `Quality rejection — ${line.ItemName || "item"}: ${qtyBad} ${line.UomName || ""} (${percentBad}% of ${receivedQty}) on ${docNo}`)
        .input("SourceType", sql.NVarChar(30), "QualityRejectionDebitNote")
        .input("SourceId", sql.Int, debitNoteId)
        .input("CompanyId", sql.Int, line.CompanyID)
        .input("ProjectId", sql.Int, line.ProjectID)
        .input("CreatedBy", sql.NVarChar(150), email).query(`
          INSERT INTO dbo.GeneralLedgerEntry
            (VoucherNo, VoucherDate, LHeadId, DebitAmount, CreditAmount, Narration,
             SourceType, SourceId, CompanyId, ProjectId, CreatedBy)
          OUTPUT INSERTED.EntryId
          VALUES
            (@VoucherNo, CAST(GETDATE() AS DATE), @LHeadId, @DebitAmount, 0, @Narration,
             @SourceType, @SourceId, @CompanyId, @ProjectId, @CreatedBy)
        `);
      glEntryId = glRes.recordset[0].EntryId;
      await pool.request().input("Id", sql.Int, debitNoteId).input("GLEntryId", sql.Int, glEntryId).query(`
        UPDATE dbo.QualityRejectionDebitNote SET GLEntryId = @GLEntryId WHERE DebitNoteId = @Id
      `);
    }

    res.status(201).json({
      debitNoteId,
      docNo,
      percentBad,
      amount,
      glEntryId,
    });
  } catch (err) {
    console.error("Quality debit note create error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /:id/cancel — void a debit note and reverse its GL leg ─────────────
router.put("/:id/cancel", requirePageRight("vehicle-in-out", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: "Invalid id" });
    const email = userEmail(req);

    const existingRes = await pool.request().input("Id", sql.Int, id).query(`
      SELECT * FROM dbo.QualityRejectionDebitNote WHERE DebitNoteId = @Id
    `);
    const existing = existingRes.recordset[0];
    if (!existing) return res.status(404).json({ error: "Not found" });
    if (existing.Status === "Cancelled") return res.status(409).json({ error: "Already cancelled" });

    await pool.request().input("Id", sql.Int, id).input("By", sql.NVarChar(150), email).query(`
      UPDATE dbo.QualityRejectionDebitNote
      SET Status = 'Cancelled', UpdatedBy = @By, UpdatedAt = GETDATE()
      WHERE DebitNoteId = @Id
    `);

    if (existing.GLEntryId) {
      await pool.request().input("Id", sql.Int, existing.GLEntryId).query(`
        UPDATE dbo.GeneralLedgerEntry SET IsReversed = 1 WHERE EntryId = @Id
      `);
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
