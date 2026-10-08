"use strict";

// backend/services/fixedAssetAutoDepreciation.js
//
// Automatic monthly depreciation. From the 1st of every month the engine posts the
// PREVIOUS month's depreciation (the month that just closed) for every Fixed Asset
// Record that is properly tagged (created from a Fixed Asset Depreciation Tag) and
// still depreciable — using the same posting the Fixed Asset Record's "Post" button
// uses (services/fixedAssetDepreciationPosting.js: Dr Depreciation Expense /
// Cr Accumulated Depreciation, one FADEP voucher per asset-month), so automatic and
// manual postings are indistinguishable and share one history.
//
// Safety:
//   • Never twice: UX_FADep_Asset_Period (one live entry per asset per month) plus
//     postDepreciation()'s own "already posted" check; an asset-month posted by hand
//     is simply counted as already posted.
//   • One run per period: dbo.FixedAssetDepreciationRun's unique Auto-period index is a
//     lock across app instances and records what happened (counts + per-asset reasons).
//   • Catch-up: if the app was down on the 1st, the next check posts the missed
//     closed months since the last automatic run (max 12), oldest first.
//   • Eligibility: tagged record (SourceTagId → tag still 'Tagged'), not Deleted,
//     AssetStatus Active / Under Maintenance (Pending, Sold, Scrapped and Transferred
//     stop depreciation — an asset that leaves in a month is not charged for that
//     month, matching the Inter-Company Transfer rule), cost / rate / method / start
//     date configured. Assets that are tagged and active but unconfigured are counted
//     as "not configured" in the run log so they can be fixed.

const { sql } = require("../db");
const logger = require("../logger");
const { bumpCacheVersion } = require("../redis");
const { lockNextDocNumber, resolveDocTypeId } = require("../utils/docNumberLock");
const { postDepreciation, computeMonth, validateAssetForDepreciation } = require("./fixedAssetDepreciationPosting");

const DEP_DOC_PREFIX = "FADEP";
const AUTO_USER = "System (Auto Depreciation)";
const CHECK_INTERVAL_MS = 15 * 60 * 1000; // 15 min — the run itself happens once per period
const MAX_CATCH_UP_MONTHS = 12;
const MAX_DETAILS = 300;

/** Today's calendar date in India (the business calendar), independent of server TZ. */
function todayIst() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date());
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return { y: get("year"), m: get("month"), d: get("day") };
}

/** The calendar month before (y, m). */
function prevMonth(y, m) {
  return m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
}

const periodIndex = (y, m) => y * 12 + (m - 1);

/** Tagged, live, depreciable-status records. Config completeness is checked per asset. */
async function loadCandidateAssets(pool) {
  const r = await pool.request().query(`
    SELECT fa.AssetId, fa.AssetCode, fa.FAItemCode, fa.AssetName, fa.CompanyId, fa.ProjectId,
           fa.PurchaseCost, fa.PurchaseDate, fa.ActivationDate, fa.FinYear,
           fa.DepreciationType, fa.DepreciationRate, fa.AssetStatus, fa.Status, fa.TransferredAt
    FROM dbo.FixedAssetRecord fa
    JOIN dbo.FixedAssetTagging t ON t.TagId = fa.SourceTagId AND t.Status = 'Tagged'
    WHERE fa.AssetCode IS NOT NULL
      AND fa.Status <> 'Deleted'
      AND fa.AssetStatus IN ('Active', 'Under Maintenance')
      AND fa.TransferredAt IS NULL
    ORDER BY fa.AssetId
  `);
  return r.recordset;
}

/**
 * Post one period for every eligible asset and record the run.
 * `trigger` = 'Auto' (guarded by the unique-period index) or 'Manual'.
 * Returns the run summary, or { skipped: true } if another instance owns the period.
 */
