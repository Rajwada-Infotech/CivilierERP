"use strict";

// backend/services/fixedAssetDepreciationPosting.js
//
// Monthly depreciation posting for a Fixed Asset Record:
//   Dr  Depreciation Expense A/c        (period charge)
//   Cr  Accumulated Depreciation A/c    (period charge)
//
// Config-driven: the charge comes from the asset's own DepreciationType
// (SLM / WDV) + DepreciationRate (from the record / Depreciation Setup); the
// two GL heads are looked up by name (migration 393-seed-depreciation-gl-heads).
// Accumulated depreciation for a period = SUM of already-posted (non-reversed)
// entries before that period, so every entry builds on real posted history
// and the ledger always agrees.

const { sql } = require("../db");
const { postVoucher, getGLHeadId, reversePostingBySource } = require("./generalLedger");

const SOURCE_TYPE = "FADepreciation";
const EXPENSE_HEAD = "Depreciation Expense A/c";
const ACCUM_HEAD = "Accumulated Depreciation A/c";

function cfgErr(message) {
  const err = new Error(message);
  err.code = "CONFIG_MISSING";
  return err;
}
function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** "FY 2026-27" for a calendar year/month (Indian FY: Apr–Mar). */
function finYearOf(year, month) {
  const startYear = month >= 4 ? year : year - 1;
  return `FY ${startYear}-${String(startYear + 1).slice(-2)}`;
}

/** Depreciation start = ActivationDate, else PurchaseDate. Returns {y, m} or null. */
function depreciationStart(asset) {
  const raw = asset.ActivationDate || asset.PurchaseDate;
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return { y: d.getFullYear(), m: d.getMonth() + 1 };
}

/** Validate the asset carries everything depreciation posting needs. */
function validateAssetForDepreciation(asset) {
  const cost = Number(asset.PurchaseCost) || 0;
  if (cost <= 0) return cfgErr("Depreciation cannot be posted: the asset has no Purchase Cost.");
  const rate = Number(asset.DepreciationRate) || 0;
  if (rate <= 0) return cfgErr("Depreciation is not configured for this asset — set a Depreciation Rate on the record (or in Depreciation Setup).");
  const method = (asset.DepreciationType || "").toUpperCase();
  if (method !== "SLM" && method !== "WDV") return cfgErr("Depreciation Method must be SLM or WDV on the asset.");
  if (!depreciationStart(asset)) return cfgErr("Depreciation cannot be posted: the asset has no Activation / Purchase date.");
  return null;
}

/**
 * Sum of posted (non-reversed) DepreciationAmount over a period range.
 *  - `inclusive = false` → strictly before (year, month)   [what a NEW month opens on]
 *  - `inclusive = true`  → up to AND INCLUDING (year, month) [the accumulated balance to show]
 * Always a LIVE recalculation from the entry rows, so reversing an earlier
 * month immediately lowers every later month's accumulated figure.
 */
async function sumPostedDepreciation(pool, assetId, year, month, inclusive) {
  const cmp = inclusive
    ? "(PeriodYear < @Y OR (PeriodYear = @Y AND PeriodMonth <= @M))"
    : "(PeriodYear < @Y OR (PeriodYear = @Y AND PeriodMonth < @M))";
  const r = await pool.request()
    .input("AssetId", sql.Int, assetId)
    .input("Y", sql.SmallInt, year)
    .input("M", sql.TinyInt, month)
    .query(`
      SELECT ISNULL(SUM(DepreciationAmount), 0) AS Accum
      FROM dbo.FixedAssetDepreciationEntry
      WHERE AssetId = @AssetId AND Status <> 'Reversed' AND ${cmp}
    `);
  return round2(r.recordset[0]?.Accum || 0);
}

/** The posted (non-reversed) entry for this exact (asset, year, month), or null. */
async function postedEntry(pool, assetId, year, month) {
  const r = await pool.request()
    .input("AssetId", sql.Int, assetId)
    .input("Y", sql.SmallInt, year)
    .input("M", sql.TinyInt, month)
    .query(`
      SELECT TOP 1 EntryId, VoucherNo, Method, RatePct, PurchaseCost,
             OpeningBookValue, DepreciationAmount, ClosingBookValue
      FROM dbo.FixedAssetDepreciationEntry
      WHERE AssetId = @AssetId AND PeriodYear = @Y AND PeriodMonth = @M AND Status <> 'Reversed'
    `);
  return r.recordset[0] || null;
}
// Back-compat alias used by postDepreciation()'s duplicate guard.
const alreadyPosted = postedEntry;

