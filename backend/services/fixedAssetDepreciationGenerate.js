"use strict";

// backend/services/fixedAssetDepreciationGenerate.js
//
// Backs the "Fixed Asset Depreciation Generate" menu: pick a Project + Month, see every
// depreciation-tagged asset of that project with its state for that month, and generate
// the month's depreciation posting for the ones that are still due.
//
// It posts through the same engine as the Fixed Asset Record's Post button and the
// automatic 1st-of-month run (services/fixedAssetDepreciationPosting.js), so all three
// share one history and can never double-post: an asset-month that already has a live
// entry is reported "already posted" and left alone — by this screen, by the scheduler or
// by hand. A project + month can therefore be generated again safely; only assets still
// due (for example one tagged after the first Generate) are posted the second time.

const { sql } = require("../db");
const logger = require("../logger");
const { bumpCacheVersion } = require("../redis");
const { lockNextDocNumber, resolveDocTypeId } = require("../utils/docNumberLock");
const { computeMonth, postDepreciation, validateAssetForDepreciation } = require("./fixedAssetDepreciationPosting");

const DEP_DOC_PREFIX = "FADEP";
const DEPRECIABLE_STATUSES = ["Active", "Under Maintenance"];

// Two people clicking Generate for the same project + month at once: the second waits
// out the first instead of racing it (the DB unique index would catch a duplicate anyway).
const inFlight = new Set();

/** Every record created from a Fixed Asset Depreciation Tag in this project (live ones only). */
async function loadTaggedAssets(pool, projectId) {
  const r = await pool.request().input("ProjectId", sql.Int, projectId).query(`
    SELECT fa.AssetId, fa.AssetCode, fa.FAItemCode, fa.AssetName, fa.AssetCategory, fa.CompanyId, fa.ProjectId,
           fa.PurchaseCost, fa.PurchaseDate, fa.ActivationDate, fa.FinYear,
           fa.DepreciationType, fa.DepreciationRate, fa.AssetStatus, fa.Status, fa.TransferredAt
    FROM dbo.FixedAssetRecord fa
    JOIN dbo.FixedAssetTagging t ON t.TagId = fa.SourceTagId
    WHERE fa.ProjectId = @ProjectId AND fa.AssetCode IS NOT NULL AND fa.Status <> 'Deleted'
    ORDER BY fa.FAItemCode, fa.AssetId
  `);
  return r.recordset;
}

/** Live (non-reversed) entries of the project for one month, keyed by AssetId. */
async function loadMonthEntries(pool, projectId, year, month) {
  const r = await pool.request()
    .input("ProjectId", sql.Int, projectId).input("Y", sql.SmallInt, year).input("M", sql.TinyInt, month)
    .query(`
      SELECT e.AssetId, e.EntryId, e.VoucherNo, e.DepreciationAmount, e.AccumulatedDepreciation,
             e.ClosingBookValue, e.PostedAt, e.PostedBy
      FROM dbo.FixedAssetDepreciationEntry e
      JOIN dbo.FixedAssetRecord fa ON fa.AssetId = e.AssetId
      WHERE fa.ProjectId = @ProjectId AND e.PeriodYear = @Y AND e.PeriodMonth = @M AND e.Status <> 'Reversed'
    `);
  return new Map(r.recordset.map((e) => [e.AssetId, e]));
}

/** Why an asset can't be depreciated at all (independent of the month), or null. */
function ineligibleReason(asset) {
  if (!DEPRECIABLE_STATUSES.includes(asset.AssetStatus)) return `Asset status is ${asset.AssetStatus} — no depreciation`;
  if (asset.TransferredAt) return "Transferred to another company — no further depreciation";
  const bad = validateAssetForDepreciation(asset);
  return bad ? bad.message : null;
}

function assertPeriod(year, month, today) {
  if (year * 12 + month > today.y * 12 + today.m) {
    const e = new Error("Depreciation can't be generated for a future month.");
    e.code = "BAD_PERIOD";
    throw e;
  }
}