async function runDepreciationForPeriod(pool, { year, month, trigger = "Manual", runBy = AUTO_USER }) {
  // Claim the period (Auto: the unique index makes this a cross-instance lock).
  let runId;
  try {
    const ins = await pool.request()
      .input("Y", sql.SmallInt, year).input("M", sql.TinyInt, month)
      .input("T", sql.NVarChar(10), trigger).input("By", sql.NVarChar(200), runBy)
      .query(`
        INSERT INTO dbo.FixedAssetDepreciationRun (PeriodYear, PeriodMonth, TriggerType, Status, RunBy)
        OUTPUT INSERTED.RunId
        VALUES (@Y, @M, @T, 'Running', @By)
      `);
    runId = ins.recordset[0].RunId;
  } catch (e) {
    if (/UX_FADepRun_Auto_Period|duplicate key/i.test(e.message)) return { skipped: true, reason: "period already run or running" };
    throw e;
  }

  const counts = { eligible: 0, posted: 0, alreadyPosted: 0, skipped: 0, failed: 0, notConfigured: 0, totalAmount: 0 };
  const details = [];
  const note = (a, kind, msg) => {
    if (details.length < MAX_DETAILS) details.push({ assetId: a.AssetId, faItemCode: a.FAItemCode || a.AssetCode, kind, message: msg });
  };

  try {
    const docTypeId = await resolveDocTypeId(pool, sql, DEP_DOC_PREFIX);
    const lockDocNo = (finYear) => lockNextDocNumber(pool, sql, {
      docTypeId, finYear, tableName: "FixedAssetDepreciationEntry", docNoColumn: "VoucherNo", issuedBy: runBy,
    });

    for (const asset of await loadCandidateAssets(pool)) {
      const cfgProblem = validateAssetForDepreciation(asset);
      if (cfgProblem) {
        counts.notConfigured++;
        note(asset, "notConfigured", cfgProblem.message);
        continue;
      }
      counts.eligible++;
      try {
        const res = await postDepreciation(pool, asset, year, month, runBy, lockDocNo);
        if (res.reason === "already posted") counts.alreadyPosted++;
        else {
          counts.posted++;
          counts.totalAmount += Number(res.depreciation?.depreciationAmount) || 0;
        }
      } catch (e) {
        if (e.code === "CONFIG_MISSING") {
          // Not in service that month, fully depreciated, stopped by transfer… — expected, not an error.
          counts.skipped++;
          note(asset, "skipped", e.message);
        } else {
          counts.failed++;
          note(asset, "failed", e.message);
          logger.error({ event: "FA_AUTO_DEP_ASSET_FAILED", assetId: asset.AssetId, year, month, err: e.message }, "Auto depreciation failed for an asset");
        }
      }
    }

    await pool.request()
      .input("Id", sql.Int, runId)
      .input("E", sql.Int, counts.eligible).input("P", sql.Int, counts.posted)
      .input("A", sql.Int, counts.alreadyPosted).input("S", sql.Int, counts.skipped)
      .input("F", sql.Int, counts.failed).input("N", sql.Int, counts.notConfigured)
      .input("Amt", sql.Decimal(18, 2), Math.round(counts.totalAmount * 100) / 100)
      .input("D", sql.NVarChar(sql.MAX), JSON.stringify(details))
      .query(`
        UPDATE dbo.FixedAssetDepreciationRun
        SET Status = 'Completed', FinishedAt = SYSDATETIME(), Eligible = @E, Posted = @P, AlreadyPosted = @A,
            Skipped = @S, Failed = @F, NotConfigured = @N, TotalAmount = @Amt, Details = @D
        WHERE RunId = @Id
      `);
    if (counts.posted > 0) {
      await bumpCacheVersion("fixed-assets");
      await bumpCacheVersion("general-ledger");
    }
    return { runId, year, month, ...counts };
  } catch (e) {
    await pool.request().input("Id", sql.Int, runId).input("D", sql.NVarChar(sql.MAX), JSON.stringify([...details, { kind: "runFailed", message: e.message }]))
      .query(`UPDATE dbo.FixedAssetDepreciationRun SET Status = 'Failed', FinishedAt = SYSDATETIME(), Details = @D WHERE RunId = @Id`)
      .catch(() => {});
    throw e;
  }
}

/**
 * What a run for (year, month) WOULD do — nothing is posted and no run is logged.
 * Same eligibility and arithmetic as the real run (computeMonth), so it is a faithful preview.
 */