/**
 * Depreciation figures for one month.
 *
 *  openingBookValue / depreciationAmount / closingBookValue  → THIS MONTH ONLY.
 *      For an already-posted month these come straight from the stored entry
 *      (historical rows are never recomputed / changed).
 *  accumulatedDepreciation → cumulative balance = LIVE SUM of every posted
 *      non-reversed entry up to and including the selected month (plus this
 *      month's about-to-be-posted charge when it isn't posted yet).
 *
 * The journal posting (buildPostingPlan) only ever uses `depreciationAmount`
 * — never `accumulatedDepreciation`.
 */
async function computeMonth(pool, asset, year, month) {
  const bad = validateAssetForDepreciation(asset);
  if (bad) throw bad;

  const start = depreciationStart(asset);
  if (year < start.y || (year === start.y && month < start.m)) {
    throw cfgErr(`Asset was not in service in ${month}/${year} (depreciation starts ${start.m}/${start.y}).`);
  }

  const cost = round2(asset.PurchaseCost);
  const rate = Number(asset.DepreciationRate);
  const method = asset.DepreciationType.toUpperCase();

  const existing = await postedEntry(pool, asset.AssetId, year, month);

  if (existing) {
    // Already posted — show exactly what is in the ledger for this month, and
    // the cumulative balance recalculated live (so a reversal of an earlier
    // month is reflected here).
    const accumInclusive = await sumPostedDepreciation(pool, asset.AssetId, year, month, true);
    return {
      method: existing.Method || method,
      ratePct: existing.RatePct != null ? Number(existing.RatePct) : rate,
      cost: round2(existing.PurchaseCost ?? cost),
      openingBookValue: round2(existing.OpeningBookValue),
      depreciationAmount: round2(existing.DepreciationAmount),
      closingBookValue: round2(existing.ClosingBookValue),
      accumulatedDepreciation: accumInclusive,
      finYear: finYearOf(year, month),
      isPosted: true,
    };
  }

  // Not posted yet — preview.
  const accumBefore = await sumPostedDepreciation(pool, asset.AssetId, year, month, false);
  const opening = round2(cost - accumBefore);
  if (opening <= 0.01) {
    throw cfgErr("This asset is already fully depreciated — no further depreciation to post.");
  }

  // Monthly charge: SLM on cost (constant), WDV on the opening book value. Rate is p.a.
  const gross = method === "WDV" ? (opening * rate) / 1200 : (cost * rate) / 1200;
  const charge = round2(Math.min(gross, opening)); // never below zero book value
  const closing = round2(opening - charge);

  return {
    method, ratePct: rate, cost,
    openingBookValue: opening,
    depreciationAmount: charge,
    closingBookValue: closing,
    accumulatedDepreciation: round2(accumBefore + charge),
    finYear: finYearOf(year, month),
    isPosted: false,
  };
}

/**
 * Balanced posting plan for a month. Returns { voucherRef, isPosted, legs,
 * entries, depreciation:{...} }. voucherRef is null until actually posted.
 */
async function buildPostingPlan(pool, asset, year, month) {
  const dep = await computeMonth(pool, asset, year, month);
  const expenseId = await getGLHeadId(pool, EXPENSE_HEAD);   // throws if missing
  const accumId = await getGLHeadId(pool, ACCUM_HEAD);

  const posted = await alreadyPosted(pool, asset.AssetId, year, month);
  const label = `${asset.AssetCode || asset.FAItemCode || ("Asset #" + asset.AssetId)} — depreciation ${String(month).padStart(2, "0")}/${year}`;

  return {
    isPosted: !!posted,
    voucherRef: posted?.VoucherNo || null,
    depreciation: dep,
    legs: [
      { lHeadId: expenseId, debit: dep.depreciationAmount, narration: label },
      { lHeadId: accumId, credit: dep.depreciationAmount, narration: label },
    ],
    entries: [
      { account: EXPENSE_HEAD, debit: dep.depreciationAmount, credit: 0 },
      { account: ACCUM_HEAD, debit: 0, credit: dep.depreciationAmount },
    ],
  };
}

/**
 * Post the month's depreciation: lock a voucher no, post the GL voucher, and
 * record the entry row. `lockDocNo` is injected by the route
 * (utils/docNumberLock) so this service stays free of that dependency graph.
 */
