const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));

const { getPool, sql } = require("../db");
const authenticateToken = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { bumpCacheVersion } = require("../redis");
const { lockNextDocNumber, backPatchRecordId, resolveDocTypeId } = require("../utils/docNumberLock");
const { generateFAItemCodes } = require("../services/faItemCodeGenerator");

router.use(authenticateToken);

function requireUser(req, res) {
  const email = req.user?.email || req.user?.name;
  if (!email) { res.status(401).json({ error: "User context missing" }); return null; }
  return email;
}

function toInt(val) {
  const n = parseInt(val, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Financial Year is derived from the Document Date, never trusted from the
// client — this is the single source of truth both at save time and for the
// list's Financial Year filter, so a tagging entry's date and its FinYear
// can never drift apart the way manually-picked values could.
async function deriveFinYear(pool, docDate) {
  if (!docDate) return null;
  const result = await pool.request().input("DocDate", sql.Date, docDate).query(`
    SELECT TOP 1 FName FROM dbo.FinYear
    WHERE @DocDate BETWEEN FStartDate AND FEndDate
    ORDER BY FStartDate DESC
  `);
  return result.recordset[0]?.FName || null;
}

// ── GET /eligible-items — Fixed-Asset-type Item Master items with untagged
// stock (StockLedger balance minus tagged-so-far) at the given Godown ───────
router.get("/eligible-items", requirePageRight("fixed-asset-tagging", "view"), async (req, res) => {
  const godownId = toInt(req.query.godownId);
  if (!godownId) return res.json([]);
  try {
    const pool = getPool();
    const request = pool.request().input("GodownId", sql.Int, godownId);
    let faWhere = ["fa.AssetStatus = 'Pending'", "fa.Status <> 'Deleted'", "fa.GodownID = @GodownId"];

    if (req.query.companyId) { request.input("CompanyId", sql.Int, parseInt(req.query.companyId, 10)); faWhere.push("fa.CompanyId = @CompanyId"); }
    if (req.query.projectId) { request.input("ProjectId", sql.Int, parseInt(req.query.projectId, 10)); faWhere.push("fa.ProjectId = @ProjectId"); }
    if (req.query.finYear)   { request.input("FinYear",   sql.NVarChar(20), req.query.finYear);        faWhere.push("fa.FinYear = @FinYear"); }

    const result = await request.query(`
      SELECT
        CONVERT(NVARCHAR(100), im.M_Id) AS ItemId,
        im.M_Name AS ItemName,
        MAX(fa.AssetCategory) AS AssetCategory,
        ISNULL(stock.Balance, 0) AS AvailableQty,
        ISNULL(tagged.Qty, 0) AS TaggedQty,
        ISNULL(stock.Balance, 0) - ISNULL(tagged.Qty, 0) AS UntaggedQty
      FROM dbo.Item_Master_Group im
      JOIN dbo.FixedAssetRecord fa ON fa.SourceItemId = CONVERT(NVARCHAR(100), im.M_Id) AND ${faWhere.join(" AND ")}
      OUTER APPLY (
        SELECT SUM(CASE WHEN sl.Type = 'IN' THEN sl.Qty ELSE -sl.Qty END) AS Balance
        FROM dbo.StockLedger sl
        WHERE sl.ItemID = CONVERT(NVARCHAR(100), im.M_Id) AND sl.GodownID = @GodownId
      ) stock
      OUTER APPLY (
        SELECT SUM(t.TaggedQty) AS Qty
        FROM dbo.FixedAssetTagging t
        WHERE t.ItemId = CONVERT(NVARCHAR(100), im.M_Id) AND t.GodownId = @GodownId AND t.Status = 'Tagged'
      ) tagged
      WHERE im.M_Type = 'Fixed Asset'
      GROUP BY im.M_Id, im.M_Name, stock.Balance, tagged.Qty
      HAVING (ISNULL(stock.Balance, 0) - ISNULL(tagged.Qty, 0)) > 0
      ORDER BY im.M_Name
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[fixedAssetTagging] GET /eligible-items:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /unassigned-codes — generated FA Item Codes not yet linked to a
// Fixed Asset Record (used by Fixed Asset Record's "Fixed Asset Name" picker) ─
router.get("/unassigned-codes", requirePageRight("fixed-asset-record", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT
        t.TagId, t.FAItemCode, t.DocNo,
        CONVERT(NVARCHAR(100), im.M_Id) AS ItemId, im.M_Name AS ItemName,
        t.CompanyId, co.name AS CompanyName,
        t.ProjectId, pr.name AS ProjectName,
        t.GodownId, gd.GodownName
      FROM dbo.FixedAssetTagging t
      LEFT JOIN dbo.Item_Master_Group im ON CONVERT(NVARCHAR(100), im.M_Id) = t.ItemId
      LEFT JOIN dbo.enterprise co ON co.id = t.CompanyId
      LEFT JOIN dbo.enterprise pr ON pr.id = t.ProjectId
      LEFT JOIN dbo.Godowns gd ON gd.GodownID = t.GodownId
      WHERE t.FAItemCode IS NOT NULL AND t.Status = 'Tagged'
        AND NOT EXISTS (SELECT 1 FROM dbo.FixedAssetRecord fa WHERE fa.SourceTagId = t.TagId AND fa.Status <> 'Deleted')
      ORDER BY t.CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[fixedAssetTagging] GET /unassigned-codes:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /tagged-codes — every valid FA Item Code minted by the Depreciation
// Tag workflow, for the sticker-print page. One row per tagged unit; stays
// listed forever (even after a Fixed Asset Record is cut) so stickers can be
// reprinted. Filters: company, financial year, tagging-date range, search. ──
router.get("/tagged-codes", requirePageRight("fixed-asset-tagging", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const request = pool.request();
    const where = ["t.Status = 'Tagged'", "t.FAItemCode IS NOT NULL"];

    if (req.query.companyId) { request.input("CompanyId", sql.Int, parseInt(req.query.companyId, 10)); where.push("t.CompanyId = @CompanyId"); }
    if (req.query.finYear)   { request.input("FinYear",   sql.NVarChar(20), req.query.finYear);        where.push("t.FinYear = @FinYear"); }
    if (req.query.fromDate)  { request.input("FromDate",  sql.Date, req.query.fromDate);                where.push("t.DocDate >= @FromDate"); }
    if (req.query.toDate)    { request.input("ToDate",    sql.Date, req.query.toDate);                  where.push("t.DocDate <= @ToDate"); }
    if (req.query.search) {
      request.input("Search", sql.NVarChar(200), `%${String(req.query.search).trim()}%`);
      where.push("(t.FAItemCode LIKE @Search OR im.M_Name LIKE @Search)");
    }

    const result = await request.query(`
      SELECT
        t.TagId, t.FAItemCode, im.M_Name AS ItemName,
        t.DocDate, t.FinYear,
        t.CompanyId, co.name AS CompanyName,
        t.ProjectId, pr.name AS ProjectName,
        CASE WHEN EXISTS (
          SELECT 1 FROM dbo.FixedAssetRecord fr WHERE fr.SourceTagId = t.TagId AND fr.Status <> 'Deleted'
        ) THEN 1 ELSE 0 END AS HasRecord
      FROM dbo.FixedAssetTagging t
      LEFT JOIN dbo.Item_Master_Group im ON CONVERT(NVARCHAR(100), im.M_Id) = t.ItemId
      LEFT JOIN dbo.enterprise co ON co.id = t.CompanyId
      LEFT JOIN dbo.enterprise pr ON pr.id = t.ProjectId
      WHERE ${where.join(" AND ")}
      ORDER BY t.FAItemCode
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[fixedAssetTagging] GET /tagged-codes:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET / — list tagging transactions (audit trail) ──────────────────────────
router.get("/", requirePageRight("fixed-asset-tagging", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const request = pool.request();
    // Cancelled tags are soft-kept in the DB for FA Item Code / stock audit,
    // but never surface in the Tagging Transaction History list on any client.
    let where = ["t.Status <> 'Cancelled'"];

    if (req.query.companyId) { request.input("CompanyId", sql.Int, parseInt(req.query.companyId, 10)); where.push("t.CompanyId = @CompanyId"); }
    if (req.query.projectId) { request.input("ProjectId", sql.Int, parseInt(req.query.projectId, 10)); where.push("t.ProjectId = @ProjectId"); }
    if (req.query.finYear)   { request.input("FinYear",   sql.NVarChar(20), req.query.finYear);        where.push("t.FinYear = @FinYear"); }
    if (req.query.assetId)   { request.input("AssetId",   sql.Int, parseInt(req.query.assetId, 10));   where.push("t.AssetId = @AssetId"); }
    if (req.query.fromDate)  { request.input("FromDate",  sql.Date, req.query.fromDate);                where.push("t.DocDate >= @FromDate"); }
    if (req.query.toDate)    { request.input("ToDate",    sql.Date, req.query.toDate);                  where.push("t.DocDate <= @ToDate"); }
    if (req.query.godownId)  { request.input("GodownId",  sql.Int, parseInt(req.query.godownId, 10));   where.push("t.GodownId = @GodownId"); }

    const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const result = await request.query(`
      SELECT
        t.TagId, t.DocNo, t.DocDate, t.FinYear, t.TaggedQty, t.FAItemCode, t.Remarks, t.Status,
        t.CreatedBy, t.CreatedAt,
        t.CompanyId, co.name AS CompanyName,
        t.ProjectId, pr.name AS ProjectName,
        t.GodownId, gd.GodownName,
        t.AssetId, fa.AssetName, fa.AssetCategory, fa.AssetCode,
        CASE
          WHEN t.FAItemCode IS NULL THEN NULL
          WHEN EXISTS (
            SELECT 1 FROM dbo.FixedAssetRecord fr
            WHERE fr.SourceTagId = t.TagId AND fr.Status <> 'Deleted'
          ) THEN 'Done'
          ELSE 'Pending'
        END AS RecordStatus
      FROM dbo.FixedAssetTagging t
      LEFT JOIN dbo.enterprise co ON co.id = t.CompanyId
      LEFT JOIN dbo.enterprise pr ON pr.id = t.ProjectId
      LEFT JOIN dbo.Godowns gd ON gd.GodownID = t.GodownId
      LEFT JOIN dbo.FixedAssetRecord fa ON fa.AssetId = t.AssetId
      ${whereClause}
      ORDER BY t.CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[fixedAssetTagging] GET /:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:id — single ─────────────────────────────────────────────────────────
router.get("/:id", requirePageRight("fixed-asset-tagging", "view"), async (req, res) => {
  const id = toInt(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const result = await pool.request().input("TagId", sql.Int, id).query(`
      SELECT
        t.*,
        co.name AS CompanyName,
        pr.name AS ProjectName,
        gd.GodownName,
        fa.AssetName, fa.AssetCategory, fa.AssetCode, fa.Quantity AS BatchQuantity
      FROM dbo.FixedAssetTagging t
      LEFT JOIN dbo.enterprise co ON co.id = t.CompanyId
      LEFT JOIN dbo.enterprise pr ON pr.id = t.ProjectId
      LEFT JOIN dbo.Godowns gd ON gd.GodownID = t.GodownId
      LEFT JOIN dbo.FixedAssetRecord fa ON fa.AssetId = t.AssetId
      WHERE t.TagId = @TagId
    `);
    if (!result.recordset.length) return res.status(404).json({ error: "Not found" });
    res.json(result.recordset[0]);
  } catch (err) {
    console.error("[fixedAssetTagging] GET /:id:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST / — generate FA Item Codes + tag N units ─────────────────────────────
// Generates numberOfItems unique FA Item Codes ("ProjectAlias/ItemName/0001/
// FinYear") and tags that many units of a Fixed-Asset item at a Godown, one
// FixedAssetTagging row per unit. May span multiple Pending FixedAssetRecord
// batches for that (item, godown) — oldest first — flipping each batch to
// Active the moment it's fully consumed.
router.post("/", requirePageRight("fixed-asset-tagging", "create"), async (req, res) => {
  const email = requireUser(req, res);
  if (!email) return;

  const {
    docDate, companyId, projectId, godownId, itemId, numberOfItems, remarks,
  } = req.body;

  const projectIdVal = toInt(projectId);
  const godownIdVal = toInt(godownId);
  const itemIdVal = itemId ? String(itemId) : null;
  const countVal = parseInt(numberOfItems, 10);

  if (!docDate) return res.status(400).json({ error: "docDate is required" });
  if (!projectIdVal) return res.status(400).json({ error: "projectId is required" });
  if (!godownIdVal) return res.status(400).json({ error: "godownId is required" });
  if (!itemIdVal) return res.status(400).json({ error: "itemId is required" });
  if (!Number.isFinite(countVal) || countVal <= 0) return res.status(400).json({ error: "numberOfItems must be a positive whole number" });

  try {
    const pool = getPool();

    const finYear = await deriveFinYear(pool, docDate);
    if (!finYear) {
      return res.status(400).json({ error: "No Financial Year is configured for this date — set one up in Financial Year Setup first" });
    }

    const templateRes = await pool.request().input("ProjectId", sql.Int, projectIdVal).query(`
      SELECT ProjectAlias FROM dbo.IDTemplateMaster WHERE ProjectId = @ProjectId AND IsActive = 1
    `);
    const template = templateRes.recordset[0];
    if (!template) {
      return res.status(400).json({ error: "Configure a Project Alias in ID Template Master before tagging this project's assets" });
    }

    const itemRes = await pool.request().input("ItemId", sql.NVarChar(100), itemIdVal).query(`
      SELECT M_Name FROM dbo.Item_Master_Group WHERE CONVERT(NVARCHAR(100), M_Id) = @ItemId
    `);
    const itemName = itemRes.recordset[0]?.M_Name || "Item";

    const tx = pool.transaction();
    await tx.begin();
    try {
      // Lock every Pending batch for this (item, godown) so a concurrent tag
      // request against the same item/godown can't jointly over-tag it, then
      // re-derive the live StockLedger balance and tagged-so-far inside the lock.
      const batchesRes = await tx.request()
        .input("ItemId", sql.NVarChar(100), itemIdVal)
        .input("GodownId", sql.Int, godownIdVal)
        .query(`
          SELECT fa.AssetId, fa.Quantity, fa.AssetStatus, fa.CreatedAt,
                 ISNULL((SELECT SUM(t.TaggedQty) FROM dbo.FixedAssetTagging t
                         WHERE t.AssetId = fa.AssetId AND t.Status = 'Tagged'), 0) AS TaggedSoFar
          FROM dbo.FixedAssetRecord fa WITH (UPDLOCK, HOLDLOCK)
          WHERE fa.SourceItemId = @ItemId AND fa.GodownID = @GodownId
            AND fa.AssetStatus = 'Pending' AND fa.Status <> 'Deleted'
          ORDER BY fa.CreatedAt ASC
        `);
      const batches = batchesRes.recordset;
      if (!batches.length) { await tx.rollback(); return res.status(404).json({ error: "No untagged stock found for this item at this godown" }); }

      const stockRes = await tx.request()
        .input("ItemId", sql.NVarChar(100), itemIdVal)
        .input("GodownId", sql.Int, godownIdVal)
        .query(`
          SELECT
            ISNULL((SELECT SUM(CASE WHEN Type = 'IN' THEN Qty ELSE -Qty END) FROM dbo.StockLedger
                    WHERE ItemID = @ItemId AND GodownID = @GodownId), 0) AS Balance,
            ISNULL((SELECT SUM(TaggedQty) FROM dbo.FixedAssetTagging
                    WHERE ItemId = @ItemId AND GodownId = @GodownId AND Status = 'Tagged'), 0) AS TaggedSoFar
        `);
      const { Balance, TaggedSoFar } = stockRes.recordset[0];
      const untagged = Number(Balance) - Number(TaggedSoFar);
      if (countVal > untagged) {
        await tx.rollback();
        return res.status(400).json({ error: `Cannot generate ${countVal} — only ${untagged} untagged unit(s) available for this item at this godown` });
      }

      const docTypeId = await resolveDocTypeId(pool, sql, "FAT");
      const docNo = await lockNextDocNumber(pool, sql, {
        docTypeId, finYear, tableName: "FixedAssetTagging", issuedBy: email,
      });

      const codes = await generateFAItemCodes(pool, {
        projectId: projectIdVal, projectAlias: template.ProjectAlias,
        itemId: itemIdVal, itemName, finYear, count: countVal,
      });

      let batchIdx = 0;
      let batchRemaining = Number(batches[0].Quantity) - Number(batches[0].TaggedSoFar);
      let firstTagId = null;

      for (const code of codes) {
        while (batchIdx < batches.length && batchRemaining <= 0) {
          batchIdx++;
          if (batchIdx < batches.length) {
            batchRemaining = Number(batches[batchIdx].Quantity) - Number(batches[batchIdx].TaggedSoFar);
          }
        }
        if (batchIdx >= batches.length) {
          // Another concurrent tagger consumed the remaining stock between
          // our balance check and now — bail out rather than under-tag.
          throw new Error("Untagged stock changed while processing — please retry");
        }
        const batch = batches[batchIdx];

        const insert = await tx.request()
          .input("DocNo",     sql.NVarChar(100), docNo)
          .input("DocDate",   sql.Date,          docDate || null)
          .input("CompanyId", sql.Int,           companyId ? parseInt(companyId, 10) : null)
          .input("ProjectId", sql.Int,           projectIdVal)
          .input("FinYear",   sql.NVarChar(20),  finYear || null)
          .input("AssetId",   sql.Int,           batch.AssetId)
          .input("ItemId",    sql.NVarChar(100), itemIdVal)
          .input("GodownId",  sql.Int,           godownIdVal)
          .input("TaggedQty", sql.Decimal(18,3), 1)
          .input("FAItemCode",sql.NVarChar(200), code)
          .input("Remarks",   sql.NVarChar(sql.MAX), remarks || null)
          .input("CreatedBy", sql.NVarChar(200), email)
          .query(`
            INSERT INTO dbo.FixedAssetTagging
              (DocNo, DocDate, CompanyId, ProjectId, FinYear, AssetId, ItemId, GodownId, TaggedQty, FAItemCode, Remarks, Status, CreatedBy, CreatedAt)
            OUTPUT INSERTED.TagId
            VALUES
              (@DocNo, @DocDate, @CompanyId, @ProjectId, @FinYear, @AssetId, @ItemId, @GodownId, @TaggedQty, @FAItemCode, @Remarks, 'Tagged', @CreatedBy, SYSDATETIME())
          `);
        if (firstTagId == null) firstTagId = insert.recordset[0].TagId;

        batchRemaining -= 1;
        if (batchRemaining <= 0) {
          await tx.request()
            .input("AssetId",        sql.Int,  batch.AssetId)
            .input("ActivationDate", sql.Date, docDate || null)
            .input("UpdatedBy",      sql.NVarChar(200), email)
            .query(`
              UPDATE dbo.FixedAssetRecord
              SET AssetStatus = 'Active',
                  ActivationDate = ISNULL(ActivationDate, @ActivationDate),
                  UpdatedBy = @UpdatedBy,
                  UpdatedAt = SYSDATETIME()
              WHERE AssetId = @AssetId
            `);
        }
      }

      await tx.commit();
      await backPatchRecordId(pool, sql, docNo, "FixedAssetTagging", firstTagId);
      await bumpCacheVersion("fixed-asset-tagging");
      await bumpCacheVersion("fixed-assets");
      res.json({ tagId: firstTagId, docNo, codes });
    } catch (e) { await tx.rollback(); throw e; }
  } catch (err) {
    console.error("[fixedAssetTagging] POST /:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /:id — edit date/remarks only ─────────────────────────────────────────
router.put("/:id", requirePageRight("fixed-asset-tagging", "edit"), async (req, res) => {
  const id = toInt(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  const email = requireUser(req, res);
  if (!email) return;
  try {
    const pool = getPool();
    const { docDate, remarks } = req.body;
    await pool.request()
      .input("TagId",     sql.Int, id)
      .input("DocDate",   sql.Date, docDate || null)
      .input("Remarks",   sql.NVarChar(sql.MAX), remarks || null)
      .input("UpdatedBy", sql.NVarChar(200), email)
      .query(`
        UPDATE dbo.FixedAssetTagging SET
          DocDate   = ISNULL(@DocDate, DocDate),
          Remarks   = @Remarks,
          UpdatedBy = @UpdatedBy,
          UpdatedAt = SYSDATETIME()
        WHERE TagId = @TagId
      `);
    await bumpCacheVersion("fixed-asset-tagging");
    res.json({ ok: true });
  } catch (err) {
    console.error("[fixedAssetTagging] PUT /:id:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /:id — soft-cancel, frees the tagged qty back to the batch ────────
router.delete("/:id", requirePageRight("fixed-asset-tagging", "delete"), async (req, res) => {
  const id = toInt(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  const email = requireUser(req, res);
  if (!email) return;
  try {
    const pool = getPool();
    const tx = pool.transaction();
    await tx.begin();
    try {
      const tagRes = await tx.request().input("TagId", sql.Int, id).query(`
        SELECT t.TagId, t.AssetId, t.Status, fa.Quantity,
               ISNULL((SELECT SUM(t2.TaggedQty) FROM dbo.FixedAssetTagging t2 WITH (UPDLOCK, HOLDLOCK)
                       WHERE t2.AssetId = t.AssetId AND t2.Status = 'Tagged'), 0) AS TaggedSoFar
        FROM dbo.FixedAssetTagging t WITH (UPDLOCK, HOLDLOCK)
        JOIN dbo.FixedAssetRecord fa WITH (UPDLOCK, HOLDLOCK) ON fa.AssetId = t.AssetId
        WHERE t.TagId = @TagId
      `);
      const tag = tagRes.recordset[0];
      if (!tag) { await tx.rollback(); return res.status(404).json({ error: "Not found" }); }
      if (tag.Status === "Cancelled") { await tx.rollback(); return res.json({ ok: true }); }

      // A tag that's already been completed into a Fixed Asset Record
      // can't be cancelled out from under it — that would leave a live
      // asset record referencing a "Cancelled" tag in its own history.
      // Delete the Fixed Asset Record first (frees the FA Item Code back
      // to "unassigned"), then the tag can be cancelled.
      const recordRes = await tx.request().input("TagId", sql.Int, id).query(`
        SELECT AssetId FROM dbo.FixedAssetRecord WITH (UPDLOCK, HOLDLOCK)
        WHERE SourceTagId = @TagId AND Status <> 'Deleted'
      `);
      if (recordRes.recordset.length > 0) {
        await tx.rollback();
        return res.status(400).json({ error: "This FA Item Code already has a Fixed Asset Record — delete that record first, then cancel the tag." });
      }

      await tx.request()
        .input("TagId",     sql.Int, id)
        .input("UpdatedBy", sql.NVarChar(200), email)
        .query(`
          UPDATE dbo.FixedAssetTagging
          SET Status = 'Cancelled', UpdatedBy = @UpdatedBy, UpdatedAt = SYSDATETIME()
          WHERE TagId = @TagId
        `);

      // Freeing this qty means the batch can no longer be fully tagged —
      // revert it to Pending if it had been auto-flipped to Active.
      await tx.request()
        .input("AssetId",   sql.Int, tag.AssetId)
        .input("UpdatedBy", sql.NVarChar(200), email)
        .query(`
          UPDATE dbo.FixedAssetRecord
          SET AssetStatus = 'Pending', UpdatedBy = @UpdatedBy, UpdatedAt = SYSDATETIME()
          WHERE AssetId = @AssetId AND AssetStatus = 'Active'
        `);

      await tx.commit();
      await bumpCacheVersion("fixed-asset-tagging");
      await bumpCacheVersion("fixed-assets");
      res.json({ ok: true });
    } catch (e) { await tx.rollback(); throw e; }
  } catch (err) {
    console.error("[fixedAssetTagging] DELETE /:id:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