async function previewDepreciationForPeriod(pool, { year, month }) {
  const out = { year, month, eligible: 0, wouldPost: 0, alreadyPosted: 0, skipped: 0, notConfigured: 0, totalAmount: 0, assets: [] };
  for (const asset of await loadCandidateAssets(pool)) {
    const label = asset.FAItemCode || asset.AssetCode;
    const cfgProblem = validateAssetForDepreciation(asset);
    if (cfgProblem) { out.notConfigured++; out.assets.push({ assetId: asset.AssetId, faItemCode: label, result: "notConfigured", message: cfgProblem.message }); continue; }
    out.eligible++;
    try {
      const dep = await computeMonth(pool, asset, year, month);
      if (dep.isPosted) { out.alreadyPosted++; out.assets.push({ assetId: asset.AssetId, faItemCode: label, result: "alreadyPosted", amount: dep.depreciationAmount }); }
      else { out.wouldPost++; out.totalAmount += dep.depreciationAmount; out.assets.push({ assetId: asset.AssetId, faItemCode: label, result: "wouldPost", amount: dep.depreciationAmount, closingBookValue: dep.closingBookValue }); }
    } catch (e) {
      out.skipped++;
      out.assets.push({ assetId: asset.AssetId, faItemCode: label, result: "skipped", message: e.message });
    }
  }
  out.totalAmount = Math.round(out.totalAmount * 100) / 100;
  return out;
}

/** Closed months that still need their automatic run: since the last auto run, up to last month. */
async function pendingAutoPeriods(pool, today = todayIst()) {
  const target = prevMonth(today.y, today.m);
  // A run stuck in 'Running' (crashed process) must not block the period forever.
  await pool.request().query(`
    UPDATE dbo.FixedAssetDepreciationRun SET Status = 'Failed', FinishedAt = SYSDATETIME()
    WHERE Status = 'Running' AND StartedAt < DATEADD(HOUR, -2, SYSDATETIME())
  `);
  const last = await pool.request().query(`
    SELECT TOP 1 PeriodYear, PeriodMonth FROM dbo.FixedAssetDepreciationRun
    WHERE TriggerType = 'Auto' AND Status <> 'Failed'
    ORDER BY PeriodYear DESC, PeriodMonth DESC
  `);
  const periods = [];
  const lastRow = last.recordset[0];
  const from = lastRow ? periodIndex(lastRow.PeriodYear, lastRow.PeriodMonth) + 1 : periodIndex(target.y, target.m);
  const to = periodIndex(target.y, target.m);
  for (let i = Math.max(from, to - (MAX_CATCH_UP_MONTHS - 1)); i <= to; i++) periods.push({ y: Math.floor(i / 12), m: (i % 12) + 1 });
  return periods;
}

async function runAutoDepreciationCheck(pool) {
  const results = [];
  for (const p of await pendingAutoPeriods(pool)) {
    const res = await runDepreciationForPeriod(pool, { year: p.y, month: p.m, trigger: "Auto", runBy: AUTO_USER });
    if (!res.skipped) results.push(res);
  }
  return results;
}

let timer = null;
function startAutoDepreciationEngine() {
  // Kill switch: FA_AUTO_DEPRECIATION=off disables the scheduler (manual posting still works).
  if (String(process.env.FA_AUTO_DEPRECIATION || "on").toLowerCase() === "off") {
    logger.info({ event: "FA_AUTO_DEPRECIATION_DISABLED" }, "Automatic monthly depreciation is switched off (FA_AUTO_DEPRECIATION=off)");
    return;
  }
  const { getPool } = require("../db");
  let running = false;
  const run = () => {
    if (running) return;
    running = true;
    runAutoDepreciationCheck(getPool())
      .then((rs) => {
        for (const r of rs) {
          logger.info({ event: "FA_AUTO_DEPRECIATION_DONE", ...r }, `Auto depreciation ${r.month}/${r.year}: ${r.posted} posted, ${r.alreadyPosted} already posted, ${r.skipped} skipped, ${r.failed} failed, ${r.notConfigured} not configured`);
        }
      })
      .catch((e) => logger.error({ event: "FA_AUTO_DEPRECIATION_FAILED", err: e.message }, "Auto depreciation check failed"))
      .finally(() => { running = false; });
  };
  setTimeout(run, 30_000); // let startup finish first
  timer = setInterval(run, CHECK_INTERVAL_MS);
}
function stopAutoDepreciationEngine() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = {
  AUTO_USER,
  todayIst,
  runDepreciationForPeriod,
  previewDepreciationForPeriod,
  runAutoDepreciationCheck,
  pendingAutoPeriods,
  startAutoDepreciationEngine,
  stopAutoDepreciationEngine,
};