/**
 * Every depreciation-tagged asset of the project with its state for (year, month):
 *   posted      — already has a posting (voucher, amount, posting date)
 *   pending     — due: Generate will post it (amount shown)
 *   notEligible — can't be depreciated this month (reason shown)
 */
async function previewProjectMonth(pool, { projectId, year, month }) {
  const [assets, entries] = await Promise.all([loadTaggedAssets(pool, projectId), loadMonthEntries(pool, projectId, year, month)]);
  const rows = [];
  for (const a of assets) {
    const base = {
      assetId: a.AssetId, faItemCode: a.FAItemCode || a.AssetCode, assetName: a.AssetName, assetCategory: a.AssetCategory,
      assetStatus: a.AssetStatus, method: a.DepreciationType, ratePct: a.DepreciationRate, purchaseCost: a.PurchaseCost,
    };
    const posted = entries.get(a.AssetId);
    if (posted) {
      rows.push({
        ...base, state: "posted", amount: posted.DepreciationAmount, closingBookValue: posted.ClosingBookValue,
        voucherNo: posted.VoucherNo, postedAt: posted.PostedAt, postedBy: posted.PostedBy,
      });
      continue;
    }
    const reason = ineligibleReason(a);
    if (reason) { rows.push({ ...base, state: "notEligible", reason }); continue; }
    try {
      const dep = await computeMonth(pool, a, year, month);
      rows.push({ ...base, state: "pending", amount: dep.depreciationAmount, closingBookValue: dep.closingBookValue });
    } catch (e) {
      if (e.code !== "CONFIG_MISSING") throw e;
      rows.push({ ...base, state: "notEligible", reason: e.message });
    }
  }
  const count = (s) => rows.filter((r) => r.state === s).length;
  const counts = { total: rows.length, posted: count("posted"), pending: count("pending"), notEligible: count("notEligible") };
  const monthStatus = counts.posted === 0 ? "Not generated" : counts.pending === 0 ? "Generated" : "Partially generated";
  return { projectId, year, month, monthStatus, counts, rows };
}

/**
 * Post the month for every still-due asset of the project. Returns per-asset outcomes:
 *   generated | alreadyPosted | skipped (not due this month) | failed
 */
async function generateProjectMonth(pool, { projectId, year, month, email, today }) {
  assertPeriod(year, month, today);
  const lockKey = `${projectId}|${year}|${month}`;
  if (inFlight.has(lockKey)) {
    const e = new Error("Depreciation for this project and month is already being generated — please wait a moment.");
    e.code = "BUSY";
    throw e;
  }
  inFlight.add(lockKey);
  try {
    const docTypeId = await resolveDocTypeId(pool, sql, DEP_DOC_PREFIX);
    const lockDocNo = (finYear) => lockNextDocNumber(pool, sql, {
      docTypeId, finYear, tableName: "FixedAssetDepreciationEntry", docNoColumn: "VoucherNo", issuedBy: email,
    });

    const results = [];
    for (const a of await loadTaggedAssets(pool, projectId)) {
      const row = { assetId: a.AssetId, faItemCode: a.FAItemCode || a.AssetCode };
      const reason = ineligibleReason(a);
      if (reason) { results.push({ ...row, outcome: "skipped", message: reason }); continue; }
      try {
        const res = await postDepreciation(pool, a, year, month, email, lockDocNo);
        if (res.reason === "already posted") results.push({ ...row, outcome: "alreadyPosted", voucherNo: res.voucherNo });
        else results.push({ ...row, outcome: "generated", voucherNo: res.voucherNo, amount: res.depreciation?.depreciationAmount, closingBookValue: res.depreciation?.closingBookValue });
      } catch (e) {
        if (/UX_FADep_Asset_Period|duplicate key/i.test(e.message)) results.push({ ...row, outcome: "alreadyPosted" });
        else if (e.code === "CONFIG_MISSING") results.push({ ...row, outcome: "skipped", message: e.message });
        else {
          results.push({ ...row, outcome: "failed", message: e.message });
          logger.error({ event: "FA_DEP_GENERATE_ASSET_FAILED", assetId: a.AssetId, year, month, err: e.message }, "Depreciation generate failed for an asset");
        }
      }
    }

    const n = (o) => results.filter((r) => r.outcome === o).length;
    const counts = { generated: n("generated"), alreadyPosted: n("alreadyPosted"), skipped: n("skipped"), failed: n("failed") };
    const total = Math.round(results.reduce((s, r) => s + (r.outcome === "generated" ? Number(r.amount) || 0 : 0), 0) * 100) / 100;

    await pool.request()
      .input("Y", sql.SmallInt, year).input("M", sql.TinyInt, month).input("P", sql.Int, projectId).input("By", sql.NVarChar(200), email)
      .input("E", sql.Int, results.length - counts.skipped).input("G", sql.Int, counts.generated).input("A", sql.Int, counts.alreadyPosted)
      .input("S", sql.Int, counts.skipped).input("F", sql.Int, counts.failed).input("Amt", sql.Decimal(18, 2), total)
      .input("D", sql.NVarChar(sql.MAX), JSON.stringify(results.filter((r) => r.outcome === "skipped" || r.outcome === "failed").slice(0, 300)))
      .query(`
        INSERT INTO dbo.FixedAssetDepreciationRun
          (PeriodYear, PeriodMonth, TriggerType, Status, StartedAt, FinishedAt, RunBy, ProjectId,
           Eligible, Posted, AlreadyPosted, Skipped, Failed, TotalAmount, Details)
        VALUES (@Y, @M, 'Manual', 'Completed', SYSDATETIME(), SYSDATETIME(), @By, @P, @E, @G, @A, @S, @F, @Amt, @D)
      `);
    if (counts.generated > 0) {
      await bumpCacheVersion("fixed-assets");
      await bumpCacheVersion("general-ledger");
    }
    return { projectId, year, month, counts, totalAmount: total, results };
  } finally {
    inFlight.delete(lockKey);
  }
}