async function postDepreciation(pool, asset, year, month, userEmail, lockDocNo) {
  const dupe = await alreadyPosted(pool, asset.AssetId, year, month);
  if (dupe) {
    return { posted: true, voucherNo: dupe.VoucherNo, entryId: dupe.EntryId, reason: "already posted" };
  }
  const plan = await buildPostingPlan(pool, asset, year, month);
  const dep = plan.depreciation;
  const voucherNo = String(await lockDocNo(dep.finYear)).slice(0, 50);

  const ins = await pool.request()
    .input("AssetId", sql.Int, asset.AssetId)
    .input("Y", sql.SmallInt, year)
    .input("M", sql.TinyInt, month)
    .input("FinYear", sql.NVarChar(20), dep.finYear)
    .input("Method", sql.NVarChar(10), dep.method)
    .input("RatePct", sql.Decimal(9, 4), dep.ratePct)
    .input("Cost", sql.Decimal(18, 2), dep.cost)
    .input("Opening", sql.Decimal(18, 2), dep.openingBookValue)
    .input("Charge", sql.Decimal(18, 2), dep.depreciationAmount)
    .input("Closing", sql.Decimal(18, 2), dep.closingBookValue)
    .input("Accum", sql.Decimal(18, 2), dep.accumulatedDepreciation)
    .input("CompanyId", sql.Int, asset.CompanyId ?? null)
    .input("ProjectId", sql.Int, asset.ProjectId ?? null)
    .input("VoucherNo", sql.NVarChar(50), voucherNo)
    .input("By", sql.NVarChar(200), userEmail)
    .query(`
      INSERT INTO dbo.FixedAssetDepreciationEntry
        (AssetId, PeriodYear, PeriodMonth, FinYear, Method, RatePct, PurchaseCost,
         OpeningBookValue, DepreciationAmount, ClosingBookValue, AccumulatedDepreciation,
         CompanyId, ProjectId, Status, VoucherNo, PostedBy, PostedAt, CreatedBy, CreatedAt)
      OUTPUT INSERTED.EntryId
      VALUES
        (@AssetId, @Y, @M, @FinYear, @Method, @RatePct, @Cost,
         @Opening, @Charge, @Closing, @Accum,
         @CompanyId, @ProjectId, 'Posted', @VoucherNo, @By, SYSDATETIME(), @By, SYSDATETIME())
    `);
  const entryId = ins.recordset[0].EntryId;

  try {
    await postVoucher(pool, {
      voucherNo,
      // 28th of the period month — unambiguous ISO string (no TZ shift), and
      // mid-month so it can never fall into the wrong financial year.
      voucherDate: `${year}-${String(month).padStart(2, "0")}-28`,
      legs: plan.legs,
      sourceType: SOURCE_TYPE,
      sourceId: entryId,
      companyId: asset.CompanyId ?? null,
      projectId: asset.ProjectId ?? null,
      createdBy: userEmail,
    });
  } catch (e) {
    // GL posting failed — roll back the entry row so the month can be retried.
    await pool.request().input("Id", sql.Int, entryId)
      .query(`DELETE FROM dbo.FixedAssetDepreciationEntry WHERE EntryId = @Id`);
    throw e;
  }

  return { posted: true, voucherNo, entryId, depreciation: dep };
}

/** Reverse one posted depreciation entry (flips the GL + marks the row). */
async function reverseDepreciation(pool, entryId, userEmail) {
  const r = await pool.request().input("Id", sql.Int, entryId)
    .query(`SELECT EntryId, Status FROM dbo.FixedAssetDepreciationEntry WHERE EntryId = @Id`);
  const row = r.recordset[0];
  if (!row) { const e = new Error("Depreciation entry not found"); e.code = "NOT_FOUND"; throw e; }
  if (row.Status === "Reversed") return { reversed: true, reason: "already reversed" };

  await reversePostingBySource(pool, SOURCE_TYPE, entryId);
  await pool.request()
    .input("Id", sql.Int, entryId)
    .input("By", sql.NVarChar(200), userEmail)
    .query(`UPDATE dbo.FixedAssetDepreciationEntry
            SET Status = 'Reversed', UpdatedBy = @By, UpdatedAt = SYSDATETIME()
            WHERE EntryId = @Id`);
  return { reversed: true };
}

module.exports = {
  SOURCE_TYPE,
  EXPENSE_HEAD,
  ACCUM_HEAD,
  validateAssetForDepreciation,
  computeMonth,
  buildPostingPlan,
  postDepreciation,
  reverseDepreciation,
};
