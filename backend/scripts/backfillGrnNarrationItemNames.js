// One-off backfill: adds the item-name suffix (see grnPosting.js's
// itemNameSuffix) to the Narration of already-posted GRN legs, for both
// live posting paths (SourceType='GRNPosting' and SourceType='GRN').
//
// Narration is descriptive metadata, not part of the double-entry
// balance — unlike every other backfill this session, this does a direct
// UPDATE of just the Narration column (never DebitAmount, CreditAmount,
// LHeadId, or IsReversed) instead of a reverse-and-repost. Reversing and
// reposting real financial entries just to relabel them would double the
// entry count and clutter the audit trail for a purely cosmetic fix.
//
// Matches each live leg to its freshly-recomputed narration POSITIONALLY:
// both the original posting and this backfill build their lines in the
// exact same deterministic order (buckets built by parsing the same
// stored GRNItems JSON in the same order), and legs were inserted in that
// same order by postVoucher's atomic transaction — so live legs ordered
// by EntryId ASC line up 1:1 with a fresh buildGrnPostingLines() call, as
// long as the leg COUNT still matches (if it doesn't — e.g. the GRN's
// items or GL tags changed since posting — the GRN is skipped with a
// warning rather than risk mislabeling a leg).
//
// Dry-run by default — prints what it WOULD change without touching the
// database. Pass --apply to actually write.
//
// Usage:
//   node backend/scripts/backfillGrnNarrationItemNames.js
//   node backend/scripts/backfillGrnNarrationItemNames.js --apply

const { connectDB, getPool, closeDB, sql } = require("../db");
const { computeGrnPostingBuckets, buildGrnPostingLines } = require("../services/grnPosting");
const { resolveItemGlHeads } = require("../services/itemGlHead");

const APPLY = process.argv.includes("--apply");

function itemNameSuffix(itemNames) {
  const unique = [...new Set(itemNames)];
  if (unique.length === 0) return "";
  if (unique.length <= 2) return ` — ${unique.join(", ")}`;
  return ` — ${unique[0]} & ${unique.length - 1} more`;
}

async function getSystemLedgers(pool) {
  const ledRes = await pool.request().query(`SELECT LHeadId, LHeadName FROM dbo.AccountHeadMaster WHERE LHeadType='GL' AND IsSystemGenerated=1 AND LHeadStatus=1`);
  const leds = ledRes.recordset;
  const findId = (fn) => leds.find(fn)?.LHeadId;
  return {
    purchaseId: findId((l) => l.LHeadName.toLowerCase().includes("purchase")),
    pgrnId: findId((l) => l.LHeadName.toLowerCase().includes("pending")),
    provisionalId: findId((l) => l.LHeadName.toLowerCase().includes("provisional") && l.LHeadName.toLowerCase().includes("credit")),
    fixedAssetId: findId((l) => l.LHeadName === "Fixed Assets A/c"),
  };
}

// Fresh lines for a SourceType='GRN' (auto-post-on-approval) voucher —
// same bucket/narration shape as postGRNApproval's own leg construction,
// minus every side effect (StockLedger, fixed-asset auto-allocation):
// narration-relevant computation only.
async function buildGrnApprovalLinesForNarration(pool, grn, ledgers) {
  let items = [];
  try {
    items = JSON.parse(grn.GRNItems || "[]");
    if (!Array.isArray(items)) items = [];
  } catch { items = []; }

  const itemIds = items.map((it) => it.itemId).filter((id) => id != null).map(String);
  const itemGlMap = await resolveItemGlHeads(pool, sql, itemIds);

  const purchaseAmountByHead = new Map();
  const fixedAssetAmountByHead = new Map();
  for (const it of items) {
    const amt = Number(it.totalAmount) || 0;
    const itemId = it.itemId != null ? String(it.itemId) : null;
    const master = itemId ? itemGlMap.get(itemId) : null;
    const itemName = it.itemName || it.ItemName || it.description || it.Description || null;
    const target = master?.isFixedAsset ? fixedAssetAmountByHead : purchaseAmountByHead;
    const headId = master?.isFixedAsset ? master.glHeadId : (master?.glHeadId ?? null);
    const bucket = target.get(headId) ?? { amount: 0, itemNames: [] };
    bucket.amount += amt;
    if (itemName) bucket.itemNames.push(itemName);
    target.set(headId, bucket);
  }

  const baseAmount = items.reduce((s, i) => s + (Number(i.totalAmount) || 0), 0);
  const totalInclGst = Number(grn.TotalAmount) || 0;
  const gstAmount = Math.max(0, totalInclGst - baseAmount);
  const docNo = grn.DocNo || grn.GRNNo || `GRN-${grn.GRNID}`;

  const purchaseLegs = Array.from(purchaseAmountByHead.entries()).map(([lHeadId, { amount, itemNames }]) => ({
    LHeadId: lHeadId || ledgers.purchaseId,
    DebitAmount: Math.round(amount * 100) / 100,
    CreditAmount: 0,
    Narration: `GRN ${docNo} — goods received (base)${itemNameSuffix(itemNames)}`,
  }));
  const fixedAssetLegs = Array.from(fixedAssetAmountByHead.entries()).map(([lHeadId, { amount, itemNames }]) => ({
    LHeadId: lHeadId,
    DebitAmount: Math.round(amount * 100) / 100,
    CreditAmount: 0,
    Narration: `GRN ${docNo} — fixed asset received (capitalized)${itemNameSuffix(itemNames)}`,
  }));

  return [
    ...purchaseLegs,
    ...fixedAssetLegs,
    { LHeadId: ledgers.provisionalId, DebitAmount: Math.round(gstAmount * 100) / 100, CreditAmount: 0, Narration: `GRN ${docNo} — input GST credit (provisional)` },
    { LHeadId: ledgers.pgrnId, DebitAmount: 0, CreditAmount: Math.round(totalInclGst * 100) / 100, Narration: `GRN ${docNo} — goods received, not yet invoiced` },
  ];
}