/** Posting history: one row per posted (or reversed) monthly entry. Filters are all optional. */
async function postingHistory(pool, { projectId, year, month }) {
  const request = pool.request();
  const where = ["fa.AssetCode IS NOT NULL"];
  if (projectId) { request.input("ProjectId", sql.Int, projectId); where.push("fa.ProjectId = @ProjectId"); }
  if (year)      { request.input("Y", sql.SmallInt, year); where.push("e.PeriodYear = @Y"); }
  if (month)     { request.input("M", sql.TinyInt, month); where.push("e.PeriodMonth = @M"); }
  const r = await request.query(`
    SELECT TOP 500
      e.EntryId, e.PeriodYear, e.PeriodMonth, fa.ProjectId, pr.name AS ProjectName,
      fa.FAItemCode, fa.AssetName, e.DepreciationAmount, e.AccumulatedDepreciation, e.ClosingBookValue,
      e.PostedAt, e.PostedBy, e.VoucherNo,
      CASE WHEN e.Status = 'Reversed' THEN 'Reversed' ELSE 'Posted' END AS PostingStatus
    FROM dbo.FixedAssetDepreciationEntry e
    JOIN dbo.FixedAssetRecord fa ON fa.AssetId = e.AssetId
    LEFT JOIN dbo.enterprise pr ON pr.id = fa.ProjectId
    WHERE ${where.join(" AND ")}
    ORDER BY e.PostedAt DESC, e.EntryId DESC
  `);
  return r.recordset;
}

/** Recent Generate clicks (and scheduler runs) for the project. */
async function generateRuns(pool, projectId) {
  const r = await pool.request().input("ProjectId", sql.Int, projectId).query(`
    SELECT TOP 50 RunId, PeriodYear, PeriodMonth, TriggerType, StartedAt, RunBy,
           Posted AS Generated, AlreadyPosted, Skipped, Failed, TotalAmount
    FROM dbo.FixedAssetDepreciationRun
    WHERE ProjectId = @ProjectId AND Status = 'Completed'
    ORDER BY StartedAt DESC
  `);
  return r.recordset;
}

module.exports = { previewProjectMonth, generateProjectMonth, postingHistory, generateRuns };