async function processSourceType(pool, sourceType, ledgers) {
  const grnIdsRes = await pool.request().input("SourceType", sql.NVarChar(30), sourceType).query(`
    SELECT DISTINCT SourceId FROM dbo.GeneralLedgerEntry WHERE SourceType = @SourceType AND IsReversed = 0
  `);

  let changedLegs = 0, changedVouchers = 0, skippedVouchers = 0;

  for (const { SourceId: grnId } of grnIdsRes.recordset) {
    const grnRes = await pool.request().input("GRNID", sql.Int, grnId).query(`
      SELECT g.GRNID, g.GRNNo, g.DocNo, g.GRNDate, g.GRNItems, g.TotalAmount, g.POID
      FROM dbo.GoodsReceiptNotes g WHERE g.GRNID = @GRNID
    `);
    const grn = grnRes.recordset[0];
    if (!grn) { skippedVouchers++; continue; }

    const liveLegsRes = await pool.request().input("SourceType", sql.NVarChar(30), sourceType).input("SourceId", sql.Int, grnId).query(`
      SELECT EntryId, LHeadId, DebitAmount, CreditAmount, Narration
      FROM dbo.GeneralLedgerEntry
      WHERE SourceType = @SourceType AND SourceId = @SourceId AND IsReversed = 0
      ORDER BY EntryId ASC
    `);
    const liveLegs = liveLegsRes.recordset;

    let freshLines;
    if (sourceType === "GRNPosting") {
      const { buckets } = await computeGrnPostingBuckets(pool, sql, grn);
      freshLines = buildGrnPostingLines({ buckets, grnNo: grn.GRNNo, purchaseId: ledgers.purchaseId, pgrnId: ledgers.pgrnId, provisionalId: ledgers.provisionalId });
    } else {
      freshLines = await buildGrnApprovalLinesForNarration(pool, grn, ledgers);
    }

    if (freshLines.length !== liveLegs.length) {
      skippedVouchers++;
      console.log(`⚠ ${sourceType} SourceId ${grnId} (${grn.GRNNo}): leg count changed (${liveLegs.length} live vs ${freshLines.length} fresh) — skipping, would risk mislabeling.`);
      continue;
    }

    // Safety check: this script only ever touches Narration text. If a
    // leg's recomputed LHeadId or amounts differ too, that's a real
    // financial-classification drift (e.g. an auto-posted 'GRN' voucher
    // that predates the Fixed-Asset-vs-Purchase-A/c fix and was never
    // caught by backfillItemGlHeads.js, which only ever checked
    // 'GRNPosting') — not something safe to paper over with a narration
    // rewrite. Skip the whole voucher and flag it for the proper
    // reverse-and-repost backfill instead.
    const hasClassificationDrift = liveLegs.some((live, i) => {
      const fresh = freshLines[i];
      return live.LHeadId !== fresh.LHeadId
        || Math.abs(Number(live.DebitAmount) - fresh.DebitAmount) > 0.01
        || Math.abs(Number(live.CreditAmount) - fresh.CreditAmount) > 0.01;
    });
    if (hasClassificationDrift) {
      skippedVouchers++;
      console.log(`⚠ ${sourceType} SourceId ${grnId} (${grn.GRNNo}): recomputed legs don't just differ in Narration (LHeadId/amount drift too) — skipping, needs backfillItemGlHeads.js's reverse-and-repost instead, not a narration-only fix.`);
      continue;
    }

    let voucherChanged = false;
    for (let i = 0; i < liveLegs.length; i++) {
      const live = liveLegs[i];
      const fresh = freshLines[i];
      if (live.Narration === fresh.Narration) continue;
      voucherChanged = true;
      changedLegs++;
      console.log(`  EntryId ${live.EntryId}: "${live.Narration}" → "${fresh.Narration}"`);
      if (APPLY) {
        await pool.request().input("EntryId", sql.Int, live.EntryId).input("Narration", sql.NVarChar(255), fresh.Narration).query(
          `UPDATE dbo.GeneralLedgerEntry SET Narration = @Narration WHERE EntryId = @EntryId`,
        );
      }
    }
    if (voucherChanged) {
      changedVouchers++;
      console.log(`  (${sourceType} SourceId ${grnId}, ${grn.GRNNo})\n`);
    }
  }

  return { changedLegs, changedVouchers, skippedVouchers, total: grnIdsRes.recordset.length };
}

async function main() {
  await connectDB();
  const pool = getPool();
  const ledgers = await getSystemLedgers(pool);

  console.log(`Mode: ${APPLY ? "APPLY" : "DRY-RUN"}\n`);

  const posting = await processSourceType(pool, "GRNPosting", ledgers);
  console.log(`\nGRNPosting: ${posting.changedLegs} leg(s) across ${posting.changedVouchers} voucher(s) ${APPLY ? "updated" : "would be updated"} (of ${posting.total} checked, ${posting.skippedVouchers} skipped).`);

  const approval = await processSourceType(pool, "GRN", ledgers);
  console.log(`\nGRN (auto-post): ${approval.changedLegs} leg(s) across ${approval.changedVouchers} voucher(s) ${APPLY ? "updated" : "would be updated"} (of ${approval.total} checked, ${approval.skippedVouchers} skipped).`);

  if (!APPLY && (posting.changedLegs > 0 || approval.changedLegs > 0)) {
    console.log("\nRe-run with --apply to write these changes.");
  }

  await closeDB();
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
